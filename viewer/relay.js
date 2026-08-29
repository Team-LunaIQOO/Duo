#!/usr/bin/env node
/**
 * Duo laptop relay — Person C.
 *
 * Serves viewer/index.html over HTTP and relays WebSocket messages from the
 * phone to every connected viewer. It does zero analysis: it forwards bytes,
 * exactly as 03-architecture.md requires ("The laptop does zero analysis. It
 * draws what the phone sends.").
 *
 *   node viewer/relay.js [--port 8787]
 *   then open http://localhost:8787/ on the laptop
 *   and point the phone at ws://<laptop-lan-ip>:8787/phone
 *
 * ZERO DEPENDENCIES ON PURPOSE. viewer/OWNER.md says "no build step, no
 * framework, no install", and the venue may have no usable internet when this
 * is needed. So the WebSocket handshake and frame codec (RFC 6455) are
 * implemented here in about 150 lines against Node's standard library, rather
 * than pulling in `ws`. Only the server half is needed, which is the easy half.
 *
 * See mobile/src/streaming/ARCHITECTURE-NOTE.md for why the phone connects
 * here as a client rather than hosting a server itself.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

// ---------------------------------------------------------------------------
// Frame codec
// ---------------------------------------------------------------------------

/** Encodes one unmasked server->client frame. */
function encodeFrame(payload, opcode = OPCODE.TEXT) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = data.length;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    // JPEG frames base64-encode well past 64KB, so the 64-bit path is not
    // theoretical here.
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode

  return Buffer.concat([header, data]);
}

/**
 * Incremental decoder. Handles masking, all three length forms, and
 * fragmentation via continuation frames.
 *
 * Calls onMessage(text) for each complete text message, onClose(), onPing(buf).
 */
function createDecoder({ onMessage, onClose, onPing }) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = null;

  return function push(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      if (buffer.length < 2) return;

      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buffer.length < offset + 2) return;
        len = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (buffer.length < offset + 8) return;
        const big = buffer.readBigUInt64BE(offset);
        // A frame this large is a bug or an attack; either way, refuse it
        // rather than trying to allocate it.
        if (big > BigInt(64 * 1024 * 1024)) {
          onClose();
          return;
        }
        len = Number(big);
        offset += 8;
      }

      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + len) return; // wait for the rest

      const payload = Buffer.from(buffer.subarray(offset, offset + len));
      buffer = buffer.subarray(offset + len);

      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
      }

      if (opcode === OPCODE.CLOSE) {
        onClose();
        return;
      }
      if (opcode === OPCODE.PING) {
        onPing(payload);
        continue;
      }
      if (opcode === OPCODE.PONG) continue;

      if (opcode === OPCODE.CONTINUATION) {
        fragments.push(payload);
      } else {
        fragments = [payload];
        fragmentOpcode = opcode;
      }

      if (fin) {
        const full = Buffer.concat(fragments);
        fragments = [];
        if (fragmentOpcode === OPCODE.TEXT) onMessage(full.toString('utf8'));
        fragmentOpcode = null;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i !== -1 && argv[i + 1]) {
    const p = Number(argv[i + 1]);
    if (Number.isInteger(p) && p > 0 && p < 65536) return p;
  }
  return 8787;
}

const PORT = parsePort(process.argv);
const ROOT = __dirname;

/** Connected viewer sockets. The phone is tracked only for the status log. */
const viewers = new Set();
let phoneCount = 0;

const counters = { landmarks: 0, frames: 0, stats: 0, other: 0 };

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];

  // Path traversal guard: resolve, then confirm the result is still inside
  // viewer/. This server binds to the LAN at a hackathon venue.
  const filePath = path.join(ROOT, path.normalize(url));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    const type =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
          ? 'text/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  // Latency matters more than packet efficiency for a live skeleton.
  socket.setNoDelay(true);

  const role = (req.url || '').startsWith('/phone') ? 'phone' : 'viewer';

  const send = (payload, opcode) => {
    if (socket.destroyed || !socket.writable) return;
    try {
      socket.write(encodeFrame(payload, opcode));
    } catch {
      /* the close handler will clean up */
    }
  };

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (role === 'viewer') viewers.delete(send);
    else phoneCount = Math.max(0, phoneCount - 1);
    socket.destroy();
    logStatus(`${role} disconnected`);
  };

  if (role === 'viewer') {
    viewers.add(send);
  } else {
    phoneCount++;
  }
  logStatus(`${role} connected`);

  const push = createDecoder({
    onMessage: (text) => {
      if (role !== 'phone') return; // viewers are display-only, never sources

      // Count message types for the status line. Parsed only to count -- the
      // payload is relayed verbatim, so a malformed message costs nothing.
      try {
        const type = JSON.parse(text).type;
        if (type === 'landmarks') counters.landmarks++;
        else if (type === 'frame') counters.frames++;
        else if (type === 'stats') counters.stats++;
        else counters.other++;
      } catch {
        counters.other++;
      }

      for (const viewerSend of viewers) viewerSend(text, OPCODE.TEXT);
    },
    onClose: cleanup,
    onPing: (payload) => send(payload, OPCODE.PONG),
  });

  socket.on('data', (chunk) => {
    try {
      push(chunk);
    } catch {
      cleanup();
    }
  });
  socket.on('error', cleanup);
  socket.on('close', cleanup);
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function lanAddresses() {
  const nets = require('os').networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function logStatus(event) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(
    `[${t}] ${event.padEnd(22)} phone:${phoneCount} viewers:${viewers.size}  ` +
      `landmarks:${counters.landmarks} frames:${counters.frames} stats:${counters.stats}`
  );
}

server.listen(PORT, () => {
  const addrs = lanAddresses();
  console.log('Duo relay');
  console.log(`  viewer:  http://localhost:${PORT}/`);
  for (const a of addrs) console.log(`           http://${a}:${PORT}/`);
  console.log(`  phone:   ws://${addrs[0] || '<laptop-lan-ip>'}:${PORT}/phone`);
  console.log('');
  console.log('  Put that ws:// URL into the phone app (phoneUrlFor in');
  console.log('  mobile/src/streaming/config.ts). Both devices must be on');
  console.log('  the same network. Ctrl+C to stop.');
  console.log('');
});

// Report throughput once a second while anything is connected, so a silent
// stream is obvious during setup rather than at the demo table.
setInterval(() => {
  if (phoneCount > 0 || viewers.size > 0) logStatus('status');
}, 1000).unref();

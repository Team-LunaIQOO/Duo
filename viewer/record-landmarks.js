#!/usr/bin/env node
/**
 * Landmark recorder — Person C.
 *
 * Connects to the relay as an ordinary viewer and appends every LandmarkMessage
 * to a JSONL file. Exists so detector thresholds can be checked against poses a
 * real person actually made in front of the real camera, rather than only
 * against mock geometry that produces exactly the shape it was told to.
 *
 *   node viewer/relay.js                       # terminal 1
 *   node viewer/record-landmarks.js out.jsonl  # terminal 2, while the phone streams
 *
 * Then replay it through the gesture detector:
 *
 *   cd mobile
 *   npx tsc src/gesture/replayRecording.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/gesture/replayRecording.js ../out.jsonl
 *
 * Zero dependencies, like everything else in viewer/ (see viewer/OWNER.md).
 * Node 22+ provides a global WebSocket client, which is all this needs — the
 * hand-rolled RFC 6455 code in relay.js is only required for the server half.
 *
 * Caveat worth knowing before trusting a replay: LandmarkMessage carries [x, y]
 * pairs only, because 03-architecture.md drops z and visibility to keep the
 * stream at 20/sec. A replay therefore exercises the geometry with real
 * coordinates but cannot exercise the visibility gate. That gate is covered by
 * the offline self-test instead.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 8787;

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg !== -1 ? Number(args[portArg + 1]) : DEFAULT_PORT;
const hostArg = args.indexOf('--host');
const host = hostArg !== -1 ? args[hostArg + 1] : 'localhost';
const outPath = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'landmarks.jsonl');

if (typeof WebSocket === 'undefined') {
  console.error(`Node ${process.versions.node} has no global WebSocket. Node 22+ required.`);
  process.exit(1);
}

const url = `ws://${host}:${port}/`;
const out = fs.createWriteStream(outPath, { flags: 'w' });

let landmarks = 0;
let stats = 0;
let startedAt = null;

console.log('Landmark recorder');
console.log(`  relay:  ${url}`);
console.log(`  output: ${outPath}`);
console.log('  Ctrl+C to stop.\n');

function connect() {
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => console.log('  connected to relay, waiting for the phone'));

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return;
    }

    if (message.type === 'landmarks') {
      if (startedAt === null) {
        startedAt = Date.now();
        console.log('  receiving landmarks');
      }
      landmarks++;
      out.write(JSON.stringify(message) + '\n');
      if (landmarks % 100 === 0) process.stdout.write(`\r  ${landmarks} landmark frames recorded  `);
    } else if (message.type === 'stats') {
      stats++;
    }
  });

  socket.addEventListener('close', () => {
    console.log('\n  relay closed, retrying in 1s');
    setTimeout(connect, 1000);
  });

  socket.addEventListener('error', () => {
    // 'close' follows and owns the retry.
  });
}

connect();

process.on('SIGINT', () => {
  const seconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  console.log(`\n\n  ${landmarks} landmark frames, ${stats} stats messages`);
  if (seconds > 0) console.log(`  ${(landmarks / seconds).toFixed(1)} frames/sec over ${seconds.toFixed(1)}s`);
  console.log(`  written to ${outPath}\n`);
  out.end(() => process.exit(0));
});

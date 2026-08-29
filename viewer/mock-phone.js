#!/usr/bin/env node
/**
 * Mock phone — Person C.
 *
 * Pretends to be the phone: drives the mock PoseFrame/RepEvent generator
 * through the real StreamPublisher, the real FatigueDetector and the real
 * WebSocketClientTransport, and streams the result to the relay. Lets the whole
 * chain be tested without the loaner device, which is shared across the team
 * (05-build-plan.md).
 *
 * This runs the ACTUAL phone-side modules, not a reimplementation of them, so
 * a bug in the publisher shows up here. It needs them compiled first:
 *
 *   cd mobile
 *   npx tsc src/streaming/index.ts src/fatigue/index.ts \
 *     src/fatigue/mock/mockPoseSource.ts \
 *     --ignoreConfig --ignoreDeprecations 6.0 --outDir .selftest \
 *     --module commonjs --target es2020 --moduleResolution node \
 *     --strict --skipLibCheck
 *
 *   cd ..
 *   node viewer/relay.js          # terminal 1
 *   node viewer/mock-phone.js     # terminal 2
 *   open http://localhost:8787/   # browser
 *
 * Uses Node's built-in global WebSocket (Node 22+), which is the same global
 * React Native provides — so WebSocketClientTransport runs here unmodified.
 */

'use strict';

const path = require('path');

const BUILD = path.join(__dirname, '..', 'mobile', '.selftest');

let streaming, fatigue, mock;
try {
  streaming = require(path.join(BUILD, 'streaming', 'index.js'));
  fatigue = require(path.join(BUILD, 'fatigue', 'index.js'));
  mock = require(path.join(BUILD, 'fatigue', 'mock', 'mockPoseSource.js'));
} catch (err) {
  console.error('Could not load the compiled phone modules from mobile/.selftest.');
  console.error('Compile them first — see the command at the top of this file.\n');
  console.error(err.message);
  process.exit(1);
}

if (typeof WebSocket === 'undefined') {
  console.error(`Node ${process.versions.node} has no global WebSocket. Node 22+ required.`);
  process.exit(1);
}

const { StreamPublisher, WebSocketClientTransport, DEFAULT_STREAM_PORT } = streaming;
const { FatigueDetector } = fatigue;
const { startMockPoseSource, MOCK_JPEG_BASE64 } = mock;

const portArg = process.argv.indexOf('--port');
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : DEFAULT_STREAM_PORT;
const hostArg = process.argv.indexOf('--host');
const host = hostArg !== -1 ? process.argv[hostArg + 1] : 'localhost';

const url = `ws://${host}:${port}/phone`;

const transport = new WebSocketClientTransport({ url });
transport.onStateChange = (s) => console.log(`  transport: ${s}`);

const publisher = new StreamPublisher(transport);
const detector = new FatigueDetector({ workingSide: 'left', exercise: 'E1' });

console.log('Mock phone');
console.log(`  connecting to ${url}`);
console.log('');

publisher.start();

// Session state this mock is standing in for. On the real device this lives in
// Person B's session state machine.
let reps = 0;
let lastQuality = '—';
let fatigueLevel = 'none';
const compensations = [];

const pushStats = () =>
  publisher.publishStats({
    reps,
    quality: lastQuality,
    compensations: [...compensations],
    fatigue: fatigueLevel,
  });

const stop = startMockPoseSource(
  {
    onPoseFrame: (frame) => {
      detector.onPoseFrame(frame);
      publisher.publishPoseFrame(frame);

      // The camera-frame path: ask before paying for an encode. Here the
      // "encode" is a constant; on device this is where the real downscale and
      // JPEG compression happen (03-architecture.md: cap at 5-8 fps and
      // downscale BEFORE encoding).
      if (publisher.shouldEncodeFrame()) {
        publisher.publishJpegFrame(MOCK_JPEG_BASE64, frame.timestamp);
      }
    },

    onRepEvent: (rep) => {
      reps = rep.repNumber;
      lastQuality = rep.quality;

      const signal = detector.onRepEvent(rep);
      if (signal) {
        fatigueLevel = signal.level;
        console.log(
          `  rep ${String(rep.repNumber).padStart(2)}  ` +
            `peak ${rep.peakAngle.toFixed(1)}deg  ` +
            `FATIGUE -> ${signal.level} (${signal.reason})`
        );
      } else {
        console.log(
          `  rep ${String(rep.repNumber).padStart(2)}  ` +
            `peak ${rep.peakAngle.toFixed(1)}deg  ${rep.quality}`
        );
      }

      // Fire a compensation partway through, so the viewer's compensation
      // panel and the demo's beat 4 can be rehearsed without a real lean.
      if (rep.repNumber === 5) compensations.push('forward_lean');
      if (rep.repNumber === 7) compensations.length = 0;

      pushStats();
    },

    onComplete: () => {
      console.log('\n  session complete');
      console.log('  publisher:', publisher.stats);
      publisher.stop();
      process.exit(0);
    },
  },
  { repCount: 14, fatigueStartRep: 7, restBetweenRepsMs: 700, seed: 42 }
);

pushStats();

process.on('SIGINT', () => {
  stop();
  publisher.stop();
  console.log('\n  stopped');
  process.exit(0);
});

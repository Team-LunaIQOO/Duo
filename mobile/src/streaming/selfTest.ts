/**
 * Offline self-test for the stream publisher — Person C.
 *
 * Drives the publisher with the mock pose source and a controllable clock, and
 * asserts the rates and shapes 03-architecture.md specifies. No socket
 * involved: MemoryTransport records what would have gone out.
 *
 * Run, from mobile/:
 *
 *   npx tsc src/streaming/selfTest.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/streaming/selfTest.js
 */

import { generateMockSession, MOCK_JPEG_BASE64 } from '../fatigue/mock/mockPoseSource';
import { DEFAULT_STREAM_CONFIG } from './config';
import { StreamPublisher } from './streamPublisher';
import { MemoryTransport } from './transport';
import type { FrameMessage, LandmarkMessage, StatsMessage } from '../types/contracts';

declare const process: { exit(code: number): void };

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

/** A clock the test advances by hand, so rates are exact and not wall-clock. */
function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

console.log('Stream publisher self-test');
console.log(
  `Targets: landmarks ${DEFAULT_STREAM_CONFIG.landmarkFps}/sec, ` +
    `frames ${DEFAULT_STREAM_CONFIG.frameFps}/sec, stats event-driven`
);

// --- 1. Landmark rate and shape -------------------------------------------

section('1. Landmark messages: rate and shape');
{
  const clock = makeClock();
  const transport = new MemoryTransport();
  const publisher = new StreamPublisher(transport, { clock: clock.now });
  publisher.start();

  // A 50 fps camera — deliberately faster than the 20/sec target. No rest
  // between reps, so the measured rate reflects the throttle rather than gaps
  // in the input where there was simply nothing to send.
  const events = generateMockSession({
    repCount: 4,
    fps: 50,
    restBetweenRepsMs: 0,
    seed: 11,
  });
  const frames = events.filter((e) => e.kind === 'frame');
  for (const e of frames) {
    if (e.kind !== 'frame') continue;
    clock.set(e.frame.timestamp);
    publisher.publishPoseFrame(e.frame);
  }

  const sent = transport.sent.filter((m): m is LandmarkMessage => m.type === 'landmarks');
  const spanSec = (frames[frames.length - 1].at - frames[0].at) / 1000;
  const rate = sent.length / spanSec;

  console.log(
    `  ${frames.length} frames over ${spanSec.toFixed(1)}s -> ` +
      `${sent.length} sent (${rate.toFixed(1)}/sec), ` +
      `${publisher.stats.landmarksThrottled} throttled`
  );

  check('throttled well below the input frame rate', sent.length < frames.length);
  check(
    `achieved rate is close to ${DEFAULT_STREAM_CONFIG.landmarkFps}/sec`,
    Math.abs(rate - DEFAULT_STREAM_CONFIG.landmarkFps) <= 2,
    `${rate.toFixed(2)}/sec`
  );
  check('every message is discriminated as "landmarks"', sent.every((m) => m.type === 'landmarks'));
  check('carries all 33 landmarks', sent.every((m) => m.landmarks.length === 33));
  check(
    'each landmark is an [x, y] pair only, z and visibility dropped',
    sent.every((m) => m.landmarks.every((p) => Array.isArray(p) && p.length === 2))
  );
  check(
    'coordinates stay normalised 0-1',
    sent.every((m) => m.landmarks.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1))
  );
  check('timestamp is carried through from the PoseFrame', sent.every((m) => m.timestamp >= 0));
}

// --- 2. Unusable frames are not streamed ----------------------------------

section('2. Out-of-frame poses are not sent');
{
  const clock = makeClock();
  const transport = new MemoryTransport();
  const publisher = new StreamPublisher(transport, { clock: clock.now });
  publisher.start();

  for (const e of generateMockSession({ repCount: 2, seed: 12 })) {
    if (e.kind !== 'frame') continue;
    clock.set(e.frame.timestamp);
    publisher.publishPoseFrame({ ...e.frame, inFrame: false });
  }

  check('nothing sent while the user is out of frame', transport.sent.length === 0);
}

// --- 3. JPEG frame rate, and the encode gate ------------------------------

section('3. Frame messages: rate and the shouldEncodeFrame gate');
{
  const clock = makeClock();
  const transport = new MemoryTransport();
  const publisher = new StreamPublisher(transport, { clock: clock.now });
  publisher.start();

  let encodesAttempted = 0;
  const durationMs = 10_000;
  const cameraIntervalMs = 1000 / 30; // a 30 fps camera offering every frame

  for (let t = 0; t <= durationMs; t += cameraIntervalMs) {
    clock.set(t);
    // This is the pattern the real camera pipeline must follow: ask first, and
    // only pay for the JPEG encode when a frame is actually due.
    if (!publisher.shouldEncodeFrame()) continue;
    encodesAttempted++;
    publisher.publishJpegFrame(MOCK_JPEG_BASE64, t);
  }

  const sent = transport.sent.filter((m): m is FrameMessage => m.type === 'frame');
  const rate = sent.length / (durationMs / 1000);

  console.log(
    `  ${sent.length} frames over ${durationMs / 1000}s (${rate.toFixed(1)}/sec), ` +
      `${encodesAttempted} encodes attempted`
  );

  check(
    'rate lands in the documented 5-8/sec band',
    rate >= 5 && rate <= 8,
    `${rate.toFixed(2)}/sec`
  );
  check(
    'the gate prevents wasted encodes',
    encodesAttempted <= sent.length + 1,
    `${encodesAttempted} encodes for ${sent.length} sends`
  );
  check('payload is carried verbatim', sent.every((m) => m.jpeg === MOCK_JPEG_BASE64));
  check('every message is discriminated as "frame"', sent.every((m) => m.type === 'frame'));
}

// --- 4. Stats are event-driven and deduplicated ---------------------------

section('4. Stats messages: event-driven, deduplicated');
{
  const clock = makeClock();
  const transport = new MemoryTransport();
  const publisher = new StreamPublisher(transport, { clock: clock.now });
  publisher.start();

  const base = { reps: 3, quality: 'good', compensations: [] as string[], fatigue: 'none' };

  publisher.publishStats(base);
  publisher.publishStats({ ...base });
  publisher.publishStats({ ...base });
  publisher.publishStats({ ...base, reps: 4 });
  publisher.publishStats({ ...base, reps: 4, fatigue: 'slowing' });
  publisher.publishStats({ ...base, reps: 4, fatigue: 'slowing' });
  publisher.publishStats({ ...base, reps: 4, fatigue: 'slowing', compensations: ['forward_lean'] });

  const sent = transport.sent.filter((m): m is StatsMessage => m.type === 'stats');

  check('only genuine changes are sent', sent.length === 4, `sent ${sent.length}`);
  check('repeats are counted as deduped', publisher.stats.statsDeduped === 3);
  check('no throttling delay applied to stats', sent[0].reps === 3);
  check(
    'compensations array survives as an array',
    Array.isArray(sent[sent.length - 1].compensations) &&
      sent[sent.length - 1].compensations[0] === 'forward_lean'
  );
}

// --- 5. A disconnected laptop must not disturb the session ----------------

section('5. Disconnected transport');
{
  const clock = makeClock();
  const transport = new MemoryTransport(); // never connected
  const publisher = new StreamPublisher(transport, { clock: clock.now });

  let threw = false;
  try {
    for (const e of generateMockSession({ repCount: 2, seed: 13 })) {
      if (e.kind !== 'frame') continue;
      clock.set(e.frame.timestamp);
      publisher.publishPoseFrame(e.frame);
    }
    publisher.publishStats({ reps: 1, quality: 'good', compensations: [], fatigue: 'none' });
  } catch {
    threw = true;
  }

  check('publishing never throws while disconnected', !threw);
  check('drops are counted', publisher.stats.dropped > 0, `${publisher.stats.dropped}`);
  check('nothing was recorded as sent', transport.sent.length === 0);

  // The viewer must not be left stale: a stats message that failed to send is
  // not remembered, so the identical value is retried once connected.
  transport.connect();
  const resent = publisher.publishStats({
    reps: 1,
    quality: 'good',
    compensations: [],
    fatigue: 'none',
  });
  check('an undelivered stats value is resent after reconnect', resent);
}

// --- 6. Oversized messages are dropped, not queued ------------------------

section('6. Oversized message guard');
{
  const clock = makeClock();
  const transport = new MemoryTransport();
  const publisher = new StreamPublisher(transport, {
    clock: clock.now,
    config: { maxMessageBytes: 1024 },
  });
  publisher.start();

  const huge = 'A'.repeat(4096);
  const ok = publisher.publishJpegFrame(huge, 0);

  check('an oversized frame is rejected', !ok);
  check('it never reached the wire', transport.sent.length === 0);
  check('and it is counted as dropped', publisher.stats.dropped === 1);
}

// --- 7. resetSession clears throttle state --------------------------------

section('7. resetSession()');
{
  const clock = makeClock();
  const transport = new MemoryTransport();
  const publisher = new StreamPublisher(transport, { clock: clock.now });
  publisher.start();

  const stats = { reps: 5, quality: 'good', compensations: [] as string[], fatigue: 'none' };
  publisher.publishStats(stats);
  const blocked = publisher.publishStats(stats);
  publisher.resetSession();
  const afterReset = publisher.publishStats(stats);

  check('identical stats are suppressed within a session', !blocked);
  check('and resent after a reset', afterReset);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
if (failures > 0) process.exit(1);

/**
 * Replays a recorded landmark stream through the gesture detector — Person C.
 *
 * The offline self-test proves the logic against constructed geometry. This
 * proves it against a real person in front of the real camera, which is the
 * only way to answer the question that actually matters: does a set of
 * shoulder-abduction reps ever look like a raised hand to this detector?
 *
 *   node viewer/relay.js                        # laptop
 *   node viewer/record-landmarks.js reps.jsonl  # laptop, while the phone streams
 *   # ...do the reps, then hold up a hand...
 *
 *   cd mobile
 *   npx tsc src/gesture/replayRecording.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/gesture/replayRecording.js ../reps.jsonl
 *
 * Prints every gesture the detector would have fired, with its timestamp, plus
 * the distribution of the four measurements across the recording so a
 * threshold can be moved with evidence rather than by feel.
 *
 * One honest limitation: LandmarkMessage carries [x, y] only — z and
 * visibility are dropped to keep the stream at 20/sec (03-architecture.md,
 * section D) — so every replayed landmark is stamped fully visible. The
 * geometry is real; the visibility gate is not exercised here. The self-test
 * covers that.
 */

import type { Landmark, PoseFrame } from '../types/contracts';
import { GesturePauseDetector, type GestureEvent } from './gestureDetector';
import { angleBetween, distance } from '../vision/geometry';
import { LandmarkIndex } from '../vision/landmarks';
import { GESTURE_THRESHOLDS } from './thresholds';

declare const process: { argv: string[]; exit(code: number): void };
declare function require(name: string): any;

const REPLAY_VISIBILITY = 0.95;

type Recorded = { type: string; timestamp: number; landmarks: [number, number][] };

function toFrame(record: Recorded): PoseFrame | null {
  if (record.type !== 'landmarks' || !Array.isArray(record.landmarks)) return null;
  if (record.landmarks.length < 33) return null;
  const landmarks: Landmark[] = record.landmarks.map(([x, y]) => ({
    x,
    y,
    z: 0,
    visibility: REPLAY_VISIBILITY,
  }));
  return { timestamp: record.timestamp, landmarks, confidence: 1, inFrame: true };
}

const file = process.argv[2];
if (!file) {
  console.log('usage: node .selftest/gesture/replayRecording.js <recording.jsonl>');
  process.exit(1);
}

const fs = require('fs');
const lines: string[] = String(fs.readFileSync(file, 'utf8')).split('\n').filter((l: string) => l.trim());

const detector = new GesturePauseDetector();
const events: GestureEvent[] = [];

type Sample = { wristRise: number; elbowRise: number; elbowAngle: number; wristAboveElbow: number };
const samples: Record<'left' | 'right', Sample[]> = { left: [], right: [] };

let frames = 0;
let firstTimestamp: number | null = null;
let lastTimestamp = 0;

for (const line of lines) {
  let record: Recorded;
  try {
    record = JSON.parse(line);
  } catch {
    continue;
  }
  const frame = toFrame(record);
  if (!frame) continue;

  frames++;
  firstTimestamp ??= frame.timestamp;
  lastTimestamp = frame.timestamp;

  const event = detector.update(frame);
  if (event) events.push(event);

  // Same measurements the detector makes, recomputed here so the summary can
  // show how close the recording came to each threshold.
  const lm = frame.landmarks;
  const width = distance(lm[LandmarkIndex.leftShoulder], lm[LandmarkIndex.rightShoulder]);
  if (width <= 1e-6) continue;
  for (const side of ['left', 'right'] as const) {
    const s = lm[side === 'left' ? LandmarkIndex.leftShoulder : LandmarkIndex.rightShoulder];
    const e = lm[side === 'left' ? LandmarkIndex.leftElbow : LandmarkIndex.rightElbow];
    const w = lm[side === 'left' ? LandmarkIndex.leftWrist : LandmarkIndex.rightWrist];
    const elbowAngle = angleBetween(s, e, w);
    if (!Number.isFinite(elbowAngle)) continue;
    samples[side].push({
      wristRise: (s.y - w.y) / width,
      elbowRise: (s.y - e.y) / width,
      wristAboveElbow: (e.y - w.y) / width,
      elbowAngle,
    });
  }
}

const seconds = firstTimestamp === null ? 0 : (lastTimestamp - firstTimestamp) / 1000;

console.log(`\nReplayed ${frames} frames over ${seconds.toFixed(1)}s (${(frames / (seconds || 1)).toFixed(1)}/sec)`);
console.log(`from ${file}\n`);

if (events.length === 0) {
  console.log('  No gesture fired in this recording.');
} else {
  console.log(`  ${events.length} gesture(s) fired:`);
  for (const event of events) {
    const at = ((event.timestamp - (firstTimestamp ?? 0)) / 1000).toFixed(1);
    console.log(`    t+${at.padStart(6)}s  ${event.side} hand, held ${Math.round(event.heldMs)}ms`);
  }
}

const pct = (values: number[], p: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2).padStart(7) : '      -');

console.log('\n  Measurement spread (p50 / p95 / max), in shoulder widths except the angle:');
for (const side of ['left', 'right'] as const) {
  const rows = samples[side];
  if (rows.length === 0) continue;
  const col = (key: keyof Sample) => rows.map((r) => r[key]);
  console.log(`    ${side}`);
  console.log(
    `      wristRise       ${f(pct(col('wristRise'), 0.5))} ${f(pct(col('wristRise'), 0.95))} ${f(Math.max(...col('wristRise')))}   fires above ${GESTURE_THRESHOLDS.minWristRise}`
  );
  console.log(
    `      elbowRise       ${f(pct(col('elbowRise'), 0.5))} ${f(pct(col('elbowRise'), 0.95))} ${f(Math.max(...col('elbowRise')))}   blocks above ${GESTURE_THRESHOLDS.maxElbowRise}`
  );
  console.log(
    `      wristAboveElbow ${f(pct(col('wristAboveElbow'), 0.5))} ${f(pct(col('wristAboveElbow'), 0.95))} ${f(Math.max(...col('wristAboveElbow')))}   fires above ${GESTURE_THRESHOLDS.minWristAboveElbow}`
  );
  console.log(
    `      elbowAngle      ${f(pct(col('elbowAngle'), 0.05))} ${f(pct(col('elbowAngle'), 0.5))} ${f(Math.min(...col('elbowAngle')))}   blocks above ${GESTURE_THRESHOLDS.maxElbowAngleDeg} (p5 / p50 / min)`
  );
}
console.log('');

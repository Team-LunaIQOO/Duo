/**
 * Offline self-test for RepCounter — Person A.
 *
 * repCounter.ts had no test coverage before E4-E6 were added alongside E1/E3
 * (04-clinical-logic.md's original two plus three new ones), which is exactly
 * backwards: adding three new phase graphs to a state machine with no tests
 * is the point where a reversed transition or an inverted quality check goes
 * unnoticed until someone is standing in front of the loaner device. This
 * proves the geometry and phase transitions are wired correctly for all five
 * exercises. It proves nothing about the angle thresholds against a real
 * body — see 04-clinical-logic.md's calibration protocol for that.
 *
 * Run, from mobile/ (no package.json script — that file needs team
 * coordination before it changes):
 *
 *   npx tsc src/vision/selfTest.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/vision/selfTest.js
 */

import type { Landmark, PoseFrame } from '../types/contracts';
import { RepCounter, type Exercise } from './repCounter';
import { LandmarkIndex } from './landmarks';
import { VISION_THRESHOLDS } from './thresholds';

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

const P = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 1 });

/**
 * A seated body posed to produce a specific tracked-angle value for the
 * given exercise, on the left side, with everything else held at a neutral
 * resting pose. Coordinates are illustrative image-space positions, not
 * measured from a real person — only the angle/ratio implied by the
 * relative positions matters to RepCounter.
 */
function bodyForAngle(exercise: Exercise, degreesOrRatio: number): Landmark[] {
  const l: Landmark[] = Array.from({ length: 33 }, () => P(0.5, 0.5));
  l[LandmarkIndex.nose] = P(0.5, 0.2);
  l[LandmarkIndex.leftShoulder] = P(0.45, 0.35);
  l[LandmarkIndex.rightShoulder] = P(0.55, 0.35);
  l[LandmarkIndex.leftHip] = P(0.45, 0.6);
  l[LandmarkIndex.rightHip] = P(0.55, 0.6);

  const shoulder = l[LandmarkIndex.leftShoulder];
  const hip = l[LandmarkIndex.leftHip];

  if (exercise === 'shoulder_abduction') {
    // angleBetween(hip, shoulder, elbow): 0 deg = elbow directly below
    // shoulder (arm at rest, continuing the hip-shoulder line); 180 deg =
    // elbow directly above shoulder. Place the elbow on a circle around the
    // shoulder at the requested angle from the downward hip direction.
    const rad = (degreesOrRatio * Math.PI) / 180;
    const armLength = 0.15;
    // Downward direction from shoulder (toward hip) rotated by `rad`.
    const down = { x: hip.x - shoulder.x, y: hip.y - shoulder.y };
    const mag = Math.hypot(down.x, down.y);
    const ux = down.x / mag;
    const uy = down.y / mag;
    // Rotate (ux, uy) by rad.
    const ex = ux * Math.cos(rad) - uy * Math.sin(rad);
    const ey = ux * Math.sin(rad) + uy * Math.cos(rad);
    l[LandmarkIndex.leftElbow] = P(shoulder.x + ex * armLength, shoulder.y + ey * armLength);
    l[LandmarkIndex.leftWrist] = l[LandmarkIndex.leftElbow];
    return l;
  }

  if (exercise === 'horizontal_adduction') {
    // Not an angle: |wrist.x - shoulder.x| / shoulderWidth. shoulderWidth
    // here is 0.1 (0.55 - 0.45), so wrist.x offset = degreesOrRatio * 0.1.
    l[LandmarkIndex.leftElbow] = P(shoulder.x, shoulder.y + 0.1);
    l[LandmarkIndex.leftWrist] = P(shoulder.x - degreesOrRatio * 0.1, shoulder.y);
    return l;
  }

  // elbow_flexion and elbow_extension: angleBetween(shoulder, elbow, wrist),
  // laid out on a bent line at the given angle, 180 deg = straight.
  const elbow = P(shoulder.x, shoulder.y + 0.15);
  l[LandmarkIndex.leftElbow] = elbow;
  const rad = (degreesOrRatio * Math.PI) / 180;
  const forearmLength = 0.15;
  const bend = Math.PI - rad;
  const wx = elbow.x + Math.sin(bend) * forearmLength;
  const wy = elbow.y + Math.cos(bend) * forearmLength;
  const wrist = P(wx, wy);
  l[LandmarkIndex.leftWrist] = wrist;

  if (exercise === 'wrist_flexion') {
    // wrist_flexion tracks angleBetween(elbow, wrist, index), one joint
    // further out than elbow_flexion's triple, so the wrist itself is fixed
    // (straight forearm) and only the index landmark moves to vary the
    // angle. Rotating the wrist->elbow direction by exactly `rad` around the
    // wrist places the index point such that angleBetween(elbow, wrist,
    // index) equals degreesOrRatio directly.
    l[LandmarkIndex.leftWrist] = P(elbow.x, elbow.y + forearmLength);
    const fixedWrist = l[LandmarkIndex.leftWrist];
    const back = { x: elbow.x - fixedWrist.x, y: elbow.y - fixedWrist.y };
    const mag = Math.hypot(back.x, back.y);
    const ux = back.x / mag;
    const uy = back.y / mag;
    const ix = ux * Math.cos(rad) - uy * Math.sin(rad);
    const iy = ux * Math.sin(rad) + uy * Math.cos(rad);
    l[LandmarkIndex.leftIndex] = P(fixedWrist.x + ix * 0.05, fixedWrist.y + iy * 0.05);
  }

  return l;
}

function frame(landmarks: Landmark[], timestamp: number): PoseFrame {
  return { timestamp, landmarks, confidence: 1, inFrame: true };
}

/** Feeds a sequence of (angle, holdMs) steps, each held long enough to clear VISION_THRESHOLDS.holdMs. */
function feed(counter: RepCounter, exercise: Exercise, steps: number[]) {
  let t = 0;
  const events = [];
  for (const value of steps) {
    // Two samples per step: one to register the candidate transition, one
    // after holdMs to confirm it. Matches how real frames arrive continuously.
    for (let i = 0; i < 3; i++) {
      t += VISION_THRESHOLDS.holdMs / 2 + 10;
      const event = counter.update(frame(bodyForAngle(exercise, value), t));
      if (event) events.push(event);
    }
  }
  return events;
}

console.log('RepCounter self-test\n');

// ---------------------------------------------------------------------------
// 1. Existing exercises still behave — regression guard for the refactor
// ---------------------------------------------------------------------------
console.log('1. Existing exercises (regression guard)');
{
  const counter = new RepCounter('shoulder_abduction', 'left');
  const events = feed(counter, 'shoulder_abduction', [10, 90, 10]);
  check('shoulder_abduction: one clean rep counted', events.length === 1, `${events.length}`);
  check('shoulder_abduction: good quality at 90deg peak', events[0]?.quality === 'good');
}
{
  const counter = new RepCounter('elbow_flexion', 'left');
  const events = feed(counter, 'elbow_flexion', [170, 40, 170]);
  check('elbow_flexion: one clean rep counted', events.length === 1, `${events.length}`);
}

// ---------------------------------------------------------------------------
// 2. E4 elbow_extension: reversed phase graph relative to E3
// ---------------------------------------------------------------------------
console.log('\n2. E4 elbow_extension (reversed relative to E3)');
{
  const counter = new RepCounter('elbow_extension', 'left');
  // Starts FLEXED. A rep is FLEXED -> EXTENDED -> FLEXED: bend first, then
  // straighten, then relax back to bent, which is the opposite direction
  // E3's EXTENDED -> FLEXED -> EXTENDED takes on the same angle.
  const events = feed(counter, 'elbow_extension', [40, 170, 40]);
  check('elbow_extension: one clean rep counted', events.length === 1, `${events.length}`);
  check('elbow_extension: good quality when fully straightened', events[0]?.quality === 'good');
}
{
  // Never straightening past the flexed threshold must not count a rep —
  // same false-positive shape RUNNING.md's calibration protocol asks for.
  const counter = new RepCounter('elbow_extension', 'left');
  const events = feed(counter, 'elbow_extension', [40, 90, 40]);
  check('elbow_extension: a partial straighten does not complete a rep', events.length === 0, `${events.length}`);
}

// ---------------------------------------------------------------------------
// 3. E5 horizontal_adduction: not an angleBetween triple
// ---------------------------------------------------------------------------
console.log('\n3. E5 horizontal_adduction (wrist-to-shoulder ratio, not an angle)');
{
  const counter = new RepCounter('horizontal_adduction', 'left');
  // Starts OUT (arm out to the side). A rep is OUT -> IN -> OUT: sweep the
  // arm across the body, then back out.
  const events = feed(counter, 'horizontal_adduction', [0.7, 0.05, 0.7]);
  check('horizontal_adduction: one clean rep counted', events.length === 1, `${events.length}`);
  check('horizontal_adduction: good quality when wrist crosses close to centre', events[0]?.quality === 'good');
}
{
  const counter = new RepCounter('horizontal_adduction', 'left');
  const events = feed(counter, 'horizontal_adduction', [0.7, 0.4, 0.7]);
  check('horizontal_adduction: staying out to the side does not complete a rep', events.length === 0, `${events.length}`);
}

// ---------------------------------------------------------------------------
// 4. E6 wrist_flexion: EXPERIMENTAL, unvalidated landmarks
// ---------------------------------------------------------------------------
console.log('\n4. E6 wrist_flexion (EXPERIMENTAL — geometry only, not validated against a real hand)');
{
  const counter = new RepCounter('wrist_flexion', 'left');
  const events = feed(counter, 'wrist_flexion', [170, 100, 170]);
  check('wrist_flexion: one clean rep counted', events.length === 1, `${events.length}`);
}
{
  // The index-finger landmark this exercise depends on is exactly the one
  // landmarks.ts warns is unvalidated. Confirm the counter degrades safely
  // (no event, not a thrown error, not a phantom rep) when it is unusable.
  const counter = new RepCounter('wrist_flexion', 'left');
  const body = bodyForAngle('wrist_flexion', 170);
  body[LandmarkIndex.leftIndex] = { x: 0, y: 0, z: 0, visibility: 0 };
  let threw = false;
  let event = null;
  try {
    event = counter.update(frame(body, 100));
  } catch {
    threw = true;
  }
  check('wrist_flexion: low-visibility index landmark is skipped, not thrown', !threw && event === null);
}

// ---------------------------------------------------------------------------
// 5. Cross-cutting: compensation forces 'compensated' quality regardless of exercise
// ---------------------------------------------------------------------------
console.log('\n5. Compensation overrides quality for every exercise');
for (const exercise of ['shoulder_abduction', 'elbow_flexion', 'elbow_extension', 'horizontal_adduction', 'wrist_flexion'] as Exercise[]) {
  const counter = new RepCounter(exercise, 'left');
  const steps = exercise === 'elbow_extension' ? [40, 170, 40]
    : exercise === 'horizontal_adduction' ? [0.7, 0.05, 0.7]
    : exercise === 'shoulder_abduction' ? [10, 90, 10]
    : [170, 40, 170];
  let t = 0;
  let event = null;
  for (const value of steps) {
    for (let i = 0; i < 3; i++) {
      t += VISION_THRESHOLDS.holdMs / 2 + 10;
      const e = counter.update(frame(bodyForAngle(exercise, value), t), [
        { timestamp: t, type: 'forward_lean', severity: 'mild', sustainedMs: 500 },
      ]);
      if (e) event = e;
    }
  }
  check(`${exercise}: a sustained compensation marks the rep 'compensated'`, event?.quality === 'compensated');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);

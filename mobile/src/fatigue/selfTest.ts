/**
 * Offline self-test for the fatigue detector — Person C.
 *
 * Runs the detector against deterministic mock sessions and asserts the
 * behaviour we actually care about, then prints the per-rep ratio table in the
 * shape the Saturday calibration protocol asks for (04-clinical-logic.md,
 * "Calibration protocol", step 5).
 *
 * Run, from mobile/ (no package.json script — that file needs team
 * coordination before it changes, see the team working rules):
 *
 *   npx tsc src/fatigue/selfTest.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/fatigue/selfTest.js
 *
 * This proves the *logic* is wired correctly. It proves nothing about the
 * thresholds — the mock produces exactly the fatigue it is told to produce.
 * Real numbers come from the device.
 */

import { FatigueDetector } from './fatigueDetector';
import { generateMockSession, type MockOptions } from './mock/mockPoseSource';
import { DEFAULT_FATIGUE_THRESHOLDS } from './thresholds';
import type { FatigueSignal } from '../types/contracts';

/**
 * Declared locally rather than pulling in @types/node — adding a devDependency
 * touches package.json, which needs team coordination. This script is the only
 * thing in the repo that runs under Node.
 */
declare const process: { exit(code: number): void };

type Run = {
  signals: FatigueSignal[];
  finalLevel: FatigueSignal['level'];
  detector: FatigueDetector;
  rows: string[];
};

function runSession(overrides: Partial<MockOptions>, detector: FatigueDetector): Run {
  const events = generateMockSession(overrides);
  const signals: FatigueSignal[] = [];
  const rows: string[] = [];

  for (const e of events) {
    if (e.kind === 'frame') {
      detector.onPoseFrame(e.frame);
      continue;
    }

    const signal = detector.onRepEvent(e.rep);
    if (signal) signals.push(signal);

    const d = detector.debug;
    const f = (v: number) => (Number.isFinite(v) ? v.toFixed(3).padStart(7) : '      -');
    rows.push(
      `  rep ${String(e.rep.repNumber).padStart(2)} ` +
        `peak ${e.rep.peakAngle.toFixed(1).padStart(5)}deg ` +
        `dur ${Math.round(e.rep.durationMs).toString().padStart(5)}ms | ` +
        `rom ${f(d.romRatio)} time ${f(d.durationRatio)} inst ${f(d.instabilityRatio)} | ` +
        `fired ${d.firedCount} -> ${d.level}${signal ? '  <-- emitted' : ''}`
    );
  }

  return { signals, finalLevel: detector.level, detector, rows };
}

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

console.log('Fatigue detector self-test');
console.log(
  `Thresholds (ALL TUNE, unvalidated): rom<${DEFAULT_FATIGUE_THRESHOLDS.romDecayRatio} ` +
    `dur>${DEFAULT_FATIGUE_THRESHOLDS.timingDriftRatio} ` +
    `inst>${DEFAULT_FATIGUE_THRESHOLDS.instabilityRatio} ` +
    `minReps=${DEFAULT_FATIGUE_THRESHOLDS.minRepsBeforeFatigue}`
);

// --- 1. A clean session must never fire. The false-positive check. ----------

section('1. Clean session, 12 reps, no simulated fatigue');
const clean = runSession(
  { repCount: 12, fatigueStartRep: 999, seed: 1 },
  new FatigueDetector({ workingSide: 'left', exercise: 'E1' })
);
clean.rows.forEach((r) => console.log(r));
check('never leaves level "none"', clean.finalLevel === 'none', `got ${clean.finalLevel}`);
check(
  'emits no fatigue signal at all',
  clean.signals.length === 0,
  `got ${clean.signals.length} signal(s)`
);

// --- 2. A fatiguing session must fire, and reach 'fatigued'. ---------------

section('2. Fatiguing session, 14 reps, decay from rep 7');
const tired = runSession(
  { repCount: 14, fatigueStartRep: 7, seed: 2 },
  new FatigueDetector({ workingSide: 'left', exercise: 'E1' })
);
tired.rows.forEach((r) => console.log(r));
check('reaches level "fatigued"', tired.finalLevel === 'fatigued', `got ${tired.finalLevel}`);
check('emits at least one signal', tired.signals.length > 0);
check(
  '"fatigued" is only reached with 2+ rules firing',
  tired.detector.debug.firedCount >= 2,
  `firedCount ${tired.detector.debug.firedCount}`
);
check(
  'ROM decay is the reported reason once ROM has dropped',
  tired.signals[tired.signals.length - 1].reason === 'rom_decay',
  tired.signals[tired.signals.length - 1].reason
);
console.log(
  `  signals: ${tired.signals
    .map((s) => `${s.level}/${s.reason}@${Math.round(s.timestamp)}ms`)
    .join(', ')}`
);

/*
 * NOTE FOR CALIBRATION AND FOR THE DEMO.
 *
 * This session goes straight from 'none' to 'fatigued' without ever passing
 * through 'slowing'. That is not a bug: the mock decays range, timing and
 * tremor at the same linear rate, so ROM and instability cross their
 * thresholds on the same rep and firedCount jumps 0 -> 2.
 *
 * It matters anyway, because 04-clinical-logic.md gives 'slowing' its own
 * response ("tone softens, offers rest") distinct from 'fatigued' ("offers to
 * end the session"), and 06-demo-and-pitch.md beat 5 reads better if Duo
 * softens before it offers to stop. Real fatigue is unlikely to be this
 * synchronised, but if 'slowing' turns out to be skipped on the device too,
 * separating the thresholds during calibration is the fix.
 *
 * Test 2b proves the intermediate state is reachable at all.
 */

section('2b. Gentle ROM-only decay must land on "slowing", not "fatigued"');
const slowing = runSession(
  {
    repCount: 14,
    fatigueStartRep: 7,
    romDecayPerRep: 0.04,
    durationGrowthPerRep: 0,
    tremorGrowthPerRep: 0,
    seed: 6,
  },
  new FatigueDetector({ workingSide: 'left', exercise: 'E1' })
);
check('reaches "slowing"', slowing.signals.some((s) => s.level === 'slowing'));
check(
  'does not overshoot to "fatigued"',
  slowing.signals.every((s) => s.level !== 'fatigued'),
  slowing.signals.map((s) => s.level).join(' -> ')
);
check(
  'exactly one rule fired',
  slowing.detector.debug.firedCount === 1,
  `firedCount ${slowing.detector.debug.firedCount}`
);
console.log(
  `  signals: ${slowing.signals
    .map((s) => `${s.level}/${s.reason}@${Math.round(s.timestamp)}ms`)
    .join(', ')}`
);

// --- 3. Nothing may fire before the minimum rep count. ---------------------

section('3. Short session (5 reps) must stay silent');
const short = runSession(
  { repCount: 5, fatigueStartRep: 1, romDecayPerRep: 0.2, seed: 3 },
  new FatigueDetector({ workingSide: 'left', exercise: 'E1' })
);
check('no signal below minRepsBeforeFatigue', short.signals.length === 0);
check('debug reports not-ready', !short.detector.debug.ready);

// --- 4. Unusable frames must be skipped, not fed in as zeroes. -------------

section('4. Low-confidence and out-of-frame handling');
const guarded = new FatigueDetector({ workingSide: 'left', exercise: 'E1' });
for (const e of generateMockSession({ repCount: 10, fatigueStartRep: 6, seed: 4 })) {
  if (e.kind === 'frame') {
    // Every third frame is unusable: half out of frame, half low confidence.
    const n = Math.round(e.frame.timestamp);
    if (n % 3 === 0) {
      guarded.onPoseFrame({ ...e.frame, inFrame: false });
      continue;
    }
    if (n % 7 === 0) {
      guarded.onPoseFrame({ ...e.frame, confidence: 0.1 });
      continue;
    }
    guarded.onPoseFrame(e.frame);
  } else {
    guarded.onRepEvent(e.rep);
  }
}
check('skipped frames were counted', guarded.debug.framesSkipped > 0, `${guarded.debug.framesSkipped}`);
check(
  'still produced a usable decision',
  guarded.debug.ready && Number.isFinite(guarded.debug.romRatio)
);

// --- 5. Signals must survive a totally blind session without NaN leaking. --

section('5. Fully blind session (no usable frames)');
const blind = new FatigueDetector({ workingSide: 'left', exercise: 'E1' });
for (const e of generateMockSession({ repCount: 12, fatigueStartRep: 7, seed: 5 })) {
  if (e.kind === 'frame') blind.onPoseFrame({ ...e.frame, inFrame: false });
  else blind.onRepEvent(e.rep);
}
check(
  'instability ratio is not-a-number, not a false positive',
  !Number.isFinite(blind.debug.instabilityRatio)
);
check('instability rule did not fire on unmeasurable data', !blind.debug.fired.instability);
check(
  'ROM and timing still work from RepEvent alone',
  blind.debug.ready && blind.level !== 'none',
  `level ${blind.level}`
);

// --- 6. reset() must actually clear the session. ---------------------------

section('6. reset()');
tired.detector.reset();
check('level returns to none', tired.detector.level === 'none');
check('rep records cleared', tired.detector.repRecords.length === 0);

// ---------------------------------------------------------------------------

console.log(
  `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`
);
if (failures > 0) process.exit(1);

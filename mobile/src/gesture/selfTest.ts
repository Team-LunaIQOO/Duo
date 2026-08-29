/**
 * Offline self-test for gesture pause — Person C.
 *
 * The point of this file is the false-positive check, which
 * 04-clinical-logic.md names as the step people skip: "Do 5 deliberately
 * sloppy but non-compensating reps. Confirm no compensation fires. This is the
 * false positive check and it is the one people skip." The same argument
 * applies harder here, because the demo exercise *is* raising an arm — so most
 * of what follows asserts that the detector stays silent, and only two cases
 * assert that it fires.
 *
 * Run, from mobile/ (no package.json script — that file needs team
 * coordination before it changes):
 *
 *   npx tsc src/gesture/selfTest.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/gesture/selfTest.js
 *
 * This proves the geometry and the debounce are wired correctly. It proves
 * nothing about the thresholds against a real body — the mock produces exactly
 * the posture it is told to produce. Real numbers come from the device, with
 * the dev overlay open. See RUNNING.md.
 */

import { GesturePauseDetector, type GestureEvent } from './gestureDetector';
import { GESTURE_THRESHOLDS } from './thresholds';
import {
  concat,
  curlSweep,
  LONG_BODY,
  raisedHand,
  repSweep,
  resting,
  TYPICAL_BODY,
  type BodyProportions,
  type Timeline,
} from './mock/mockGestures';

/**
 * Declared locally rather than pulling in @types/node — adding a devDependency
 * touches package.json, which needs team coordination.
 */
declare const process: { exit(code: number): void };

type Run = { events: GestureEvent[]; detector: GesturePauseDetector };

function run(timeline: Timeline, detector = new GesturePauseDetector()): Run {
  const events: GestureEvent[] = [];
  for (const { frame } of timeline) {
    const event = detector.update(frame);
    if (event) events.push(event);
  }
  return { events, detector };
}

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const BODIES: [string, BodyProportions][] = [
  ['typical limbs', TYPICAL_BODY],
  ['long limbs', LONG_BODY],
];

// ---------------------------------------------------------------------------
console.log('\n1. False positives: the demo exercise must never pause the session');
// ---------------------------------------------------------------------------

for (const [bodyName, body] of BODIES) {
  for (const side of ['left', 'right'] as const) {
    // A clean E1 set, arm straight, taken to a normal peak.
    const clean = run(repSweep({ side, body, repCount: 10, peakAbduction: 95 }));
    check(
      `clean abduction reps to 95deg (${side}, ${bodyName})`,
      clean.events.length === 0,
      `fired ${clean.events.length}`
    );

    // The same set taken well overhead. Straight-arm, so the elbow-angle test
    // is what has to hold here.
    const high = run(repSweep({ side, body, repCount: 10, peakAbduction: 150 }));
    check(
      `abduction reps to 150deg, arm overhead (${side}, ${bodyName})`,
      high.events.length === 0,
      `fired ${high.events.length}`
    );

    // The hard one: a tiring person bends the elbow and lets the arm drift
    // overhead. This is the shape that most resembles a raised hand.
    const sloppy = run(
      repSweep({ side, body, repCount: 10, peakAbduction: 130, elbowFlexionDeg: 120 })
    );
    check(
      `sloppy reps, elbow bent 120deg, arm overhead (${side}, ${bodyName})`,
      sloppy.events.length === 0,
      `fired ${sloppy.events.length}`
    );

    // Worse: the same sloppy rep, lingering at the top for most of a second,
    // which is exactly what a fatiguing person does.
    const lingering = run(
      repSweep({
        side,
        body,
        repCount: 8,
        peakAbduction: 130,
        elbowFlexionDeg: 120,
        pauseAtTopMs: 700,
      })
    );
    check(
      `sloppy reps pausing 700ms at the top (${side}, ${bodyName})`,
      lingering.events.length === 0,
      `fired ${lingering.events.length}`
    );

    // E3, the fallback exercise: the wrist comes up but finishes below the
    // shoulder, so the height test is what has to hold.
    const curls = run(curlSweep({ side, body, repCount: 10 }));
    check(
      `elbow flexion reps, E3 (${side}, ${bodyName})`,
      curls.events.length === 0,
      `fired ${curls.events.length}`
    );

    // Sitting still between sets.
    const idle = run(resting({ side, body, durationMs: 6000 }));
    check(
      `sitting at rest for 6s (${side}, ${bodyName})`,
      idle.events.length === 0,
      `fired ${idle.events.length}`
    );
  }
}

// Landmark noise on top of a clean set, at a level that would swamp any
// single-frame rule.
const noisy = run(
  repSweep({ side: 'left', repCount: 10, peakAbduction: 110, jitter: 0.012 })
);
check('clean reps with landmark jitter', noisy.events.length === 0, `fired ${noisy.events.length}`);

// A whole set of reps on one arm while the other rests, then the same on the
// other arm: nothing about switching arms mid-session may fire the gesture.
const bothArms = run(
  concat(
    repSweep({ side: 'left', repCount: 6, peakAbduction: 120 }),
    repSweep({ side: 'right', repCount: 6, peakAbduction: 120 })
  )
);
check('a full two-arm session', bothArms.events.length === 0, `fired ${bothArms.events.length}`);

// ---------------------------------------------------------------------------
console.log('\n2. True positives: a held raised hand must pause');
// ---------------------------------------------------------------------------

for (const [bodyName, body] of BODIES) {
  for (const side of ['left', 'right'] as const) {
    const gesture = run(raisedHand({ side, body, holdMs: 2000 }));
    check(
      `stop-hand held 2s fires exactly once (${side}, ${bodyName})`,
      gesture.events.length === 1,
      `fired ${gesture.events.length}`
    );
    check(
      `reports the raised side (${side}, ${bodyName})`,
      gesture.events[0]?.side === side,
      `got ${gesture.events[0]?.side}`
    );
  }
}

// A less extended version of the same gesture: upper arm lower, elbow closed
// further, hand beside the head rather than out to the side.
const besideHead = run(
  raisedHand({ side: 'left', holdMs: 2000, posture: { abductionDeg: 70, elbowFlexionDeg: 75 } })
);
check('hand held beside the head fires', besideHead.events.length === 1, `fired ${besideHead.events.length}`);

// The lower limit, asserted so it is a known property rather than a surprise.
// The forearm is shorter than the upper arm, so with the upper arm only 45
// degrees from the trunk the hand cannot clear the shoulder however far the
// elbow closes — there is no threshold that accepts this without also
// accepting a resting arm. The user has to get the hand above shoulder height.
// Touch remains the route that always works (02-product-spec.md).
const tooLow = run(
  raisedHand({ side: 'left', holdMs: 2500, posture: { abductionDeg: 45, elbowFlexionDeg: 60 } })
);
check(
  'a hand held below shoulder height does not fire (documented limit)',
  tooLow.events.length === 0,
  `fired ${tooLow.events.length}`
);

// With landmark noise.
const noisyGesture = run(raisedHand({ side: 'right', holdMs: 2000, jitter: 0.008 }));
check('stop-hand with landmark jitter fires', noisyGesture.events.length === 1, `fired ${noisyGesture.events.length}`);

// The person shifts in the chair while holding the gesture. Drift is measured
// relative to the shoulders, so this must not restart the hold.
const shifting = run(raisedHand({ side: 'left', holdMs: 2500, driftPerSecond: 0.04 }));
check('holding the gesture while shifting in the chair still fires', shifting.events.length === 1, `fired ${shifting.events.length}`);

// Raised for less than the hold window: too brief to be deliberate.
const brief = run(raisedHand({ side: 'left', holdMs: 300 }));
check('a hand raised only briefly does not fire', brief.events.length === 0, `fired ${brief.events.length}`);

// ---------------------------------------------------------------------------
console.log('\n3. Debounce: one gesture, one pause');
// ---------------------------------------------------------------------------

const heldLong = run(raisedHand({ side: 'left', holdMs: 8000 }));
check('a hand held for 8s fires once, not repeatedly', heldLong.events.length === 1, `fired ${heldLong.events.length}`);

const twiceQuick = run(
  concat(
    raisedHand({ side: 'left', holdMs: 1500 }),
    resting({ side: 'left', durationMs: 500 }),
    raisedHand({ side: 'left', holdMs: 1500 })
  )
);
check(
  'a second gesture inside the cooldown is suppressed',
  twiceQuick.events.length === 1,
  `fired ${twiceQuick.events.length}`
);

const twiceSpaced = run(
  concat(
    raisedHand({ side: 'left', holdMs: 1500 }),
    resting({ side: 'left', durationMs: 5000 }),
    raisedHand({ side: 'left', holdMs: 1500 })
  )
);
check(
  'raise, lower, raise again after the cooldown fires twice',
  twiceSpaced.events.length === 2,
  `fired ${twiceSpaced.events.length}`
);

// ---------------------------------------------------------------------------
console.log('\n4. Degraded input');
// ---------------------------------------------------------------------------

const invisible = run(
  raisedHand({ side: 'left', holdMs: 3000 }).map(({ at, frame }) => ({
    at,
    frame: {
      ...frame,
      landmarks: frame.landmarks.map((l) => ({ ...l, visibility: 0.2 })),
    },
  }))
);
check(
  'landmarks below the visibility floor never fire',
  invisible.events.length === 0,
  `fired ${invisible.events.length}`
);

// The app is backgrounded mid-hold and comes back with the hand still up. The
// hold it never observed must not count, so the gesture fires later than it
// otherwise would, but it does still fire.
const gapped = raisedHand({ side: 'left', holdMs: 4000 });
// Frames are dropped, not re-stamped: the timestamps either side of the hole
// are the real ones, so the detector sees a 1.3s silence exactly as it would
// on the device.
const withGap: Timeline = gapped.filter((_, i) => i < 14 || i > 40);
const gapRun = run(withGap);
check(
  'a frame gap does not complete a hold that was never observed',
  gapRun.events.length === 1,
  `fired ${gapRun.events.length}`
);

// A one-off truncated frame, as toPoseFrame would reject anyway — belt and
// braces, since the detector indexes landmarks directly.
const shortFrame = run([
  {
    at: 0,
    frame: { timestamp: 0, landmarks: [], confidence: 0, inFrame: false },
  },
]);
check('an empty landmark array does not throw', shortFrame.events.length === 0);

// ---------------------------------------------------------------------------
console.log('\n5. The documented residual false positive');
// ---------------------------------------------------------------------------

// A "goalpost" arm held deliberately still IS a raised hand, and fires. This is
// recorded as a known limitation in gestureDetector.ts rather than hidden: E1
// is performed with a straight arm, so reaching this posture means departing
// from the exercise and stopping there.
const goalpostHeld = run(
  raisedHand({ side: 'left', holdMs: 2000, posture: { abductionDeg: 90, elbowFlexionDeg: 90 } })
);
check(
  'a goalpost arm held still fires (known, documented)',
  goalpostHeld.events.length === 1,
  `fired ${goalpostHeld.events.length}`
);

// Passing through that same posture at rep speed does not, which is what makes
// the limitation tolerable.
const goalpostSwept = run(
  repSweep({ side: 'left', repCount: 10, peakAbduction: 90, elbowFlexionDeg: 90 })
);
check(
  'reps sweeping through the goalpost posture do not fire',
  goalpostSwept.events.length === 0,
  `fired ${goalpostSwept.events.length}`
);

// ---------------------------------------------------------------------------
console.log('\nThresholds in force (all TUNE, see src/gesture/thresholds.ts):');
for (const [key, value] of Object.entries(GESTURE_THRESHOLDS)) {
  console.log(`  ${key.padEnd(22)} ${value}`);
}

console.log(
  failures === 0
    ? '\nAll gesture self-tests passed.\n'
    : `\n${failures} gesture self-test(s) FAILED.\n`
);
if (failures > 0) process.exit(1);

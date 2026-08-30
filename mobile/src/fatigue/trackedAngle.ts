/**
 * Which angle the fatigue detector watches, per exercise.
 *
 * Fatigue signal 3 (instability) is "frame-to-frame variance in the tracked
 * angle during the rep" (04-clinical-logic.md). "The tracked angle" is
 * exercise-specific, so it is injectable rather than hardcoded — Person A's
 * rep counter tracks the same angles, and if their definition changes, only
 * this file needs to follow.
 */

import type { Landmark, PoseFrame } from '../types/contracts';
// Person A owns the shared geometry helpers (05-build-plan.md). Imported from
// the leaf files rather than '../vision', because vision/index.ts re-exports
// mediapipeAdapter, which pulls in the native module and would break the
// Node-runnable self-tests.
import { angleBetween, shoulderWidth } from '../vision/geometry';
import { LandmarkIndex as LM } from '../vision/landmarks';

/** The exercises defined in 04-clinical-logic.md, plus E4-E6. */
export type TrackedExercise = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6';

/** Which physical side is doing the work this rep. */
export type WorkingSide = 'left' | 'right';

/**
 * Extracts the tracked angle from a frame, in degrees.
 * Returns NaN when the angle cannot be trusted — callers must skip, not
 * substitute zero.
 */
export type TrackedAngleFn = (frame: PoseFrame, side: WorkingSide) => number;

function visible(landmarks: Landmark[], idx: number, minVisibility: number): boolean {
  const lm = landmarks[idx];
  return lm != null && lm.visibility >= minVisibility;
}

/**
 * Builds the angle extractor for an exercise. Must track the same value
 * repCounter.ts's metric() does for that exercise, or the instability signal
 * would be measuring something other than what the reps were counted on.
 *
 * E1 (shoulder abduction):      angleBetween(hip, shoulder, elbow)
 * E2 (shoulder flexion):        same three points; 04-clinical-logic.md notes
 *                                this is weak from a front camera and may be
 *                                cut.
 * E3 (elbow flexion):           angleBetween(shoulder, elbow, wrist)
 * E4 (elbow extension):         same angle as E3, opposite rep direction —
 *                                instability is measured the same way either
 *                                direction, so E4 shares E3's extractor.
 * E5 (horizontal adduction):    |wrist.x - shoulder.x| / shoulderWidth, not
 *                                an angle — see repCounter.ts's metric().
 * E6 (wrist flexion, EXPERIMENTAL): angleBetween(elbow, wrist, index).
 */
export function trackedAngleFor(
  exercise: TrackedExercise,
  minVisibility: number
): TrackedAngleFn {
  return (frame, side) => {
    const l = frame.landmarks;
    if (!l || l.length < 33) return NaN;

    const shoulder = side === 'left' ? LM.leftShoulder : LM.rightShoulder;
    const elbow = side === 'left' ? LM.leftElbow : LM.rightElbow;
    const wrist = side === 'left' ? LM.leftWrist : LM.rightWrist;
    const hip = side === 'left' ? LM.leftHip : LM.rightHip;
    const indexFinger = side === 'left' ? LM.leftIndex : LM.rightIndex;

    if (exercise === 'E5') {
      if (!visible(l, shoulder, minVisibility) || !visible(l, wrist, minVisibility)) return NaN;
      const width = shoulderWidth(l);
      if (!Number.isFinite(width) || width <= 0) return NaN;
      return Math.abs(l[wrist].x - l[shoulder].x) / width;
    }

    if (exercise === 'E6') {
      const idx: [number, number, number] = [elbow, wrist, indexFinger];
      if (!idx.every((i) => visible(l, i, minVisibility))) return NaN;
      return angleBetween(l[idx[0]], l[idx[1]], l[idx[2]]);
    }

    const idx: [number, number, number] =
      exercise === 'E3' || exercise === 'E4' ? [shoulder, elbow, wrist] : [hip, shoulder, elbow];

    for (const i of idx) {
      if (!visible(l, i, minVisibility)) return NaN;
    }

    return angleBetween(l[idx[0]], l[idx[1]], l[idx[2]]);
  };
}

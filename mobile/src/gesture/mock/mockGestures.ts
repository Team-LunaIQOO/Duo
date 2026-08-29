/**
 * Geometric pose builder for the gesture self-test.
 *
 * Deliberately separate from src/fatigue/mock/mockPoseSource.ts, which builds
 * a straight arm only: the whole difficulty of gesture pause is telling a
 * raised hand apart from a *bent-arm* rep, so the test harness has to be able
 * to construct the bent shapes. Each arm is described by two independent
 * numbers, which is enough to reach every posture that matters here:
 *
 *   abductionDeg     - angle of the upper arm away from the trunk.
 *                      0 = hanging down, 90 = horizontal, 180 = straight up.
 *   elbowFlexionDeg  - interior angle at the elbow (11-13-15).
 *                      180 = straight arm, 90 = right angle.
 *
 * Landmarks are placed so those two numbers come out of the geometry rather
 * than being fed to the detector directly — the detector measures the pose the
 * same way it measures a real one. Same rule as the fatigue mock: no threshold
 * may ever be tuned against this file, because it produces exactly the shape it
 * is told to produce.
 *
 * Limb lengths are configurable in shoulder widths, and the self-test runs
 * every case at two body proportions. Real anthropometry puts the upper arm at
 * roughly 0.85 shoulder widths and shoulder-to-wrist at about 1.5; the fatigue
 * mock uses noticeably longer limbs. A threshold that only holds for one of
 * those is not a threshold, it is a coincidence.
 */

import type { Landmark, PoseFrame } from '../../types/contracts';
import { LandmarkIndex as LM } from '../../vision/landmarks';

export type ArmPose = {
  /** Upper arm away from the trunk: 0 hanging down, 90 horizontal, 180 straight up. */
  abductionDeg: number;
  /** Interior angle at the elbow. 180 is a straight arm. */
  elbowFlexionDeg: number;
};

export type BodyProportions = {
  /** Shoulder-to-elbow length, in shoulder widths. */
  upperArm: number;
  /** Elbow-to-wrist length, in shoulder widths. */
  forearm: number;
};

/** Adult seated proportions: upper arm ~0.85 shoulder widths, forearm ~0.66. */
export const TYPICAL_BODY: BodyProportions = { upperArm: 0.85, forearm: 0.66 };

/** The longer limbs the fatigue mock uses, to check the thresholds are not fitted to one body. */
export const LONG_BODY: BodyProportions = { upperArm: 1.0, forearm: 0.94 };

const REST: ArmPose = { abductionDeg: 8, elbowFlexionDeg: 172 };

export type PoseOptions = {
  left: ArmPose;
  right: ArmPose;
  body?: BodyProportions;
  /** Uniform jitter added to every used landmark, in normalised image units. */
  jitter?: number;
  /** Visibility stamped on the nine landmarks the analysis modules read. */
  visibility?: number;
  /** Whole-body horizontal offset, for the "person shifts in the chair" case. */
  offsetX?: number;
};

const lm = (x: number, y: number, z = 0, visibility = 0.95): Landmark => ({ x, y, z, visibility });

/** Deterministic PRNG (mulberry32), same as the fatigue mock — reproducible runs matter. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHOULDER_Y = 0.4;
const LEFT_SHOULDER_X = 0.42;
const RIGHT_SHOULDER_X = 0.58;
const HIP_Y = 0.72;
const LEFT_HIP_X = 0.45;
const RIGHT_HIP_X = 0.55;
const WIDTH = RIGHT_SHOULDER_X - LEFT_SHOULDER_X;

/**
 * Builds a 33-landmark pose from two arm descriptions.
 *
 * The nine landmarks 04-clinical-logic.md uses are placed precisely; the rest
 * are plausible low-visibility filler, so any code reading them without
 * checking visibility is consuming points the mock declares untrustworthy.
 */
export function buildPose(options: PoseOptions): Landmark[] {
  const body = options.body ?? TYPICAL_BODY;
  const jitter = options.jitter ?? 0;
  const visibility = options.visibility ?? 0.95;
  const dx = options.offsetX ?? 0;
  const noise = rng(Math.round((options.left.abductionDeg + options.right.elbowFlexionDeg) * 1000) + 7);
  const j = () => (jitter === 0 ? 0 : (noise() - 0.5) * 2 * jitter);

  const FILLER_VIS = 0.35;
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => lm(0.5 + dx, 0.5, 0, FILLER_VIS));

  landmarks[LM.nose] = lm(0.5 + dx, 0.25, 0, visibility);
  landmarks[LM.leftShoulder] = lm(LEFT_SHOULDER_X + dx + j(), SHOULDER_Y + j(), 0, visibility);
  landmarks[LM.rightShoulder] = lm(RIGHT_SHOULDER_X + dx + j(), SHOULDER_Y + j(), 0, visibility);
  landmarks[LM.leftHip] = lm(LEFT_HIP_X + dx, HIP_Y, 0, visibility);
  landmarks[LM.rightHip] = lm(RIGHT_HIP_X + dx, HIP_Y, 0, visibility);

  for (const side of ['left', 'right'] as const) {
    const shoulderX = (side === 'left' ? LEFT_SHOULDER_X : RIGHT_SHOULDER_X) + dx;
    // The person faces the camera; each arm swings away from the midline.
    // Which image side that is does not matter to the detector, which is
    // side-symmetric, but keeping the fatigue mock's convention avoids two
    // mocks that disagree about the same body.
    const lateral = side === 'left' ? -1 : 1;
    const arm = side === 'left' ? options.left : options.right;

    // Angles measured from the downward trunk axis. y grows downward in image
    // space, so "down" is +y and cos(theta) carries the sign correctly.
    const theta = (arm.abductionDeg * Math.PI) / 180;
    const elbowX = shoulderX + lateral * Math.sin(theta) * body.upperArm * WIDTH;
    const elbowY = SHOULDER_Y + Math.cos(theta) * body.upperArm * WIDTH;

    // Rotating the forearm a further (180 - flexion) degrees in the same sense
    // makes the interior angle at the elbow exactly elbowFlexionDeg.
    const phi = ((arm.abductionDeg + 180 - arm.elbowFlexionDeg) * Math.PI) / 180;
    const wristX = elbowX + lateral * Math.sin(phi) * body.forearm * WIDTH;
    const wristY = elbowY + Math.cos(phi) * body.forearm * WIDTH;

    if (side === 'left') {
      landmarks[LM.leftElbow] = lm(elbowX + j(), elbowY + j(), 0, visibility);
      landmarks[LM.leftWrist] = lm(wristX + j(), wristY + j(), 0, visibility);
    } else {
      landmarks[LM.rightElbow] = lm(elbowX + j(), elbowY + j(), 0, visibility);
      landmarks[LM.rightWrist] = lm(wristX + j(), wristY + j(), 0, visibility);
    }
  }

  return landmarks;
}

export function poseFrame(timestamp: number, options: PoseOptions): PoseFrame {
  const landmarks = buildPose(options);
  const visible = landmarks.filter((l) => l.visibility >= 0.5).length;
  const confidence = visible / landmarks.length;
  return { timestamp, landmarks, confidence, inFrame: confidence >= 0.5 };
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

export type Timeline = { at: number; frame: PoseFrame }[];

export type SweepOptions = {
  /** The working arm. The other one rests by the trunk. */
  side: 'left' | 'right';
  fps?: number;
  body?: BodyProportions;
  jitter?: number;
  /** Frames per second is fixed; this is the wall-clock start of the timeline. */
  startAt?: number;
};

function frameAt(
  t: number,
  side: 'left' | 'right',
  arm: ArmPose,
  o: { body?: BodyProportions; jitter?: number }
): { at: number; frame: PoseFrame } {
  const left = side === 'left' ? arm : REST;
  const right = side === 'right' ? arm : REST;
  return { at: t, frame: poseFrame(t, { left, right, body: o.body, jitter: o.jitter }) };
}

/**
 * A run of reps: the arm sweeps up to `peakAbduction` and back down, holding
 * `elbowFlexionDeg` throughout, `repCount` times.
 *
 * `pauseAtTopMs` exists for the honest version of the false-positive check: a
 * rep that lingers at the top is a much harder case than one that turns around
 * immediately, and it is exactly what a tiring person does.
 */
export function repSweep(
  o: SweepOptions & {
    repCount: number;
    peakAbduction: number;
    restAbduction?: number;
    elbowFlexionDeg?: number;
    repDurationMs?: number;
    pauseAtTopMs?: number;
    restBetweenRepsMs?: number;
  }
): Timeline {
  const fps = o.fps ?? 20;
  const step = 1000 / fps;
  const rest = o.restAbduction ?? 10;
  const flexion = o.elbowFlexionDeg ?? 172;
  const duration = o.repDurationMs ?? 2400;
  const pauseTop = o.pauseAtTopMs ?? 0;
  const between = o.restBetweenRepsMs ?? 600;

  const out: Timeline = [];
  let t = o.startAt ?? 0;

  for (let rep = 0; rep < o.repCount; rep++) {
    const half = duration / 2;
    for (let elapsed = 0; elapsed < half; elapsed += step) {
      const p = elapsed / half;
      out.push(frameAt(t, o.side, { abductionDeg: rest + (o.peakAbduction - rest) * p, elbowFlexionDeg: flexion }, o));
      t += step;
    }
    for (let elapsed = 0; elapsed < pauseTop; elapsed += step) {
      out.push(frameAt(t, o.side, { abductionDeg: o.peakAbduction, elbowFlexionDeg: flexion }, o));
      t += step;
    }
    for (let elapsed = 0; elapsed < half; elapsed += step) {
      const p = elapsed / half;
      out.push(frameAt(t, o.side, { abductionDeg: o.peakAbduction - (o.peakAbduction - rest) * p, elbowFlexionDeg: flexion }, o));
      t += step;
    }
    for (let elapsed = 0; elapsed < between; elapsed += step) {
      out.push(frameAt(t, o.side, { abductionDeg: rest, elbowFlexionDeg: flexion }, o));
      t += step;
    }
  }

  return out;
}

/** E3 elbow flexion: upper arm stays by the trunk, the elbow bends and straightens. */
export function curlSweep(
  o: SweepOptions & { repCount: number; repDurationMs?: number; restBetweenRepsMs?: number }
): Timeline {
  const fps = o.fps ?? 20;
  const step = 1000 / fps;
  const duration = o.repDurationMs ?? 2000;
  const between = o.restBetweenRepsMs ?? 500;
  const out: Timeline = [];
  let t = o.startAt ?? 0;

  for (let rep = 0; rep < o.repCount; rep++) {
    const half = duration / 2;
    for (let elapsed = 0; elapsed < half; elapsed += step) {
      const p = elapsed / half;
      out.push(frameAt(t, o.side, { abductionDeg: 10, elbowFlexionDeg: 170 - 120 * p }, o));
      t += step;
    }
    for (let elapsed = 0; elapsed < half; elapsed += step) {
      const p = elapsed / half;
      out.push(frameAt(t, o.side, { abductionDeg: 10, elbowFlexionDeg: 50 + 120 * p }, o));
      t += step;
    }
    for (let elapsed = 0; elapsed < between; elapsed += step) {
      out.push(frameAt(t, o.side, { abductionDeg: 10, elbowFlexionDeg: 170 }, o));
      t += step;
    }
  }

  return out;
}

/**
 * The gesture itself: the arm comes up over `raiseMs`, holds for `holdMs`, and
 * drops again over `raiseMs`.
 *
 * The default held posture is a stop-hand — upper arm at 80 degrees, elbow at a
 * right angle, forearm vertical.
 */
export function raisedHand(
  o: SweepOptions & {
    holdMs: number;
    raiseMs?: number;
    lowerMs?: number;
    posture?: ArmPose;
    /** Slow wander of the held hand, in normalised units per second. */
    driftPerSecond?: number;
  }
): Timeline {
  const fps = o.fps ?? 20;
  const step = 1000 / fps;
  const raise = o.raiseMs ?? 600;
  const lower = o.lowerMs ?? 600;
  const posture = o.posture ?? { abductionDeg: 80, elbowFlexionDeg: 90 };
  const out: Timeline = [];
  let t = o.startAt ?? 0;

  for (let elapsed = 0; elapsed < raise; elapsed += step) {
    const p = elapsed / raise;
    out.push(
      frameAt(
        t,
        o.side,
        {
          abductionDeg: REST.abductionDeg + (posture.abductionDeg - REST.abductionDeg) * p,
          elbowFlexionDeg: REST.elbowFlexionDeg + (posture.elbowFlexionDeg - REST.elbowFlexionDeg) * p,
        },
        o
      )
    );
    t += step;
  }

  const heldStart = t;
  for (let elapsed = 0; elapsed < o.holdMs; elapsed += step) {
    const wander = ((t - heldStart) / 1000) * (o.driftPerSecond ?? 0);
    const left = o.side === 'left' ? posture : REST;
    const right = o.side === 'right' ? posture : REST;
    out.push({
      at: t,
      frame: poseFrame(t, { left, right, body: o.body, jitter: o.jitter, offsetX: wander }),
    });
    t += step;
  }

  for (let elapsed = 0; elapsed < lower; elapsed += step) {
    const p = elapsed / lower;
    out.push(
      frameAt(
        t,
        o.side,
        {
          abductionDeg: posture.abductionDeg + (REST.abductionDeg - posture.abductionDeg) * p,
          elbowFlexionDeg: posture.elbowFlexionDeg + (REST.elbowFlexionDeg - posture.elbowFlexionDeg) * p,
        },
        o
      )
    );
    t += step;
  }

  return out;
}

/** Arms at rest by the trunk, for the gaps between other timelines. */
export function resting(o: SweepOptions & { durationMs: number }): Timeline {
  const fps = o.fps ?? 20;
  const step = 1000 / fps;
  const out: Timeline = [];
  let t = o.startAt ?? 0;
  for (let elapsed = 0; elapsed < o.durationMs; elapsed += step) {
    out.push(frameAt(t, o.side, REST, o));
    t += step;
  }
  return out;
}

/** Joins timelines end to end, re-stamping timestamps so they run continuously. */
export function concat(...parts: Timeline[]): Timeline {
  const out: Timeline = [];
  let offset = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    const base = part[0].at;
    for (const entry of part) {
      const at = offset + (entry.at - base);
      out.push({ at, frame: { ...entry.frame, timestamp: at } });
    }
    offset = out[out.length - 1].at + 50;
  }
  return out;
}

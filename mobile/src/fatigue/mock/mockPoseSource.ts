/**
 * Mock PoseFrame / RepEvent generator — Person C's private test harness.
 *
 * This exists so fatigue detection and the laptop stream can be built and
 * tested without Person A's vision module and without the loaner device (which
 * is shared — see 05-build-plan.md). It is NOT a stand-in for real calibration
 * and no threshold may be tuned against it: it produces exactly the fatigue it
 * was told to produce, so tuning against it would only prove the mock works.
 *
 * Not exported outside src/fatigue/ and src/streaming/. Person A and Person B
 * have their own mocks; this one does not touch them.
 *
 * Simulates E1 shoulder abduction (the recommended demo exercise) by placing
 * landmarks such that angleBetween(hip, shoulder, elbow) equals the intended
 * angle by construction — so the detector sees geometry, not a fed-in number.
 */

import type { Landmark, PoseFrame, RepEvent } from '../../types/contracts';
import { LandmarkIndex as LM } from '../../vision/landmarks';
import type { WorkingSide } from '../trackedAngle';

export type MockOptions = {
  /** Frames per second of the simulated PoseFrame stream. */
  fps: number;
  /** Total reps to generate. */
  repCount: number;
  /** Side doing the work. */
  side: WorkingSide;
  /** Clinical label attached to the generated RepEvents. */
  repSide: RepEvent['side'];

  /** Peak angle of a fresh, unfatigued rep, in degrees. */
  startPeakAngle: number;
  /** Resting angle at the bottom of a rep, in degrees. */
  restAngle: number;
  /** Duration of a fresh rep, in ms. */
  startDurationMs: number;
  /** Pause between reps, in ms. */
  restBetweenRepsMs: number;

  /**
   * Rep number (1-based) at which simulated fatigue begins. Set beyond
   * repCount for a clean session that should never trigger the detector.
   */
  fatigueStartRep: number;
  /** Fraction of peak angle lost per rep after fatigue onset. */
  romDecayPerRep: number;
  /** Fraction of duration gained per rep after fatigue onset. */
  durationGrowthPerRep: number;
  /** Tremor amplitude in degrees, added per rep after fatigue onset. */
  tremorGrowthPerRep: number;

  /** Baseline tremor in degrees, present even when fresh. */
  baseTremorDeg: number;
  /** Overall detection confidence reported on every frame. */
  confidence: number;
  /** Seed for the deterministic noise source. */
  seed: number;
};

export const DEFAULT_MOCK_OPTIONS: MockOptions = {
  fps: 25,
  repCount: 12,
  side: 'left',
  repSide: 'affected',

  startPeakAngle: 95,
  restAngle: 12,
  startDurationMs: 2400,
  restBetweenRepsMs: 600,

  fatigueStartRep: 7,
  romDecayPerRep: 0.06,
  durationGrowthPerRep: 0.1,
  tremorGrowthPerRep: 0.9,

  baseTremorDeg: 0.35,
  confidence: 0.92,
  seed: 20260829,
};

/** Deterministic PRNG (mulberry32) — reproducible runs matter for debugging. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 1x1 JPEG. Enough to prove the FrameMessage path end to end — the viewer
 * decodes and draws a real image — without encoding anything on device.
 * Real frames arrive in step 6, from Person A's camera pipeline.
 */
export const MOCK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
  'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
  'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk' +
  '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

// ---------------------------------------------------------------------------
// Landmark construction
// ---------------------------------------------------------------------------

const lm = (x: number, y: number, z = 0, visibility = 0.95): Landmark => ({
  x,
  y,
  z,
  visibility,
});

/**
 * Builds a 33-landmark pose whose hip-shoulder-elbow angle on the working side
 * is exactly `angleDeg`.
 *
 * The nine landmarks 04-clinical-logic.md actually uses are placed precisely.
 * The remaining 24 are placed at anatomically plausible positions but marked
 * LOW VISIBILITY, which serves both purposes at once: the laptop viewer draws
 * a recognisable full skeleton against mock data, while any *analysis* code
 * that reads them without checking `visibility` is still consuming landmarks
 * the mock explicitly declares untrustworthy.
 */
export function buildPoseLandmarks(angleDeg: number, side: WorkingSide): Landmark[] {
  const FILLER_VIS = 0.35;
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => lm(0.5, 0.5, 0, FILLER_VIS));

  const shoulderY = 0.4;
  const hipY = 0.72;
  const leftShoulderX = 0.42;
  const rightShoulderX = 0.58;
  const leftHipX = 0.45;
  const rightHipX = 0.55;

  landmarks[LM.nose] = lm(0.5, 0.25);
  landmarks[LM.leftShoulder] = lm(leftShoulderX, shoulderY);
  landmarks[LM.rightShoulder] = lm(rightShoulderX, shoulderY);
  landmarks[LM.leftHip] = lm(leftHipX, hipY);
  landmarks[LM.rightHip] = lm(rightHipX, hipY);

  // Face (1-10) and legs (25-32): plausible, low-visibility filler so the
  // viewer has a full skeleton to draw. Seated exercise, so the legs go
  // forward and down only a short way. Not used by any analysis.
  const face: [number, number, number][] = [
    [1, 0.485, 0.24], [2, 0.478, 0.24], [3, 0.471, 0.24],
    [4, 0.515, 0.24], [5, 0.522, 0.24], [6, 0.529, 0.24],
    [7, 0.458, 0.25], [8, 0.542, 0.25],
    [9, 0.489, 0.275], [10, 0.511, 0.275],
  ];
  for (const [i, x, y] of face) landmarks[i] = lm(x, y, 0, FILLER_VIS);

  const legs: [number, number, number][] = [
    [25, 0.44, 0.86], [26, 0.56, 0.86], // knees
    [27, 0.43, 0.97], [28, 0.57, 0.97], // ankles
    [29, 0.43, 0.99], [30, 0.57, 0.99], // heels
    [31, 0.41, 0.99], [32, 0.59, 0.99], // foot index
  ];
  for (const [i, x, y] of legs) landmarks[i] = lm(x, y, 0, FILLER_VIS);

  const upperArm = 0.16;
  const forearm = 0.15;

  for (const s of ['left', 'right'] as const) {
    const sx = s === 'left' ? leftShoulderX : rightShoulderX;
    const hx = s === 'left' ? leftHipX : rightHipX;

    // Unit vector shoulder -> hip. Rotating this by the tracked angle puts the
    // elbow exactly `angleDeg` away from the trunk, which is the definition of
    // angleBetween(hip, shoulder, elbow).
    const dx = hx - sx;
    const dy = hipY - shoulderY;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;

    // The working arm abducts; the resting arm stays near the trunk. Sign
    // chosen so the elbow swings away from the body midline on each side.
    const theta = ((s === side ? angleDeg : 8) * Math.PI) / 180;
    const dir = s === 'left' ? 1 : -1;
    const c = Math.cos(theta);
    const sn = Math.sin(theta) * dir;

    const rx = ux * c - uy * sn;
    const ry = ux * sn + uy * c;

    const ex = sx + rx * upperArm;
    const ey = shoulderY + ry * upperArm;
    const wx = sx + rx * (upperArm + forearm);
    const wy = shoulderY + ry * (upperArm + forearm);

    // Hand points (pinky/index/thumb) trail just past the wrist along the arm
    // direction, so the viewer's hand stubs point the right way as the arm
    // rotates. Low visibility: filler, like the face and legs.
    const handAt = (scale: number, spread: number) =>
      lm(
        sx + rx * (upperArm + forearm + scale) - ry * spread,
        shoulderY + ry * (upperArm + forearm + scale) + rx * spread,
        0,
        FILLER_VIS
      );

    if (s === 'left') {
      landmarks[LM.leftElbow] = lm(ex, ey);
      landmarks[LM.leftWrist] = lm(wx, wy);
      landmarks[17] = handAt(0.035, 0.012); // left pinky
      landmarks[19] = handAt(0.04, -0.006); // left index
      landmarks[21] = handAt(0.022, -0.016); // left thumb
    } else {
      landmarks[LM.rightElbow] = lm(ex, ey);
      landmarks[LM.rightWrist] = lm(wx, wy);
      landmarks[18] = handAt(0.035, 0.012); // right pinky
      landmarks[20] = handAt(0.04, -0.006); // right index
      landmarks[22] = handAt(0.022, -0.016); // right thumb
    }
  }

  return landmarks;
}

// ---------------------------------------------------------------------------
// Session generation
// ---------------------------------------------------------------------------

/** One entry in the simulated timeline. */
export type MockEvent =
  | { at: number; kind: 'frame'; frame: PoseFrame }
  | { at: number; kind: 'rep'; rep: RepEvent };

/**
 * Generates a whole session up front, deterministically, with no timers.
 *
 * This is the form to use in tests: same seed, same numbers, every run.
 */
export function generateMockSession(overrides: Partial<MockOptions> = {}): MockEvent[] {
  const o: MockOptions = { ...DEFAULT_MOCK_OPTIONS, ...overrides };
  const noise = rng(o.seed);
  const events: MockEvent[] = [];
  const frameIntervalMs = 1000 / o.fps;

  let t = 0;

  for (let repNumber = 1; repNumber <= o.repCount; repNumber++) {
    const fatigueReps = Math.max(0, repNumber - o.fatigueStartRep + 1);

    const peakAngle = Math.max(
      o.restAngle + 5,
      o.startPeakAngle * (1 - o.romDecayPerRep * fatigueReps)
    );
    const durationMs = o.startDurationMs * (1 + o.durationGrowthPerRep * fatigueReps);
    const tremor = o.baseTremorDeg + o.tremorGrowthPerRep * fatigueReps;

    const repStart = t;
    const sampleCount = Math.max(2, Math.round(durationMs / frameIntervalMs));

    for (let i = 0; i <= sampleCount; i++) {
      const phase = i / sampleCount;
      // Full up-and-down excursion across the rep.
      const smooth = (1 - Math.cos(2 * Math.PI * phase)) / 2;
      const clean = o.restAngle + (peakAngle - o.restAngle) * smooth;
      // Centred noise, so tremor adds jerkiness without shifting the mean.
      const angle = clean + (noise() - 0.5) * 2 * tremor;

      const at = repStart + phase * durationMs;
      events.push({
        at,
        kind: 'frame',
        frame: {
          timestamp: at,
          landmarks: buildPoseLandmarks(angle, o.side),
          confidence: o.confidence,
          inFrame: true,
        },
      });
    }

    const repEnd = repStart + durationMs;
    events.push({
      at: repEnd,
      kind: 'rep',
      rep: {
        timestamp: repEnd,
        repNumber,
        side: o.repSide,
        peakAngle,
        durationMs,
        quality: peakAngle >= 80 ? 'good' : 'partial',
      },
    });

    t = repEnd + o.restBetweenRepsMs;
  }

  return events.sort((a, b) => a.at - b.at);
}

export type MockHandlers = {
  onPoseFrame?: (frame: PoseFrame) => void;
  onRepEvent?: (rep: RepEvent) => void;
  onComplete?: () => void;
};

/**
 * Plays a generated session back in real time, so the streaming module can be
 * driven at realistic rates. Returns a stop function.
 *
 * Uses a single timer that walks the pre-generated timeline rather than one
 * timer per stream, so frame and rep ordering is exactly what the deterministic
 * generator produced.
 */
export function startMockPoseSource(
  handlers: MockHandlers,
  overrides: Partial<MockOptions> = {}
): () => void {
  const events = generateMockSession(overrides);
  const startedAt = Date.now();
  let cursor = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const elapsed = Date.now() - startedAt;

    while (cursor < events.length && events[cursor].at <= elapsed) {
      const e = events[cursor++];
      if (e.kind === 'frame') handlers.onPoseFrame?.(e.frame);
      else handlers.onRepEvent?.(e.rep);
    }

    if (cursor >= events.length) {
      stopped = true;
      clearInterval(timer);
      handlers.onComplete?.();
    }
  };

  const timer = setInterval(tick, 20);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

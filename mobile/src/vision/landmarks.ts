import type { Landmark, PoseFrame } from '../types/contracts';

export const LANDMARK_COUNT = 33;

export const LandmarkIndex = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  /**
   * BlazePose's hand-adjacent points, present in the raw 33-point array but
   * unused by any exercise until E6 (wrist flexion). 04-clinical-logic.md
   * only documents landmarks 0-24 and warns that front-camera 2D pose is
   * weak at depth; these are lower-confidence still, since they are near the
   * edge of what the body-pose model resolves rather than a tracked hand
   * joint. E6 is marked experimental for exactly this reason — verify on
   * the loaner device before trusting it in a demo.
   */
  leftIndex: 19,
  rightIndex: 20,
} as const;

type RawLandmark = {
  x?: unknown;
  y?: unknown;
  z?: unknown;
  visibility?: unknown;
  presence?: unknown;
};

export type MirrorMode = 'none' | 'horizontal';

const finite = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Converts the two callback shapes used by RN MediaPipe bridges to our frozen contract. */
export function toPoseFrame(
  payload: unknown,
  timestamp: number,
  mirrorMode: MirrorMode = 'none'
): PoseFrame | null {
  let decoded: unknown = payload;
  if (typeof payload === 'string') {
    try {
      decoded = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  const event = decoded as { landmarks?: unknown } | null;
  const raw = Array.isArray(event) ? event : event?.landmarks;
  if (!Array.isArray(raw) || raw.length < LANDMARK_COUNT) return null;

  const landmarks: Landmark[] = raw
    .slice(0, LANDMARK_COUNT)
    .map((item: RawLandmark) => ({
      x: mirrorMode === 'horizontal' ? 1 - finite(item.x) : finite(item.x),
      y: finite(item.y),
      z: finite(item.z),
      visibility: Math.max(0, Math.min(1, finite(item.visibility ?? item.presence))),
    }));

  const visible = landmarks.filter((landmark) => landmark.visibility >= 0.5).length;
  const confidence = visible / LANDMARK_COUNT;
  return { timestamp, landmarks, confidence, inFrame: confidence >= 0.5 };
}

export function mirrorPoseFrame(frame: PoseFrame): PoseFrame {
  return {
    ...frame,
    landmarks: frame.landmarks.map((landmark) => ({ ...landmark, x: 1 - landmark.x })),
  };
}

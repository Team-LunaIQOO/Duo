/**
 * Minimal geometry needed by the fatigue detector.
 *
 * ⚠️  TEMPORARY. 05-build-plan.md assigns "the geometry helpers in
 * 04-clinical-logic.md" to Person A. These are a local, deliberately minimal
 * copy so fatigue detection can be built and tested before src/vision/ exists.
 *
 * When Person A publishes the shared helpers, delete this file and import
 * theirs — the signatures below match 04-clinical-logic.md's pseudocode
 * exactly so the swap is mechanical. Do not let two copies of angleBetween
 * drift apart; that is how left/right bugs survive.
 */

import type { Landmark } from '../types/contracts';

/** MediaPipe BlazePose indices used by this project (04-clinical-logic.md). */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export type Point = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Angle at point b, formed by segments b->a and b->c, in degrees.
 * Returns NaN for degenerate input (a zero-length segment), so callers can
 * skip the frame rather than silently feeding 0 into a variance.
 */
export function angleBetween(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;

  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return NaN;

  const cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  return (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The normalisation unit for this project (04-clinical-logic.md). */
export function shoulderWidth(landmarks: Landmark[]): number {
  return distance(landmarks[LM.leftShoulder], landmarks[LM.rightShoulder]);
}

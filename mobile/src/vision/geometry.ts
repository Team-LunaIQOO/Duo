import type { Landmark } from '../types/contracts';

export type Point = Pick<Landmark, 'x' | 'y' | 'z'>;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleBetween(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (denominator === 0) return NaN;
  const cosine = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function shoulderWidth(landmarks: Landmark[]): number {
  return distance(landmarks[11], landmarks[12]);
}

export function validLandmarks(landmarks: Landmark[], indices: number[], minimum = 0.5): boolean {
  return indices.every((index) => landmarks[index]?.visibility >= minimum);
}

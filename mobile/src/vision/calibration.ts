import type { Landmark, PoseFrame } from '../types/contracts';
import { distance, midpoint, shoulderWidth } from './geometry';

export type CalibrationBaseline = {
  baselineShoulderWidth: number;
  baselineShoulderY: number;
  baselineHipShoulderDistance: number;
  baselineShoulderDepthDiff: number;
  baselineShoulderHipWidthRatio: number;
};

export function calculateBaseline(frames: PoseFrame[]): CalibrationBaseline | null {
  const usable = frames.filter((frame) => frame.inFrame && frame.confidence >= 0.5);
  if (!usable.length) return null;
  const values = usable.map(({ landmarks }) => {
    const shoulders = midpoint(landmarks[11], landmarks[12]);
    const hips = midpoint(landmarks[23], landmarks[24]);
    const width = shoulderWidth(landmarks);
    return {
      width,
      shoulderY: shoulders.y,
      vertical: Math.abs(shoulders.y - hips.y),
      depth: Math.abs(landmarks[11].z - landmarks[12].z),
      hipWidth: distance(landmarks[23], landmarks[24]),
    };
  }).filter((value) => value.width > 0 && value.vertical > 0 && value.hipWidth > 0);
  if (!values.length) return null;
  const average = (key: keyof (typeof values)[number]) =>
    values.reduce((sum, value) => sum + value[key], 0) / values.length;
  return {
    baselineShoulderWidth: average('width'),
    baselineShoulderY: average('shoulderY'),
    baselineHipShoulderDistance: average('vertical'),
    baselineShoulderDepthDiff: average('depth'),
    baselineShoulderHipWidthRatio: average('width') / average('hipWidth'),
  };
}

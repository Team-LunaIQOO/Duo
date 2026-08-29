import type { CompensationEvent, PoseFrame } from '../types/contracts';
import { distance, midpoint, shoulderWidth } from './geometry';
import { VISION_THRESHOLDS } from './thresholds';
import type { CalibrationBaseline } from './calibration';

type CompensationType = CompensationEvent['type'];

type Candidate = { startedAt: number; lastSeenAt: number; emittedAt: number | null };

export class CompensationDetector {
  private readonly candidates = new Map<CompensationType, Candidate>();
  private readonly lastEmittedAt = new Map<CompensationType, number>();

  constructor(private readonly baseline: CalibrationBaseline) {}

  update(frame: PoseFrame, workingSide: 'left' | 'right', now = frame.timestamp): CompensationEvent[] {
    if (!frame.inFrame || frame.confidence < 0.5) return [];
    const { landmarks } = frame;
    const width = shoulderWidth(landmarks);
    const hipWidth = distance(landmarks[23], landmarks[24]);
    if (!width || !hipWidth || !this.baseline.baselineShoulderWidth) return [];
    const shoulders = midpoint(landmarks[11], landmarks[12]);
    const hips = midpoint(landmarks[23], landmarks[24]);
    const leanScore = width / this.baseline.baselineShoulderWidth -
      Math.abs(shoulders.y - hips.y) / this.baseline.baselineHipShoulderDistance;
    const rotationScore = Math.abs(width / hipWidth - this.baseline.baselineShoulderHipWidthRatio);
    const shoulderIndex = workingSide === 'left' ? 11 : 12;
    const elevation = (this.baseline.baselineShoulderY - landmarks[shoulderIndex].y) /
      this.baseline.baselineShoulderWidth;
    const scores: Record<CompensationType, number> = {
      forward_lean: leanScore,
      trunk_rotation: rotationScore,
      shoulder_elevation: elevation,
    };
    const thresholds: Record<CompensationType, readonly [number, number]> = {
      forward_lean: [VISION_THRESHOLDS.forwardLean.mild, VISION_THRESHOLDS.forwardLean.marked],
      trunk_rotation: [VISION_THRESHOLDS.trunkRotation.mild, VISION_THRESHOLDS.trunkRotation.marked],
      shoulder_elevation: [VISION_THRESHOLDS.shoulderElevation.mild, VISION_THRESHOLDS.shoulderElevation.marked],
    };
    const events: CompensationEvent[] = [];
    (Object.keys(scores) as CompensationType[]).forEach((type) => {
      const [mild] = thresholds[type];
      const candidate = this.candidates.get(type);
      if (scores[type] <= mild) {
        this.candidates.delete(type);
        return;
      }
      const current = candidate ?? { startedAt: now, lastSeenAt: now, emittedAt: null };
      current.lastSeenAt = now;
      this.candidates.set(type, current);
      if (now - current.startedAt < VISION_THRESHOLDS.compensationHoldMs) return;
      const lastEmitted = this.lastEmittedAt.get(type);
      if (lastEmitted !== undefined && now - lastEmitted < VISION_THRESHOLDS.compensationCooldownMs) return;
      const marked = scores[type] > thresholds[type][1];
      current.emittedAt = now;
      this.lastEmittedAt.set(type, now);
      events.push({ timestamp: now, type, severity: marked ? 'marked' : 'mild', sustainedMs: now - current.startedAt });
    });
    return events;
  }
}

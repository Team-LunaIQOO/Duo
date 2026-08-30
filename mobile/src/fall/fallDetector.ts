import type { Landmark, PoseFrame } from '../types/contracts';
import { LandmarkIndex } from '../vision/landmarks';
import { FALL_THRESHOLDS as T } from './thresholds';

export type FallEvent = {
  timestamp: number;
  confidence: 'possible';
  reason: 'rapid_drop_low_posture' | 'rapid_drop_tracking_lost';
};

type Torso = { centerY: number; horizontalRatio: number };
type Sample = { timestamp: number; centerY: number };

const average = (a: number, b: number) => (a + b) / 2;

function visible(point: Landmark | undefined): point is Landmark {
  return Boolean(point && point.visibility >= T.minVisibility);
}

function torso(frame: PoseFrame): Torso | null {
  const leftShoulder = frame.landmarks[LandmarkIndex.leftShoulder];
  const rightShoulder = frame.landmarks[LandmarkIndex.rightShoulder];
  const leftHip = frame.landmarks[LandmarkIndex.leftHip];
  const rightHip = frame.landmarks[LandmarkIndex.rightHip];
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every(visible)) return null;

  const shoulderX = average(leftShoulder.x, rightShoulder.x);
  const shoulderY = average(leftShoulder.y, rightShoulder.y);
  const hipX = average(leftHip.x, rightHip.x);
  const hipY = average(leftHip.y, rightHip.y);
  const horizontal = Math.abs(shoulderX - hipX);
  const vertical = Math.max(0.025, Math.abs(shoulderY - hipY));
  return {
    centerY: average(shoulderY, hipY),
    horizontalRatio: horizontal / vertical,
  };
}

/**
 * Conservative seated-person fall heuristic. It is a prototype signal, not a
 * medical or emergency-grade detector. Missing landmarks alone never fire.
 */
export class FallDetector {
  private enabled = true;
  private baselineY: number | null = null;
  private baselineSamples: number[] = [];
  private history: Sample[] = [];
  private candidateSince: number | null = null;
  private candidateReason: FallEvent['reason'] | null = null;
  private recoveredSince: number | null = null;
  private lastEventAt = -Infinity;

  reset(): void {
    this.baselineY = null;
    this.baselineSamples = [];
    this.history = [];
    this.candidateSince = null;
    this.candidateReason = null;
    this.recoveredSince = null;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    // A baseline learned in idle, another exercise, or a paused session is
    // not valid evidence for the next monitored curl session.
    this.reset();
  }

  update(frame: PoseFrame, enabled = this.enabled): FallEvent | null {
    this.setEnabled(enabled);
    if (!this.enabled) return null;

    const current = torso(frame);
    const now = frame.timestamp;

    if (this.baselineY === null) {
      if (!current) return null;
      const previous = this.baselineSamples[this.baselineSamples.length - 1];
      if (previous !== undefined && Math.abs(current.centerY - previous) > T.baselineMaxStep) {
        this.baselineSamples = [];
      }
      this.baselineSamples.push(current.centerY);
      if (this.baselineSamples.length >= T.baselineFrames) {
        this.baselineY = this.baselineSamples.reduce((sum, value) => sum + value, 0) / this.baselineSamples.length;
      }
      return null;
    }

    this.history = this.history.filter((sample) => now - sample.timestamp <= T.rapidDropWindowMs);
    if (current) this.history.push({ timestamp: now, centerY: current.centerY });

    const recentHigh = this.history.reduce((minimum, sample) => Math.min(minimum, sample.centerY), current?.centerY ?? Infinity);
    const rapidDrop = Boolean(current && current.centerY - recentHigh >= T.rapidDropDistance);
    const low = Boolean(current && current.centerY - this.baselineY >= T.lowTorsoDistance);
    const sideways = Boolean(current && current.horizontalRatio >= T.horizontalRatio);
    const trackingLostAfterDrop = !current && this.candidateSince !== null;

    if (this.candidateSince === null && rapidDrop && low && now - this.lastEventAt >= T.cooldownMs) {
      this.candidateSince = now;
      this.candidateReason = 'rapid_drop_low_posture';
      this.recoveredSince = null;
      return null;
    }

    if (this.candidateSince === null) {
      // Slowly adapt to ordinary chair movement while no fall is suspected.
      if (current && Math.abs(current.centerY - this.baselineY) < T.lowTorsoDistance) {
        this.baselineY = this.baselineY * 0.98 + current.centerY * 0.02;
      }
      return null;
    }

    const stillSuspicious = trackingLostAfterDrop || Boolean(low && sideways);
    if (trackingLostAfterDrop) this.candidateReason = 'rapid_drop_tracking_lost';
    if (stillSuspicious) {
      this.recoveredSince = null;
      if (now - this.candidateSince >= T.confirmMs) {
        const event: FallEvent = {
          timestamp: now,
          confidence: 'possible',
          reason: this.candidateReason ?? 'rapid_drop_low_posture',
        };
        this.lastEventAt = now;
        this.candidateSince = null;
        this.candidateReason = null;
        this.history = [];
        return event;
      }
      return null;
    }

    this.recoveredSince ??= now;
    if (now - this.recoveredSince >= T.recoveryMs) {
      this.candidateSince = null;
      this.candidateReason = null;
      this.recoveredSince = null;
    }
    return null;
  }
}

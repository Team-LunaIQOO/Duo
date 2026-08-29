import type { CompensationEvent, PoseFrame, RepEvent } from '../types/contracts';
import { angleBetween, validLandmarks } from './geometry';
import { LandmarkIndex } from './landmarks';
import { VISION_THRESHOLDS } from './thresholds';

type Exercise = 'shoulder_abduction' | 'elbow_flexion';
type Phase = 'down' | 'up' | 'extended' | 'flexed';

export class RepCounter {
  private phase: Phase;
  private candidate: { phase: Phase; since: number } | null = null;
  private repStartedAt: number | null = null;
  private peakAngle = 0;
  private repNumber = 0;
  private compensations = new Set<CompensationEvent['type']>();

  constructor(
    private readonly exercise: Exercise,
    private readonly side: 'left' | 'right',
    private readonly repSide: RepEvent['side'] = 'affected'
  ) {
    this.phase = exercise === 'shoulder_abduction' ? 'down' : 'extended';
  }

  update(frame: PoseFrame, compensationEvents: CompensationEvent[] = []): RepEvent | null {
    if (!frame.inFrame || frame.confidence < 0.5) return null;
    compensationEvents.forEach((event) => this.compensations.add(event.type));
    const { shoulder, elbow, wrist, hip } = this.indices();
    if (!validLandmarks(frame.landmarks, [shoulder, elbow, wrist, hip])) return null;
    const angle = this.exercise === 'shoulder_abduction'
      ? angleBetween(frame.landmarks[hip], frame.landmarks[shoulder], frame.landmarks[elbow])
      : angleBetween(frame.landmarks[shoulder], frame.landmarks[elbow], frame.landmarks[wrist]);
    if (!Number.isFinite(angle)) return null;
    this.peakAngle = Math.max(this.peakAngle, angle);
    const next = this.nextPhase(angle);
    if (!next || next === this.phase) return null;
    if (!this.candidate || this.candidate.phase !== next) this.candidate = { phase: next, since: frame.timestamp };
    if (frame.timestamp - this.candidate.since < VISION_THRESHOLDS.holdMs) return null;
    const previous = this.phase;
    this.phase = next;
    this.candidate = null;
    if (this.isStart(previous, next)) {
      this.repStartedAt = frame.timestamp;
      this.peakAngle = angle;
      this.compensations.clear();
    }
    if (!this.isComplete(previous, next) || this.repStartedAt === null) return null;
    this.repNumber += 1;
    const quality = this.compensations.size > 0 ? 'compensated' : this.quality();
    const event: RepEvent = {
      timestamp: frame.timestamp,
      repNumber: this.repNumber,
      side: this.repSide,
      peakAngle: this.peakAngle,
      durationMs: frame.timestamp - this.repStartedAt,
      quality,
    };
    this.repStartedAt = null;
    this.peakAngle = 0;
    this.compensations.clear();
    return event;
  }

  private indices() {
    const left = this.side === 'left';
    return {
      shoulder: left ? LandmarkIndex.leftShoulder : LandmarkIndex.rightShoulder,
      elbow: left ? LandmarkIndex.leftElbow : LandmarkIndex.rightElbow,
      wrist: left ? LandmarkIndex.leftWrist : LandmarkIndex.rightWrist,
      hip: left ? LandmarkIndex.leftHip : LandmarkIndex.rightHip,
    };
  }

  private nextPhase(angle: number): Phase | null {
    if (this.exercise === 'shoulder_abduction') {
      if (this.phase === 'down' && angle > VISION_THRESHOLDS.shoulderAbduction.upDegrees) return 'up';
      if (this.phase === 'up' && angle < VISION_THRESHOLDS.shoulderAbduction.downDegrees) return 'down';
    } else {
      if (this.phase === 'extended' && angle < VISION_THRESHOLDS.elbowFlexion.flexedDegrees) return 'flexed';
      if (this.phase === 'flexed' && angle > VISION_THRESHOLDS.elbowFlexion.extendedDegrees) return 'extended';
    }
    return null;
  }

  private isStart(previous: Phase, next: Phase) { return previous === (this.exercise === 'shoulder_abduction' ? 'down' : 'extended') && next === (this.exercise === 'shoulder_abduction' ? 'up' : 'flexed'); }
  private isComplete(previous: Phase, next: Phase) { return previous === (this.exercise === 'shoulder_abduction' ? 'up' : 'flexed') && next === (this.exercise === 'shoulder_abduction' ? 'down' : 'extended'); }
  private quality(): RepEvent['quality'] {
    if (this.exercise === 'shoulder_abduction') return this.peakAngle >= 80 ? 'good' : this.peakAngle >= 45 ? 'partial' : 'partial';
    return this.peakAngle >= VISION_THRESHOLDS.elbowFlexion.extendedDegrees ? 'good' : 'partial';
  }
}

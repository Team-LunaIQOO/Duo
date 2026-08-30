import type { CompensationEvent, PoseFrame, RepEvent } from '../types/contracts';
import { angleBetween, shoulderWidth, validLandmarks } from './geometry';
import { LandmarkIndex } from './landmarks';
import { VISION_THRESHOLDS } from './thresholds';

export type Exercise =
  | 'shoulder_abduction'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'horizontal_adduction'
  | 'wrist_flexion';
type Phase = 'down' | 'up' | 'extended' | 'flexed' | 'out' | 'in';

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
    this.phase = this.startPhase();
  }

  private startPhase(): Phase {
    switch (this.exercise) {
      case 'shoulder_abduction': return 'down';
      case 'elbow_flexion': return 'extended';
      // The rest position for an isolated extension exercise is arm bent —
      // the rep is the straightening motion, not the return.
      case 'elbow_extension': return 'flexed';
      case 'horizontal_adduction': return 'out';
      case 'wrist_flexion': return 'extended';
    }
  }

  update(frame: PoseFrame, compensationEvents: CompensationEvent[] = []): RepEvent | null {
    if (!frame.inFrame || frame.confidence < 0.5) return null;
    compensationEvents.forEach((event) => this.compensations.add(event.type));
    const metric = this.metric(frame);
    if (metric === null) return null;
    const { value, requiredLandmarks } = metric;
    if (!validLandmarks(frame.landmarks, requiredLandmarks)) return null;
    if (!Number.isFinite(value)) return null;
    // horizontal_adduction's better-performance direction is smaller (the
    // wrist travelling further across the body), so its "peak" is a minimum;
    // every other exercise's peak is a maximum.
    this.peakAngle = this.exercise === 'horizontal_adduction'
      ? Math.min(this.peakAngle === 0 ? value : this.peakAngle, value)
      : Math.max(this.peakAngle, value);
    const next = this.nextPhase(value);
    if (!next || next === this.phase) return null;
    if (!this.candidate || this.candidate.phase !== next) this.candidate = { phase: next, since: frame.timestamp };
    if (frame.timestamp - this.candidate.since < VISION_THRESHOLDS.holdMs) return null;
    const previous = this.phase;
    this.phase = next;
    this.candidate = null;
    if (this.isStart(previous, next)) {
      this.repStartedAt = frame.timestamp;
      this.peakAngle = value;
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
      index: left ? LandmarkIndex.leftIndex : LandmarkIndex.rightIndex,
    };
  }

  /**
   * The value nextPhase()/quality() watch, and which landmarks it needs.
   * Every exercise but horizontal_adduction is an angleBetween triple in
   * degrees; horizontal_adduction tracks the wrist's horizontal distance from
   * the shoulder, normalised by shoulder width (04-clinical-logic.md's
   * normalisation unit), because "arm across the body" is not an angle at any
   * of these three joints.
   */
  private metric(frame: PoseFrame): { value: number; requiredLandmarks: number[] } | null {
    const { shoulder, elbow, wrist, hip, index } = this.indices();

    if (this.exercise === 'shoulder_abduction') {
      return {
        value: angleBetween(frame.landmarks[hip], frame.landmarks[shoulder], frame.landmarks[elbow]),
        requiredLandmarks: [shoulder, elbow, hip],
      };
    }

    if (this.exercise === 'horizontal_adduction') {
      const width = shoulderWidth(frame.landmarks);
      if (!Number.isFinite(width) || width <= 0) return null;
      const value = Math.abs(frame.landmarks[wrist].x - frame.landmarks[shoulder].x) / width;
      return { value, requiredLandmarks: [shoulder, wrist] };
    }

    if (this.exercise === 'wrist_flexion') {
      // EXPERIMENTAL: see landmarks.ts's note on leftIndex/rightIndex. Not a
      // validated hand-tracking joint.
      return {
        value: angleBetween(frame.landmarks[elbow], frame.landmarks[wrist], frame.landmarks[index]),
        requiredLandmarks: [elbow, wrist, index],
      };
    }

    // elbow_flexion and elbow_extension: same angle, opposite phase graph.
    return {
      value: angleBetween(frame.landmarks[shoulder], frame.landmarks[elbow], frame.landmarks[wrist]),
      requiredLandmarks: [shoulder, elbow, wrist],
    };
  }

  private nextPhase(value: number): Phase | null {
    switch (this.exercise) {
      case 'shoulder_abduction':
        if (this.phase === 'down' && value > VISION_THRESHOLDS.shoulderAbduction.upDegrees) return 'up';
        if (this.phase === 'up' && value < VISION_THRESHOLDS.shoulderAbduction.downDegrees) return 'down';
        return null;

      case 'elbow_flexion':
        if (this.phase === 'extended' && value < VISION_THRESHOLDS.elbowFlexion.flexedDegrees) return 'flexed';
        if (this.phase === 'flexed' && value > VISION_THRESHOLDS.elbowFlexion.extendedDegrees) return 'extended';
        return null;

      case 'elbow_extension':
        // Reversed relative to elbow_flexion: the rep starts FLEXED and the
        // "start" transition is the straightening move.
        if (this.phase === 'flexed' && value > VISION_THRESHOLDS.elbowExtension.extendedDegrees) return 'extended';
        if (this.phase === 'extended' && value < VISION_THRESHOLDS.elbowExtension.flexedDegrees) return 'flexed';
        return null;

      case 'horizontal_adduction':
        if (this.phase === 'out' && value < VISION_THRESHOLDS.horizontalAdduction.inRatio) return 'in';
        if (this.phase === 'in' && value > VISION_THRESHOLDS.horizontalAdduction.outRatio) return 'out';
        return null;

      case 'wrist_flexion':
        if (this.phase === 'extended' && value < VISION_THRESHOLDS.wristFlexion.flexedDegrees) return 'flexed';
        if (this.phase === 'flexed' && value > VISION_THRESHOLDS.wristFlexion.extendedDegrees) return 'extended';
        return null;
    }
  }

  /** The phase pair each exercise's rep starts and completes on. */
  private repPhases(): { start: Phase; peak: Phase } {
    switch (this.exercise) {
      case 'shoulder_abduction': return { start: 'down', peak: 'up' };
      case 'elbow_flexion': return { start: 'extended', peak: 'flexed' };
      case 'elbow_extension': return { start: 'flexed', peak: 'extended' };
      case 'horizontal_adduction': return { start: 'out', peak: 'in' };
      case 'wrist_flexion': return { start: 'extended', peak: 'flexed' };
    }
  }

  private isStart(previous: Phase, next: Phase) {
    const { start, peak } = this.repPhases();
    return previous === start && next === peak;
  }

  private isComplete(previous: Phase, next: Phase) {
    const { start, peak } = this.repPhases();
    return previous === peak && next === start;
  }

  private quality(): RepEvent['quality'] {
    switch (this.exercise) {
      case 'shoulder_abduction':
        return this.peakAngle >= VISION_THRESHOLDS.shoulderAbduction.goodPeakDegrees ? 'good' : 'partial';
      case 'elbow_flexion':
        return this.peakAngle >= VISION_THRESHOLDS.elbowFlexion.extendedDegrees ? 'good' : 'partial';
      case 'elbow_extension':
        return this.peakAngle >= VISION_THRESHOLDS.elbowExtension.extendedDegrees ? 'good' : 'partial';
      case 'horizontal_adduction':
        return this.peakAngle <= VISION_THRESHOLDS.horizontalAdduction.inRatio ? 'good' : 'partial';
      case 'wrist_flexion':
        return this.peakAngle <= VISION_THRESHOLDS.wristFlexion.flexedDegrees ? 'good' : 'partial';
    }
  }
}

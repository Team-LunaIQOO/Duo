import type { CompensationEvent, PoseFrame, RepEvent } from '../types/contracts';
import { CompensationDetector } from './compensationDetector';
import type { CalibrationBaseline } from './calibration';
import { RepCounter, type Exercise } from './repCounter';

export type VisionOutput = {
  frame: PoseFrame;
  compensationEvents: CompensationEvent[];
  repEvent: RepEvent | null;
};

export type VisionListener = (output: VisionOutput) => void;

/** Coordinates the synchronous, on-device vision stages without owning UI state. */
export class PosePipeline {
  private readonly listeners = new Set<VisionListener>();
  private readonly compensationDetector: CompensationDetector | null;
  private readonly repCounter: RepCounter;
  private readonly workingSide: 'left' | 'right';

  constructor(options: {
    baseline?: CalibrationBaseline;
    exercise: Exercise;
    workingSide: 'left' | 'right';
    repSide?: RepEvent['side'];
  }) {
    this.compensationDetector = options.baseline ? new CompensationDetector(options.baseline) : null;
    this.workingSide = options.workingSide;
    this.repCounter = new RepCounter(options.exercise, options.workingSide, options.repSide);
  }

  subscribe(listener: VisionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(frame: PoseFrame): VisionOutput {
    const compensationEvents = this.compensationDetector?.update(frame, this.workingSide) ?? [];
    const output = {
      frame,
      compensationEvents,
      repEvent: this.repCounter.update(frame, compensationEvents),
    };
    this.listeners.forEach((listener) => listener(output));
    return output;
  }
}

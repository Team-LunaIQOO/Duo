/**
 * Public surface of the fatigue module — Person C.
 *
 * Person B's session state machine should only ever need FatigueDetector and
 * the FatigueSignal type from src/types/contracts.ts.
 */

export {
  FatigueDetector,
  chooseWindows,
  computeInstability,
  primaryReason,
} from './fatigueDetector';
export type {
  FatigueDebug,
  FatigueDetectorOptions,
  FiredSignals,
  RepRecord,
} from './fatigueDetector';

export { DEFAULT_FATIGUE_THRESHOLDS, TUNE_KEYS } from './thresholds';
export type { FatigueThresholds } from './thresholds';

export { trackedAngleFor } from './trackedAngle';
export type { TrackedAngleFn, TrackedExercise, WorkingSide } from './trackedAngle';

// Geometry helpers are Person A's, in src/vision/geometry.ts — import them
// from there. This module used to carry a temporary local copy; it was
// deleted at integration once the two were confirmed identical.

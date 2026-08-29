/**
 * Real replacement for `useMockStream`.
 *
 * Takes raw PoseFrames from Person A's MediaPipe view, runs the required
 * calibration baseline, drives Person A's PosePipeline, and emits the same
 * onFrame / onRep / onCompensation callbacks the mock did — so the session
 * controller and every screen below it are unchanged in shape.
 *
 * 04-clinical-logic.md: "Calibration step (required, do not skip). Before
 * counting anything, capture a two-second baseline while the user sits still
 * facing the camera." Compensation detection measures deviation from that
 * baseline, not absolute values, so without it a person who naturally sits
 * with one shoulder higher triggers a warning on every rep.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CompensationEvent,
  ExerciseId,
  PoseFrame,
  RepEvent,
} from '../../types/contracts';
import { calculateBaseline, type CalibrationBaseline } from '../../vision/calibration';
import { PosePipeline } from '../../vision/posePipeline';

/** How long to sit still before counting starts. 04-clinical-logic.md: two seconds. */
export const CALIBRATION_MS = 2000;

/** Minimum usable frames before a baseline is trusted, even if 2s have passed. */
const MIN_CALIBRATION_FRAMES = 12;

export type VisionCallbacks = {
  onFrame: (frame: PoseFrame) => void;
  onRep: (rep: RepEvent) => void;
  onCompensation: (event: CompensationEvent) => void;
};

export type VisionStatus = {
  /** True while the two-second baseline is still being captured. */
  calibrating: boolean;
  /** Latest inFrame/confidence verdict from the vision module. */
  framed: boolean;
  /** True once a baseline exists and reps are being counted. */
  ready: boolean;
};

/** Person B's ExerciseId literals map onto Person A's pipeline exercise names. */
function toPipelineExercise(exercise: ExerciseId | null): 'shoulder_abduction' | 'elbow_flexion' {
  return exercise === 'E3' ? 'elbow_flexion' : 'shoulder_abduction';
}

export function useVisionStream(
  active: boolean,
  exercise: ExerciseId | null,
  affectedSide: 'left' | 'right' | null,
  callbacks: VisionCallbacks
): { handlePoseFrame: (frame: PoseFrame) => void; status: VisionStatus } {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const pipelineRef = useRef<PosePipeline | null>(null);
  const calibrationFramesRef = useRef<PoseFrame[]>([]);
  const calibrationStartedAtRef = useRef<number | null>(null);
  const baselineRef = useRef<CalibrationBaseline | null>(null);

  const [calibrating, setCalibrating] = useState(false);
  const [framed, setFramed] = useState(false);
  const [ready, setReady] = useState(false);

  // A new session, a different exercise, or a different affected side all
  // invalidate the pipeline and the baseline — the baseline is per-person and
  // per-sitting, and the rep counter holds a state machine mid-rep.
  useEffect(() => {
    pipelineRef.current = null;
    baselineRef.current = null;
    calibrationFramesRef.current = [];
    calibrationStartedAtRef.current = null;
    setReady(false);
    setCalibrating(active);
    if (!active) setFramed(false);
  }, [active, exercise, affectedSide]);

  const handlePoseFrame = useCallback(
    (frame: PoseFrame) => {
      // Always report framing, even before calibration — the setup screen uses
      // it to tell the user they are in shot.
      setFramed(frame.inFrame && frame.confidence >= 0.5);

      // Stream every frame onward regardless of calibration state. The laptop
      // viewer should show the skeleton while the user is getting into
      // position, not sit blank for the first two seconds.
      callbacksRef.current.onFrame(frame);

      if (!active) return;

      // --- calibration phase ---
      if (!pipelineRef.current) {
        if (!frame.inFrame || frame.confidence < 0.5) return;

        calibrationStartedAtRef.current ??= frame.timestamp;
        calibrationFramesRef.current.push(frame);

        const elapsed = frame.timestamp - calibrationStartedAtRef.current;
        const enough =
          elapsed >= CALIBRATION_MS &&
          calibrationFramesRef.current.length >= MIN_CALIBRATION_FRAMES;
        if (!enough) return;

        const baseline = calculateBaseline(calibrationFramesRef.current);
        if (!baseline) {
          // Could not derive a baseline from these frames. Drop them and keep
          // trying rather than starting the session uncalibrated, which would
          // make every compensation reading meaningless.
          calibrationFramesRef.current = [];
          calibrationStartedAtRef.current = null;
          return;
        }

        baselineRef.current = baseline;
        pipelineRef.current = new PosePipeline({
          baseline,
          exercise: toPipelineExercise(exercise),
          workingSide: affectedSide ?? 'left',
          repSide: 'affected',
        });
        calibrationFramesRef.current = [];
        setCalibrating(false);
        setReady(true);
        return;
      }

      // --- counting phase ---
      const output = pipelineRef.current.push(frame);
      for (const event of output.compensationEvents) {
        callbacksRef.current.onCompensation(event);
      }
      if (output.repEvent) callbacksRef.current.onRep(output.repEvent);
    },
    [active, exercise, affectedSide]
  );

  return { handlePoseFrame, status: { calibrating, framed, ready } };
}

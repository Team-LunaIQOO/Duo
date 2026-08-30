/**
 * Real replacement for `useMockStream`.
 *
 * Takes raw PoseFrames from Person A's MediaPipe view, decides whether the
 * person is usably framed, runs the required calibration baseline, drives
 * Person A's PosePipeline, and emits the same onFrame / onRep /
 * onCompensation callbacks the mock did — so the session controller and every
 * screen below it are unchanged in shape.
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
  Landmark,
  PoseFrame,
  RepEvent,
} from '../../types/contracts';
import { calculateBaseline, type CalibrationBaseline } from '../../vision/calibration';
import { LandmarkIndex } from '../../vision/landmarks';
import { PosePipeline } from '../../vision/posePipeline';
import type { Exercise } from '../../vision/repCounter';

/** How long to sit still before counting starts. 04-clinical-logic.md: two seconds. */
export const CALIBRATION_MS = 2000;

/** Minimum usable frames before a baseline is trusted, even if 2s have passed. */
const MIN_CALIBRATION_FRAMES = 12;

/** Per-landmark visibility below which we will not use a point. */
const MIN_VISIBILITY = 0.5;

/**
 * Consecutive bad frames before we announce that the person is lost, and
 * consecutive good frames before we announce they are back.
 *
 * Asymmetric on purpose: at roughly 20 fps this waits about half a second
 * before complaining, but recovers in about a tenth. Losing tracking for three
 * frames while an arm crosses the body is normal and must not produce speech;
 * 04-clinical-logic.md makes the same argument about compensation debouncing —
 * an assistant that reacts to every twitch is unusable.
 */
const LOST_FRAMES = 10;
const FOUND_FRAMES = 2;

export type VisionCallbacks = {
  onFrame: (frame: PoseFrame) => void;
  onRep: (rep: RepEvent) => void;
  onCompensation: (event: CompensationEvent) => void;
};

export type VisionStatus = {
  /** True while the two-second baseline is still being captured. */
  calibrating: boolean;
  /** Whether the landmarks this exercise needs are currently usable. */
  framed: boolean;
  /** True once a baseline exists and reps are being counted. */
  ready: boolean;
  /** True once any pose at all has been seen, so callers can stay quiet before that. */
  seenAnyPose: boolean;
};

/** Person B's ExerciseId literals map onto Person A's pipeline exercise names. */
function toPipelineExercise(exercise: ExerciseId | null): Exercise {
  switch (exercise) {
    case 'E3': return 'elbow_flexion';
    case 'E4': return 'elbow_extension';
    case 'E5': return 'horizontal_adduction';
    case 'E6': return 'wrist_flexion';
    default: return 'shoulder_abduction';
  }
}

/**
 * The landmarks that actually have to be visible for this exercise.
 *
 * Person A's PoseFrame.confidence is the fraction of ALL 33 landmarks that are
 * visible, and inFrame is that fraction being at least a half. For this
 * product that measure is far too blunt: every exercise is seated and upper
 * limb (01-problem-and-users.md forbids standing work), so the eight leg and
 * foot landmarks are legitimately out of shot the entire time. Counting them
 * drags the fraction toward the threshold, and raising an arm is enough to tip
 * it — which reads to the user as "I can't see you" while they are in perfect
 * view.
 *
 * So framing is judged on the landmarks 04-clinical-logic.md actually
 * measures: both shoulders and hips for the trunk baseline and compensation
 * detection, plus the working arm for the tracked angle.
 */
function requiredLandmarks(exercise: ExerciseId | null, side: 'left' | 'right'): number[] {
  const left = side === 'left';
  const arm: number[] = [
    left ? LandmarkIndex.leftShoulder : LandmarkIndex.rightShoulder,
    left ? LandmarkIndex.leftElbow : LandmarkIndex.rightElbow,
  ];
  const wrist = left ? LandmarkIndex.leftWrist : LandmarkIndex.rightWrist;
  // Elbow flexion/extension track shoulder-elbow-wrist, and horizontal
  // adduction tracks shoulder-to-wrist distance directly, so the wrist is
  // load bearing for all three. Wrist flexion needs the wrist too, plus the
  // (unvalidated, see landmarks.ts) index-finger point.
  if (exercise === 'E3' || exercise === 'E4' || exercise === 'E5' || exercise === 'E6') {
    arm.push(wrist);
  }
  if (exercise === 'E6') {
    arm.push(left ? LandmarkIndex.leftIndex : LandmarkIndex.rightIndex);
  }

  return [
    LandmarkIndex.leftShoulder,
    LandmarkIndex.rightShoulder,
    LandmarkIndex.leftHip,
    LandmarkIndex.rightHip,
    ...arm,
  ];
}

function visibleCount(landmarks: Landmark[], indices: number[]): number {
  let n = 0;
  for (const i of indices) {
    if (landmarks[i] && landmarks[i].visibility >= MIN_VISIBILITY) n++;
  }
  return n;
}

export function useVisionStream(
  active: boolean,
  exercise: ExerciseId | null,
  /** The physical arm currently doing the work. */
  workingSide: 'left' | 'right' | null,
  /**
   * The clinical label to stamp on reps from that arm.
   *
   * Separate from `workingSide` because they are different things: the working
   * side is anatomy, this is which arm the therapist cares about. Both are
   * needed to produce the affected-versus-unaffected comparison, which cannot
   * be computed at all if every rep is labelled the same way.
   */
  repSide: RepEvent['side'],
  callbacks: VisionCallbacks
): { handlePoseFrame: (frame: PoseFrame) => void; status: VisionStatus; resetVision: () => void } {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Everything the frame handler reads lives in refs, so the handler itself can
  // have a stable identity. This is not a micro-optimisation: the ThinkSys
  // bridge subscribes to its native 'onLandmark' event inside a useEffect with
  // an EMPTY dependency array, so it captures the very first callback it is
  // given and keeps calling that one for the lifetime of the view. A handler
  // whose identity changed when the session became active would leave the
  // native events flowing into a closure that still believed the session had
  // not started, and no rep would ever be counted.
  const activeRef = useRef(active);
  activeRef.current = active;
  const exerciseRef = useRef(exercise);
  exerciseRef.current = exercise;
  const sideRef = useRef<'left' | 'right'>(workingSide ?? 'left');
  sideRef.current = workingSide ?? 'left';
  const repSideRef = useRef<RepEvent['side']>(repSide);
  repSideRef.current = repSide;

  const pipelineRef = useRef<PosePipeline | null>(null);
  const calibrationFramesRef = useRef<PoseFrame[]>([]);
  const calibrationStartedAtRef = useRef<number | null>(null);
  const baselineRef = useRef<CalibrationBaseline | null>(null);
  const goodStreakRef = useRef(0);
  const badStreakRef = useRef(0);
  const framedRef = useRef(false);

  const [calibrating, setCalibrating] = useState(false);
  const [framed, setFramed] = useState(false);
  const [ready, setReady] = useState(false);
  const [seenAnyPose, setSeenAnyPose] = useState(false);

  /**
   * Drops the baseline and the rep state machine. Called when a session starts
   * or its parameters change — the baseline is per person and per sitting, and
   * the rep counter can be holding a half-finished rep.
   */
  const resetVision = useCallback(() => {
    pipelineRef.current = null;
    baselineRef.current = null;
    calibrationFramesRef.current = [];
    calibrationStartedAtRef.current = null;
    goodStreakRef.current = 0;
    badStreakRef.current = 0;
    setReady(false);
    setCalibrating(activeRef.current);
  }, []);

  // A new session, a different exercise, or a different affected side all
  // invalidate the baseline and the rep state machine. This is an effect with
  // real dependencies, which is fine — it is only the frame *handler* that has
  // to keep a stable identity.
  useEffect(() => {
    resetVision();
    if (!active) {
      framedRef.current = false;
      setFramed(false);
    }
  }, [active, exercise, workingSide, repSide, resetVision]);

  const handlePoseFrame = useCallback((frame: PoseFrame) => {
    setSeenAnyPose(true);

    const required = requiredLandmarks(exerciseRef.current, sideRef.current);
    const visible = visibleCount(frame.landmarks, required);
    const usable = visible === required.length;

    // Hysteresis, so a momentary occlusion does not toggle the UI or trigger
    // speech. Only a sustained run in either direction changes the verdict.
    if (usable) {
      goodStreakRef.current++;
      badStreakRef.current = 0;
      if (!framedRef.current && goodStreakRef.current >= FOUND_FRAMES) {
        framedRef.current = true;
        setFramed(true);
      }
    } else {
      badStreakRef.current++;
      goodStreakRef.current = 0;
      if (framedRef.current && badStreakRef.current >= LOST_FRAMES) {
        framedRef.current = false;
        setFramed(false);
      }
    }

    /**
     * Re-scoped confidence for the analysis modules.
     *
     * Person A's pipeline gates on `inFrame` and `confidence >= 0.5`, both
     * computed across all 33 landmarks. Replacing them with the same judgement
     * taken over the landmarks this exercise actually needs is what lets a
     * seated upper-body session count reps at all. The landmarks themselves
     * are passed through untouched — only the verdict about which frames are
     * worth analysing is re-scoped, and it is stricter per landmark, not
     * looser: every required point must clear MIN_VISIBILITY.
     */
    const analysisFrame: PoseFrame = {
      ...frame,
      confidence: required.length === 0 ? 0 : visible / required.length,
      inFrame: usable,
    };

    // The laptop viewer gets every frame, framed or not. Display is not gated
    // on the analysis verdict — see StreamPublisher.publishPoseFrame.
    callbacksRef.current.onFrame(frame);

    if (!activeRef.current) return;

    // --- calibration phase ---
    if (!pipelineRef.current) {
      if (!usable) return;

      calibrationStartedAtRef.current ??= frame.timestamp;
      calibrationFramesRef.current.push(analysisFrame);

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
        exercise: toPipelineExercise(exerciseRef.current),
        workingSide: sideRef.current,
        repSide: repSideRef.current,
      });
      calibrationFramesRef.current = [];
      setCalibrating(false);
      setReady(true);
      return;
    }

    // --- counting phase ---
    const output = pipelineRef.current.push(analysisFrame);
    for (const event of output.compensationEvents) {
      callbacksRef.current.onCompensation(event);
    }
    if (output.repEvent) callbacksRef.current.onRep(output.repEvent);
  }, []);

  return {
    handlePoseFrame,
    resetVision,
    status: { calibrating, framed, ready, seenAnyPose },
  };
}

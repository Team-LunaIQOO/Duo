/**
 * Fatigue detection thresholds.
 *
 * ⚠️  EVERY VALUE MARKED `TUNE` IS A STARTING GUESS, NOT A VALIDATED VALUE.
 *
 * README rule #2 and 04-clinical-logic.md are explicit about this: these must
 * be calibrated against the real loaner device before Sunday (calibration
 * protocol step 5 — "do a long set to exhaustion and log whether the fatigue
 * signals fire at a plausible point"). A detector that fires constantly and a
 * detector that never fires both look equally broken to a judge.
 *
 * These live here, in one file, deliberately — not scattered as literals
 * across the detector (04-clinical-logic.md, "Calibration protocol").
 *
 * NOTE ON OWNERSHIP: 05-build-plan.md says the *tuned threshold constants*
 * file is owned by Person A. That refers to the shared rep/compensation
 * thresholds. These are the fatigue-only constants, inside Person C's folder.
 * If the team decides all thresholds belong in one Person A-owned file, these
 * move there wholesale — they are named and grouped so that is a copy-paste.
 */

export type FatigueThresholds = {
  /** Reps in the "early" baseline window. 04-clinical-logic.md: first 3 reps. */
  earlyWindowSize: number;
  /** Reps in the "recent" comparison window. 04-clinical-logic.md: last 5 reps. */
  recentWindowSize: number;
  /**
   * Reps required before any fatigue signal may fire.
   *
   * TUNE. Defaults to earlyWindowSize + recentWindowSize so the two windows
   * never overlap — comparing a set of reps against itself always yields a
   * ratio of 1.0 and is meaningless.
   *
   * DEMO RISK: at the default of 8, a demo set of 9-10 reps only starts
   * evaluating fatigue at rep 8. 06-demo-and-pitch.md beat 5 needs fatigue to
   * fire on "two or three visibly slower, smaller reps". Either lengthen the
   * demo set or lower this — but lowering it below 8 makes the windows
   * overlap, which weakens the signal. Decide this during calibration, not
   * on stage.
   */
  minRepsBeforeFatigue: number;

  /** romRatio = mean(recent peak angles) / mean(early peak angles). */
  romDecayRatio: number; // TUNE — fires when romRatio < this
  /** durationRatio = mean(recent durations) / mean(early durations). */
  timingDriftRatio: number; // TUNE — fires when durationRatio > this
  /** instabilityRatio = instability(recent) / instability(early). */
  instabilityRatio: number; // TUNE — fires when instabilityRatio > this

  /**
   * Minimum overall PoseFrame confidence for a frame to contribute to the
   * instability signal. 03-architecture.md: "Do not compute angles off a frame
   * where the relevant landmarks have low visibility. Skip the frame."
   */
  minFrameConfidence: number; // TUNE
  /** Minimum per-landmark visibility for the three landmarks in the angle. */
  minLandmarkVisibility: number; // TUNE

  /**
   * Minimum angle samples in a rep before its instability is trusted. A rep
   * with 3 usable frames has a meaningless variance.
   */
  minSamplesForInstability: number; // TUNE

  /**
   * Re-emit the same fatigue level at most this often, in ms. The detector
   * emits on level *change* by default; this bounds nagging if a caller opts
   * into repeat emission. Mirrors the compensation-suppression reasoning in
   * 04-clinical-logic.md: "Repeating the same correction five times in a row
   * is what makes assistants feel hostile."
   */
  repeatSuppressionMs: number; // TUNE
};

/**
 * Starting guesses, straight from 04-clinical-logic.md "Fatigue detection".
 * Not validated. See the warning at the top of this file.
 */
export const DEFAULT_FATIGUE_THRESHOLDS: FatigueThresholds = {
  earlyWindowSize: 3,
  recentWindowSize: 5,
  minRepsBeforeFatigue: 8, // TUNE (= 3 + 5, disjoint windows)

  romDecayRatio: 0.85, // TUNE
  timingDriftRatio: 1.3, // TUNE
  instabilityRatio: 1.5, // TUNE

  minFrameConfidence: 0.5, // TUNE
  minLandmarkVisibility: 0.5, // TUNE
  minSamplesForInstability: 5, // TUNE

  repeatSuppressionMs: 6000, // TUNE
};

/**
 * The threshold keys that are unvalidated guesses, for display in a debug
 * panel or the calibration log. Keeping this list in code means the "these
 * are not clinical values" caveat cannot silently rot away from the numbers.
 */
export const TUNE_KEYS: readonly (keyof FatigueThresholds)[] = [
  'minRepsBeforeFatigue',
  'romDecayRatio',
  'timingDriftRatio',
  'instabilityRatio',
  'minFrameConfidence',
  'minLandmarkVisibility',
  'minSamplesForInstability',
  'repeatSuppressionMs',
];

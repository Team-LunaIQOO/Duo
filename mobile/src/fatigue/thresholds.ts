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
   * TUNE. The windows above are *maximums*, not fixed sizes: below
   * earlyWindowSize + recentWindowSize reps they shrink to stay disjoint
   * (see chooseWindows in fatigueDetector.ts). Overlapping windows would
   * compare a set of reps partly against itself, which drags every ratio
   * toward 1.0 and mutes the signal.
   *
   * This is why the default is 6 rather than 8: a demo set is short, and
   * 06-demo-and-pitch.md beat 5 needs fatigue to fire on "two or three
   * visibly slower, smaller reps" near the end of it. At 6, the comparison is
   * first-3 against last-3, which is still disjoint and still honest — just
   * noisier than a full 3-against-5.
   */
  minRepsBeforeFatigue: number;

  /**
   * Smallest acceptable window on either side. Below this a mean is being
   * taken over so few reps that the ratio is noise.
   */
  minWindowSize: number; // TUNE

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
  minRepsBeforeFatigue: 6, // TUNE — windows shrink to stay disjoint below 8
  minWindowSize: 3, // TUNE

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
  'minWindowSize',
  'romDecayRatio',
  'timingDriftRatio',
  'instabilityRatio',
  'minFrameConfidence',
  'minLandmarkVisibility',
  'minSamplesForInstability',
  'repeatSuppressionMs',
];

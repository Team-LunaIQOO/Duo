/**
 * Gesture-pause thresholds. All in one file, as 04-clinical-logic.md's
 * calibration protocol requires ("Write the resulting numbers into the code as
 * named constants in one file, not scattered as literals").
 *
 * Every value here is `TUNE`: a starting guess derived from anthropometry, not
 * a measured one. The reasoning behind each one is in gestureDetector.ts, and
 * RUNNING.md says how to re-check them on the device.
 *
 * Distances are expressed as fractions of shoulder width, the normalisation
 * unit this project uses everywhere (04-clinical-logic.md, "Core geometry
 * helpers"): landmark coordinates are normalised to image size, so a raw
 * distance changes when the user sits closer to the phone.
 */
export const GESTURE_THRESHOLDS = {
  /** Per-landmark visibility below which the arm is not judged at all. */
  minVisibility: 0.5,

  /**
   * Wrist must clear the shoulder by this much. Kills the resting arm and E3
   * elbow flexion, where the wrist peaks a good quarter of a shoulder width
   * *below* the shoulder even at full curl.
   *
   * Set from the arithmetic of a real arm rather than picked round: the
   * forearm is shorter than the upper arm, so with the elbow at a right angle
   * the hand only clears the shoulder once the upper arm is raised past about
   * 60 degrees. At 0.25 the gesture needed a near-horizontal upper arm, which
   * is a lot to ask of someone with limited range. At 0.15 it starts working
   * from roughly 60 degrees, and the false-positive suite is unchanged —
   * abduction reps are rejected on arm straightness and elbow height, not on
   * this test.
   */
  minWristRise: 0.15, // TUNE

  /**
   * Interior angle at the elbow (11-13-15). A raised hand is a *bent* arm.
   * This is the main guard against shoulder abduction, which is performed
   * with a straight arm at every height.
   */
  maxElbowAngleDeg: 130, // TUNE

  /**
   * The elbow must stay at or below shoulder height. This is what separates a
   * held stop-hand (upper arm at or below horizontal, forearm up) from an arm
   * raised overhead with a bent elbow, which is otherwise the same shape.
   */
  maxElbowRise: 0.25, // TUNE

  /** Forearm must point up, not across the body. */
  minWristAboveElbow: 0.15, // TUNE

  /**
   * How far the wrist may drift during the hold before the timer restarts.
   * A rep sweeps the wrist through roughly 1.5 shoulder widths in about a
   * second; a deliberately held hand does not move at all.
   */
  maxDriftDuringHold: 0.25, // TUNE

  /**
   * How long the posture must hold before it counts. 04-clinical-logic.md uses
   * 400ms for compensations; a gesture gets longer, because a false pause
   * mid-set is worse for the user than a slow one.
   */
  holdMs: 900, // TUNE

  /** No second gesture within this window, even after a clean release. */
  cooldownMs: 4_000, // TUNE

  /** The posture must be absent this long before another gesture can fire. */
  releaseMs: 400, // TUNE

  /**
   * A gap between frames longer than this invalidates the hold. Without it, an
   * app backgrounded mid-posture would resume and immediately "complete" a
   * hold it never observed.
   */
  maxFrameGapMs: 500, // TUNE
} as const;

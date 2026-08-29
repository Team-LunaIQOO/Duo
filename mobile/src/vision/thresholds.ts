/** Starting values from 04-clinical-logic.md. Tune on the loaner device before demo. */
export const VISION_THRESHOLDS = {
  holdMs: 150,
  compensationHoldMs: 400,
  compensationCooldownMs: 6_000,
  shoulderAbduction: { downDegrees: 30, upDegrees: 70, goodPeakDegrees: 80, partialPeakDegrees: 45 },
  elbowFlexion: { extendedDegrees: 150, flexedDegrees: 60 },
  forwardLean: { mild: 0.08, marked: 0.18 },
  trunkRotation: { mild: 0.1, marked: 0.2 },
  shoulderElevation: { mild: 0.1, marked: 0.2 },
} as const;

/** Starting values from 04-clinical-logic.md. Tune on the loaner device before demo. */
export const VISION_THRESHOLDS = {
  holdMs: 150,
  compensationHoldMs: 400,
  compensationCooldownMs: 6_000,
  shoulderAbduction: { downDegrees: 30, upDegrees: 70, goodPeakDegrees: 80, partialPeakDegrees: 45 },
  elbowFlexion: { extendedDegrees: 150, flexedDegrees: 60 },
  // E4: the same joints and angle as elbowFlexion, read in the opposite
  // direction — a rep is FLEXED -> EXTENDED -> FLEXED, isolating the push
  // rather than the curl. Shares elbowFlexion's threshold values on purpose:
  // it is the same physical range of motion, just entered from the other end.
  elbowExtension: { extendedDegrees: 150, flexedDegrees: 60 },
  // E5: not an angleBetween triple like the others. Tracks how far the wrist
  // travels horizontally from the shoulder, normalised by shoulder width, the
  // same normalisation 04-clinical-logic.md uses throughout. Arm-across-body
  // is IN; arm out to the side at chest height is OUT.
  horizontalAdduction: { inRatio: 0.15, outRatio: 0.55 },
  // E6: EXPERIMENTAL, see landmarks.ts's note on leftIndex/rightIndex. Angle
  // at the wrist between elbow and the index-finger landmark. Not validated
  // against a real hand — confirm this actually tracks flexion on-device
  // before relying on it for a demo.
  wristFlexion: { extendedDegrees: 160, flexedDegrees: 130 },
  forwardLean: { mild: 0.08, marked: 0.18 },
  trunkRotation: { mild: 0.1, marked: 0.2 },
  shoulderElevation: { mild: 0.1, marked: 0.2 },
} as const;

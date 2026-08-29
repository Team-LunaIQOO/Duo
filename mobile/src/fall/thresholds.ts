export const FALL_THRESHOLDS = {
  minVisibility: 0.55,
  baselineFrames: 12,
  baselineMaxStep: 0.025,
  rapidDropDistance: 0.16,
  rapidDropWindowMs: 900,
  lowTorsoDistance: 0.13,
  horizontalRatio: 1.15,
  confirmMs: 1200,
  recoveryMs: 1000,
  cooldownMs: 60_000,
} as const;

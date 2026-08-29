/**
 * Shared data contracts between the three modules of Duo.
 * Source of truth: docs/03-architecture.md, section "Module contracts".
 *
 * FROZEN. Do not change a shape here without agreeing out loud with
 * both other people first (see 05-build-plan.md, "Interfaces to agree
 * before anyone writes code"). A silent change here breaks two other
 * modules at once.
 */

// ---------------------------------------------------------------------------
// A. Vision module output — owned by Person A (src/vision/)
// ---------------------------------------------------------------------------

export type Landmark = {
  x: number; // normalised 0-1, image space
  y: number; // normalised 0-1, image space
  z: number; // relative depth, use with caution
  visibility: number; // 0-1, per-landmark
};

export type PoseFrame = {
  timestamp: number; // ms since session start
  landmarks: Landmark[]; // 33 entries, MediaPipe pose index order
  confidence: number; // 0-1, overall detection confidence
  inFrame: boolean; // false if user partly out of view
};

// ---------------------------------------------------------------------------
// B. Analysis module outputs — RepEvent/CompensationEvent by Person A,
//    FatigueSignal by Person C (src/fatigue/)
// ---------------------------------------------------------------------------

export type RepEvent = {
  timestamp: number;
  repNumber: number;
  side: 'affected' | 'unaffected';
  peakAngle: number; // degrees, max range reached this rep
  durationMs: number;
  quality: 'good' | 'partial' | 'compensated';
};

export type CompensationEvent = {
  timestamp: number;
  type: 'forward_lean' | 'trunk_rotation' | 'shoulder_elevation';
  severity: 'mild' | 'marked';
  sustainedMs: number; // how long it has been present
};

export type FatigueSignal = {
  timestamp: number;
  level: 'none' | 'slowing' | 'fatigued';
  reason: 'rom_decay' | 'timing_drift' | 'instability';
};

// ---------------------------------------------------------------------------
// C. Session state — owned by Person B (src/app/state/), single source of
//    truth for what is on screen and what the voice says.
// ---------------------------------------------------------------------------

export type ExerciseId = string; // refine to a literal union once exercises are finalised (see 04-clinical-logic.md)

export type SessionState = {
  phase: 'idle' | 'setup' | 'active' | 'resting' | 'ended';
  exercise: ExerciseId | null;
  affectedSide: 'left' | 'right' | null;
  reps: RepEvent[];
  activeCompensations: CompensationEvent[];
  fatigue: FatigueSignal['level'];
  faceState: 'neutral' | 'attentive' | 'concerned' | 'tired' | 'acknowledging';
  lastSpoken: string | null;
};

// ---------------------------------------------------------------------------
// D. Stream to laptop — owned by Person C (src/streaming/)
// ---------------------------------------------------------------------------

export type LandmarkMessage = {
  type: 'landmarks';
  timestamp: number;
  landmarks: [number, number][]; // [x, y] pairs only, drop z and visibility
};

export type FrameMessage = {
  type: 'frame';
  timestamp: number;
  jpeg: string; // base64, downscaled to ~320px wide, quality ~50
};

export type StatsMessage = {
  type: 'stats';
  reps: number;
  quality: string;
  compensations: string[];
  fatigue: string;
};

export type StreamMessage = LandmarkMessage | FrameMessage | StatsMessage;

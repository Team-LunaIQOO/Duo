/**
 * Fatigue detector — Person C.
 *
 * Consumes PoseFrame and RepEvent, produces FatigueSignal. Shapes are frozen
 * in src/types/contracts.ts; this file imports them and never redefines them.
 *
 * Implements 04-clinical-logic.md "Fatigue detection": three independent
 * rule-based signals over a rolling window of the last 5 reps compared against
 * the first 3 reps of the session. Rule-based on purpose — there is no time to
 * train a classifier and no data to train it on, and a heuristic is honest.
 *
 *   1. rom_decay    romRatio      = mean(recent peaks)     / mean(early peaks)
 *   2. timing_drift durationRatio = mean(recent durations) / mean(early durations)
 *   3. instability  ratio         = instability(recent)    / instability(early)
 *
 *   0 signals -> 'none'   1 signal -> 'slowing'   2+ -> 'fatigued'
 *
 * All thresholds live in ./thresholds.ts and are unvalidated guesses.
 */

import type { FatigueSignal, PoseFrame, RepEvent } from '../types/contracts';
import {
  DEFAULT_FATIGUE_THRESHOLDS,
  type FatigueThresholds,
} from './thresholds';
import {
  trackedAngleFor,
  type TrackedAngleFn,
  type TrackedExercise,
  type WorkingSide,
} from './trackedAngle';

// ---------------------------------------------------------------------------
// Small statistics helpers. Kept local and total — they must never throw or
// return undefined into the signal maths.
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population variance. Returns NaN for fewer than two samples. */
function variance(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / xs.length;
}

const isNum = (v: number): boolean => Number.isFinite(v);

/** A ratio is only meaningful if both sides are finite and the divisor is real. */
function safeRatio(numerator: number, denominator: number): number {
  if (!isNum(numerator) || !isNum(denominator)) return NaN;
  if (Math.abs(denominator) < 1e-9) return NaN;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------
// Per-rep record
// ---------------------------------------------------------------------------

/** One angle observation inside a rep. */
type AngleSample = { t: number; angle: number };

/** What the detector retains per completed rep. */
export type RepRecord = {
  repNumber: number;
  timestamp: number;
  side: RepEvent['side'];
  peakAngle: number;
  durationMs: number;
  /**
   * Normalised jerkiness of the tracked angle during this rep, or NaN when the
   * rep had too few usable frames. See computeInstability.
   */
  instability: number;
};

/** Which of the three rules fired on the most recent evaluation. */
export type FiredSignals = {
  rom_decay: boolean;
  timing_drift: boolean;
  instability: boolean;
};

/** Everything behind a decision, for the calibration log and a debug panel. */
export type FatigueDebug = {
  repsSeen: number;
  ready: boolean;
  /** Window sizes actually used, after shrinking. Null before `ready`. */
  windows: { early: number; recent: number } | null;
  romRatio: number;
  durationRatio: number;
  instabilityRatio: number;
  fired: FiredSignals;
  firedCount: number;
  level: FatigueSignal['level'];
  framesSkipped: number;
};

export type FatigueDetectorOptions = {
  /** Overrides for individual thresholds. Everything unset keeps its default. */
  thresholds?: Partial<FatigueThresholds>;
  /** Exercise whose angle drives the instability signal. Default 'E1'. */
  exercise?: TrackedExercise;
  /**
   * Physical side being exercised. Needed to pick landmarks for the tracked
   * angle. RepEvent carries 'affected' | 'unaffected', which is a clinical
   * label, not a body side — the app module knows the mapping, so it is passed
   * in here rather than guessed.
   */
  workingSide?: WorkingSide;
  /** Custom angle extractor. Overrides `exercise` when supplied. */
  trackedAngle?: TrackedAngleFn;
  /**
   * Only count reps on this side. Default undefined = pool both sides.
   *
   * 04-clinical-logic.md specifies the windows as "last 5 reps" / "first 3
   * reps" without splitting by side. Splitting would need 8 reps *per side*,
   * which a demo set never reaches, so pooling is the default.
   */
  sideFilter?: RepEvent['side'];
  /**
   * Re-emit the current level periodically instead of only on change.
   * Default false — emitting on change keeps Duo from nagging.
   */
  repeatEmissions?: boolean;
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export class FatigueDetector {
  private readonly th: FatigueThresholds;
  private readonly angleOf: TrackedAngleFn;
  private readonly workingSide: WorkingSide;
  private readonly sideFilter?: RepEvent['side'];
  private readonly repeatEmissions: boolean;

  /** Completed reps, oldest first. */
  private reps: RepRecord[] = [];
  /** Angle samples for the rep currently in progress. */
  private pending: AngleSample[] = [];

  private currentLevel: FatigueSignal['level'] = 'none';
  private lastEmittedAt = -Infinity;
  private framesSkipped = 0;
  private lastDebug: FatigueDebug;

  constructor(options: FatigueDetectorOptions = {}) {
    this.th = { ...DEFAULT_FATIGUE_THRESHOLDS, ...options.thresholds };
    this.workingSide = options.workingSide ?? 'left';
    this.sideFilter = options.sideFilter;
    this.repeatEmissions = options.repeatEmissions ?? false;
    this.angleOf =
      options.trackedAngle ??
      trackedAngleFor(options.exercise ?? 'E1', this.th.minLandmarkVisibility);

    this.lastDebug = this.emptyDebug();
  }

  // -- ingest ---------------------------------------------------------------

  /**
   * Feed every PoseFrame here. Frames are buffered as tracked-angle samples and
   * consumed when the matching RepEvent arrives.
   *
   * Frames the vision module cannot vouch for are skipped rather than
   * substituted, per 03-architecture.md: "Do not compute angles off a frame
   * where the relevant landmarks have low visibility. Skip the frame."
   */
  onPoseFrame(frame: PoseFrame): void {
    if (!frame.inFrame || frame.confidence < this.th.minFrameConfidence) {
      this.framesSkipped++;
      return;
    }

    const angle = this.angleOf(frame, this.workingSide);
    if (!isNum(angle)) {
      this.framesSkipped++;
      return;
    }

    this.pending.push({ t: frame.timestamp, angle });

    // Bound the buffer. A long rest between reps would otherwise grow this
    // without limit, and stale samples are discarded at rep close anyway.
    if (this.pending.length > 600) {
      this.pending.splice(0, this.pending.length - 600);
    }
  }

  /**
   * Feed every RepEvent here. Closes the rep, recomputes the three signals and
   * returns a FatigueSignal when the level changed (or when repeatEmissions is
   * on and the suppression window has elapsed). Returns null otherwise, so the
   * caller can pipe the result straight into session state.
   */
  onRepEvent(rep: RepEvent): FatigueSignal | null {
    if (this.sideFilter && rep.side !== this.sideFilter) {
      this.pending = [];
      return null;
    }

    this.reps.push({
      repNumber: rep.repNumber,
      timestamp: rep.timestamp,
      side: rep.side,
      peakAngle: rep.peakAngle,
      durationMs: rep.durationMs,
      instability: computeInstability(
        this.samplesForRep(rep),
        this.th.minSamplesForInstability
      ),
    });
    this.pending = [];

    const debug = this.evaluate();
    this.lastDebug = debug;

    const changed = debug.level !== this.currentLevel;
    const stale = rep.timestamp - this.lastEmittedAt >= this.th.repeatSuppressionMs;
    const shouldEmit = changed || (this.repeatEmissions && stale);

    this.currentLevel = debug.level;
    if (!shouldEmit) return null;

    this.lastEmittedAt = rep.timestamp;
    return {
      timestamp: rep.timestamp,
      level: debug.level,
      reason: primaryReason(debug.fired),
    };
  }

  // -- inspection -----------------------------------------------------------

  /** Current fatigue level. Mirrors SessionState.fatigue. */
  get level(): FatigueSignal['level'] {
    return this.currentLevel;
  }

  /** Ratios and firing state behind the last decision. For calibration. */
  get debug(): FatigueDebug {
    return this.lastDebug;
  }

  /** Completed reps, for the session summary and the calibration log. */
  get repRecords(): readonly RepRecord[] {
    return this.reps;
  }

  reset(): void {
    this.reps = [];
    this.pending = [];
    this.currentLevel = 'none';
    this.lastEmittedAt = -Infinity;
    this.framesSkipped = 0;
    this.lastDebug = this.emptyDebug();
  }

  // -- internals ------------------------------------------------------------

  /**
   * Samples belonging to the rep that just closed.
   *
   * RepEvent.timestamp is taken to be the moment the rep completed, so the rep
   * spans [timestamp - durationMs, timestamp]. Windowing by time discards the
   * rest period between reps, which would otherwise flatten the variance and
   * make every rep look artificially smooth.
   *
   * If that window catches nothing — clock skew, or a producer that timestamps
   * reps at their start — fall back to the whole buffer rather than dropping
   * the instability signal entirely.
   */
  private samplesForRep(rep: RepEvent): number[] {
    const start = rep.timestamp - rep.durationMs;
    const within = this.pending.filter((s) => s.t >= start && s.t <= rep.timestamp);
    const chosen = within.length >= 2 ? within : this.pending;
    return chosen.map((s) => s.angle);
  }

  /** Runs the three rules over the current windows. Pure with respect to state. */
  private evaluate(): FatigueDebug {
    const repsSeen = this.reps.length;
    const windows = chooseWindows(repsSeen, this.th);

    if (!windows) {
      return { ...this.emptyDebug(), repsSeen, ready: false };
    }

    const early = this.reps.slice(0, windows.early);
    const recent = this.reps.slice(-windows.recent);

    const romRatio = safeRatio(
      mean(recent.map((r) => r.peakAngle)),
      mean(early.map((r) => r.peakAngle))
    );
    const durationRatio = safeRatio(
      mean(recent.map((r) => r.durationMs)),
      mean(early.map((r) => r.durationMs))
    );

    // Reps whose instability could not be measured are excluded rather than
    // counted as zero, which would fake a stability improvement.
    const recentInst = recent.map((r) => r.instability).filter(isNum);
    const earlyInst = early.map((r) => r.instability).filter(isNum);
    const instabilityRatio =
      recentInst.length > 0 && earlyInst.length > 0
        ? safeRatio(mean(recentInst), mean(earlyInst))
        : NaN;

    // A NaN ratio means "not measurable", which must read as "not fatigued".
    const fired: FiredSignals = {
      rom_decay: isNum(romRatio) && romRatio < this.th.romDecayRatio,
      timing_drift: isNum(durationRatio) && durationRatio > this.th.timingDriftRatio,
      instability:
        isNum(instabilityRatio) && instabilityRatio > this.th.instabilityRatio,
    };

    const firedCount =
      (fired.rom_decay ? 1 : 0) +
      (fired.timing_drift ? 1 : 0) +
      (fired.instability ? 1 : 0);

    const level: FatigueSignal['level'] =
      firedCount >= 2 ? 'fatigued' : firedCount === 1 ? 'slowing' : 'none';

    return {
      repsSeen,
      ready: true,
      windows,
      romRatio,
      durationRatio,
      instabilityRatio,
      fired,
      firedCount,
      level,
      framesSkipped: this.framesSkipped,
    };
  }

  private emptyDebug(): FatigueDebug {
    return {
      repsSeen: this.reps.length,
      ready: false,
      windows: null,
      romRatio: NaN,
      durationRatio: NaN,
      instabilityRatio: NaN,
      fired: { rom_decay: false, timing_drift: false, instability: false },
      firedCount: 0,
      level: 'none',
      framesSkipped: this.framesSkipped,
    };
  }
}

// ---------------------------------------------------------------------------
// Window selection
// ---------------------------------------------------------------------------

/**
 * Picks the early and recent window sizes for a given rep count.
 *
 * 04-clinical-logic.md specifies "the last 5 reps compared against the first 3
 * reps". Those are treated as maximums rather than fixed sizes, because a demo
 * set is short: requiring a full 3 + 5 means nothing can fire until rep 8,
 * and 06-demo-and-pitch.md beat 5 needs fatigue to appear near the end of a
 * set that may only run to nine or ten.
 *
 * The windows are never allowed to overlap. An overlapping window compares a
 * set of reps partly against itself, which pulls every ratio toward 1.0 and
 * quietly mutes the detector — a far worse failure than firing slightly late,
 * because it looks like the feature simply does not work.
 *
 * Returns null when there are not yet enough reps to say anything.
 */
export function chooseWindows(
  repsSeen: number,
  th: Pick<
    FatigueThresholds,
    'earlyWindowSize' | 'recentWindowSize' | 'minRepsBeforeFatigue' | 'minWindowSize'
  >
): { early: number; recent: number } | null {
  if (repsSeen < th.minRepsBeforeFatigue) return null;

  // Give the early window at most half the reps, so the recent window always
  // has room, then let the recent window take what is left up to its maximum.
  const early = Math.min(th.earlyWindowSize, Math.floor(repsSeen / 2));
  const recent = Math.min(th.recentWindowSize, repsSeen - early);

  if (early < th.minWindowSize || recent < th.minWindowSize) return null;

  return { early, recent };
}

// ---------------------------------------------------------------------------
// Signal 3: instability
// ---------------------------------------------------------------------------

/**
 * Normalised jerkiness of one rep. Higher = more tremulous.
 *
 * 04-clinical-logic.md asks for "frame-to-frame variance in the tracked angle
 * during the rep, normalised". Taken literally, the variance of the raw angle
 * measures how *big* the rep was, not how shaky — a full-range rep would score
 * as unstable purely for being full-range. So:
 *
 *   1. Difference consecutive angles to get angular velocity. A smooth rep has
 *      near-constant velocity; a tremulous one has velocity that fluctuates.
 *   2. Take the variance of that velocity.
 *   3. Divide by the rep's angular range, so a small rep and a large rep with
 *      the same relative shakiness score the same.
 *
 * Returns NaN when the rep has too few usable frames to say anything.
 *
 * TUNE: this normalisation is a judgement call, not a value from the doc.
 * Log raw velocity variance alongside the normalised figure during
 * calibration before trusting the 1.50 threshold.
 */
export function computeInstability(angles: number[], minSamples: number): number {
  if (angles.length < Math.max(3, minSamples)) return NaN;

  const velocities: number[] = [];
  for (let i = 1; i < angles.length; i++) {
    velocities.push(angles[i] - angles[i - 1]);
  }

  const v = variance(velocities);
  if (!isNum(v)) return NaN;

  const range = Math.max(...angles) - Math.min(...angles);
  // Guard a near-static rep: dividing by a tiny range explodes the score.
  if (range < 1) return NaN;

  return v / range;
}

/**
 * FatigueSignal carries a single `reason`, but two or three rules can fire at
 * once. The contract is frozen, so pick one deterministically.
 *
 * Priority: rom_decay, then timing_drift, then instability. ROM decay is the
 * most clinically meaningful of the three (the arm is measurably not getting
 * as far) and the most legible to a user, so it wins when several fire.
 *
 * Callers wanting the full picture read FatigueDetector.debug.fired.
 */
export function primaryReason(fired: FiredSignals): FatigueSignal['reason'] {
  if (fired.rom_decay) return 'rom_decay';
  if (fired.timing_drift) return 'timing_drift';
  return 'instability';
}

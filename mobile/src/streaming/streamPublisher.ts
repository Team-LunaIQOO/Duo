/**
 * Stream publisher — Person C.
 *
 * Turns the session's live data into the three message shapes frozen in
 * src/types/contracts.ts and pushes them through a StreamTransport at the rates
 * 03-architecture.md specifies.
 *
 *   LandmarkMessage  ~20/sec   [x, y] pairs only, z and visibility dropped
 *   FrameMessage     5-8/sec   base64 JPEG, downscaled ~320px, quality ~50
 *   StatsMessage     event driven, sent only when the content actually changes
 *
 * Throttling lives here rather than at the call site so that Person A's frame
 * processor and Person B's state machine can call these on every single update
 * without thinking about rates.
 */

import type {
  FrameMessage,
  LandmarkMessage,
  PoseFrame,
  StatsMessage,
} from '../types/contracts';
import { DEFAULT_STREAM_CONFIG, type StreamConfig } from './config';
import type { StreamTransport, TransportState } from './transport';

/** The stats payload without the discriminant, which the publisher adds. */
export type StatsPayload = Omit<StatsMessage, 'type'>;

export type PublisherCounters = {
  landmarksSent: number;
  landmarksThrottled: number;
  framesSent: number;
  framesThrottled: number;
  statsSent: number;
  statsDeduped: number;
  /** Messages the transport could not deliver (disconnected or oversized). */
  dropped: number;
};

/** Monotonic-ish clock, injectable so the self-test can drive time directly. */
export type Clock = () => number;

export type StreamPublisherOptions = {
  config?: Partial<StreamConfig>;
  clock?: Clock;
};

export class StreamPublisher {
  private readonly transport: StreamTransport;
  private readonly config: StreamConfig;
  private readonly now: Clock;

  private readonly landmarkIntervalMs: number;
  private readonly frameIntervalMs: number;

  /**
   * Next time each stream is due, on an ideal cadence grid.
   *
   * Deliberately not "time since the last send". Camera frames arrive at their
   * own discrete rate, so gating on elapsed-since-last-send quantises to a
   * multiple of the input interval: a 50 fps camera throttled to 20/sec lands
   * on a 60 ms grid (the first input frame at or past 50 ms), yielding
   * 16.7/sec instead of 20. Advancing a due-time by exactly one interval keeps
   * the long-run average on target.
   */
  private landmarkDueAt = -Infinity;
  private frameDueAt = -Infinity;
  private lastStatsKey: string | null = null;
  /** Messages the publisher itself refused, before reaching the transport. */
  private oversizedDropped = 0;

  private counters: PublisherCounters = {
    landmarksSent: 0,
    landmarksThrottled: 0,
    framesSent: 0,
    framesThrottled: 0,
    statsSent: 0,
    statsDeduped: 0,
    dropped: 0,
  };

  /**
   * Advances a due-time by one interval, resynchronising if the stream has
   * been idle. Without the resync, a gap (a rest between reps, a disconnect)
   * would leave the grid in the past and let a burst through to catch up.
   */
  private advance(dueAt: number, now: number, intervalMs: number): number {
    const next = dueAt + intervalMs;
    return next <= now ? now + intervalMs : next;
  }

  constructor(transport: StreamTransport, options: StreamPublisherOptions = {}) {
    this.transport = transport;
    this.config = { ...DEFAULT_STREAM_CONFIG, ...options.config };
    this.now = options.clock ?? (() => Date.now());

    this.landmarkIntervalMs = 1000 / this.config.landmarkFps;
    this.frameIntervalMs = 1000 / this.config.frameFps;
  }

  // -- lifecycle ------------------------------------------------------------

  start(): void {
    this.transport.connect();
  }

  stop(): void {
    this.transport.close();
  }

  get state(): TransportState {
    return this.transport.state;
  }

  get stats(): PublisherCounters {
    return {
      ...this.counters,
      dropped: this.transport.droppedCount + this.oversizedDropped,
    };
  }

  /**
   * Clears throttle and dedup state so a new session starts clean. Does not
   * touch the socket — reconnecting between sessions would only add a window
   * where the viewer is blank.
   */
  resetSession(): void {
    this.landmarkDueAt = -Infinity;
    this.frameDueAt = -Infinity;
    this.lastStatsKey = null;
  }

  // -- publishing -----------------------------------------------------------

  /**
   * Call with every PoseFrame. Throttled to landmarkFps.
   *
   * Drops z and visibility, as the contract requires: the viewer draws a 2D
   * skeleton and has no use for either, and they would roughly double the
   * payload at 20 messages a second.
   *
   * DISPLAY IS NOT GATED ON THE ANALYSIS VERDICT. An earlier version skipped
   * frames whose `inFrame` was false, on the theory that a skeleton built from
   * untrusted landmarks looks worse than one holding still. On the real device
   * that was badly wrong: `inFrame` is derived from how many of all 33
   * landmarks are visible, so a seated upper-body shot — legs permanently out
   * of frame — flips it false the moment an arm rises. The laptop skeleton
   * froze every few seconds and read as a dropped connection.
   *
   * Analysis still refuses untrusted frames, in the vision pipeline and in the
   * fatigue detector, which is where 03-architecture.md's "do not compute
   * angles off a frame where the relevant landmarks have low visibility"
   * belongs. Showing the operator a live skeleton is a separate concern.
   *
   * The only frames rejected here are structurally unusable ones.
   */
  publishPoseFrame(frame: PoseFrame): boolean {
    if (!frame.landmarks || frame.landmarks.length === 0) return false;

    const t = this.now();
    if (t < this.landmarkDueAt) {
      this.counters.landmarksThrottled++;
      return false;
    }
    this.landmarkDueAt = this.advance(this.landmarkDueAt, t, this.landmarkIntervalMs);

    const message: LandmarkMessage = {
      type: 'landmarks',
      timestamp: frame.timestamp,
      landmarks: frame.landmarks.map((l): [number, number] => [l.x, l.y]),
    };

    const ok = this.transport.send(message);
    if (ok) this.counters.landmarksSent++;
    return ok;
  }

  /**
   * Call with each encoded camera frame. Throttled to frameFps.
   *
   * The caller is responsible for downscaling to ~320px and encoding at
   * quality ~50 *before* calling: 03-architecture.md is explicit that JPEG
   * encoding is expensive and must be capped and downscaled before encoding,
   * not after. Throttling here does not save that cost — it only protects the
   * link — so the encode itself must also be gated. `shouldEncodeFrame()`
   * exists for exactly that.
   */
  publishJpegFrame(jpegBase64: string, timestamp: number): boolean {
    const t = this.now();
    if (t < this.frameDueAt) {
      this.counters.framesThrottled++;
      return false;
    }

    // Size is publisher policy, enforced before the transport so that it holds
    // for every transport rather than only the socket one. An over-budget JPEG
    // means the encode settings are wrong (03-architecture.md: downscale to
    // ~320px, quality ~50); dropping it protects the link either way.
    if (jpegBase64.length > this.config.maxMessageBytes) {
      this.oversizedDropped++;
      return false;
    }

    this.frameDueAt = this.advance(this.frameDueAt, t, this.frameIntervalMs);

    const message: FrameMessage = { type: 'frame', timestamp, jpeg: jpegBase64 };

    const ok = this.transport.send(message);
    if (ok) this.counters.framesSent++;
    return ok;
  }

  /**
   * Whether a camera frame is due, so the caller can skip the encode entirely
   * when it is not. Call this before doing any JPEG work.
   *
   * Does not consume the slot — publishJpegFrame does that.
   */
  shouldEncodeFrame(): boolean {
    return this.now() >= this.frameDueAt;
  }

  /**
   * Event driven, so unthrottled — but deduplicated. Person B's state machine
   * can call this on every state change without flooding the link when
   * nothing the viewer displays has actually moved.
   */
  publishStats(payload: StatsPayload): boolean {
    // sessionElapsedMs is excluded from the dedup key on purpose: it changes
    // every tick of the 1-second republish timer in useSessionController, and
    // keying on it would defeat dedup entirely, sending a stats message every
    // second regardless of whether anything the viewer actually displays
    // changed. The republish timer already guarantees the timer value reaches
    // the viewer at 1 Hz without needing to be part of the change detector.
    const key = JSON.stringify([
      payload.reps,
      payload.quality,
      payload.compensations,
      payload.fatigue,
      payload.repHistory,
      payload.compensationHistory,
    ]);

    if (key === this.lastStatsKey) {
      this.counters.statsDeduped++;
      return false;
    }
    this.lastStatsKey = key;

    const message: StatsMessage = { type: 'stats', ...payload };

    const ok = this.transport.send(message);
    if (ok) this.counters.statsSent++;
    // A dropped stats message must not be remembered as sent, or the viewer
    // stays stale until the value changes again.
    if (!ok) this.lastStatsKey = null;
    return ok;
  }

  /**
   * Acknowledgement only, sent once per snapshot request -- never the image
   * itself. Unthrottled and never deduplicated: two snapshot attempts in a
   * row must each get their own result, unlike stats where a repeated value
   * is genuinely nothing new to report.
   */
  publishSnapshotResult(payload: { ok: boolean; reason?: string }): boolean {
    return this.transport.send({ type: 'snapshot_result', ...payload });
  }
}

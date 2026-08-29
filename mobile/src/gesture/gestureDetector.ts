/**
 * Gesture pause: a raised hand, either side, means pause.
 *
 * 02-product-spec.md, "Control methods": "One gesture only: a raised open
 * hand, either hand, means pause. Not a vocabulary. One gesture, either side,
 * easy to perform with limited dexterity." It is Tier 3 in 05-build-plan.md —
 * additive, and touch must keep working as the route that never fails.
 *
 * No new dependency and no new model. The app already receives 33 BlazePose
 * landmarks per frame, and a raised hand is decidable from six of the ones
 * listed in 04-clinical-logic.md's index table (shoulders, elbows, wrists).
 *
 * ## What is actually detected, stated honestly
 *
 * Not the fingers. BlazePose's hand points (17-22) are derived stubs and are
 * not reliable enough to tell an open palm from a fist, so this detects the
 * posture: a bent arm with the hand held up beside the head. That is why
 * nothing here is named `open_hand` — the name would be a claim the code
 * cannot support.
 *
 * ## Why the demo exercise makes this hard
 *
 * The demo exercise is shoulder abduction — raising an arm. So "the arm is up"
 * is worthless on its own: it is the exercise. Four geometric tests separate
 * the gesture from a rep, and the interesting ones are the middle two:
 *
 *   1. wrist clearly above the shoulder       rules out the resting arm and E3
 *                                             elbow flexion, where the wrist
 *                                             finishes below shoulder height
 *   2. elbow bent (interior angle <= 130 deg) abduction is performed with a
 *                                             straight arm at every height, so
 *                                             this alone rejects a clean rep
 *                                             taken to 150 degrees
 *   3. elbow at or below shoulder height      a sloppy rep with a bent elbow
 *                                             and the arm overhead is the one
 *                                             shape that resembles a raised
 *                                             hand; there the elbow rides about
 *                                             half a shoulder width above the
 *                                             shoulder, where a stop-hand keeps
 *                                             it at or below
 *   4. forearm points up, not across the body
 *
 * On top of the geometry, the posture must be held still. A rep passes through
 * shapes; a gesture is held. The wrist may drift no more than a quarter of a
 * shoulder width during the hold window, and drift restarts the timer. This is
 * the argument 04-clinical-logic.md makes for debouncing compensations,
 * applied harder: a pause that fires in the middle of a set is worse for the
 * user than no gesture at all.
 *
 * ## Known residual false positive
 *
 * A "goalpost" arm — abducted to about 90 degrees, elbow bent 90 degrees,
 * forearm vertical — is geometrically a raised hand, because it is one. It is
 * not how E1 is performed (the instruction is a straight arm), and passing
 * through it mid-rep does not fire, because of the hold and stillness
 * requirements. Deliberately stopping there and staying still for a second
 * will pause the session. Documented rather than papered over; the self-test
 * asserts both halves of that behaviour.
 *
 * ## Mirroring
 *
 * The gesture is side-agnostic by design, so the unresolved MIRROR_MODE
 * question in src/app/vision/VisionCamera.tsx cannot invert it. If left and
 * right are swapped, a raised right hand is reported as a raised left hand and
 * the session still pauses.
 */

import type { Landmark, PoseFrame } from '../types/contracts';
import { angleBetween, distance, midpoint, validLandmarks } from '../vision/geometry';
import { LandmarkIndex } from '../vision/landmarks';
import { GESTURE_THRESHOLDS as T } from './thresholds';

export type GestureSide = 'left' | 'right';

/**
 * Emitted once per completed hold. Deliberately not added to
 * src/types/contracts.ts, which is frozen — this type is local to the gesture
 * module and crosses no boundary the other two people depend on.
 */
export type GestureEvent = {
  timestamp: number;
  type: 'raised_hand';
  side: GestureSide;
  /** How long the posture was held before it fired. */
  heldMs: number;
};

/** Why an arm is not currently reading as a raised hand. Dev overlay only. */
export type GestureRejection =
  | 'no_landmarks'
  | 'wrist_low'
  | 'arm_straight'
  | 'elbow_high'
  | 'forearm_not_up';

export type GestureDebug = {
  /** The side currently holding the posture, if any. */
  posture: GestureSide | null;
  /** How long the current hold has been running, in ms. */
  heldMs: number;
  /** For the arm closest to qualifying, the first test it fails. */
  reject: GestureRejection | null;
  /** True once fired, until the posture is released. */
  latched: boolean;
  firedCount: number;
};

type ArmMetrics = {
  /** Wrist height above the shoulder, in shoulder widths. Negative is below. */
  wristRise: number;
  /** Elbow height above the shoulder, in shoulder widths. Negative is below. */
  elbowRise: number;
  /** Wrist height above the elbow, in shoulder widths. */
  wristAboveElbow: number;
  /** Interior angle at the elbow, degrees. 180 is a straight arm. */
  elbowAngleDeg: number;
  /**
   * Wrist position relative to the midpoint of the shoulders, not to the
   * image. The stillness test is about the arm holding still, not the person:
   * someone who shifts in the chair with their hand up is still gesturing,
   * while a rep moves the wrist relative to the trunk by more than a shoulder
   * width. Measuring in image coordinates would confuse the two.
   */
  wristRelX: number;
  wristRelY: number;
};

function armIndices(side: GestureSide) {
  return side === 'left'
    ? {
        shoulder: LandmarkIndex.leftShoulder,
        elbow: LandmarkIndex.leftElbow,
        wrist: LandmarkIndex.leftWrist,
      }
    : {
        shoulder: LandmarkIndex.rightShoulder,
        elbow: LandmarkIndex.rightElbow,
        wrist: LandmarkIndex.rightWrist,
      };
}

/**
 * Measures one arm, or returns null if the landmarks it needs are unusable.
 *
 * Heights are inverted from image space on purpose: y grows downward in a
 * normalised image, and every threshold here reads better as "how far above".
 */
function armMetrics(
  landmarks: Landmark[],
  side: GestureSide,
  shoulderWidth: number,
  trunk: { x: number; y: number }
): ArmMetrics | null {
  const { shoulder, elbow, wrist } = armIndices(side);
  if (!validLandmarks(landmarks, [shoulder, elbow, wrist], T.minVisibility)) return null;

  const s = landmarks[shoulder];
  const e = landmarks[elbow];
  const w = landmarks[wrist];

  const elbowAngleDeg = angleBetween(s, e, w);
  if (!Number.isFinite(elbowAngleDeg)) return null;

  return {
    wristRise: (s.y - w.y) / shoulderWidth,
    elbowRise: (s.y - e.y) / shoulderWidth,
    wristAboveElbow: (e.y - w.y) / shoulderWidth,
    elbowAngleDeg,
    wristRelX: w.x - trunk.x,
    wristRelY: w.y - trunk.y,
  };
}

/** The first test this arm fails, in a fixed order, or null if it passes all four. */
function rejectionFor(m: ArmMetrics): GestureRejection | null {
  if (m.wristRise < T.minWristRise) return 'wrist_low';
  if (m.elbowAngleDeg > T.maxElbowAngleDeg) return 'arm_straight';
  if (m.elbowRise > T.maxElbowRise) return 'elbow_high';
  if (m.wristAboveElbow < T.minWristAboveElbow) return 'forearm_not_up';
  return null;
}

type Candidate = {
  side: GestureSide;
  startedAt: number;
  /** Where the wrist sat relative to the shoulders when this hold began. */
  anchorX: number;
  anchorY: number;
  /** Shoulder width at that moment, so drift stays normalised consistently. */
  anchorWidth: number;
};

/**
 * Stateful, frame by frame. One instance per app, held in a ref — the frame
 * handler that drives it must keep a stable identity (see the note in
 * src/app/vision/useVisionStream.ts about the ThinkSys bridge subscribing to
 * its native event with an empty dependency array), so none of this state may
 * live in a closure.
 */
export class GesturePauseDetector {
  private candidate: Candidate | null = null;
  private lastFrameAt: number | null = null;
  private lastEmittedAt: number | null = null;
  private absentSince: number | null = null;
  private latched = false;
  private firedCount = 0;
  private lastReject: GestureRejection | null = 'no_landmarks';
  private heldMs = 0;

  /**
   * Feed one PoseFrame. Returns an event the moment a hold completes, and null
   * on every other frame.
   *
   * It deliberately does not consult `frame.inFrame` or `frame.confidence`:
   * both are computed across all 33 landmarks, and 03-architecture.md's
   * implementation-status table records that as too blunt for seated
   * upper-body work, where the legs are legitimately out of shot all session.
   * Per-landmark visibility on the points this actually reads is the stricter
   * test, not the looser one.
   */
  update(frame: PoseFrame): GestureEvent | null {
    const now = frame.timestamp;

    // A long gap means we did not observe what happened in between, so no hold
    // can be said to have continued across it.
    if (this.lastFrameAt !== null && now - this.lastFrameAt > T.maxFrameGapMs) {
      this.candidate = null;
      this.absentSince = now;
    }
    this.lastFrameAt = now;

    const { landmarks } = frame;
    const shouldersVisible = validLandmarks(
      landmarks,
      [LandmarkIndex.leftShoulder, LandmarkIndex.rightShoulder],
      T.minVisibility
    );
    const width = shouldersVisible
      ? distance(landmarks[LandmarkIndex.leftShoulder], landmarks[LandmarkIndex.rightShoulder])
      : 0;

    if (width <= 1e-6) return this.stayAbsent(now, 'no_landmarks');

    const trunk = midpoint(
      landmarks[LandmarkIndex.leftShoulder],
      landmarks[LandmarkIndex.rightShoulder]
    );
    const left = armMetrics(landmarks, 'left', width, trunk);
    const right = armMetrics(landmarks, 'right', width, trunk);
    const leftReject: GestureRejection | null = left ? rejectionFor(left) : 'no_landmarks';
    const rightReject: GestureRejection | null = right ? rejectionFor(right) : 'no_landmarks';

    // Prefer whichever side is already mid-hold, so a twitch on the other arm
    // cannot reset a legitimate one. Otherwise take whichever side qualifies,
    // and if both do, the one held higher.
    let side: GestureSide | null = null;
    if (leftReject === null && rightReject === null) {
      const both = this.candidate?.side;
      side = both ?? (left!.wristRise >= right!.wristRise ? 'left' : 'right');
    } else if (leftReject === null) {
      side = 'left';
    } else if (rightReject === null) {
      side = 'right';
    }

    if (side === null) {
      // Report whichever arm came closest, so the dev overlay says something
      // useful while a threshold is being tuned.
      const closest =
        (left?.wristRise ?? -Infinity) >= (right?.wristRise ?? -Infinity) ? leftReject : rightReject;
      return this.stayAbsent(now, closest);
    }

    this.lastReject = null;
    this.absentSince = null;

    const metrics = side === 'left' ? left! : right!;

    // Stillness. Drifting past the limit is not a rejection: it restarts the
    // hold from where the wrist is now. An arm travelling through this posture
    // during a rep therefore never accumulates hold time, while a hand that
    // settles starts counting from the moment it settles.
    const anchor: Candidate = {
      side,
      startedAt: now,
      anchorX: metrics.wristRelX,
      anchorY: metrics.wristRelY,
      anchorWidth: width,
    };

    if (this.candidate && this.candidate.side === side) {
      const drift =
        Math.hypot(
          metrics.wristRelX - this.candidate.anchorX,
          metrics.wristRelY - this.candidate.anchorY
        ) / this.candidate.anchorWidth;
      if (drift > T.maxDriftDuringHold) this.candidate = anchor;
    } else {
      this.candidate = anchor;
    }

    this.heldMs = now - this.candidate.startedAt;

    if (this.latched) return null;
    if (this.heldMs < T.holdMs) return null;
    if (this.lastEmittedAt !== null && now - this.lastEmittedAt < T.cooldownMs) return null;

    this.latched = true;
    this.lastEmittedAt = now;
    this.firedCount += 1;
    return { timestamp: now, type: 'raised_hand', side, heldMs: this.heldMs };
  }

  /**
   * No arm is holding the posture on this frame. Clears the hold, and clears
   * the latch once the posture has been absent long enough — a gesture must be
   * released before another one can fire, so a hand left up cannot pause
   * repeatedly.
   */
  private stayAbsent(now: number, reject: GestureRejection | null): null {
    this.lastReject = reject;
    this.heldMs = 0;
    this.candidate = null;
    this.absentSince ??= now;
    if (this.latched && now - this.absentSince >= T.releaseMs) this.latched = false;
    return null;
  }

  /** Drops all hold state. Called when a session restarts. */
  reset(): void {
    this.candidate = null;
    this.lastFrameAt = null;
    this.lastEmittedAt = null;
    this.absentSince = null;
    this.latched = false;
    this.heldMs = 0;
    this.lastReject = 'no_landmarks';
  }

  get debug(): GestureDebug {
    return {
      posture: this.candidate?.side ?? null,
      heldMs: this.heldMs,
      reject: this.lastReject,
      latched: this.latched,
      firedCount: this.firedCount,
    };
  }
}

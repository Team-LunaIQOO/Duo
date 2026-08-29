/**
 * Where the eyes are looking.
 *
 * 02-product-spec.md's eye-state table specifies this and it was never built:
 * "Attentive | Session active, movement good | Eyes track user's head position
 * from the pose landmarks." The nose is landmark 0, it already arrives about
 * twenty times a second, and nothing was reading it.
 *
 * ## Why this is a class holding Animated.Values rather than React state
 *
 * Head position updates at camera rate. Putting it in state would re-render
 * the whole app twenty times a second, on the same JS thread that runs rep
 * counting, the three compensation detectors and fatigue — the parts that are
 * the actual product. So nothing here calls setState. The values are
 * Animated.Values written with setValue and consumed by a native-driven
 * transform, which means the eye movement is handled on the UI thread and
 * costs the JS thread one exponential-average update per frame.
 *
 * The same rule the gesture detector follows: all state lives in the instance,
 * so the frame handler feeding it keeps a stable identity (see the note in
 * src/app/vision/useVisionStream.ts about the ThinkSys bridge subscribing with
 * an empty dependency array).
 *
 * ## Mirroring
 *
 * Which way the eyes should move depends on whether the frames are mirrored,
 * which is the one thing about this camera nobody has confirmed — see
 * MIRROR_MODE in src/app/vision/VisionCamera.tsx and "Known gaps" in
 * RUNNING.md. GAZE_X_SIGN below is the value that pairs with MIRROR_MODE
 * 'none', reasoned rather than measured.
 *
 * That is a feature, not a hazard. Head tracking makes the mirror question
 * visible in about one second — lean to your right and watch which way the
 * eyes go — where before it needed a deliberate one-armed test. If the eyes
 * follow you, both constants are right. If they run away from you, flip this
 * one; if left and right reps are also swapped, MIRROR_MODE is the wrong one
 * to flip instead.
 */

import { Animated } from 'react-native';

import type { Landmark } from '../../types/contracts';
import { LandmarkIndex } from '../../vision/landmarks';

/** Flip to -1 if the eyes track away from the user. See the note above. */
export const GAZE_X_SIGN = 1;

/**
 * How far the head has to move from its resting position for the eyes to reach
 * full travel, in normalised image units.
 *
 * Chosen by sweeping this whole pipeline against a real ten-minute recording
 * off the device (14,406 usable frames, replayed through the exact maths
 * below). The column that matters is how often the eyes slam to the edge of
 * their travel and sit there, which reads as broken rather than attentive:
 *
 *     range   |gaze| p50   |gaze| p90   pegged   off-centre
 *      0.10       0.20         0.91     17.4%       96%
 *      0.15       0.13         0.69     10.6%       90%
 *      0.20       0.10         0.54      6.3%       85%
 *      0.25       0.08         0.44      3.7%       79%
 *      0.40       0.05         0.28      0.2%       68%
 *
 * 0.25 keeps the eyes visibly off-centre about four fifths of the time while
 * pegging on under 4% of updates. Tighter tracks more eagerly but spends a
 * sixth of the session against the stop. The two axes share a value because
 * measured head deviation came out near-identical on both, against the
 * intuition that vertical movement would be smaller.
 *
 * The same recording is in the repo tooling: viewer/record-landmarks.js
 * captures one, and this sweep is reproducible from it.
 */
const X_RANGE = 0.25; // TUNE
const Y_RANGE = 0.25; // TUNE

/**
 * How fast the resting position follows the person.
 *
 * The eyes track deviation from *where this user normally sits*, not from the
 * centre of the image, because where they sit depends entirely on how the
 * phone was propped. Assuming the middle of the frame was wrong on the real
 * recording — a seated person's head is often nowhere near it — and would have
 * left the eyes pinned to one side for a whole session.
 *
 * At roughly 12 updates a second this is an eight-second time constant:
 * faster than that reads as the user moving, slower is them settling into a
 * new position, and the eyes quietly recentre on it.
 */
const CENTRE_ADAPT = 0.01; // TUNE

/** Below this the nose is not trustworthy and the gaze drifts back to centre. */
const MIN_VISIBILITY = 0.5;

/** Updates faster than this are dropped. Eyes do not need 20fps to read as alive. */
const UPDATE_INTERVAL_MS = 80;

/**
 * Exponential smoothing factor. Landmark noise is a few pixels frame to frame;
 * without this the eyes buzz rather than glide, which reads as broken rather
 * than attentive.
 */
const SMOOTHING = 0.22;

/** No fresh pose for this long and the eyes return to centre. */
const STALE_MS = 1200;

/** How fast the eyes recentre once tracking is lost. */
const DECAY = 0.12;

const clamp = (value: number, limit = 1) => Math.max(-limit, Math.min(limit, value));

export class GazeController {
  /** Horizontal gaze, -1 (screen left) to 1 (screen right). */
  readonly x = new Animated.Value(0);
  /** Vertical gaze, -1 (up) to 1 (down). */
  readonly y = new Animated.Value(0);

  /** True while a head is actually being followed, for the dev overlay. */
  tracking = false;

  /**
   * The last values written, mirrored as plain numbers.
   *
   * Animated.Value has no public reader, and this feature is otherwise
   * impossible to confirm on the device: eyes that track and eyes that sit
   * still look identical unless someone is in front of the camera to move.
   * The same reasoning that put compensation and gesture behind the dev
   * overlay applies here.
   */
  debugX = 0;
  debugY = 0;

  private currentX = 0;
  private currentY = 0;
  /** Where the head rests. Null until the first usable pose seeds it. */
  private centreX: number | null = null;
  private centreY = 0;
  private lastUpdateAt = 0;
  private lastPoseAt = 0;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Feed one frame's landmarks. Cheap enough to call on every frame — it
   * returns immediately between updates rather than doing the work and
   * discarding it.
   */
  update(landmarks: Landmark[], now: number): void {
    const nose = landmarks[LandmarkIndex.nose];
    if (!nose || nose.visibility < MIN_VISIBILITY) return;

    if (now - this.lastUpdateAt < UPDATE_INTERVAL_MS) return;
    this.lastUpdateAt = now;
    this.lastPoseAt = now;
    this.tracking = true;

    // The first usable pose seeds the resting position, so the eyes start
    // centred on whoever is actually there rather than snapping to a corner.
    if (this.centreX === null) {
      this.centreX = nose.x;
      this.centreY = nose.y;
    }

    const targetX = clamp(((nose.x - this.centreX) / X_RANGE) * GAZE_X_SIGN);
    const targetY = clamp((nose.y - this.centreY) / Y_RANGE);

    this.centreX += (nose.x - this.centreX) * CENTRE_ADAPT;
    this.centreY += (nose.y - this.centreY) * CENTRE_ADAPT;

    this.currentX += (targetX - this.currentX) * SMOOTHING;
    this.currentY += (targetY - this.currentY) * SMOOTHING;

    this.debugX = this.currentX;
    this.debugY = this.currentY;
    this.x.setValue(this.currentX);
    this.y.setValue(this.currentY);
  }

  /**
   * Recentres the eyes when the pose stream stops — the user has stepped out
   * of frame, or the session has ended. Eyes frozen mid-glance at nothing look
   * broken; eyes returning to centre look like they are waiting.
   */
  start(): void {
    if (this.decayTimer) return;
    this.decayTimer = setInterval(() => {
      if (Date.now() - this.lastPoseAt < STALE_MS) return;
      this.tracking = false;

      if (Math.abs(this.currentX) < 0.01 && Math.abs(this.currentY) < 0.01) {
        // Fully recentred. Forget the resting position too, so whoever sits
        // down next is measured from where *they* are — otherwise a second
        // person in a different chair starts with the eyes pinned to one side.
        this.centreX = null;
        return;
      }

      this.currentX += (0 - this.currentX) * DECAY;
      this.currentY += (0 - this.currentY) * DECAY;
      this.debugX = this.currentX;
      this.debugY = this.currentY;
      this.x.setValue(this.currentX);
      this.y.setValue(this.currentY);
    }, 100);
  }

  stop(): void {
    if (!this.decayTimer) return;
    clearInterval(this.decayTimer);
    this.decayTimer = null;
  }
}

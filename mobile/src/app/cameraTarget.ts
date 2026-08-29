/**
 * Where the camera stream goes, and how fast.
 *
 * Its own relay on its own port, deliberately separate from the session viewer
 * on 8787.
 *
 * RUNNING.md is emphatic about ports in this project, for a reason that cost
 * somebody an evening: the relay and the Second Voice proxy both bound 8787 on
 * Windows without either failing, because one took IPv6 and the other IPv4, and
 * traffic split silently by address family. So this picks a port nothing else
 * in the repo touches — 8081 is Metro, 8787 the viewer, 8788 the model proxy —
 * and says so out loud.
 *
 * Separate is also the safer engineering choice. The 8787 stream carries the
 * skeleton the pitch is built on; putting megabytes of JPEG through the same
 * socket would risk the one thing that must not stutter. And when nobody is
 * running the camera relay, the phone connects to nothing, encodes nothing,
 * and the feature costs exactly zero.
 */

/** 8789. Not 8787 (viewer), not 8788 (model proxy), not 8081 (Metro). */
export const CAMERA_STREAM_PORT = 8789;

/**
 * localhost works over `adb reverse tcp:8789 tcp:8789`, the same USB path the
 * viewer uses, so no venue network is involved. Override for a WiFi setup.
 */
export const CAMERA_STREAM_URL =
  process.env.EXPO_PUBLIC_DUO_CAMERA_URL ?? `ws://localhost:${CAMERA_STREAM_PORT}/phone`;

/**
 * Frames per second.
 *
 * 03-architecture.md budgets 5-8 for FrameMessage: "sending landmarks at full
 * rate and images at low rate gives a smooth skeleton over a slightly choppy
 * background, which looks fine and costs almost nothing". That is still the
 * right trade — the box tracks at the full landmark rate while the picture
 * underneath it updates more slowly, and the eye reads the result as live.
 *
 * 5 rather than 8 because the JPEG is encoded full-resolution at quality 90 by
 * the native patch, with no downscale step, so each frame is considerably
 * larger than the ~320px the contract anticipated. Lowering the rate was the
 * change that did not require patching native code and rebuilding for three
 * people.
 */
export const CAMERA_STREAM_FPS = 5;

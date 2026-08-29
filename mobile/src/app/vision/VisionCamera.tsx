/**
 * Mounts Person A's MediaPipe pose view so it actually runs, without ever
 * showing the camera to the patient.
 *
 * 02-product-spec.md and 03-architecture.md both require that the camera feed
 * is never rendered on the phone screen — the patient sees a companion, and the
 * video goes to the laptop instead. But the ThinkSys bridge owns the camera
 * through a native view: if the view is not mounted, no frames are processed
 * and no landmarks are emitted. So it is mounted at full size and made
 * invisible, rather than not mounted at all.
 *
 * `opacity: 0` rather than zero size or `display: none`, deliberately: the
 * native fragment still needs real layout bounds to create its camera surface.
 * A zero-sized view produces no landmarks at all.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';

import type { PoseFrame } from '../../types/contracts';
import { MediaPipePoseView } from '../../vision/mediapipeAdapter';
import type { MirrorMode } from '../../vision/landmarks';

/**
 * ⚠️  MUST BE VALIDATED ON THE LOANER DEVICE BEFORE TRUSTING ANY OUTPUT.
 *
 * 03-architecture.md, "Warning: front camera mirroring": if the frames fed to
 * the pose model are mirrored and this is not corrected, left and right
 * landmarks swap. That does not just look wrong — it inverts the
 * affected-side analysis, which is the core feature.
 *
 * The documented test: have someone raise only their RIGHT arm and confirm the
 * app reports right. If it reports left, flip this to 'horizontal'.
 */
export const MIRROR_MODE: MirrorMode = 'none';

type Props = {
  /**
   * Gate on first mount only. Once the camera has started it is deliberately
   * never unmounted for the rest of the app's life.
   *
   * The bridge creates its native fragment in a mount-time effect and
   * subscribes to its landmark event with an empty dependency array. Tearing
   * that down and rebuilding it on a phase change is how you get a camera that
   * works for one session and then silently stops producing landmarks, and it
   * risks stacking a second listener on remount so every frame is delivered
   * twice. Starting it once and leaving it running avoids the whole class of
   * problem, and costs nothing: the view is invisible either way.
   */
  enabled: boolean;
  onPoseFrame: (frame: PoseFrame) => void;
  onPermissionDenied?: () => void;
};

export function VisionCamera({ enabled, onPoseFrame, onPermissionDenied }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  // Latches on first enable and never clears — see the note on `enabled`.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (enabled) setStarted(true);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [enabled, permission, requestPermission]);

  useEffect(() => {
    if (permission && !permission.granted && !permission.canAskAgain) {
      onPermissionDenied?.();
    }
  }, [permission, onPermissionDenied]);

  if (!started || !permission?.granted) return null;

  return (
    <View style={styles.hidden} pointerEvents="none" collapsable={false}>
      <MediaPipePoseView onPoseFrame={onPoseFrame} mirrorMode={MIRROR_MODE} />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Invisible to the patient, still laid out and rendered so the native
    // camera fragment produces landmarks. See the note at the top of the file.
    opacity: 0,
    zIndex: -1,
  },
});

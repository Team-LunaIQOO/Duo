import React, { useCallback, useRef } from 'react';
import { RNMediapipe, captureSnapshot as nativeCaptureSnapshot, type SnapshotEvent } from '@thinksys/react-native-mediapipe';
import type { PoseFrame } from '../types/contracts';
import { toPoseFrame, type MirrorMode } from './landmarks';

export type MediaPipePoseViewProps = {
  onPoseFrame: (frame: PoseFrame) => void;
  mirrorMode?: MirrorMode;
  style?: object;
  /**
   * Fires with one JPEG frame each time captureSnapshot() (exported below)
   * is called. Real camera pixels, not derived from landmarks — the caller
   * is responsible for deciding what happens to it. Optional: a caller that
   * never invokes captureSnapshot never receives this and pays nothing for
   * the plumbing beyond one native event subscription.
   */
  onSnapshot?: (event: SnapshotEvent) => void;
};

/** Requests one JPEG frame from whichever TsMediapipeView is currently mounted. */
export const captureSnapshot = nativeCaptureSnapshot;
export type { SnapshotEvent };

/** Option 1 adapter. The bridge owns the camera and emits native landmark callbacks. */
export function MediaPipePoseView({ onPoseFrame, mirrorMode = 'none', style, onSnapshot }: MediaPipePoseViewProps) {
  const sessionStartedAt = useRef<number | null>(null);
  const handleLandmark = useCallback((payload: unknown) => {
    const now = Date.now();
    sessionStartedAt.current ??= now;
    const frame = toPoseFrame(payload, now - sessionStartedAt.current, mirrorMode);
    if (frame) onPoseFrame(frame);
  }, [mirrorMode, onPoseFrame]);

  return <RNMediapipe style={style} onLandmark={handleLandmark} onSnapshot={onSnapshot} />;
}

import React, { useCallback, useRef } from 'react';
import { RNMediapipe } from '@thinksys/react-native-mediapipe';
import type { PoseFrame } from '../types/contracts';
import { toPoseFrame, type MirrorMode } from './landmarks';

export type MediaPipePoseViewProps = {
  onPoseFrame: (frame: PoseFrame) => void;
  mirrorMode?: MirrorMode;
  style?: object;
};

/** Option 1 adapter. The bridge owns the camera and emits native landmark callbacks. */
export function MediaPipePoseView({ onPoseFrame, mirrorMode = 'none', style }: MediaPipePoseViewProps) {
  const sessionStartedAt = useRef<number | null>(null);
  const handleLandmark = useCallback((payload: unknown) => {
    const now = Date.now();
    sessionStartedAt.current ??= now;
    const frame = toPoseFrame(payload, now - sessionStartedAt.current, mirrorMode);
    if (frame) onPoseFrame(frame);
  }, [mirrorMode, onPoseFrame]);

  return <RNMediapipe style={style} onLandmark={handleLandmark} />;
}

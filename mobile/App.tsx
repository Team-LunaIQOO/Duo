import { useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { MediaPipePoseView, PosePipeline } from './src/vision';
import type { PoseFrame } from './src/types/contracts';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [latestFrame, setLatestFrame] = useState<PoseFrame | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const pipeline = useMemo(
    () => new PosePipeline({ exercise: 'shoulder_abduction', workingSide: 'right' }),
    []
  );
  const onPoseFrame = useCallback((frame: PoseFrame) => {
    pipeline.push(frame);
    setLatestFrame(frame);
    setFrameCount((count) => count + 1);
  }, [pipeline]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Duo needs camera access to watch your exercise reps.</Text>
        <Button onPress={requestPermission} title="Grant camera permission" />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MediaPipePoseView style={styles.camera} mirrorMode="none" onPoseFrame={onPoseFrame} />
      <View style={styles.overlay}>
        <Text style={styles.status}>MediaPipe pose stream</Text>
        <Text style={styles.detail}>
          {latestFrame ? `${latestFrame.landmarks.length} landmarks · ${(latestFrame.confidence * 100).toFixed(0)}% confidence` : 'Waiting for landmarks…'}
        </Text>
        <Text style={styles.detail}>Frames received: {frameCount}</Text>
        <Text style={styles.detail}>Mirror mode: none (raise right arm to validate)</Text>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  status: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  detail: {
    color: '#fff',
    marginTop: 4,
  },
});

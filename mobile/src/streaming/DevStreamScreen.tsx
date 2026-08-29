/**
 * Dev screen for testing the real WebSocket from the phone — Person C.
 *
 * Deliberately self-contained and inside src/streaming/, so the real transport
 * can be exercised on the device WITHOUT editing App.tsx, which is the shared
 * integration file. To use it, mount it temporarily:
 *
 *   import { DevStreamScreen } from './src/streaming/DevStreamScreen';
 *   export default function App() { return <DevStreamScreen />; }
 *
 * ...or drop it behind a debug tab once Person B has navigation in place.
 *
 * Uses only React Native core components — no Expo module surface — so it
 * works in Expo Go with no config or dependency change.
 *
 * What it proves on the real device:
 *   - the phone can reach the laptop relay over the venue WiFi
 *   - RN's WebSocket global carries our message shapes at the target rates
 *   - reconnection actually works when the laptop drops
 *
 * It streams MOCK poses. Swapping in Person A's real PoseFrame stream is one
 * line: call publisher.publishPoseFrame(frame) from their frame processor
 * instead of from the mock source below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FatigueDetector } from '../fatigue';
import { MOCK_JPEG_BASE64, startMockPoseSource } from '../fatigue/mock/mockPoseSource';
import { DEFAULT_STREAM_PORT, phoneUrlFor } from './config';
import { StreamPublisher } from './streamPublisher';
import { WebSocketClientTransport, type TransportState } from './transport';
import type { PublisherCounters } from './streamPublisher';

const ZERO: PublisherCounters = {
  landmarksSent: 0,
  landmarksThrottled: 0,
  framesSent: 0,
  framesThrottled: 0,
  statsSent: 0,
  statsDeduped: 0,
  dropped: 0,
};

export function DevStreamScreen() {
  const [host, setHost] = useState('192.168.1.10');
  const [state, setState] = useState<TransportState>('disconnected');
  const [counters, setCounters] = useState<PublisherCounters>(ZERO);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const publisherRef = useRef<StreamPublisher | null>(null);
  const stopMockRef = useRef<(() => void) | null>(null);

  const url = useMemo(() => phoneUrlFor(host, DEFAULT_STREAM_PORT), [host]);

  const addLog = useCallback((line: string) => {
    // Newest first, bounded — an unbounded log on a long session is a leak.
    setLog((prev) => [line, ...prev].slice(0, 12));
  }, []);

  const stop = useCallback(() => {
    stopMockRef.current?.();
    stopMockRef.current = null;
    publisherRef.current?.stop();
    publisherRef.current = null;
    setRunning(false);
    addLog('stopped');
  }, [addLog]);

  const start = useCallback(() => {
    if (publisherRef.current) stop();

    const transport = new WebSocketClientTransport({ url });
    transport.onStateChange = (s) => {
      setState(s);
      addLog(`transport ${s}`);
    };

    const publisher = new StreamPublisher(transport);
    publisherRef.current = publisher;
    publisher.start();

    const detector = new FatigueDetector({ workingSide: 'left', exercise: 'E1' });

    let reps = 0;
    let quality = '-';
    let fatigue = 'none';

    stopMockRef.current = startMockPoseSource(
      {
        onPoseFrame: (frame) => {
          detector.onPoseFrame(frame);
          publisher.publishPoseFrame(frame);
          // Ask before paying for an encode. On device this is where the real
          // downscale + JPEG compression belongs (03-architecture.md: cap at
          // 5-8 fps, downscale BEFORE encoding, not after).
          if (publisher.shouldEncodeFrame()) {
            publisher.publishJpegFrame(MOCK_JPEG_BASE64, frame.timestamp);
          }
        },
        onRepEvent: (rep) => {
          reps = rep.repNumber;
          quality = rep.quality;
          const signal = detector.onRepEvent(rep);
          if (signal) {
            fatigue = signal.level;
            addLog(`rep ${rep.repNumber}: fatigue ${signal.level} (${signal.reason})`);
          }
          publisher.publishStats({ reps, quality, compensations: [], fatigue });
        },
        onComplete: () => addLog('mock session complete'),
      },
      { repCount: 14, fatigueStartRep: 7, restBetweenRepsMs: 700, seed: 7 }
    );

    setRunning(true);
    addLog(`connecting to ${url}`);
  }, [url, stop, addLog]);

  // Poll counters for display only. The publisher itself is not polled-driven.
  useEffect(() => {
    const id = setInterval(() => {
      setCounters(publisherRef.current?.stats ?? ZERO);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Always tear the socket down when the screen goes away, or the reconnect
  // timer keeps firing after unmount.
  useEffect(() => () => stop(), [stop]);

  const dotColor =
    state === 'connected' ? '#3fb950' : state === 'connecting' ? '#d29922' : '#f85149';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Stream test</Text>
      <Text style={styles.subtitle}>Person C · not part of the demo UI</Text>

      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.statusText}>{state}</Text>
      </View>

      <Text style={styles.label}>Laptop IP (shown by viewer/relay.js)</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        editable={!running}
      />
      <Text style={styles.url}>{url}</Text>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, running && styles.buttonDisabled]}
          onPress={start}
          disabled={running}
        >
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
        <Pressable
          style={[styles.button, !running && styles.buttonDisabled]}
          onPress={stop}
          disabled={!running}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
      </View>

      <View style={styles.counters}>
        <Counter label="landmarks sent" value={counters.landmarksSent} />
        <Counter label="landmarks throttled" value={counters.landmarksThrottled} />
        <Counter label="frames sent" value={counters.framesSent} />
        <Counter label="stats sent" value={counters.statsSent} />
        <Counter label="stats deduped" value={counters.statsDeduped} />
        <Counter label="dropped" value={counters.dropped} />
      </View>

      <Text style={styles.label}>Log</Text>
      {log.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <Text style={styles.counterValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  content: { padding: 20, paddingTop: 60, gap: 10 },
  title: { color: '#e6edf3', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#8b9bab', fontSize: 13, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: '#e6edf3', fontSize: 15 },
  label: {
    color: '#8b9bab',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#1a2430',
    borderColor: '#26323f',
    borderWidth: 1,
    borderRadius: 8,
    color: '#e6edf3',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  url: { color: '#4cc2ff', fontSize: 12, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: {
    flex: 1,
    backgroundColor: '#1a2430',
    borderColor: '#26323f',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#e6edf3', fontSize: 15, fontWeight: '600' },
  counters: { marginTop: 16, gap: 2 },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  counterLabel: { color: '#8b9bab', fontSize: 13 },
  counterValue: { color: '#e6edf3', fontSize: 13, fontVariant: ['tabular-nums'] },
  logLine: { color: '#8b9bab', fontSize: 12 },
});

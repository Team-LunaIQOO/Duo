/**
 * Diagnostics, behind a dev toggle.
 *
 * 02-product-spec.md, "Active session": "Nothing else. No debug output, no
 * landmark coordinates, no confidence scores. Build those behind a dev
 * toggle." This is that toggle. It is off by default and must stay off during
 * the demo — the patient-facing screen is the face, not a dashboard.
 *
 * It exists because compensation detection and fatigue are the two features
 * that cannot be confirmed by looking at the phone. A detector that never
 * fires and a detector that fires correctly look identical from the outside,
 * and both were still unverified on real hardware. Watching the event log
 * while deliberately leaning forward is the fastest way to find out whether
 * the thresholds in vision/thresholds.ts are anywhere near right, which is
 * what 04-clinical-logic.md's calibration protocol asks for.
 *
 * Toggle: tap the small invisible target in the top-left corner three times.
 * Deliberately awkward, so it cannot be opened by accident on stage.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionState } from '../types/contracts';
import type { FatigueDebug } from '../fatigue';
import type { GestureDebug } from '../gesture';
import type { SpeechCommandsStatus } from './voice/useSpeechCommands';
import type { GazeController } from './face/gaze';
import type { ProxyHealth } from './voice/replyClient';

type Props = {
  session: SessionState;
  framed: boolean;
  calibrating: boolean;
  ready: boolean;
  currentArm: 'affected' | 'unaffected';
  eventLog: string[];
  fatigueDebug: () => FatigueDebug | null;
  gestureDebug: () => GestureDebug | null;
  voice: SpeechCommandsStatus;
  gaze?: GazeController;
  proxyHealth: ProxyHealth;
  replySource: 'claude' | 'local';
  isCameraStreaming: boolean;
  setCameraStreaming: (on: boolean) => void;
  cameraState: () => string;
};

const TAPS_TO_OPEN = 3;

const num = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2);

export function DevOverlay({
  session,
  framed,
  calibrating,
  ready,
  currentArm,
  eventLog,
  fatigueDebug,
  gestureDebug,
  voice,
  gaze,
  proxyHealth,
  replySource,
  isCameraStreaming,
  setCameraStreaming,
  cameraState,
}: Props) {
  const [taps, setTaps] = useState(0);
  const [open, setOpen] = useState(false);

  // Re-render on a light tick while the panel is open.
  //
  // Nothing in this app re-renders per frame — the session state only changes
  // when a rep or an event lands — so the two live rows below would otherwise
  // sit frozen between reps. A gesture hold timer that only updates when
  // something else happens cannot be used to check anything, and watching it
  // move is the whole method for the false-positive check in RUNNING.md.
  // Mounted only while open, so it costs nothing during a demo.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) {
    return (
      <Pressable
        style={styles.hotspot}
        onPress={() => {
          const next = taps + 1;
          if (next >= TAPS_TO_OPEN) {
            setTaps(0);
            setOpen(true);
          } else {
            setTaps(next);
          }
        }}
      />
    );
  }

  const fatigue = fatigueDebug();
  const gesture = gestureDebug();
  const affected = session.reps.filter((r) => r.side === 'affected').length;
  const unaffected = session.reps.filter((r) => r.side === 'unaffected').length;

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.header}>
        <Text style={styles.title}>dev</Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={12}>
          <Text style={styles.close}>close</Text>
        </Pressable>
      </View>

      <Text style={styles.row}>
        {session.phase} · {currentArm} · {framed ? 'framed' : 'NOT FRAMED'}
        {calibrating ? ' · calibrating' : ready ? ' · counting' : ''}
      </Text>
      <Text style={styles.row}>
        reps affected {affected} / other {unaffected}
      </Text>

      <Text style={styles.row}>
        fatigue {session.fatigue}
        {fatigue?.ready
          ? ` · rom ${num(fatigue.romRatio)} dur ${num(fatigue.durationRatio)} inst ${num(fatigue.instabilityRatio)}`
          : ` · needs ${fatigue ? Math.max(0, 6 - fatigue.repsSeen) : 6} more reps`}
      </Text>
      {fatigue && fatigue.framesSkipped > 0 && (
        <Text style={styles.row}>frames skipped {fatigue.framesSkipped}</Text>
      )}

      {/*
        Gesture pause is invisible from the outside in exactly the way
        compensation is: a detector that never fires and one that is about to
        fire look identical. This row is how the false-positive check in
        RUNNING.md is actually performed — do a set of reps and watch that the
        reject reason keeps saying why each arm is not a raised hand, rather
        than the hold timer creeping up.
      */}
      <Text style={styles.row}>
        gesture {gesture?.posture ? `${gesture.posture} hold ${Math.round(gesture.heldMs)}ms` : (gesture?.reject ?? '—')}
        {gesture?.latched ? ' · latched' : ''} · fired {gesture?.firedCount ?? 0}
      </Text>

      {/*
        Whether recognition is on-device is not cosmetic: the pitch claims the
        exercise session works in airplane mode, and a cloud recogniser would
        make that false. This row is where that claim gets checked before it is
        made on stage.
      */}
      <Text style={styles.row}>
        voice {voice.available ? (voice.usingOnDevice ? 'on-device' : 'CLOUD') : 'unavailable'}
        {voice.onDeviceNote ? ` (${voice.onDeviceNote})` : ''}
        {voice.listening ? ' · mic open' : ''}
        {voice.armed ? ' · ARMED' : ''}
        {voice.lastError ? ` · err ${voice.lastError}` : ''}
      </Text>
      <Pressable onPress={() => voice.setWakeEnabled(!voice.wakeEnabled)} hitSlop={6}>
        <Text style={styles.row}>
          wake {voice.wakeActive ? 'listening' : voice.wakeEnabled ? 'paused' : 'OFF'} · tap to
          {voice.wakeEnabled ? ' disable' : ' enable'}
        </Text>
      </Pressable>
      {voice.lastHeard && <Text style={styles.rowDim}>heard "{voice.lastHeard}"</Text>}

      {/*
        Whether Duo is actually speaking Claude's words or its own written
        ones. From the outside the two are indistinguishable — that is the
        point of the fallback — so this is the only place the difference shows.
      */}
      <Text style={styles.row}>
        claude{' '}
        {proxyHealth.state === 'checking'
          ? 'checking…'
          : proxyHealth.state === 'unreachable'
            ? `UNREACHABLE (${proxyHealth.detail})`
            : proxyHealth.anthropic
              ? `bundled · ${proxyHealth.model ?? '?'}`
              : 'NO BUNDLED KEY'}
        {' · last '}
        {replySource}
      </Text>

      {/*
        JPEG encoding is not free and this phone is also running pose
        inference, so the camera stream can be switched off without restarting
        anything. It already costs nothing when no relay is listening — this is
        for the case where one IS listening and the session matters more.
      */}
      <Pressable onPress={() => setCameraStreaming(!isCameraStreaming)} hitSlop={6}>
        <Text style={styles.row}>
          camera {isCameraStreaming ? cameraState() : 'OFF'} · tap to
          {isCameraStreaming ? ' disable' : ' enable'}
        </Text>
      </Pressable>

      {gaze && (
        <Text style={styles.row}>
          gaze {gaze.tracking ? 'tracking' : 'centred'} · x {gaze.debugX.toFixed(2)} y{' '}
          {gaze.debugY.toFixed(2)}
        </Text>
      )}

      <Text style={styles.rowDim}>
        {eventLog.length === 0 ? 'no events yet' : 'recent events'}
      </Text>
      {eventLog.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hotspot: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 64,
    height: 64,
  },
  panel: {
    position: 'absolute',
    top: 8,
    left: 8,
    maxWidth: 340,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(10,14,20,0.92)',
    borderWidth: 1,
    borderColor: '#26323f',
    gap: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: { color: '#4cc2ff', fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  close: { color: '#8b9bab', fontSize: 11 },
  row: { color: '#e6edf3', fontSize: 11 },
  rowDim: { color: '#8b9bab', fontSize: 10, marginTop: 6 },
  logLine: { color: '#8b9bab', fontSize: 10 },
});

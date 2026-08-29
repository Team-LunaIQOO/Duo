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

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionState } from '../types/contracts';
import type { FatigueDebug } from '../fatigue';

type Props = {
  session: SessionState;
  framed: boolean;
  calibrating: boolean;
  ready: boolean;
  currentArm: 'affected' | 'unaffected';
  eventLog: string[];
  fatigueDebug: () => FatigueDebug | null;
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
}: Props) {
  const [taps, setTaps] = useState(0);
  const [open, setOpen] = useState(false);

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

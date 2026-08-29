import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';
import type { SessionState } from '../../types/contracts';

type Props = {
  session: SessionState;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
};

const QUALITY_COLOR: Record<string, string> = {
  good: '#3ddc84',
  partial: '#e0a030',
  compensated: '#e05a4e',
};

/**
 * Active session — face stays the main element (smaller), rep count large,
 * quality as a colour not a number, caption showing what Duo just said.
 * No debug output, no landmark coordinates, no confidence scores here.
 */
export function ActiveSessionScreen({ session, onPause, onResume, onEnd }: Props) {
  const lastRep = session.reps[session.reps.length - 1];
  const qualityColor = lastRep ? QUALITY_COLOR[lastRep.quality] : '#444';
  const isPaused = session.phase === 'resting';

  return (
    <View style={styles.container}>
      <Pressable style={styles.sideButton} onPress={isPaused ? onResume : onPause}>
        <Text style={styles.sideButtonText}>{isPaused ? 'Resume' : 'Pause'}</Text>
      </Pressable>

      <View style={styles.center}>
        <Face state={session.faceState} size={48} />
        <View style={styles.statsRow}>
          <Text style={styles.repCount}>{session.reps.length}</Text>
          <View style={[styles.qualityDot, { backgroundColor: qualityColor }]} />
        </View>
        {session.lastSpoken && <Text style={styles.caption}>{session.lastSpoken}</Text>}
      </View>

      <Pressable style={[styles.sideButton, styles.endButton]} onPress={onEnd}>
        <Text style={styles.sideButtonText}>End</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statsRow: {
    alignItems: 'center',
    gap: 6,
  },
  repCount: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '700',
  },
  qualityDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  caption: {
    color: '#ccc',
    fontSize: 15,
    textAlign: 'center',
    maxWidth: 360,
  },
  sideButton: {
    backgroundColor: '#222',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  endButton: {
    backgroundColor: '#3a1a1a',
  },
  sideButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';
import { MicButton } from '../voice/MicButton';
import type { SpeechCommandsStatus } from '../voice/useSpeechCommands';
import type { SessionState } from '../../types/contracts';
import type { GazeController } from '../face/gaze';

type Props = {
  session: SessionState;
  /** Which arm is being exercised, so the user can see the label their reps carry. */
  currentArm: 'affected' | 'unaffected';
  /** True while the two-second baseline is being captured. */
  calibrating: boolean;
  onPause: () => void;
  onResume: () => void;
  onSwitchArm: () => void;
  onEnd: () => void;
  voice: SpeechCommandsStatus;
  gaze?: GazeController;
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
export function ActiveSessionScreen({
  session,
  currentArm,
  calibrating,
  onPause,
  onResume,
  onSwitchArm,
  onEnd,
  voice,
  gaze,
}: Props) {
  const lastRep = session.reps[session.reps.length - 1];
  const qualityColor = lastRep ? QUALITY_COLOR[lastRep.quality] : '#444';
  const isPaused = session.phase === 'resting';

  // Reps are counted per arm, so showing the total would make the count jump
  // backwards in meaning when the user switches sides.
  const repsThisArm = session.reps.filter((r) => r.side === currentArm).length;

  return (
    <View style={styles.container}>
      <View style={styles.sideColumn}>
        <Pressable style={styles.sideButton} onPress={isPaused ? onResume : onPause}>
          <Text style={styles.sideButtonText}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
        <Pressable style={styles.sideButton} onPress={onSwitchArm}>
          <Text style={styles.sideButtonText}>Other arm</Text>
        </Pressable>
        <MicButton voice={voice} compact />
      </View>

      <View style={styles.center}>
        <Face state={session.faceState} size={48} gaze={gaze} />
        <View style={styles.statsRow}>
          <Text style={styles.repCount}>{repsThisArm}</Text>
          <View style={[styles.qualityDot, { backgroundColor: qualityColor }]} />
        </View>
        <Text style={styles.armLabel}>
          {currentArm === 'affected' ? 'Affected arm' : 'Other arm'}
          {calibrating ? ' · sit still' : ''}
        </Text>
        {session.lastSpoken && <Text style={styles.caption}>{session.lastSpoken}</Text>}
      </View>

      <View style={styles.sideColumn}>
        <Pressable style={[styles.sideButton, styles.endButton]} onPress={onEnd}>
          <Text style={styles.sideButtonText}>End</Text>
        </Pressable>
      </View>
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
  sideColumn: {
    gap: 12,
  },
  armLabel: {
    color: '#8b9bab',
    fontSize: 13,
    letterSpacing: 0.4,
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

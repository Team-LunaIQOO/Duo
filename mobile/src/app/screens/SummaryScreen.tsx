import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';
import type { RepEvent, SessionState } from '../../types/contracts';
import type { GazeController } from '../face/gaze';

type Props = {
  session: SessionState;
  onRestart: () => void;
  gaze?: GazeController;
};

function meanPeakAngle(reps: RepEvent[]): number {
  if (reps.length === 0) return 0;
  return reps.reduce((sum, r) => sum + r.peakAngle, 0) / reps.length;
}

/** End of session — eyes full size, summary text read aloud + shown, required disclaimer. */
export function SummaryScreen({ session, onRestart, gaze }: Props) {
  const affected = session.reps.filter((r) => r.side === 'affected');
  const unaffected = session.reps.filter((r) => r.side === 'unaffected');
  const goodReps = session.reps.filter((r) => r.quality === 'good').length;

  const affectedMean = meanPeakAngle(affected);
  const unaffectedMean = meanPeakAngle(unaffected);
  const symmetryPercent = unaffectedMean > 0 ? (affectedMean / unaffectedMean) * 100 : null;

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Face state={session.faceState} size={72} gaze={gaze} />
      </View>

      <View style={styles.right}>
        <Text style={styles.headline}>{session.reps.length} reps today</Text>
        <Text style={styles.line}>{goodReps} were good quality.</Text>
        {symmetryPercent !== null && (
          <Text style={styles.line}>
            Your affected arm reached about {Math.round(symmetryPercent)} percent as far as your other arm.
          </Text>
        )}

        <Pressable style={styles.button} onPress={onRestart}>
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Not a medical device. Not a diagnosis. Follow your therapist's instructions.
        </Text>
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
  },
  left: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  right: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
    paddingRight: 32,
  },
  headline: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  line: {
    color: '#ddd',
    fontSize: 15,
  },
  button: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: '#222',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  disclaimer: {
    marginTop: 20,
    color: '#666',
    fontSize: 11,
    maxWidth: 340,
  },
});

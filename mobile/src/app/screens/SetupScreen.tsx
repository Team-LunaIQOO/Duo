import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';
import type { ExerciseId } from '../../types/contracts';
import { CONTROL_LINES } from '../feedback/feedbackTable';

type Props = {
  framed: boolean;
  onChooseExercise: (exercise: ExerciseId, affectedSide: 'left' | 'right') => void;
};

const EXERCISES: { id: ExerciseId; label: string }[] = [
  { id: 'E1', label: 'Shoulder raise' },
  { id: 'E3', label: 'Elbow curl' },
];

/**
 * Setup — confirm exercise and affected side, framing check. Laid out as
 * two side-by-side columns to use the landscape width instead of stacking
 * everything under the face.
 */
export function SetupScreen({ framed, onChooseExercise }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Face state="attentive" size={64} />
        <Text style={styles.status}>{framed ? CONTROL_LINES.framingConfirmed : CONTROL_LINES.framingCheck}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.prompt}>{CONTROL_LINES.wake}</Text>
        {EXERCISES.map((exercise) => (
          <View key={exercise.id} style={styles.exerciseRow}>
            <Text style={styles.exerciseLabel}>{exercise.label}</Text>
            <View style={styles.sideButtons}>
              <Pressable
                style={styles.sideButton}
                onPress={() => onChooseExercise(exercise.id, 'left')}
                disabled={!framed}
              >
                <Text style={styles.sideButtonText}>Left</Text>
              </Pressable>
              <Pressable
                style={styles.sideButton}
                onPress={() => onChooseExercise(exercise.id, 'right')}
                disabled={!framed}
              >
                <Text style={styles.sideButtonText}>Right</Text>
              </Pressable>
            </View>
          </View>
        ))}
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
    gap: 16,
  },
  status: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  right: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
    paddingRight: 32,
  },
  prompt: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  exerciseRow: {
    gap: 8,
  },
  exerciseLabel: {
    color: '#ccc',
    fontSize: 15,
  },
  sideButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  sideButton: {
    backgroundColor: '#222',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  sideButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

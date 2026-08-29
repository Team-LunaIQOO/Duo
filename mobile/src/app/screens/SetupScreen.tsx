import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';
import type { ExerciseId, SessionState } from '../../types/contracts';
import { CONTROL_LINES } from '../feedback/feedbackTable';
import type { GazeController } from '../face/gaze';

type Props = {
  framed: boolean;
  onChooseExercise: (exercise: ExerciseId, affectedSide: 'left' | 'right') => void;
  /** Real face state: this is the screen where the wake reaction lands. */
  faceState: SessionState['faceState'];
  gaze?: GazeController;
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
export function SetupScreen({ framed, onChooseExercise, faceState, gaze }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Face state={faceState} size={64} gaze={gaze} />
        <Text style={styles.status}>{framed ? CONTROL_LINES.framingConfirmed : CONTROL_LINES.framingCheck}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.prompt}>{CONTROL_LINES.wake}</Text>
        {/*
          The start buttons are disabled until the person is framed, because a
          session started without a usable baseline makes every compensation
          reading meaningless. That block used to be invisible — the buttons
          looked identical either way, so tapping them simply did nothing and
          read as the app being broken. Say why instead.
        */}
        {!framed && (
          <Text style={styles.blockedHint}>
            Sit so your head, shoulders and hips are all in view.
          </Text>
        )}
        {EXERCISES.map((exercise) => (
          <View key={exercise.id} style={styles.exerciseRow}>
            <Text style={styles.exerciseLabel}>{exercise.label}</Text>
            <View style={styles.sideButtons}>
              <Pressable
                style={[styles.sideButton, !framed && styles.sideButtonDisabled]}
                onPress={() => onChooseExercise(exercise.id, 'left')}
                disabled={!framed}
              >
                <Text style={[styles.sideButtonText, !framed && styles.sideButtonTextDisabled]}>
                  Left
                </Text>
              </Pressable>
              <Pressable
                style={[styles.sideButton, !framed && styles.sideButtonDisabled]}
                onPress={() => onChooseExercise(exercise.id, 'right')}
                disabled={!framed}
              >
                <Text style={[styles.sideButtonText, !framed && styles.sideButtonTextDisabled]}>
                  Right
                </Text>
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
  sideButtonDisabled: {
    backgroundColor: '#141414',
    opacity: 0.45,
  },
  sideButtonTextDisabled: {
    color: '#888',
  },
  blockedHint: {
    color: '#d29922',
    fontSize: 13,
    marginTop: -8,
    marginBottom: 4,
  },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';
import { MicButton } from '../voice/MicButton';
import type { SpeechCommandsStatus } from '../voice/useSpeechCommands';
import type { GazeController } from '../face/gaze';
import type { SessionState } from '../../types/contracts';

type Props = {
  onTapToTalk: () => void;
  voice: SpeechCommandsStatus;
  /**
   * The real face state, rather than a hardcoded one. The camera runs from
   * idle onward, so the eyes can follow the user before a session has started
   * — which is the first thing anyone sees.
   */
  faceState: SessionState['faceState'];
  gaze?: GazeController;
};

/** Idle / listening — 02-product-spec.md: two eyes, nothing else, tap-to-talk always visible. */
export function IdleScreen({ onTapToTalk, voice, faceState, gaze }: Props) {
  return (
    // Tapping anywhere still starts a session — that is the route that must
    // never fail, and beat 2 of the demo depends on it. The microphone is a
    // nested Pressable, so a tap on it is captured there and does not also
    // start the session underneath.
    <Pressable style={styles.container} onPress={onTapToTalk}>
      <Face state={faceState} size={80} gaze={gaze} />
      <Text style={styles.hint}>
        {voice.armed
          ? 'Go ahead…'
          : voice.wakeActive
            ? 'Say "hey duo", or tap anywhere'
            : 'Tap anywhere to start'}
      </Text>
      <MicButton voice={voice} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  hint: {
    color: '#666',
    fontSize: 14,
  },
});

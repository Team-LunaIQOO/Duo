import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpeechCommandsStatus } from './useSpeechCommands';

type Props = {
  voice: SpeechCommandsStatus;
  /** Compact form for the active session's side column. */
  compact?: boolean;
};

/**
 * The tap-to-talk control. 02-product-spec.md, "Idle / listening": "A
 * tap-to-talk button always visible as a fallback", and "A subtle listening
 * indicator when Duo is expecting a response" — this is both, because the
 * button carries its own state rather than needing a second element.
 *
 * It renders nothing when the device has no usable recogniser. A dead
 * microphone button is worse than no button: the user taps it, nothing
 * happens, and they cannot tell whether they were heard. Touch and the hand
 * gesture still reach every function, so nothing is lost by its absence.
 */
export function MicButton({ voice, compact }: Props) {
  if (!voice.available) return null;

  const label = voice.listening ? 'Listening…' : compact ? 'Speak' : 'Tap to speak';

  return (
    <Pressable
      onPress={voice.listening ? voice.stopListening : voice.listen}
      style={[
        styles.button,
        compact && styles.compact,
        voice.listening && styles.listening,
      ]}
      accessibilityRole="button"
      accessibilityLabel={voice.listening ? 'Stop listening' : 'Tap to speak a command'}
      hitSlop={8}
    >
      <View style={[styles.dot, voice.listening && styles.dotLive]} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#222',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  compact: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  listening: {
    backgroundColor: '#1d3a2a',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#666',
  },
  dotLive: {
    backgroundColor: '#3ddc84',
  },
  label: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

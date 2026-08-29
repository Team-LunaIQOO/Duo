import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Face } from '../face/Face';

type Props = {
  onTapToTalk: () => void;
};

/** Idle / listening — 02-product-spec.md: two eyes, nothing else, tap-to-talk always visible. */
export function IdleScreen({ onTapToTalk }: Props) {
  return (
    <Pressable style={styles.container} onPress={onTapToTalk}>
      <Face state="neutral" size={80} />
      <Text style={styles.hint}>Tap anywhere to start</Text>
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

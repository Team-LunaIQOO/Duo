import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import type { FallAlertState } from './useFallAlert';

type Props = {
  state: FallAlertState;
  onCancel: () => void;
  onDismiss: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
};

export function FallAlertOverlay({ state, onCancel, onDismiss, onSpeakingChange }: Props) {
  const announced = useRef(false);

  useEffect(() => {
    if (state.status === 'countdown' && !announced.current) {
      announced.current = true;
      void Speech.stop();
      onSpeakingChange?.(true);
      const done = () => onSpeakingChange?.(false);
      Speech.speak('I detected a possible fall. Say I am okay, or tap the button, to cancel the caregiver alert.', {
        rate: 0.85,
        onDone: done,
        onStopped: done,
        onError: done,
      });
    }
    if (state.status === 'idle') {
      announced.current = false;
      void Speech.stop();
      onSpeakingChange?.(false);
    }
  }, [state.status, onSpeakingChange]);

  if (state.status === 'idle') return null;

  let title = 'Possible fall detected';
  let detail = 'Contacting your caregiver…';
  if (state.status === 'countdown') detail = `Telegram alert will be sent in ${state.secondsRemaining} seconds.`;
  if (state.status === 'sent') {
    title = 'Caregiver alert sent';
    detail = 'The configured Telegram contact has been notified.';
  }
  if (state.status === 'failed') {
    title = 'Alert could not be sent';
    detail = `${state.message} Please contact your caregiver directly.`;
  }

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
        {state.status === 'countdown' ? (
          <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>I’m okay — cancel alert</Text>
          </Pressable>
        ) : state.status !== 'sending' ? (
          <Pressable accessibilityRole="button" style={styles.dismissButton} onPress={onDismiss}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    backgroundColor: 'rgba(15, 5, 5, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: { width: '100%', maxWidth: 720, alignItems: 'center', gap: 22 },
  title: { color: '#fff', fontSize: 44, fontWeight: '800', textAlign: 'center' },
  detail: { color: '#fff', fontSize: 27, lineHeight: 37, textAlign: 'center' },
  cancelButton: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 22, paddingHorizontal: 38, minWidth: 390 },
  cancelText: { color: '#781313', fontSize: 27, fontWeight: '800', textAlign: 'center' },
  dismissButton: { borderWidth: 2, borderColor: '#fff', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 34 },
  dismissText: { color: '#fff', fontSize: 23, fontWeight: '700' },
});

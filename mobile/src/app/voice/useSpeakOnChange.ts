import { useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

/**
 * Speaks `line` whenever it changes. Everything spoken is also shown as
 * on-screen text via SessionState.lastSpoken — this hook only adds the
 * audio, the caption is the accessibility-required source of truth.
 */
export function useSpeakOnChange(line: string | null) {
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!line || line === lastSpokenRef.current) return;
    lastSpokenRef.current = line;
    Speech.stop();
    Speech.speak(line, { rate: 0.95 });
  }, [line]);
}

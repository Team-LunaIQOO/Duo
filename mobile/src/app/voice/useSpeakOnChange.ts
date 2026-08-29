import { useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';

/**
 * Speaks `line` whenever it changes. Everything spoken is also shown as
 * on-screen text via SessionState.lastSpoken — this hook only adds the
 * audio, the caption is the accessibility-required source of truth.
 *
 * Returns whether Duo is speaking right now, which the wake phrase needs: the
 * microphone has to be shut while the app talks, or it hears itself. One of
 * the spoken lines is "Paused. Tap or say start when ready", which contains a
 * command word — left listening, Duo would pause, say that, hear "start", and
 * resume itself.
 *
 * The `speaking` flag is set before `Speech.speak` rather than in its onStart
 * callback, deliberately. onStart fires once the engine has actually begun,
 * which is tens of milliseconds later, and a microphone that closes late is a
 * microphone that has already heard the first word.
 */
export function useSpeakOnChange(line: string | null): boolean {
  const lastSpokenRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!line || line === lastSpokenRef.current) return;
    lastSpokenRef.current = line;
    Speech.stop();
    setSpeaking(true);
    Speech.speak(line, {
      rate: 0.95,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, [line]);

  // A spoken line that never reports completion — the engine is interrupted,
  // the app backgrounds mid-sentence — must not leave the microphone shut for
  // the rest of the session. Nothing Duo says runs longer than this.
  useEffect(() => {
    if (!speaking) return;
    const timer = setTimeout(() => setSpeaking(false), 12_000);
    return () => clearTimeout(timer);
  }, [speaking, line]);

  return speaking;
}

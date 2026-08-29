import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OpenRouterProvider } from './openRouterProvider';
import { PhrasebookFallbackProvider } from './fallbackProvider';
import { useLocalGemma } from './localGemmaProvider';
import { useSpeechRecognizer } from './useSpeechRecognizer';
import { initialSecondVoiceState, secondVoiceReducer } from './stateMachine';
import { cleanStutteredSpeech } from './speechCleanup';

type Props = {
  enabled: boolean;
  endpoint?: string;
  phraseHints?: string[];
};

/** Bounded communication flow backed by Android speech recognition. */
export function SecondVoicePanel({ enabled, endpoint, phraseHints = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(secondVoiceReducer, initialSecondVoiceState);
  const requestVersion = useRef(0);
  const fallback = useMemo(() => new PhrasebookFallbackProvider(), []);
  const localGemma = useLocalGemma();
  const provider = useMemo(
    () => localGemma.isLoaded
      ? localGemma.provider
      : endpoint ? new OpenRouterProvider({ endpoint, fallback }) : fallback,
    [endpoint, fallback, localGemma.isLoaded, localGemma.provider]
  );

  const submit = async (overrideTranscript?: string) => {
    if (state.phase !== 'listening') return;
    const transcript = (overrideTranscript ?? state.transcript).trim();
    if (!transcript) return;
    const version = ++requestVersion.current;
    dispatch({ type: 'SUBMIT_TRANSCRIPT' });
    try {
      const result = await provider.reconstruct({
        requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        transcript,
        locale: 'en-IN',
        phraseHints,
        context: {},
      });
      if (version !== requestVersion.current) return;
      dispatch({
        type: 'RESULT',
        transcript,
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          text: cleanStutteredSpeech(candidate.text),
        })),
      });
    } catch {
      if (version !== requestVersion.current) return;
      dispatch({ type: 'ERROR', message: 'Suggestions are unavailable. Try again or use the phrase directly.' });
    }
  };
  const speech = useSpeechRecognizer((text) => {
    dispatch({ type: 'TRANSCRIPT', text });
    void submit(text);
  });

  const close = () => {
    requestVersion.current += 1;
    void speech.cancel().catch(() => undefined);
    void Speech.stop();
    dispatch({ type: 'CANCEL' });
    setOpen(false);
  };

  useEffect(() => {
    if (!enabled && open) close();
  }, [enabled, open]);

  useEffect(() => {
    if (state.phase !== 'speaking') return;
    Speech.stop();
    Speech.speak(state.text, { rate: 0.95 });
  }, [state]);

  if (!enabled) return null;
  if (!open) {
    return <Pressable style={styles.launch} onPress={() => { setOpen(true); dispatch({ type: 'ACTIVATE' }); }}><Text style={styles.launchText}>Second Voice</Text></Pressable>;
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Second Voice</Text>
      {state.phase === 'listening' && <>
        <Text style={styles.help}>Speak naturally; Android will transcribe your words on-device or via its configured speech service.</Text>
        <Pressable style={styles.primary} onPress={() => void (speech.listening ? speech.stop() : speech.start()).catch((error) => dispatch({ type: 'ERROR', message: error instanceof Error ? error.message : 'Speech recognition failed.' }))}><Text style={styles.primaryText}>{speech.listening ? 'Stop listening' : 'Start listening'}</Text></Pressable>
        {speech.partial && <Text style={styles.partial}>Heard: {speech.partial}</Text>}
        {speech.error && <Text style={styles.error}>{speech.error}</Text>}
        <Pressable
          style={styles.modelButton}
          disabled={localGemma.downloadStatus === 'downloading' || localGemma.isCheckingStatus}
          onPress={async () => {
            try {
              if (localGemma.downloadStatus === 'downloaded') await localGemma.loadModel();
              else await localGemma.downloadModel();
            } catch { /* downloadError is rendered below without leaking the raw URL */ }
          }}
        >
          <Text style={styles.secondaryText}>
            {localGemma.downloadStatus === 'downloading'
              ? `Downloading local model ${Math.round(localGemma.downloadProgress * 100)}%`
              : localGemma.isLoaded
                ? 'Local Gemma ready'
                : localGemma.downloadStatus === 'downloaded' ? 'Load local Gemma' : 'Download local Gemma'}
          </Text>
        </Pressable>
        {localGemma.downloadError && <View style={styles.modelError}>
          <Text style={styles.error}>Local model download failed.</Text>
          <Text style={styles.help}>Check the internet connection and available device storage, then retry.</Text>
          <Pressable style={styles.secondary} onPress={() => void localGemma.downloadModel()}><Text style={styles.secondaryText}>Retry</Text></Pressable>
        </View>}
        {localGemma.isLoaded && <Text style={styles.localReady}>Using on-device Gemma</Text>}
      </>}
      {state.phase === 'processing' && <Text style={styles.help}>Preparing your response…</Text>}
      {state.phase === 'speaking' && <><Text style={styles.spoken}>{state.text}</Text><Text style={styles.help}>Spoken automatically.</Text></>}
      {state.phase === 'error' && <Text style={styles.error}>{state.message}</Text>}
      <Pressable style={styles.cancel} onPress={close}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  launch: { position: 'absolute', bottom: 20, left: 20, backgroundColor: '#263c59', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18 },
  launchText: { color: '#fff', fontWeight: '700' },
  panel: { position: 'absolute', zIndex: 10, left: 20, right: 20, top: 20, bottom: 20, backgroundColor: '#111a25', borderRadius: 18, padding: 22, justifyContent: 'center', gap: 12 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  help: { color: '#b8c2ce', fontSize: 15 },
  primary: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3378c5', borderRadius: 10, padding: 14 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2b3745', borderRadius: 10, padding: 14 },
  secondaryText: { color: '#d7e2ee', fontWeight: '600' },
  spoken: { color: '#7fe0a0', fontSize: 20, textAlign: 'center' },
  error: { color: '#ff9b8f' },
  cancel: { alignSelf: 'center', padding: 10 },
  modelButton: { alignItems: 'center', backgroundColor: '#2b3745', borderRadius: 10, padding: 12 },
  localReady: { color: '#7fe0a0', fontSize: 13 },
  partial: { color: '#c8d9ed', fontStyle: 'italic' },
  modelError: { gap: 8, padding: 12, borderRadius: 10, backgroundColor: '#321f2b' },
});

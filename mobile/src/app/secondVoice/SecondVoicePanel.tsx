import { useEffect, useMemo, useReducer, useState } from 'react';
import * as Speech from 'expo-speech';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { OpenRouterProvider } from './openRouterProvider';
import { PhrasebookFallbackProvider } from './fallbackProvider';
import { useLocalGemma } from './localGemmaProvider';
import { useSpeechRecognizer } from './useSpeechRecognizer';
import { initialSecondVoiceState, secondVoiceReducer } from './stateMachine';

type Props = {
  enabled: boolean;
  endpoint?: string;
  phraseHints?: string[];
};

/** Bounded communication flow. Typed input is the temporary STT seam until native speech capture is added. */
export function SecondVoicePanel({ enabled, endpoint, phraseHints = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [state, dispatch] = useReducer(secondVoiceReducer, initialSecondVoiceState);
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
    dispatch({ type: 'SUBMIT_TRANSCRIPT' });
    try {
      const result = await provider.reconstruct({
        requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        transcript,
        locale: 'en-IN',
        phraseHints,
        context: {},
      });
      dispatch({ type: 'RESULT', transcript, candidates: result.candidates });
      if (autoSpeak && result.candidates[0]) {
        dispatch({ type: 'SELECT', id: result.candidates[0].id });
        dispatch({ type: 'CONFIRM_SPEAK' });
      }
    } catch {
      dispatch({ type: 'ERROR', message: 'Suggestions are unavailable. Try again or use the phrase directly.' });
    }
  };
  const speech = useSpeechRecognizer((text) => {
    dispatch({ type: 'TRANSCRIPT', text });
    void submit(text);
  });

  useEffect(() => {
    if (state.phase !== 'speaking') return;
    Speech.stop();
    Speech.speak(state.text, { rate: 0.95 });
  }, [state]);

  if (!enabled && !open) return null;
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
        <Text style={styles.help}>Typed fallback</Text>
        <TextInput value={state.transcript} onChangeText={(text) => dispatch({ type: 'TRANSCRIPT', text })} onSubmitEditing={() => void submit()} placeholder="Type a transcript instead" placeholderTextColor="#777" style={styles.input} />
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
          <Text style={styles.error}>Local model download needs Gemma license access.</Text>
          <Text style={styles.help}>Accept Google’s Gemma terms on Hugging Face, then retry. Your token is never stored in this app.</Text>
          <View style={styles.row}>
            <Pressable style={styles.secondary} onPress={() => void Linking.openURL('https://huggingface.co/google/gemma-1.1-2b-it-tflite')}><Text style={styles.secondaryText}>Open license page</Text></Pressable>
            <Pressable style={styles.secondary} onPress={() => void localGemma.downloadModel()}><Text style={styles.secondaryText}>Retry</Text></Pressable>
          </View>
        </View>}
        {localGemma.isLoaded && <Text style={styles.localReady}>Using on-device Gemma</Text>}
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: autoSpeak }} style={styles.toggle} onPress={() => setAutoSpeak((value) => !value)}><Text style={styles.secondaryText}>{autoSpeak ? '☑ Auto-speak top suggestion' : '☐ Require Speak confirmation'}</Text></Pressable>
        <Pressable style={styles.primary} onPress={() => void submit()}><Text style={styles.primaryText}>Find suggestions</Text></Pressable>
      </>}
      {state.phase === 'processing' && <Text style={styles.help}>Finding possible sentences…</Text>}
      {state.phase === 'candidates' && <>
        <Text style={styles.help}>Choose a sentence. Nothing is spoken yet.</Text>
        {state.candidates.map((candidate) => <Pressable key={candidate.id} style={[styles.candidate, state.selectedId === candidate.id && styles.selected]} onPress={() => dispatch({ type: 'SELECT', id: candidate.id })}><Text style={styles.candidateText}>{candidate.text}</Text></Pressable>)}
        <View style={styles.row}>
          <Pressable style={styles.secondary} onPress={() => state.selectedId && dispatch({ type: 'EDIT', draft: state.candidates.find((candidate) => candidate.id === state.selectedId)?.text ?? '' })}><Text style={styles.secondaryText}>Edit</Text></Pressable>
          <Pressable disabled={!state.selectedId} style={[styles.primary, !state.selectedId && styles.disabled]} onPress={() => dispatch({ type: 'CONFIRM_SPEAK' })}><Text style={styles.primaryText}>Speak</Text></Pressable>
        </View>
      </>}
      {state.phase === 'editing' && <>
        <TextInput value={state.draft} onChangeText={(text) => dispatch({ type: 'EDIT', draft: text })} style={styles.input} multiline />
        <Pressable style={styles.primary} onPress={() => dispatch({ type: 'CONFIRM_SPEAK' })}><Text style={styles.primaryText}>Confirm and speak</Text></Pressable>
      </>}
      {state.phase === 'speaking' && <><Text style={styles.spoken}>{state.text}</Text><Text style={styles.help}>{autoSpeak ? 'Auto-speak is enabled for this session.' : 'Spoken after your confirmation.'}</Text></>}
      {state.phase === 'error' && <Text style={styles.error}>{state.message}</Text>}
      <Pressable style={styles.cancel} onPress={() => { Speech.stop(); dispatch({ type: 'CANCEL' }); setOpen(false); }}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  launch: { position: 'absolute', bottom: 20, left: 20, backgroundColor: '#263c59', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18 },
  launchText: { color: '#fff', fontWeight: '700' },
  panel: { position: 'absolute', zIndex: 10, left: 20, right: 20, top: 20, bottom: 20, backgroundColor: '#111a25', borderRadius: 18, padding: 22, justifyContent: 'center', gap: 12 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  help: { color: '#b8c2ce', fontSize: 15 },
  input: { color: '#fff', backgroundColor: '#202c39', borderRadius: 10, padding: 14, minHeight: 52, fontSize: 17 },
  primary: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3378c5', borderRadius: 10, padding: 14 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2b3745', borderRadius: 10, padding: 14 },
  secondaryText: { color: '#d7e2ee', fontWeight: '600' },
  toggle: { alignSelf: 'flex-start', paddingVertical: 8 },
  candidate: { borderWidth: 1, borderColor: '#405063', borderRadius: 10, padding: 14 },
  selected: { borderColor: '#54a5ff', backgroundColor: '#1a3858' },
  candidateText: { color: '#fff', fontSize: 17 },
  row: { flexDirection: 'row', gap: 10 },
  disabled: { opacity: 0.45 },
  spoken: { color: '#7fe0a0', fontSize: 20, textAlign: 'center' },
  error: { color: '#ff9b8f' },
  cancel: { alignSelf: 'center', padding: 10 },
  modelButton: { alignItems: 'center', backgroundColor: '#2b3745', borderRadius: 10, padding: 12 },
  localReady: { color: '#7fe0a0', fontSize: 13 },
  partial: { color: '#c8d9ed', fontStyle: 'italic' },
  modelError: { gap: 8, padding: 12, borderRadius: 10, backgroundColor: '#321f2b' },
});

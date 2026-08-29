import { useEffect, useMemo, useReducer, useState } from 'react';
import * as Speech from 'expo-speech';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { OpenRouterProvider } from './openRouterProvider';
import { PhrasebookFallbackProvider } from './fallbackProvider';
import { initialSecondVoiceState, secondVoiceReducer } from './stateMachine';

type Props = {
  enabled: boolean;
  endpoint?: string;
  phraseHints?: string[];
};

/** Bounded communication flow. Typed input is the temporary STT seam until native speech capture is added. */
export function SecondVoicePanel({ enabled, endpoint, phraseHints = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(secondVoiceReducer, initialSecondVoiceState);
  const fallback = useMemo(() => new PhrasebookFallbackProvider(), []);
  const provider = useMemo(
    () => endpoint ? new OpenRouterProvider({ endpoint, fallback }) : fallback,
    [endpoint, fallback]
  );

  useEffect(() => {
    if (state.phase !== 'speaking') return;
    Speech.stop();
    Speech.speak(state.text, { rate: 0.95 });
  }, [state]);

  if (!enabled && !open) return null;
  if (!open) {
    return <Pressable style={styles.launch} onPress={() => { setOpen(true); dispatch({ type: 'ACTIVATE' }); }}><Text style={styles.launchText}>Second Voice</Text></Pressable>;
  }

  const submit = async () => {
    if (state.phase !== 'listening' || !state.transcript.trim()) return;
    const transcript = state.transcript.trim();
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
    } catch {
      dispatch({ type: 'ERROR', message: 'Suggestions are unavailable. Try again or use the phrase directly.' });
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Second Voice</Text>
      {state.phase === 'listening' && <>
        <Text style={styles.help}>Type or paste the transcript for now.</Text>
        <TextInput autoFocus value={state.transcript} onChangeText={(text) => dispatch({ type: 'TRANSCRIPT', text })} onSubmitEditing={submit} placeholder="What did you mean to say?" placeholderTextColor="#777" style={styles.input} />
        <Pressable style={styles.primary} onPress={submit}><Text style={styles.primaryText}>Find suggestions</Text></Pressable>
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
      {state.phase === 'speaking' && <><Text style={styles.spoken}>{state.text}</Text><Text style={styles.help}>Spoken only after your confirmation.</Text></>}
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
  candidate: { borderWidth: 1, borderColor: '#405063', borderRadius: 10, padding: 14 },
  selected: { borderColor: '#54a5ff', backgroundColor: '#1a3858' },
  candidateText: { color: '#fff', fontSize: 17 },
  row: { flexDirection: 'row', gap: 10 },
  disabled: { opacity: 0.45 },
  spoken: { color: '#7fe0a0', fontSize: 20, textAlign: 'center' },
  error: { color: '#ff9b8f' },
  cancel: { alignSelf: 'center', padding: 10 },
});

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnthropicReconstructionProvider } from './anthropicProvider';
import { anthropicConfigured } from '../voice/anthropicClient';
import { PhrasebookFallbackProvider } from './fallbackProvider';
import { useLocalGemma } from './localGemmaProvider';
import { useSpeechRecognizer } from './useSpeechRecognizer';
import { SiriOrb, type OrbState } from './SiriOrb';
import { initialSecondVoiceState, secondVoiceReducer } from './stateMachine';
import { cleanStutteredSpeech } from './speechCleanup';

type Props = {
  enabled: boolean;
  phraseHints?: string[];
  /**
   * Told whenever this panel opens or closes.
   *
   * The app holds a continuous speech-recognition session for the "hey duo"
   * wake phrase, and Android's recognition service serves one session at a
   * time — a second caller gets ERROR_RECOGNIZER_BUSY. This panel runs its own
   * recogniser through the duo-speech native module, and it is gated to
   * `phase !== 'active'`, which is exactly when the wake phrase is listening.
   * So the two would collide by design.
   *
   * Reporting open/closed lets the wake session stand down for as long as this
   * panel is up. Coarser than releasing only while actually recording, and
   * deliberately so: the panel opens well before anyone taps Start listening,
   * which leaves no race to lose. Someone using Echo is not talking to
   * the session controls anyway.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * A sentence spoken straight into Echo with "hey echo, ...".
   *
   * Carries an id rather than just text so the same sentence said twice still
   * runs twice — comparing strings would silently swallow the second attempt,
   * and a person who was not heard the first time will simply repeat
   * themselves. An empty text opens Echo and waits.
   */
  spoken?: { id: number; text: string };
};

/** Bounded communication flow backed by Android speech recognition. */
export function SecondVoicePanel({ enabled, phraseHints = [], onOpenChange, spoken }: Props) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(secondVoiceReducer, initialSecondVoiceState);
  const requestVersion = useRef(0);
  const fallback = useMemo(() => new PhrasebookFallbackProvider(), []);
  const localGemma = useLocalGemma();
  // Prefer private on-device inference. This hackathon build uses its bundled
  // Claude key only as an availability fallback; otherwise keep the
  // communication aid functional with the deterministic phrasebook.
  const provider = useMemo(
    () => localGemma.isLoaded
      ? localGemma.provider
      : anthropicConfigured ? new AnthropicReconstructionProvider(fallback) : fallback,
    [fallback, localGemma.isLoaded, localGemma.provider]
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

  // Driven off the state rather than the two call sites that change it: a
  // future third way to close the panel would otherwise silently leave the
  // wake phrase muted for the rest of the session.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  /**
   * "hey echo, I would like some water" — open and run it, no tapping.
   *
   * Keyed on the id so a repeated sentence still fires. The submit is deferred
   * by a tick because the reducer has to reach the listening phase first;
   * submit() refuses to run in any other phase, by design.
   */
  const lastSpokenId = useRef<number | null>(null);
  useEffect(() => {
    if (!spoken || !enabled) return;
    if (lastSpokenId.current === spoken.id) return;
    lastSpokenId.current = spoken.id;

    setOpen(true);
    dispatch({ type: 'ACTIVATE' });
    const text = spoken.text.trim();
    if (!text) return;
    dispatch({ type: 'TRANSCRIPT', text });
    const timer = setTimeout(() => void submit(text), 0);
    return () => clearTimeout(timer);
  }, [spoken, enabled]);

  useEffect(() => {
    if (state.phase !== 'speaking') return;
    Speech.stop();
    Speech.speak(state.text, { rate: 0.95 });
  }, [state]);

  if (!enabled) return null;
  if (!open) {
    return (
      <Pressable
        style={styles.launch}
        onPress={() => { setOpen(true); dispatch({ type: 'ACTIVATE' }); }}
      >
        <SiriOrb state="idle" size={26} />
        <Text style={styles.launchText}>Echo</Text>
      </Pressable>
    );
  }

  /*
   * The orb says which of the four things is happening, so the words below it
   * do not have to. Siri's whole trick is that you can tell it is listening
   * from across a room without reading anything, and that is worth more here
   * than in most apps: the person using Echo may be struggling with language,
   * which is why they are using Echo.
   */
  const orbState: OrbState =
    state.phase === 'processing' ? 'thinking'
      : state.phase === 'speaking' ? 'speaking'
        : speech.listening ? 'listening'
          : 'idle';

  const caption =
    state.phase === 'processing' ? 'Thinking…'
      : state.phase === 'speaking' ? 'Speaking'
        : speech.listening ? 'Listening…'
          : 'Tap to speak';

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Echo</Text>
      </View>

      <View style={styles.stage}>
        {/*
          The orb IS the button, the way Siri is. The handler underneath is
          untouched — this only changes what the tap target looks like.
        */}
        <Pressable
          style={styles.orbTap}
          onPress={() => void (speech.listening ? speech.stop() : speech.start()).catch((error) => dispatch({ type: 'ERROR', message: error instanceof Error ? error.message : 'Speech recognition failed.' }))}
          disabled={state.phase !== 'listening'}
          accessibilityRole="button"
          accessibilityLabel={speech.listening ? 'Stop listening' : 'Start listening'}
        >
          <SiriOrb state={orbState} size={128} />
        </Pressable>

        <Text style={styles.caption}>{caption}</Text>

        {/*
          The live transcript, set large and centred. This is the thing the
          user is actually watching — whether the machine heard them right —
          so it gets the size that importance deserves rather than a footnote.
        */}
        {state.phase === 'listening' && speech.partial ? (
          <Text style={styles.partial}>{speech.partial}</Text>
        ) : null}
        {state.phase === 'speaking' && <Text style={styles.spoken}>{state.text}</Text>}
        {state.phase === 'processing' && <Text style={styles.help}>Putting your words together.</Text>}
      </View>

      {state.phase === 'listening' && <>
        {!speech.partial && !speech.listening && (
          <Text style={styles.help}>Speak naturally; Android will transcribe your words on-device or via its configured speech service.</Text>
        )}
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
        {!localGemma.isLoaded && anthropicConfigured && (
          <Text style={styles.cloudNotice}>Using Claude fallback — demo build key is bundled in this app.</Text>
        )}
      </>}
      {state.phase === 'error' && <Text style={styles.error}>{state.message}</Text>}
      <Pressable style={styles.cancel} onPress={close}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
   * Near-black rather than the old slate blue, and a much larger radius.
   * Everything that is not the orb is deliberately quiet: the panel is a dark
   * room with one light in it, which is the entire visual idea being borrowed.
   *
   * No blur. expo-blur is a native dependency and this is decoration; layered
   * translucency reads close enough on a black background.
   */
  panel: {
    position: 'absolute',
    zIndex: 10,
    left: 14,
    right: 14,
    top: 14,
    bottom: 14,
    // Fully opaque. At 97% the idle screen behind it showed through — the
    // face's two eyes read as a pair of grey circles floating beside the orb,
    // and "Tap anywhere to start" ghosted under the paragraph. Translucency is
    // only free when there is nothing behind you.
    backgroundColor: '#0a0a0e',
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    paddingHorizontal: 24,
    // Centred with real gaps rather than space-between. space-between plus a
    // flex:1 stage let the stage's centred caption overlap the paragraph
    // underneath it, because an overflowing flex child is not clipped in React
    // Native — it just draws on top of its neighbour.
    justifyContent: 'center',
    gap: 10,
  },

  header: { alignItems: 'center' },
  title: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  stage: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  orbTap: { alignItems: 'center', justifyContent: 'center' },

  caption: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    letterSpacing: 0.3,
  },

  /** The live transcript. Large, light, centred — the Siri treatment. */
  partial: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '300',
    lineHeight: 34,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  spoken: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '300',
    lineHeight: 34,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  help: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },

  /* Controls: translucent pills, no solid blue slab. */
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryText: { color: 'rgba(255,255,255,0.8)', fontWeight: '600', fontSize: 13 },
  modelButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingVertical: 10,
  },

  cancel: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 28 },
  cancelText: { color: 'rgba(255,255,255,0.5)', fontWeight: '500', fontSize: 15 },

  error: { color: '#ff9b8f', fontSize: 13, textAlign: 'center' },
  localReady: { color: 'rgba(126,224,160,0.75)', fontSize: 11.5, textAlign: 'center' },
  cloudNotice: { color: 'rgba(240,201,121,0.75)', fontSize: 11.5, textAlign: 'center' },
  modelError: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,90,80,0.10)' },

  /** The launcher, now carrying a small orb so it looks like what it opens. */
  launch: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  launchText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

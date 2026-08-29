import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { DuoSpeech, DuoSpeechEvents } from '../../../modules/duo-speech/src';

export function useSpeechRecognizer(onFinalTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const partialSub = DuoSpeechEvents.addListener('onSpeechPartial', ({ text }) => setPartial(text));
    const resultSub = DuoSpeechEvents.addListener('onSpeechResult', ({ text }) => {
      setPartial('');
      setListening(false);
      onFinalTranscript(text);
    });
    const errorSub = DuoSpeechEvents.addListener('onSpeechError', ({ message }) => {
      setListening(false);
      setError(message);
    });
    const stateSub = DuoSpeechEvents.addListener('onSpeechState', ({ state }) => {
      if (state === 'listening' || state === 'speaking' || state === 'ready') setListening(true);
      if (state === 'idle' || state === 'cancelled') setListening(false);
    });
    return () => {
      partialSub.remove(); resultSub.remove(); errorSub.remove(); stateSub.remove();
    };
  }, [onFinalTranscript]);

  const start = useCallback(async () => {
    setError(null);
    if (Platform.OS === 'android') {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        setError('Microphone permission is required for voice input.');
        return;
      }
    }
    setPartial('');
    setListening(true);
    // en-IN is not preinstalled on the target iQOO and its Vivo settings skin
    // does not expose Google's language-pack manager. en-US is bundled with
    // the on-device recognizer and still handles Indian English adequately.
    await DuoSpeech.startListening('en-US');
  }, []);

  const stop = useCallback(async () => { await DuoSpeech.stopListening(); }, []);
  const cancel = useCallback(async () => { await DuoSpeech.cancelListening(); setListening(false); }, []);

  return { start, stop, cancel, listening, partial, error };
}

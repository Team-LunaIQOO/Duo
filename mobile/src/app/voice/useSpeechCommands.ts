/**
 * Tap-to-talk speech recognition, wired to the existing command parser.
 *
 * 02-product-spec.md lists voice first among the control methods, "because it
 * works regardless of which hand is affected". Until now none of it was
 * connected: commandParser.ts parsed the six commands, handleHeardSpeech
 * routed each to the same action the touch buttons call, and nothing ever
 * called handleHeardSpeech, because the app had no recogniser at all
 * (expo-speech only speaks). This hook is that missing half and nothing more —
 * it produces a transcript and hands it over.
 *
 * ## Tap to talk, not a wake phrase
 *
 * There is deliberately no "Hey Duo". 03-architecture.md's licensing warning
 * still stands: Porcupine's free tier will not ship a custom wake word on ARM
 * Android, and the free pre-trained alternatives would mean renaming the
 * assistant. That same warning names tap-to-talk as the safe default, and
 * 02-product-spec.md already requires a tap-to-talk button to be visible at all
 * times regardless. So the microphone opens on a tap and closes itself.
 *
 * It is also the honest choice for the battery and the privacy claim: nothing
 * listens until the user asks it to.
 *
 * ## On-device where the device allows it
 *
 * README rule #1 is that the session loop makes no network calls, and the pitch
 * says the exercise session works in airplane mode. Android's default recogniser
 * is a cloud service, so `requiresOnDeviceRecognition` is set whenever the
 * device reports support for it (Android 13+ with the offline model
 * downloaded). Where it is unsupported this falls back to the platform default
 * rather than failing — and `usingOnDevice` says which happened, so nobody has
 * to guess before making the claim on stage.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { parseVoiceCommand } from './commandParser';

/**
 * Words worth biasing the recogniser toward. These are the tokens
 * commandParser.ts matches on, so nudging the engine toward them costs nothing
 * and measurably helps with single-word utterances, which are the hardest case
 * for a general-purpose model.
 */
const COMMAND_HINTS = [
  'start',
  'begin',
  'pause',
  'wait',
  'stop',
  'end session',
  'finish',
  'next',
  'skip',
  'repeat that',
  'say again',
  'how many',
];

export type SpeechCommandsStatus = {
  /** True while the microphone is open. */
  listening: boolean;
  /** False when the device has no usable recogniser — the button then hides. */
  available: boolean;
  /** True when recognition is running without sending audio off the device. */
  usingOnDevice: boolean;
  /** Last error code from the recogniser, for the dev overlay. */
  lastError: string | null;
  /** Last transcript received, for the dev overlay. */
  lastHeard: string | null;
  /** Open the microphone. Safe to call when already listening. */
  listen: () => void;
  /** Close it early. It closes itself on a final result. */
  stopListening: () => void;
};

export function useSpeechCommands(onHeard: (heard: string) => void): SpeechCommandsStatus {
  // onHeard closes over session state and therefore changes identity on most
  // renders. Held in a ref so the native event listeners below never capture a
  // stale one — the same hazard the vision stream documents, for a different
  // subscription.
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;

  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState(false);
  const [usingOnDevice, setUsingOnDevice] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  // Capability is asked once. Both calls are synchronous native reads, but
  // they are wrapped because a missing native module must degrade to "no
  // microphone button" rather than taking the whole app down with it — voice
  // is Tier 3 and touch is the method that must never fail.
  useEffect(() => {
    try {
      setAvailable(ExpoSpeechRecognitionModule.isRecognitionAvailable());
      setUsingOnDevice(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition());
    } catch {
      setAvailable(false);
      setUsingOnDevice(false);
    }
  }, []);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));

  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    // 'no-speech' is the user tapping and then saying nothing. It is not a
    // fault and must not surface as one.
    setLastError(event.error === 'no-speech' ? null : event.error);
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return;

    // Every alternative is checked, best first, and the first one that yields a
    // command is the one handed on — exactly one command per tap, never two.
    //
    // Commands here are one or two words, which is where a general recogniser's
    // top pick is least reliable: "start" comes back as "star" or "art" often
    // enough to matter. Looking one row further down a list the engine has
    // already produced costs nothing. The parser is pure, so asking it here and
    // again downstream is free and keeps it the single source of truth about
    // what counts as a command.
    const transcripts = event.results.map((r) => r.transcript).filter(Boolean);
    if (transcripts.length === 0) return;

    const understood = transcripts.find((t) => parseVoiceCommand(t) !== null);
    setLastHeard(understood ?? transcripts[0]);
    onHeardRef.current(understood ?? transcripts[0]);
  });

  const listen = useCallback(() => {
    void (async () => {
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setLastError('not-allowed');
          return;
        }

        // Duo may be mid-sentence. Left running, its own voice goes into the
        // microphone and comes back as a transcript.
        Speech.stop();

        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: false,
          maxAlternatives: 5,
          // One command per tap. Continuous recognition would hold the
          // microphone open for the whole session, which 03-architecture.md
          // rules out ("Never continuous") and which the battery would notice.
          continuous: false,
          requiresOnDeviceRecognition: usingOnDevice,
          contextualStrings: COMMAND_HINTS,
        });
      } catch (error) {
        setListening(false);
        setLastError(error instanceof Error ? error.message : 'start-failed');
      }
    })();
  }, [usingOnDevice]);

  const stopListening = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped, or the module is missing. Either way there is nothing
      // to recover and nothing worth telling the user.
    }
  }, []);

  // Never leave the microphone open behind us.
  useEffect(() => () => {
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Nothing was running.
    }
  }, []);

  return { listening, available, usingOnDevice, lastError, lastHeard, listen, stopListening };
}

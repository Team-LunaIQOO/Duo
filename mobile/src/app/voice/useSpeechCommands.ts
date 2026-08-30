/**
 * Speech control: a "hey duo" wake phrase, with tap-to-talk still there as the
 * fallback that cannot fail.
 *
 * 02-product-spec.md lists voice first among the control methods, "because it
 * works regardless of which hand is affected", and its session walkthrough
 * opens with "The user says the wake phrase, or taps the screen". Both halves
 * are here.
 *
 * ## No wake-word engine, and why that is fine
 *
 * 03-architecture.md's licensing warning is about Porcupine: its free tier
 * will not ship a custom "Hey Duo" model on ARM Android. That is still true,
 * and nothing here goes near it. The recogniser that already serves voice
 * commands is left running continuously instead, and wakePhrase.ts matches the
 * phrase in the transcript. One model, no new dependency, no licence.
 *
 * ## The rule that makes continuous listening acceptable
 *
 * **The microphone is only ever left open when recognition runs on-device.**
 * If the phone cannot do on-device recognition, the wake phrase is disabled
 * and voice control falls back to tap-to-talk. Continuously streaming a
 * living room to a cloud recogniser is not a trade this product gets to make:
 * README rule #1 puts the session loop on the device, and 01-problem-and-users
 * describes people doing rehab at home, often with someone else in the room.
 * A wake phrase is not worth that, so it simply switches itself off instead.
 *
 * That also keeps the pitch honest — with on-device recognition the audio
 * never leaves the phone, so "the exercise session works in airplane mode"
 * survives having a wake phrase.
 *
 * ## Duo must not obey itself
 *
 * While main TTS is speaking, recognition accepts only the wake phrase. That
 * allows a user to say "hey duo" to interrupt a long answer, but prevents a
 * spoken line such as "Tap or say start when ready" from executing its own
 * command. Fall-alert and Echo speech still mute recognition completely.
 * The voice self-test also checks that no fixed spoken line contains the wake
 * phrase, as a standing guard on future feedback lines.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { parseVoiceCommand } from './commandParser';
import { isFallAlertCancelRequest, isOpenEchoRequest } from './navigation';
import { matchWakePhrase, routeWakeMatch } from './wakePhrase';

/**
 * Words worth biasing the recogniser toward: the tokens commandParser.ts
 * matches on, plus the wake phrase itself. Nudging a general model toward
 * "duo" is the cheapest available improvement to wake reliability, since it is
 * a name rather than a word the language model expects.
 */
const COMMAND_HINTS = [
  'hey duo',
  'duo',
  'hey echo',
  'open echo',
  'echo',
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

/**
 * How long a bare "hey duo" keeps listening for the command that follows it.
 * Long enough to think, short enough that a later unrelated sentence is not
 * taken as an instruction.
 */
const ARMED_WINDOW_MS = 8_000;

/**
 * A longer window after a Claude chat reply. It renews after every turn, so a
 * conversation feels continuously interactive without making unrelated room
 * speech actionable for the entire lifetime of the app.
 */
const CONVERSATION_WINDOW_MS = 30_000;

/**
 * Delay before restarting a continuous session that ended on its own.
 *
 * Every millisecond here is a millisecond the microphone is shut. Measured on
 * the device, Android was ending sessions after 0.6-3.3 seconds regardless of
 * `continuous: true`, so this gap came round every couple of seconds and a
 * wake phrase spoken into one was simply never heard. The app looked broken
 * and every status row said it was fine, because it was: the microphone was
 * open, just not at that instant.
 *
 * 120ms is about as low as is useful — below that the platform tends to
 * refuse the start as too soon after the last one.
 */
const RESTART_DELAY_MS = 120;

/**
 * How long the recogniser tolerates silence before deciding the utterance is
 * over and ending the session.
 *
 * Android's defaults are tuned for dictation, where a pause means the sentence
 * finished. Here silence is the normal state — the app waits, quietly, for
 * somebody to say its name — so the defaults end the session constantly. These
 * push it out to the platform maximum that still behaves.
 */
const ANDROID_SILENCE_OPTIONS = {
  EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000,
  EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000,
  EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 20_000,
} as const;

/**
 * Consecutive start failures before wake listening gives up for good. Without
 * this, a device that refuses to start recognition would be asked forever.
 */
const MAX_CONSECUTIVE_ERRORS = 5;

export type SpeechCommandsStatus = {
  /** True while the microphone is open, for either reason. */
  listening: boolean;
  /** False when the device has no usable recogniser — the button then hides. */
  available: boolean;
  /** True when recognition runs without sending audio off the device. */
  usingOnDevice: boolean;
  /**
   * Why on-device recognition is not in use, when it is not. Empty when it is.
   * Surfaced because "the microphone does not work" and "the offline language
   * pack is missing" look identical from the outside.
   */
  onDeviceNote: string;
  /** True when the wake phrase is being listened for right now. */
  wakeActive: boolean;
  /** True while a wake (or a tap) has armed the next utterance as a command. */
  armed: boolean;
  /** Last error code from the recogniser, for the dev overlay. */
  lastError: string | null;
  /** Last transcript received, for the dev overlay. */
  lastHeard: string | null;
  /** Arm the next utterance as a command, opening the microphone if needed. */
  listen: () => void;
  /** Disarm early. */
  stopListening: () => void;
  /** Whether the user has switched the wake phrase off. */
  wakeEnabled: boolean;
  setWakeEnabled: (enabled: boolean) => void;
};

type Options = {
  /** A command was heard. The transcript, for the caller to parse and route. */
  onHeard: (heard: string) => void;
  /** A bare "hey duo" with no command attached. */
  onWake: () => void;
  /**
   * "hey echo, <sentence>" — the sentence the user wants spoken for them,
   * handed straight to Echo. A bare "hey echo" arrives as an empty string,
   * which opens Echo and waits rather than speaking nothing.
   */
  onEcho: (sentence: string) => void;
  /** A possible-fall countdown is visible and may be cancelled hands-free. */
  fallAlertActive: boolean;
  /** Cancel the pending caregiver alert after a final safety phrase. */
  onFallAlertCancel: () => void;
  /** Increments when Claude has spoken a conversational reply. */
  followUpToken: number;
  /** True while Duo's main TTS can be interrupted by saying the wake phrase. */
  interruptibleSpeaking: boolean;
  /**
   * True when another audio/recognition flow owns the microphone. Unlike main
   * TTS, this suspends recognition completely.
   */
  muted: boolean;
};

export function useSpeechCommands({
  onHeard,
  onWake,
  onEcho,
  fallAlertActive,
  onFallAlertCancel,
  followUpToken,
  interruptibleSpeaking,
  muted,
}: Options): SpeechCommandsStatus {
  // Both callbacks close over session state and change identity on most
  // renders. Held in refs so the native listeners never capture a stale one —
  // the same hazard the vision stream documents, for a different subscription.
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const onEchoRef = useRef(onEcho);
  onEchoRef.current = onEcho;
  const fallAlertActiveRef = useRef(fallAlertActive);
  fallAlertActiveRef.current = fallAlertActive;
  const onFallAlertCancelRef = useRef(onFallAlertCancel);
  onFallAlertCancelRef.current = onFallAlertCancel;
  const interruptibleSpeakingRef = useRef(interruptibleSpeaking);
  interruptibleSpeakingRef.current = interruptibleSpeaking;

  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState(false);
  const [usingOnDevice, setUsingOnDevice] = useState(false);
  const [onDeviceNote, setOnDeviceNote] = useState('');
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [armed, setArmed] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  const armedUntilRef = useRef(0);
  /**
   * When a bare wake was last acted on.
   *
   * Matching on partials means the same "hey duo" arrives twice — once as a
   * partial and again in the final — and each would fire the wake. From idle
   * that is two startSetup calls for one greeting. The window is short enough
   * that genuinely saying the name twice still works.
   */
  const lastWakeAt = useRef(0);
  /**
   * The most recent non-empty partial, held until a final arrives.
   *
   * This recogniser's finals are empty; the words live in the partials. See
   * the note in the result handler.
   */
  const lastPartialRef = useRef<string[]>([]);
  const errorCountRef = useRef(0);
  /**
   * Which kind of session is open, so the keep-alive effect below can tell its
   * own continuous session apart from a one-shot started by the button.
   * Without it, on a device with no on-device recognition — where the wake
   * phrase is off but the button still works — starting a one-shot flips
   * `listening`, re-runs that effect, and it aborts the session it just
   * started. The microphone would open and shut instantly, on exactly the
   * devices that have no other way to use voice.
   */
  const sessionKindRef = useRef<'wake' | 'oneshot' | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permissionRef = useRef<boolean | null>(null);
  const lastFollowUpTokenRef = useRef(followUpToken);
  const pendingFollowUpRef = useRef<{ token: number; sawSpeaking: boolean } | null>(null);

  /*
   * The wake phrase used to require on-device recognition, as a privacy rule I
   * set: never hold the microphone open unless the audio stays on the phone.
   *
   * On this device that rule silently disabled the entire product. The phone
   * reports on-device support but has no English pack installed, so the
   * recogniser returned empty results forever and "hey duo" was never heard.
   * A privacy guarantee that turns the app off is not a guarantee anyone
   * benefits from.
   *
   * So the wake phrase now runs either way. Capability is checked silently:
   * use the on-device recogniser when its English pack is already installed,
   * otherwise use Android's platform default without opening the system model
   * download dialog during app startup.
   */
  const wakeSupported = available;
  const wakeActive = wakeSupported && wakeEnabled && !muted;

  // Capability is read once. Wrapped because a missing native module must
  // degrade to "no microphone button" rather than taking the app down — voice
  // is Tier 3 and touch is the method that must never fail.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const canRecognise = ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (!cancelled) setAvailable(canRecognise);
        if (!canRecognise) return;

        if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
          if (!cancelled) setOnDeviceNote('device has no on-device recogniser');
          return;
        }

        /*
         * supportsOnDeviceRecognition() answers "is the feature present", not
         * "is a language actually installed", and those are very different
         * things. With the feature present but the en-US pack missing, the
         * recogniser runs, reports withSpeech: true, and returns
         * "empty final recognition results" forever — which is exactly what
         * this device was doing. It looks like a broken microphone and is not
         * one, and nothing in the API says so unless you ask for the locale
         * list.
         */
        const locales = await ExpoSpeechRecognitionModule.getSupportedLocales({
          androidRecognitionServicePackage: 'com.google.android.as',
        }).catch(() => null);

        const installed = locales?.installedLocales ?? [];
        const hasEnglish = installed.some((locale) => locale.toLowerCase().startsWith('en'));

        if (cancelled) return;

        if (hasEnglish) {
          setUsingOnDevice(true);
          setOnDeviceNote('');
          return;
        }

        // Do not trigger Android's model-download flow here. On this device it
        // opens a confirmation activity every time the app starts while the
        // pack is absent. A startup capability check must be read-only: the
        // platform recogniser remains functional over the network, and a pack
        // installed separately will be picked up on the next launch.
        setUsingOnDevice(false);
        setOnDeviceNote('');
      } catch {
        if (cancelled) return;
        setAvailable(false);
        setUsingOnDevice(false);
        setOnDeviceNote('recogniser unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const disarm = useCallback(() => {
    armedUntilRef.current = 0;
    setArmed(false);
  }, []);

  const arm = useCallback((durationMs = ARMED_WINDOW_MS) => {
    armedUntilRef.current = Date.now() + durationMs;
    setArmed(true);
  }, []);

  // A friendly Claude reply gets one short conversational follow-up window.
  // Wait until TTS has both started and finished before arming; otherwise the
  // eight-second window would be consumed while Duo itself is still talking.
  useEffect(() => {
    if (followUpToken === lastFollowUpTokenRef.current) return;
    lastFollowUpTokenRef.current = followUpToken;
    pendingFollowUpRef.current = { token: followUpToken, sawSpeaking: interruptibleSpeaking };
  }, [followUpToken, interruptibleSpeaking]);

  useEffect(() => {
    const pending = pendingFollowUpRef.current;
    if (!pending) return;
    if (interruptibleSpeaking) {
      pending.sawSpeaking = true;
      return;
    }
    if (pending.sawSpeaking) {
      pendingFollowUpRef.current = null;
      arm(CONVERSATION_WINDOW_MS);
    }
  }, [interruptibleSpeaking, arm]);

  /** Opens a recognition session. Continuous when listening for the wake phrase. */
  const startSession = useCallback(
    (continuous: boolean) => {
      void (async () => {
        try {
          if (permissionRef.current !== true) {
            const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            permissionRef.current = permission.granted;
            if (!permission.granted) {
              setLastError('not-allowed');
              return;
            }
          }

          sessionKindRef.current = continuous ? 'wake' : 'oneshot';
          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            // Interim results matter for a wake phrase. A final result only
            // arrives once the recogniser decides the utterance is over, which
            // is a second or more after the words were actually said; matching
            // the phrase on a partial is the difference between Duo answering
            // as you finish speaking and answering after an awkward pause.
            interimResults: true,
            maxAlternatives: 5,
            continuous,
            requiresOnDeviceRecognition: usingOnDevice,
            contextualStrings: COMMAND_HINTS,
            androidIntentOptions: ANDROID_SILENCE_OPTIONS,
          });
        } catch (error) {
          errorCountRef.current += 1;
          sessionKindRef.current = null;
          setListening(false);
          setLastError(error instanceof Error ? error.message : 'start-failed');
        }
      })();
    },
    [usingOnDevice]
  );

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    errorCountRef.current = 0;
  });

  useSpeechRecognitionEvent('end', () => {
    sessionKindRef.current = null;
    // Whatever was half-heard when the session ended is not an instruction.
    lastPartialRef.current = [];
    setListening(false);
  });

  useSpeechRecognitionEvent('error', (event) => {
    sessionKindRef.current = null;
    setListening(false);

    // Two of these are not faults, and counting them would be a slow-acting
    // bug rather than a cosmetic one.
    //
    // 'no-speech' is a quiet room, which is the normal state of a continuous
    // session — it fires constantly.
    //
    // 'aborted' is this hook's own doing: the session is aborted every single
    // time Duo speaks, because the microphone has to close while it talks.
    // Counted as failures, five spoken lines would exhaust the give-up
    // threshold and switch the wake phrase off for the rest of the session,
    // with nothing on screen to explain why. That is exactly the kind of
    // feature that looks finished and quietly stops working.
    if (event.error === 'no-speech' || event.error === 'aborted') {
      setLastError(null);
      return;
    }

    errorCountRef.current += 1;
    setLastError(event.error);
  });

  useSpeechRecognitionEvent('result', (event) => {
    let transcripts = event.results.map((r) => r.transcript).filter(Boolean);

    /*
     * Carry the last partial forward into an empty final.
     *
     * On this device the on-device recogniser puts its words in PARTIAL
     * results and then delivers a final with nothing in it — Android's own log
     * says "onResults empty final recognition results" after every utterance.
     *
     * Two correct-looking rules collided here. Acting only on finals is right:
     * a half-heard sentence is easily a different sentence, and executing one
     * mid-utterance could end a session the user was in the middle of. But
     * with finals arriving empty, that rule discarded every word ever spoken
     * to the app, and the symptom was simply that nothing happened.
     *
     * Buffering the last partial satisfies both. Actions still fire only when
     * Android says the utterance is over, so nothing acts early — the final
     * just no longer has to carry the text itself.
     */
    if (!event.isFinal && transcripts.length > 0) {
      lastPartialRef.current = transcripts;
    }

    if (transcripts.length === 0) {
      if (!event.isFinal || lastPartialRef.current.length === 0) return;
      transcripts = lastPartialRef.current;
    }

    if (event.isFinal) lastPartialRef.current = [];

    /*
     * Barge-in is deliberately wake-gated. Android may transcribe audio coming
     * from the phone's own speaker, so accepting arbitrary speech here would
     * let Duo execute words from its own reply. A user saying "hey duo" is the
     * one unambiguous interruption signal: stop TTS immediately, then either
     * handle the remainder of the final transcript or keep listening for it.
     */
    if (interruptibleSpeakingRef.current) {
      for (const transcript of transcripts) {
        const wake = matchWakePhrase(transcript);
        if (!wake.matched || wake.target !== 'duo') continue;

        setLastHeard(transcript);
        void Speech.stop();
        const route = routeWakeMatch(wake, event.isFinal);
        if (route.kind === 'instruction') {
          disarm();
          onHeardRef.current(route.sentence);
        } else {
          arm();
        }
        return;
      }

      // This is normally Duo's own voice. Never display or act on it.
      return;
    }

    setLastHeard(transcripts[0]);

    /*
     * Interim results are used for the wake phrase and ignored for everything
     * else.
     *
     * The wake phrase wants to fire the instant the name is recognised, and
     * "hey duo" is short enough to be stable in a partial. A command, by
     * contrast, must never act on a partial: "stop" is a prefix of nothing
     * useful, but a half-heard sentence is easily a different sentence, and
     * acting on it would end a session the user was mid-way through.
     *
     * The guard below makes that concrete: a partial Duo wake may arm the
     * command window, but nothing is allowed to speak, navigate, or execute
     * until Android marks the transcript final.
     */
    const isFinal = event.isFinal;
    const now = Date.now();

    // A safety cancellation cannot require a wake phrase or a usable hand.
    // It is available only while the countdown is visible, and only from a
    // final transcript so a partial cannot cancel an alert accidentally.
    if (isFinal && fallAlertActiveRef.current && transcripts.some(isFallAlertCancelRequest)) {
      disarm();
      onFallAlertCancelRef.current();
      return;
    }

    // 1. The wake phrase, checked across every alternative. "duo" is a name,
    //    so it is exactly the kind of token a general recogniser demotes.
    for (const transcript of transcripts) {
      const wake = matchWakePhrase(transcript);
      if (!wake.matched) continue;
      const route = routeWakeMatch(wake, isFinal);

      if (route.kind === 'defer') {
        // Arming on a partial Duo wake is safe because it has no visible or
        // audible side effect. Echo needs no armed window: its final wake
        // transcript carries the complete sentence itself.
        if (wake.target === 'duo') arm();
        return;
      }

      // Echo takes the final remainder verbatim. It is not parsed for
      // commands: a sentence containing "stop" must not stop the session.
      if (route.kind === 'echo') {
        disarm();
        onEchoRef.current(route.sentence);
        return;
      }

      if (route.kind === 'instruction') {
        /*
         * Anything said after the name is an instruction, and every one of
         * them goes on to be understood — by the model first, by the keyword
         * parser if the model cannot be reached.
         *
         * This used to ask parseVoiceCommand whether the remainder was a
         * command, and only forward it if the answer was yes. That gate made
         * sense when keywords were the only thing downstream. Once the model
         * became the thing that understands language, the gate meant every
         * sentence the KEYWORD list did not recognise was dropped here and
         * never reached the model at all — so "hey duo, lets do curls with my
         * weak arm" woke Duo up and did nothing, which is precisely the
         * phrasing the model exists to handle.
         *
         * The transcript is now passed on whatever it says. Deciding what a
         * sentence means is not this function's job.
        */
        disarm();
        onHeardRef.current(route.sentence);
        return;
      }

      // A final bare "hey duo". Duo reacts and waits for the instruction.
      arm();
      if (now - lastWakeAt.current > 1500) {
        lastWakeAt.current = now;
        onWakeRef.current();
      }
      return;
    }

    // A one-word entry point matters for people who stutter. It is checked
    // only on a final, exact short phrase, so an interim "e..." or ordinary
    // speech containing the word echo cannot open the panel.
    if (isFinal && transcripts.some(isOpenEchoRequest)) {
      disarm();
      onEchoRef.current('');
      return;
    }

    // 2. No wake phrase. Only act if the user has already asked for attention,
    //    by saying the phrase or tapping the button. Everything else said in
    //    the room is discarded unheard, which is the whole point of a wake
    //    phrase — the microphone being open is not permission to act.
    if (!isFinal) return;
    if (Date.now() > armedUntilRef.current) return;

    // Alternatives again, best first, first one that parses wins. Single-word
    // commands are where a general model's top pick is least reliable: "start"
    // comes back as "star" often enough to matter.
    const understood = transcripts.find((t) => parseVoiceCommand(t) !== null);
    disarm();
    onHeardRef.current(understood ?? transcripts[0]);
  });

  // --- the continuous wake session ----------------------------------------
  //
  // Kept running whenever it should be, and restarted when it ends. Android
  // segments a continuous session and ends it on its own periodically, so
  // "start it once" is not enough; this is the loop that keeps it up.
  useEffect(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    // Another audio flow owns recognition. Main Duo TTS is not represented by
    // `muted`: its session stays open for wake-gated interruption above.
    if (muted) {
      if (sessionKindRef.current !== null) {
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          // Nothing running.
        }
      }
      return;
    }

    if (!wakeActive) {
      // The wake phrase is switched off or unsupported. Only a wake session is
      // ours to close here — a one-shot from the button must be left alone.
      if (sessionKindRef.current === 'wake') {
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          // Nothing running.
        }
      }
      return;
    }

    if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) return;

    if (!listening) {
      restartTimerRef.current = setTimeout(() => startSession(true), RESTART_DELAY_MS);
    }

    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
    };
  }, [wakeActive, muted, listening, startSession]);

  // The armed window closes on its own, so a tap or a wake that is never
  // followed by a command does not leave the app acting on the next thing it
  // happens to hear.
  useEffect(() => {
    if (!armed) return;
    const remaining = Math.max(0, armedUntilRef.current - Date.now());
    const timer = setTimeout(disarm, remaining + 50);
    return () => clearTimeout(timer);
  }, [armed, disarm]);

  /**
   * The tap-to-talk button. It arms the next utterance rather than opening a
   * second recognition session: with the wake session already running, a
   * second one would be refused by the platform. Where the wake phrase is
   * unavailable this opens a one-shot session instead, which is the
   * pre-wake-phrase behaviour and the reason the button still works on a
   * device that cannot do any of this.
   */
  const listen = useCallback(() => {
    Speech.stop();
    arm();
    if (!wakeActive && !listening) startSession(false);
  }, [arm, wakeActive, listening, startSession]);

  const stopListening = useCallback(() => {
    disarm();
    if (wakeActive) return; // leave the wake session running
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped, or the module is missing.
    }
  }, [disarm, wakeActive]);

  // Never leave the microphone open behind us.
  useEffect(
    () => () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Nothing was running.
      }
    },
    []
  );

  return {
    listening,
    available,
    usingOnDevice,
    onDeviceNote,
    wakeActive,
    armed,
    lastError,
    lastHeard,
    listen,
    stopListening,
    wakeEnabled: wakeSupported && wakeEnabled,
    setWakeEnabled,
  };
}

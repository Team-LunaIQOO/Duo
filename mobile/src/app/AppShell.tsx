import { StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSessionController } from './useSessionController';
import { useSpeakOnChange } from './voice/useSpeakOnChange';
import { useSpeechCommands } from './voice/useSpeechCommands';
import { IdleScreen } from './screens/IdleScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ActiveSessionScreen } from './screens/ActiveSessionScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { VisionCamera } from './vision/VisionCamera';
import { SecondVoicePanel } from './secondVoice';
import { DevOverlay } from './DevOverlay';
import { FallAlertOverlay, useFallAlert } from './fall';
import type { PoseFrame } from '../types/contracts';

/**
 * Composition root. Mounted directly by App.tsx.
 *
 * Owns: screens, face, session state machine, TTS, touch controls, and now the
 * mounting of Person A's camera view — which is rendered invisibly beneath the
 * UI so it produces landmarks while the patient only ever sees the face
 * (03-architecture.md, "the camera feed is never rendered on the phone
 * screen"). See VisionCamera for why it is hidden rather than unmounted.
 */
export function AppShell() {
  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      // Orientation is a presentation preference; a transient activity teardown
      // must not surface as an uncaught error or interrupt the session UI.
    });
  }, []);

  const controller = useSessionController();
  const { session } = controller;
  // Expo only inlines EXPO_PUBLIC variables referenced with static dot notation.
  const proxyEndpoint = process.env.EXPO_PUBLIC_SECOND_VOICE_PROXY_URL;
  const fallAlertEndpoint = process.env.EXPO_PUBLIC_FALL_ALERT_PROXY_URL;
  const fallAlert = useFallAlert(fallAlertEndpoint);
  const poseHandlers = useRef({ session: controller.handlePoseFrame, fall: fallAlert.handlePoseFrame });
  poseHandlers.current = { session: controller.handlePoseFrame, fall: fallAlert.handlePoseFrame };
  const handlePoseFrame = useCallback((frame: PoseFrame) => {
    poseHandlers.current.session(frame);
    poseHandlers.current.fall(frame);
  }, []);

  // `speaking` closes the microphone for as long as Duo is talking. Without
  // it the wake session hears Duo say "Paused. Tap or say start when ready",
  // matches the word start, and resumes the session it just paused.
  const speaking = useSpeakOnChange(session.lastSpoken);

  // Speech recognition lives here rather than inside useSessionController, so
  // the controller keeps no dependency on a native module and can still be
  // driven by the mocks in src/app/mock/ without a device. Every command it
  // produces goes through handleHeardSpeech, which routes to the same actions
  // the touch buttons call (02-product-spec.md: voice must never be the only
  // route to a function, and touch must never fail).
  // Second Voice brings its own recogniser (modules/duo-speech). Android
  // serves one recognition session at a time, so the wake phrase stands down
  // while that panel is open — see the note on SecondVoicePanel's
  // onOpenChange. useState's setter is stable, so this does not re-subscribe
  // anything.
  const [secondVoiceOpen, setSecondVoiceOpen] = useState(false);

  // "hey echo, <sentence>" arrives here and is handed to the panel. The id
  // rises every time so the same sentence said twice runs twice.
  const [spokenToEcho, setSpokenToEcho] = useState<{ id: number; text: string }>();
  const echoIdRef = useRef(0);
  const handleEcho = useCallback((sentence: string) => {
    echoIdRef.current += 1;
    setSpokenToEcho({ id: echoIdRef.current, text: sentence });
  }, []);

  const voice = useSpeechCommands({
    onHeard: controller.handleHeardSpeech,
    onWake: controller.handleWake,
    onEcho: handleEcho,
    muted: speaking || secondVoiceOpen,
  });

  return (
    <View style={styles.container}>
      <VisionCamera
        enabled={controller.cameraNeeded}
        onPoseFrame={handlePoseFrame}
        onSnapshot={controller.handleSnapshot}
      />

      {session.phase === 'idle' && (
        <IdleScreen
          onTapToTalk={controller.startSetup}
          voice={voice}
          faceState={session.faceState}
          gaze={controller.gaze}
        />
      )}

      {session.phase === 'setup' && (
        <SetupScreen
          framed={controller.framed}
          onChooseExercise={controller.chooseExercise}
          faceState={session.faceState}
          gaze={controller.gaze}
        />
      )}

      {(session.phase === 'active' || session.phase === 'resting') && (
        <ActiveSessionScreen
          session={session}
          currentArm={controller.currentArm}
          calibrating={controller.calibrating}
          onPause={controller.pauseSession}
          onResume={controller.resumeSession}
          onSwitchArm={controller.switchArm}
          onEnd={controller.endSession}
          voice={voice}
          gaze={controller.gaze}
        />
      )}

      {session.phase === 'ended' && (
        <SummaryScreen
          session={session}
          onRestart={controller.restartSession}
          gaze={controller.gaze}
        />
      )}

      <DevOverlay
        session={session}
        framed={controller.framed}
        calibrating={controller.calibrating}
        ready={controller.ready}
        currentArm={controller.currentArm}
        eventLog={controller.eventLog}
        fatigueDebug={controller.fatigueDebug}
        gestureDebug={controller.gestureDebug}
        voice={voice}
        gaze={controller.gaze}
      />

      <SecondVoicePanel
        enabled={session.phase !== 'active'}
        onOpenChange={setSecondVoiceOpen}
        spoken={spokenToEcho}
        endpoint={proxyEndpoint}
        phraseHints={['I need a break.', 'Please help me.', 'I would like some water.']}
      />

      <FallAlertOverlay
        state={fallAlert.state}
        onCancel={fallAlert.cancel}
        onDismiss={fallAlert.dismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

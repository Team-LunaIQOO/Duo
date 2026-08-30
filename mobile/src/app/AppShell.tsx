import { StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSessionController } from './useSessionController';
import { useSpeakOnChange } from './voice/useSpeakOnChange';
import { useSpeechCommands } from './voice/useSpeechCommands';
import { checkProxyHealth, type ProxyHealth } from './voice/replyClient';
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
  const fallAlertEndpoint = process.env.EXPO_PUBLIC_FALL_ALERT_PROXY_URL;
  // Fall detection is a scoped elbow-curl session capability, not a global
  // camera side effect. This keeps idle/setup/shoulder movement and pauses
  // from producing a caregiver-alert popup while preserving the pitch demo.
  const fallDetectionEnabled = session.phase === 'active' && session.exercise === 'E3';
  const fallAlert = useFallAlert(fallAlertEndpoint, fallDetectionEnabled);
  const poseHandlers = useRef({ session: controller.handlePoseFrame, fall: fallAlert.handlePoseFrame });
  poseHandlers.current = { session: controller.handlePoseFrame, fall: fallAlert.handlePoseFrame };
  const handlePoseFrame = useCallback((frame: PoseFrame) => {
    poseHandlers.current.session(frame);
    poseHandlers.current.fall(frame);
  }, []);

  // Recognition closes while Duo talks. This phone's recognizer captures its
  // own loudspeaker and can deliver that audio as a delayed final transcript,
  // so full-duplex TTS would make Duo act on words it said itself.
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
  const [fallAlertSpeaking, setFallAlertSpeaking] = useState(false);

  // "hey echo, <sentence>" arrives here and is handed to the panel. The id
  // rises every time so the same sentence said twice runs twice.
  const [spokenToEcho, setSpokenToEcho] = useState<{ id: number; text: string }>();
  const echoIdRef = useRef(0);
  const handleEcho = useCallback((sentence: string) => {
    // Echo owns Android's recogniser while its panel is open. Pause an active
    // exercise first so rep counting does not continue invisibly underneath
    // the communication aid; the resting phase also enables the panel.
    if (session.phase === 'active') controller.pauseSession();
    echoIdRef.current += 1;
    setSpokenToEcho({ id: echoIdRef.current, text: sentence });
  }, [controller.pauseSession, session.phase]);

  // "hey duo, I want to say something" routes here through the intent.
  const { setEchoRequestHandler } = controller;
  useEffect(() => {
    setEchoRequestHandler(() => handleEcho(''));
  }, [setEchoRequestHandler, handleEcho]);

  /**
   * Confirm the demo bundle has its direct Claude key before the first request.
   */
  const [proxyHealth, setProxyHealth] = useState<ProxyHealth>({ state: 'checking' });
  useEffect(() => {
    let cancelled = false;
    void checkProxyHealth().then((health) => {
      if (!cancelled) setProxyHealth(health);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const voice = useSpeechCommands({
    onHeard: controller.handleHeardSpeech,
    onWake: controller.handleWake,
    onEcho: handleEcho,
    fallAlertActive: fallAlert.state.status === 'countdown',
    onFallAlertCancel: fallAlert.cancel,
    followUpToken: controller.conversationTurn,
    muted: speaking || secondVoiceOpen || fallAlertSpeaking,
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
        proxyHealth={proxyHealth}
        replySource={controller.replySource}
        isCameraStreaming={controller.isCameraStreaming}
        setCameraStreaming={controller.setCameraStreaming}
        cameraState={controller.cameraState}
      />

      <SecondVoicePanel
        enabled={session.phase !== 'active'}
        onOpenChange={setSecondVoiceOpen}
        spoken={spokenToEcho}
        phraseHints={['I need a break.', 'Please help me.', 'I would like some water.']}
      />

      <FallAlertOverlay
        state={fallAlert.state}
        onCancel={fallAlert.cancel}
        onDismiss={fallAlert.dismiss}
        onSpeakingChange={setFallAlertSpeaking}
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

import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSessionController } from './useSessionController';
import { useSpeakOnChange } from './voice/useSpeakOnChange';
import { IdleScreen } from './screens/IdleScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ActiveSessionScreen } from './screens/ActiveSessionScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { VisionCamera } from './vision/VisionCamera';
import { SecondVoicePanel } from './secondVoice';
import { DevOverlay } from './DevOverlay';

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
  const proxyEndpoint = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_SECOND_VOICE_PROXY_URL;

  useSpeakOnChange(session.lastSpoken);

  return (
    <View style={styles.container}>
      <VisionCamera
        enabled={controller.cameraNeeded}
        onPoseFrame={controller.handlePoseFrame}
        onSnapshot={controller.handleSnapshot}
      />

      {session.phase === 'idle' && <IdleScreen onTapToTalk={controller.startSetup} />}

      {session.phase === 'setup' && (
        <SetupScreen framed={controller.framed} onChooseExercise={controller.chooseExercise} />
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
        />
      )}

      {session.phase === 'ended' && <SummaryScreen session={session} onRestart={controller.restartSession} />}

      <DevOverlay
        session={session}
        framed={controller.framed}
        calibrating={controller.calibrating}
        ready={controller.ready}
        currentArm={controller.currentArm}
        eventLog={controller.eventLog}
        fatigueDebug={controller.fatigueDebug}
      />

      <SecondVoicePanel
        enabled={session.phase !== 'active'}
        endpoint={proxyEndpoint}
        phraseHints={['I need a break.', 'Please help me.', 'I would like some water.']}
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

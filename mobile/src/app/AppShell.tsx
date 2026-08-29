import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSessionController } from './useSessionController';
import { useSpeakOnChange } from './voice/useSpeakOnChange';
import { IdleScreen } from './screens/IdleScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ActiveSessionScreen } from './screens/ActiveSessionScreen';
import { SummaryScreen } from './screens/SummaryScreen';

/**
 * Person B's composition root. Mounted directly by App.tsx.
 *
 * Owns: screens, face, session state machine, TTS, touch controls. Does
 * not touch the camera — that is Person A's src/vision/ (see 03-architecture.md,
 * "the camera feed is never rendered on the phone screen").
 */
export function AppShell() {
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  const controller = useSessionController();
  const { session } = controller;

  useSpeakOnChange(session.lastSpoken);

  return (
    <View style={styles.container}>
      {session.phase === 'idle' && <IdleScreen onTapToTalk={controller.startSetup} />}

      {session.phase === 'setup' && (
        <SetupScreen framed={controller.framed} onChooseExercise={controller.chooseExercise} />
      )}

      {(session.phase === 'active' || session.phase === 'resting') && (
        <ActiveSessionScreen
          session={session}
          onPause={controller.pauseSession}
          onResume={controller.resumeSession}
          onEnd={controller.endSession}
        />
      )}

      {session.phase === 'ended' && <SummaryScreen session={session} onRestart={controller.restartSession} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

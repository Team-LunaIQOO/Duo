import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompensationEvent,
  ExerciseId,
  PoseFrame,
  RepEvent,
  SessionState,
} from '../types/contracts';
import * as machine from './state/sessionMachine';
import { useVisionStream } from './vision/useVisionStream';
import { COMPENSATION_LINES, FATIGUE_LINES, pickRepFeedback } from './feedback/feedbackTable';
import { generateTemplateSummary } from './summary/generateSummary';
import { parseVoiceCommand } from './voice/commandParser';
import { FatigueDetector } from '../fatigue';
import { StreamPublisher, WebSocketClientTransport } from '../streaming';
import { STREAM_URL } from './streamTarget';

/**
 * Single integration point for the pose/rep/compensation stream.
 *
 * Wired to the real pipeline: Person A's MediaPipe landmarks feed
 * useVisionStream (calibration + rep counting + compensation detection),
 * Person C's FatigueDetector consumes the resulting PoseFrames and RepEvents,
 * and Person C's StreamPublisher mirrors everything to the laptop viewer.
 *
 * The mocks it replaced (mock/mockStream.ts, mock/mockFatigue.ts) are kept in
 * the tree deliberately — they are the only way to exercise the app without
 * the loaner device, and demo/RUNBOOK.md leans on that for rehearsal.
 */
export function useSessionController() {
  const [session, setSession] = useState<SessionState>(machine.createInitialSessionState());
  const previousQualityRef = useRef<RepEvent['quality'] | null>(null);

  const isActive = session.phase === 'active';
  // The camera runs from setup onward so the user can be told whether they are
  // in shot before committing to a session, and so calibration can begin the
  // moment the exercise is chosen.
  const cameraNeeded = session.phase === 'setup' || session.phase === 'active' || session.phase === 'resting';

  // --- laptop stream ------------------------------------------------------
  // Created once and kept for the whole app lifetime. 03-architecture.md:
  // "If the laptop disconnects, the session continues unaffected." The
  // transport reconnects on its own and drops rather than queues, so nothing
  // here can stall the session loop.
  const publisher = useMemo(
    () => new StreamPublisher(new WebSocketClientTransport({ url: STREAM_URL })),
    []
  );

  useEffect(() => {
    publisher.start();
    return () => publisher.stop();
  }, [publisher]);

  // --- fatigue ------------------------------------------------------------
  // Rebuilt per session and per side: the detector compares the last reps
  // against the first reps of *this* session, so carrying it across sessions
  // would compare a fresh arm against a tired one.
  const fatigueRef = useRef<FatigueDetector | null>(null);
  useEffect(() => {
    fatigueRef.current = new FatigueDetector({
      workingSide: session.affectedSide ?? 'left',
      exercise: session.exercise === 'E3' ? 'E3' : 'E1',
    });
  }, [session.exercise, session.affectedSide, session.phase === 'idle']);

  const { handlePoseFrame, status } = useVisionStream(
    isActive,
    session.exercise,
    session.affectedSide,
    {
      onFrame: (frame: PoseFrame) => {
        fatigueRef.current?.onPoseFrame(frame);
        publisher.publishPoseFrame(frame);
      },

      onRep: (rep: RepEvent) => {
        const signal = fatigueRef.current?.onRepEvent(rep) ?? null;

        setSession((s) => {
          let next = machine.addRep(s, rep);

          const feedbackLine = pickRepFeedback(rep, previousQualityRef.current);
          if (feedbackLine) next = machine.speak(next, feedbackLine);
          previousQualityRef.current = rep.quality;

          // Only speak when the level actually changes. The detector already
          // emits on change only; repeating "you're slowing down" every rep is
          // exactly what 04-clinical-logic.md warns makes an assistant hostile.
          if (signal) {
            next = machine.applyFatigue(next, signal);
            if (signal.level !== 'none') {
              next = machine.speak(next, FATIGUE_LINES[signal.level]);
            }
          }

          return machine.settleFaceState(next);
        });
      },

      onCompensation: (event: CompensationEvent) => {
        setSession((s) => {
          let next = machine.applyCompensation(s, event);
          next = machine.speak(next, COMPENSATION_LINES[event.type]);
          return machine.settleFaceState(next);
        });
      },
    }
  );

  // Mirror session state to the laptop panel.
  //
  // Re-published on a timer rather than only when the state changes. A
  // state-change-only effect sends the opening values before the socket has
  // finished connecting, they are dropped, and nothing re-sends them until the
  // user happens to complete a rep — so a viewer that connects mid-session
  // shows an empty panel. The publisher deduplicates, so this costs one
  // comparison per second and sends nothing while the numbers are unchanged.
  const statsRef = useRef({
    reps: 0,
    quality: '—',
    compensations: [] as string[],
    fatigue: 'none' as string,
  });
  statsRef.current = {
    reps: session.reps.length,
    quality: session.reps[session.reps.length - 1]?.quality ?? '—',
    compensations: session.activeCompensations.map((c) => c.type),
    fatigue: session.fatigue,
  };

  useEffect(() => {
    const publish = () => publisher.publishStats(statsRef.current);
    publish();
    const timer = setInterval(publish, 1000);
    return () => clearInterval(timer);
  }, [publisher]);

  // 03-architecture.md failure behaviour: "Pose confidence drops -> Pause
  // counting, Duo says 'I can't see you clearly.' Do not count garbage reps."
  // The counting pause is enforced in the vision module; this is the voice half.
  const wasFramedRef = useRef(true);
  useEffect(() => {
    if (!isActive) {
      wasFramedRef.current = true;
      return;
    }
    if (wasFramedRef.current && !status.framed) {
      setSession((s) => machine.loseTracking(machine.speak(s, "I can't see you clearly.")));
    }
    wasFramedRef.current = status.framed;
  }, [isActive, status.framed]);

  // Prune compensations whose sustain window has passed, and re-settle the
  // face state, on a light tick — independent of the stream rate.
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setSession((s) => machine.settleFaceState(machine.pruneExpiredCompensations(s, Date.now())));
    }, 500);
    return () => clearInterval(timer);
  }, [isActive]);

  const startSetup = useCallback(() => {
    setSession((s) => ({ ...s, phase: 'setup', faceState: 'attentive' }));
  }, []);

  const chooseExercise = useCallback((exercise: ExerciseId, affectedSide: 'left' | 'right') => {
    setSession((s) => machine.beginActive(machine.startSetup(s, exercise, affectedSide)));
  }, []);

  const pauseSession = useCallback(() => setSession((s) => machine.pause(s)), []);
  const resumeSession = useCallback(() => setSession((s) => machine.resume(s)), []);
  const endSession = useCallback(() => {
    setSession((s) => {
      const ended = machine.endSession(s);
      const summary = generateTemplateSummary(ended);
      return machine.speak(ended, summary);
    });
  }, []);
  const restartSession = useCallback(() => {
    previousQualityRef.current = null;
    publisher.resetSession();
    setSession(machine.restart());
  }, [publisher]);

  // Every voice command routes through the same actions the touch buttons
  // use, so the two control methods can never behave differently (see
  // 02-product-spec.md "Control methods": touch must always work as the
  // fallback, voice is never the only route to a function).
  const handleHeardSpeech = useCallback(
    (heard: string) => {
      const command = parseVoiceCommand(heard);
      if (!command) return;

      switch (command) {
        case 'start':
          if (session.phase === 'idle') startSetup();
          else if (session.phase === 'resting') resumeSession();
          break;
        case 'pause':
          if (session.phase === 'active') pauseSession();
          break;
        case 'stop':
          if (session.phase === 'active' || session.phase === 'resting') endSession();
          break;
        case 'how_many':
          setSession((s) => machine.acknowledge(machine.speak(s, `${s.reps.length} reps so far.`)));
          break;
        case 'repeat':
          setSession((s) => (s.lastSpoken ? machine.acknowledge(s) : s));
          break;
        case 'next':
          // No multi-exercise queue yet — acknowledge so voice feedback
          // stays honest rather than silently doing nothing.
          setSession((s) => machine.acknowledge(s));
          break;
      }
    },
    [session.phase, startSetup, resumeSession, pauseSession, endSession]
  );

  return {
    session,
    framed: status.framed,
    calibrating: status.calibrating,
    cameraNeeded,
    handlePoseFrame,
    startSetup,
    chooseExercise,
    pauseSession,
    resumeSession,
    endSession,
    restartSession,
    handleHeardSpeech,
  };
}

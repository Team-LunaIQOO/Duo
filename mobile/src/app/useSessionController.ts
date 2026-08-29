import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompensationEvent, ExerciseId, RepEvent, SessionState } from '../types/contracts';
import * as machine from './state/sessionMachine';
import { useMockStream } from './mock/mockStream';
import { computeMockFatigue } from './mock/mockFatigue';
import { COMPENSATION_LINES, FATIGUE_LINES, pickRepFeedback } from './feedback/feedbackTable';
import { generateTemplateSummary } from './summary/generateSummary';
import { parseVoiceCommand } from './voice/commandParser';

/**
 * Single integration point for the pose/rep/compensation stream.
 *
 * Currently wired to useMockStream. Once Person A's real PoseFrame stream
 * is ready, replace that one hook call below with the real one — the
 * callback shapes (onFrame/onRep/onCompensation) match the frozen
 * contracts exactly, so nothing else in this file or in the screens needs
 * to change.
 */
export function useSessionController() {
  const [session, setSession] = useState<SessionState>(machine.createInitialSessionState());
  const previousQualityRef = useRef<RepEvent['quality'] | null>(null);

  // Stand-in for Person A's real inFrame/confidence signal during setup.
  // Always true against the mock; a real stream should derive this from
  // PoseFrame.inFrame + PoseFrame.confidence.
  const [framed] = useState(true);

  const isActive = session.phase === 'active';

  useMockStream(isActive, {
    onFrame: () => {
      // Person A's real stream will also report inFrame/confidence here;
      // the mock always reports in-frame so this is a no-op for now.
    },
    onRep: (rep: RepEvent) => {
      setSession((s) => {
        let next = machine.addRep(s, rep);

        const feedbackLine = pickRepFeedback(rep, previousQualityRef.current);
        if (feedbackLine) next = machine.speak(next, feedbackLine);
        previousQualityRef.current = rep.quality;

        const fatigue = computeMockFatigue(next.reps);
        next = machine.applyFatigue(next, fatigue);
        if (fatigue.level !== 'none') {
          next = machine.speak(next, FATIGUE_LINES[fatigue.level]);
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
  });

  // Prune compensations whose sustain window has passed, and re-settle the
  // face state, on a light tick — independent of the mock/real stream rate.
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
    setSession(machine.restart());
  }, []);

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
    framed,
    startSetup,
    chooseExercise,
    pauseSession,
    resumeSession,
    endSession,
    restartSession,
    handleHeardSpeech,
  };
}

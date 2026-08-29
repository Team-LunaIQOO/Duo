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
import {
  COMPENSATION_LINES,
  CONTROL_LINES,
  FATIGUE_LINES,
  pickRepFeedback,
} from './feedback/feedbackTable';
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

  /**
   * Which arm is being exercised right now, and therefore how its reps are
   * labelled. Starts on the affected side, which is the one that matters.
   *
   * `session.affectedSide` is anatomy ('left' | 'right'); this is the clinical
   * role. Both are needed, because the affected-versus-unaffected comparison
   * in 04-clinical-logic.md is impossible if every rep carries the same label.
   */
  const [currentArm, setCurrentArm] = useState<RepEvent['side']>('affected');

  /**
   * Recent events, newest first, for the dev overlay only.
   *
   * Exists because compensation and fatigue are the two features that cannot
   * be confirmed by looking at the phone: a correction that never fires and a
   * correction that fires correctly look identical from the outside. Bounded,
   * and never rendered in the patient-facing UI — 02-product-spec.md is
   * explicit that debug output belongs behind a dev toggle.
   */
  const [eventLog, setEventLog] = useState<string[]>([]);
  const logEvent = useCallback((line: string) => {
    setEventLog((prev) => [line, ...prev].slice(0, 8));
  }, []);
  const workingSide: 'left' | 'right' | null =
    session.affectedSide === null
      ? null
      : currentArm === 'affected'
        ? session.affectedSide
        : session.affectedSide === 'left'
          ? 'right'
          : 'left';

  // The camera runs from idle onward, not from setup.
  //
  // 06-demo-and-pitch.md beat 1 is the demonstrator pointing at the laptop
  // while the phone sits idle: "Notice what's not on the screen: the camera.
  // The camera feed goes here." If the camera only started at setup, that
  // laptop would be blank for the single most important beat in the pitch.
  // The view is invisible either way, so there is nothing to lose by starting
  // it early — and VisionCamera never unmounts once started.
  const cameraNeeded = session.phase !== 'ended';

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
      // Only the affected arm's reps feed fatigue. Pooling both would compare
      // a fresh arm against a tired one and read as recovery, and the affected
      // side is the one whose tiring actually matters clinically.
      sideFilter: 'affected',
    });
  }, [session.exercise, session.affectedSide, session.phase === 'idle']);

  const { handlePoseFrame, status } = useVisionStream(
    isActive,
    session.exercise,
    workingSide,
    currentArm,
    {
      onFrame: (frame: PoseFrame) => {
        fatigueRef.current?.onPoseFrame(frame);
        publisher.publishPoseFrame(frame);
      },

      onRep: (rep: RepEvent) => {
        const signal = fatigueRef.current?.onRepEvent(rep) ?? null;

        logEvent(
          `rep ${rep.repNumber} ${rep.side.slice(0, 3)} ` +
            `${rep.peakAngle.toFixed(0)}deg ${Math.round(rep.durationMs)}ms ${rep.quality}`
        );
        if (signal) logEvent(`FATIGUE ${signal.level} (${signal.reason})`);

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
        logEvent(`COMP ${event.type} ${event.severity} ${Math.round(event.sustainedMs)}ms`);
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
  //
  // Two things this must not do, both of which it did on the device:
  //
  // 1. Fire before any pose has been seen. `framed` starts false, so becoming
  //    active immediately announced "I can't see you clearly" before a single
  //    camera frame had been processed — hence `seenAnyPose`.
  // 2. Leave the line on screen after tracking recovers. The caption renders
  //    SessionState.lastSpoken and is sticky until something replaces it, so
  //    the complaint sat there for the rest of the session while the laptop
  //    happily showed a live skeleton. Recovery now speaks its own line.
  const wasFramedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!isActive || !status.seenAnyPose) {
      wasFramedRef.current = null;
      return;
    }

    const previous = wasFramedRef.current;
    wasFramedRef.current = status.framed;
    if (previous === null || previous === status.framed) return;

    if (!status.framed) {
      setSession((s) => machine.loseTracking(machine.speak(s, "I can't see you clearly.")));
    } else {
      setSession((s) => machine.settleFaceState(machine.speak(s, 'There you are.')));
    }
  }, [isActive, status.framed, status.seenAnyPose]);

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
    // Duo asks the question out loud as well as on screen. 02-product-spec.md
    // step 2: "Duo asks what they are working on today, out loud and in
    // on-screen text" — the text was on SetupScreen but nothing ever spoke it.
    setSession((s) =>
      machine.acknowledge({ ...s, phase: 'setup', lastSpoken: CONTROL_LINES.wake })
    );
  }, []);

  const chooseExercise = useCallback((exercise: ExerciseId, affectedSide: 'left' | 'right') => {
    setCurrentArm('affected');
    setSession((s) => machine.beginActive(machine.startSetup(s, exercise, affectedSide)));
  }, []);

  /**
   * Switch to the other arm mid-session, so the summary can compare the two.
   *
   * Without this the affected-versus-unaffected line in 04-clinical-logic.md
   * and beat 6 of the demo can never appear: every rep would carry the same
   * label, and the symmetry calculation needs both populated.
   *
   * Changing the side re-runs calibration and resets the rep counter, which is
   * correct — the person will have shifted in the chair, and the rep state
   * machine could be holding a half-finished rep on the other arm.
   */
  const switchArm = useCallback(() => {
    setCurrentArm((arm) => (arm === 'affected' ? 'unaffected' : 'affected'));
    setSession((s) =>
      machine.acknowledge(machine.speak(s, 'Now the other arm. Sit still for a moment.'))
    );
  }, []);

  // Touch is the control method that must never fail (02-product-spec.md), so
  // it is what makes the acknowledging blink reachable. Previously that face
  // state could only be triggered from voice commands, which are not wired up,
  // so the fifth state never appeared at all.
  const pauseSession = useCallback(
    () => setSession((s) => machine.acknowledge(machine.speak(machine.pause(s), CONTROL_LINES.paused))),
    []
  );
  const resumeSession = useCallback(
    () => setSession((s) => machine.acknowledge(machine.speak(machine.resume(s), CONTROL_LINES.resumed))),
    []
  );
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
    setCurrentArm('affected');
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
    ready: status.ready,
    currentArm,
    cameraNeeded,
    handlePoseFrame,
    startSetup,
    chooseExercise,
    switchArm,
    pauseSession,
    resumeSession,
    endSession,
    restartSession,
    handleHeardSpeech,
    eventLog,
    fatigueDebug: () => fatigueRef.current?.debug ?? null,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompensationEvent,
  CompensationLogEntry,
  ExerciseId,
  PoseFrame,
  RepEvent,
  RepSummary,
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
import { GesturePauseDetector, type GestureDebug } from '../gesture';
import { StreamPublisher, WebSocketClientTransport } from '../streaming';
import { STREAM_URL } from './streamTarget';
import { captureSnapshot, type SnapshotEvent } from '../vision/mediapipeAdapter';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';

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

  // Full-session history for the laptop viewer only (per-side tally,
  // compensation log, quality timeline). SessionState itself only tracks
  // *active* compensations by design — this does not change that contract,
  // it is purely local bookkeeping for what gets published to the stream.
  const compensationHistoryRef = useRef<CompensationLogEntry[]>([]);
  const sessionStartedAtRef = useRef<number | null>(null);

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
  const transport = useMemo(() => new WebSocketClientTransport({ url: STREAM_URL }), []);
  const publisher = useMemo(() => new StreamPublisher(transport), [transport]);

  useEffect(() => {
    publisher.start();
    return () => publisher.stop();
  }, [publisher]);

  // A note from the laptop is delivered as an ordinary spoken/captioned line,
  // the same path every other feedback string takes — never treated as a
  // command. Held until idle rather than interrupting whatever the user is
  // doing (04-clinical-logic.md's "one instruction at a time" applies here
  // too, and a note is lower priority than a live correction).
  const pendingNoteRef = useRef<string | null>(null);
  useEffect(() => {
    transport.onNote = (text) => {
      pendingNoteRef.current = text;
    };
    return () => {
      transport.onNote = undefined;
    };
  }, [transport]);

  useEffect(() => {
    if (session.phase !== 'idle' || !pendingNoteRef.current) return;
    const note = pendingNoteRef.current;
    pendingNoteRef.current = null;
    setSession((s) => machine.speak(s, note));
  }, [session.phase]);

  // --- snapshot ------------------------------------------------------------
  //
  // The one place in this whole system where a photograph of the person is
  // captured and stored anywhere. Triggered only by an explicit request from
  // the laptop viewer (never automatically, never on a timer); the photo
  // itself never leaves the phone -- it goes to the device's own photo
  // library via expo-media-library, and only a yes/no result is sent back
  // over the socket. See contracts.ts, SnapshotRequestMessage/
  // SnapshotResultMessage.
  useEffect(() => {
    transport.onSnapshotRequest = () => {
      captureSnapshot();
    };
    return () => {
      transport.onSnapshotRequest = undefined;
    };
  }, [transport]);

  const handleSnapshot = useCallback(
    (event: SnapshotEvent) => {
      void (async () => {
        try {
          const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();
          if (status !== 'granted') {
            publisher.publishSnapshotResult({
              ok: false,
              reason: canAskAgain ? 'permission_denied' : 'permission_blocked',
            });
            return;
          }

          const path = `${FileSystem.cacheDirectory}duo-snapshot-${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(path, event.jpegBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await MediaLibrary.createAssetAsync(path);

          publisher.publishSnapshotResult({ ok: true });
        } catch {
          publisher.publishSnapshotResult({ ok: false, reason: 'save_failed' });
        }
      })();
    },
    [publisher]
  );

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

  // --- gesture pause ------------------------------------------------------
  // Created once and kept for the app's lifetime. It holds all of its state
  // internally, so the frame handler that drives it stays free of closures —
  // the constraint the ThinkSys bridge imposes (see useVisionStream).
  //
  // 02-product-spec.md, "Control methods": a raised hand, either hand, means
  // pause. Additive only — it calls the same pauseSession() the Pause button
  // calls, so gesture and touch cannot drift apart, and "do not make any
  // single control method the only route to any function" holds trivially.
  const gestureRef = useRef<GesturePauseDetector | null>(null);
  if (gestureRef.current === null) gestureRef.current = new GesturePauseDetector();

  const { handlePoseFrame, status } = useVisionStream(
    isActive,
    session.exercise,
    workingSide,
    currentArm,
    {
      onFrame: (frame: PoseFrame) => {
        fatigueRef.current?.onPoseFrame(frame);
        publisher.publishPoseFrame(frame);

        // Every frame is fed to the detector, including outside an active
        // session, so its release and cooldown state stays honest — but only
        // an active session can be paused by one. A gesture during setup or
        // after the summary is a no-op rather than a surprise.
        const gesture = gestureRef.current?.update(frame) ?? null;
        if (gesture) {
          logEvent(
            `GESTURE ${gesture.side} hand ${Math.round(gesture.heldMs)}ms` +
              (session.phase === 'active' ? ' -> pause' : ` (ignored in ${session.phase})`)
          );
          if (session.phase === 'active') pauseSession();
        }
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
        compensationHistoryRef.current.push({
          timestamp: event.timestamp,
          type: event.type,
          severity: event.severity,
        });
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
    repHistory: [] as RepSummary[],
    compensationHistory: [] as CompensationLogEntry[],
    sessionElapsedMs: undefined as number | undefined,
  });
  statsRef.current = {
    reps: session.reps.length,
    quality: session.reps[session.reps.length - 1]?.quality ?? '—',
    compensations: session.activeCompensations.map((c) => c.type),
    fatigue: session.fatigue,
    repHistory: session.reps.map((r) => ({ repNumber: r.repNumber, side: r.side, quality: r.quality })),
    compensationHistory: compensationHistoryRef.current,
    sessionElapsedMs: sessionStartedAtRef.current === null ? undefined : Date.now() - sessionStartedAtRef.current,
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
    sessionStartedAtRef.current = Date.now();
    compensationHistoryRef.current = [];
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
    sessionStartedAtRef.current = null;
    compensationHistoryRef.current = [];
    publisher.resetSession();
    gestureRef.current?.reset();
    setCurrentArm('affected');
    setSession(machine.restart());
  }, [publisher]);

  /**
   * A bare "hey duo", with no command attached.
   *
   * 02-product-spec.md, step 2 of the session: "The user says the wake phrase,
   * or taps the screen. The eyes react (widen, look toward the user). Duo asks
   * what they are working on today." So from idle the wake phrase does exactly
   * what tapping the screen does — it is the same doorway, and startSetup is
   * the same function the tap calls.
   *
   * Anywhere else it is an acknowledgement: the eyes give their one quick wide
   * blink, and the armed window in useSpeechCommands waits for the
   * instruction. Nothing else changes, because the user has not asked for
   * anything yet.
   */
  const handleWake = useCallback(() => {
    logEvent('VOICE wake');
    if (session.phase === 'idle') {
      startSetup();
      return;
    }
    setSession((s) => machine.acknowledge(s));
  }, [session.phase, startSetup, logEvent]);

  // Every voice command routes through the same actions the touch buttons
  // use, so the two control methods can never behave differently (see
  // 02-product-spec.md "Control methods": touch must always work as the
  // fallback, voice is never the only route to a function).
  const handleHeardSpeech = useCallback(
    (heard: string) => {
      const command = parseVoiceCommand(heard);
      if (!command) {
        // Something was said and not understood. Blank means the microphone
        // opened and heard nothing at all, which needs no reply.
        if (heard.trim()) {
          logEvent(`VOICE "${heard}" not understood`);
          setSession((s) => machine.speak(s, CONTROL_LINES.notUnderstood));
        }
        return;
      }

      logEvent(`VOICE "${heard}" -> ${command}`);

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
    [session.phase, startSetup, resumeSession, pauseSession, endSession, logEvent]
  );

  return {
    session,
    framed: status.framed,
    calibrating: status.calibrating,
    ready: status.ready,
    currentArm,
    cameraNeeded,
    handlePoseFrame,
    handleSnapshot,
    startSetup,
    chooseExercise,
    switchArm,
    pauseSession,
    resumeSession,
    endSession,
    restartSession,
    handleHeardSpeech,
    handleWake,
    eventLog,
    fatigueDebug: () => fatigueRef.current?.debug ?? null,
    gestureDebug: (): GestureDebug | null => gestureRef.current?.debug ?? null,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../../types/contracts';
import { FallDetector, type FallEvent } from '../../fall';

const COUNTDOWN_SECONDS = 12;

export type FallAlertState =
  | { status: 'idle' }
  | { status: 'countdown'; secondsRemaining: number; event: FallEvent }
  | { status: 'sending'; event: FallEvent }
  | { status: 'sent'; event: FallEvent }
  | { status: 'failed'; event: FallEvent; message: string };

export function useFallAlert(endpoint: string | undefined, enabled: boolean) {
  const detector = useRef(new FallDetector());
  const deadline = useRef<number | null>(null);
  const stateRef = useRef<FallAlertState>({ status: 'idle' });
  const [state, setStateValue] = useState<FallAlertState>({ status: 'idle' });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const setState = useCallback((next: FallAlertState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const sendAlert = useCallback(async (event: FallEvent) => {
    if (!endpoint) {
      setState({ status: 'failed', event, message: 'Telegram alerts are not configured on this device.' });
      return;
    }
    setState({ status: 'sending', event });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detectedAt: new Date().toISOString(),
          reason: event.reason,
        }),
      });
      if (!response.ok) throw new Error(`Alert server returned ${response.status}`);
      setState({ status: 'sent', event });
    } catch (error) {
      setState({
        status: 'failed',
        event,
        message: error instanceof Error ? error.message : 'Could not reach the alert server.',
      });
    }
  }, [endpoint, setState]);

  const handlePoseFrame = useCallback((frame: PoseFrame) => {
    if (stateRef.current.status !== 'idle') return;
    const event = detector.current.update(frame, enabledRef.current);
    if (!event) return;
    deadline.current = Date.now() + COUNTDOWN_SECONDS * 1000;
    setState({ status: 'countdown', secondsRemaining: COUNTDOWN_SECONDS, event });
  }, [setState]);

  /**
   * Forces the exact same countdown → alert path a real detection takes,
   * without needing an actual fall or the session to be on E3. For demo use
   * behind a hidden trigger: fall detection is only armed during a specific
   * exercise (see AppShell), which makes a real fall inconvenient to stage on
   * request. This does not touch the detector's own state, so it never
   * counts toward FALL_THRESHOLDS.cooldownMs and cannot mask a real miss.
   */
  const simulateFall = useCallback(() => {
    if (stateRef.current.status !== 'idle') return;
    const event: FallEvent = {
      timestamp: Date.now(),
      confidence: 'possible',
      reason: 'rapid_drop_low_posture',
    };
    deadline.current = Date.now() + COUNTDOWN_SECONDS * 1000;
    setState({ status: 'countdown', secondsRemaining: COUNTDOWN_SECONDS, event });
  }, [setState]);

  useEffect(() => {
    detector.current.setEnabled(enabled);
    if (enabled) return;

    // Leaving the active curl session immediately disarms both detection and
    // any countdown it started. Pausing, switching exercise, or ending the
    // session must not leave an alert covering an unrelated screen.
    deadline.current = null;
    if (stateRef.current.status !== 'idle') setState({ status: 'idle' });
  }, [enabled, setState]);

  useEffect(() => {
    if (state.status !== 'countdown') return;
    const timer = setInterval(() => {
      if (stateRef.current.status !== 'countdown' || deadline.current === null) return;
      const secondsRemaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      if (secondsRemaining === 0) {
        deadline.current = null;
        void sendAlert(stateRef.current.event);
      } else if (secondsRemaining !== stateRef.current.secondsRemaining) {
        setState({ ...stateRef.current, secondsRemaining });
      }
    }, 250);
    return () => clearInterval(timer);
  }, [sendAlert, setState, state.status]);

  const cancel = useCallback(() => {
    if (stateRef.current.status !== 'countdown') return;
    deadline.current = null;
    setState({ status: 'idle' });
  }, [setState]);

  const dismiss = useCallback(() => {
    deadline.current = null;
    setState({ status: 'idle' });
  }, [setState]);

  return { state, handlePoseFrame, cancel, dismiss, simulateFall };
}

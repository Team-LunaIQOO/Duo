/**
 * Timer-based fake PoseFrame/RepEvent/CompensationEvent generator.
 *
 * Stands in for Person A's real vision pipeline so the app shell, face,
 * and session state machine can be built and demoed without waiting on
 * MediaPipe integration. Swapping this for the real stream should only
 * require changing the hook that supplies these callbacks — see
 * src/app/useSessionController.ts.
 */
import { useEffect, useRef } from 'react';
import type { CompensationEvent, PoseFrame, RepEvent } from '../../types/contracts';

type CompensationType = CompensationEvent['type'];

const REP_INTERVAL_MS = 2200;
const COMPENSATION_EVERY_N_REPS = 4;
const FRAME_INTERVAL_MS = 100;

const COMPENSATION_TYPES: CompensationType[] = ['forward_lean', 'trunk_rotation', 'shoulder_elevation'];

export type MockStreamCallbacks = {
  onFrame: (frame: PoseFrame) => void;
  onRep: (rep: RepEvent) => void;
  onCompensation: (event: CompensationEvent) => void;
};

export function useMockStream(active: boolean, callbacks: MockStreamCallbacks) {
  const repCountRef = useRef(0);
  const sessionStartRef = useRef(0);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!active) {
      repCountRef.current = 0;
      return;
    }

    sessionStartRef.current = Date.now();

    const frameTimer = setInterval(() => {
      const timestamp = Date.now() - sessionStartRef.current;
      callbacksRef.current.onFrame({
        timestamp,
        landmarks: [],
        confidence: 0.9,
        inFrame: true,
      });
    }, FRAME_INTERVAL_MS);

    const repTimer = setInterval(() => {
      repCountRef.current += 1;
      const repNumber = repCountRef.current;
      const timestamp = Date.now() - sessionStartRef.current;
      const isCompensated = repNumber % COMPENSATION_EVERY_N_REPS === 0;

      const rep: RepEvent = {
        timestamp,
        repNumber,
        side: repNumber % 3 === 0 ? 'affected' : 'unaffected',
        peakAngle: isCompensated ? 55 + Math.random() * 10 : 80 + Math.random() * 15,
        durationMs: 900 + Math.random() * 400,
        quality: isCompensated ? 'compensated' : Math.random() > 0.3 ? 'good' : 'partial',
      };
      callbacksRef.current.onRep(rep);

      if (isCompensated) {
        const type = COMPENSATION_TYPES[repNumber % COMPENSATION_TYPES.length];
        callbacksRef.current.onCompensation({
          timestamp,
          type,
          severity: 'mild',
          sustainedMs: 450,
        });
      }
    }, REP_INTERVAL_MS);

    return () => {
      clearInterval(frameTimer);
      clearInterval(repTimer);
    };
  }, [active]);
}


import type {
  CompensationEvent,
  ExerciseId,
  FatigueSignal,
  RepEvent,
  SessionState,
} from '../../types/contracts';

const COMPENSATION_ACTIVE_WINDOW_MS = 1400;

export function createInitialSessionState(): SessionState {
  return {
    phase: 'idle',
    exercise: null,
    affectedSide: null,
    reps: [],
    activeCompensations: [],
    fatigue: 'none',
    faceState: 'neutral',
    lastSpoken: null,
  };
}

export function startSetup(state: SessionState, exercise: ExerciseId, affectedSide: 'left' | 'right'): SessionState {
  return {
    ...state,
    phase: 'setup',
    exercise,
    affectedSide,
    faceState: 'attentive',
  };
}

export function beginActive(state: SessionState): SessionState {
  return { ...state, phase: 'active', faceState: 'attentive' };
}

export function addRep(state: SessionState, rep: RepEvent): SessionState {
  return { ...state, reps: [...state.reps, rep] };
}

export function applyCompensation(state: SessionState, event: CompensationEvent): SessionState {
  return {
    ...state,
    activeCompensations: [...state.activeCompensations, event],
    faceState: 'concerned',
  };
}

export function pruneExpiredCompensations(state: SessionState, now: number): SessionState {
  const active = state.activeCompensations.filter(
    (c) => now - c.timestamp < c.sustainedMs + COMPENSATION_ACTIVE_WINDOW_MS
  );
  if (active.length === state.activeCompensations.length) return state;
  return { ...state, activeCompensations: active };
}

export function applyFatigue(state: SessionState, signal: FatigueSignal): SessionState {
  return { ...state, fatigue: signal.level };
}

export function speak(state: SessionState, line: string): SessionState {
  return { ...state, lastSpoken: line };
}

export function acknowledge(state: SessionState): SessionState {
  return { ...state, faceState: 'acknowledging' };
}

/**
 * Recomputes faceState from current signals. Call after any signal update.
 *
 * Now answers for every phase, not just 'active'. It used to return the state
 * untouched outside a session, which was invisible while the idle, setup and
 * summary screens hardcoded their own face state — but 'acknowledging' has a
 * blink interval of "never" (it is a one-shot), so a wake or a command outside
 * an active session left the eyes frozen open permanently. Nothing had ever
 * rendered that, and wiring the real state into those screens is exactly what
 * would have made it visible.
 */
export function settleFaceState(state: SessionState): SessionState {
  if (state.phase === 'idle' || state.phase === 'ended') {
    return { ...state, faceState: 'neutral' };
  }
  if (state.phase === 'setup') {
    return { ...state, faceState: 'attentive' };
  }
  // Active or resting.
  if (state.activeCompensations.length > 0) return { ...state, faceState: 'concerned' };
  if (state.fatigue !== 'none') return { ...state, faceState: 'tired' };
  return { ...state, faceState: 'attentive' };
}

export function pause(state: SessionState): SessionState {
  return { ...state, phase: 'resting' };
}

export function resume(state: SessionState): SessionState {
  return { ...state, phase: 'active' };
}

export function endSession(state: SessionState): SessionState {
  return { ...state, phase: 'ended', faceState: 'neutral' };
}

export function loseTracking(state: SessionState): SessionState {
  return { ...state, faceState: 'concerned' };
}

export function restart(): SessionState {
  return createInitialSessionState();
}

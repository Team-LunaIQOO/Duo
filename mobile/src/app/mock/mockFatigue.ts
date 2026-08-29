/**
 * Stand-in for Person C's fatigue detector. Fires a 'slowing' signal after
 * a fixed number of reps, purely so the app shell has something driving
 * SessionState.fatigue during development. Replace with the real
 * src/fatigue/ output once available.
 */
import type { FatigueSignal, RepEvent } from '../../types/contracts';

const SLOWING_AFTER_REPS = 6;
const FATIGUED_AFTER_REPS = 10;

export function computeMockFatigue(reps: RepEvent[]): FatigueSignal {
  const timestamp = Date.now();

  if (reps.length >= FATIGUED_AFTER_REPS) {
    return { timestamp, level: 'fatigued', reason: 'rom_decay' };
  }
  if (reps.length >= SLOWING_AFTER_REPS) {
    return { timestamp, level: 'slowing', reason: 'timing_drift' };
  }
  return { timestamp, level: 'none', reason: 'rom_decay' };
}

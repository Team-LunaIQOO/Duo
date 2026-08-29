import type { CompensationEvent, FatigueSignal, RepEvent } from '../../types/contracts';

type CompensationType = CompensationEvent['type'];
type RepQuality = RepEvent['quality'];

// Every line: short, one instruction, plain words, never scold.
// See 02-product-spec.md "The voice and personality".

export const COMPENSATION_LINES: Record<CompensationType, string> = {
  forward_lean: 'Try to keep your back against the chair.',
  trunk_rotation: 'Keep your shoulders facing forward.',
  shoulder_elevation: 'Relax your shoulder down.',
};

export const FATIGUE_LINES: Record<Exclude<FatigueSignal['level'], 'none'>, string> = {
  slowing: "You're slowing down. Want to rest?",
  fatigued: "Let's stop here for today. You did well.",
};

export const CONTROL_LINES = {
  wake: 'What are we working on today?',
  framingCheck: 'Move back a little so I can see you.',
  framingConfirmed: 'I can see you now.',
  cannotSeeUser: "I can't see you clearly.",
  paused: 'Paused. Tap or say start when ready.',
  resumed: 'Good, starting again.',
};

/** Picks the one thing Duo should say right now. Never stacks two corrections. */
export function pickRepFeedback(rep: RepEvent, previousQuality: RepQuality | null): string | null {
  if (rep.quality === 'good' && previousQuality === 'compensated') {
    return 'That one was better.';
  }
  return null;
}

export function repeatedCompensationLine(goodRepCount: number): string {
  return `Let's stop here for today. You did ${goodRepCount} good ${goodRepCount === 1 ? 'one' : 'ones'}.`;
}

export function sessionSummaryLine(totalReps: number, affectedSymmetryPercent: number | null): string {
  const base = `${totalReps} rep${totalReps === 1 ? '' : 's'} today.`;
  if (affectedSymmetryPercent === null) return base;
  return `${base} Your affected arm reached about ${Math.round(affectedSymmetryPercent)} percent as far as your other arm today.`;
}

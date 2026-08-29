/**
 * Voice navigation: choosing and switching exercises by speaking.
 *
 * "hey duo, let us do some left bicep curls" starts elbow flexion on the left
 * arm. "let us do another exercise" switches to the other one. The buttons stay
 * exactly where they were — 02-product-spec.md requires touch to reach every
 * function and to never be the only route to any of them, and that cuts both
 * ways: voice must not be the only route either.
 *
 * ## Why this is keyword matching and not the language model
 *
 * Duo's *replies* go through Claude. Navigation does not, deliberately:
 *
 * - It has to work when the proxy is unreachable. Choosing an exercise is not
 *   flavour text; if it fails, the session cannot start at all.
 * - It has to be instant. A round trip between "left bicep curls" and the
 *   screen changing reads as the app ignoring you.
 * - It must not be creative. A model that occasionally hears "left" as "right"
 *   would start the session on the wrong arm, and the affected-versus-
 *   unaffected comparison in 04-clinical-logic.md is the whole measurement.
 *
 * The vocabulary is small and closed, which is exactly the case keyword
 * matching handles well and a model handles no better.
 */

import type { ExerciseId } from '../../types/contracts';

export type ExerciseRequest = {
  exercise: ExerciseId;
  /**
   * The arm named out loud, or null if they did not say. Null means "ask" —
   * it is never guessed, because guessing the side silently corrupts the
   * affected-versus-unaffected comparison rather than failing visibly.
   */
  side: 'left' | 'right' | null;
};

/**
 * Spoken names for each exercise, including the ones people actually use
 * rather than the clinical ones. E1 is shoulder abduction; nobody says that.
 */
const EXERCISE_WORDS: [ExerciseId, string[]][] = [
  // Elbow flexion first: "bicep curl" contains "curl", and checking the more
  // specific vocabulary first keeps a phrase like "arm curl" off E1.
  ['E3', ['bicep', 'biceps', 'curl', 'curls', 'elbow', 'elbow flexion', 'elbow bend']],
  ['E1', [
    'shoulder', 'shoulder raise', 'shoulder raises', 'abduction', 'arm raise',
    'arm raises', 'raise my arm', 'lift my arm', 'side raise', 'lateral raise',
  ]],
];

const SIDE_WORDS: [('left' | 'right'), string[]][] = [
  ['left', ['left']],
  ['right', ['right']],
];

/** Phrases that mean "not this one, the other one". */
const SWITCH_PHRASES = [
  'another exercise',
  'a different exercise',
  'different exercise',
  'other exercise',
  'switch exercise',
  'change exercise',
  'switch the exercise',
  'change the exercise',
  'something else',
  'next exercise',
];

/** Phrases that mean the other arm, same exercise. */
const OTHER_ARM_PHRASES = [
  'other arm',
  'the other arm',
  'switch arms',
  'switch arm',
  'change arms',
  'change arm',
  'other side',
  'the other side',
];

function normalise(heard: string): string {
  return heard.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * "let us do some left bicep curls" -> { exercise: 'E3', side: 'left' }.
 * Returns null when no exercise was named.
 */
export function parseExerciseRequest(heard: string): ExerciseRequest | null {
  const text = normalise(heard);
  if (!text) return null;

  let exercise: ExerciseId | null = null;
  for (const [id, words] of EXERCISE_WORDS) {
    if (words.some((word) => text.includes(word))) {
      exercise = id;
      break;
    }
  }
  if (!exercise) return null;

  let side: 'left' | 'right' | null = null;
  for (const [value, words] of SIDE_WORDS) {
    if (words.some((word) => new RegExp(`\\b${word}\\b`).test(text))) {
      side = value;
      break;
    }
  }

  return { exercise, side };
}

/** True for "let us do another exercise" and friends. */
export function isSwitchExerciseRequest(heard: string): boolean {
  const text = normalise(heard);
  return SWITCH_PHRASES.some((phrase) => text.includes(phrase));
}

/** True for "let us do the other arm" and friends. */
export function isOtherArmRequest(heard: string): boolean {
  const text = normalise(heard);
  return OTHER_ARM_PHRASES.some((phrase) => text.includes(phrase));
}

/** The exercise that is not this one. Two exercises, so this is a flip. */
export function otherExercise(current: ExerciseId | null): ExerciseId {
  return current === 'E3' ? 'E1' : 'E3';
}

/** Spoken name, for confirming out loud what is about to start. */
export function exerciseName(exercise: ExerciseId): string {
  return exercise === 'E3' ? 'elbow curls' : 'shoulder raises';
}

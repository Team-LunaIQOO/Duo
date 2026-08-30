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
 *
 * Order matters: this is a first-match list, so a narrower vocabulary must
 * come before a broader one it could be confused with. E4 (elbow extension)
 * has to precede E3 (elbow flexion) — both mention "elbow" — or "elbow
 * extension" would always match E3 first. Same reasoning put E6 (wrist
 * flexion) before nothing else here shares its words, but it stays close to
 * E3/E4 since all three are forearm-adjacent vocabulary a person could run
 * together.
 */
const EXERCISE_WORDS: [ExerciseId, string[]][] = [
  // Elbow extension before elbow flexion: "straighten"/"extend"/"push" name
  // the opposite half of the same joint motion E3 tracks.
  ['E4', [
    'elbow extension', 'extend my elbow', 'extend the elbow', 'straighten my arm',
    'straighten my elbow', 'straighten the elbow', 'push my arm', 'push exercise',
    'elbow straighten', 'elbow push',
  ]],
  // Elbow flexion next: "bicep curl" contains "curl", and checking the more
  // specific vocabulary first keeps a phrase like "arm curl" off E1.
  ['E3', ['bicep', 'biceps', 'curl', 'curls', 'elbow', 'elbow flexion', 'elbow bend']],
  ['E6', [
    'wrist', 'wrist flexion', 'wrist bend', 'wrist curl', 'bend my wrist',
    'flex my wrist', 'wrist exercise',
  ]],
  ['E5', [
    'horizontal adduction', 'across my body', 'across the body', 'sweep my arm',
    'arm across', 'reach across', 'cross body reach',
  ]],
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

/**
 * Accessibility-first voice entry to the communication aid.
 *
 * Kept deliberately exact: a person who stutters can say the single word
 * "Echo", while ordinary sentences that merely contain the word do not open
 * a modal panel unexpectedly.
 */
export function isOpenEchoRequest(heard: string): boolean {
  const text = normalise(heard);
  return /^(?:please )?(?:(?:open|launch|start) )?echo(?: please)?$/.test(text);
}

/** Hands-free cancellation phrases accepted only while a fall countdown runs. */
export function isFallAlertCancelRequest(heard: string): boolean {
  let text = normalise(heard).replace(/\bi m\b/g, 'i am');
  const tokens = text.split(' ').filter((token, index, all) => token !== all[index - 1]);
  text = tokens.join(' ').replace(/^(?:i am\s+)+(?=(?:okay|ok)$)/, 'i am ');
  return /^(?:okay|ok|i am (?:okay|ok)|im (?:okay|ok)|cancel (?:the )?alert|do not send (?:the )?alert)$/.test(text);
}

/**
 * Fixed cycle order for "let's do another exercise". E1 first, since that was
 * the two-exercise default before E4-E6 existed and is still the natural
 * starting point voice navigation lands on from nothing.
 */
const EXERCISE_CYCLE: ExerciseId[] = ['E1', 'E3', 'E4', 'E5', 'E6'];

/** The next exercise in the fixed cycle. Wraps from the last back to the first. */
export function otherExercise(current: ExerciseId | null): ExerciseId {
  if (current === null) return EXERCISE_CYCLE[0];
  const index = EXERCISE_CYCLE.indexOf(current);
  if (index === -1) return EXERCISE_CYCLE[0];
  return EXERCISE_CYCLE[(index + 1) % EXERCISE_CYCLE.length];
}

const EXERCISE_NAMES: Record<string, string> = {
  E1: 'shoulder raises',
  E3: 'elbow curls',
  E4: 'elbow extensions',
  E5: 'across-the-body reaches',
  E6: 'wrist bends',
};

/** Spoken name, for confirming out loud what is about to start. */
export function exerciseName(exercise: ExerciseId): string {
  return EXERCISE_NAMES[exercise] ?? 'shoulder raises';
}

/**
 * Wake phrase matching: "hey duo", and "hey duo start" in one breath.
 *
 * ## Why there is no wake-word engine here
 *
 * 03-architecture.md's licensing warning is about Porcupine specifically: its
 * free tier will not ship a custom "Hey Duo" model on ARM Android. That
 * warning is still true, and this does not go near it. Instead the speech
 * recogniser that already runs for voice commands is left listening
 * continuously, and the wake phrase is matched in the transcript it produces.
 * No second model, no new dependency, no licence.
 *
 * The cost is that a general recogniser hears "duo" imperfectly, so the
 * matching has to be tolerant — and tolerance is exactly what turns a wake
 * phrase into a nuisance if it is done carelessly. Hence this file existing at
 * all rather than a one-line `includes('hey duo')`.
 *
 * ## What is accepted
 *
 * A greeting token, then a token that is within one edit of "duo". That covers
 * the mis-hearings a recogniser actually produces — dua, doo, dio, deo, due —
 * without accepting arbitrary words.
 *
 * "do" is one edit from "duo" and is also one of the most common words in
 * English, so it gets an extra condition: it only counts as the wake token if
 * nothing follows it, or if what follows is a command. That keeps "hey duo"
 * and "hey duo stop" working while rejecting "hey, do you want a break" —
 * which is a sentence a carer might well say in the room.
 *
 * ## What follows the phrase
 *
 * Anything after the wake tokens is returned as `remainder`, so "hey duo
 * start" arrives as one utterance and runs immediately. An empty remainder is
 * a bare wake, which the caller treats as "the user wants my attention".
 */

import { parseVoiceCommand } from './commandParser';

/** Words a recogniser plausibly returns for the greeting half. */
const GREETINGS = new Set(['hey', 'hay', 'hi', 'high', 'ay', 'eh', 'ok', 'okay', 'hello']);

/**
 * Tokens that are one edit from "duo" but common enough on their own that
 * accepting them unconditionally would wake the app during ordinary speech.
 */
const AMBIGUOUS_WAKE_TOKENS = new Set(['do', 'due', 'dude', 'don']);

/**
 * Which assistant was addressed.
 *
 * "hey duo" drives the session. "hey echo" hands the rest of the sentence to
 * Echo, the communication aid, which speaks it back on the user's behalf. Same
 * grammar, different destination — one wake grammar rather than two.
 */
export type WakeTarget = 'duo' | 'echo';

export type WakeMatch = {
  /** True if a wake phrase was found. */
  matched: boolean;
  /** Which assistant was named. */
  target: WakeTarget;
  /** Whatever was said after the wake phrase, trimmed. Empty for a bare wake. */
  remainder: string;
};

const NO_MATCH: WakeMatch = { matched: false, target: 'duo', remainder: '' };

/**
 * The names, and how far a recogniser may stray from each.
 *
 * "echo" is the easier of the two: it is a real English word, so the language
 * model returns it intact far more often than it does a made-up name like
 * "duo". It also has fewer near neighbours worth worrying about.
 */
const NAMES: { target: WakeTarget; word: string }[] = [
  { target: 'duo', word: 'duo' },
  { target: 'echo', word: 'echo' },
];

/** Levenshtein distance, capped — only ever asked about short tokens. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function normalise(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Looks for the wake phrase anywhere in the utterance, not only at the start.
 *
 * Recognisers routinely prepend a false start — "um", "so", a stray fragment
 * from the previous sentence — and anchoring at position zero would throw away
 * a perfectly clear wake because of it.
 */
export function matchWakePhrase(transcript: string): WakeMatch {
  const tokens = normalise(transcript);
  if (tokens.length === 0) return NO_MATCH;

  for (let i = 0; i < tokens.length - 1; i++) {
    if (!GREETINGS.has(tokens[i])) continue;

    const candidate = tokens[i + 1];
    const name = NAMES.find(({ word }) => editDistance(candidate, word) <= 1);
    if (!name) continue;

    const remainder = tokens.slice(i + 2).join(' ');

    // A token that is both one edit from a name and an everyday word only
    // counts when it cannot be part of ordinary speech: nothing after it, or
    // something after it that is unambiguously a command.
    //
    // Echo is exempt: everything after "hey echo" is a sentence to speak, not
    // a command, so requiring one would reject every real use of it.
    if (name.target === 'duo' && AMBIGUOUS_WAKE_TOKENS.has(candidate)) {
      if (remainder && parseVoiceCommand(remainder) === null) continue;
    }

    return { matched: true, target: name.target, remainder };
  }

  return NO_MATCH;
}

/**
 * What should happen to a matched wake phrase.
 *
 * Extracted from the speech hook so the decision can be asserted. It was
 * previously inline and gated on whether the KEYWORD parser recognised the
 * remainder, which quietly dropped every sentence the keyword list did not
 * know — including the natural phrasings the language model exists to handle.
 * That was invisible: the wake fired, the eyes blinked, and nothing happened.
 */
export type WakeRoute =
  | { kind: 'echo'; sentence: string }
  | { kind: 'instruction'; sentence: string }
  | { kind: 'bare' }
  | { kind: 'ignore' };

export function routeWakeMatch(match: WakeMatch): WakeRoute {
  if (!match.matched) return { kind: 'ignore' };
  if (match.target === 'echo') return { kind: 'echo', sentence: match.remainder };
  // Any remainder is an instruction. Whether it MEANS anything is decided
  // downstream, never here.
  if (match.remainder) return { kind: 'instruction', sentence: match.remainder };
  return { kind: 'bare' };
}

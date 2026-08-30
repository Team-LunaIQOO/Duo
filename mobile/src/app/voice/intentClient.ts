/**
 * Turning what the user said into what Duo does, using the model.
 *
 * Duo is driven by speech. This is the layer that decides what a sentence
 * means: the transcript and session state go directly to Claude in this
 * demo-only bundled-key build.
 * returns one action from a closed list plus the line to say while doing it.
 *
 * It exists because keyword matching only ever understood the phrasings
 * somebody thought to list. "I'm tired, let's stop", "can we do the curls with
 * my weaker arm", "that's enough for today" are all ordinary things to say and
 * none of them are keywords. The model handles them; the keyword parser stays
 * as the failsafe underneath.
 *
 * ## What this deliberately cannot do
 *
 * The action list is closed and the response is validated on the proxy on the
 * way back, so an unrecognised action becomes 'none' and 'none' does nothing.
 * The failure mode of a confused model is silence, never an action the user
 * did not ask for. And it is told never to guess which arm: an unheard side
 * comes back null and Duo asks, because guessing silently inverts the
 * affected-versus-unaffected comparison (04-clinical-logic.md).
 *
 * ## When it fails
 *
 * Returns null — proxy down, phone offline, model slow, malformed JSON, all
 * the same from here. The caller then falls back to the local keyword parser
 * and the written lines, which is exactly how the app behaved before any of
 * this existed. The session is never blocked on a network round trip.
 */

import type { ExerciseId } from '../../types/contracts';
import { parseModelJson, requestAnthropicText } from './anthropicClient';

const INTENT_SYSTEM = [
  "You are Duo, a warm, concise companion in a stroke-rehab phone app.",
  'Return JSON only. No markdown, commentary, or code fence.',
  'Shape: {"action":"...","exercise":"E1"|"E3"|null,"side":"left"|"right"|null,"reply":"..."}',
  'action: start_exercise, switch_exercise, switch_arm, pause, resume, stop, restart, how_many, progress, repeat, open_echo, chat, or none.',
  'Use the supplied session phase: idle/setup can start; active can pause, stop, or switch; resting can resume; ended can restart. Choose none when no valid action applies.',
  'E1 is shoulder/arm raises; E3 is bicep/elbow curls. Set side only when explicitly named or clearly called affected/weaker in context; never guess.',
  'Use chat for greetings, feelings, hobbies, everyday conversation, or simple safe seated activity ideas. Ask at most one gentle follow-up question.',
  'reply is one friendly spoken line, usually under 18 words.',
  'Never diagnose, prescribe, claim live knowledge, or claim app abilities it lacks. For none, say you did not understand.',
].join('\n');

/**
 * How long to wait before giving up and parsing locally.
 *
 * Direct mobile requests are slower and more variable than the old laptop
 * proxy path. The photographed failure was reproduced by a response arriving
 * after 2.5 seconds: the valid Claude result was aborted, then the local parser
 * quite correctly could not treat a friendly sentence as an app command.
 * Six seconds leaves room for a cold phone connection while all deterministic
 * safety and session controls still retain their local fallback.
 */
export const INTENT_TIMEOUT_MS = 6000;

export type VoiceAction =
  | 'start_exercise'
  | 'switch_exercise'
  | 'switch_arm'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'restart'
  | 'how_many'
  | 'progress'
  | 'repeat'
  | 'open_echo'
  | 'chat'
  | 'none';

export type VoiceIntent = {
  action: VoiceAction;
  exercise: ExerciseId | null;
  side: 'left' | 'right' | null;
  /** The line Duo speaks while acting. May be empty. */
  reply: string;
};

const ACTIONS = new Set<VoiceAction>([
  'start_exercise',
  'switch_exercise',
  'switch_arm',
  'pause',
  'resume',
  'stop',
  'restart',
  'how_many',
  'progress',
  'repeat',
  'open_echo',
  'chat',
  'none',
]);

let reachable = true;
let lastFailureAt = 0;
const BACKOFF_MS = 20_000;

/**
 * Returns the recognised intent, or null if the model could not be reached in
 * time. Never throws.
 */
export async function requestIntent(
  transcript: string,
  context: Record<string, unknown>
): Promise<VoiceIntent | null> {
  if (!transcript.trim()) return null;

  // A dead proxy is asked once, then left alone for a while. Without this,
  // every utterance would spend the full timeout waiting for a machine that is
  // not there, and the user would feel every one of those seconds.
  if (!reachable && Date.now() - lastFailureAt < BACKOFF_MS) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTENT_TIMEOUT_MS);

  try {
    const text = await requestAnthropicText({
      system: INTENT_SYSTEM,
      user: `They said: ${transcript}\nSession state: ${JSON.stringify(context)}`,
      maxTokens: 150,
      temperature: 0,
      signal: controller.signal,
    });
    const data = parseModelJson(text) as Partial<VoiceIntent>;
    const action = ACTIONS.has(data.action as VoiceAction) ? (data.action as VoiceAction) : 'none';

    reachable = true;
    return {
      action,
      // Validated here as well as on the proxy. This file has no way to know
      // what answered the request, so it does not assume.
      exercise: data.exercise === 'E1' || data.exercise === 'E3' ? data.exercise : null,
      side: data.side === 'left' || data.side === 'right' ? data.side : null,
      reply: typeof data.reply === 'string' ? data.reply.trim() : '',
    };
  } catch {
    reachable = false;
    lastFailureAt = Date.now();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** For the dev overlay: whether the model is currently answering. */
export function intentStatus(): { reachable: boolean } {
  return { reachable };
}

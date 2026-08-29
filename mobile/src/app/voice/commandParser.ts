/**
 * Parses a recognised speech string into one of Duo's voice commands.
 * See 02-product-spec.md "Control methods": start, pause, stop, next,
 * repeat that, how many. Deliberately just keyword matching — there is
 * no time budget for real NLU, and the commands are simple enough not to
 * need it.
 *
 * Kept independent of any specific speech-to-text engine so the actual
 * STT package (Tier 3, see 05-build-plan.md feature tiering — touch is
 * the fallback that must never fail) can be swapped or dropped without
 * touching this file.
 */
export type VoiceCommand = 'start' | 'pause' | 'stop' | 'next' | 'repeat' | 'how_many';

const COMMAND_KEYWORDS: [VoiceCommand, string[]][] = [
  ['how_many', ['how many', 'how much', 'rep count', 'count']],
  ['repeat', ['repeat that', 'say again', 'repeat']],
  ['stop', ['stop', 'end session', 'end', 'finish']],
  ['pause', ['pause', 'wait', 'hold on']],
  ['next', ['next', 'skip']],
  ['start', ['start', 'begin', "let's go", 'go']],
];

export function parseVoiceCommand(heard: string): VoiceCommand | null {
  const normalised = heard.trim().toLowerCase();
  if (!normalised) return null;

  for (const [command, keywords] of COMMAND_KEYWORDS) {
    if (keywords.some((keyword) => normalised.includes(keyword))) {
      return command;
    }
  }
  return null;
}

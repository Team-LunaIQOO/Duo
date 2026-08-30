/**
 * Android recognisers can emit a useful interim hypothesis and then send an
 * empty final result. Keep the latest hypothesis so the command pipeline does
 * not lose an utterance at the final-result boundary.
 */
export function resolveSpeechTranscripts(
  current: string[],
  isFinal: boolean,
  pending: string[]
): { transcripts: string[]; pending: string[] } {
  const nonEmpty = current.map((text) => text.trim()).filter(Boolean);
  if (nonEmpty.length > 0) {
    return { transcripts: nonEmpty, pending: isFinal ? [] : nonEmpty };
  }

  if (isFinal && pending.length > 0) {
    return { transcripts: pending, pending: [] };
  }

  return { transcripts: [], pending };
}

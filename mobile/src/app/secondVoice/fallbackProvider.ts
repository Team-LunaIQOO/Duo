import type { ReconstructionProvider, ReconstructionRequest, ReconstructionResult } from './types';

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Offline, deterministic provider used when the network/model is unavailable. */
export class PhrasebookFallbackProvider implements ReconstructionProvider {
  async reconstruct(request: ReconstructionRequest): Promise<ReconstructionResult> {
    const started = Date.now();
    const transcript = clean(request.transcript);
    const hints = request.phraseHints.map(clean).filter(Boolean);
    const candidates = Array.from(new Set([
      ...hints.filter((hint) => hint.toLowerCase().includes(transcript.toLowerCase()) || transcript.toLowerCase().includes(hint.toLowerCase())),
      transcript,
    ])).slice(0, 3).map((text, index) => ({
      id: `fallback-${index + 1}`,
      text,
      rank: (index + 1) as 1 | 2 | 3,
      source: index === 0 && hints.includes(text) ? 'phrasebook' as const : 'verbatim' as const,
    }));
    return {
      requestId: request.requestId,
      candidates,
      provider: candidates.some((candidate) => candidate.source === 'phrasebook') ? 'phrasebook' : 'verbatim',
      elapsedMs: Date.now() - started,
      degradedReason: 'openrouter_unavailable',
    };
  }
}

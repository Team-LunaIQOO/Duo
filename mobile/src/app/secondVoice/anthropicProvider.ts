import { parseModelJson, requestAnthropicText } from '../voice/anthropicClient';
import type { ReconstructionProvider, ReconstructionRequest, ReconstructionResult } from './types';

const SYSTEM = [
  'You reconstruct what a person with aphasia or a stutter meant to say.',
  'They read your suggestions and approve one before it is spoken aloud for them.',
  'Return JSON only: {"candidates":[{"text":"..."}]} with 1 to 3 short first-person sentences.',
  'Never invent needs, people, facts or actions that are not in the transcript.',
  'Never explain, never describe their intent, never add commentary.',
].join('\n');

export class AnthropicReconstructionProvider implements ReconstructionProvider {
  constructor(private readonly fallback?: ReconstructionProvider, private readonly timeoutMs = 4_000) {}

  async reconstruct(request: ReconstructionRequest): Promise<ReconstructionResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const text = await requestAnthropicText({
        system: SYSTEM,
        user: `Transcript: ${request.transcript.trim()}\nApproved phrase hints: ${JSON.stringify(request.phraseHints.slice(0, 8))}`,
        maxTokens: 200,
        temperature: 0.2,
        signal: controller.signal,
      });
      let parsed: { candidates?: Array<{ text?: unknown }> };
      try {
        parsed = parseModelJson(text) as { candidates?: Array<{ text?: unknown }> };
      } catch {
        parsed = { candidates: [{ text }] };
      }
      const candidates = (parsed.candidates ?? []).slice(0, 3).flatMap((candidate, index) => {
        const candidateText = typeof candidate.text === 'string' ? candidate.text.trim() : '';
        return candidateText ? [{ id: `anthropic-${index + 1}`, text: candidateText, rank: (index + 1) as 1 | 2 | 3, source: 'anthropic' as const }] : [];
      });
      if (!candidates.length) throw new Error('anthropic_empty_candidates');
      return { requestId: request.requestId, candidates, provider: 'anthropic', elapsedMs: Date.now() - started };
    } catch (error) {
      if (!this.fallback) throw error;
      const result = await this.fallback.reconstruct(request);
      return { ...result, elapsedMs: Date.now() - started, degradedReason: String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

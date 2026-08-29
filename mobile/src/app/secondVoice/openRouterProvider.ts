import type { ReconstructionProvider, ReconstructionRequest, ReconstructionResult } from './types';

export type ProxyReconstructionProviderOptions = {
  /** URL of the trusted proxy; never put a model API key in the app. */
  endpoint: string;
  timeoutMs?: number;
  fallback?: ReconstructionProvider;
};

export class ProxyReconstructionProvider implements ReconstructionProvider {
  private readonly timeoutMs: number;

  constructor(private readonly options: ProxyReconstructionProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 4_000;
  }

  async reconstruct(request: ReconstructionRequest): Promise<ReconstructionResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`proxy_http_${response.status}`);
      const body = (await response.json()) as { candidates?: Array<{ text?: unknown }> };
      const candidates = Array.isArray(body.candidates)
        ? body.candidates.slice(0, 3).flatMap((candidate, index) => {
            const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
            return text ? [{ id: `anthropic-${index + 1}`, text, rank: (index + 1) as 1 | 2 | 3, source: 'anthropic' as const }] : [];
          })
        : [];
      if (!candidates.length) throw new Error('proxy_empty_candidates');
      return {
        requestId: request.requestId,
        candidates,
        provider: 'anthropic',
        elapsedMs: Date.now() - started,
      };
    } catch (error) {
      if (!this.options.fallback) throw error;
      const fallback = await this.options.fallback.reconstruct(request);
      return { ...fallback, elapsedMs: Date.now() - started, degradedReason: String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

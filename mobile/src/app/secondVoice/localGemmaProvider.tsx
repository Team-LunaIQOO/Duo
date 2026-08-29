import { useMemo } from 'react';
import { useLLM } from 'expo-llm-mediapipe';
import type {
  Candidate,
  ReconstructionProvider,
  ReconstructionRequest,
  ReconstructionResult,
} from './types';

// This is the smallest documented artifact supported by the bridge. It is a
// device spike, not Gemma 3n. Google gates this artifact behind its Gemma
// license; the app must not embed a Hugging Face token.
export const LOCAL_MODEL_NAME = 'gemma-1.1-2b-it-cpu-int4.bin';
export const LOCAL_MODEL_URL =
  'https://huggingface.co/google/gemma-1.1-2b-it-tflite/resolve/main/gemma-1.1-2b-it-cpu-int4.bin';

function candidatesFromResponse(raw: string): Candidate[] {
  try {
    const parsed = JSON.parse(raw) as { candidates?: Array<{ text?: string }> };
    if (Array.isArray(parsed.candidates)) {
      const candidates = parsed.candidates
        .filter((item) => typeof item.text === 'string' && item.text.trim())
        .slice(0, 3)
        .map((item, index) => ({
          id: `local-${index + 1}`,
          text: item.text!.trim(),
          rank: (index + 1) as 1 | 2 | 3,
          source: 'local' as const,
        }));
      if (candidates.length) return candidates;
    }
  } catch {
    // Fall through to a safe single candidate when the small model emits text.
  }

  const text = raw.replace(/^```(?:json)?|```$/g, '').trim();
  return text
    ? [{ id: 'local-1', text, rank: 1, source: 'local' }]
    : [];
}

function promptFor(request: ReconstructionRequest): string {
  return [
    'Rewrite the transcript into up to three concise candidate sentences.',
    'Return JSON only in this shape: {"candidates":[{"text":"..."}]}',
    'Do not invent facts. Preserve the speaker intent and language.',
    `Transcript: ${request.transcript}`,
    `Phrase hints: ${request.phraseHints.join(' | ') || '(none)'}`,
    `Context: ${JSON.stringify(request.context)}`,
  ].join('\n');
}

export function useLocalGemma() {
  const llm = useLLM({
    modelName: LOCAL_MODEL_NAME,
    modelUrl: LOCAL_MODEL_URL,
    maxTokens: 96,
    temperature: 0.2,
    topK: 20,
    randomSeed: 42,
  });

  const provider = useMemo<ReconstructionProvider>(() => ({
    async reconstruct(request): Promise<ReconstructionResult> {
      if (!llm.isLoaded) throw new Error('Local model is not loaded');
      const started = Date.now();
      const raw = await llm.generateResponse(promptFor(request));
      return {
        requestId: request.requestId,
        candidates: candidatesFromResponse(raw),
        provider: 'local',
        elapsedMs: Date.now() - started,
      };
    },
  }), [llm.generateResponse, llm.isLoaded]);

  return {
    provider,
    isLoaded: llm.isLoaded,
    downloadModel: llm.downloadModel,
    loadModel: llm.loadModel,
    downloadStatus: llm.downloadStatus,
    downloadProgress: llm.downloadProgress,
    downloadError: llm.downloadError,
    isCheckingStatus: llm.isCheckingStatus,
  };
}

import { useMemo } from 'react';
import { useLLM } from 'expo-llm-mediapipe';
import type {
  Candidate,
  ReconstructionProvider,
  ReconstructionRequest,
  ReconstructionResult,
} from './types';
import { cleanStutteredSpeech } from './speechCleanup';

// Gemma 3 1B INT4 is substantially smaller than the previous Gemma 1.1 2B
// artifact while remaining a MediaPipe LLM Inference task bundle. The public
// mirror avoids embedding a Hugging Face token in the app; its model card says
// the artifact is byte-for-byte identical to the gated LiteRT Community file.
export const LOCAL_MODEL_NAME = 'gemma3-1b-it-int4.task';
export const LOCAL_MODEL_URL =
  'https://huggingface.co/nikhil2024/gemma3-1b-it-litert-mirror/resolve/main/gemma3-1b-it-int4.task';

function spokenCandidate(text: string): Candidate {
  return { id: 'local-1', text, rank: 1, source: 'local' };
}

function candidatesFromResponse(raw: string, transcript: string): Candidate[] {
  const isMetaAnalysis = (text: string) =>
    /\b(?:candidate'?s intent|user'?s intent|the transcript|the speaker|provide context)\b/i.test(text);
  try {
    const parsed = JSON.parse(raw) as { candidates?: Array<{ text?: string }> };
    if (Array.isArray(parsed.candidates)) {
      const candidates = parsed.candidates
        .filter((item) => typeof item.text === 'string' && item.text.trim() && !isMetaAnalysis(item.text))
        .slice(0, 3)
        .map((item, index) => ({
          id: `local-${index + 1}`,
          text: cleanStutteredSpeech(item.text!),
          rank: (index + 1) as 1 | 2 | 3,
          source: 'local' as const,
        }));
      if (candidates.length) return candidates;
    }
  } catch {
    // Fall through to a safe single candidate when the small model emits text.
  }

  const text = raw
    .replace(/<end_of_turn>[\s\S]*$/g, '')
    .replace(/^```(?:json)?|```$/g, '')
    .replace(/^(?:output|answer|response):\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  // Never offer model commentary as words for the user to speak. A literal
  // transcript is safer than invented intent when the small model drifts.
  return [spokenCandidate(cleanStutteredSpeech(text && !isMetaAnalysis(text) ? text : transcript))];
}

function promptFor(request: ReconstructionRequest): string {
  return [
    '<start_of_turn>user',
    'You are a communication aid for a person who stutters. Rewrite rough speech as one short, natural sentence.',
    'Remove repeated words and repeated phrases caused by stuttering.',
    'Return only the sentence to speak. Never explain or describe the intent.',
    'Do not add needs, facts, people, or actions that were not in the input.',
    'Input: water please need',
    'Sentence: I need some water, please.',
    'Input: can you hear me',
    'Sentence: Can you hear me?',
    `Input: ${cleanStutteredSpeech(request.transcript)}`,
    'Sentence:',
    '<end_of_turn>',
    '<start_of_turn>model',
  ].join('\n');
}

export function useLocalGemma() {
  const llm = useLLM({
    modelName: LOCAL_MODEL_NAME,
    modelUrl: LOCAL_MODEL_URL,
    // MediaPipe interprets maxTokens as the combined prompt + response context.
    // The few-shot prompt is currently ~104 tokens, so 64 causes a native abort
    // before inference instead of a recoverable JavaScript error.
    maxTokens: 256,
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
        candidates: candidatesFromResponse(raw, request.transcript),
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

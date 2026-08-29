export type CandidateSource = 'phrasebook' | 'openrouter' | 'verbatim';

export type SecondVoiceContext = {
  exercise?: string | null;
  phase?: string | null;
  recentFeedback?: string[];
};

export type ReconstructionRequest = {
  requestId: string;
  transcript: string;
  locale: string;
  phraseHints: string[];
  context: SecondVoiceContext;
};

export type Candidate = {
  id: string;
  text: string;
  rank: 1 | 2 | 3;
  source: CandidateSource;
};

export type ReconstructionResult = {
  requestId: string;
  candidates: Candidate[];
  provider: CandidateSource;
  elapsedMs: number;
  degradedReason?: string;
};

export interface ReconstructionProvider {
  reconstruct(request: ReconstructionRequest): Promise<ReconstructionResult>;
}

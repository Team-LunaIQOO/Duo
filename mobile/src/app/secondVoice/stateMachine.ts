import type { Candidate } from './types';

export type SecondVoiceState =
  | { phase: 'idle' }
  | { phase: 'listening'; transcript: string }
  | { phase: 'processing'; transcript: string }
  | { phase: 'candidates'; transcript: string; candidates: Candidate[]; selectedId: string | null }
  | { phase: 'editing'; transcript: string; candidates: Candidate[]; selectedId: string; draft: string }
  | { phase: 'speaking'; text: string }
  | { phase: 'error'; message: string };

export type SecondVoiceAction =
  | { type: 'ACTIVATE' }
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'SUBMIT_TRANSCRIPT' }
  | { type: 'RESULT'; transcript: string; candidates: Candidate[] }
  | { type: 'SELECT'; id: string }
  | { type: 'EDIT'; draft: string }
  | { type: 'CONFIRM_SPEAK' }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; message: string };

export const initialSecondVoiceState: SecondVoiceState = { phase: 'idle' };

export function secondVoiceReducer(state: SecondVoiceState, action: SecondVoiceAction): SecondVoiceState {
  switch (action.type) {
    case 'ACTIVATE': return { phase: 'listening', transcript: '' };
    case 'TRANSCRIPT': return state.phase === 'listening' ? { ...state, transcript: action.text } : state;
    case 'SUBMIT_TRANSCRIPT': return state.phase === 'listening' && state.transcript.trim() ? { phase: 'processing', transcript: state.transcript.trim() } : state;
    case 'RESULT': return { phase: 'candidates', transcript: action.transcript, candidates: action.candidates, selectedId: null };
    case 'SELECT': return state.phase === 'candidates' && state.candidates.some((candidate) => candidate.id === action.id) ? { ...state, selectedId: action.id } : state;
    case 'EDIT': return state.phase === 'candidates' && state.selectedId
      ? { phase: 'editing', transcript: state.transcript, candidates: state.candidates, selectedId: state.selectedId, draft: action.draft }
      : state;
    case 'CONFIRM_SPEAK': {
      if (state.phase === 'candidates' && state.selectedId) {
        const selected = state.candidates.find((candidate) => candidate.id === state.selectedId);
        return selected ? { phase: 'speaking', text: selected.text } : state;
      }
      if (state.phase === 'editing' && state.draft.trim()) return { phase: 'speaking', text: state.draft.trim() };
      return state;
    }
    case 'CANCEL': return initialSecondVoiceState;
    case 'ERROR': return { phase: 'error', message: action.message };
    default: return state;
  }
}

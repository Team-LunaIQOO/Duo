import type { Candidate } from './types';

export type SecondVoiceState =
  | { phase: 'idle' }
  | { phase: 'listening'; transcript: string }
  | { phase: 'processing'; transcript: string }
  | { phase: 'speaking'; text: string }
  | { phase: 'error'; message: string };

export type SecondVoiceAction =
  | { type: 'ACTIVATE' }
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'SUBMIT_TRANSCRIPT' }
  | { type: 'RESULT'; transcript: string; candidates: Candidate[] }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; message: string };

export const initialSecondVoiceState: SecondVoiceState = { phase: 'idle' };

export function secondVoiceReducer(state: SecondVoiceState, action: SecondVoiceAction): SecondVoiceState {
  switch (action.type) {
    case 'ACTIVATE': return { phase: 'listening', transcript: '' };
    case 'TRANSCRIPT': return state.phase === 'listening' ? { ...state, transcript: action.text } : state;
    case 'SUBMIT_TRANSCRIPT': return state.phase === 'listening' && state.transcript.trim() ? { phase: 'processing', transcript: state.transcript.trim() } : state;
    case 'RESULT': {
      const response = action.candidates[0]?.text.trim();
      return response
        ? { phase: 'speaking', text: response }
        : { phase: 'error', message: 'No response was generated. Please try again.' };
    }
    case 'CANCEL': return initialSecondVoiceState;
    case 'ERROR': return { phase: 'error', message: action.message };
    default: return state;
  }
}

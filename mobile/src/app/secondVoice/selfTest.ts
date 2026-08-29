import { initialSecondVoiceState, secondVoiceReducer } from './stateMachine';

/** Small dependency-free invariant check for CI/manual smoke runs. */
export function runSecondVoiceSelfTest(): void {
  let state = secondVoiceReducer(initialSecondVoiceState, { type: 'ACTIVATE' });
  state = secondVoiceReducer(state, { type: 'TRANSCRIPT', text: 'I need water' });
  state = secondVoiceReducer(state, { type: 'SUBMIT_TRANSCRIPT' });
  state = secondVoiceReducer(state, {
    type: 'RESULT',
    transcript: 'I need water',
    candidates: [{ id: '1', text: 'I need some water.', rank: 1, source: 'verbatim' }],
  });
  state = secondVoiceReducer(state, { type: 'SELECT', id: '1' });
  if (state.phase !== 'candidates') throw new Error('candidate selection changed phase unexpectedly');
  if (secondVoiceReducer(state, { type: 'CANCEL' }).phase !== 'idle') throw new Error('cancel did not reset');
  if (secondVoiceReducer(state, { type: 'CONFIRM_SPEAK' }).phase !== 'speaking') throw new Error('explicit confirmation did not authorize speech');
}

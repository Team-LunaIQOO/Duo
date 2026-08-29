import { initialSecondVoiceState, secondVoiceReducer } from './stateMachine';
import { cleanStutteredSpeech } from './speechCleanup';

/** Small dependency-free invariant check for CI/manual smoke runs. */
export function runSecondVoiceSelfTest(): void {
  const cleaned = cleanStutteredSpeech('hey can you just just give give me a coffee coffee');
  if (cleaned !== 'Hey, can you just give me a coffee?') {
    throw new Error(`stutter cleanup failed: ${cleaned}`);
  }
  if (cleanStutteredSpeech('I need I need some water') !== 'I need some water.') {
    throw new Error('repeated phrase cleanup failed');
  }

  let state = secondVoiceReducer(initialSecondVoiceState, { type: 'ACTIVATE' });
  state = secondVoiceReducer(state, { type: 'TRANSCRIPT', text: 'I need water' });
  state = secondVoiceReducer(state, { type: 'SUBMIT_TRANSCRIPT' });
  state = secondVoiceReducer(state, {
    type: 'RESULT',
    transcript: 'I need water',
    candidates: [{ id: '1', text: 'I need some water.', rank: 1, source: 'verbatim' }],
  });
  if (state.phase !== 'speaking' || state.text !== 'I need some water.') {
    throw new Error('top response was not selected for automatic speech');
  }
  if (secondVoiceReducer(state, { type: 'CANCEL' }).phase !== 'idle') throw new Error('cancel did not reset');
}

import { EventEmitter, requireNativeModule } from 'expo-modules-core';

type SpeechEvents = {
  onSpeechPartial: (event: { text: string }) => void;
  onSpeechResult: (event: { text: string }) => void;
  onSpeechError: (event: { code: number; message: string }) => void;
  onSpeechState: (event: { state: string }) => void;
};

type DuoSpeechNative = {
  startListening(locale?: string): Promise<void>;
  stopListening(): Promise<void>;
  cancelListening(): Promise<void>;
};

export const DuoSpeech = requireNativeModule<DuoSpeechNative>('DuoSpeech');
export const DuoSpeechEvents = new EventEmitter<SpeechEvents>(DuoSpeech as never);

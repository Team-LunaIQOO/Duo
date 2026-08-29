/** Normalizes a speech-recognition transcript before reconstruction or speech. */
export function cleanStutteredSpeech(text: string): string {
  const tokens = text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const comparable = (token: string) => token.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const samePhrase = (left: number, right: number, length: number) => {
    for (let offset = 0; offset < length; offset += 1) {
      if (comparable(tokens[left + offset]) !== comparable(tokens[right + offset])) return false;
    }
    return true;
  };

  const cleaned: string[] = [];
  for (let index = 0; index < tokens.length;) {
    let repeatedLength = 0;
    const maxPhraseLength = Math.min(4, Math.floor((tokens.length - index) / 2));
    for (let length = maxPhraseLength; length >= 1; length -= 1) {
      if (samePhrase(index, index + length, length)) {
        repeatedLength = length;
        break;
      }
    }

    if (!repeatedLength) {
      cleaned.push(tokens[index]);
      index += 1;
      continue;
    }

    cleaned.push(...tokens.slice(index, index + repeatedLength));
    const phraseStart = index;
    index += repeatedLength;
    while (index + repeatedLength <= tokens.length && samePhrase(phraseStart, index, repeatedLength)) {
      index += repeatedLength;
    }
  }

  let sentence = cleaned.join(' ').replace(/\s+([,.;!?])/g, '$1').trim();
  sentence = sentence.replace(/^([\p{L}])/u, (letter) => letter.toLocaleUpperCase());
  sentence = sentence.replace(/^(Hey|Hello)\s+(?=(?:can|could|would|will|do|does|did|are|is|am|was|were|have|has|should|may)\b)/i, '$1, ');
  if (sentence && !/[.!?]$/.test(sentence)) {
    const isQuestion = /^(?:hey[,.]?\s+)?(?:can|could|would|will|do|does|did|are|is|am|was|were|have|has|should|may)\b/i.test(sentence);
    sentence += isQuestion ? '?' : '.';
  }
  return sentence;
}

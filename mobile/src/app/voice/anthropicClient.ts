/**
 * Demo-only direct Anthropic client.
 *
 * Expo inlines EXPO_PUBLIC_* values into the application bundle. This keeps
 * the hackathon build self-contained, but the key is recoverable from the
 * APK and must be revoked after the event. Do not use this transport in a
 * production build.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';

const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
const model = process.env.EXPO_PUBLIC_ANTHROPIC_MODEL ?? DEFAULT_MODEL;

export const anthropicConfigured = Boolean(apiKey);
export const anthropicModel = anthropicConfigured ? model : null;

type MessageRequest = {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
};

/** Returns Claude's text blocks or throws for an unavailable/invalid response. */
export async function requestAnthropicText({ system, user, maxTokens, temperature, signal }: MessageRequest): Promise<string> {
  if (!apiKey) throw new Error('anthropic_not_configured');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal,
  });

  if (!response.ok) throw new Error(`anthropic_http_${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type?: unknown; text?: unknown }> };
  return (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim();
}

export function parseModelJson(text: string): unknown {
  return JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
}

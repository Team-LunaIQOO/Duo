import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env unless the process was already given the values.
// Keys live on the laptop and never on the phone: anything an Expo build
// inlines ends up extractable from the APK, which is why this proxy exists.
(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(here, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Tolerates the comma-separated single-line form as well as one per line.
    for (const pair of trimmed.split(',')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
})();

// 8788, NOT 8787. The laptop relay (viewer/relay.js) owns 8787, and both run
// on the laptop at the same time during a demo.
//
// This is not a theoretical clash. On Windows the two bind successfully at
// once, because the relay listens on [::]:8787 and this server listened on
// 0.0.0.0:8787 — different address families, no EADDRINUSE, no error printed.
// Requests then split by address family: ::1 reached the relay, 127.0.0.1
// reached this proxy. `adb reverse tcp:8787` forwards over IPv4, so the phone's
// stream to the viewer hit this server, got a 404, and the laptop skeleton
// silently never appeared.
const port = Number(process.env.SECOND_VOICE_PORT ?? 8788);
const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o';
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
const alertCooldownMs = 60_000;
let lastAlertAt = -Infinity;
let alertInFlight = false;

if (!apiKey && !anthropicKey && !(telegramBotToken && telegramChatId)) {
  console.error('Configure ANTHROPIC_API_KEY (or OPENROUTER_API_KEY) and/or both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  process.exit(1);
}

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

const readBody = (request) => new Promise((resolve, reject) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 32_000) reject(new Error('request_too_large'));
  });
  request.on('end', () => resolve(JSON.parse(body)));
  request.on('error', reject);
});

async function reconstruct(request, response) {
  if (!apiKey) return json(response, 503, { error: 'second_voice_not_configured' });
  const input = await readBody(request);
  if (typeof input.transcript !== 'string' || !input.transcript.trim()) return json(response, 400, { error: 'transcript_required' });
  const hints = Array.isArray(input.phraseHints) ? input.phraseHints.slice(0, 8) : [];
  const prompt = [
    'Reconstruct the user\'s intended sentence from the transcript.',
    'Return JSON only: {"candidates":[{"text":"...","rank":1}]} with 1 to 3 concise candidates.',
    'Do not invent facts. Preserve uncertainty. Never include markdown or commentary.',
    `Transcript: ${input.transcript.trim()}`,
    `Approved phrase hints: ${JSON.stringify(hints)}`,
    `Context: ${JSON.stringify(input.context ?? {})}`,
  ].join('\n');
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Team-LunaIQOO/Duo',
      'X-Title': 'Duo Second Voice',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 160,
      messages: [
        { role: 'system', content: 'You are a conservative communication assistant. The user must approve every sentence before it is spoken.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!upstream.ok) return json(response, 502, { error: `openrouter_http_${upstream.status}` });
  const data = await upstream.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(typeof content === 'string' ? content : '{}');
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 3).map((candidate, index) => ({
    id: `openrouter-${index + 1}`,
    text: typeof candidate.text === 'string' ? candidate.text.trim() : '',
    rank: index + 1,
    source: 'openrouter',
  })).filter((candidate) => candidate.text) : [];
  return candidates.length ? json(response, 200, { candidates }) : json(response, 502, { error: 'invalid_model_output' });
}


// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

/** One call to the Messages API. Returns the concatenated text blocks. */
async function callAnthropic({ system, user, maxTokens = 120, temperature = 0.6, timeoutMs = 8000 }) {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`anthropic_http_${upstream.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const data = await upstream.json();
  return (Array.isArray(data.content) ? data.content : [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/*
 * Duo's voice.
 *
 * These constraints come from 02-product-spec.md, "The voice and personality",
 * handed to the model rather than paraphrased. They are the difference between
 * a companion and a hype coach, and the users may be tired, in discomfort and
 * struggling with language.
 */
const DUO_SYSTEM = [
  'You are Duo, a calm rehabilitation companion for a stroke survivor doing arm exercises at home.',
  'Reply with ONE short spoken line and nothing else. No preamble, no quotes, no emoji, no markdown.',
  'Rules, all mandatory:',
  '- Under 10 words where possible. Short sentences.',
  '- One instruction at a time. Never stack two corrections.',
  '- Plain words. Say "sit up straight", never "maintain trunk alignment".',
  '- Never scold. Say "let us try that one again", never "that was wrong".',
  '- Never diagnose, never assess recovery, never mention scores or percentages.',
  '- Never tell the user to change their prescribed exercise programme.',
  'You are not a medical device and must never imply otherwise.',
].join('\n');

async function reply(request, response) {
  if (!anthropicKey) return json(response, 503, { error: 'anthropic_not_configured' });
  const input = await readBody(request);
  const situation = typeof input.situation === 'string' ? input.situation.trim() : '';
  if (!situation) return json(response, 400, { error: 'situation_required' });

  const text = await callAnthropic({
    system: DUO_SYSTEM,
    user: [
      `Situation: ${situation}`,
      `Session so far: ${JSON.stringify(input.context ?? {})}`,
      'Say the one line Duo speaks now.',
    ].join('\n'),
    maxTokens: 60,
    temperature: 0.7,
    timeoutMs: Number(input.timeoutMs) || 8000,
  });

  // One line only, however chatty the model felt like being.
  const first = text.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? '';
  const cleaned = first.replace(/^["“]+|["”]+$/g, '').trim();
  if (!cleaned) return json(response, 502, { error: 'empty_reply' });
  return json(response, 200, { text: cleaned });
}

/** Echo reconstruction on the Anthropic key. Same contract as /reconstruct. */
async function reconstructWithAnthropic(request, response) {
  const input = await readBody(request);
  if (typeof input.transcript !== 'string' || !input.transcript.trim()) {
    return json(response, 400, { error: 'transcript_required' });
  }
  const hints = Array.isArray(input.phraseHints) ? input.phraseHints.slice(0, 8) : [];
  const text = await callAnthropic({
    system: [
      'You reconstruct what a person with aphasia or a stutter meant to say.',
      'They read your suggestions and approve one before it is spoken aloud for them.',
      'Return JSON only: {"candidates":[{"text":"..."}]} with 1 to 3 short first-person sentences.',
      'Never invent needs, people, facts or actions that are not in the transcript.',
      'Never explain, never describe their intent, never add commentary.',
    ].join('\n'),
    user: [
      `Transcript: ${input.transcript.trim()}`,
      `Approved phrase hints: ${JSON.stringify(hints)}`,
    ].join('\n'),
    maxTokens: 200,
    temperature: 0.2,
  });

  let parsed = {};
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?/g, '').replace(/```$/g, '').trim());
  } catch {
    // A bare sentence is still usable; wrap it rather than fail the request.
    parsed = { candidates: [{ text }] };
  }
  const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
    .slice(0, 3)
    .map((candidate, index) => ({
      id: `anthropic-${index + 1}`,
      text: typeof candidate.text === 'string' ? candidate.text.trim() : '',
      rank: index + 1,
      source: 'anthropic',
    }))
    .filter((candidate) => candidate.text);
  return candidates.length ? json(response, 200, { candidates }) : json(response, 502, { error: 'invalid_model_output' });
}


/*
 * Intent recognition.
 *
 * Duo is driven by speech, and this is where speech becomes an action. The
 * model gets the raw transcript and the session state, and returns one action
 * from a closed list plus the line to say while doing it.
 *
 * Two things this deliberately refuses to do:
 *
 * - Invent an action. The list is fixed, the response is validated against it
 *   on the way back, and anything unrecognised becomes 'none'. A model that
 *   improvises a new action would be a model that can do something the app
 *   never agreed to.
 * - Guess which arm. If the user names an exercise without a side, the side
 *   comes back null and the app asks. Getting it wrong silently inverts the
 *   affected-versus-unaffected comparison, which is the measurement this
 *   product exists to produce -- 04-clinical-logic.md.
 */
const INTENT_SYSTEM = [
  'You turn a stroke-rehab user\'s spoken words into ONE action for a phone app.',
  'Return JSON only. No markdown, no commentary, no code fence.',
  'Shape: {"action":"...","exercise":"E1"|"E3"|null,"side":"left"|"right"|null,"reply":"..."}',
  '',
  'action must be exactly one of:',
  '  start_exercise  they named an exercise to do',
  '  switch_exercise they want a different exercise than the current one',
  '  switch_arm      same exercise, other arm',
  '  pause           stop counting for a moment',
  '  resume          carry on after a pause',
  '  stop            finish the session now',
  '  how_many        asking for the rep count',
  '  repeat          asking you to say the last thing again',
  '  none            anything else, including chat you cannot act on',
  '',
  'exercise: E1 is shoulder abduction, spoken as shoulder raises, arm raises,',
  'lifting the arm out to the side. E3 is elbow flexion, spoken as bicep curls,',
  'elbow curls, curls. null when no exercise was named.',
  '',
  'side: only when they actually said left or right, or clearly named the',
  'affected or weaker arm and you were told which that is. NEVER guess. null',
  'if unsure.',
  '',
  'reply: the one short line Duo speaks while doing it. Under 10 words. Calm,',
  'plain, never scolding, never clinical. For action none, reply with a brief',
  'honest line that you did not catch it.',
].join('\n');

const INTENT_ACTIONS = new Set([
  'start_exercise', 'switch_exercise', 'switch_arm',
  'pause', 'resume', 'stop', 'how_many', 'repeat', 'none',
]);

async function intent(request, response) {
  if (!anthropicKey) return json(response, 503, { error: 'anthropic_not_configured' });
  const input = await readBody(request);
  const transcript = typeof input.transcript === 'string' ? input.transcript.trim() : '';
  if (!transcript) return json(response, 400, { error: 'transcript_required' });

  const text = await callAnthropic({
    system: INTENT_SYSTEM,
    user: [
      `They said: ${transcript}`,
      `Session state: ${JSON.stringify(input.context ?? {})}`,
    ].join('\n'),
    maxTokens: 150,
    temperature: 0,
    timeoutMs: Number(input.timeoutMs) || 6000,
  });

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?/g, '').replace(/```$/g, '').trim());
  } catch {
    return json(response, 502, { error: 'invalid_model_output' });
  }

  // Validated on the way back, not trusted. Anything off the list is 'none',
  // which does nothing -- the failure mode of a confused model is silence,
  // never an action the user did not ask for.
  const action = INTENT_ACTIONS.has(parsed.action) ? parsed.action : 'none';
  const exercise = parsed.exercise === 'E1' || parsed.exercise === 'E3' ? parsed.exercise : null;
  const side = parsed.side === 'left' || parsed.side === 'right' ? parsed.side : null;
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().split('\n')[0] : '';

  return json(response, 200, { action, exercise, side, reply });
}

async function sendFallAlert(request, response) {
  if (!telegramBotToken || !telegramChatId) return json(response, 503, { error: 'telegram_not_configured' });
  if (alertInFlight || Date.now() - lastAlertAt < alertCooldownMs) return json(response, 429, { error: 'alert_rate_limited' });
  const input = await readBody(request);
  const reasons = new Set(['rapid_drop_low_posture', 'rapid_drop_tracking_lost']);
  if (typeof input.detectedAt !== 'string' || !reasons.has(input.reason)) return json(response, 400, { error: 'invalid_fall_event' });

  alertInFlight = true;
  try {
    const upstream = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: `Duo detected a possible fall at ${input.detectedAt}. Please check on the user. This is an automated prototype alert.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || data.ok !== true) return json(response, 502, { error: `telegram_http_${upstream.status}` });
    lastAlertAt = Date.now();
    return json(response, 200, { sent: true });
  } finally {
    alertInFlight = false;
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST') return json(response, 404, { error: 'not_found' });

  // One line per request, with how long it took.
  //
  // Without this there is no way to tell "the phone is not calling" from "the
  // model is slow" from "the call failed and it fell back" — all three look
  // identical from the phone, because every one of them ends with Duo saying
  // its written line. This is the only place the difference is visible.
  const startedAt = Date.now();
  response.on('finish', () => {
    const ms = Date.now() - startedAt;
    console.log(`  ${new Date().toISOString().slice(11, 19)}  ${request.url}  ${response.statusCode}  ${ms}ms`);
  });

  try {
    if (request.url === '/reply') return await reply(request, response);
    if (request.url === '/intent') return await intent(request, response);
    if (request.url === '/reconstruct') {
      return anthropicKey
        ? await reconstructWithAnthropic(request, response)
        : await reconstruct(request, response);
    }
    if (request.url === '/fall-alert') return await sendFallAlert(request, response);
    return json(response, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'bad_request';
    const status = message === 'request_too_large' || error instanceof SyntaxError ? 400 : 502;
    return json(response, status, { error: message });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Duo service proxy listening on :${port}`);
  console.log(`  /reply        ${anthropicKey ? `Anthropic ${anthropicModel}` : 'DISABLED (no ANTHROPIC_API_KEY)'}`);
  console.log(`  /intent       ${anthropicKey ? `Anthropic ${anthropicModel}` : 'DISABLED (no ANTHROPIC_API_KEY)'}`);
  console.log(`  /reconstruct  ${anthropicKey ? `Anthropic ${anthropicModel}` : apiKey ? `OpenRouter ${model}` : 'DISABLED'}`);
  console.log(`  /fall-alert   ${telegramBotToken && telegramChatId ? 'Telegram' : 'DISABLED'}`);
});

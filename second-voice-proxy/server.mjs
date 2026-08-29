import http from 'node:http';

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
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
const alertCooldownMs = 60_000;
let lastAlertAt = -Infinity;
let alertInFlight = false;

if (!apiKey && !(telegramBotToken && telegramChatId)) {
  console.error('Configure OPENROUTER_API_KEY and/or both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
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
  try {
    if (request.url === '/reconstruct') return await reconstruct(request, response);
    if (request.url === '/fall-alert') return await sendFallAlert(request, response);
    return json(response, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'bad_request';
    const status = message === 'request_too_large' || error instanceof SyntaxError ? 400 : 502;
    return json(response, status, { error: message });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Duo service proxy listening on :${port}`));

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

if (!apiKey) {
  console.error('Missing OPENROUTER_API_KEY. Refusing to start without a server-side key.');
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

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/reconstruct') return json(response, 404, { error: 'not_found' });
  try {
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
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : 'bad_request' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Second Voice proxy listening on :${port} using ${model}`));

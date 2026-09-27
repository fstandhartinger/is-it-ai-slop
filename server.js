const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.TYPESAFE_API_KEY || '';
const API_URL = process.env.TYPESAFE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest';
const UMAMI_API_KEY = process.env.UMAMI_API_KEY || '';
const MAX_CHARS = 5000;
const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD || 2);
const CALL_RESERVE_USD = 0.00025;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_CALL_LIMIT = Number(process.env.IP_CALL_LIMIT || 10);
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));
const privacyHtml = fs.readFileSync(path.join(__dirname, 'privacy.html'));

let day = utcDay();
let spentToday = 0;
let reservedToday = 0;
const ipCalls = new Map();
const visitorCache = { value: null, expiresAt: 0 };
let visitorRequest = null;

function utcDay() { return new Date().toISOString().slice(0, 10); }
function resetDayIfNeeded() {
  const now = utcDay();
  if (now !== day) { day = now; spentToday = 0; reservedToday = 0; ipCalls.clear(); }
}
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}
function rateLimited(ip) {
  const cutoff = Date.now() - IP_WINDOW_MS;
  const recent = (ipCalls.get(ip) || []).filter(t => t > cutoff);
  if (recent.length >= IP_CALL_LIMIT) { ipCalls.set(ip, recent); return true; }
  recent.push(Date.now()); ipCalls.set(ip, recent); return false;
}
function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': data.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
  });
  res.end(data);
}
async function totalVisitors() {
  if (!UMAMI_API_KEY) return null;
  const now = Date.now();
  if (visitorCache.expiresAt > now) return visitorCache.value;
  if (!visitorRequest) {
    visitorRequest = (async () => {
      try {
        const url = new URL('https://bh-analytics.app.mintapis.com/api/websites/76557796-8d7a-457e-9941-31c69dbe8cf3/stats');
        url.searchParams.set('startAt', '0');
        url.searchParams.set('endAt', String(now));
        const response = await fetch(url, { headers: { authorization: `Bearer ${UMAMI_API_KEY}` }, signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error('umami_unavailable');
        const data = await response.json();
        if (!Number.isSafeInteger(data.visitors) || data.visitors < 0) throw new Error('invalid_umami_response');
        visitorCache.value = data.visitors;
        visitorCache.expiresAt = now + 5 * 60_000;
        return visitorCache.value;
      } catch {
        visitorCache.value = null;
        visitorCache.expiresAt = now + 60_000;
        return null;
      } finally {
        visitorRequest = null;
      }
    })();
  }
  return visitorRequest;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 12_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid_json')); } });
    req.on('error', reject);
  });
}
function safeAnswer(payload) {
  const answer = payload?.answers?.decision;
  const usage = payload?.usage;
  if (answer?.type !== 'choice' || !['slop', 'not_slop'].includes(answer.choice)) throw new Error('bad_answer');
  const slop = Number(answer.probabilities?.slop);
  const notSlop = Number(answer.probabilities?.not_slop);
  const confidence = Number(answer.confidence);
  const inputTokens = Number(usage?.input_tokens);
  if (![slop, notSlop, confidence].every(Number.isFinite) || !Number.isInteger(inputTokens) || inputTokens < 0) throw new Error('bad_answer');
  return { verdict: answer.choice, probability: answer.choice === 'slop' ? slop : notSlop, slopProbability: slop, confidence, inputTokens, model: String(payload.model || MODEL) };
}
async function askJev(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const started = performance.now();
  try {
    const response = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        state: { text },
        questions: {
          decision: {
            type: 'choice',
            instructions: 'Decide whether `text` reads as AI slop. Judge the writing as presented, not who or what generated it. AI slop means low-effort filler: generic or inflated language, repetitive restatement, canned framing, vague claims without useful specifics, empty enthusiasm, padded structure, or prose that imitates insight while adding little. Do not mark text as slop merely because it is polished, uses headings, has a neutral tone, is short, or might have been AI-assisted. Concrete, purposeful, specific, original, or genuinely useful writing is not slop even if imperfect. Satire and deliberate absurdity are not slop when they have a discernible point. If context is limited, judge only the submitted text.',
            criteria: {
              slop: 'The text is predominantly low-effort filler by the definition above; its main effect is padding, generic performance, or content-shaped noise.',
              not_slop: 'The text is predominantly purposeful, specific, substantive, original, or usefully communicative; any weak phrasing is incidental rather than defining.'
            }
          }
        }
      })
    });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    const parsed = safeAnswer(await response.json());
    return { ...parsed, elapsedSeconds: (performance.now() - started) / 1000 };
  } finally { clearTimeout(timeout); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': indexHtml.length, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://bh-analytics.app.mintapis.com; connect-src 'self' https://bh-analytics.app.mintapis.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    return res.end(indexHtml);
  }
  if (req.method === 'GET' && req.url === '/privacy.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': privacyHtml.length, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://bh-analytics.app.mintapis.com; connect-src 'self' https://bh-analytics.app.mintapis.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    return res.end(privacyHtml);
  }
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/api/visits') {
    const visitors = await totalVisitors();
    return json(res, 200, { visitors });
  }
  if (req.method !== 'POST' || req.url !== '/api/answer') return json(res, 404, { error: 'Not found.' });
  resetDayIfNeeded();
  if (!API_KEY) return json(res, 503, { error: 'Jev is taking a short break. Please try again later.' });
  if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Easy there, slop scholar — please try again in 15 minutes.' });
  if (spentToday + reservedToday + CALL_RESERVE_USD > DAILY_BUDGET_USD) return json(res, 429, { error: 'Today’s Jev budget has been used up. The slop detector will be back tomorrow.' });
  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Please send valid text.' }); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json(res, 400, { error: 'Paste something first.' });
  if (text.length > MAX_CHARS) return json(res, 400, { error: `Keep it under ${MAX_CHARS.toLocaleString()} characters.` });
  reservedToday += CALL_RESERVE_USD;
  try {
    const result = await askJev(text);
    const cost = result.inputTokens * PRICE_PER_INPUT_TOKEN;
    spentToday += cost;
    json(res, 200, { verdict: result.verdict, probability: result.probability, slopProbability: result.slopProbability, confidence: result.confidence, cost, elapsedSeconds: result.elapsedSeconds, model: result.model });
  } catch (error) {
    // The upstream may have processed a request even if its response failed.
    spentToday += CALL_RESERVE_USD;
    console.error('Jev request failed:', error.message);
    json(res, 502, { error: 'Jev couldn’t judge that right now. Please try again in a moment.' });
  } finally { reservedToday = Math.max(0, reservedToday - CALL_RESERVE_USD); }
});

if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`Listening on ${PORT}`));
module.exports = { server, safeAnswer };

const test = require('node:test');
const assert = require('node:assert/strict');
const umamiApiKey = process.env.UMAMI_API_KEY;
delete process.env.UMAMI_API_KEY;
const { safeAnswer, server } = require('../server');
if (umamiApiKey !== undefined) process.env.UMAMI_API_KEY = umamiApiKey;
const fs = require('node:fs');
const path = require('node:path');

test('parses a typed Jev Choice honestly', () => {
  const out = safeAnswer({ model:'jev-1.13.0', answers:{ decision:{ type:'choice', choice:'slop', probabilities:{slop:.73,not_slop:.27}, confidence:.58 } }, usage:{input_tokens:1000} });
  assert.equal(out.verdict, 'slop'); assert.equal(out.slopProbability, .73); assert.equal(out.confidence, .58); assert.equal(out.inputTokens, 1000);
});
test('rejects malformed responses', () => assert.throws(() => safeAnswer({answers:{decision:{type:'noul'}}})));

test('moves focus and the viewport to a completed result', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<section id="result"[^>]*tabindex="-1"/);
  assert.match(html, /result\.focus\(\{preventScroll:true\}\)/);
  assert.match(html, /result\.scrollIntoView\(/);
  assert.match(html, /button\.textContent='Check text'/);
});

test('offers a keyboard-safe sample for first-time visitors', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<button class="sample" id="sample" type="button">Try a sample<\/button>/);
  assert.match(html, /querySelector\('#sample'\)\.addEventListener\('click'/);
  assert.match(html, /text\.dispatchEvent\(new Event\('input'\)\)/);
  assert.match(html, /text\.focus\(\)/);
});

test('serves analytics pages under a CSP that permits only the self-hosted Umami host', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/', '/privacy.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-security-policy'), /script-src[^;]*https:\/\/bh-analytics\.app\.mintapis\.com/);
      assert.match(await response.text(), /76557796-8d7a-457e-9941-31c69dbe8cf3/);
    }
    const response = await fetch(base + '/api/visits');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { visitors: null });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('Docker image includes the privacy page read at server startup', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY package\.json server\.js index\.html privacy\.html \.\//);
});

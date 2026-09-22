const test = require('node:test');
const assert = require('node:assert/strict');
const { safeAnswer } = require('../server');
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

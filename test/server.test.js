const test = require('node:test');
const assert = require('node:assert/strict');
const { safeAnswer } = require('../server');

test('parses a typed Jev Choice honestly', () => {
  const out = safeAnswer({ model:'jev-1.13.0', answers:{ decision:{ type:'choice', choice:'slop', probabilities:{slop:.73,not_slop:.27}, confidence:.58 } }, usage:{input_tokens:1000} });
  assert.equal(out.verdict, 'slop'); assert.equal(out.slopProbability, .73); assert.equal(out.confidence, .58); assert.equal(out.inputTokens, 1000);
});
test('rejects malformed responses', () => assert.throws(() => safeAnswer({answers:{decision:{type:'noul'}}})));

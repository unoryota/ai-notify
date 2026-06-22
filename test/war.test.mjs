import { test } from 'node:test';
import assert from 'node:assert/strict';
import { band, effectiveProsody, volumeMul } from '../src/war.mjs';
import { effectiveProsody as tsundereProsody } from '../src/tsundere.mjs';

test('band: 0 = peace, mid = combat, max = crisis', () => {
  assert.equal(band(0), 'peace');
  assert.equal(band(0.5), 'combat');
  assert.equal(band(1), 'crisis');
});

test('volume escalates peace < combat < crisis', () => {
  assert.ok(volumeMul(0, 'T1') < volumeMul(0.5, 'T1'));
  assert.ok(volumeMul(0.5, 'T1') < volumeMul(1, 'T1'));
});

test('crisis read-out is NOT a 早口: combined speed stays intelligible', () => {
  // emit stacks war on top of the tsundere tone: war.effectiveProsody(level,
  // tsundere.effectiveProsody(tone, base)). At MAX adrenaline with a ツン tone the
  // combined speed must stay near ~1.12× — well under the old 1.29× that read
  // too fast.
  const base = { speed: 1, pitch: 0, intonation: 1 };
  const combined = effectiveProsody(1, tsundereProsody('tsun', base));
  assert.ok(combined.speed <= 1.15, `crisis combined speed too fast: ${combined.speed}`);
  // still faster than peace, so the escalation is audible
  const peace = effectiveProsody(0, tsundereProsody('tsun', base));
  assert.ok(combined.speed > peace.speed);
});

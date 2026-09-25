import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEffort, horaLocal, diaHora, formatarTokens } from '../src/util.js';

test('normalizarEffort aceita string, objeto e ausência', () => {
  assert.equal(normalizarEffort('high'), 'high');
  assert.equal(normalizarEffort({ level: 'xhigh' }), 'xhigh');
  assert.equal(normalizarEffort(undefined), null);
  assert.equal(normalizarEffort({}), null);
  assert.equal(normalizarEffort(42), null);
});

test('horaLocal e diaHora usam o fuso local', () => {
  const d = new Date(2026, 8, 24, 22, 5); // quinta, 22:05 local
  const s = Math.floor(d.getTime() / 1000);
  assert.equal(horaLocal(s), '22:05');
  assert.equal(diaHora(s), 'qui 22:05');
});

test('formatarTokens', () => {
  assert.equal(formatarTokens(999), '999');
  assert.equal(formatarTokens(850_000), '850k');
  assert.equal(formatarTokens(1_234_567), '1.2M');
  assert.equal(formatarTokens(null), '—');
});

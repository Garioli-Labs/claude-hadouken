import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECORRIDO_MIN_MS, momentoFalado, fraseEsgota } from '../src/uso/frase.js';

// Frase de previsão no estilo da aba Uso do claude.ai (spec, emenda E5). As
// datas são locais (new Date(ano, mes, ...)), para passar em qualquer fuso.
// 29/09/2026 é uma terça.

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const t = (mes, dia, h = 0, m = 0) => new Date(2026, mes - 1, dia, h, m).getTime();

// ---------------------------------------------------------------------------
// momentoFalado

test('momentoFalado: a menos de 6 h, a hora exata', () => {
  assert.equal(momentoFalado(t(9, 29, 20, 30), t(9, 29, 17, 4)), 'por volta das 20:30');
  assert.equal(momentoFalado(t(9, 29, 17, 4), t(9, 29, 17, 4)), 'por volta das 17:04');
  // Passa da meia-noite, ainda a menos de 6 h.
  assert.equal(momentoFalado(t(9, 30, 1, 5), t(9, 29, 22, 0)), 'por volta das 01:05');
  assert.equal(momentoFalado(t(9, 29, 23, 3) + 59_999, t(9, 29, 17, 4)), 'por volta das 23:03');
});

test('momentoFalado: de 6 h em diante, o período do dia', () => {
  const agora = t(9, 29, 8, 0);
  assert.equal(momentoFalado(agora + 6 * H, agora), 'hoje à tarde');
  assert.equal(momentoFalado(t(9, 29, 19, 0), t(9, 29, 0, 30)), 'hoje à noite');
  assert.equal(momentoFalado(t(9, 29, 11, 0), t(9, 29, 0, 30)), 'hoje de manhã');
});

test('momentoFalado: bordas dos períodos (5:59/6:00, 11:59/12:00, 17:59/18:00)', () => {
  const agora = t(9, 29, 8, 0);
  const casos = [
    [t(9, 30, 0, 0), 'amanhã de madrugada'],
    [t(9, 30, 5, 59), 'amanhã de madrugada'],
    [t(9, 30, 6, 0), 'amanhã de manhã'],
    [t(9, 30, 11, 59), 'amanhã de manhã'],
    [t(9, 30, 12, 0), 'amanhã à tarde'],
    [t(9, 30, 17, 59), 'amanhã à tarde'],
    [t(9, 30, 18, 0), 'amanhã à noite'],
    [t(9, 30, 23, 59), 'amanhã à noite'],
  ];
  for (const [alvo, esperado] of casos) assert.equal(momentoFalado(alvo, agora), esperado, new Date(alvo).toString());
});

test('momentoFalado: de 2 a 6 dias, o dia da semana; depois, a data', () => {
  const agora = t(9, 29, 8, 0);
  assert.equal(momentoFalado(t(10, 1, 9, 0), agora), 'quinta de manhã');
  assert.equal(momentoFalado(t(10, 2, 13, 0), agora), 'sexta à tarde');
  assert.equal(momentoFalado(t(10, 3, 20, 0), agora), 'sábado à noite');
  assert.equal(momentoFalado(t(10, 4, 3, 0), agora), 'domingo de madrugada');
  assert.equal(momentoFalado(t(10, 5, 23, 59), agora), 'segunda à noite');
  assert.equal(momentoFalado(t(10, 6, 0, 0), agora), 'em 06/10');
  assert.equal(momentoFalado(t(12, 25, 12, 0), agora), 'em 25/12');
});

test('momentoFalado: alvo no passado ou entrada não finita dá null', () => {
  const agora = t(9, 29, 17, 4);
  assert.equal(momentoFalado(agora - 1, agora), null);
  for (const [a, b] of [[NaN, agora], [agora, NaN], [Infinity, agora], ['1', agora], [agora, null], [undefined, undefined], [1e300, agora]]) {
    assert.equal(momentoFalado(a, b), null, `${a} ${b}`);
  }
});

// ---------------------------------------------------------------------------
// fraseEsgota

test('fraseEsgota: o caso E1 (41% da semana às 17:04 de 29/09) esgota amanhã à noite', () => {
  const s = fraseEsgota({ usado: 41, resetsAtMs: t(10, 5, 22, 0), janelaMs: 7 * D, agoraMs: t(9, 29, 17, 4) });
  assert.equal(s, 'Nesse ritmo, esgota amanhã à noite, antes do reinício de 05/10 às 22:00.');
});

test('fraseEsgota: 25% na janela de 5 h faltando 16 min não esgota', () => {
  const s = fraseEsgota({ usado: 25, resetsAtMs: t(9, 29, 17, 20), janelaMs: 5 * H, agoraMs: t(9, 29, 17, 4) });
  assert.equal(s, 'Nesse ritmo, não esgota antes do reinício das 17:20.');
});

test('fraseEsgota: esgota em menos de 6 h, com a hora', () => {
  // 80% em 3 h de janela: os 20% restantes vão em 45 min.
  const s = fraseEsgota({ usado: 80, resetsAtMs: t(9, 29, 19, 4), janelaMs: 5 * H, agoraMs: t(9, 29, 17, 4) });
  assert.equal(s, 'Nesse ritmo, esgota por volta das 17:49, antes do reinício das 19:04.');
});

test('fraseEsgota: limite atingido', () => {
  const s = fraseEsgota({ usado: 100, resetsAtMs: t(9, 29, 17, 20), janelaMs: 5 * H, agoraMs: t(9, 29, 17, 4) });
  assert.equal(s, 'Limite atingido; reinicia às 17:20.');
  const s2 = fraseEsgota({ usado: 100, resetsAtMs: t(10, 5, 22, 0), janelaMs: 7 * D, agoraMs: t(9, 29, 17, 4) });
  assert.equal(s2, 'Limite atingido; reinicia em 05/10 às 22:00.');
});

test('fraseEsgota: com menos de 30 min decorridos não há frase', () => {
  assert.equal(DECORRIDO_MIN_MS, 30 * MIN);
  const agora = t(9, 29, 17, 4);
  // Decorrido de 10 min.
  assert.equal(fraseEsgota({ usado: 5, resetsAtMs: agora + 5 * H - 10 * MIN, janelaMs: 5 * H, agoraMs: agora }), null);
  // Exatamente 30 min já vale.
  assert.notEqual(fraseEsgota({ usado: 5, resetsAtMs: agora + 5 * H - 30 * MIN, janelaMs: 5 * H, agoraMs: agora }), null);
  // Reinício mais longe que a janela (decorrido negativo).
  assert.equal(fraseEsgota({ usado: 5, resetsAtMs: agora + 6 * H, janelaMs: 5 * H, agoraMs: agora }), null);
});

test('fraseEsgota: entradas inválidas dão null, sem lançar', () => {
  const ok = { usado: 41, resetsAtMs: t(10, 5, 22, 0), janelaMs: 7 * D, agoraMs: t(9, 29, 17, 4) };
  const ruins = [
    { usado: 0 },
    { usado: -1 },
    { usado: 100.01 },
    { usado: NaN },
    { usado: '41' },
    { janelaMs: 0 },
    { janelaMs: -D },
    { janelaMs: Infinity },
    { resetsAtMs: ok.agoraMs },
    { resetsAtMs: ok.agoraMs - 1 },
    { resetsAtMs: null },
    { agoraMs: undefined },
  ];
  for (const r of ruins) assert.equal(fraseEsgota({ ...ok, ...r }), null, JSON.stringify(r));
  assert.equal(fraseEsgota(), null);
  assert.equal(fraseEsgota(null), null);
  const hostil = { ...ok };
  Object.defineProperty(hostil, 'usado', { get() { throw new Error('getter'); } });
  assert.equal(fraseEsgota(hostil), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COBERTURA_MIN_MS, inclinacao, JANELA_5H_MS, JANELA_7D_MS, PONTOS_MIN, preverEstouro,
} from '../src/previsao.js';

// Previsão de estouro (spec v0.2.0 §12.3 e §12.7): inclinação por mínimos
// quadrados, alcance de 20 min (5h) e 3 h (7d), mínimo de 3 pontos em 6 min,
// previsão só antes do reset.

const MIN = 60_000;
const agora = Date.UTC(2026, 8, 25, 18, 0);
const agoraS = agora / 1000;
const iso = (ms) => new Date(ms).toISOString();
const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
// Pontos do histórico, um por minuto relativo a agora: [minuto, h5, d7].
const hist = (linhas) => linhas.map(([m, h5, d7]) => ({ at: iso(agora + m * MIN), h5, d7 }));
const lim5 = (usado, resetS = agoraS + 3600) => ({ five_hour: { used_percentage: usado, resets_at: resetS } });

test('constantes: 20 min (5h), 3 h (7d), 3 pontos, 6 min', () => {
  assert.equal(JANELA_5H_MS, 20 * MIN);
  assert.equal(JANELA_7D_MS, 180 * MIN);
  assert.equal(PONTOS_MIN, 3);
  assert.equal(COBERTURA_MIN_MS, 6 * MIN);
});

test('inclinacao: reta exata e mínimos quadrados com ruído, em pontos por minuto', () => {
  const t = (m) => agora + m * MIN;
  perto(inclinacao([[t(0), 10], [t(2), 12], [t(4), 14], [t(6), 16], [t(8), 18]]), 1);
  perto(inclinacao([[t(0), 10], [t(2), 12], [t(4), 15], [t(6), 15], [t(8), 19]]), 1.05);
  perto(inclinacao([[t(8), 19], [t(0), 10], [t(4), 15], [t(6), 15], [t(2), 12]]), 1.05);
  perto(inclinacao([[t(0), 50], [t(3), 48.5], [t(6), 47]]), -0.5);
  perto(inclinacao([[t(0), 30], [t(3), 30], [t(6), 30]]), 0);
});

test('inclinacao: menos de 3 pontos, cobertura menor que 6 min ou ponto inválido dá null', () => {
  const t = (m) => agora + m * MIN;
  for (const v of [undefined, null, 'x', 42, {}, [], [[t(0), 1], [t(9), 2]]]) assert.equal(inclinacao(v), null);
  assert.equal(inclinacao([[t(0), 1], [t(3), 2], [t(6) - 1, 3]]), null);
  perto(inclinacao([[t(0), 1], [t(3), 2], [t(6), 3]]), 1 / 3);
  assert.equal(inclinacao([[t(0), 1], [t(0), 2], [t(0), 3]]), null);
  const ruins = [[t(6), Number.NaN], [t(6), '3'], [t(6), Infinity], ['t', 3], [Number.NaN, 3], null, {}, [t(6)]];
  for (const r of ruins) assert.equal(inclinacao([[t(0), 1], [t(3), 2], r]), null, JSON.stringify(r));
  // Instantes enormes: as somas estouram e o resultado não é finito.
  assert.equal(inclinacao([[1e308, 1], [1.5e308, 2], [1.7e308, 3]]), null);
});

test('5h: agora + (100 − atual) ÷ inclinação, só com os pontos dos últimos 20 min', () => {
  const historico = hist([[-40, 1, null], [-21, 5, null], [-8, 66, null], [-6, 68, null], [-4, 70, null], [-2, 72, null], [0, 74, null]]);
  assert.deepEqual(preverEstouro({ historico, limites: lim5(74), agoraMs: agora }), { five_hour: agora + 26 * MIN, seven_day: null });
  // O ponto de exatamente 20 min atrás entra no alcance.
  const borda = hist([[-20, 54, null], [-10, 64, null], [0, 74, null]]);
  assert.equal(preverEstouro({ historico: borda, limites: lim5(74), agoraMs: agora }).five_hour, agora + 26 * MIN);
});

test('7d: usa as últimas 3 h de pontos e mostra previsão de dias', () => {
  const linhas = [[-181, null, 0]];
  for (let m = -180; m <= 0; m += 2) linhas.push([m, null, 61 + m * 0.05]);
  const limites = { seven_day: { used_percentage: 61, resets_at: agoraS + 3 * 86_400 } };
  const p = preverEstouro({ historico: hist(linhas), limites, agoraMs: agora });
  assert.equal(p.five_hour, null);
  assert.equal(p.seven_day, agora + 780 * MIN);
});

test('sem previsão: o reset chega antes, ritmo parado ou caindo, 100% ou janela sem leitura', () => {
  const subindo = hist([[-8, 66, 20], [-6, 68, 20], [-4, 70, 20], [-2, 72, 20], [0, 74, 20]]);
  const prever = (limites, historico = subindo) => preverEstouro({ historico, limites, agoraMs: agora });
  // Previsão (26 min) depois do reset (20 min) ou exatamente nele.
  assert.equal(prever(lim5(74, agoraS + 20 * 60)).five_hour, null);
  assert.equal(prever(lim5(74, agoraS + 26 * 60)).five_hour, null);
  assert.equal(prever(lim5(74, agoraS + 26 * 60 + 1)).five_hour, agora + 26 * MIN);
  // Reset já passado, usado 100 ou mais, usado fora do schema.
  for (const l of [lim5(74, agoraS), lim5(100), lim5(120), lim5(-1), lim5(Number.NaN), lim5('74'), { five_hour: null }, {}]) {
    assert.equal(prever(l).five_hour, null, JSON.stringify(l));
  }
  assert.equal(prever(lim5(99.9)).five_hour, agora + 6 * 1000);
  // A 7d ficou parada em 20 o tempo todo: sem previsão.
  assert.equal(prever({ seven_day: { used_percentage: 20, resets_at: agoraS + 86_400 } }).seven_day, null);
  // Caindo, parado, só 2 pontos no alcance, ou 3 pontos em menos de 6 min.
  assert.equal(prever(lim5(66), hist([[-8, 74, null], [-4, 70, null], [0, 66, null]])).five_hour, null);
  assert.equal(prever(lim5(70), hist([[-8, 70, null], [-4, 70, null], [0, 70, null]])).five_hour, null);
  assert.equal(prever(lim5(74), hist([[-30, 40, null], [-2, 72, null], [0, 74, null]])).five_hour, null);
  assert.equal(prever(lim5(74), hist([[-5, 69, null], [-2, 72, null], [0, 74, null]])).five_hour, null);
});

test('§12.7: divisão por quase zero e relógio que volta não dão hora sem sentido', () => {
  // Inclinação ínfima: a previsão cairia séculos depois do reset.
  const quaseParado = hist([[-8, 50, null], [-4, 50 + 1e-12, null], [0, 50 + 2e-12, null]]);
  assert.equal(preverEstouro({ historico: quaseParado, limites: lim5(50), agoraMs: agora }).five_hour, null);
  // O relógio voltou 30 min: todo ponto está mais de 5 min no futuro e sai.
  const subindo = hist([[-8, 66, null], [-6, 68, null], [-4, 70, null], [-2, 72, null], [0, 74, null]]);
  assert.equal(preverEstouro({ historico: subindo, limites: lim5(74), agoraMs: agora - 30 * MIN }).five_hour, null);
  // Até 5 min no futuro ainda vale (a folga de relógio do estado).
  const adiante = hist([[-3, 69, null], [-1, 71, null], [1, 73, null], [3, 75, null], [5, 77, null]]);
  assert.equal(preverEstouro({ historico: adiante, limites: lim5(74), agoraMs: agora }).five_hour, agora + 26 * MIN);
  const alem = hist([[-3, 69, null], [-1, 71, null], [5.001, 77, null]]);
  assert.equal(preverEstouro({ historico: alem, limites: lim5(74), agoraMs: agora }).five_hour, null);
});

test('§12.7: porcentagens fora de 0–100 e pontos estranhos no histórico são ignorados', () => {
  const historico = [
    ...hist([[-8, 150, null], [-7, -5, null]]),
    null, 'x', 42, { at: 123, h5: 70 }, { at: 'lixo', h5: 70 }, { h5: 70 },
    ...hist([[-6, 68, null], [-4, 70, null], [-2, 72, null], [0, 74, null]]),
  ];
  assert.equal(preverEstouro({ historico, limites: lim5(74), agoraMs: agora }).five_hour, agora + 26 * MIN);
});

test('entradas hostis nunca lançam e dão as duas null', () => {
  const vazio = { five_hour: null, seven_day: null };
  const subindo = hist([[-8, 66, null], [-6, 68, null], [-4, 70, null], [-2, 72, null], [0, 74, null]]);
  const hostil = { get at() { throw new Error('x'); }, h5: 1 };
  const limitesHostis = { get five_hour() { throw new Error('x'); } };
  const casos = [
    undefined, null, 'x', {}, { historico: 'x', limites: lim5(74), agoraMs: agora },
    { historico: subindo, limites: null, agoraMs: agora }, { historico: subindo, limites: lim5(74), agoraMs: Number.NaN },
    { historico: subindo, limites: lim5(74), agoraMs: '1' }, { historico: [hostil], limites: lim5(74), agoraMs: agora },
    { historico: subindo, limites: limitesHostis, agoraMs: agora },
  ];
  for (const c of casos) assert.deepEqual(preverEstouro(c), vazio);
  assert.deepEqual(preverEstouro({ get historico() { throw new Error('x'); } }), vazio);
  // resets_at fora do schema (texto, booleano, lista, objeto com valueOf) nunca
  // vira número por coerção: com o mesmo histórico subindo, sem previsão.
  assert.equal(preverEstouro({ historico: subindo, limites: lim5(74), agoraMs: agora }).five_hour, agora + 26 * MIN);
  for (const resetS of [String(agoraS + 3600), true, [agoraS + 3600], { valueOf: () => agoraS + 3600 }]) {
    assert.deepEqual(preverEstouro({ historico: subindo, limites: lim5(74, resetS), agoraMs: agora }), vazio, JSON.stringify(resetS));
  }
});

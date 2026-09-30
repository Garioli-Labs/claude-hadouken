import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarGatilhos } from '../src/guarda/gatilhos.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';

const MIN = 60_000;
const H = 60 * MIN;
const agora = Date.UTC(2026, 8, 29, 6, 0);
const agoraS = agora / 1000;
const leitura = (usado, resetEmMin, fresca = true) => ({ used_percentage: usado, resets_at: agoraS + resetEmMin * 60, idadeMs: fresca ? 0 : 2 * H, fresca });
const avaliar = (o) => avaliarGatilhos({
  leituras: { five_hour: null, seven_day: null }, previsao: { five_hour: null, seven_day: null },
  config: PADRAO_GUARDA, agoraMs: agora, despachosFable: [], limiteFable: null, ...o,
});

test('G3: 5h 89,9 não, 90 sim; reset a 14 min não, a 16 sim', () => {
  assert.equal(avaliar({ leituras: { five_hour: leitura(89.9, 120), seven_day: null } }).five_hour, null);
  const d = avaliar({ leituras: { five_hour: leitura(90, 120), seven_day: null } }).five_hour;
  assert.deepEqual(d, { gatilho: 'G3', resets_at: agoraS + 7200, dados: { usado: 90, teto: 90, fresca: true, idadeMs: 0 } });
  assert.equal(avaliar({ leituras: { five_hour: leitura(95, 14), seven_day: null } }).five_hour, null);
  assert.equal(avaliar({ leituras: { five_hour: leitura(95, 16), seven_day: null } }).five_hour.gatilho, 'G3');
});

test('G4: 84,9 não, 85 sim, também com piso', () => {
  assert.equal(avaliar({ leituras: { five_hour: null, seven_day: leitura(84.9, 3000) } }).seven_day, null);
  const d = avaliar({ leituras: { five_hour: null, seven_day: leitura(86, 3000, false) } }).seven_day;
  assert.equal(d.gatilho, 'G4');
  assert.deepEqual(d.dados, { usado: 86, teto: 85, fresca: false, idadeMs: 2 * H });
});

test('G2: horizonte 23h59 dispara, 24h01 não; exige leitura fresca', () => {
  const l7 = leitura(60, 5 * 24 * 60);
  const perto = avaliar({ leituras: { five_hour: null, seven_day: l7 }, previsao: { five_hour: null, seven_day: agora + 23 * H + 59 * MIN } });
  assert.deepEqual(perto.seven_day, { gatilho: 'G2', resets_at: l7.resets_at, dados: { quandoMs: agora + 23 * H + 59 * MIN } });
  assert.equal(avaliar({ leituras: { five_hour: null, seven_day: l7 }, previsao: { five_hour: null, seven_day: agora + 24 * H + MIN } }).seven_day, null);
  assert.equal(avaliar({ leituras: { five_hour: null, seven_day: leitura(60, 7200, false) }, previsao: { five_hour: null, seven_day: agora + H } }).seven_day, null);
});

test('G1: dentro de 90 min e com reset a pelo menos 15 min', () => {
  const l5 = leitura(70, 120);
  assert.equal(avaliar({ leituras: { five_hour: l5, seven_day: null }, previsao: { five_hour: agora + 89 * MIN, seven_day: null } }).five_hour.gatilho, 'G1');
  assert.equal(avaliar({ leituras: { five_hour: l5, seven_day: null }, previsao: { five_hour: agora + 91 * MIN, seven_day: null } }).five_hour, null);
  assert.equal(avaliar({ leituras: { five_hour: leitura(70, 14), seven_day: null }, previsao: { five_hour: agora + 5 * MIN, seven_day: null } }).five_hour, null);
});

test('teto vence projeção na mesma janela', () => {
  const d = avaliar({ leituras: { five_hour: null, seven_day: leitura(90, 3000) }, previsao: { five_hour: null, seven_day: agora + H } }).seven_day;
  assert.equal(d.gatilho, 'G4');
});

test('G7: o quinto despacho Fable em 5 h pede liberação; a trava cai quando um sai da janela', () => {
  const quatro = [agora - 4 * H, agora - 3 * H, agora - 2 * H, agora - H];
  const d = avaliar({ despachosFable: quatro })['fable-despachos'];
  assert.deepEqual(d, { gatilho: 'G7', resets_at: Math.ceil((agora - 4 * H + 5 * H) / 1000), dados: { n: 4, max: 4, horas: 5 } });
  assert.equal(avaliar({ despachosFable: quatro.slice(1) })['fable-despachos'], null);
  assert.equal(avaliar({ despachosFable: [agora - 6 * H, ...quatro.slice(1)] })['fable-despachos'], null);
});

test('G7 com max 0: todo despacho Fable pede liberação', () => {
  const d = avaliar({ config: { ...PADRAO_GUARDA, fableDespachosMax: 0 } })['fable-despachos'];
  assert.deepEqual(d, { gatilho: 'G7', resets_at: null, dados: { n: 0, max: 0, horas: 5 } });
});

test('G6: limite do Fable até o reset conhecido, senão até o reset de 7d, senão 7 dias', () => {
  assert.equal(avaliar({ limiteFable: { atMs: agora - H, resets_at: agoraS + 600 } }).fable.resets_at, agoraS + 600);
  assert.equal(avaliar({ limiteFable: { atMs: agora - H, resets_at: null }, leituras: { five_hour: null, seven_day: leitura(40, 3000) } }).fable.resets_at, agoraS + 3000 * 60);
  assert.equal(avaliar({ limiteFable: { atMs: agora - H, resets_at: null } }).fable.resets_at, Math.floor((agora - H) / 1000) + 7 * 86_400);
  assert.equal(avaliar({ limiteFable: { atMs: agora - 8 * 24 * H, resets_at: null } }).fable, null);
});

test('entrada hostil nunca lança e não dispara', () => {
  for (const o of [{ leituras: null }, { previsao: 'x' }, { config: null }, { agoraMs: NaN }, { despachosFable: 'x' }]) {
    const r = avaliar(o);
    assert.deepEqual(Object.values(r).filter(Boolean), []);
  }
});

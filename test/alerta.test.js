import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faixa5h, faixa7d, avaliarAlertas, ALERTAS_VAZIO } from '../src/alerta.js';

const H = 3600_000;
const reset7 = 1_800_000_000;
const inicio7 = reset7 * 1000 - 168 * H;
const agora = inicio7 + 84 * H; // esperado 50%
const reset5 = Math.floor(agora / 1000) + 2 * 3600;

test('faixa5h nos limiares', () => {
  assert.equal(faixa5h(69.9), 'ok');
  assert.equal(faixa5h(70), 'atencao');
  assert.equal(faixa5h(80), 'serializar');
  assert.equal(faixa5h(90), 'fechar');
  assert.equal(faixa5h(100), 'fechar');
});

test('faixa7d: só leitura vence o modo quando ≥90% e reset a mais de 24 h', () => {
  assert.equal(faixa7d({ usado: 90, resetsAt: reset7, agoraMs: agora }).faixa, 'so-leitura');
  const perto = reset7 * 1000 - 23 * H;
  assert.equal(faixa7d({ usado: 95, resetsAt: reset7, agoraMs: perto }).faixa, 'normal');
  assert.equal(faixa7d({ usado: 61, resetsAt: reset7, agoraMs: agora }).faixa, 'economico');
  assert.equal(faixa7d({ usado: 30, resetsAt: reset7, agoraMs: agora }).faixa, 'folga');
});

const limites = (p5, p7) => ({
  five_hour: { used_percentage: p5, resets_at: reset5 },
  seven_day: { used_percentage: p7, resets_at: reset7 },
});

test('primeira leitura normal não gera linha', () => {
  const r = avaliarAlertas({ limites: limites(10, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r.linhas, []);
  assert.equal(r.novos.five_hour.faixa, 'ok');
  assert.equal(r.novos.seven_day.faixa, 'normal');
});

test('subida de faixa gera uma linha e não repete', () => {
  const r1 = avaliarAlertas({ limites: limites(82, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.equal(r1.linhas.length, 1);
  assert.match(r1.linhas[0], /^5h em 82%: serializar/);
  const r2 = avaliarAlertas({ limites: limites(85, 50), anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r2.linhas, []);
});

test('descida de faixa é anunciada uma vez', () => {
  const r1 = avaliarAlertas({ limites: limites(82, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  const r2 = avaliarAlertas({ limites: limites(40, 50), anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.equal(r2.linhas.length, 1);
  assert.match(r2.linhas[0], /^5h voltou a 40%: faixa normal/);
});

test('janela nova zera o estado de alerta', () => {
  const r1 = avaliarAlertas({ limites: limites(82, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  const novaJanela = { ...limites(82, 50), five_hour: { used_percentage: 82, resets_at: reset5 + 5 * 3600 } };
  const r2 = avaliarAlertas({ limites: novaJanela, anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.equal(r2.linhas.length, 1);
});

test('modo econômico e folga geram as linhas da spec', () => {
  const eco = avaliarAlertas({ limites: limites(10, 61), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.match(eco.linhas[0], /^7d 61% vs 50% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação\.$/);
  const folga = avaliarAlertas({ limites: limites(10, 30), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.match(folga.linhas[0], /^7d 30% vs 50% esperado → modo folga: investir em qualidade/);
});

test('sem leitura avisa uma vez por sessão', () => {
  const r1 = avaliarAlertas({ limites: null, anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r1.linhas, ['Consumo sem leitura: rode /usage.']);
  const r2 = avaliarAlertas({ limites: null, anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r2.linhas, []);
  const r3 = avaliarAlertas({ limites: null, anteriores: r1.novos, sessionId: 's2', agoraMs: agora });
  assert.equal(r3.linhas.length, 1);
});

test('janela individual ausente é ignorada sem erro', () => {
  const r = avaliarAlertas({ limites: { five_hour: { used_percentage: 91, resets_at: reset5 } }, anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.equal(r.linhas.length, 1);
  assert.match(r.linhas[0], /^5h em 91%: fechar a tarefa em curso/);
});

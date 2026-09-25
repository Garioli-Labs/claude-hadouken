import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faixa5h, faixa7d, avaliarAlertas, ALERTAS_VAZIO } from '../src/alerta.js';
import { horaLocal, diaHora } from '../src/util.js';
import { calcularRitmo, LIMIAR_PONTOS } from '../src/ritmo.js';

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

const avaliar = (lim, anteriores = ALERTAS_VAZIO, sessionId = 's1', agoraMs = agora) =>
  avaliarAlertas({ limites: lim, anteriores, sessionId, agoraMs });

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

// --- Rodada de correção 1 -------------------------------------------------

// (a) descida em pt-BR, nunca o id interno
test('descida para atenção usa texto pt-BR com o reset', () => {
  const r1 = avaliar(limites(91, 50));
  const r2 = avaliar(limites(75, 50), r1.novos);
  assert.deepEqual(r2.linhas, [`5h voltou a 75%: faixa atenção (reset ${horaLocal(reset5)}).`]);
});

test('descida para serializar diz que ainda é para serializar', () => {
  const r1 = avaliar(limites(91, 50));
  const r2 = avaliar(limites(85, 50), r1.novos);
  assert.deepEqual(r2.linhas, ['5h voltou a 85%: ainda serializar — sem Workflow nem subagentes em paralelo.']);
});

// (b) janela nova suspende as restrições anteriores, uma vez
test('5h: janela nova neutra depois de faixa restritiva anuncia a suspensão', () => {
  const r1 = avaliar(limites(82, 50));
  const nova = { five_hour: { used_percentage: 10, resets_at: reset5 + 5 * 3600 } };
  const r2 = avaliar(nova, r1.novos);
  assert.deepEqual(r2.linhas, ['5h: janela nova em 10%, faixa normal — restrições anteriores suspensas.']);
  const r3 = avaliar(nova, r2.novos);
  assert.deepEqual(r3.linhas, []);
});

test('5h: janela nova neutra depois de faixa ok não gera linha', () => {
  const r1 = avaliar(limites(10, 50));
  const r2 = avaliar({ five_hour: { used_percentage: 5, resets_at: reset5 + 5 * 3600 } }, r1.novos);
  assert.deepEqual(r2.linhas, []);
});

test('7d: janela nova neutra depois de econômico anuncia a suspensão', () => {
  const r1 = avaliar(limites(10, 61));
  const reset7b = reset7 + 168 * 3600;
  const agoraB = reset7 * 1000 + 84 * H; // esperado 50% na janela nova
  const nova = { seven_day: { used_percentage: 50, resets_at: reset7b } };
  const r2 = avaliar(nova, r1.novos, 's1', agoraB);
  assert.deepEqual(r2.linhas, ['7d: janela nova, 50% vs 50% esperado → modo normal — restrições anteriores suspensas.']);
  const r3 = avaliar(nova, r2.novos, 's1', agoraB);
  assert.deepEqual(r3.linhas, []);
});

test('7d: janela nova neutra depois de só leitura anuncia a suspensão', () => {
  const r1 = avaliar(limites(10, 92));
  assert.equal(r1.novos.seven_day.faixa, 'so-leitura');
  const agoraB = reset7 * 1000 + 84 * H;
  const r2 = avaliar({ seven_day: { used_percentage: 45, resets_at: reset7 + 168 * 3600 } }, r1.novos, 's1', agoraB);
  assert.deepEqual(r2.linhas, ['7d: janela nova, 45% vs 50% esperado → modo normal — restrições anteriores suspensas.']);
});

test('7d: janela nova neutra depois de folga não gera linha', () => {
  const r1 = avaliar(limites(10, 30));
  const agoraB = reset7 * 1000 + 84 * H;
  const r2 = avaliar({ seven_day: { used_percentage: 50, resets_at: reset7 + 168 * 3600 } }, r1.novos, 's1', agoraB);
  assert.deepEqual(r2.linhas, []);
});

// (c) porcentagem exibida com piso
test('89.6% aparece como 89% na linha de serializar, nunca 90%', () => {
  const r = avaliar(limites(89.6, 50));
  assert.deepEqual(r.linhas, ['5h em 89%: serializar — sem Workflow nem subagentes em paralelo.']);
});

// (d) mesma janela com tolerância de 600 s
test('variação de 30 s no resets_at não reanuncia a faixa', () => {
  const r1 = avaliar(limites(82, 50));
  const jitter = { ...limites(82, 50), five_hour: { used_percentage: 82, resets_at: reset5 + 30 } };
  assert.deepEqual(avaliar(jitter, r1.novos).linhas, []);
  const jitter7 = { ...limites(10, 61), seven_day: { used_percentage: 61, resets_at: reset7 - 30 } };
  const e1 = avaliar(limites(10, 61));
  assert.deepEqual(avaliar(jitter7, e1.novos).linhas, []);
});

test('reset 5 h adiante é janela nova e reanuncia a faixa', () => {
  const r1 = avaliar(limites(82, 50));
  const nova = { ...limites(82, 50), five_hour: { used_percentage: 82, resets_at: reset5 + 5 * 3600 } };
  assert.deepEqual(avaliar(nova, r1.novos).linhas, ['5h em 82%: serializar — sem Workflow nem subagentes em paralelo.']);
});

// testes que faltavam
test('subida para atenção traz o horário do reset', () => {
  const r = avaliar(limites(72, 50));
  assert.deepEqual(r.linhas, [`5h em 72% (reset ${horaLocal(reset5)}): atenção ao ritmo.`]);
});

test('linha de só leitura traz dia e hora do reset', () => {
  const r = avaliar(limites(10, 92));
  assert.deepEqual(r.linhas, [`7d em 92% com reset em ${diaHora(reset7)}: só leitura; recomendar parar.`]);
});

test('7d: descida de econômico para normal na mesma janela', () => {
  const r1 = avaliar(limites(10, 61));
  const r2 = avaliar(limites(10, 55), r1.novos);
  assert.deepEqual(r2.linhas, ['7d 55% vs 50% esperado → modo normal.']);
});

test('anteriores null é aceito como estado vazio', () => {
  const r = avaliar(limites(82, 50), null);
  assert.deepEqual(r.linhas, ['5h em 82%: serializar — sem Workflow nem subagentes em paralelo.']);
  const s = avaliar(null, null);
  assert.deepEqual(s.linhas, ['Consumo sem leitura: rode /usage.']);
});

test('anteriores nunca é mutado', () => {
  const semLeitura = avaliar(null);
  const anteriores = { ...semLeitura.novos, five_hour: { resets_at: reset5, faixa: 'serializar' } };
  const copia = structuredClone(anteriores);
  avaliar(limites(40, 61), anteriores);
  avaliar(null, anteriores, 's2');
  avaliar({ five_hour: { used_percentage: 10, resets_at: reset5 + 5 * 3600 } }, anteriores);
  assert.deepEqual(anteriores, copia);
  assert.deepEqual(ALERTAS_VAZIO, { five_hour: null, seven_day: null, sem_leitura: {} });
});

// M-2 (revisao da Task 5): a faixa de 7d sai dos inteiros exibidos,
// floor(usado) - floor(esperado) contra +-10. Os mesmos numeros na tela nunca
// carregam faixas diferentes, e a distancia exibida nunca contradiz a faixa.
test('faixa7d: a faixa e funcao dos numeros exibidos (grade de 0,1 ponto)', () => {
  const vista = new Map();
  let casos = 0;
  for (let q = 0; q <= 168 * 4; q += 1) {
    const agoraMs = inicio7 + q * (H / 4);
    for (let d = 0; d <= 1000; d += 1) {
      const usado = d / 10;
      const r = faixa7d({ usado, resetsAt: reset7, agoraMs });
      const U = Math.floor(usado);
      const E = Math.floor(r.esperado);
      const distancia = U - E;
      const faixaNumeros = r.faixa === 'so-leitura' ? null : r.faixa;
      if (faixaNumeros !== null) {
        const esperada = distancia > 10 ? 'economico' : distancia < -10 ? 'folga' : 'normal';
        if (faixaNumeros !== esperada) assert.fail(`usado ${usado}, esperado ${r.esperado}: ${U}%/${E}% (distancia ${distancia}) virou ${faixaNumeros}`);
        const chave = `${U}/${E}`;
        const antes = vista.get(chave);
        if (antes !== undefined && antes !== faixaNumeros) assert.fail(`${chave} com duas faixas: ${antes} e ${faixaNumeros}`);
        vista.set(chave, faixaNumeros);
      }
      assert.equal(r.desvio, distancia);
      casos += 1;
    }
  }
  assert.equal(casos, 673 * 1001);
});

// N-5: uma regra so. calcularRitmo e faixa7d concordam em esperado, desvio e
// modo em toda a grade (fora da janela tambem); so-leitura e a unica faixa que
// faixa7d acrescenta ao modo.
test('N-5: calcularRitmo e faixa7d concordam em toda a grade', () => {
  let casos = 0;
  let soLeitura = 0;
  for (let q = -8; q <= 168 * 4 + 8; q += 1) {
    const agoraMs = inicio7 + q * (H / 4);
    for (let d = 0; d <= 1000; d += 1) {
      const usado = d / 10;
      const r = calcularRitmo({ usado7d: usado, resetsAt7d: reset7, agoraMs });
      const f = faixa7d({ usado, resetsAt: reset7, agoraMs });
      if (r.esperado !== f.esperado || r.desvio !== f.desvio || (f.faixa !== 'so-leitura' && f.faixa !== r.modo)) {
        assert.fail(`usado ${usado}, q ${q}: ritmo ${JSON.stringify(r)} x faixa7d ${JSON.stringify(f)}`);
      }
      if (r.desvio !== Math.floor(usado) - Math.floor(r.esperado)) assert.fail(`desvio fora da regra: usado ${usado}, q ${q}`);
      const modo = r.desvio > LIMIAR_PONTOS ? 'economico' : r.desvio < -LIMIAR_PONTOS ? 'folga' : 'normal';
      if (r.modo !== modo) assert.fail(`modo fora da regra: usado ${usado}, q ${q}`);
      if (f.faixa === 'so-leitura') soLeitura += 1;
      casos += 1;
    }
  }
  assert.equal(casos, 689 * 1001);
  assert.ok(soLeitura > 0, 'a grade passa por so-leitura');
});

test('faixa7d: os casos da revisao (esperado 50,4)', () => {
  const agoraMs = inicio7 + 0.504 * 168 * H;
  assert.equal(faixa7d({ usado: 0, resetsAt: reset7, agoraMs }).esperado, 50.4);
  const f = (usado) => faixa7d({ usado, resetsAt: reset7, agoraMs });
  assert.deepEqual([f(60.5).faixa, f(60.4).faixa, f(60.99).faixa], ['normal', 'normal', 'normal']);
  assert.deepEqual([f(61).faixa, f(61).desvio], ['economico', 11]);
  assert.deepEqual([f(40.3).faixa, f(40).faixa, f(39.99).faixa], ['normal', 'normal', 'folga']);
});

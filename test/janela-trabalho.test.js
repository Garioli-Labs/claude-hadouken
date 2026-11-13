import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DIAS, validarJanela, lerJanela, minutosUteis, avancarUteis } from '../src/janela.js';
import { calcularRitmo } from '../src/ritmo.js';
import { preverEstouro, REGRAS_JANELA, ritmo7dPorHora, ritmoMisturado, trabalhoDaProjecao } from '../src/previsao.js';
import { ALERTAS_VAZIO, avaliarAlertas } from '../src/alerta.js';
import { fraseEsgota } from '../src/uso/frase.js';
import { linhaEstado } from '../src/hooks/linha-estado.js';
import { estadoPainel } from '../src/uso/painel.js';
import { avaliarGuarda } from '../src/guarda/avaliar.js';
import { registrarSessao } from '../src/ativas.js';

// Tarefa 3 da v0.6.0 (spec §4 "Fatia 2", J1 a J6; RF5 do plano): com a chave
// `janela` no config.json, o % esperado de 7 dias e as projeções de 7 dias
// contam só minutos úteis. O limite de 5 h e a conta sem a chave não mudam
// (os testes existentes de ritmo e previsão seguem como estavam). Datas em
// hora local: nov/2026, dia 8 = domingo, 9 = segunda, 13 = sexta, 15 = domingo.
// A volta do horário de verão (J4) fica em janela-dst.test.js, que precisa de
// TZ próprio. O nome não é janela.test.js: esse já é o da janela do VS Code.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = (dia, h, m = 0) => new Date(2026, 10, dia, h, m).getTime();
const J = { dias: [1, 2, 3, 4, 5], inicioMin: 540, fimMin: 1260 };
const CFG = { dias: ['seg', 'ter', 'qua', 'qui', 'sex'], inicio: '09:00', fim: '21:00' };
const AVISO = 'janela inválida; usando 168 h';
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

const dirs = [];
const novoDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-janela-'));
  dirs.push(d);
  return d;
};
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const gravarConfig = (dir, valor) => fs.writeFileSync(path.join(dir, 'config.json'), typeof valor === 'string' ? valor : JSON.stringify(valor));

// Histórico de 13 pontos, um a cada 10 min, em linha reta de `de` a `ate`
// (porcentagem), terminando em `fimMs`: 2 h de cobertura e 10 pontos, o que o
// 7d exige (REGRAS_JANELA).
const serie = (fimMs, de, ate) => Array.from({ length: 13 }, (_, i) => ({
  at: iso(fimMs - (12 - i) * 10 * MIN), h5: null, d7: de + ((ate - de) * i) / 12,
}));

// --- validarJanela e lerJanela ----------------------------------------------

test('DIAS: domingo é 0', () => {
  assert.deepEqual(DIAS, ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']);
});

test('validarJanela: janela de seg a sex, 09:00 a 21:00', () => {
  assert.deepEqual(validarJanela(CFG), { janela: J, aviso: null });
});

test('validarJanela: aceita sáb e domingo, dia repetido uma vez só', () => {
  assert.deepEqual(validarJanela({ dias: ['sáb', 'sab', 'dom'], inicio: '08:30', fim: '18:00' }), {
    janela: { dias: [0, 6], inicioMin: 510, fimMin: 1080 }, aviso: null,
  });
});

test('validarJanela: ausente é sem janela e sem aviso', () => {
  assert.deepEqual(validarJanela(undefined), { janela: null, aviso: null });
});

test('validarJanela: valor inválido dá o aviso e nenhuma janela (J5 incluído)', () => {
  const invalidas = [
    { ...CFG, dias: [] },
    { ...CFG, dias: ['xyz'] },
    { ...CFG, dias: 'seg' },
    { ...CFG, inicio: '22:00', fim: '06:00' },
    { ...CFG, inicio: '09:00', fim: '09:00' },
    { ...CFG, inicio: '9h' },
    { ...CFG, fim: '25:00' },
    { ...CFG, fim: '24:00' },
    { ...CFG, fim: undefined },
    null, 'seg-sex', 42, [],
  ];
  for (const valor of invalidas) assert.deepEqual(validarJanela(valor), { janela: null, aviso: AVISO }, JSON.stringify(valor));
});

test('lerJanela: lê a chave janela do config.json', () => {
  const d = novoDir();
  gravarConfig(d, { guarda: { ligada: true }, janela: CFG });
  assert.deepEqual(lerJanela(d), { janela: J, aviso: null });
});

test('lerJanela: sem a chave, sem arquivo, arquivo quebrado ou pasta nula: sem janela e sem aviso', () => {
  const d = novoDir();
  assert.deepEqual(lerJanela(d), { janela: null, aviso: null });
  gravarConfig(d, { guarda: {} });
  assert.deepEqual(lerJanela(d), { janela: null, aviso: null });
  gravarConfig(d, '{quebrado');
  assert.deepEqual(lerJanela(d), { janela: null, aviso: null });
  assert.deepEqual(lerJanela(null), { janela: null, aviso: null });
});

test('lerJanela: chave presente e inválida dá o aviso', () => {
  const d = novoDir();
  gravarConfig(d, { janela: { ...CFG, dias: [] } });
  assert.deepEqual(lerJanela(d), { janela: null, aviso: AVISO });
});

// --- minutosUteis e avancarUteis --------------------------------------------

test('minutosUteis: sexta 20:00 a segunda 10:00 são 120 min', () => {
  assert.equal(minutosUteis(J, D(13, 20), D(16, 10)), 120);
});

test('minutosUteis: sem janela, os minutos corridos', () => {
  assert.equal(minutosUteis(null, D(13, 20), D(16, 10)), 62 * 60);
});

test('minutosUteis: intervalo vazio ou invertido, e fim de semana inteiro, dão 0', () => {
  assert.equal(minutosUteis(J, D(13, 12), D(13, 12)), 0);
  assert.equal(minutosUteis(J, D(13, 12), D(13, 10)), 0);
  assert.equal(minutosUteis(J, D(14, 0), D(15, 23)), 0);
});

test('minutosUteis: semana inteira soma 5 dias de 720 min', () => {
  assert.equal(minutosUteis(J, D(9, 0), D(16, 0)), 5 * 720);
});

test('avancarUteis: sexta 20:30 mais 60 min cai na segunda 09:30', () => {
  assert.equal(avancarUteis(J, D(13, 20, 30), 60), D(16, 9, 30));
});

test('J1: avancarUteis a partir de sábado 12:00 começa no próximo início de janela', () => {
  assert.equal(avancarUteis(J, D(14, 12), 30), D(16, 9, 30));
});

test('avancarUteis: dentro do dia soma o relógio; sem janela, os minutos corridos; zero fica onde está', () => {
  assert.equal(avancarUteis(J, D(9, 10), 90), D(9, 11, 30));
  assert.equal(avancarUteis(null, D(9, 10), 90), D(9, 11, 30));
  assert.equal(avancarUteis(J, D(9, 10), 0), D(9, 10));
});

test('avancarUteis atravessa dias e fim de semana; minutosUteis desfaz', () => {
  // Quarta 15:07: 353 min até 21:00, quinta e sexta 720 cada (1793), sobram 207 na segunda 09:00.
  const t0 = D(11, 15, 7);
  const t = avancarUteis(J, t0, 2000);
  assert.equal(t, D(16, 12, 27));
  assert.equal(Math.round(minutosUteis(J, t0, t)), 2000);
});

// --- ritmo -------------------------------------------------------------------

test('calcularRitmo com janela: segunda 21:00 → esperado 20% (720 de 3600 min úteis)', () => {
  const entrada = { usado7d: 30, resetsAt7d: D(15, 19) / 1000, agoraMs: D(9, 21) };
  assert.equal(calcularRitmo({ ...entrada, trabalho: J }).esperado, 20);
  // Sem janela, o valor de hoje: 26 h de 168 h.
  assert.equal(calcularRitmo(entrada).esperado, 15.5);
  assert.equal(calcularRitmo({ ...entrada, trabalho: null }).esperado, 15.5);
});

test('J3: calcularRitmo com o início da semana fora da janela → esperado 0', () => {
  const r = calcularRitmo({ usado7d: 30, resetsAt7d: D(15, 19) / 1000, agoraMs: D(8, 23), trabalho: J });
  assert.equal(r.esperado, 0);
});

test('calcularRitmo com janela: desvio e modo saem do esperado em minutos úteis', () => {
  const r = calcularRitmo({ usado7d: 40, resetsAt7d: D(15, 19) / 1000, agoraMs: D(9, 21), trabalho: J });
  assert.equal(r.desvio, 20);
  assert.equal(r.modo, 'economico');
});

// --- projeção do 7d (previsao.js) -------------------------------------------

const limites7d = (usado, resetMs) => ({ five_hour: null, seven_day: { used_percentage: usado, resets_at: resetMs / 1000 } });

test('preverEstouro com janela: +1% em 60 min, 95% na sexta 20:00 → segunda 13:00', () => {
  const agoraMs = D(13, 20);
  const historico = serie(agoraMs, 93, 95);
  const p = preverEstouro({ historico, limites: limites7d(95, D(17, 19)), agoraMs, perfil: null, trabalho: J });
  assert.equal(p.seven_day, D(16, 13));
  // Sem janela, a conta corrida de sempre: 300 min depois.
  assert.equal(preverEstouro({ historico, limites: limites7d(95, D(17, 19)), agoraMs }).seven_day, agoraMs + 300 * MIN);
});

test('preverEstouro com janela: o instante depois do reset é null', () => {
  const agoraMs = D(13, 20);
  const p = preverEstouro({ historico: serie(agoraMs, 93, 95), limites: limites7d(95, D(15, 19)), agoraMs, trabalho: J });
  assert.equal(p.seven_day, null);
});

// P-b: fora da janela com o uso subindo nas últimas 2 h, a projeção segue o
// relógio e o J3 não se aplica. O J3 vale quando a subida da amostra de 3 h
// ficou antes das últimas 2 h: sobe de `de` a `ate` na primeira hora e fica em
// `ate` depois.
const subiuSoNaPrimeiraHora = (fimMs, de, ate) => serieAte(fimMs, de, ate, 15 * MIN).map((p, i) => (i <= 4 ? { ...p, d7: de + ((ate - de) * i) / 4 } : { ...p, d7: ate }));

test('J3: preverEstouro com a amostra toda fora da janela → null (sem taxa)', () => {
  const agoraMs = D(8, 23);
  const historico = subiuSoNaPrimeiraHora(agoraMs, 40, 50);
  const limites = limites7d(50, D(15, 19));
  assert.ok(preverEstouro({ historico, limites, agoraMs }).seven_day !== null, 'sem janela há projeção');
  assert.equal(preverEstouro({ historico, limites, agoraMs, trabalho: J }).seven_day, null);
});

test('RF5: uso já em 100% ou taxa ≤ 0 → null, sem exceção', () => {
  const agoraMs = D(13, 20);
  assert.doesNotThrow(() => preverEstouro({ historico: serie(agoraMs, 99, 100), limites: limites7d(100, D(17, 19)), agoraMs, trabalho: J }));
  assert.equal(preverEstouro({ historico: serie(agoraMs, 99, 100), limites: limites7d(100, D(17, 19)), agoraMs, trabalho: J }).seven_day, null);
  assert.equal(preverEstouro({ historico: serie(agoraMs, 95, 93), limites: limites7d(93, D(17, 19)), agoraMs, trabalho: J }).seven_day, null);
  assert.equal(preverEstouro({ historico: serie(agoraMs, 95, 95), limites: limites7d(95, D(17, 19)), agoraMs, trabalho: J }).seven_day, null);
});

test('preverEstouro com janela não muda o limite de 5 h', () => {
  const agoraMs = D(13, 20);
  const historico = Array.from({ length: 5 }, (_, i) => ({ at: iso(agoraMs - (4 - i) * 5 * MIN), h5: 50 + i, d7: null }));
  const limites = { five_hour: { used_percentage: 54, resets_at: (agoraMs + 6 * 3_600_000) / 1000 }, seven_day: null };
  const sem = preverEstouro({ historico, limites, agoraMs }).five_hour;
  assert.ok(sem !== null);
  assert.equal(preverEstouro({ historico, limites, agoraMs, trabalho: J }).five_hour, sem);
});

// --- frase "esgota" (uso/frase.js) ------------------------------------------

const SETE_DIAS = 7 * 24 * 3_600_000;

test('fraseEsgota com janela: 70% na segunda 21:00 esgota amanhã à tarde (14:08), não de manhã', () => {
  // 720 min úteis decorridos; faltam 30 pontos a 70/720 por min: 309 min, ter 09:00 + 309 min.
  const base = { usado: 70, resetsAtMs: D(15, 19), janelaMs: SETE_DIAS, agoraMs: D(9, 21) };
  assert.match(fraseEsgota({ ...base, trabalho: J }), /^Nesse ritmo, esgota amanhã à tarde, antes do reinício /);
  assert.match(fraseEsgota(base), /^Nesse ritmo, esgota amanhã de manhã, antes do reinício /);
});

test('fraseEsgota com janela: 5% não esgota antes do reinício', () => {
  const f = fraseEsgota({ usado: 5, resetsAtMs: D(15, 19), janelaMs: SETE_DIAS, agoraMs: D(9, 21), trabalho: J });
  assert.match(f, /^Nesse ritmo, não esgota antes do reinício /);
});

test('J3: fraseEsgota com o início da semana fora da janela → null', () => {
  const base = { usado: 5, resetsAtMs: D(15, 19), janelaMs: SETE_DIAS, agoraMs: D(8, 23) };
  assert.equal(typeof fraseEsgota(base), 'string');
  assert.equal(fraseEsgota({ ...base, trabalho: J }), null);
});

test('fraseEsgota: a janela de trabalho só vale para 7 dias; limite atingido segue igual', () => {
  const cinco = { usado: 40, resetsAtMs: D(9, 23), janelaMs: 5 * 3_600_000, agoraMs: D(9, 21) };
  assert.equal(fraseEsgota({ ...cinco, trabalho: J }), fraseEsgota(cinco));
  const cheio = { usado: 100, resetsAtMs: D(15, 19), janelaMs: SETE_DIAS, agoraMs: D(9, 21) };
  assert.equal(fraseEsgota({ ...cheio, trabalho: J }), fraseEsgota(cheio));
});

// --- linha de estado do SessionStart e dica do painel -----------------------

test('linhaEstado: a cauda de 7d usa a janela de trabalho', () => {
  const agoraMs = D(9, 21);
  const leituras = {
    five_hour: { used_percentage: 10, resets_at: (agoraMs + 3_600_000) / 1000, fresca: true },
    seven_day: { used_percentage: 90, resets_at: D(15, 19) / 1000, fresca: true },
  };
  assert.match(linhaEstado(leituras, agoraMs, null, null, J), /; nesse ritmo, esgota amanhã de manhã\.$/);
  assert.match(linhaEstado(leituras, agoraMs, null), /; nesse ritmo, esgota por volta das 23:53\.$/);
});

function estadoDe(dir, agoraMs, { u7, historico = [] }) {
  const at = iso(agoraMs);
  fs.writeFileSync(path.join(dir, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 10, resets_at: (agoraMs + 3 * 3_600_000) / 1000, at },
    seven_day: { used_percentage: u7, resets_at: D(15, 19) / 1000, at },
    sessoes: {}, historico,
  }));
}

test('estadoPainel: a dica da semana usa a janela do config.json', () => {
  const agoraMs = D(9, 21);
  const d = novoDir();
  estadoDe(d, agoraMs, { u7: 90 });
  assert.match(estadoPainel({ dir: d, agoraMs }).dica, /esgota por volta das 23:53/);
  gravarConfig(d, { janela: CFG });
  const dica = estadoPainel({ dir: d, agoraMs }).dica;
  assert.match(dica, /esgota amanhã de manhã/);
  assert.doesNotMatch(dica, /23:53/);
});

// --- guarda (G2) -------------------------------------------------------------

test('guarda: a projeção G2 de 7 dias usa a janela do config.json', () => {
  const agoraMs = D(13, 20);
  const montar = () => {
    const d = novoDir();
    const at = iso(agoraMs);
    fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
      versao: 1, at,
      five_hour: { used_percentage: 20, resets_at: (agoraMs + 3 * 3_600_000) / 1000, at },
      seven_day: { used_percentage: 80, resets_at: D(17, 19) / 1000, at },
      sessoes: {}, historico: serie(agoraMs, 78, 80),
    }));
    return d;
  };
  // Sem janela: 20% a 1%/h = 20 h, dentro do horizonte de 24 h.
  const sem = montar();
  const gSem = avaliarGuarda({ dir: sem, agoraMs, sessionId: 's' });
  assert.deepEqual(gSem.ativas, ['seven_day']);
  assert.equal(gSem.motivos[0].gatilho, 'G2');
  // Com janela: 1200 min úteis a partir de sexta 20:00 é terça 16:00, 92 h depois.
  const com = montar();
  gravarConfig(com, { janela: CFG });
  const gCom = avaliarGuarda({ dir: com, agoraMs, sessionId: 's' });
  assert.deepEqual(gCom.ativas, []);
  assert.equal(gCom.status, 'armada');
});

// --- hooks (processo filho, relógio congelado) ------------------------------

function ambiente(home, extra = {}) {
  assert.ok(home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
  return {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1', CLAUDE_CONFIG_DIR: path.join(home, 'sem-config'), ...extra,
  };
}

function hook(nome, home, entrada, { agoraMs } = {}) {
  const args = [];
  const extra = {};
  if (agoraMs !== undefined) {
    args.push('--import', pathToFileURL(path.join(repo, 'test', 'fixtures', 'relogio-fixo.mjs')).href);
    extra.HADOUKEN_TESTE_AGORA_MS = String(agoraMs);
  }
  const r = spawnSync(process.execPath, [...args, path.join(repo, 'src', 'hooks', nome)], {
    input: JSON.stringify(entrada), env: ambiente(home, extra), encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const inicio = { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: '/tmp/x' };

test('história 19: SessionStart com janela inválida avisa "janela inválida; usando 168 h"', () => {
  const d = novoDir();
  gravarConfig(d, { janela: { dias: [] } });
  const saida = hook('session-start.js', d, inicio);
  assert.ok(saida.includes(AVISO), saida);
});

test('SessionStart com janela válida ou sem a chave: nenhum aviso', () => {
  const valida = novoDir();
  gravarConfig(valida, { janela: CFG });
  assert.ok(!hook('session-start.js', valida, inicio).includes('janela inválida'));
  assert.ok(!hook('session-start.js', novoDir(), inicio).includes('janela inválida'));
});

test('prompt-submit: o % esperado e o aviso de projeção de 7 dias usam a janela do config.json', () => {
  const agoraMs = D(13, 20);
  const montar = (config) => {
    const d = novoDir();
    const at = iso(agoraMs);
    fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
      versao: 1, at,
      five_hour: { used_percentage: 10, resets_at: (agoraMs + 3 * 3_600_000) / 1000, at },
      seven_day: { used_percentage: 80, resets_at: D(17, 19) / 1000, at },
      sessoes: {}, historico: serie(agoraMs, 78, 80),
    }));
    if (config !== undefined) gravarConfig(d, config);
    const antes = process.env.HADOUKEN_HOME;
    process.env.HADOUKEN_HOME = d;
    try { assert.ok(registrarSessao('s1', agoraMs).ok); } finally {
      if (antes === undefined) delete process.env.HADOUKEN_HOME;
      else process.env.HADOUKEN_HOME = antes;
    }
    return d;
  };
  const prompt = { session_id: 's1', hook_event_name: 'UserPromptSubmit', cwd: '/tmp/x', prompt: 'olá' };
  const textoDe = (saida) => JSON.parse(saida).hookSpecificOutput.additionalContext;

  const sem = textoDe(hook('prompt-submit.js', montar(), prompt, { agoraMs }));
  assert.match(sem, /7d 80% vs 43% esperado/);
  assert.match(sem, /7d chega a 100%/);

  const com = textoDe(hook('prompt-submit.js', montar({ janela: CFG }), prompt, { agoraMs }));
  assert.match(com, /7d 80% vs 61% esperado/);
  assert.doesNotMatch(com, /chega a 100%/);
});

// --- achados do revisor e do auditor da fatia 2 (F1, F2, F5) -----------------

// F1: a projeção de 7 dias com janela exige 2 h de minutos úteis na amostra
// (REGRAS_JANELA.seven_day.coberturaMinMs). Uma amostra quase toda fora da
// janela (a noite, o fim de semana) multiplicaria a taxa por Δt ÷ úteis e
// projetaria estouro a partir de poucos minutos de uso.
const serieAte = (fimMs, de, ate, passoMs) => Array.from({ length: 13 }, (_, i) => ({
  at: iso(fimMs - (12 - i) * passoMs), h5: null, d7: de + ((ate - de) * i) / 12,
}));

test('F1: 150 min de amostra, só 30 s úteis (segunda 09:00:30) → seven_day null', () => {
  const agoraMs = D(9, 9, 0) + 30_000;
  const historico = serieAte(agoraMs, 37, 40, 12.5 * MIN);
  assert.equal(preverEstouro({ historico, limites: limites7d(40, D(15, 19)), agoraMs, trabalho: J }).seven_day, null);
  // Sem janela a mesma série projeta.
  assert.ok(preverEstouro({ historico, limites: limites7d(40, D(15, 19)), agoraMs }).seven_day !== null);
});

test('F1: a mesma série em segunda 09:30 (30 min úteis) → seven_day null', () => {
  const agoraMs = D(9, 9, 30);
  const historico = serieAte(agoraMs, 37, 40, 12.5 * MIN);
  assert.equal(preverEstouro({ historico, limites: limites7d(40, D(15, 19)), agoraMs, trabalho: J }).seven_day, null);
});

test('F1: fronteira de 120 min úteis na amostra (119 → null, 120 → projeta)', () => {
  // Amostra de 3 h (o alcance do 7d) que começa às 08:00: úteis = agora − 09:00.
  const em = (h, m) => {
    const agoraMs = D(9, h, m);
    return preverEstouro({ historico: serieAte(agoraMs, 37, 40, 15 * MIN), limites: limites7d(40, D(15, 19)), agoraMs, trabalho: J }).seven_day;
  };
  assert.equal(em(10, 59), null);
  assert.ok(em(11, 0) !== null);
});

test('F1: amostra de terça 06:30 a 09:10 (10 min úteis) a 0,75 %/h → seven_day null', () => {
  const agoraMs = D(10, 9, 10);
  const historico = serieAte(agoraMs, 78, 80, (160 / 12) * MIN);
  assert.equal(preverEstouro({ historico, limites: limites7d(80, D(15, 19)), agoraMs, trabalho: J }).seven_day, null);
});

test('F1: a mesma amostra de terça não dispara G2 na guarda', () => {
  const agoraMs = D(10, 9, 10);
  const historico = serieAte(agoraMs, 78, 80, (160 / 12) * MIN);
  const montar = (config) => {
    const d = novoDir();
    const at = iso(agoraMs);
    fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
      versao: 1, at,
      five_hour: { used_percentage: 20, resets_at: (agoraMs + 3 * 3_600_000) / 1000, at },
      seven_day: { used_percentage: 80, resets_at: D(15, 19) / 1000, at },
      sessoes: {}, historico,
    }));
    if (config !== undefined) gravarConfig(d, config);
    return d;
  };
  const com = avaliarGuarda({ dir: montar({ janela: CFG }), agoraMs, sessionId: 's' });
  assert.deepEqual(com.ativas, []);
  assert.equal(com.status, 'armada');
});

// F2: a frase "esgota" com janela exige 120 min úteis decorridos (o mesmo
// valor de REGRAS_JANELA.seven_day.coberturaMinMs); sem janela, os 30 min de sempre.
test('F2: segunda 09:30 com 5% (30 min úteis) → sem frase com janela, com frase sem janela', () => {
  const base = { usado: 5, resetsAtMs: D(15, 19), janelaMs: SETE_DIAS, agoraMs: D(9, 9, 30) };
  assert.equal(fraseEsgota({ ...base, trabalho: J }), null);
  // Sem janela, 30 min decorridos desde o início corrido da semana já bastam.
  assert.equal(typeof fraseEsgota(base), 'string');
});

test('F2: fronteira de 119 vs 120 min úteis decorridos', () => {
  const base = { usado: 5, resetsAtMs: D(15, 19), janelaMs: SETE_DIAS, trabalho: J };
  assert.equal(fraseEsgota({ ...base, agoraMs: D(9, 10, 59) }), null);
  assert.match(fraseEsgota({ ...base, agoraMs: D(9, 11, 0) }), /^Nesse ritmo, /);
});

test('F2: o mínimo da frase com janela é o da projeção de 7 dias (uma constante)', () => {
  assert.equal(REGRAS_JANELA.seven_day.coberturaMinMs, 120 * MIN);
});

// F5: calcularRitmo depois do último minuto útil e com agora ≥ reset (o
// comportamento atual, fixado). O uso fora da janela conta como adiantamento:
// o esperado congela, então 12% às 09:30 de segunda já é econômico.
test('F5: calcularRitmo no sábado depois do último minuto útil → esperado 100', () => {
  const r = calcularRitmo({ usado7d: 60, resetsAt7d: D(15, 19) / 1000, agoraMs: D(14, 12), trabalho: J });
  assert.equal(r.esperado, 100);
});

test('F5: calcularRitmo com agora ≥ reset fica em 100 (sem passar disso)', () => {
  const resetsAt7d = D(15, 19) / 1000;
  assert.equal(calcularRitmo({ usado7d: 60, resetsAt7d, agoraMs: D(15, 19), trabalho: J }).esperado, 100);
  assert.equal(calcularRitmo({ usado7d: 60, resetsAt7d, agoraMs: D(16, 12), trabalho: J }).esperado, 100);
  assert.equal(calcularRitmo({ usado7d: 60, resetsAt7d, agoraMs: D(20, 12), trabalho: J }).esperado, 100);
});

test('F5: uso fora da janela conta como adiantamento: 12% às 09:30 de segunda é econômico', () => {
  const r = calcularRitmo({ usado7d: 12, resetsAt7d: D(15, 19) / 1000, agoraMs: D(9, 9, 30), trabalho: J });
  assert.equal(r.esperado, 0.8);
  assert.equal(r.modo, 'economico');
});

// --- A1: ritmo da linha econômica com janela (spec §4 Fatia 2, J7) -----------

test('A1: ritmo7dPorHora com janela é pontos por hora útil (segunda 11:30, 150 min úteis de 180)', () => {
  const agoraMs = D(9, 11, 30);
  const historico = serieAte(agoraMs, 10, 12, 15 * MIN);
  // Δuso 2 pontos em 180 min corridos, 150 úteis: 2 ÷ 150 × 60 = 0,8 pt/h útil.
  assert.ok(Math.abs(ritmo7dPorHora({ historico, agoraMs, trabalho: J }) - 0.8) < 1e-9);
  // Sem janela (ou null), a saída de hoje: 2 ÷ 180 × 60.
  assert.ok(Math.abs(ritmo7dPorHora({ historico, agoraMs }) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(ritmo7dPorHora({ historico, agoraMs, trabalho: null }) - 2 / 3) < 1e-9);
});

test('A1: ritmo7dPorHora com janela abaixo de 120 min úteis → null (J7)', () => {
  const agoraMs = D(9, 10, 30);
  const historico = serieAte(agoraMs, 10, 12, 15 * MIN);
  assert.equal(ritmo7dPorHora({ historico, agoraMs, trabalho: J }), null);
  assert.ok(ritmo7dPorHora({ historico, agoraMs }) !== null);
});

test('A1: ritmo7dPorHora com a amostra inteira fora da janela → null (J3)', () => {
  const agoraMs = D(14, 12);
  assert.equal(ritmo7dPorHora({ historico: subiuSoNaPrimeiraHora(agoraMs, 10, 12), agoraMs, trabalho: J }), null);
});

test('A1: ritmoMisturado com janela só mistura o perfil quando agora está dentro dela (R10)', () => {
  const perfil = { peso: 0.5, h5: new Array(24).fill(0), d7: new Array(24).fill(2) };
  // Dentro: 0,5 × 1 + 0,5 × 2.
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(9, 10), J), 1.5);
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(9, 9), J), 1.5, '09:00 já é dentro');
  // Fora (noite, 21:00 em ponto, fim de semana): b como veio.
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(9, 22), J), 1);
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(9, 21), J), 1, '21:00 já é fora');
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(14, 12), J), 1);
  // Sem janela: a mistura de hoje, em qualquer hora.
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(14, 12)), 1.5);
  assert.equal(ritmoMisturado(1, perfil, 'd7', D(14, 12), null), 1.5);
});

// --- A1: prompt-submit com a linha econômica por hora útil -------------------

test('A1: prompt-submit: o ritmo, o sustentável e o "acaba" da linha econômica usam a janela', () => {
  const agoraMs = D(13, 20);
  const montar = (config) => {
    const d = novoDir();
    const at = iso(agoraMs);
    fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
      versao: 1, at,
      five_hour: { used_percentage: 10, resets_at: (agoraMs + 3 * 3_600_000) / 1000, at },
      seven_day: { used_percentage: 80, resets_at: D(17, 19) / 1000, at },
      sessoes: {}, historico: serie(agoraMs, 78, 80),
    }));
    if (config !== undefined) gravarConfig(d, config);
    const antes = process.env.HADOUKEN_HOME;
    process.env.HADOUKEN_HOME = d;
    try { assert.ok(registrarSessao('s1', agoraMs).ok); } finally {
      if (antes === undefined) delete process.env.HADOUKEN_HOME;
      else process.env.HADOUKEN_HOME = antes;
    }
    return d;
  };
  const prompt = { session_id: 's1', hook_event_name: 'UserPromptSubmit', cwd: '/tmp/x', prompt: 'olá' };
  const textoDe = (saida) => JSON.parse(saida).hookSpecificOutput.additionalContext;

  // Sem janela: 1,0 pt/h, 20 pt restantes em 95 h corridas (0,2 pt/h), acaba 20 h depois (amanhã, sábado, 16:00).
  const sem = textoDe(hook('prompt-submit.js', montar(), prompt, { agoraMs }));
  assert.match(sem, /modo econômico/);
  assert.match(sem, /ritmo 1,0 pt\/h, sustentável 0,2 pt\/h; nesse ritmo acaba amanhã 16:00/);

  // Com janela: 23 h úteis até o reset (60 min de sexta, 720 de segunda, 600 de terça): 20 ÷ 23 = 0,9 pt/h;
  // 20 h úteis a 1 pt/h terminam na terça às 16:00.
  const com = textoDe(hook('prompt-submit.js', montar({ janela: CFG }), prompt, { agoraMs }));
  assert.match(com, /modo econômico/);
  assert.match(com, /ritmo 1,0 pt\/h, sustentável 0,9 pt\/h; nesse ritmo acaba ter 17\/11 16:00/);
});

// --- P-b: fora da janela com o consumo subindo, a projeção é de relógio -----
//
// Spec §8.2, P-b. Com janela configurada, agora FORA dela e a coluna de 7 dias
// subindo nas últimas 2 h de relógio (ao menos 2 pontos, último > primeiro),
// a projeção de 7 dias daquele momento (preverEstouro, ritmo7dPorHora, a parte
// de ritmo e a frase "esgota") trata `trabalho` como null: 168 h. O esperado e
// a faixa seguem com a janela. Dentro da janela, ou fora sem subida, J1 como
// antes. Exemplo da spec: sábado 13:00–16:00, 94,5 → 96 %, reset domingo 19:00.

const SAB_16 = D(14, 16);
const subindo = serieAte(SAB_16, 94.5, 96, 15 * MIN);
const parado = serieAte(SAB_16, 96, 96, 15 * MIN);
const RESET_DOM = D(15, 19);

test('P-b: trabalhoDaProjecao devolve a janela dentro dela e null sem janela', () => {
  assert.equal(trabalhoDaProjecao({ historico: subindo, agoraMs: SAB_16, trabalho: null }), null);
  assert.equal(trabalhoDaProjecao({ historico: subindo, agoraMs: SAB_16 }), null);
  // Segunda 10:00, dentro da janela: o consumo subindo não muda nada.
  const dentro = D(9, 10);
  assert.equal(trabalhoDaProjecao({ historico: serieAte(dentro, 10, 12, 15 * MIN), agoraMs: dentro, trabalho: J }), J);
  // 09:00 já é dentro; 21:00 já é fora.
  assert.equal(trabalhoDaProjecao({ historico: serieAte(D(9, 9), 10, 12, 15 * MIN), agoraMs: D(9, 9), trabalho: J }), J);
  assert.equal(trabalhoDaProjecao({ historico: serieAte(D(9, 21), 10, 12, 15 * MIN), agoraMs: D(9, 21), trabalho: J }), null);
});

test('P-b: fora da janela, sobe nas últimas 2 h → null (relógio); sem subir → a janela', () => {
  assert.equal(trabalhoDaProjecao({ historico: subindo, agoraMs: SAB_16, trabalho: J }), null);
  // Parado: o último não é maior que o primeiro.
  assert.equal(trabalhoDaProjecao({ historico: parado, agoraMs: SAB_16, trabalho: J }), J);
  // Caindo (troca de conta): idem.
  assert.equal(trabalhoDaProjecao({ historico: serieAte(SAB_16, 96, 94, 15 * MIN), agoraMs: SAB_16, trabalho: J }), J);
  // Sem histórico, ou histórico que não é lista.
  assert.equal(trabalhoDaProjecao({ historico: [], agoraMs: SAB_16, trabalho: J }), J);
  assert.equal(trabalhoDaProjecao({ historico: undefined, agoraMs: SAB_16, trabalho: J }), J);
});

test('P-b: a subida tem de estar nas últimas 2 h de relógio, com 2 pontos ou mais', () => {
  // Subiu antes das 14:00 e parou: nas últimas 2 h (14:00 a 16:00) não subiu.
  const subiuEParou = [
    { at: iso(D(14, 13)), h5: null, d7: 94 },
    ...[0, 30, 60, 90, 120].map((m) => ({ at: iso(D(14, 14) + m * MIN), h5: null, d7: 95 })),
  ];
  assert.equal(trabalhoDaProjecao({ historico: subiuEParou, agoraMs: SAB_16, trabalho: J }), J);
  // Um ponto só nas últimas 2 h.
  const umPonto = [{ at: iso(D(14, 13)), h5: null, d7: 94 }, { at: iso(D(14, 15, 59)), h5: null, d7: 96 }];
  assert.equal(trabalhoDaProjecao({ historico: umPonto, agoraMs: SAB_16, trabalho: J }), J);
  // Dois pontos subindo: basta.
  const doisPontos = [{ at: iso(D(14, 14, 30)), h5: null, d7: 95 }, { at: iso(D(14, 15, 59)), h5: null, d7: 96 }];
  assert.equal(trabalhoDaProjecao({ historico: doisPontos, agoraMs: SAB_16, trabalho: J }), null);
  // Ponto de d7 inválido não conta.
  const invalidos = [{ at: iso(D(14, 14, 30)), h5: null, d7: 'x' }, { at: iso(D(14, 15, 59)), h5: null, d7: 96 }];
  assert.equal(trabalhoDaProjecao({ historico: invalidos, agoraMs: SAB_16, trabalho: J }), J);
});

test('P-b: sábado 13:00–16:00 a 96 % e subindo → previsão de estouro em relógio de parede', () => {
  const limites = limites7d(96, RESET_DOM);
  const deRelogio = preverEstouro({ historico: subindo, limites, agoraMs: SAB_16, trabalho: null }).seven_day;
  // 0,5 pt/h, faltam 4 pt: 8 h depois, domingo 00:00.
  assert.equal(deRelogio, D(15, 0));
  // Com janela, a mesma série dá o mesmo instante (antes era null, J3).
  assert.equal(preverEstouro({ historico: subindo, limites, agoraMs: SAB_16, trabalho: J }).seven_day, deRelogio);
  // Sem subir, J1 como antes: sem taxa útil, sem previsão.
  assert.equal(preverEstouro({ historico: parado, limites, agoraMs: SAB_16, trabalho: J }).seven_day, null);
});

test('P-b: dentro da janela a projeção segue em horas úteis (J1)', () => {
  const agoraMs = D(13, 20);
  const historico = serie(agoraMs, 93, 95);
  assert.equal(preverEstouro({ historico, limites: limites7d(95, D(17, 19)), agoraMs, trabalho: J }).seven_day, D(16, 13));
});

test('P-b: ritmo7dPorHora fora da janela e subindo é pontos por hora de relógio', () => {
  // 1,5 pt em 180 min: 0,5 pt/h. Antes: null (sem minuto útil na amostra, J3).
  assert.ok(Math.abs(ritmo7dPorHora({ historico: subindo, agoraMs: SAB_16, trabalho: J }) - 0.5) < 1e-9);
  assert.equal(ritmo7dPorHora({ historico: parado, agoraMs: SAB_16, trabalho: J }), null);
});

test('P-b: linhaEstado (SessionStart): a cauda de 7 dias diz "esgota", não "não esgota"', () => {
  const leituras = {
    five_hour: { used_percentage: 10, resets_at: (SAB_16 + 3_600_000) / 1000, fresca: true },
    seven_day: { used_percentage: 96, resets_at: RESET_DOM / 1000, fresca: true },
  };
  const trabalhoProj = trabalhoDaProjecao({ historico: subindo, agoraMs: SAB_16, trabalho: J });
  assert.equal(trabalhoProj, null);
  // Só com a janela, a frase de antes.
  const antes = linhaEstado(leituras, SAB_16, null, null, J);
  assert.match(antes, /não esgota antes do reinício\.$/);
  assert.match(linhaEstado(leituras, SAB_16, null, null, J, trabalhoProj), /; nesse ritmo, esgota por volta das 21:52\.$/);
  // Sem o 6º argumento, vale a janela (os chamadores de antes).
  assert.equal(linhaEstado(leituras, SAB_16, null, null, J, undefined), antes);
});

test('P-b: avaliarAlertas: a parte de ritmo da linha econômica usa a projeção de relógio', () => {
  // Semana de terça 10, 19:00 a terça 17, 19:00: sábado 16:00 tem 38 h úteis de 60 (esperado 63 %); 80 % é econômico.
  const limites = {
    five_hour: { used_percentage: 10, resets_at: (SAB_16 + 3_600_000) / 1000 },
    seven_day: { used_percentage: 80, resets_at: D(17, 19) / 1000 },
  };
  const linha7 = (extra) => avaliarAlertas({
    limites, anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: SAB_16, ritmo7dH: 1 / 3, trabalho: J, ...extra,
  }).linhas.find((l) => l.startsWith('7d')) ?? '';
  // Relógio: 20 pt ÷ 75 h até o reset = 0,27 pt/h (0,3); a 0,33 pt/h acaba em 60 h, terça 04:00.
  assert.match(linha7({ trabalhoProjecao: null }), /modo econômico.*; ritmo 0,3 pt\/h, sustentável 0,3 pt\/h; nesse ritmo acaba ter 17\/11 04:00\.$/);
  // Sem `trabalhoProjecao`, vale a janela: 22 h úteis até o reset, 20 ÷ 22 = 0,9 pt/h.
  assert.match(linha7({}), /modo econômico.*; ritmo 0,3 pt\/h, sustentável 0,9 pt\/h; nesse ritmo não acaba antes do reset\.$/);
});

test('P-b: estadoPainel: a dica da semana usa a projeção de relógio', () => {
  const dicaCom = (historico) => {
    const d = novoDir();
    const at = iso(SAB_16);
    fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
      versao: 1, at,
      five_hour: { used_percentage: 10, resets_at: (SAB_16 + 3_600_000) / 1000, at },
      seven_day: { used_percentage: 96, resets_at: RESET_DOM / 1000, at },
      sessoes: {}, historico,
    }));
    gravarConfig(d, { janela: CFG });
    return estadoPainel({ dir: d, agoraMs: SAB_16 }).dica;
  };
  assert.match(dicaCom(subindo), /\*\*Semana \(todos os modelos\):\*\*[^\n]*esgota por volta das 21:52/);
  assert.match(dicaCom(parado), /\*\*Semana \(todos os modelos\):\*\*[^\n]*não esgota antes do reinício/);
});

test('P-b: guarda: G2 de 7 dias dispara fora da janela com o consumo subindo', () => {
  // 84 % a 1 pt/h: 16 h para 100 %, dentro do horizonte de 24 h, antes do reset (27 h). O teto G4 é 85 %.
  const montar = (historico) => {
    const d = novoDir();
    const at = iso(SAB_16);
    fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
      versao: 1, at,
      five_hour: { used_percentage: 20, resets_at: (SAB_16 + 3 * 3_600_000) / 1000, at },
      seven_day: { used_percentage: 84, resets_at: RESET_DOM / 1000, at },
      sessoes: {}, historico,
    }));
    gravarConfig(d, { janela: CFG });
    return d;
  };
  const sobe = avaliarGuarda({ dir: montar(serieAte(SAB_16, 81, 84, 15 * MIN)), agoraMs: SAB_16, sessionId: 's' });
  assert.deepEqual(sobe.ativas, ['seven_day']);
  assert.equal(sobe.motivos[0].gatilho, 'G2');
  assert.deepEqual(avaliarGuarda({ dir: montar(serieAte(SAB_16, 84, 84, 15 * MIN)), agoraMs: SAB_16, sessionId: 's' }).ativas, []);
});

test('P-b: prompt-submit fora da janela e subindo: a linha econômica traz o ritmo de relógio', () => {
  // Semana de terça 10, 19:00 a terça 17, 19:00: sábado 16:00 tem 38 h úteis de 60 (esperado 63 %); 80 % é econômico.
  const d = novoDir();
  const at = iso(SAB_16);
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 10, resets_at: (SAB_16 + 3 * 3_600_000) / 1000, at },
    seven_day: { used_percentage: 80, resets_at: D(17, 19) / 1000, at },
    sessoes: {}, historico: serieAte(SAB_16, 79, 80, 15 * MIN),
  }));
  gravarConfig(d, { janela: CFG });
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = d;
  try { assert.ok(registrarSessao('s1', SAB_16).ok); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
  const prompt = { session_id: 's1', hook_event_name: 'UserPromptSubmit', cwd: '/tmp/x', prompt: 'olá' };
  const texto = JSON.parse(hook('prompt-submit.js', d, prompt, { agoraMs: SAB_16 })).hookSpecificOutput.additionalContext;
  assert.match(texto, /7d 80% vs 63% esperado → modo econômico/, 'o esperado segue com a janela');
  // 0,3 pt/h de relógio; 20 pt em 75 h até o reset: 0,3 pt/h (com a janela seriam 0,9: 22 h úteis).
  assert.match(texto, /ritmo 0,3 pt\/h, sustentável 0,3 pt\/h; nesse ritmo acaba ter 17\/11 04:00/);
});

// --- achados do auditor do diff da 0.6.0 (C3, C4) ---------------------------

test('C3: P-b fora da janela com o uso subindo não mistura o perfil (R10): previsão igual à sem perfil', () => {
  const limites = limites7d(96, RESET_DOM);
  // Típico da hora local muito acima do ritmo atual (0,5 pt/h = 0,0083 pt/min): se entrasse, adiantaria o estouro.
  const perfil = { peso: 0.5, h5: new Array(24).fill(0), d7: new Array(24).fill(0.1) };
  const semPerfil = preverEstouro({ historico: subindo, limites, agoraMs: SAB_16, trabalho: J }).seven_day;
  assert.equal(semPerfil, D(15, 0), 'a projeção é de relógio (P-b)');
  assert.equal(preverEstouro({ historico: subindo, limites, agoraMs: SAB_16, trabalho: J, perfil }).seven_day, semPerfil);
  // Dentro da janela o perfil continua entrando (R10).
  const agoraMs = D(13, 20);
  const historico = serie(agoraMs, 93, 95);
  const dentro = (p) => preverEstouro({ historico, limites: limites7d(95, D(17, 19)), agoraMs, trabalho: J, perfil: p }).seven_day;
  assert.notEqual(dentro(perfil), dentro(null));
});

test('C4: trabalhoDaProjecao nunca lança: entrada inválida ou hostil devolve null ou o trabalho recebido', () => {
  assert.equal(trabalhoDaProjecao(null), null);
  assert.equal(trabalhoDaProjecao(undefined), null);
  assert.equal(trabalhoDaProjecao(42), null);
  assert.equal(trabalhoDaProjecao({ historico: 'texto', agoraMs: SAB_16, trabalho: J }), J);
  assert.equal(trabalhoDaProjecao({ historico: subindo, agoraMs: 'x', trabalho: J }), J);
  // Ponto do histórico com getter que lança: devolve o trabalho recebido.
  const hostil = [{ get at() { throw new Error('x'); }, h5: null, d7: 1 }];
  assert.doesNotThrow(() => trabalhoDaProjecao({ historico: hostil, agoraMs: SAB_16, trabalho: J }));
  assert.equal(trabalhoDaProjecao({ historico: hostil, agoraMs: SAB_16, trabalho: J }), J);
  // Opções com getter que lança: nada recebido, null.
  const opcoes = { agoraMs: SAB_16, trabalho: J, get historico() { throw new Error('x'); } };
  assert.equal(trabalhoDaProjecao(opcoes), null);
});

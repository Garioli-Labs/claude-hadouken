import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DIAS, validarJanela, lerJanela, minutosUteis, avancarUteis } from '../src/janela.js';
import { calcularRitmo } from '../src/ritmo.js';
import { preverEstouro, REGRAS_JANELA } from '../src/previsao.js';
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

test('J3: preverEstouro com a amostra toda fora da janela → null (sem taxa)', () => {
  const agoraMs = D(8, 23);
  const historico = serie(agoraMs, 40, 50);
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
  assert.match(linhaEstado(leituras, agoraMs, null, J), /; nesse ritmo, esgota amanhã de manhã\.$/);
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

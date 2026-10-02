import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ajustesVazios, gravarAjustes, gravarLigado, intervaloDoPainelMs } from '../src/aprendizado/registro.js';
import { preverEstouro, ritmoMisturado } from '../src/previsao.js';
import { ARQ_USO, estadoPainel, talvezAtualizar } from '../src/uso/painel.js';

// Os consumidores dos ajustes (spec aprendizado §4.3 e §11; R9, R10, R14):
// desligado, tudo como hoje; ligado, o painel usa as faixas e o intervalo
// aprendidos, e a previsão das linhas de alerta mistura o ritmo por hora. A
// guarda continua com a regressão pura. Pasta de dados temporária; nenhum
// `claude` de verdade (rodar falso).

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIN = 60_000;
const H = 60 * MIN;
const AGORA = new Date(2026, 8, 29, 17, 4).getTime();
// Perfil com horas ativas, mas não a de AGORA (17 h): só as 3 h, todo dia.
const SO_AS_3 = new Array(7).fill(1 << 3);
const iso = (ms) => new Date(ms).toISOString();
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// O opt-out do ambiente de quem roda os testes não pode mudar o resultado.
delete process.env.HADOUKEN_SEM_PAINEL;

function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk consumo ç '));
  tmps.push(d);
  return d;
}
function comAjustes(dir, vigentes, horasAtivas = [0, 0, 0, 0, 0, 0, 0]) {
  const aj = ajustesVazios();
  Object.assign(aj.vigentes, vigentes);
  aj.perfil.horasAtivas = horasAtivas;
  assert.equal(gravarAjustes(dir, aj).ok, true);
}
const ligar = (dir) => assert.equal(gravarLigado(dir, { chaves: {}, criouEnv: false }, AGORA).ok, true);
const desligar = (dir) => fs.rmSync(path.join(dir, 'otel'), { recursive: true, force: true });
function gravarUso(dir, pct5h, lidoMs = AGORA - 1000) {
  fs.writeFileSync(path.join(dir, ARQ_USO), JSON.stringify({
    versao: 1, lidoEm: iso(lidoMs),
    sessao: { pct: pct5h, resetsAtMs: AGORA + H }, semana: { pct: 10, resetsAtMs: AGORA + 72 * H }, modelos: { fable: { pct: 10, resetsAtMs: AGORA + 72 * H } },
    estado: { motivo: 'ok', em: iso(lidoMs) }, bloqueado: null,
  }));
}

test('R14: ligado, o nível do painel segue as faixas aprendidas; desligado, 75% e 90%', () => {
  const d = novoDir();
  comAjustes(d, { 'painel.amarelo': 70, 'painel.vermelho': 85 });
  for (const [pct, semAprendizado, comAprendizado] of [[69, 'ok', 'ok'], [72, 'ok', 'aviso'], [86, 'aviso', 'erro'], [91, 'erro', 'erro']]) {
    gravarUso(d, pct);
    desligar(d);
    assert.equal(estadoPainel({ dir: d, agoraMs: AGORA }).nivel, semAprendizado, `desligado ${pct}`);
    ligar(d);
    assert.equal(estadoPainel({ dir: d, agoraMs: AGORA }).nivel, comAprendizado, `ligado ${pct}`);
  }
});

test('R9: fora das horas ativas, o intervalo aprendido de 120 s segura a leitura por 115 s', async () => {
  const d = novoDir();
  const chamadas = [];
  const rodar = async () => {
    chamadas.push(1);
    return { ok: true, uso: { sessao: { pct: 25, resetsAtMs: AGORA + H }, semana: { pct: 41, resetsAtMs: AGORA + 72 * H }, modelos: { fable: { pct: 57, resetsAtMs: AGORA + 72 * H } } } };
  };
  const opcoes = { dir: d, agoraMs: AGORA, env: {}, rodar, memLivre: () => 8 * 1024 ** 3, estadoAtivo: () => true, achar: () => path.join(os.tmpdir(), 'nao-existe', 'claude.exe') };
  comAjustes(d, { 'painel.intervaloS': 120 }, SO_AS_3);
  ligar(d);
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: false, motivo: 'recente' });
  gravarUso(d, 25, AGORA - 115_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // Nas horas ativas (todas, aqui), vale o intervalo de hoje: 60 s não é recente.
  comAjustes(d, { 'painel.intervaloS': 120 }, new Array(7).fill(0xffffff));
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // Sem nenhuma hora ativa no perfil, não há "fora das horas ativas": 30 s.
  comAjustes(d, { 'painel.intervaloS': 120 });
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // Desligado, também.
  comAjustes(d, { 'painel.intervaloS': 120 }, SO_AS_3);
  desligar(d);
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // O comando manual (forcar) segue com o piso de 5 s.
  ligar(d);
  gravarUso(d, 25, AGORA - 6_000);
  assert.deepEqual(await talvezAtualizar({ ...opcoes, forcar: true }), { feito: true, motivo: 'ok' });
  assert.equal(chamadas.length, 5);
});

test('R9: intervalo aprendido com horasAtivas todas zeradas não vale (null); com uma hora ativa que não é a de agora, vale', () => {
  const d = novoDir();
  ligar(d);
  comAjustes(d, { 'painel.intervaloS': 120 });
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  comAjustes(d, { 'painel.intervaloS': 120 }, SO_AS_3);
  assert.equal(intervaloDoPainelMs(d, AGORA), 120_000);
});

test('R10: ritmoMisturado só mistura com peso em (0; 0,5], ritmo atual positivo e típico da hora > 0', () => {
  const tres = new Array(24).fill(3);
  const p = (peso, h5 = tres) => ({ peso, h5, d7: new Array(24).fill(null) });
  assert.equal(ritmoMisturado(1, p(0.5), 'h5', AGORA), 2);
  assert.ok(Math.abs(ritmoMisturado(1, p(0.1), 'h5', AGORA) - 1.2) < 1e-12);
  assert.equal(ritmoMisturado(1, p(0.5), 'd7', AGORA), 1, 'hora sem ritmo típico');
  const buraco = [...tres];
  buraco[new Date(AGORA).getHours()] = null;
  assert.equal(ritmoMisturado(1, p(0.5, buraco), 'h5', AGORA), 1);
  for (const b of [0, -1, null]) assert.equal(ritmoMisturado(b, p(0.5), 'h5', AGORA), b);
  for (const perfil of [null, undefined, 'x', p(0), p(0.6), p(Number.NaN), p('0.5'), p(0.5, [3]), p(0.5, new Array(24).fill(0))]) {
    assert.equal(ritmoMisturado(1, perfil, 'h5', AGORA), 1, JSON.stringify(perfil));
  }
});

test('R10: preverEstouro com perfil antecipa a previsão; sem perfil, igual a antes', () => {
  // 1 ponto por minuto de ritmo (10, 12 … 18 em 8 min), 18% usados, reset em 3 h.
  const historico = [-8, -6, -4, -2, 0].map((m, i) => ({ at: iso(AGORA + m * MIN), h5: 10 + 2 * i, d7: 40 }));
  const limites = { five_hour: { used_percentage: 18, resets_at: (AGORA + 3 * H) / 1000 }, seven_day: null };
  const perfil = { peso: 0.5, h5: new Array(24).fill(3), d7: new Array(24).fill(null) };
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA }).five_hour, AGORA + 82 * MIN);
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA, perfil: null }).five_hour, AGORA + 82 * MIN);
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA, perfil }).five_hour, AGORA + 41 * MIN);
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA, perfil }).seven_day, null);
});

test('R10: a guarda segue com a regressão pura; só o UserPromptSubmit passa o perfil', () => {
  const avaliar = fs.readFileSync(path.join(repo, 'src', 'guarda', 'avaliar.js'), 'utf8');
  const chamada = /preverEstouro\(\{[^}]*\}\)/.exec(avaliar);
  assert.ok(chamada, 'avaliar.js chama preverEstouro');
  assert.doesNotMatch(chamada[0], /perfil/);
  for (const nome of fs.readdirSync(path.join(repo, 'src', 'guarda'))) {
    if (!nome.endsWith('.js')) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(repo, 'src', 'guarda', nome), 'utf8'), /perfilDaPrevisao|ritmoMisturado/, nome);
  }
  const prompt = fs.readFileSync(path.join(repo, 'src', 'hooks', 'prompt-submit.js'), 'utf8');
  assert.match(prompt, /preverEstouro\(\{[^}]*\bperfil\b[^}]*\}\)/);
  assert.match(prompt, /perfilDaPrevisao/);
});

function hook(nome, home, entrada) {
  assert.ok(home.startsWith(os.tmpdir()));
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1',
    HADOUKEN_SETTINGS: path.join(home, 'settings.json'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
  };
  return spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', nome)], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 30_000 });
}

// Um UserPromptSubmit de verdade (processo filho) sobre o mesmo estado: 5h em
// 60% subindo 1 ponto por minuto (52, 54 … 60 em 8 min), reset em 1 h, e o
// ajustes.json com peso 0,5 e ritmo típico de 3 pontos por minuto em toda
// hora. O ajustes.json é gravado depois do SessionStart, cujo passo de
// aprendizado poderia refazer o perfil. Devolve as linhas de projeção
// injetadas e a faixa guardada em projecao.json.
function promptComHistorico(ligado) {
  const d = novoDir();
  const id = `consumo-${ligado ? 'ligado' : 'desligado'}`;
  const ss = hook('session-start.js', d, { session_id: id, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(ss.status, 0, ss.stderr);
  if (ligado) ligar(d);
  const aj = ajustesVazios();
  aj.vigentes['previsao.pesoPerfil'] = 0.5;
  aj.perfil.ritmoHora.h5 = new Array(24).fill(3);
  assert.equal(gravarAjustes(d, aj).ok, true);
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
    versao: 1, at: iso(agora),
    five_hour: { used_percentage: 60, resets_at: s + 3600 },
    seven_day: { used_percentage: 50, resets_at: s + 84 * 3600 },
    sessoes: {},
    historico: [[-8, 52], [-6, 54], [-4, 56], [-2, 58], [0, 60]].map(([m, v]) => ({ at: iso(agora + m * MIN), h5: v, d7: null })),
  }));
  const r = hook('prompt-submit.js', d, { session_id: id, hook_event_name: 'UserPromptSubmit', prompt: 'oi' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const texto = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const projecao = texto.split('\n').filter((l) => l.startsWith('hadouken: no ritmo atual'));
  const memoria = JSON.parse(fs.readFileSync(path.join(d, 'projecao.json'), 'utf8'));
  return { projecao, faixa: memoria[id]?.five_hour?.faixa };
}

test('§11 e R10: no UserPromptSubmit, o peso em vigor antecipa a linha de projeção; desligado, a de hoje', () => {
  // Desligado (o ajustes.json existe, mas não é lido): 1 pt/min, 100% em
  // ~40 min, faixa de 60 min.
  const sem = promptComHistorico(false);
  // Ligado: (1 − 0,5)·1 + 0,5·3 = 2 pt/min, 100% em ~20 min, faixa de 30 min.
  const com = promptComHistorico(true);
  assert.equal(sem.projecao.length, 1, JSON.stringify(sem));
  assert.equal(com.projecao.length, 1, JSON.stringify(com));
  assert.equal(sem.faixa, '60');
  assert.equal(com.faixa, '30');
  const hora = (linha) => /chega a 100% às (\d\d:\d\d),/.exec(linha)?.[1];
  assert.ok(hora(sem.projecao[0]) && hora(com.projecao[0]));
  assert.notEqual(hora(com.projecao[0]), hora(sem.projecao[0]));
  assert.notEqual(com.projecao[0], sem.projecao[0]);
});

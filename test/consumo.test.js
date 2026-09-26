import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reposDaConfig, repoDoOrigin, lerOrigin, gerarRelatorio, codigoErro, ARQ_CONFIG } from '../src/consumo.js';
import { AVISO_CONFIG, CLAUDE_RAIZ_RECUSADA, CLAUDE_SEM_TRANSCRIPTS, CLAUDE_SEM_RECENTES } from '../src/relatorio.js';
import { ARQ_ESTADO } from '../src/estado.js';

// Pipeline do /consumo (addendum da Task 10, B e D): config.json, origin do
// git, leitura do estado, índice de transcripts e GitHub em paralelo. Tudo em
// pastas temporárias; o gh é sempre um executor falso, nunca o de verdade.

let home, raiz;
const homeOriginal = process.env.HADOUKEN_HOME;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk consumo ç '));
  process.env.HADOUKEN_HOME = path.join(home, 'dados');
  fs.mkdirSync(process.env.HADOUKEN_HOME);
  raiz = path.join(home, 'projects');
});
afterEach(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(home, { recursive: true, force: true });
});

const agora = Date.now();
const DIA = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const arqConfig = () => path.join(process.env.HADOUKEN_HOME, ARQ_CONFIG);
const config = (texto) => fs.writeFileSync(arqConfig(), texto);
const linha = (req, { ts = agora - 1000, cwd = 'C:/Projetos DEV/Demo Proj', model = 'claude-opus-5' } = {}) => JSON.stringify({
  type: 'assistant', requestId: req, apiBlockIndex: 0, sessionId: 'sess-1', cwd,
  timestamp: iso(ts), effort: 'high', isSidechain: false,
  message: { id: `msg-${req}`, model, usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } },
});
const transcript = (rel, linhas) => {
  const arq = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, `${linhas.join('\n')}\n`);
  return arq;
};

// ------------------------------------------------------------ config.json

test('config.json ausente: sem repos e sem aviso (o origin decide)', () => {
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [] });
});

test('config.json válido: até 20 repos que passam na regex da Task 9', () => {
  config(JSON.stringify({ repos: ['Garioli-Labs/resonance-pro', 'o/r'] }));
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: ['Garioli-Labs/resonance-pro', 'o/r'], avisos: [] });
  config(`\u{FEFF}${JSON.stringify({ repos: [], outra: 1 })}`);
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: [], avisos: [] }, 'lista vazia é escolha do usuário; BOM aceito');
  const vinte = Array.from({ length: 20 }, (_, i) => `o/r${i}`);
  config(JSON.stringify({ repos: vinte }));
  assert.deepEqual(reposDaConfig(arqConfig()).repos, vinte);
});

test('malicioso: config.json fora do formato é ignorado inteiro, com o aviso fixo', () => {
  const casos = {
    proto: '{"__proto__": {"repos": ["evil/x"]}}',
    vinteEUm: JSON.stringify({ repos: Array.from({ length: 21 }, (_, i) => `o/r${i}`) }),
    naoTexto: JSON.stringify({ repos: ['o/r', 42] }),
    injecao: JSON.stringify({ repos: ['a/b; rm -rf ~'] }),
    caminho: JSON.stringify({ repos: ['../../etc/passwd'] }),
    string: JSON.stringify({ repos: 'o/r' }),
    lista: JSON.stringify([{ repos: ['o/r'] }]),
    quebrado: '{ "repos": [',
    grande: JSON.stringify({ repos: ['o/r'], lixo: 'x'.repeat(64 * 1024) }),
  };
  for (const [nome, texto] of Object.entries(casos)) {
    config(texto);
    assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [AVISO_CONFIG] }, nome);
  }
  assert.equal({}.repos, undefined, 'Object.prototype intocado');
  fs.rmSync(arqConfig());
  fs.mkdirSync(arqConfig());
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [AVISO_CONFIG] }, 'pasta no lugar do arquivo');
});

// ------------------------------------------------------------ origin

test('origin: só as três formas do github.com, depois a regex da Task 9', () => {
  const aceitos = {
    'https://github.com/o/r': 'o/r',
    'https://github.com/Garioli-Labs/claude-hadouken.git': 'Garioli-Labs/claude-hadouken',
    'git@github.com:o/r.git': 'o/r',
    'git@github.com:o/r.github.io': 'o/r.github.io',
    'ssh://git@github.com/o/r.git': 'o/r',
  };
  for (const [url, repo] of Object.entries(aceitos)) assert.equal(repoDoOrigin(url), repo, url);
  const recusados = [
    'https://evil.example/github.com/a/b',
    'https://github.com.evil.example/a/b',
    'http://github.com/a/b',
    'https://user:token@github.com/a/b',
    'https://github.com/a/b/',
    'https://github.com/a/b/c',
    'https://github.com/../b',
    'https://github.com/-a/b',
    'https://github.com/a/.git',
    'git@github.com:a/b\nhttps://github.com/c/d',
    'ssh://git@github.com:22/a/b',
    'git@evil.example:a/b',
    'file:///github.com/a/b',
    `https://github.com/a/${'b'.repeat(600)}`,
    '', null, 42,
  ];
  for (const url of recusados) assert.equal(repoDoOrigin(url), null, String(url));
});

const temGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('lerOrigin: repo git com origin do GitHub, pasta sem git e origin estranho', { skip: !temGit && 'git ausente' }, async () => {
  const repo = path.join(home, 'repo ç');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  assert.deepEqual(await lerOrigin(repo), ['o/r']);
  git('remote', 'set-url', 'origin', 'https://evil.example/github.com/a/b');
  assert.deepEqual(await lerOrigin(repo), []);
  const solta = path.join(home, 'solta');
  fs.mkdirSync(solta);
  assert.deepEqual(await lerOrigin(solta), []);
  assert.deepEqual(await lerOrigin(path.join(home, 'nao-existe')), []);
  assert.deepEqual(await lerOrigin(42), await lerOrigin(process.cwd()), 'cwd inválido usa o cwd do processo');
});

// ------------------------------------------------------------ gerarRelatorio

// Executor falso do gh: responde por endpoint e conta as chamadas.
function ghFalso(chamadas, respostas = {}) {
  return async (args) => {
    const ep = args[1];
    chamadas.push(ep);
    if (ep.includes('/actions/runs?')) {
      return { ok: true, stdout: JSON.stringify(respostas.runs ?? { total_count: 1, workflow_runs: [{ id: 101, created_at: iso(agora - 3_600_000), event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { private: true } }] }) };
    }
    if (ep.endsWith('/actions/cache/usage')) return { ok: true, stdout: JSON.stringify({ active_caches_size_in_bytes: 1024 }) };
    if (ep.includes('/jobs?')) {
      return { ok: true, stdout: JSON.stringify({ total_count: 1, jobs: [{ labels: ['ubuntu-latest'], started_at: iso(agora - 3_600_000), completed_at: iso(agora - 3_600_000 + 90_000) }] }) };
    }
    return { ok: false, motivo: 'HTTP 404' };
  };
}

function gravarEstado(extra = {}) {
  const s = Math.floor(agora / 1000);
  fs.writeFileSync(path.join(process.env.HADOUKEN_HOME, ARQ_ESTADO), JSON.stringify({
    versao: 1, at: iso(agora - 60_000),
    five_hour: { used_percentage: 42, resets_at: s + 3600 },
    seven_day: { used_percentage: 48, resets_at: s + 2 * 86_400 },
    sessoes: {}, ...extra,
  }));
}

test('gerarRelatorio junta estado, transcripts e GitHub num relatório versionado', async () => {
  gravarEstado();
  config(JSON.stringify({ repos: ['o/r'] }));
  transcript('proj-a/s1.jsonl', [linha('r1'), linha('r2', { model: 'claude-sonnet-5' })]);
  const chamadas = [];
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso(chamadas), raizTranscripts: raiz, cwd: home });
  assert.equal(r.ok, true);
  const rel = r.relatorio;
  assert.equal(rel.versao, 1);
  assert.equal(rel.limites.seven_day.used_percentage, 48);
  assert.equal(rel.claude.hoje.total.respostas, 2);
  assert.deepEqual(Object.keys(rel.claude.hoje.porProjeto), ['Demo Proj']);
  assert.equal(rel.claude.semana_origem, 'janela_7d');
  assert.equal(rel.claude.semana_desde, iso((Math.floor(agora / 1000) + 2 * 86_400) * 1000 - 7 * DIA));
  assert.equal(rel.claude.arquivos, 1);
  assert.equal(rel.github['o/r'].runs30.total, 1);
  assert.equal(rel.github['o/r'].minutos30.linux, 2);
  assert.equal(rel.github['o/r'].publico, false);
  assert.ok(chamadas.length >= 3 && chamadas.every((ep) => ep.startsWith('repos/o/r')), chamadas.join(' '));
  assert.deepEqual(rel.avisos, []);
});

test('a semana começa no início da janela de 7d: resposta anterior a ela fica de fora', async () => {
  gravarEstado();
  config(JSON.stringify({ repos: [] }));
  transcript('proj-a/s1.jsonl', [linha('dentro', { ts: agora - 2 * DIA }), linha('fora', { ts: agora - 6 * DIA })]);
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home });
  assert.equal(r.relatorio.claude.semana.total.respostas, 1, 'janela começou há 5 dias');
  assert.equal(r.relatorio.claude.hoje.total.respostas, 0);
});

test('sem leitura de 7d: a semana são os últimos 7 dias', async () => {
  config(JSON.stringify({ repos: [] }));
  transcript('proj-a/s1.jsonl', [linha('a', { ts: agora - 6 * DIA }), linha('b', { ts: agora - 8 * DIA })]);
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home });
  assert.equal(r.relatorio.claude.semana_origem, 'ultimos_7_dias');
  assert.equal(r.relatorio.claude.semana.total.respostas, 1);
  assert.equal(r.relatorio.limites, null);
});

test('config.json inválido: aviso fixo e o origin do cwd no lugar', { skip: !temGit && 'git ausente' }, async () => {
  config('{"repos": ["a/b; rm"]}');
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/r.git'], { cwd: repo });
  const chamadas = [];
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso(chamadas), raizTranscripts: raiz, cwd: repo });
  assert.deepEqual(r.relatorio.avisos, [AVISO_CONFIG]);
  assert.deepEqual(Object.keys(r.relatorio.github), ['o/r']);
  assert.ok(chamadas.every((ep) => !ep.includes('rm')));
});

test('transcripts: raiz ausente, raiz sem nada recente e raiz ligada (junção ou link) são motivos distintos', async (t) => {
  config(JSON.stringify({ repos: [] }));
  const gerar = async () => (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home })).relatorio.claude;
  assert.deepEqual(await gerar(), { indisponivel: CLAUDE_SEM_TRANSCRIPTS });
  const arq = transcript('proj-a/velho.jsonl', [linha('v', { ts: agora - 20 * DIA })]);
  const velho = new Date(agora - 20 * DIA);
  fs.utimesSync(arq, velho, velho);
  assert.deepEqual(await gerar(), { indisponivel: CLAUDE_SEM_RECENTES });
  // A raiz de verdade vira link para uma pasta com transcript recente: o
  // indexador recusa a raiz ligada (D11) e o relatório diz isso, nunca
  // "nenhum transcript".
  const alvo = path.join(home, 'alvo');
  fs.renameSync(raiz, alvo);
  fs.rmSync(raiz, { recursive: true, force: true });
  fs.writeFileSync(path.join(alvo, 'proj-a', 'novo.jsonl'), `${linha('n')}\n`);
  try {
    fs.symlinkSync(alvo, raiz, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    t.skip(`sem link: ${e.code}`);
    return;
  }
  assert.deepEqual(await gerar(), { indisponivel: CLAUDE_RAIZ_RECUSADA });
});

test('raiz padrão: <CLAUDE_CONFIG_DIR>/projects quando absoluto; senão ~/.claude/projects', async () => {
  config(JSON.stringify({ repos: [] }));
  const casa = path.join(home, 'casa');
  const cfg = path.join(home, 'cfg claude');
  const escrever = (dir, linhas) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 's.jsonl'), `${linhas.join('\n')}\n`);
  };
  escrever(path.join(cfg, 'projects', 'proj-a'), [linha('c1')]);
  escrever(path.join(casa, '.claude', 'projects', 'proj-b'), [linha('h1'), linha('h2')]);
  const nomes = ['CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE'];
  const salvo = Object.fromEntries(nomes.map((k) => [k, process.env[k]]));
  const respostas = async () => (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), cwd: home })).relatorio.claude.hoje.total.respostas;
  try {
    process.env.HOME = casa;
    process.env.USERPROFILE = casa;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    assert.equal(await respostas(), 1, 'CLAUDE_CONFIG_DIR absoluto');
    process.env.CLAUDE_CONFIG_DIR = path.join('relativo', 'cfg');
    assert.equal(await respostas(), 2, 'relativo: ignorado, vale a home');
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(await respostas(), 2, 'ausente: a home');
  } finally {
    for (const k of nomes) {
      if (salvo[k] === undefined) delete process.env[k];
      else process.env[k] = salvo[k];
    }
  }
});

test('o prazo do GitHub chega ao coletor: gh que nunca responde vira tempo esgotado, e os transcripts saem', async () => {
  config(JSON.stringify({ repos: ['o/r'] }));
  transcript('proj-a/s1.jsonl', [linha('r1')]);
  const inicio = Date.now();
  const r = await gerarRelatorio({ agoraMs: agora, gh: () => new Promise(() => {}), raizTranscripts: raiz, cwd: home, prazoGithubMs: 300 });
  assert.ok(Date.now() - inicio < 5000, `${Date.now() - inicio} ms`);
  assert.deepEqual(r.relatorio.github['o/r'], { indisponivel: 'tempo esgotado' });
  assert.equal(r.relatorio.claude.hoje.total.respostas, 1);
});

test('GitHub e transcripts rodam em paralelo: o gh é chamado antes de o índice terminar', async () => {
  config(JSON.stringify({ repos: ['o/r'] }));
  for (let i = 0; i < 40; i++) transcript(`proj-${i}/s.jsonl`, [linha(`r${i}`)]);
  const abrir = fs.promises.open;
  let abertosAntesDoGh = null;
  let abertos = 0;
  fs.promises.open = async function (...a) { abertos++; return abrir.apply(this, a); };
  const gh = async (args) => {
    if (abertosAntesDoGh === null) abertosAntesDoGh = abertos;
    return ghFalso([])(args);
  };
  let r;
  try {
    r = await gerarRelatorio({ agoraMs: agora, gh, raizTranscripts: raiz, cwd: home });
  } finally {
    fs.promises.open = abrir;
  }
  assert.equal(r.relatorio.claude.arquivos, 40);
  assert.ok(abertosAntesDoGh !== null && abertosAntesDoGh < 40, `transcripts abertos antes do primeiro gh: ${abertosAntesDoGh}`);
});

test('codigoErro: só códigos da lista, senão desconhecido; nunca lança', () => {
  assert.equal(codigoErro(Object.assign(new Error('C:\\Users\\Fulano\\x'), { code: 'EACCES' })), 'EACCES');
  assert.equal(codigoErro(Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' })), 'ERR_MODULE_NOT_FOUND');
  assert.equal(codigoErro(new Error('C:\\Users\\Fulano\\segredo.json')), 'desconhecido');
  assert.equal(codigoErro(Object.assign(new Error('x'), { code: 'C:\\x' })), 'desconhecido');
  assert.equal(codigoErro({ get code() { throw new Error('x'); } }), 'desconhecido');
  assert.equal(codigoErro(null), 'desconhecido');
  assert.equal(codigoErro('ENOENT'), 'desconhecido');
});

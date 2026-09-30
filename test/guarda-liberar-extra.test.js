import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import { ARQ_GUARDA } from '../src/guarda/travas.js';
import { ARQ_LIBERACAO } from '../src/guarda/liberacao.js';
import { ARQ_EVENTOS, DIR_MARCAS, lerEventos } from '../src/guarda/registros.js';
import { NAO_GRAVADO } from '../src/guarda/mensagens.js';

// Complementos do hook de /claude-hadouken:liberar (spec v0.4.0 §6 e §4.5;
// revisão da Task 13), fora de test/guarda-hooks.test.js. Mesmo arnês: cada
// hook num processo filho, com HADOUKEN_HOME e CLAUDE_CONFIG_DIR temporários,
// HADOUKEN_SEM_PAINEL=1 e CLAUDE_EFFORT, CLAUDE_CODE_SUBAGENT_MODEL e
// CLAUDE_CODE_ENTRYPOINT do processo de teste fora do filho.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = path.join(repo, 'src', 'hooks', 'liberar.js');

const homes = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk liberar ç '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg'), { recursive: true });
  return d;
}
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function conferirHome(home) {
  assert.ok(typeof home === 'string' && path.isAbsolute(home), `HADOUKEN_HOME ausente: ${home}`);
  assert.ok(home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
}

function ambiente(home, extra = {}) {
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'),
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_EFFORT: undefined, CLAUDE_CODE_SUBAGENT_MODEL: undefined, CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  conferirHome(env.HADOUKEN_HOME);
  return env;
}

function rodar(entrada, home, extra = {}, argsNode = []) {
  return spawnSync(process.execPath, [...argsNode, script], {
    input: JSON.stringify(entrada), env: ambiente(home, extra), encoding: 'utf8', timeout: 15_000,
  });
}

function registrar(home, id) {
  conferirHome(home);
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try { registrarSessao(id, Date.now()); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
}

function gravarEstado(home, u7) {
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const at = new Date(agora).toISOString();
  fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 20, resets_at: s + 3 * 3600, at },
    seven_day: { used_percentage: u7, resets_at: s + 4 * 86_400, at },
    sessoes: {}, historico: [],
  }));
}

// Saída JSON de um hook: código 0, stderr vazio, um JSON só.
function saida(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return JSON.parse(r.stdout);
}

const expansao = (id, args, extra = {}) => ({
  session_id: id, hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
  command_name: 'claude-hadouken:liberar', command_args: args, command_source: 'plugin', prompt: `/claude-hadouken:liberar ${args}`, ...extra,
});
const eventos = (home, tipo) => lerEventos(home, Date.now()).filter((e) => e.tipo === tipo);

// Retrato da pasta: cada caminho relativo, com o conteúdo quando é arquivo.
function arvore(dir, base = dir) {
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p);
    if (e.isDirectory()) r.push([rel, null], ...arvore(p, base));
    else r.push([rel, fs.readFileSync(p, 'utf8')]);
  }
  return r;
}

test('foco 5: recusa de -p ou SDK grava só o evento, nem a marca de sessão', () => {
  for (const ep of ['sdk-cli', 'sdk-ts', 'sdk-py']) {
    const home = novoHome();
    registrar(home, 's1');
    gravarEstado(home, 86);
    fs.writeFileSync(path.join(home, ARQ_GUARDA), '{');
    const antes = arvore(home);
    const o = saida(rodar(expansao('s1', 'fable caro 24h'), home, { CLAUDE_CODE_ENTRYPOINT: ep }));
    assert.deepEqual(o, { decision: 'block', reason: 'hadouken: nada liberado. A liberação só vale digitada pelo usuário numa sessão interativa.' });
    assert.equal(fs.existsSync(path.join(home, DIR_MARCAS)), false, ep);
    const depois = arvore(home).filter(([rel]) => rel !== ARQ_EVENTOS);
    assert.deepEqual(depois, antes, ep);
    assert.deepEqual(lerEventos(home, Date.now()).map((e) => [e.tipo, e.detalhe]), [['liberacao-recusada', 'entrypoint']], ep);
  }
});

// §4.5: o import de mensagens.js que falha (aqui por um gancho de carga posto
// com --import: registerHooks no Node 22.15+/23.5+, register antes) ainda
// bloqueia com "nada liberado", pelo texto de reserva do hook, e registra o
// evento 'erro'. Se o gancho não rodasse, o 2h sairia liberado e o teste
// falharia.
test('import de mensagens.js que falha: bloqueia com o texto de reserva, registra erro e não libera', () => {
  const home = novoHome();
  registrar(home, 's1');
  gravarEstado(home, 86);
  fs.writeFileSync(path.join(home, ARQ_GUARDA), '{');
  const pasta = fs.mkdtempSync(path.join(home, 'ganchos '));
  const falhar = "if (url.endsWith('/src/guarda/mensagens.js')) throw new Error('falha simulada');";
  const ganchos = path.join(pasta, 'ganchos.mjs');
  fs.writeFileSync(ganchos, `export async function load(url, context, next) { ${falhar} return next(url, context); }\n`);
  const registrador = path.join(pasta, 'registrar.mjs');
  fs.writeFileSync(registrador, `import * as m from 'node:module';
if (typeof m.registerHooks === 'function') m.registerHooks({ load(url, context, next) { ${falhar} return next(url, context); } });
else m.register(${JSON.stringify(pathToFileURL(ganchos).href)});
`);
  const o = saida(rodar(expansao('s1', '2h'), home, {}, ['--import', pathToFileURL(registrador).href]));
  assert.deepEqual(o, { decision: 'block', reason: NAO_GRAVADO });
  assert.equal(fs.existsSync(path.join(home, ARQ_LIBERACAO)), false);
  assert.equal(fs.readFileSync(path.join(home, ARQ_GUARDA), 'utf8'), '{');
  assert.deepEqual(eventos(home, 'erro').map((e) => e.detalhe), ['liberar']);
  assert.equal(eventos(home, 'liberacao').length, 0);
});

// Resíduo declarado (revisão da Task 13): C23 só reescreve `cli` para
// `sdk-cli` no modo print. Um `claude -p` aberto do Bash de uma sessão do VS
// Code herda CLAUDE_CODE_ENTRYPOINT=claude-vscode, e este hook libera. Quem
// fecha o caminho é a regra da P4 na Task 16 (nega sempre o comando Bash ou
// PowerShell que chama claude com liberar); o spike da parte 2 procura um
// sinal melhor. Quando houver esse sinal, este teste passa a esperar a recusa.
test('resíduo: CLAUDE_CODE_ENTRYPOINT=claude-vscode não é recusado hoje (a P4 da Task 16 fecha o caminho)', () => {
  const home = novoHome();
  registrar(home, 's1');
  const o = saida(rodar(expansao('s1', '2h'), home, { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }));
  assert.match(o.reason, /^hadouken: liberado até /);
  const lib = JSON.parse(fs.readFileSync(path.join(home, ARQ_LIBERACAO), 'utf8'));
  assert.deepEqual(eventos(home, 'liberacao').map((e) => e.detalhe), [lib.id]);
  assert.equal(eventos(home, 'liberacao-recusada').length, 0);
});

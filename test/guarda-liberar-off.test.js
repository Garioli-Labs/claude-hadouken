import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARQ_CONFIG, lerConfigGuarda } from '../src/guarda/config.js';
import { lerEventos } from '../src/guarda/registros.js';
import { GUARDA_DESLIGADA, GUARDA_LIGADA, GUARDA_NAO_ALTERADA } from '../src/guarda/mensagens.js';

// /hadouken:liberar off | on (pedido do Sr. Garioli, v0.5.3): desliga e
// religa a guarda de consumo pelo mesmo comando digitado, com os mesmos
// portões (entrypoint e origem). Grava guarda.ligada no config.json e
// preserva o resto do arquivo; um config.json ilegível não é sobrescrito.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = path.join(repo, 'src', 'hooks', 'liberar.js');

const homes = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk off ç '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg'), { recursive: true });
  return d;
}
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function rodar(args, home, extra = {}) {
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'),
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra,
  };
  const entrada = {
    session_id: 's1', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
    command_name: 'hadouken:liberar', command_args: args, command_source: 'plugin', prompt: `/hadouken:liberar ${args}`,
  };
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return JSON.parse(r.stdout);
}

const config = (home) => JSON.parse(fs.readFileSync(path.join(home, ARQ_CONFIG), 'utf8'));
const eventos = (home) => lerEventos(home, Date.now()).filter((e) => e.tipo === 'guarda-ligada').map((e) => e.detalhe);

test('off desliga a guarda e on religa, sem config.json prévio', () => {
  const home = novoHome();
  assert.deepEqual(rodar('off', home), { decision: 'block', reason: GUARDA_DESLIGADA });
  assert.deepEqual(config(home), { guarda: { ligada: false } });
  assert.equal(lerConfigGuarda(home).config.ligada, false);
  assert.deepEqual(rodar(' ON ', home), { decision: 'block', reason: GUARDA_LIGADA });
  assert.equal(lerConfigGuarda(home).config.ligada, true);
  assert.deepEqual(eventos(home), ['off', 'on']);
});

test('off preserva os repos e os tetos do config.json', () => {
  const home = novoHome();
  fs.writeFileSync(path.join(home, ARQ_CONFIG), JSON.stringify({ repos: ['a/b'], guarda: { teto7d: 90 } }));
  rodar('off', home);
  assert.deepEqual(config(home), { repos: ['a/b'], guarda: { teto7d: 90, ligada: false } });
});

test('config.json ilegível não é sobrescrito', () => {
  const home = novoHome();
  fs.writeFileSync(path.join(home, ARQ_CONFIG), '{ quebrado');
  assert.deepEqual(rodar('off', home), { decision: 'block', reason: GUARDA_NAO_ALTERADA });
  assert.equal(fs.readFileSync(path.join(home, ARQ_CONFIG), 'utf8'), '{ quebrado');
});

test('off segue os portões: -p ou SDK não desliga', () => {
  const home = novoHome();
  const o = rodar('off', home, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
  assert.notEqual(o.reason, GUARDA_DESLIGADA);
  assert.equal(fs.existsSync(path.join(home, ARQ_CONFIG)), false);
});

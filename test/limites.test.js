import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerPedidoLimites } from '../src/config/pedido.js';

// /hadouken:limites (spec v0.5.3 VS Code §2.2). Mesmo arnês de
// test/guarda-liberar-extra.test.js: o hook num processo filho, com
// HADOUKEN_HOME e CLAUDE_CONFIG_DIR temporários, HADOUKEN_SEM_PAINEL=1 e
// CLAUDE_EFFORT, CLAUDE_CODE_SUBAGENT_MODEL e CLAUDE_CODE_ENTRYPOINT do
// processo de teste fora do filho.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = path.join(repo, 'src', 'hooks', 'limites.js');

const homes = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk limites ç '));
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

function rodar(entrada, home, extra = {}) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(entrada), env: ambiente(home, extra), encoding: 'utf8', timeout: 15_000,
  });
}

// Saída JSON de um hook: código 0, stderr vazio, um JSON só.
function saida(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return JSON.parse(r.stdout);
}

const expansao = (args, extra = {}) => ({
  session_id: 's1', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
  command_name: 'hadouken:limites', command_args: args, command_source: 'plugin', prompt: `/hadouken:limites ${args}`, ...extra,
});
const config = (home) => path.join(home, 'config.json');
function ligar(home, vigentes) {
  fs.mkdirSync(path.join(home, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'otel', 'ligado.json'), JSON.stringify({ v: 1, chaves: {}, criouEnv: false, em: new Date().toISOString() }));
  fs.writeFileSync(path.join(home, 'ajustes.json'), JSON.stringify({ v: 1, seq: 0, vigentes, registros: [], bloqueios: {}, perfil: {} }));
}

test('lerPedidoLimites: gramática fechada', () => {
  assert.deepEqual(lerPedidoLimites(''), { acao: 'mostrar' });
  assert.deepEqual(lerPedidoLimites('  '), { acao: 'mostrar' });
  assert.deepEqual(lerPedidoLimites('guarda.teto7d 80'), { acao: 'gravar', id: 'guarda.teto7d', valor: 80 });
  assert.deepEqual(lerPedidoLimites('barra.ctx.amarelo padrao'), { acao: 'padrao', id: 'barra.ctx.amarelo' });
  assert.deepEqual(lerPedidoLimites('padrao'), { acao: 'padrao-tudo' });
  assert.deepEqual(lerPedidoLimites('guarda.ligada desliga'), { acao: 'gravar', id: 'guarda.ligada', valor: false });
  assert.deepEqual(lerPedidoLimites('guarda.ligada liga'), { acao: 'gravar', id: 'guarda.ligada', valor: true });
  assert.deepEqual(lerPedidoLimites('guarda.perguntar desliga'), { acao: 'gravar', id: 'guarda.perguntar', valor: false });
  for (const ruim of [
    'aprendizado.ligado desliga', 'guarda.teto7d 80 x', 'guarda.teto7d -1', 'guarda.teto7d 1e3', '__proto__ 1',
    'guarda.teto7d\n80', 'guarda.teto7d', 'guarda.teto7d liga', 'guarda.ligada 1', 'roteamento.avisos desliga',
    'guarda.teto7d 12345', 'constructor 1',
  ]) assert.deepEqual(lerPedidoLimites(ruim), { acao: 'invalido' }, JSON.stringify(ruim));
  assert.deepEqual(lerPedidoLimites(undefined), { acao: 'invalido' });
});

test('mostrar: bloqueia e lista a tabela com o aperto do aprendizado', () => {
  const home = novoHome();
  fs.writeFileSync(config(home), JSON.stringify({ guarda: { teto7d: 90 } }));
  ligar(home, { 'guarda.teto7d': 80 });
  const s = saida(rodar(expansao(''), home));
  assert.equal(s.decision, 'block');
  assert.match(s.reason, /\| item \| atual \| padrão \| faixa \| aprendizado \|/);
  for (const id of ['guarda.teto7d', 'barra.ctx.amarelo', 'alertas.projecao7dH', 'guarda.ligada']) assert.ok(s.reason.includes(id), id);
  assert.ok(!s.reason.includes('aprendizado.ligado'));
  assert.ok(!s.reason.includes('roteamento.'));
  assert.match(s.reason, /guarda\.teto7d.*apertado pelo aprendizado/);
});

test('gravar guarda.teto7d 95 grava e diz que afrouxou o aperto', () => {
  const home = novoHome();
  fs.writeFileSync(config(home), JSON.stringify({ guarda: { teto7d: 85 } }));
  ligar(home, { 'guarda.teto7d': 80 });
  const s = saida(rodar(expansao('guarda.teto7d 95'), home));
  assert.equal(s.decision, 'block');
  assert.ok(s.reason.includes('Afrouxado: vale agora e desfaz o aperto do aprendizado neste item.'), s.reason);
  assert.equal(JSON.parse(fs.readFileSync(config(home), 'utf8')).guarda.teto7d, 95);
});

test('gravar sem aperto não fala do aprendizado; padrao remove a chave', () => {
  const home = novoHome();
  const s = saida(rodar(expansao('barra.ctx.amarelo 60'), home));
  assert.ok(!s.reason.includes('Afrouxado'));
  assert.deepEqual(JSON.parse(fs.readFileSync(config(home), 'utf8')), { barra: { ctx: { amarelo: 60 } } });
  saida(rodar(expansao('barra.ctx.amarelo padrao'), home));
  assert.deepEqual(JSON.parse(fs.readFileSync(config(home), 'utf8')), {});
});

test('fora da faixa: nada gravado, com o rótulo da tabela', () => {
  const home = novoHome();
  const s = saida(rodar(expansao('guarda.teto7d 5'), home));
  assert.equal(s.decision, 'block');
  assert.match(s.reason, /nada mudado/);
  assert.ok(!fs.existsSync(config(home)));
});

test('argumento inválido nunca volta no texto', () => {
  const home = novoHome();
  const r = rodar(expansao('<script>alert(1)</script>'), home);
  const s = saida(r);
  assert.equal(s.decision, 'block');
  assert.ok(!r.stdout.includes('<script>'));
  assert.ok(!r.stdout.includes('alert(1)'));
  assert.ok(!fs.existsSync(config(home)));
});

test('recusas: -p ou SDK, origem e expansão diferentes não gravam', () => {
  for (const [entrada, extra] of [
    [expansao('guarda.teto7d 95'), { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }],
    [expansao('guarda.teto7d 95', { command_source: 'skill_tool' }), {}],
    [expansao('guarda.teto7d 95', { command_source: undefined }), {}],
    [expansao('guarda.teto7d 95', { expansion_type: 'mcp_prompt' }), {}],
  ]) {
    const home = novoHome();
    const s = saida(rodar(entrada, home, extra));
    assert.equal(s.decision, 'block');
    assert.match(s.reason, /nada mudado/);
    assert.ok(!fs.existsSync(config(home)));
  }
});

test('outro comando: o hook não responde', () => {
  const home = novoHome();
  const r = rodar(expansao('', { command_name: 'hadouken:liberar' }), home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('skill e hooks.json', () => {
  const skill = fs.readFileSync(path.join(repo, 'skills', 'limites', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: limites\n/);
  assert.match(skill, /\ndisable-model-invocation: true\n/);
  const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
  const m = hooks.hooks.UserPromptExpansion.find((h) => h.matcher === 'hadouken:limites');
  assert.deepEqual(m.hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/hooks/limites.js'], timeout: 10 }]);
});

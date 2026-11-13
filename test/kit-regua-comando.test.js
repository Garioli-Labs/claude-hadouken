import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { envIsolado } from './kit-env-isolado.js';

// v0.6.0, Fatia 7, Tarefa 11 (spec §4 Fatia 7, bloco "Comando"; casos R6 e R7; plano
// RF8). /hadouken-kit:regua: sem argumento mostra a régua ativa; `editar` deixa a
// skill guiar; `aplicar` valida e grava o rascunho; `padrao` remove a régua do
// nível. Disco só em pasta temporária: HADOUKEN_HOME, CLAUDE_CONFIG_DIR,
// CLAUDE_PROJECT_DIR e TMPDIR de fixture, nunca o ~/.claude nem o $TMPDIR de quem roda.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOOK = path.join(repo, 'kit', 'hooks', 'regua-comando.js');
const comando = () => import(pathToFileURL(HOOK).href);

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hdk regua cmd ç ')));
  pastas.push(d);
  return d;
};
const gravar = (arquivo, conteudo) => {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
};
const lerJ = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const existe = (p) => fs.existsSync(p);

// Registro de plugins legível (o hadouken-kit e um plugin `bom` de fixture com
// as skills ok e tres e o agente ag, ambos ligados): o catálogo fica "lido" e o
// que ele não conhece conta como desconhecido.
function cfgComRegistro() {
  const cfg = novoTmp();
  const kit = 'hadouken-kit@claude-hadouken';
  const bom = path.join(novoTmp(), 'bom');
  gravar(path.join(bom, '.claude-plugin', 'plugin.json'), { name: 'bom' });
  for (const s of ['ok', 'tres']) gravar(path.join(bom, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: fixture\n---\n\ncorpo\n`);
  gravar(path.join(bom, 'agents', 'ag.md'), '---\nname: ag\ndescription: fixture\n---\n');
  gravar(path.join(cfg, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { [kit]: [{ scope: 'user', version: '1.2.0', installPath: null }], 'bom@mkt': [{ scope: 'user', version: '1.0.0', installPath: bom }] },
  });
  gravar(path.join(cfg, 'settings.json'), { enabledPlugins: { [kit]: true, 'bom@mkt': true } });
  return cfg;
}

// Ambiente de um comando: tudo em fixture.
function ambiente(extra = {}) {
  return {
    dirHadouken: novoTmp(), tmpDir: novoTmp(), cwd: novoTmp(),
    env: { CLAUDE_CONFIG_DIR: cfgComRegistro() }, ...extra,
  };
}
const entradaDe = (args, extra = {}) => ({
  session_id: 's1', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
  command_name: 'hadouken-kit:regua', command_args: args, command_source: 'plugin', ...extra,
});
async function decidir(args, ctx = ambiente(), extra = {}) {
  const { decidirRegua } = await comando();
  return { ctx, saida: decidirRegua(entradaDe(args, extra), ctx) };
}
const bloqueio = (saida) => {
  assert.ok(saida !== null && saida !== undefined, 'sem saída do hook');
  assert.equal(saida.decision, 'block');
  assert.equal(typeof saida.reason, 'string');
  return saida.reason;
};
// Pasta do rascunho (spec §4 Fatia 7): <tmp>/hadouken-<uid>/ no POSIX, <tmp>/hadouken/ sem uid (Windows).
const UID = typeof process.getuid === 'function' ? process.getuid() : null;
const pastaRascunhoDe = (tmpDir, uid = UID) => path.join(tmpDir, uid === null ? 'hadouken' : `hadouken-${uid}`);
const rascunhoDe = (tmpDir, uid = UID) => path.join(pastaRascunhoDe(tmpDir, uid), 'regua-rascunho.json');
// A pasta nasce 0700, como o `editar` a cria; o modo não depende do umask de quem roda.
function gravarRascunho(tmpDir, conteudo) {
  const pasta = pastaRascunhoDe(tmpDir);
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  fs.chmodSync(pasta, 0o700);
  fs.writeFileSync(rascunhoDe(tmpDir), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
}
// os.tmpdir() lê TMPDIR a cada chamada: o teste que usa o tmp padrão do hook aponta para uma pasta de fixture.
async function comTmpdir(fn) {
  const antes = process.env.TMPDIR;
  const tmp = novoTmp();
  process.env.TMPDIR = tmp;
  try { return await fn(tmp); } finally { if (antes === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = antes; }
}
const reguaDe = (fases, transversais = []) => ({ fases, transversais });

// ------------------------------------------------------------ sem argumento

test('sem argumento (padrão): reason com a origem e o texto da régua ativa', async () => {
  const { saida } = await decidir('');
  const reason = bloqueio(saida);
  assert.match(reason, /Régua \(padrão\):/);
  assert.match(reason, /Auditoria da spec/);
  assert.match(reason, /hadouken-kit:mutacao/);
});

test('sem argumento (global): lista os nomes desconhecidos que passaram pela regex; o nome fora da regex só conta', async () => {
  const ctx = ambiente();
  gravar(path.join(ctx.dirHadouken, 'regua.json'), reguaDe([
    { fase: 'Minha', usar: ['bom:ok', 'x:inexistente', 'bom ok'], agente: 'x:nao-existe' },
  ]));
  const reason = bloqueio((await decidir('', ctx)).saida);
  assert.match(reason, /Régua \(global\):/);
  assert.ok(reason.includes('x:inexistente'), reason);
  assert.ok(reason.includes('x:nao-existe'), reason);
  assert.ok(!reason.includes('bom ok'), reason);
  assert.match(reason, /1 item\(ns\) descartado\(s\)/);
});

test('sem argumento (repo): origem repo e a linha fixa do repo no lugar da sua', async () => {
  const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: novoTmp() } });
  gravar(path.join(ctx.env.CLAUDE_PROJECT_DIR, '.claude', 'hadouken.json'), { regua: reguaDe([{ fase: 'Do repo', usar: ['bom:ok'] }]) });
  const reason = bloqueio((await decidir('', ctx)).saida);
  assert.match(reason, /Régua \(repo\): Do repo → bom:ok/);
  assert.ok(reason.includes('a régua deste repositório (.claude/hadouken.json) vale no lugar da sua'), reason);
});

test('sem argumento: a régua inteira, sem o corte de 2 000 caracteres do SessionStart', async () => {
  const ctx = ambiente();
  const fases = Array.from({ length: 20 }, (_, i) => ({
    fase: `Fase ${i}`, usar: ['bom:ok'], alternativas: Array.from({ length: 12 }, () => ({ skill: 'bom:tres', quando: 'z'.repeat(110) })),
  }));
  gravar(path.join(ctx.dirHadouken, 'regua.json'), reguaDe(fases));
  const reason = bloqueio((await decidir('', ctx)).saida);
  assert.ok(reason.length > 2000, `reason de ${reason.length}`);
  assert.doesNotMatch(reason, /régua completa:/);
  assert.ok(reason.includes('Fase 19 →'), 'última fase ausente');
});

// ------------------------------------------------------------ editar e uso

// C6: o hook informa o caminho do rascunho; a doc de UserPromptExpansion aceita
// hookSpecificOutput.additionalContext sem `decision`, e o prompt segue para a skill.
test('editar → não bloqueia e informa o caminho absoluto do rascunho em additionalContext', async () => {
  for (const args of ['editar', '  editar  ']) {
    const ctx = ambiente();
    const { saida } = await decidir(args, ctx);
    assert.ok(saida !== null && saida !== undefined, 'sem saída do hook');
    assert.equal(Object.hasOwn(saida, 'decision'), false, 'editar não bloqueia');
    assert.equal(saida.hookSpecificOutput.hookEventName, 'UserPromptExpansion');
    const caminho = rascunhoDe(ctx.tmpDir);
    assert.ok(path.isAbsolute(caminho));
    assert.ok(saida.hookSpecificOutput.additionalContext.includes(caminho), saida.hookSpecificOutput.additionalContext);
  }
});

test('editar: sem tmpDir injetado, o caminho é o de os.tmpdir()/hadouken-<uid>/regua-rascunho.json', async () => {
  const { decidirRegua } = await comando();
  await comTmpdir((tmp) => {
    const saida = decidirRegua(entradaDe('editar'), { ...ambiente(), tmpDir: undefined });
    assert.ok(saida !== null, 'sem saída do hook');
    assert.ok(saida.hookSpecificOutput.additionalContext.includes(rascunhoDe(os.tmpdir())), saida.hookSpecificOutput.additionalContext);
    assert.ok(existe(pastaRascunhoDe(tmp)), 'o editar cria a pasta do rascunho');
  });
});

test('editar: portão e SDK continuam bloqueando', async () => {
  assert.match(bloqueio((await decidir('editar', ambiente(), { command_source: 'user' })).saida), /nada mudado/);
  assert.match(bloqueio((await decidir('editar', { ...ambiente(), env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } })).saida), /nada mudado/);
});

test('argumento desconhecido → nada mudado, sem eco do argumento', async () => {
  const ctx = ambiente();
  const reason = bloqueio((await decidir('apagar-tudo-xyz', ctx)).saida);
  assert.match(reason, /nada mudado/);
  assert.ok(!reason.includes('apagar-tudo-xyz'), reason);
  assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')));
  const mais = bloqueio((await decidir('aplicar --projeto extra', ctx)).saida);
  assert.match(mais, /nada mudado/);
  assert.ok(!mais.includes('extra'), mais);
});

test('portão: origem que não é o comando digitado, ou -p/SDK → nada mudado e nada gravado', async () => {
  const ctx = ambiente();
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  const agendado = bloqueio((await decidir('aplicar', ctx, { command_source: 'user' })).saida);
  assert.match(agendado, /nada mudado/);
  const sdk = bloqueio((await decidir('aplicar', { ...ctx, env: { ...ctx.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } })).saida);
  assert.match(sdk, /nada mudado/);
  assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')));
  assert.ok(existe(rascunhoDe(ctx.tmpDir)));
});

// ------------------------------------------------------------ aplicar

test('aplicar com rascunho válido → regua.json global igual ao rascunho, rascunho apagado, reason com o resumo', async () => {
  const ctx = ambiente();
  const rascunho = reguaDe(
    [{ fase: 'Ideia', usar: ['a:b'], alternativas: [{ skill: 'c:d', quando: 'sempre' }] }, { fase: 'Auditar', agente: 'hadouken:auditor' }],
    [{ skill: 'e:f', quando: 'bug' }],
  );
  gravarRascunho(ctx.tmpDir, rascunho);
  const reason = bloqueio((await decidir('aplicar', ctx)).saida);
  assert.deepEqual(lerJ(path.join(ctx.dirHadouken, 'regua.json')), rascunho);
  assert.ok(!existe(rascunhoDe(ctx.tmpDir)), 'rascunho não apagado');
  assert.match(reason, /régua aplicada/);
  assert.match(reason, /2 fases/);
  assert.match(reason, /global/);
});

test('aplicar saneia: só o item válido é gravado e a fase longa é cortada em 60; reason conta o descarte sem eco', async () => {
  const ctx = ambiente();
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'f'.repeat(300), usar: ['ok:a', 'x y'] }]));
  const reason = bloqueio((await decidir('aplicar', ctx)).saida);
  const gravado = lerJ(path.join(ctx.dirHadouken, 'regua.json'));
  assert.deepEqual(gravado.fases[0].usar, ['ok:a']);
  assert.equal(gravado.fases[0].fase.length, 60);
  assert.ok(reason.includes('1 item descartado'), reason);
  assert.ok(!reason.includes('x y'), reason);
});

test('aplicar --projeto: chave regua em <CLAUDE_PROJECT_DIR>/.claude/hadouken.json, outras chaves preservadas', async () => {
  const A = novoTmp();
  const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: A } });
  gravar(path.join(A, '.claude', 'hadouken.json'), { outra: { x: 1 }, regua: reguaDe([{ fase: 'Velha', usar: ['v:v'] }]) });
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'Nova', usar: ['n:n'] }]));
  const reason = bloqueio((await decidir('aplicar --projeto', ctx)).saida);
  const arq = lerJ(path.join(A, '.claude', 'hadouken.json'));
  assert.deepEqual(arq.outra, { x: 1 });
  assert.deepEqual(arq.regua, reguaDe([{ fase: 'Nova', usar: ['n:n'] }]));
  assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')), 'não grava a global');
  assert.ok(!existe(rascunhoDe(ctx.tmpDir)));
  assert.match(reason, /régua aplicada/);
  assert.doesNotMatch(reason, /sem repositório git/);
});

test('aplicar --projeto sem CLAUDE_PROJECT_DIR: cwd=<repo>/sub com .git em <repo> → grava em <repo>/.claude/hadouken.json', async () => {
  const dir = novoTmp();
  fs.mkdirSync(path.join(dir, '.git'));
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  const ctx = ambiente({ cwd: sub });
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  const reason = bloqueio((await decidir('aplicar --projeto', ctx)).saida);
  assert.deepEqual(lerJ(path.join(dir, '.claude', 'hadouken.json')).regua, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  assert.ok(!existe(path.join(sub, '.claude')));
  assert.doesNotMatch(reason, /sem repositório git/);
});

test('R7: aplicar --projeto sem CLAUDE_PROJECT_DIR e sem .git → grava em <cwd>/.claude/hadouken.json e avisa "sem repositório git"', async () => {
  const ctx = ambiente();
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  const reason = bloqueio((await decidir('aplicar --projeto', ctx)).saida);
  assert.deepEqual(lerJ(path.join(ctx.cwd, '.claude', 'hadouken.json')).regua, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  assert.ok(reason.includes('sem repositório git'), reason);
});

test('aplicar --projeto com hadouken.json ilegível → nada mudado e o arquivo fica como estava', async () => {
  const A = novoTmp();
  const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: A } });
  gravar(path.join(A, '.claude', 'hadouken.json'), '{ isto não é json');
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  const reason = bloqueio((await decidir('aplicar --projeto', ctx)).saida);
  assert.match(reason, /nada mudado/);
  assert.equal(fs.readFileSync(path.join(A, '.claude', 'hadouken.json'), 'utf8'), '{ isto não é json');
  assert.ok(existe(rascunhoDe(ctx.tmpDir)));
});

test('R6: aplicar sem rascunho → "sem rascunho; rode /hadouken-kit:regua editar"', async () => {
  const ctx = ambiente();
  const reason = bloqueio((await decidir('aplicar', ctx)).saida);
  assert.ok(reason.includes('sem rascunho; rode /hadouken-kit:regua editar'), reason);
  assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')));
});

test('rascunho inválido (JSON ilegível ou sem fase válida) → avisos, nada gravado, rascunho mantido', async () => {
  for (const conteudo of ['{ não é json', JSON.stringify(reguaDe([])), JSON.stringify(reguaDe([{ fase: 'F' }]))]) {
    const ctx = ambiente();
    gravarRascunho(ctx.tmpDir, conteudo);
    const reason = bloqueio((await decidir('aplicar', ctx)).saida);
    assert.match(reason, /nada mudado/, conteudo);
    assert.match(reason, /rascunho/, conteudo);
    assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')), conteudo);
    assert.equal(fs.readFileSync(rascunhoDe(ctx.tmpDir), 'utf8'), conteudo);
  }
});

// ------------------------------------------------------------ padrao

test('padrao → regua.json global apagado; sem ele, diz que já era a padrão', async () => {
  const ctx = ambiente();
  gravar(path.join(ctx.dirHadouken, 'regua.json'), reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  const reason = bloqueio((await decidir('padrao', ctx)).saida);
  assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')));
  assert.match(reason, /padrão/);
  assert.match(bloqueio((await decidir('padrao', ctx)).saida), /nada a remover/);
});

test('padrao --projeto → só a chave regua sai, na mesma raiz do aplicar --projeto', async () => {
  const dir = novoTmp();
  fs.mkdirSync(path.join(dir, '.git'));
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  const ctx = ambiente({ cwd: sub });
  gravar(path.join(dir, '.claude', 'hadouken.json'), { outra: 7, regua: reguaDe([{ fase: 'F', usar: ['a:b'] }]) });
  gravar(path.join(ctx.dirHadouken, 'regua.json'), reguaDe([{ fase: 'G', usar: ['c:d'] }]));
  bloqueio((await decidir('padrao --projeto', ctx)).saida);
  assert.deepEqual(lerJ(path.join(dir, '.claude', 'hadouken.json')), { outra: 7 });
  assert.ok(existe(path.join(ctx.dirHadouken, 'regua.json')), 'a global não é tocada');
  assert.match(bloqueio((await decidir('padrao --projeto', ctx)).saida), /nada a remover/);
});

// ------------------------------------------------------------ gravarJson

test('gravarJson: grava por tmp + rename, cria a pasta, sem tmp sobrando; erro → {ok:false, motivo}', async () => {
  const { gravarJson } = await comando();
  const d = novoTmp();
  const arq = path.join(d, 'a', 'b.json');
  assert.deepEqual(gravarJson(arq, { x: [1] }), { ok: true });
  assert.deepEqual(lerJ(arq), { x: [1] });
  assert.deepEqual(fs.readdirSync(path.dirname(arq)), ['b.json']);
  const falha = gravarJson(path.join(arq, 'filho.json'), { x: 1 });
  assert.equal(falha.ok, false);
  assert.equal(typeof falha.motivo, 'string');
});

// ------------------------------------------------------------ o hook de ponta a ponta

function rodarHook(stdin, { tmp, hadouken, cfg, projeto }) {
  const env = envIsolado(novoTmp(), { TMPDIR: tmp, HADOUKEN_HOME: hadouken, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: projeto, CLAUDE_CODE_ENTRYPOINT: 'cli' });
  return spawnSync(process.execPath, [HOOK], { input: stdin, env, encoding: 'utf8', timeout: 15000 });
}

test('hook: stdin do UserPromptExpansion → decision:block; aplicar lê o rascunho em os.tmpdir()/hadouken; sai 0', () => {
  const fix = { tmp: novoTmp(), hadouken: novoTmp(), cfg: cfgComRegistro(), projeto: novoTmp() };
  gravarRascunho(fix.tmp, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
  const r = rodarHook(JSON.stringify(entradaDe('aplicar')), fix);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const saida = JSON.parse(r.stdout);
  assert.equal(saida.decision, 'block');
  assert.match(saida.reason, /régua aplicada/);
  assert.deepEqual(lerJ(path.join(fix.hadouken, 'regua.json')), reguaDe([{ fase: 'F', usar: ['a:b'] }]));
});

test('hook: editar → JSON sem `decision`, com o caminho do rascunho (TMPDIR do processo) em additionalContext; sai 0', () => {
  const fix = { tmp: novoTmp(), hadouken: novoTmp(), cfg: cfgComRegistro(), projeto: novoTmp() };
  const r = rodarHook(JSON.stringify(entradaDe('editar')), fix);
  assert.equal(r.status, 0, r.stderr);
  const saida = JSON.parse(r.stdout);
  assert.equal(Object.hasOwn(saida, 'decision'), false);
  assert.equal(saida.hookSpecificOutput.hookEventName, 'UserPromptExpansion');
  assert.ok(saida.hookSpecificOutput.additionalContext.includes(rascunhoDe(fix.tmp)), saida.hookSpecificOutput.additionalContext);
});

test('hook: outro comando e stdin ilegível → sem saída e código 0', () => {
  const fix = { tmp: novoTmp(), hadouken: novoTmp(), cfg: cfgComRegistro(), projeto: novoTmp() };
  for (const stdin of [JSON.stringify(entradaDe('', { command_name: 'hadouken:janela' })), '{ não é json', '']) {
    const r = rodarHook(stdin, fix);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', stdin);
  }
});

// ------------------------------------------------------------ fiação

test('hooks.json do kit: UserPromptExpansion hadouken-kit:regua → regua-comando.js, forma exec, timeout 10', () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, 'kit', 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(h.hooks.UserPromptExpansion, [
    { matcher: 'hadouken-kit:regua', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/regua-comando.js'], timeout: 10 }] },
  ]);
});

test('skill regua: name, só o usuário aciona; o rascunho vai para o caminho que o hook informa (os.tmpdir()), sem $TMPDIR no texto', async () => {
  const s = fs.readFileSync(path.join(repo, 'kit', 'skills', 'regua', 'SKILL.md'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(s)?.[1] ?? '';
  assert.match(fm, /^name: regua$/m);
  assert.match(fm, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(s, /TMPDIR/, 'o caminho vem do hook, não de uma variável que a skill adivinha');
  assert.match(s, /caminho (que o hook informou|informado pelo hook)/);
  assert.ok(s.includes('/hadouken-kit:regua aplicar'), 'lembra que nada vale até o aplicar');
  const { decidirRegua } = await comando();
  await comTmpdir(() => {
    const saida = decidirRegua(entradaDe('editar'), { ...ambiente(), tmpDir: undefined });
    assert.equal(saida.hookSpecificOutput.additionalContext.includes(rascunhoDe(os.tmpdir())), true);
  });
});

// ============================================================ revisão da fatia 7 (C2, T2, T3, T4)

// ------------------------------------------------------------ C2: tudo desconhecido → padrão, e a lista aparece

test('C2: régua do repo só com nomes desconhecidos → origem padrão, contagem no aviso e a lista no reason', async () => {
  const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: novoTmp() } });
  gravar(path.join(ctx.env.CLAUDE_PROJECT_DIR, '.claude', 'hadouken.json'), {
    regua: reguaDe([{ fase: 'F', usar: ['x:um', 'x:dois', 'com espaço'], agente: 'x:ag' }, { fase: 'G', agente: 'x:ag2' }]),
  });
  const reason = bloqueio((await decidir('', ctx)).saida);
  assert.match(reason, /^hadouken-kit: Régua \(padrão\): Ideia →/);
  assert.doesNotMatch(reason, /Régua \(repo\)/);
  assert.ok(!reason.includes('a régua deste repositório (.claude/hadouken.json) vale no lugar da sua'), reason);
  assert.match(reason, /2 skills desconhecidas e 2 agentes desconhecidos e 1 item\(ns\) descartado\(s\)/);
  assert.match(reason, /Skills desconhecidas[^\n]*: x:um, x:dois\./);
  assert.match(reason, /Agentes desconhecidos: x:ag, x:ag2\./);
  assert.ok(!reason.includes('com espaço'), reason);
});

// ------------------------------------------------------------ T2: só o slash_command digitado

test('T2: expansion_type mcp_prompt ou skill_tool → nada mudado, nada gravado e rascunho mantido', async () => {
  for (const tipo of ['mcp_prompt', 'skill_tool']) {
    const ctx = ambiente();
    gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'F', usar: ['a:b'] }]));
    const reason = bloqueio((await decidir('aplicar', ctx, { expansion_type: tipo })).saida);
    assert.match(reason, /nada mudado/, tipo);
    assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')), tipo);
    assert.ok(existe(rascunhoDe(ctx.tmpDir)), tipo);
    const editar = bloqueio((await decidir('editar', ctx, { expansion_type: tipo })).saida);
    assert.match(editar, /nada mudado/, tipo);
  }
});

// ------------------------------------------------------------ T3: catálogo sem registro → nada é desconhecido

// registro ilegível, e registro fora do v2 (lido:false). O kit só em escopo
// project já não é "sem registro" (R11): a validação roda igual.
const CFG_SEM_REGISTRO = {
  ilegivel: (cfg) => fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), '{ ilegível'),
  'plugins[id] que não é lista': (cfg) => {
    const arq = path.join(cfg, 'plugins', 'installed_plugins.json');
    const reg = lerJ(arq);
    reg.plugins['hadouken-kit@claude-hadouken'] = { scope: 'project' };
    gravar(arq, reg);
  },
};

test('T3: catálogo sem registro lido → o comando mostra a régua do usuário inteira, sem aviso nem lista de desconhecidos', async () => {
  for (const [rotulo, estragar] of Object.entries(CFG_SEM_REGISTRO)) {
    const cfg = cfgComRegistro();
    estragar(cfg);
    const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfg } });
    gravar(path.join(ctx.dirHadouken, 'regua.json'), reguaDe([{ fase: 'F', usar: ['x:de-plugin'], agente: 'x:ag' }]));
    const reason = bloqueio((await decidir('', ctx)).saida);
    assert.equal(reason, 'hadouken-kit: Régua (global): F → x:de-plugin · agente x:ag', rotulo);
  }
});

// ------------------------------------------------------------ T4: teto de tamanho e arquivo que não é regular

test('T4: rascunho acima de 4 MB (JSON válido) → "ilegível" e mantido; rascunho que é uma pasta → inseguro (não é arquivo regular, R13)', async () => {
  const grande = JSON.stringify({ ...reguaDe([{ fase: 'F', usar: ['a:b'] }]), enchimento: 'a'.repeat(5 * 1024 * 1024) });
  for (const [montar, esperado] of [[(tmp) => gravarRascunho(tmp, grande), /nada mudado.*rascunho ilegível/], [(tmp) => { fs.mkdirSync(rascunhoDe(tmp), { recursive: true }); fs.chmodSync(pastaRascunhoDe(tmp), 0o700); }, /rascunho inseguro em /]]) {
    const ctx = ambiente();
    montar(ctx.tmpDir);
    const reason = bloqueio((await decidir('aplicar', ctx)).saida);
    assert.match(reason, esperado);
    assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')));
    assert.ok(existe(rascunhoDe(ctx.tmpDir)), 'mantido');
  }
});

// ============================================================ A2: rascunho do usuário (R13) e resposta do aplicar

test('caminhoRascunho: <tmp>/hadouken-<uid>/regua-rascunho.json no POSIX; <tmp>/hadouken/ sem uid (Windows)', async () => {
  const { caminhoRascunho } = await comando();
  const tmp = novoTmp();
  assert.equal(caminhoRascunho(tmp, 501), path.join(tmp, 'hadouken-501', 'regua-rascunho.json'));
  assert.equal(caminhoRascunho(tmp, 0), path.join(tmp, 'hadouken-0', 'regua-rascunho.json'));
  assert.equal(caminhoRascunho(tmp, null), path.join(tmp, 'hadouken', 'regua-rascunho.json'));
  assert.equal(caminhoRascunho(tmp, undefined), path.join(tmp, 'hadouken', 'regua-rascunho.json'));
});

const POSIX = { skip: process.platform === 'win32' && 'sem uid, modo e link confiáveis no Windows' };

test('pastaRascunhoSegura: pasta real, do uid e sem escrita de grupo ou de outros; link, 0777 ou outro dono → false', POSIX, async () => {
  const { pastaRascunhoSegura } = await comando();
  const base = novoTmp();
  const boa = path.join(base, 'boa');
  fs.mkdirSync(boa, { mode: 0o700 });
  fs.chmodSync(boa, 0o700);
  assert.equal(pastaRascunhoSegura(boa, UID), true);
  assert.equal(pastaRascunhoSegura(boa, UID + 1), false, 'dono diferente (o teste passa outro uid; chown pede root)');
  const aberta = path.join(base, 'aberta');
  fs.mkdirSync(aberta);
  fs.chmodSync(aberta, 0o777);
  assert.equal(pastaRascunhoSegura(aberta, UID), false, '0777');
  const grupo = path.join(base, 'grupo');
  fs.mkdirSync(grupo);
  fs.chmodSync(grupo, 0o770);
  assert.equal(pastaRascunhoSegura(grupo, UID), false, 'escrita de grupo');
  const link = path.join(base, 'link');
  fs.symlinkSync(boa, link);
  assert.equal(pastaRascunhoSegura(link, UID), false, 'link para pasta boa');
  assert.equal(pastaRascunhoSegura(path.join(base, 'nao-existe'), UID), false);
  fs.writeFileSync(path.join(base, 'arquivo'), '');
  assert.equal(pastaRascunhoSegura(path.join(base, 'arquivo'), UID), false, 'não é pasta');
});

// Cada cenário monta a pasta insegura e confere que `editar` e `aplicar` recusam
// com a frase da spec e que nada é gravado (nem regua.json, nem hadouken.json do repo).
const INSEGUROS = [
  ['pasta que é link', (tmp) => { const alvo = novoTmp(); fs.chmodSync(alvo, 0o700); fs.symlinkSync(alvo, pastaRascunhoDe(tmp)); }],
  ['pasta com modo 0777', (tmp) => { fs.mkdirSync(pastaRascunhoDe(tmp)); fs.chmodSync(pastaRascunhoDe(tmp), 0o777); }],
  ['rascunho que é link', (tmp) => {
    gravarRascunho(tmp, '{}');
    const alvo = path.join(novoTmp(), 'de-outro.json');
    gravar(alvo, reguaDe([{ fase: 'Plantada', usar: ['bom:ok'] }]));
    fs.rmSync(rascunhoDe(tmp));
    fs.symlinkSync(alvo, rascunhoDe(tmp));
  }],
];
for (const [nome, montar] of INSEGUROS) {
  test(`R13: ${nome} → aplicar responde "rascunho inseguro em <pasta>" e nada é gravado${nome.startsWith('rascunho') ? '' : '; editar também'}`, POSIX, async () => {
    const pedidos = nome.startsWith('rascunho') ? ['aplicar', 'aplicar --projeto'] : ['editar', 'aplicar', 'aplicar --projeto'];
    for (const args of pedidos) {
      const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: novoTmp() } });
      montar(ctx.tmpDir);
      const reason = bloqueio((await decidir(args, ctx)).saida);
      assert.equal(reason, `hadouken-kit: rascunho inseguro em ${pastaRascunhoDe(ctx.tmpDir)}; apague a pasta e rode /hadouken-kit:regua editar.`, `${nome}: ${args}`);
      assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')), `${nome}: ${args}: regua.json gravado`);
      assert.ok(!existe(path.join(ctx.env.CLAUDE_PROJECT_DIR, '.claude', 'hadouken.json')), `${nome}: ${args}: hadouken.json gravado`);
    }
  });
}

test('R13: dono diferente (uid injetado, sem chown) → editar e aplicar recusam; rascunho e regua.json intactos', POSIX, async () => {
  const { decidirRegua } = await comando();
  const ctx = ambiente();
  // O hook de um usuário de uid UID+1 acha <tmp>/hadouken-<UID+1>/, que é de quem roda o teste (UID).
  const outro = UID + 1;
  fs.mkdirSync(pastaRascunhoDe(ctx.tmpDir, outro), { mode: 0o700 });
  fs.chmodSync(pastaRascunhoDe(ctx.tmpDir, outro), 0o700);
  fs.writeFileSync(rascunhoDe(ctx.tmpDir, outro), JSON.stringify(reguaDe([{ fase: 'F', usar: ['bom:ok'] }])));
  for (const args of ['editar', 'aplicar']) {
    const saida = decidirRegua(entradaDe(args), { ...ctx, uid: outro });
    assert.equal(bloqueio(saida), `hadouken-kit: rascunho inseguro em ${pastaRascunhoDe(ctx.tmpDir, outro)}; apague a pasta e rode /hadouken-kit:regua editar.`, args);
  }
  assert.ok(!existe(path.join(ctx.dirHadouken, 'regua.json')));
  assert.ok(existe(rascunhoDe(ctx.tmpDir, outro)), 'o rascunho fica onde está');
});

test('editar: cria a pasta do rascunho com modo 0700 e a recusa quando ela já existe com escrita de grupo', POSIX, async () => {
  const ctx = ambiente();
  const { saida } = await decidir('editar', ctx);
  assert.equal(Object.hasOwn(saida, 'decision'), false);
  assert.equal(fs.lstatSync(pastaRascunhoDe(ctx.tmpDir)).mode & 0o777, 0o700);
  fs.chmodSync(pastaRascunhoDe(ctx.tmpDir), 0o770);
  assert.match(bloqueio((await decidir('editar', ctx)).saida), /^hadouken-kit: rascunho inseguro em /);
});

test('aplicar com rascunho seguro: a resposta traz o texto da régua aplicada (sem corte) e o resumo', async () => {
  const ctx = ambiente();
  gravarRascunho(ctx.tmpDir, reguaDe([{ fase: 'Minha', usar: ['bom:ok'], alternativas: [{ skill: 'bom:tres', quando: 'sempre' }] }], [{ skill: 'bom:ok', quando: 'a qualquer hora' }]));
  const reason = bloqueio((await decidir('aplicar', ctx)).saida);
  assert.ok(reason.includes('Régua (global): Minha → bom:ok (alt.: bom:tres — sempre); Transversais: bom:ok — a qualquer hora'), reason);
  assert.match(reason, /1 fase e 1 transversal/);
  assert.ok(!existe(rascunhoDe(ctx.tmpDir)));
  const projeto = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: novoTmp() } });
  gravarRascunho(projeto.tmpDir, reguaDe([{ fase: 'Do time', usar: ['bom:ok'] }]));
  assert.ok(bloqueio((await decidir('aplicar --projeto', projeto)).saida).includes('Régua (repo): Do time → bom:ok'));
});

test('R12 no comando sem argumento: régua do repo só com nomes desconhecidos → a padrão; com global → a global; a lista dos desconhecidos fica', async () => {
  const ctx = ambiente({ env: { CLAUDE_CONFIG_DIR: cfgComRegistro(), CLAUDE_PROJECT_DIR: novoTmp() } });
  gravar(path.join(ctx.env.CLAUDE_PROJECT_DIR, '.claude', 'hadouken.json'), { regua: reguaDe([{ fase: 'DoTime', usar: ['outro:naotenho'] }]) });
  let reason = bloqueio((await decidir('', ctx)).saida);
  assert.match(reason, /Régua \(padrão\): Ideia →/);
  assert.ok(reason.includes('outro:naotenho'), reason);
  gravar(path.join(ctx.dirHadouken, 'regua.json'), reguaDe([{ fase: 'MinhaFase', usar: ['bom:ok'] }]));
  reason = bloqueio((await decidir('', ctx)).saida);
  assert.match(reason, /Régua \(global\): MinhaFase → bom:ok/);
  assert.ok(reason.includes('outro:naotenho'), reason);
  assert.match(reason, /1 skill desconhecida/);
  assert.ok(!reason.includes('vale no lugar da sua'), 'a do repo não vale: sem a linha do repo');
});

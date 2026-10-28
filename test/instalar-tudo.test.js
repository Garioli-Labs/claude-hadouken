import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarTudo, lerOpcoes, respostaSim, ARQ_DESLIGADO } from '../src/instalar-tudo.js';
import { ID_KIT, ID_REA } from '../src/instalar/claude-cli.js';
import { versaoDoPlugin } from '../src/painel/instalar-painel.js';
import { ARQ_DESLIGADO_USUARIO } from '../src/aprendizado/ligar.js';
import { instalarFalso, rodarFalso } from './dados/instalador/claude-falso.mjs';

// Instalador, passos 6 e 7 (spec v0.5.2). Tudo em pasta temporária: settings
// por HADOUKEN_SETTINGS, pasta de dados por HADOUKEN_HOME, CLAUDE_CONFIG_DIR
// no `ambiente`; o claude é o falso, o painel e o aprendizado são injetados.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AGORA = Date.parse('2026-10-15T12:00:00Z');
const ENV_ANTES = { HADOUKEN_HOME: process.env.HADOUKEN_HOME, HADOUKEN_SETTINGS: process.env.HADOUKEN_SETTINGS };
const pastas = [];
after(() => {
  for (const [k, v] of Object.entries(ENV_ANTES)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk tudo '));
  pastas.push(d);
  return d;
};

function cenario(settings) {
  const casa = novoTmp();
  const arq = path.join(casa, 'settings.json');
  if (settings !== undefined) fs.writeFileSync(arq, JSON.stringify(settings, null, 2));
  process.env.HADOUKEN_HOME = path.join(casa, 'hadouken');
  process.env.HADOUKEN_SETTINGS = arq;
  const estado = { plugins: [], log: [], raiz: casa };
  return { casa, arq, estado, rodar: rodarFalso(estado) };
}
// O painel falso grava instalado.json como o de verdade, para a segunda rodada.
async function painelBom({ dir, raizPlugin }) {
  fs.mkdirSync(path.join(dir, 'painel'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'painel', 'instalado.json'), JSON.stringify({ versao: versaoDoPlugin(raizPlugin), em: new Date(AGORA).toISOString() }));
  return { ok: true, motivo: 'ok' };
}
const naoPergunta = async () => assert.fail('não pergunta');
function rodarTudo(c, { argv = ['--sim', '--sem-extras'], deps = {}, ...resto } = {}) {
  return instalarTudo({
    opcoes: lerOpcoes(argv), rodar: c.rodar, versaoNode: '24.11.0', agoraMs: AGORA, ambiente: { CLAUDE_CONFIG_DIR: c.casa },
    perguntar: naoPergunta, escrever: () => {}, deps: { instalar: painelBom, aprendizado: aprendizadoFalso(), ...deps }, ...resto,
  });
}
const estados = (itens) => itens.map((i) => [i.nome, i.estado]);
const backups = (arq) => fs.readdirSync(path.dirname(arq)).filter((n) => n.startsWith(`${path.basename(arq)}.bak-hadouken-`)).sort();

test('lerOpcoes e respostaSim', () => {
  assert.deepEqual(lerOpcoes(['--sim', '--com-aprendizado', '--xyz']), { sim: true, substituirBarra: false, semExtras: false, comAprendizado: true, semAprender: false, desconhecidas: ['--xyz'] });
  assert.equal(lerOpcoes(['--sem-aprender']).semAprender, true);
  assert.equal(ARQ_DESLIGADO, ARQ_DESLIGADO_USUARIO);
  for (const s of ['s', 'S', 'sim', ' y ', 'yes']) assert.equal(respostaSim(s, false), true, s);
  for (const n of ['n', 'não', 'x']) assert.equal(respostaSim(n, true), false, n);
  assert.equal(respostaSim('', true), true);
  assert.equal(respostaSim('', false), false);
  assert.equal(respostaSim(null, true), false, 'sem tty é não');
});

test('instalação nova: cada item, na ordem, e os comandos do claude', async () => {
  const c = cenario();
  const itens = await rodarTudo(c);
  assert.deepEqual(estados(itens), [
    ['hadouken-kit', 'ok'], ['hadouken-rea', 'ok'], ['atualização automática', 'ok'], ['arquivos da barra', 'ok'],
    ['barra', 'ok'], ['item do VS Code', 'ok'], ['aprendizado', 'ok'],
  ]);
  assert.deepEqual(c.estado.log, [
    'plugin marketplace add anthropics/claude-plugins-official',
    'plugin list --json', `plugin install ${ID_KIT}`, 'plugin list --json',
    'plugin list --json', `plugin install ${ID_REA}`, 'plugin list --json', `plugin enable ${ID_REA}`, 'plugin list --json',
  ]);
  const s = JSON.parse(fs.readFileSync(c.arq, 'utf8'));
  assert.equal(s.extraKnownMarketplaces['claude-hadouken'].autoUpdate, true);
  assert.match(s.statusLine.command, /statusline\.mjs/);
});

test('segunda rodada: = em tudo, settings e backups intocados', async () => {
  const c = cenario({ theme: 'dark' });
  const aprendizado = aprendizadoFalso();
  await rodarTudo(c, { deps: { aprendizado } });
  const bytes = fs.readFileSync(c.arq);
  const bk = backups(c.arq);
  const itens = await rodarTudo(c, { deps: { aprendizado } });
  assert.deepEqual(estados(itens), [
    ['hadouken-kit', 'igual'], ['hadouken-rea', 'igual'], ['atualização automática', 'igual'], ['arquivos da barra', 'igual'],
    ['barra', 'igual'], ['item do VS Code', 'igual'], ['aprendizado', 'igual'],
  ]);
  assert.deepEqual(fs.readFileSync(c.arq), bytes);
  assert.deepEqual(backups(c.arq), bk);
});

test('atualização e barra no mesmo settings: dois backups, um por gravação', async () => {
  const c = cenario({ theme: 'dark' });
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'barra').estado, 'ok');
  assert.equal(backups(c.arq).length, 2);
});

test('outra barra: --sim não troca; --substituir-barra troca; a pergunta decide sem --sim', async () => {
  const outra = { statusLine: { type: 'command', command: 'outra' } };
  let c = cenario(outra);
  assert.deepEqual((await rodarTudo(c)).find((i) => i.nome === 'barra'), { nome: 'barra', estado: 'pulado', detalhe: 'outra barra; rode de novo com --substituir-barra' });
  assert.equal(JSON.parse(fs.readFileSync(c.arq, 'utf8')).statusLine.command, 'outra');
  c = cenario(outra);
  assert.equal((await rodarTudo(c, { argv: ['--sim', '--sem-extras', '--substituir-barra'] })).find((i) => i.nome === 'barra').estado, 'ok');
  assert.match(JSON.parse(fs.readFileSync(c.arq, 'utf8')).statusLine.command, /statusline\.mjs/);
  for (const [resposta, esperado] of [[true, 'ok'], [false, 'pulado']]) {
    c = cenario(outra);
    const perguntas = [];
    const perguntar = async (texto) => { perguntas.push(texto); return texto.includes('barra') ? resposta : false; };
    const itens = await rodarTudo(c, { argv: ['--sem-extras'], perguntar });
    assert.equal(itens.find((i) => i.nome === 'barra').estado, esperado);
    assert.ok(perguntas.some((t) => t.includes('[s/N]') && t.includes('barra')));
  }
});

test('kit antigo: as dependências novas chegam; cópia antiga sem a nova pronta fica ligada e a atualização é ✗', async () => {
  const antigas = { 'mattpocock-skills@mattpocock': true, 'poka-yoke@poka-yoke': true, 'fullstack-dev-skills@fullstack-dev-skills': true, 'ui-ux-pro-max@ui-ux-pro-max-skill': true };
  const c = cenario({ enabledPlugins: antigas });
  c.estado.plugins.push({ id: ID_KIT, version: '1.0.1', scope: 'user', enabled: true, installPath: `${c.casa}/hadouken-kit` });
  c.estado.semDeps = ['poka-yoke@claude-hadouken'];
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'hadouken-kit').detalhe, 'faltam dependências: poka-yoke');
  assert.deepEqual(itens.find((i) => i.nome === 'atualização automática'), {
    nome: 'atualização automática', estado: 'falhou', detalhe: 'ligada; 3 cópia(s) antiga(s) desligada(s); poka-yoke antigo continua ligado: falta o novo', conserto: `rode claude plugin install ${ID_KIT}`,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(c.arq, 'utf8')).enabledPlugins, { ...antigas, 'mattpocock-skills@mattpocock': false, 'fullstack-dev-skills@fullstack-dev-skills': false, 'ui-ux-pro-max@ui-ux-pro-max-skill': false });
  assert.ok(c.estado.plugins.some((x) => x.id === 'mattpocock-skills@claude-hadouken'), 'o install depois do update trouxe as novas');
});

test('REA com Node 20 fica desligado e pulado', async () => {
  const c = cenario();
  const itens = await rodarTudo(c, { versaoNode: '20.19.0' });
  assert.equal(itens.find((i) => i.nome === 'hadouken-rea').estado, 'pulado');
  assert.equal(c.estado.plugins.find((p) => p.id === ID_REA).enabled, false);
});

test('falha de um passo não derruba os seguintes, e o resumo sai com ✗', async () => {
  const c = cenario();
  c.estado.falhar = [`install ${ID_KIT}`];
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'hadouken-kit').estado, 'falhou');
  assert.equal(itens.length, 7);
  assert.equal(itens.find((i) => i.nome === 'barra').estado, 'ok');
  const lanca = cenario();
  const outros = await rodarTudo(lanca, { deps: { sincronizar: () => { throw new Error('x'); } } });
  assert.deepEqual(outros.find((i) => i.nome === 'arquivos da barra'), { nome: 'arquivos da barra', estado: 'falhou', detalhe: 'erro-interno', conserto: 'rode o comando de instalação de novo' });
  assert.equal(outros.find((i) => i.nome === 'barra').estado, 'ok');
});

test('item do VS Code: sem VS Code é pulado; HADOUKEN_SEM_PAINEL=1 nem tenta; outra falha é ✗', async () => {
  let c = cenario();
  let itens = await rodarTudo(c, { deps: { instalar: async () => ({ ok: false, motivo: 'sem-vscode' }) } });
  assert.equal(itens.find((i) => i.nome === 'item do VS Code').estado, 'pulado');
  c = cenario();
  itens = await rodarTudo(c, { ambiente: { CLAUDE_CONFIG_DIR: c.casa, HADOUKEN_SEM_PAINEL: '1' }, deps: { instalar: async () => assert.fail('não instala') } });
  assert.deepEqual(itens.find((i) => i.nome === 'item do VS Code'), { nome: 'item do VS Code', estado: 'pulado', detalhe: 'HADOUKEN_SEM_PAINEL=1' });
  c = cenario();
  itens = await rodarTudo(c, { deps: { instalar: async () => ({ ok: false, motivo: 'tempo' }) } });
  assert.deepEqual(itens.find((i) => i.nome === 'item do VS Code'), { nome: 'item do VS Code', estado: 'falhou', detalhe: 'tempo', conserto: 'rode node ~/.claude/hadouken/bin/cli.mjs painel instalar' });
});

test('atualização: marketplace registrado de outra fonte é pulado, settings intocado nessa chave', async () => {
  const c = cenario();
  fs.mkdirSync(path.join(c.casa, 'plugins'));
  fs.writeFileSync(path.join(c.casa, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'claude-hadouken': { source: { source: 'directory', path: 'C:/dev' } } }));
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'atualização automática').estado, 'pulado');
  assert.equal(JSON.parse(fs.readFileSync(c.arq, 'utf8')).extraKnownMarketplaces, undefined);
});

// ------------------------------------------------------------ aprendizado

// O falso guarda o "ligado" depois de um ligar que deu certo, para a
// segunda rodada ver igual.
function aprendizadoFalso({ ligado = false, resultado = { ok: true } } = {}) {
  const chamadas = [];
  let agora = ligado;
  return {
    chamadas,
    ligadoExiste: () => agora,
    previa: (o) => { chamadas.push(['previa', o]); return { ok: true, plano: {}, assinatura: 'x', codigo: 'abcd1234' }; },
    ligar: async (o) => { chamadas.push(['ligar', o]); if (resultado.ok) agora = true; return resultado; },
  };
}
const aprendizadoDe = (itens) => itens.find((i) => i.nome === 'aprendizado');

test('aprendizado (spec §7): ligado por padrão, sem perguntar, com o código da prévia', async () => {
  const apr = aprendizadoFalso();
  const c = cenario();
  const itens = await rodarTudo(c, { argv: ['--sem-extras'], deps: { aprendizado: apr } });
  assert.deepEqual(aprendizadoDe(itens), { nome: 'aprendizado', estado: 'ok', detalhe: 'ligado (desligue na janela ou com --sem-aprender)' });
  const [, o] = apr.chamadas.find(([k]) => k === 'ligar');
  assert.equal(o.codigo, 'abcd1234');
  assert.equal(o.arquivo, c.arq);
  assert.equal(o.agoraMs, AGORA + 2);
  // --com-aprendizado continua aceito, e não muda nada.
  assert.equal(aprendizadoDe(await rodarTudo(cenario(), { argv: ['--sim', '--com-aprendizado'] })).estado, 'ok');
});

test('aprendizado: --sem-aprender e o marcador do usuário não ligam; já ligado é igual', async () => {
  let apr = aprendizadoFalso();
  assert.deepEqual(aprendizadoDe(await rodarTudo(cenario(), { argv: ['--sim', '--sem-aprender'], deps: { aprendizado: apr } })),
    { nome: 'aprendizado', estado: 'pulado', detalhe: 'desligado (--sem-aprender); para ligar, na janela ou /hadouken:aprender ligar' });
  assert.equal(apr.chamadas.length, 0);
  apr = aprendizadoFalso();
  const c = cenario();
  fs.mkdirSync(process.env.HADOUKEN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.HADOUKEN_HOME, ARQ_DESLIGADO_USUARIO), '');
  assert.deepEqual(aprendizadoDe(await rodarTudo(c, { deps: { aprendizado: apr } })),
    { nome: 'aprendizado', estado: 'pulado', detalhe: 'desligado por você; para ligar, na janela ou /hadouken:aprender ligar' });
  assert.equal(apr.chamadas.length, 0);
  assert.equal(aprendizadoDe(await rodarTudo(cenario(), { deps: { aprendizado: aprendizadoFalso({ ligado: true }) } })).estado, 'igual');
});

test('aprendizado: falha do ligar é ✗ sem derrubar; nenhum texto diz opcional', async () => {
  const c = cenario();
  const escritos = [];
  const itens = await rodarTudo(c, { argv: ['--sim', '--sem-extras'], escrever: (t) => escritos.push(t), deps: { aprendizado: aprendizadoFalso({ resultado: { ok: false, motivo: 'download' } }) } });
  assert.doesNotMatch(escritos.join(''), /opcional/i);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, 'src', 'instalar-tudo.js'), 'utf8'), /aprendizado[^\n]*opcional|opcional[^\n]*aprendizado/i);
  assert.deepEqual(aprendizadoDe(itens), { nome: 'aprendizado', estado: 'falhou', detalhe: 'download', conserto: 'rode /hadouken:aprender ligar numa sessão' });
  assert.equal(itens.find((i) => i.nome === 'barra').estado, 'ok');
});

// ------------------------------------------------------------ extras

// Python falso: --version, o teste do venv, a criação do venv e o pip do
// venv. Registra [exe, ...args] e o cwd de cada chamada.
function executarPy({ versao = '3.12.1', semVenv = false, jaTem = false } = {}) {
  const chamadas = [];
  const cwds = [];
  const erro = () => Object.assign(new Error('x'), { code: 1 });
  const executar = (exe, args, o, cb) => {
    chamadas.push([exe, ...args]);
    cwds.push(o?.cwd);
    if (args[0] === '--version') return cb(null, `Python ${versao}\n`);
    if (args[0] === '-c') return semVenv ? cb(erro(), '') : cb(null, '');
    if (args.includes('show')) return jaTem ? cb(null, 'Name: graphifyy\nVersion: 0.9.25\n') : cb(erro(), '');
    return cb(null, '');
  };
  return { chamadas, cwds, executar };
}
function spawnarFalso(codigo = 0) {
  const chamadas = [];
  const spawnar = (exe, args, o) => {
    chamadas.push({ exe, args, o });
    const filho = new EventEmitter();
    filho.kill = () => {};
    setImmediate(() => filho.emit('exit', codigo));
    return filho;
  };
  return { chamadas, spawnar };
}

test('extras: graphify num venv da pasta de dados; yu-ux roda o setup.sh do kit; os dois com o cwd na casa', async () => {
  const c = cenario();
  const setup = path.join(c.casa, 'hadouken-kit', 'skills', 'yu-ux-web-expert', 'scripts', 'setup.sh');
  fs.mkdirSync(path.dirname(setup), { recursive: true });
  fs.writeFileSync(setup, '#!/usr/bin/env bash\n');
  const py = executarPy();
  const sp = spawnarFalso();
  const itens = await rodarTudo(c, { argv: ['--sim'], deps: { python: '/usr/bin/python3', bash: '/bin/bash', executar: py.executar, spawnar: sp.spawnar } });
  assert.deepEqual(itens.slice(-2), [
    { nome: 'graphify', estado: 'ok', detalhe: 'instalado (graphifyy 0.9.25)' },
    { nome: 'ferramentas da yu-ux', estado: 'ok', detalhe: 'conferidas' },
  ]);
  const venv = path.join(c.casa, 'hadouken', 'venv');
  const vpy = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
  assert.deepEqual(py.chamadas, [
    [vpy, '-m', 'pip', 'show', 'graphifyy'],
    ['/usr/bin/python3', '--version'],
    ['/usr/bin/python3', '-c', 'import venv, ensurepip'],
    ['/usr/bin/python3', '-m', 'venv', venv],
    [vpy, '-m', 'pip', 'install', 'graphifyy==0.9.25'],
  ]);
  assert.ok(py.chamadas.every((ch) => !ch.includes('--user')), 'nada de pip --user');
  assert.deepEqual(new Set(py.cwds), new Set([os.homedir()]), 'o cwd do python é a casa, nunca a pasta de onde se roda');
  assert.equal(sp.chamadas[0].exe, '/bin/bash');
  assert.equal(sp.chamadas[0].o.cwd, os.homedir());
  assert.deepEqual(sp.chamadas[0].args, [process.platform === 'win32' ? setup.replaceAll('\\', '/') : setup]);
});

test('extras: graphify já no venv é =; Python < 3.10 e sem venv são pulados; sem Python é pulado', async () => {
  const graf = async (opcoesPy, python = '/usr/bin/python3') => (await rodarTudo(cenario(), { argv: ['--sim'], deps: { python, bash: null, executar: executarPy(opcoesPy).executar } })).at(-2);
  assert.equal((await graf({ jaTem: true })).estado, 'igual');
  assert.deepEqual(await graf({ versao: '3.9.18' }), { nome: 'graphify', estado: 'pulado', detalhe: 'precisa de Python 3.10+' });
  assert.deepEqual(await graf({ semVenv: true }), { nome: 'graphify', estado: 'pulado', detalhe: 'falta o python3-venv: sudo apt install python3-venv' });
  assert.deepEqual(await graf({}, null), { nome: 'graphify', estado: 'pulado', detalhe: 'sem Python 3' });
  const sem = await rodarTudo(cenario(), { argv: ['--sim', '--sem-extras'], deps: { python: '/x', bash: '/x' } });
  assert.equal(sem.length, 7);
});

// ------------------------------------------------------------ processo

test('main: opção desconhecida e falta de HADOUKEN_CLAUDE saem 2', () => {
  const env = { ...process.env };
  delete env.HADOUKEN_CLAUDE;
  const r1 = spawnSync(process.execPath, [path.join(repo, 'src', 'instalar-tudo.js'), '--xyz'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r1.status, 2);
  const r2 = spawnSync(process.execPath, [path.join(repo, 'src', 'instalar-tudo.js'), '--sim'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /HADOUKEN_CLAUDE/);
});

test('ponta a ponta: o instalar-tudo de verdade com o claude falso, isolado em pasta temporária', () => {
  const casa = novoTmp();
  const estado = path.join(casa, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [], log: [], raiz: casa }));
  const env = {
    ...process.env, HADOUKEN_CLAUDE: instalarFalso(casa), FALSO_ESTADO: estado, HADOUKEN_HOME: path.join(casa, 'hadouken'),
    HADOUKEN_SETTINGS: path.join(casa, 'settings.json'), CLAUDE_CONFIG_DIR: casa, HADOUKEN_SEM_PAINEL: '1',
  };
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'instalar-tudo.js'), '--sim', '--sem-extras'], { env, encoding: 'utf8', timeout: 60_000, input: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ hadouken-kit: instalado \(1\.1\.0\)/);
  assert.match(r.stdout, /– item do VS Code: pulado \(HADOUKEN_SEM_PAINEL=1\)/);
  assert.match(r.stdout, /Abra uma sessão nova do Claude Code\.\n$/);
});

// Fronteira: o instalador não fala com a rede por conta própria; quem baixa
// é o claude, o pip e o setup.sh, que ele só chama.
test('src/instalar e instalar-tudo.js não têm rede', () => {
  const REDE = /node:(?:http2?|https|net|dns|tls|dgram)\b|\bfetch\s*\(|\bWebSocket\b/;
  const arquivos = [path.join(repo, 'src', 'instalar-tudo.js'), ...fs.readdirSync(path.join(repo, 'src', 'instalar')).map((n) => path.join(repo, 'src', 'instalar', n))];
  for (const a of arquivos) assert.doesNotMatch(fs.readFileSync(a, 'utf8'), REDE, a);
});

test('a skill do graphify do kit procura primeiro o venv do instalador', () => {
  const skill = fs.readFileSync(path.join(repo, 'kit', 'skills', 'graphify', 'SKILL.md'), 'utf8');
  for (const trecho of ['HADOUKEN_HOME', 'venv/Scripts/python.exe', 'venv/bin/python']) assert.ok(skill.includes(trecho), trecho);
  assert.ok(skill.indexOf('venv/bin/python') < skill.indexOf('uv tool dir'), 'o venv vem antes do uv');
});

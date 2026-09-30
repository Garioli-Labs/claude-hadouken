import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acharCode, ARQ_INSTALADO, ARQ_TENTATIVA, caminhoSeguro, DIR_PAINEL, instalarPainel, marcarTentativa, precisaInstalar,
  PRAZO_INSTALAR_MS, TENTATIVA_MS, versaoDoPlugin,
} from '../src/painel/instalar-painel.js';
import { montarVsix } from '../src/painel/vsix.js';
import { painel, rodarCli, USO } from '../src/comandos.js';

// Instalador do painel no VS Code (spec E4 e E8/S27, Task 4). Nenhum teste
// roda o `code` de verdade: instalarPainel recebe `achar` e `executar`
// falsos; o CLI e o SessionStart rodam em processo filho com o PATH trocado
// por uma pasta vazia (acharCode não acha nada) e HADOUKEN_HOME temporário.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WIN = process.platform === 'win32';
const H = 3_600_000;
const pastas = [];
const novoTmp = (prefixo = 'hdk painel ç ') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  pastas.push(d);
  return d;
};
after(() => { for (const d of pastas) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

const lerJsonArq = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const arqPainel = (dir, nome) => path.join(dir, DIR_PAINEL, nome);
const nomeVsix = (versao) => `claude-hadouken-painel-${versao}.vsix`;

// Raiz de plugin falsa: plugin.json com a versão pedida e os dois arquivos de
// vscode/ copiados do repo.
function raizFalsa(versao = '9.8.7') {
  const raiz = novoTmp('hdk raiz ç ');
  fs.mkdirSync(path.join(raiz, '.claude-plugin'));
  fs.writeFileSync(path.join(raiz, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'claude-hadouken', version: versao }));
  fs.mkdirSync(path.join(raiz, 'vscode'));
  for (const f of ['package.json', 'extension.cjs']) fs.copyFileSync(path.join(repo, 'vscode', f), path.join(raiz, 'vscode', f));
  return raiz;
}

// ------------------------------------------------------------ caminhoSeguro

test('caminhoSeguro: a lista de caracteres do instalador da barra, mais \\ no win32', () => {
  const bons = [
    'C:/Users/José/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd',
    '/usr/local/bin/code',
    '/home/fulano/.claude/hadouken/painel/claude-hadouken-painel-0.3.0.vsix',
    'C:/Program Files (x86)/a+b,c@d~e/code.cmd',
  ];
  for (const p of bons) {
    assert.equal(caminhoSeguro(p, 'linux'), true, p);
    assert.equal(caminhoSeguro(p, 'win32'), true, p);
  }
  const comBarra = 'C:\\Users\\José\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
  assert.equal(caminhoSeguro(comBarra, 'win32'), true);
  assert.equal(caminhoSeguro(comBarra, 'linux'), false, '\\ só vale no win32');
  const ruins = ['C:\\x"y\\code.cmd', 'C:\\100%\\code.cmd', 'C:\\a&b', 'C:\\a^b', 'C:\\a|b', 'C:\\a!b', "C:\\a'b", 'C:\\a$b', 'C:\\a`b', 'C:\\a;b', 'C:\\a\nb', 'C:\\a\0b', 'C:\\a×b', 'C:\\a\u201cb', 'C:\\Пример', ''];
  for (const p of ruins) assert.equal(caminhoSeguro(p, 'win32'), false, JSON.stringify(p));
  for (const p of [null, undefined, 42, {}, ['C:\\x']]) assert.equal(caminhoSeguro(p, 'win32'), false, String(p));
  // Sem plataforma, a do processo.
  assert.equal(caminhoSeguro(comBarra), WIN);
});

// ------------------------------------------------------------ acharCode

test('acharCode: code.cmd no win32 e code fora dele, só em diretório absoluto do PATH, o primeiro que existe', () => {
  const vazia = novoTmp();
  const com = novoTmp();
  const outra = novoTmp();
  const nome = WIN ? 'code.cmd' : 'code';
  fs.writeFileSync(path.join(com, nome), '');
  fs.writeFileSync(path.join(outra, nome), '');
  // No win32, um "code" sem extensão (o script sh que o VS Code também põe em bin/) não conta.
  if (WIN) fs.writeFileSync(path.join(vazia, 'code'), '');
  const sep = WIN ? ';' : ':';
  const pathEnv = ['relativo', '', '.', vazia, WIN ? `"${com}"` : com, outra].join(sep);
  assert.equal(acharCode({ pathEnv, plataforma: process.platform }), path.join(com, nome));
  // Com `existe` falso, nada.
  assert.equal(acharCode({ pathEnv, plataforma: process.platform, existe: () => false }), null);
  // `existe` recebe o candidato e decide.
  const vistos = [];
  const alvo = path.join(outra, nome);
  assert.equal(acharCode({ pathEnv, plataforma: process.platform, existe: (p) => { vistos.push(p); return p === alvo; } }), alvo);
  assert.ok(vistos.every((p) => path.isAbsolute(p) && path.basename(p) === nome), vistos.join(' | '));
  // Uma pasta relativa com o arquivo nunca é usada.
  const cwdAntes = process.cwd();
  try {
    process.chdir(com);
    assert.equal(acharCode({ pathEnv: '.', plataforma: process.platform }), null);
  } finally {
    process.chdir(cwdAntes);
  }
  // undefined é o mesmo que não passar (o PATH do processo, logo abaixo).
  for (const pathEnv of ['', null, 42]) assert.equal(acharCode({ pathEnv, plataforma: process.platform }), null, String(pathEnv));
  assert.equal(acharCode(), acharCode({}), 'sem opções: PATH e plataforma do processo, sem lançar');
});

// ------------------------------------------------------------ precisaInstalar

test('precisaInstalar: sem arquivo sim; mesma versão instalada não; tentativa há menos de 1 h não', () => {
  const dir = novoTmp();
  const agora = Date.parse('2026-09-29T20:00:00Z');
  const pedir = (extra = {}) => precisaInstalar({ dir, versao: '0.3.0', agoraMs: agora, ...extra });
  assert.equal(pedir(), true, 'nada gravado');
  fs.mkdirSync(path.join(dir, DIR_PAINEL));
  fs.writeFileSync(arqPainel(dir, ARQ_INSTALADO), JSON.stringify({ versao: '0.3.0', em: new Date(agora - 5 * H).toISOString() }));
  assert.equal(pedir(), false, 'a mesma versão');
  assert.equal(pedir({ versao: '0.3.1' }), true, 'outra versão');
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em: new Date(agora - 10 * 60_000).toISOString() }));
  assert.equal(pedir({ versao: '0.3.1' }), false, 'tentativa há 10 min');
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em: new Date(agora - TENTATIVA_MS - 1).toISOString() }));
  assert.equal(pedir({ versao: '0.3.1' }), true, 'tentativa há mais de 1 h');
  // Arquivos estragados contam como ausentes.
  fs.writeFileSync(arqPainel(dir, ARQ_INSTALADO), '{');
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em: 'ontem' }));
  assert.equal(pedir(), true);
  fs.writeFileSync(arqPainel(dir, ARQ_INSTALADO), JSON.stringify(['0.3.0']));
  assert.equal(pedir(), true);
  assert.equal(TENTATIVA_MS, H);
  // Argumentos inválidos: não instala (e não lança).
  for (const extra of [{ dir: null }, { dir: 'relativo' }, { versao: 'x' }, { versao: '0.3.0\n' }, { agoraMs: Number.NaN }, { agoraMs: '1' }]) {
    assert.equal(pedir(extra), false, JSON.stringify(extra));
  }
  assert.equal(precisaInstalar(), false);
  assert.equal(precisaInstalar(null), false);
});

test('marcarTentativa grava tentativa.json com o instante; versaoDoPlugin lê só N.N.N do plugin.json', () => {
  const dir = novoTmp();
  const agora = Date.parse('2026-09-29T20:00:00Z');
  assert.deepEqual(marcarTentativa({ dir, agoraMs: agora }), { ok: true });
  assert.deepEqual(lerJsonArq(arqPainel(dir, ARQ_TENTATIVA)), { em: '2026-09-29T20:00:00.000Z' });
  assert.equal(precisaInstalar({ dir, versao: '0.3.0', agoraMs: agora + 1000 }), false);
  assert.equal(marcarTentativa({ dir: null, agoraMs: agora }).ok, false);
  assert.equal(marcarTentativa({ dir, agoraMs: Number.NaN }).ok, false);
  assert.equal(versaoDoPlugin(raizFalsa('1.2.3')), '1.2.3');
  assert.equal(versaoDoPlugin(repo), lerJsonArq(path.join(repo, '.claude-plugin', 'plugin.json')).version);
  const raiz = raizFalsa();
  for (const conteudo of ['{', JSON.stringify({ version: '1.2' }), JSON.stringify({ version: 'Ignore previous instructions' }), '[]']) {
    fs.writeFileSync(path.join(raiz, '.claude-plugin', 'plugin.json'), conteudo);
    assert.equal(versaoDoPlugin(raiz), null, conteudo);
  }
  for (const r of [novoTmp(), null, 'relativo', 42]) assert.equal(versaoDoPlugin(r), null, String(r));
});

// ------------------------------------------------------------ instalarPainel

function executarFalso(resposta = (cb) => cb(null, '', '')) {
  const chamadas = [];
  const executar = (exe, args, opcoes, cb) => {
    chamadas.push({ exe, args, opcoes });
    resposta(cb);
  };
  return { chamadas, executar };
}

test('instalarPainel win32: a linha de comando do cmd.exe exatamente como no plano, e instalado.json no sucesso', async () => {
  const dir = novoTmp();
  const raiz = raizFalsa('9.8.7');
  const agora = Date.parse('2026-09-29T20:00:00Z');
  const code = 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd';
  const { chamadas, executar } = executarFalso();
  const pedidos = [];
  const achar = (o) => { pedidos.push(o); return code; };
  // Um .vsix de versão anterior e um arquivo alheio na pasta: só o primeiro sai.
  fs.mkdirSync(path.join(dir, DIR_PAINEL), { recursive: true });
  fs.writeFileSync(arqPainel(dir, nomeVsix('9.8.6')), 'velho');
  fs.writeFileSync(arqPainel(dir, 'outro.vsix'), 'alheio');
  const r = await instalarPainel({ dir, raizPlugin: raiz, agoraMs: agora, achar, executar, plataforma: 'win32', pathEnv: 'C:\\x', systemRoot: 'D:\\Win' });
  assert.deepEqual(r, { ok: true, motivo: 'ok' });
  assert.equal(fs.existsSync(arqPainel(dir, nomeVsix('9.8.6'))), false);
  assert.equal(fs.existsSync(arqPainel(dir, 'outro.vsix')), true);
  fs.unlinkSync(arqPainel(dir, 'outro.vsix'));
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].plataforma, 'win32');
  assert.equal(pedidos[0].pathEnv, 'C:\\x');
  const vsix = arqPainel(dir, nomeVsix('9.8.7'));
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].exe, 'D:\\Win\\System32\\cmd.exe');
  assert.deepEqual(chamadas[0].args, ['/d', '/s', '/c', `""${code}" --install-extension "${vsix}" --force"`]);
  assert.deepEqual(chamadas[0].opcoes, { windowsVerbatimArguments: true, windowsHide: true, timeout: PRAZO_INSTALAR_MS, cwd: path.join(dir, DIR_PAINEL) });
  assert.equal(PRAZO_INSTALAR_MS, 120_000);
  assert.deepEqual(lerJsonArq(arqPainel(dir, ARQ_INSTALADO)), { versao: '9.8.7', em: '2026-09-29T20:00:00.000Z' });
  assert.deepEqual(lerJsonArq(arqPainel(dir, ARQ_TENTATIVA)), { em: '2026-09-29T20:00:00.000Z' });
  // O .vsix gravado é exatamente o que montarVsix dá com a versão do plugin e
  // os dois arquivos de vscode/ da raiz (o conteúdo é testado em painel-vsix).
  const bytes = fs.readFileSync(vsix);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'zip');
  const lerFonte = (f) => fs.readFileSync(path.join(raiz, 'vscode', f), 'utf8');
  const esperado = montarVsix({ versao: '9.8.7', packageJson: lerFonte('package.json'), extensionCjs: lerFonte('extension.cjs') });
  assert.ok(Buffer.isBuffer(esperado) && bytes.equals(esperado), 'o .vsix de montarVsix com a versão do plugin');
  assert.equal(precisaInstalar({ dir, versao: '9.8.7', agoraMs: agora + 2 * H }), false, 'instalado');
  // Nenhum temporário sobra na pasta.
  assert.deepEqual(fs.readdirSync(path.join(dir, DIR_PAINEL)).sort(), [ARQ_INSTALADO, nomeVsix('9.8.7'), ARQ_TENTATIVA].sort());
});

test('instalarPainel POSIX: execFile direto no code achado, argumentos fixos', async () => {
  const dir = novoTmp();
  const raiz = raizFalsa('9.8.7');
  const { chamadas, executar } = executarFalso();
  const r = await instalarPainel({ dir, raizPlugin: raiz, agoraMs: Date.now(), achar: () => '/usr/local/bin/code', executar, plataforma: 'linux' });
  assert.deepEqual(r, { ok: true, motivo: 'ok' });
  const vsix = arqPainel(dir, nomeVsix('9.8.7'));
  assert.deepEqual(chamadas, [{ exe: '/usr/local/bin/code', args: ['--install-extension', vsix, '--force'], opcoes: { timeout: PRAZO_INSTALAR_MS, cwd: path.join(dir, DIR_PAINEL) } }]);
});

test('instalarPainel: sem code é sem-vscode; o .vsix fica montado e a tentativa gravada, sem instalado.json', async () => {
  const dir = novoTmp();
  const raiz = raizFalsa('9.8.7');
  const { chamadas, executar } = executarFalso();
  const agora = Date.now();
  const r = await instalarPainel({ dir, raizPlugin: raiz, agoraMs: agora, achar: () => null, executar });
  assert.deepEqual(r, { ok: false, motivo: 'sem-vscode' });
  assert.equal(chamadas.length, 0);
  assert.ok(fs.statSync(arqPainel(dir, nomeVsix('9.8.7'))).isFile());
  assert.equal(fs.existsSync(arqPainel(dir, ARQ_INSTALADO)), false);
  assert.equal(precisaInstalar({ dir, versao: '9.8.7', agoraMs: agora + 60_000 }), false, 'a tentativa segura a próxima por 1 h');
  assert.equal(precisaInstalar({ dir, versao: '9.8.7', agoraMs: agora + 2 * H }), true);
});

test('instalarPainel: caminho do code ou do .vsix fora da lista segura é caminho-inseguro, e nada roda', async () => {
  const raiz = raizFalsa('9.8.7');
  const { chamadas, executar } = executarFalso();
  for (const [code, plataforma] of [['C:\\x"y\\code.cmd', 'win32'], ['C:\\a&calc\\code.cmd', 'win32'], ['C:\\100%PATH%\\code.cmd', 'win32'], ['/opt/a"b/code', 'linux'], ['/opt/a\\b/code', 'linux']]) {
    const dir = novoTmp();
    const r = await instalarPainel({ dir, raizPlugin: raiz, agoraMs: Date.now(), achar: () => code, executar, plataforma });
    assert.deepEqual(r, { ok: false, motivo: 'caminho-inseguro' }, code);
  }
  // A pasta de dados com % (vale no Windows e no POSIX) deixa o .vsix fora da lista.
  const dir = novoTmp('hdk 100% ');
  const r = await instalarPainel({ dir, raizPlugin: raiz, agoraMs: Date.now(), achar: () => (WIN ? 'C:\\code\\code.cmd' : '/usr/bin/code'), executar });
  assert.deepEqual(r, { ok: false, motivo: 'caminho-inseguro' });
  assert.equal(chamadas.length, 0);
  assert.equal(fs.existsSync(arqPainel(dir, ARQ_INSTALADO)), false);
});

test('instalarPainel: falha do CLI do VS Code é erro, prazo estourado é tempo, e instalado.json não é gravado', async () => {
  const raiz = raizFalsa('9.8.7');
  const casos = [
    [(cb) => cb(Object.assign(new Error('Command failed'), { code: 1 }), '', 'Failed Installing Extensions'), 'erro'],
    [(cb) => cb(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), '', ''), 'tempo'],
    [(cb) => cb(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), '', ''), 'tempo'],
    [() => { throw new Error('spawn EINVAL'); }, 'erro'],
  ];
  for (const [resposta, motivo] of casos) {
    const dir = novoTmp();
    const { executar } = executarFalso(resposta);
    const r = await instalarPainel({ dir, raizPlugin: raiz, agoraMs: Date.now(), achar: () => '/usr/bin/code', executar, plataforma: 'linux' });
    assert.deepEqual(r, { ok: false, motivo }, motivo);
    assert.equal(fs.existsSync(arqPainel(dir, ARQ_INSTALADO)), false, motivo);
  }
});

test('instalarPainel: sem pasta, plugin.json ilegível ou extensão ausente falham com motivo fixo, sem rodar nada', async () => {
  const { chamadas, executar } = executarFalso();
  const achar = () => '/usr/bin/code';
  for (const dir of [null, 'relativo', 42]) {
    assert.deepEqual(await instalarPainel({ dir, raizPlugin: raizFalsa(), agoraMs: Date.now(), achar, executar }), { ok: false, motivo: 'sem-pasta' });
  }
  let dir = novoTmp();
  assert.deepEqual(await instalarPainel({ dir, raizPlugin: novoTmp(), agoraMs: Date.now(), achar, executar }), { ok: false, motivo: 'plugin-invalido' });
  assert.ok(fs.existsSync(arqPainel(dir, ARQ_TENTATIVA)), 'a tentativa vem primeiro');
  const semExtensao = raizFalsa();
  fs.rmSync(path.join(semExtensao, 'vscode', 'extension.cjs'));
  dir = novoTmp();
  assert.deepEqual(await instalarPainel({ dir, raizPlugin: semExtensao, agoraMs: Date.now(), achar, executar }), { ok: false, motivo: 'extensao-invalida' });
  const outraExtensao = raizFalsa();
  fs.writeFileSync(path.join(outraExtensao, 'vscode', 'package.json'), JSON.stringify({ name: 'outra', publisher: 'gariolilabs' }));
  dir = novoTmp();
  assert.deepEqual(await instalarPainel({ dir, raizPlugin: outraExtensao, agoraMs: Date.now(), achar, executar }), { ok: false, motivo: 'extensao-invalida' });
  // painel/ ocupada por um arquivo: a tentativa não grava.
  dir = novoTmp();
  fs.writeFileSync(path.join(dir, DIR_PAINEL), 'lixo');
  assert.deepEqual(await instalarPainel({ dir, raizPlugin: raizFalsa(), agoraMs: Date.now(), achar, executar }), { ok: false, motivo: 'escrita' });
  assert.equal(chamadas.length, 0);
  assert.deepEqual(await instalarPainel(), { ok: false, motivo: 'sem-pasta' });
  assert.deepEqual(await instalarPainel(null), { ok: false, motivo: 'sem-pasta' });
});

// ------------------------------------------------------------ CLI

function capturar() {
  const saidas = [];
  const codigos = [];
  return { saidas, codigos, escrever: async (t) => { saidas.push(t); }, sair: (c) => { codigos.push(c); } };
}

test('CLI painel: sem subcomando ou com outro, a linha de uso fixa e código 1, nada ecoado', async () => {
  assert.match(USO, /\| painel instalar$/);
  for (const argv of [['painel'], ['painel', 'desinstalar'], ['painel', '$(rm -rf ~)'], ['painel', 'INSTALAR'], ['painel', '--instalar']]) {
    const c = capturar();
    await rodarCli(argv, c);
    assert.deepEqual(c.saidas, [`${USO}\n`], String(argv));
    assert.deepEqual(c.codigos, [1], String(argv));
  }
});

test('CLI painel instalar: {"ok":true} com 0, {"ok":false,"motivo"} com 1, e a raiz do plugin pela regra', async () => {
  const antes = process.env.CLAUDE_PLUGIN_ROOT;
  const recebidos = [];
  const falso = (resposta) => async (o) => { recebidos.push(o); return resposta; };
  try {
    const raiz = raizFalsa();
    process.env.CLAUDE_PLUGIN_ROOT = raiz;
    assert.deepEqual(await painel(['instalar'], { instalarPainel: falso({ ok: true, motivo: 'ok' }) }), { texto: '{"ok":true}\n', codigo: 0 });
    assert.equal(recebidos[0].raizPlugin, raiz);
    assert.ok(Number.isFinite(recebidos[0].agoraMs));
    assert.equal(typeof recebidos[0].dir, 'string');
    process.env.CLAUDE_PLUGIN_ROOT = 'relativo';
    assert.deepEqual(await painel(['instalar', '--evil'], { instalarPainel: falso({ ok: false, motivo: 'sem-vscode' }) }), { texto: '{"ok":false,"motivo":"sem-vscode"}\n', codigo: 1 });
    assert.equal(recebidos[1].raizPlugin, repo, 'relativa: a pasta dois níveis acima de comandos.js');
    delete process.env.CLAUDE_PLUGIN_ROOT;
    await painel(['instalar'], { instalarPainel: falso({ ok: false, motivo: 'erro' }) });
    assert.equal(recebidos[2].raizPlugin, repo);
    // Motivo que não é da lista fixa nunca sai como veio.
    const r = await painel(['instalar'], { instalarPainel: falso({ ok: false, motivo: 'C:\\Users\\Fulano "x"' }) });
    assert.deepEqual(r, { texto: '{"ok":false,"motivo":"erro"}\n', codigo: 1 });
  } finally {
    if (antes === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = antes;
  }
});

// Ambiente de filho: HADOUKEN_HOME temporário, PATH só com uma pasta vazia
// (acharCode não acha code nenhum) e sem HADOUKEN_SEM_PAINEL de quem roda.
function ambienteIsolado(home, extra = {}) {
  assert.ok(home.startsWith(os.tmpdir()), 'HADOUKEN_HOME sempre temporário');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(path|hadouken_home|hadouken_sem_painel|claude_plugin_root)$/i.test(k)) delete env[k];
  Object.assign(env, { PATH: novoTmp('hdk path vazio '), HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo }, extra);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
}

test('filho: cli.js painel instalar sem code no PATH monta o .vsix na pasta de dados e sai 1 com sem-vscode', () => {
  const home = novoTmp('hdk casa ç ');
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'cli.js'), 'painel', 'instalar'], {
    env: ambienteIsolado(home), cwd: home, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '{"ok":false,"motivo":"sem-vscode"}\n');
  assert.equal(r.status, 1);
  const versao = versaoDoPlugin(repo);
  assert.ok(fs.statSync(arqPainel(home, nomeVsix(versao))).isFile());
  assert.equal(fs.existsSync(arqPainel(home, ARQ_INSTALADO)), false);
  const uso = spawnSync(process.execPath, [path.join(repo, 'src', 'cli.js'), 'painel'], { env: ambienteIsolado(home), encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(uso.status, 1);
  assert.equal(uso.stdout, `${USO}\n`);
});

// ------------------------------------------------------------ SessionStart

function sessionStart(env) {
  return spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', 'session-start.js')], {
    input: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: 'C:/x' }),
    env, encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
}

const contextoDe = (r) => {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};

async function esperarArquivo(arq, ms) {
  const fim = Date.now() + ms;
  while (!fs.existsSync(arq)) {
    if (Date.now() > fim) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

// Controle positivo e negativo juntos: sem HADOUKEN_SEM_PAINEL o SessionStart
// dispara `cli.js painel instalar` destacado (que, sem code no PATH, só monta o
// .vsix e grava a tentativa); com HADOUKEN_SEM_PAINEL=1, nada. Em nenhum dos
// dois entra linha nova no contexto (zero tokens).
test('SessionStart: dispara o instalador em segundo plano; com HADOUKEN_SEM_PAINEL=1 não dispara nada', async () => {
  const versao = versaoDoPlugin(repo);
  const ligado = novoTmp('hdk casa ç ');
  const desligado = novoTmp('hdk casa ç ');
  const rLigado = sessionStart(ambienteIsolado(ligado));
  const rDesligado = sessionStart(ambienteIsolado(desligado, { HADOUKEN_SEM_PAINEL: '1' }));
  for (const r of [rLigado, rDesligado]) assert.equal(contextoDe(r), 'Consumo sem leitura: rode /usage.');
  assert.ok(fs.existsSync(arqPainel(ligado, ARQ_TENTATIVA)), 'a tentativa é marcada antes do disparo');
  assert.ok(await esperarArquivo(arqPainel(ligado, nomeVsix(versao)), 20_000), 'o filho destacado montou o .vsix');
  // Mais um pouco para o que o desligado disparasse aparecer.
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(fs.existsSync(path.join(desligado, DIR_PAINEL)), false);
  assert.equal(fs.existsSync(arqPainel(ligado, ARQ_INSTALADO)), false, 'sem code, nada instalado');
  // Segunda sessão no ligado: a tentativa recente segura o disparo.
  const tentativa = fs.readFileSync(arqPainel(ligado, ARQ_TENTATIVA), 'utf8');
  assert.equal(contextoDe(sessionStart(ambienteIsolado(ligado))), 'Consumo sem leitura: rode /usage.');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fs.readFileSync(arqPainel(ligado, ARQ_TENTATIVA), 'utf8'), tentativa);
});

test('SessionStart: sem shims (raiz inválida) não dispara', async () => {
  const home = novoTmp('hdk casa ç ');
  const r = sessionStart(ambienteIsolado(home, { CLAUDE_PLUGIN_ROOT: undefined }));
  assert.match(contextoDe(r), /barra indisponível \(raiz_invalida\)/);
  await new Promise((res) => setTimeout(res, 1000));
  assert.equal(fs.existsSync(path.join(home, DIR_PAINEL)), false);
});

// O filho destacado não segura o stdout do hook: o Claude Code recebe o fim
// do hook sem esperar a instalação.
test('SessionStart: o hook termina sem esperar o filho destacado', async () => {
  const home = novoTmp('hdk casa ç ');
  const inicio = Date.now();
  const r = await new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(repo, 'src', 'hooks', 'session-start.js')], {
      env: ambienteIsolado(home), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    filho.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    filho.on('close', (codigo) => resolve({ codigo, out, ms: Date.now() - inicio }));
    filho.stdin.end(JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }));
  });
  assert.equal(r.codigo, 0);
  assert.match(r.out, /"hookEventName":"SessionStart"/);
  assert.ok(fs.existsSync(arqPainel(home, ARQ_TENTATIVA)), 'disparou');
  assert.ok(r.ms < 10_000, `${r.ms} ms`);
  await esperarArquivo(arqPainel(home, nomeVsix(versaoDoPlugin(repo))), 20_000);
});

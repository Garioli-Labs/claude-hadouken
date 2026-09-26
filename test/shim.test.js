import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sincronizarShims } from '../src/shim.js';
import { registrarSessao } from '../src/ativas.js';
import { dirDados } from '../src/base.js';

// Shims estáveis (spec 8.1, S6): <dirDados>/bin/statusline.mjs e cli.mjs, uma
// linha cada, `await import("<file URL do alvo>").catch(...)`. O settings.json
// aponta para eles e o SessionStart os regrava a cada sessão, desfazendo
// adulteração. Alvo sumido (plugin atualizado, versão velha apagada): a barra
// sai 0 calada; o CLI sai 1 com uma linha ASCII.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHIMS = ['statusline.mjs', 'cli.mjs'];
const ALVO = { 'statusline.mjs': 'statusline.js', 'cli.mjs': 'cli.js' };
const LINHA_CLI = 'claude-hadouken: plugin files not found - open a new session';
const linhaInterna = (token) => `claude-hadouken: internal error (${token})\n`;
// Handler do cli.mjs, copiado à mão (não importado de shim.js). String.raw:
// o \n fica como os dois caracteres \ e n, e o shim continua uma linha só.
// "plugin files not found" só quando o módulo que falta é o próprio alvo:
// e.url === u (Node >= 20.10) ou, sem e.url (Node 20.0 a 20.9), a mensagem
// começa pelo caminho do alvo. Qualquer outro erro: "internal error (<code
// ou name>)", só letras, dígitos e _, no máximo 40, sem stack. Sai 1 sempre.
const CATCH_CLI = String.raw`(e) => { let m = "internal error (unknown)"; try { const s = (v) => (typeof v === "string" ? v.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) : ""); if (e?.code === "ERR_MODULE_NOT_FOUND" && (e.url === u || (e.url === undefined && typeof e.message === "string" && e.message.startsWith("Cannot find module '" + fileURLToPath(u) + "'")))) m = "plugin files not found - open a new session"; else m = "internal error (" + (s(e?.code) || s(e?.name) || "unknown") + ")"; } catch {} process.exitCode = 1; try { process.stderr.write("claude-hadouken: " + m + "\n"); } catch {} }`;
const PREFIXO_CLI = 'import { fileURLToPath } from "node:url"; const u = ';
const MODELO = {
  'statusline.mjs': (url) => `await import(${JSON.stringify(url)}).catch(() => {});\n`,
  'cli.mjs': (url) => `${PREFIXO_CLI}${JSON.stringify(url)}; await import(u).catch(${CATCH_CLI});\n`,
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// Uma linha só, ASCII imprimível, e nenhuma aspa dentro da URL.
const FORMATO = {
  'statusline.mjs': /^await import\("file:\/\/[\x21\x23-\x7e]+"\)\.catch\(\(\) => \{\}\);\n$/,
  'cli.mjs': new RegExp(`^${escRe(PREFIXO_CLI)}"file://[\\x21\\x23-\\x7e]+"${escRe(`; await import(u).catch(${CATCH_CLI});`)}\\n$`),
};
// Nome do temporário da escrita atômica: .<shim>.<12 hex de crypto.randomBytes(6)>.tmp
const NOME_TMP = /^\.(?:statusline|cli)\.mjs\.[0-9a-f]{12}\.tmp$/;
// Data de 2 h atrás, sem seguir link (a varredura apaga temporários com mais de 1 h).
const envelhecer = (p) => {
  const s = (Date.now() - 2 * 3_600_000) / 1000;
  fs.lutimesSync(p, s, s);
};
// No Windows a junção não pede privilégio; no POSIX um symlink de pasta também não.
const LINK_PASTA = process.platform === 'win32' ? 'junction' : 'dir';

let home;
const homeOriginal = process.env.HADOUKEN_HOME;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk shim ç '));
  process.env.HADOUKEN_HOME = home;
});
afterEach(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(home, { recursive: true, force: true });
});

const bin = () => path.join(home, 'bin');
const arqShim = (nome) => path.join(bin(), nome);
const esperado = (raiz, nome) => MODELO[nome](pathToFileURL(path.join(raiz, 'src', ALVO[nome])).href);
const ler = (p) => fs.readFileSync(p, 'utf8');
const tmpDe = (nome, hex) => path.join(bin(), `.${nome}.${hex}.tmp`);

// Raiz de plugin sintética: package.json de módulo e alvos que imprimem um
// marcador e a própria URL, para provar qual arquivo o shim importou.
function criarRaiz(raiz) {
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(raiz, 'src', 'statusline.js'), "process.stdout.write('alvo-statusline ' + import.meta.url);\n");
  fs.writeFileSync(path.join(raiz, 'src', 'cli.js'), "process.stdout.write('alvo-cli ' + import.meta.url);\n");
  return raiz;
}

// Ambiente do filho: NO_COLOR ligado; um valor undefined em `extra` tira a variável.
function rodarShim(nome, stdin = '', extra = {}) {
  const env = { ...process.env, NO_COLOR: '1', ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return spawnSync(process.execPath, [arqShim(nome)], { input: stdin, encoding: 'utf8', timeout: 15_000, env });
}

// Symlink de arquivo no Windows pede modo desenvolvedor; sem permissão o teste
// é pulado em vez de passar sem provar nada.
function link(t, alvo, caminho, tipo) {
  try {
    fs.symlinkSync(alvo, caminho, tipo);
    return true;
  } catch (e) {
    t.skip(`symlink indisponivel aqui (${e.code})`);
    return false;
  }
}

// Retrato da árvore: caminho, tipo, tamanho, data e conteúdo de cada entrada,
// sem seguir links. Serve para provar "nada foi escrito".
function arvore(raiz) {
  const itens = [];
  const visitar = (dir) => {
    for (const nome of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, nome);
      const i = fs.lstatSync(p);
      const tipo = i.isSymbolicLink() ? 'link' : i.isDirectory() ? 'dir' : i.isFile() ? 'arq' : 'outro';
      const conteudo = tipo === 'arq' ? fs.readFileSync(p, 'utf8') : '';
      itens.push(`${path.relative(raiz, p)}|${tipo}|${i.size}|${Math.round(i.mtimeMs)}|${conteudo}`);
      if (tipo === 'dir') visitar(p);
    }
  };
  visitar(raiz);
  return itens;
}

test('cria shims apontando para a raiz do plugin e é idempotente', () => {
  const raiz = criarRaiz(path.join(home, 'Plugin Dir'));
  const r1 = sincronizarShims(raiz);
  assert.deepEqual(r1, { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  // O texto exato de cada shim, escrito à mão (não via MODELO).
  const url = (alvo) => JSON.stringify(pathToFileURL(path.join(raiz, 'src', alvo)).href);
  assert.equal(ler(arqShim('statusline.mjs')), `await import(${url('statusline.js')}).catch(() => {});\n`);
  assert.equal(ler(arqShim('cli.mjs')), `import { fileURLToPath } from "node:url"; const u = ${url('cli.js')}; await import(u).catch(${CATCH_CLI});\n`);
  for (const nome of SHIMS) {
    assert.equal(ler(arqShim(nome)).split('\n').length, 2, `${nome}: uma linha só`);
    assert.match(ler(arqShim(nome)), /^[\x20-\x7e]+\n$/, `${nome}: ASCII imprimível`);
  }
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: [] });
  const v2 = criarRaiz(path.join(home, 'v2'));
  assert.deepEqual(sincronizarShims(v2).alterados, ['statusline.mjs', 'cli.mjs']);
  assert.equal(ler(arqShim('statusline.mjs')), esperado(v2, 'statusline.mjs'));
  // Escrita atômica: nenhum temporário sobra em bin/.
  assert.deepEqual(fs.readdirSync(bin()).sort(), ['cli.mjs', 'statusline.mjs']);
});

test('conteúdo igual não é regravado: a data do arquivo não muda', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  const velho = Date.now() - 3 * 86_400_000;
  for (const nome of SHIMS) fs.utimesSync(arqShim(nome), velho / 1000, velho / 1000);
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: [] });
  for (const nome of SHIMS) assert.equal(Math.round(fs.lstatSync(arqShim(nome)).mtimeMs), velho, nome);
});

test('raiz com barra no fim ou com .. gera a mesma URL', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  assert.deepEqual(sincronizarShims(raiz + path.sep), { ok: true, alterados: [] });
  assert.deepEqual(sincronizarShims(path.join(raiz, 'src', '..')), { ok: true, alterados: [] });
});

test('shim adulterado com conteúdo malicioso é restaurado na sincronização seguinte', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  const certo = ler(arqShim('cli.mjs'));
  fs.writeFileSync(arqShim('statusline.mjs'), "import('node:child_process').then((c) => c.execSync('echo pwned'));\n");
  // Mesmo tamanho, um byte trocado: comparar só o tamanho não basta.
  fs.writeFileSync(arqShim('cli.mjs'), certo.replace('cli.js', 'cl1.js'));
  assert.equal(fs.lstatSync(arqShim('cli.mjs')).size, Buffer.byteLength(certo));
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  for (const nome of SHIMS) assert.equal(ler(arqShim(nome)), esperado(raiz, nome), nome);
  const r = rodarShim('statusline.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('pwned'));
  assert.ok(r.stdout.startsWith('alvo-statusline '), r.stdout);
});

test('shim enorme adulterado é restaurado', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  fs.writeFileSync(arqShim('statusline.mjs'), 'x'.repeat(8 * 1024 * 1024));
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs'] });
  assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
});

test('junção (ou symlink de pasta) no lugar do shim vira arquivo regular; o alvo fica intacto', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(bin());
  const fora = path.join(home, 'fora');
  fs.mkdirSync(fora);
  fs.writeFileSync(path.join(fora, 'sentinela.txt'), 'original');
  if (!link(t, fora, arqShim('statusline.mjs'), LINK_PASTA)) return;
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  const info = fs.lstatSync(arqShim('statusline.mjs'));
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
  assert.deepEqual(fs.readdirSync(fora), ['sentinela.txt']);
  assert.equal(ler(path.join(fora, 'sentinela.txt')), 'original');
});

test('junção pendente no lugar do shim: some, e o alvo não é criado', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(bin());
  const inexistente = path.join(home, 'nao-existe');
  if (!link(t, inexistente, arqShim('cli.mjs'), LINK_PASTA)) return;
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  assert.ok(fs.lstatSync(arqShim('cli.mjs')).isFile());
  assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
  assert.equal(fs.existsSync(inexistente), false);
});

test('symlink de arquivo no lugar do shim vira arquivo regular; o alvo fica intacto', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(bin());
  const alvo = path.join(home, 'alvo.txt');
  fs.writeFileSync(alvo, 'original');
  if (!link(t, alvo, arqShim('statusline.mjs'), 'file')) return;
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  assert.ok(fs.lstatSync(arqShim('statusline.mjs')).isFile());
  assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
  assert.equal(ler(alvo), 'original');
});

test('symlink para um arquivo com o conteúdo certo também é trocado por arquivo regular', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(bin());
  const alvo = path.join(home, 'isca.mjs');
  fs.writeFileSync(alvo, esperado(raiz, 'statusline.mjs'));
  if (!link(t, alvo, arqShim('statusline.mjs'), 'file')) return;
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  assert.ok(!fs.lstatSync(arqShim('statusline.mjs')).isSymbolicLink());
  assert.equal(ler(alvo), esperado(raiz, 'statusline.mjs'));
});

test('pasta no lugar do shim: shim_invalido, a pasta fica, o outro shim é restaurado', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(arqShim('statusline.mjs'), { recursive: true });
  fs.writeFileSync(path.join(arqShim('statusline.mjs'), 'dentro.txt'), 'x');
  assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'shim_invalido' });
  assert.ok(fs.lstatSync(arqShim('statusline.mjs')).isDirectory());
  assert.deepEqual(fs.readdirSync(arqShim('statusline.mjs')), ['dentro.txt']);
  assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
});

test('FIFO no lugar do shim é trocado sem travar (POSIX)', { skip: process.platform === 'win32' && 'FIFO e POSIX' }, () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(bin());
  execFileSync('mkfifo', [arqShim('statusline.mjs')]);
  // Num processo filho com prazo: uma regressão que abra o FIFO falha em vez de travar a suíte.
  const url = new URL('../src/shim.js', import.meta.url).href;
  const p = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { sincronizarShims } from ${JSON.stringify(url)}; process.stdout.write(JSON.stringify(sincronizarShims(${JSON.stringify(raiz)})));`,
  ], { env: { ...process.env, HADOUKEN_HOME: home }, encoding: 'utf8', timeout: 5000 });
  assert.equal(p.error, undefined, String(p.error));
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(JSON.parse(p.stdout), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  assert.ok(fs.lstatSync(arqShim('statusline.mjs')).isFile());
});

test('bin/ como junção (ou symlink de pasta): bin_invalido e nada é escrito no alvo', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const fora = path.join(home, 'fora');
  fs.mkdirSync(fora);
  // Um temporário velho do lado de lá: a varredura não passa pela junção.
  const tmpFora = path.join(fora, '.statusline.mjs.a1b2c3d4e5f6.tmp');
  fs.writeFileSync(tmpFora, 'x');
  envelhecer(tmpFora);
  if (!link(t, fora, bin(), LINK_PASTA)) return;
  assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'bin_invalido' });
  assert.deepEqual(fs.readdirSync(fora), ['.statusline.mjs.a1b2c3d4e5f6.tmp']);
  assert.ok(fs.lstatSync(bin()).isSymbolicLink());
});

test('bin/ como junção pendente: bin_invalido e o alvo não é criado', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const inexistente = path.join(home, 'nao-existe');
  if (!link(t, inexistente, bin(), LINK_PASTA)) return;
  assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'bin_invalido' });
  assert.equal(fs.existsSync(inexistente), false);
});

test('bin/ como arquivo: bin_invalido e o arquivo fica como estava', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.writeFileSync(bin(), 'lixo');
  assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'bin_invalido' });
  assert.equal(ler(bin()), 'lixo');
});

test('raiz inválida é recusada e nada é escrito', (t) => {
  const vazia = path.join(home, 'vazia');
  fs.mkdirSync(vazia);
  const comPasta = path.join(home, 'com pasta');
  fs.mkdirSync(path.join(comPasta, 'src', 'statusline.js'), { recursive: true });
  const soCli = path.join(home, 'so cli');
  fs.mkdirSync(path.join(soCli, 'src'), { recursive: true });
  fs.writeFileSync(path.join(soCli, 'src', 'cli.js'), '');
  const valida = criarRaiz(path.join(home, 'valida'));
  const casos = [
    undefined, null, 42, {}, ['/x'], '', 'relativo/plugin', 'C:plugin', '.',
    path.join(home, 'nul\0dentro'), `${valida}\0`,
    path.join(home, 'nao-existe'), vazia, comPasta, soCli,
    // O alvo é um arquivo, não uma raiz.
    path.join(valida, 'src', 'statusline.js'),
  ];
  const antes = arvore(home);
  for (const raiz of casos) {
    assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'raiz_invalida' }, JSON.stringify(raiz));
  }
  // Relativo que, resolvido contra o cwd, daria numa raiz válida: recusado mesmo assim.
  const cwd = process.cwd();
  try {
    process.chdir(home);
    for (const raiz of ['valida', `.${path.sep}valida`]) {
      assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'raiz_invalida' }, raiz);
    }
  } finally {
    process.chdir(cwd);
  }
  assert.deepEqual(arvore(home), antes);
  assert.equal(fs.existsSync(bin()), false);
  // statusline.js que é junção (ou symlink de pasta) para uma pasta: recusado.
  const comLink = path.join(home, 'com link');
  fs.mkdirSync(path.join(comLink, 'src'), { recursive: true });
  if (!link(t, vazia, path.join(comLink, 'src', 'statusline.js'), LINK_PASTA)) return;
  assert.deepEqual(sincronizarShims(comLink), { ok: false, motivo: 'raiz_invalida' });
  assert.equal(fs.existsSync(bin()), false);
});

// O loader de ESM do Node recusa URL de arquivo com / ou \ codificado
// (ERR_INVALID_MODULE_SPECIFIER). No POSIX um \ no nome de pasta vira %5C: um
// shim com essa URL falharia a cada redesenho, então a raiz é recusada antes.
test('raiz com barra invertida no nome (POSIX): recusada, o loader não a importaria', { skip: process.platform === 'win32' && 'no Windows \\ é separador' }, () => {
  for (const nome of ['a\\b', '\\', 'x\\src']) {
    const raiz = criarRaiz(path.join(home, nome));
    assert.deepEqual(sincronizarShims(raiz), { ok: false, motivo: 'raiz_invalida' }, nome);
  }
  assert.equal(fs.existsSync(bin()), false);
  // Um %5C literal no nome vira %255C e continua importável.
  const literal = criarRaiz(path.join(home, 'a%5Cb %2F'));
  assert.equal(sincronizarShims(literal).ok, true);
  const p = rodarShim('statusline.mjs');
  assert.equal(p.status, 0, p.stderr);
  assert.equal(fileURLToPath(p.stdout.split(' ')[1]), fs.realpathSync(path.join(literal, 'src', 'statusline.js')));
});

test('raiz cujo statusline.js é symlink de arquivo: recusada', (t) => {
  const valida = criarRaiz(path.join(home, 'valida'));
  const comLink = path.join(home, 'com link');
  fs.mkdirSync(path.join(comLink, 'src'), { recursive: true });
  if (!link(t, path.join(valida, 'src', 'statusline.js'), path.join(comLink, 'src', 'statusline.js'), 'file')) return;
  assert.deepEqual(sincronizarShims(comLink), { ok: false, motivo: 'raiz_invalida' });
  assert.equal(fs.existsSync(bin()), false);
});

test('raiz com aspas, apóstrofo, $, espaço, ç, #, % e ; importa o alvo certo', () => {
  const nomes = ["plug 'a' $HOME ç #1 %41 ;b &c `d` (e)", 'só ç', 'x#y', 'a%2Fb', 'a%5cb', '$(id)'];
  // Aspas e quebra de linha não são nomes válidos no Windows.
  if (process.platform !== 'win32') nomes.push('x");import("node:child_process', 'l1\nl2');
  for (const nome of nomes) {
    const raiz = criarRaiz(path.join(home, nome));
    const r = sincronizarShims(raiz);
    assert.equal(r.ok, true, `${JSON.stringify(nome)}: ${JSON.stringify(r)}`);
    for (const shim of SHIMS) {
      const conteudo = ler(arqShim(shim));
      assert.equal(conteudo, esperado(raiz, shim), nome);
      assert.match(conteudo, FORMATO[shim], JSON.stringify(conteudo));
      const p = rodarShim(shim);
      assert.equal(p.status, 0, `${JSON.stringify(nome)} ${shim}: ${p.stderr}`);
      const [marcador, url] = p.stdout.split(' ');
      assert.equal(marcador, shim === 'cli.mjs' ? 'alvo-cli' : 'alvo-statusline', nome);
      // O loader devolve o caminho real (no macOS o tmpdir passa por /var -> /private/var).
      assert.equal(fileURLToPath(url), fs.realpathSync(path.join(raiz, 'src', ALVO[shim])), nome);
    }
  }
});

test('sem diretório de dados: sem_diretorio e nenhum I/O', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  delete process.env.HADOUKEN_HOME;
  const homedirOriginal = os.homedir;
  const metodos = [
    'lstatSync', 'statSync', 'mkdirSync', 'writeFileSync', 'openSync', 'renameSync', 'unlinkSync', 'readFileSync', 'existsSync', 'rmSync',
    'readdirSync', 'opendirSync', 'chmodSync', 'fchmodSync',
  ];
  const originais = Object.fromEntries(metodos.map((m) => [m, fs[m]]));
  const chamadas = [];
  try {
    for (const falso of [() => { throw new Error('sem home'); }, () => '', () => 'relativo/home', () => undefined]) {
      os.homedir = falso;
      // Falha antes de sincronizar: se a troca não valesse, os shims de verdade
      // do desenvolvedor seriam reescritos para uma pasta temporária.
      assert.equal(dirDados(), null);
      for (const m of metodos) fs[m] = (...args) => { chamadas.push(m); return originais[m](...args); };
      const r = sincronizarShims(raiz);
      for (const m of metodos) fs[m] = originais[m];
      assert.deepEqual(r, { ok: false, motivo: 'sem_diretorio' });
    }
  } finally {
    for (const m of metodos) fs[m] = originais[m];
    os.homedir = homedirOriginal;
  }
  assert.deepEqual(chamadas, []);
});

test('raiz que não é string, mesmo hostil, é recusada sem ser lida', () => {
  const hostil = { toString() { throw new Error('x'); } };
  assert.deepEqual(sincronizarShims(hostil), { ok: false, motivo: 'raiz_invalida' });
  const proxy = new Proxy({}, { get() { throw new Error('x'); } });
  assert.deepEqual(sincronizarShims(proxy), { ok: false, motivo: 'raiz_invalida' });
});

// Nunca lança (m-1): cada try/catch de shim.js é exercitado por um lançamento
// de verdade, inclusive de valor sem `code`.
test('nunca lança: rename que lança {} num shim vira motivo "shim" e o outro shim é gravado', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const original = fs.renameSync;
  let r;
  try {
    fs.renameSync = (de, para) => {
      if (path.basename(para) === 'statusline.mjs') throw {};
      return original(de, para);
    };
    r = sincronizarShims(raiz);
  } finally {
    fs.renameSync = original;
  }
  assert.deepEqual(r, { ok: false, motivo: 'shim' });
  // O temporário do shim que falhou foi apagado; o outro shim chegou.
  assert.deepEqual(fs.readdirSync(bin()), ['cli.mjs']);
  assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
});

test('nunca lança: lstat que lança {} na checagem da raiz vira raiz_invalida', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const original = fs.lstatSync;
  let r;
  try {
    fs.lstatSync = () => { throw {}; };
    r = sincronizarShims(raiz);
  } finally {
    fs.lstatSync = original;
  }
  assert.deepEqual(r, { ok: false, motivo: 'raiz_invalida' });
  assert.equal(fs.existsSync(bin()), false);
});

test('nunca lança: HADOUKEN_HOME que é arquivo devolve o código do sistema e nada é escrito', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const arquivo = path.join(home, 'nao e pasta');
  fs.writeFileSync(arquivo, 'conteudo');
  process.env.HADOUKEN_HOME = arquivo;
  const antes = arvore(home);
  const r = sincronizarShims(raiz);
  assert.equal(r.ok, false);
  assert.ok(['ENOTDIR', 'EEXIST'].includes(r.motivo), JSON.stringify(r));
  assert.deepEqual(arvore(home), antes);
});

test('shim executa a statusline de verdade para sessão registrada (caminho com espaço)', () => {
  assert.deepEqual(registrarSessao('s1', Date.now()), { ok: true });
  assert.deepEqual(sincronizarShims(repo), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  const r = rodarShim('statusline.mjs', '{"session_id":"s1"}');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /5h —/);
  assert.ok(!r.stdout.includes('\n'));
});

test('shim com sessão não registrada: nada impresso e nada gravado', () => {
  registrarSessao('outra', Date.now());
  sincronizarShims(repo);
  const antes = arvore(home);
  for (const stdin of ['{"session_id":"s1"}', '{}', '']) {
    const r = rodarShim('statusline.mjs', stdin, { NODE_COMPILE_CACHE: undefined });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, '', stdin);
  }
  assert.deepEqual(arvore(home), antes);
});

// I-2: o plugin foi atualizado e a versão velha apagada antes do próximo
// SessionStart. A barra não pode sair com código 1 nem imprimir stack trace.
test('raiz apagada: statusline.mjs sai 0 calada; cli.mjs sai 1 com uma linha ASCII', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  assert.equal(sincronizarShims(raiz).ok, true);
  fs.rmSync(raiz, { recursive: true, force: true });
  const barra = rodarShim('statusline.mjs', '{"session_id":"s1"}');
  assert.equal(barra.error, undefined, String(barra.error));
  assert.equal(barra.status, 0, barra.stderr);
  assert.equal(barra.stdout, '');
  assert.equal(barra.stderr, '');
  const cli = rodarShim('cli.mjs');
  assert.equal(cli.error, undefined, String(cli.error));
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(cli.stdout, '');
  assert.match(cli.stderr, /^[\x20-\x7e]+\n$/);
  assert.equal(cli.stderr, `${LINHA_CLI}\n`);
});

// Roda cli.mjs com src/cli.js trocado por `fonte` (texto, ou função que recebe
// o caminho do alvo exatamente como o shim o vê, sem realpath).
function rodarCliCom(fonte) {
  const raiz = criarRaiz(path.join(home, 'p'));
  const alvo = path.join(raiz, 'src', 'cli.js');
  fs.writeFileSync(alvo, typeof fonte === 'function' ? fonte(alvo) : fonte);
  assert.equal(sincronizarShims(raiz).ok, true);
  return rodarShim('cli.mjs');
}

function confereLinha(r, esperada, rotulo) {
  assert.equal(r.error, undefined, `${rotulo}: ${String(r.error)}`);
  assert.equal(r.status, 1, `${rotulo}: ${r.stderr}`);
  assert.equal(r.stdout, '', rotulo);
  assert.match(r.stderr, /^[\x20-\x7e]+\n$/, rotulo);
  assert.equal(r.stderr, esperada, rotulo);
}

// Só o alvo sumido é "plugin files not found"; um erro dentro do alvo (inclusive
// um import dele que falta) é "internal error", senão o usuário abriria uma
// sessão nova à toa e o defeito ficaria escondido.
test('cli.mjs: erro dentro do alvo sai 1 com "internal error (<code ou name>)", sem stack', () => {
  const casos = [
    ['TypeError do alvo', 'null.x;\n', 'TypeError'],
    ['import estático do alvo que falta', "import './nao-existe.js';\n", 'ERR_MODULE_NOT_FOUND'],
    ['import dinâmico do alvo que falta', "await import('./tambem-nao.js');\n", 'ERR_MODULE_NOT_FOUND'],
    ['pacote que falta', "import 'pacote-que-nao-existe-hdk';\n", 'ERR_MODULE_NOT_FOUND'],
  ];
  for (const [rotulo, fonte, token] of casos) {
    const r = rodarCliCom(fonte);
    confereLinha(r, linhaInterna(token), rotulo);
    assert.ok(!r.stderr.includes('plugin files not found'), rotulo);
    fs.rmSync(path.join(home, 'p'), { recursive: true, force: true });
  }
});

test('cli.mjs: o token do erro interno é saneado (letras, dígitos e _, no máximo 40)', () => {
  const hostil = `ab-c dç\n\u001b[1m;"'(e)${'Z'.repeat(60)}`;
  const casos = [
    ['code hostil e longo', `throw Object.assign(new Error('x'), { code: ${JSON.stringify(hostil)} });\n`, `abcd1me${'Z'.repeat(33)}`],
    ['code que não é string: vale o name', "throw { code: 42, name: 'Meu Erro!' };\n", 'MeuErro'],
    ['code que saneado fica vazio: vale o name', `throw Object.assign(new TypeError('x'), { code: ${JSON.stringify('çã -')} });\n`, 'TypeError'],
    ['name longo', `throw { name: ${JSON.stringify('N'.repeat(100))} };\n`, 'N'.repeat(40)],
    ['throw null', 'throw null;\n', 'unknown'],
    ['throw de string', "throw 'texto com espaco';\n", 'unknown'],
    // Só `code` lança: um Proxy que lança em todo get é lido pelo próprio loader,
    // e o que chega ao .catch já é o Error da armadilha. Aqui quem lê é o handler.
    ['Proxy que lança ao ler code', "throw new Proxy({}, { get(t, k) { if (k === 'code') throw new Error('armadilha'); return undefined; } });\n", 'unknown'],
    // Código certo, mas o módulo que falta é outro (e.url diferente).
    ['ERR_MODULE_NOT_FOUND de outra URL', "throw { code: 'ERR_MODULE_NOT_FOUND', url: 'file:///outro.js', message: 'x' };\n", 'ERR_MODULE_NOT_FOUND'],
    // URL certa, mas o código é outro.
    ['e.url do alvo com outro code', (alvo) => `throw { code: 'ERR_OUTRO', url: ${JSON.stringify(pathToFileURL(alvo).href)} };\n`, 'ERR_OUTRO'],
  ];
  for (const [rotulo, fonte, token] of casos) {
    assert.ok(token.length <= 40 && /^[A-Za-z0-9_]+$/.test(token), rotulo);
    confereLinha(rodarCliCom(fonte), linhaInterna(token), rotulo);
    fs.rmSync(path.join(home, 'p'), { recursive: true, force: true });
  }
});

// Node 20.0 a 20.9 não põem `url` no ERR_MODULE_NOT_FOUND; aí vale a mensagem,
// que traz caminhos (nunca a URL): "Cannot find module '<o que falta>'
// imported from <quem importou>". Só o caminho do alvo no primeiro lugar conta;
// no import que falta dentro do alvo, o caminho do alvo vem depois.
test('cli.mjs sem e.url (Node 20.0 a 20.9): decide pelo caminho do alvo no início da mensagem', () => {
  const lancar = (sufixo) => (alvo) => `const p = ${JSON.stringify(alvo)};\nthrow { code: 'ERR_MODULE_NOT_FOUND', ${sufixo} };\n`;
  const casos = [
    ['o alvo é o que falta', lancar(`message: "Cannot find module '" + p + "' imported from x"`), `${LINHA_CLI}\n`],
    ['o alvo só importou o que falta', lancar(`message: "Cannot find module '" + p + ".nao' imported from " + p`), linhaInterna('ERR_MODULE_NOT_FOUND')],
    ['caminho do alvo só no "imported from"', lancar(`message: "Cannot find module '/x/nao-existe.js' imported from " + p`), linhaInterna('ERR_MODULE_NOT_FOUND')],
    ['mensagem que não é string', lancar('message: 42'), linhaInterna('ERR_MODULE_NOT_FOUND')],
    // Com e.url presente e diferente, a mensagem não é consultada.
    ['e.url de outro módulo', lancar(`url: 'file:///outro.js', message: "Cannot find module '" + p + "' imported from x"`), linhaInterna('ERR_MODULE_NOT_FOUND')],
  ];
  for (const [rotulo, fonte, esperada] of casos) {
    confereLinha(rodarCliCom(fonte), esperada, rotulo);
    fs.rmSync(path.join(home, 'p'), { recursive: true, force: true });
  }
});

// I-4: um processo morto entre a escrita do temporário e o rename deixa
// .<shim>.<hex>.tmp em bin/. Toda sincronização varre (não só a que grava).
test('varredura de bin/: só temporário velho, arquivo regular e com o nome exato sai', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  const plantar = (p) => { fs.writeFileSync(p, 'x'); return p; };
  const velho = plantar(tmpDe('statusline.mjs', 'a1b2c3d4e5f6'));
  envelhecer(velho);
  const velhoCli = plantar(tmpDe('cli.mjs', '00ff00ff00ff'));
  envelhecer(velhoCli);
  const novo = plantar(tmpDe('cli.mjs', '0123456789ab'));
  const pasta = tmpDe('statusline.mjs', 'abcdefabcdef');
  fs.mkdirSync(pasta);
  envelhecer(pasta);
  const alheios = [
    path.join(bin(), 'velho.txt'),
    path.join(bin(), '.statusline.mjs.123.456.0.tmp'),
    tmpDe('cli.mjs', 'ABCDEF123456'),
    tmpDe('outro.mjs', 'a1b2c3d4e5f6'),
    path.join(bin(), '.statusline.mjs.a1b2c3d4e5f6.tmp.bak'),
  ];
  for (const p of alheios) envelhecer(plantar(p));
  const fora = path.join(home, 'fora');
  fs.mkdirSync(fora);
  fs.writeFileSync(path.join(fora, 'sentinela.txt'), 'original');
  const juncao = tmpDe('cli.mjs', 'fedcbafedcba');
  if (!link(t, fora, juncao, LINK_PASTA)) return;
  envelhecer(juncao);
  // Shims já certos: nada a gravar, e a varredura roda assim mesmo.
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: [] });
  assert.equal(fs.existsSync(velho), false);
  assert.equal(fs.existsSync(velhoCli), false);
  assert.ok(fs.lstatSync(novo).isFile());
  assert.ok(fs.lstatSync(pasta).isDirectory());
  for (const p of alheios) assert.ok(fs.lstatSync(p).isFile(), p);
  assert.ok(fs.lstatSync(juncao).isSymbolicLink());
  assert.deepEqual(fs.readdirSync(fora), ['sentinela.txt']);
  assert.equal(ler(path.join(fora, 'sentinela.txt')), 'original');
});

test('varredura de bin/: no máximo 20 temporários por sincronização', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  for (let i = 0; i < 25; i++) {
    const p = tmpDe(i % 2 ? 'cli.mjs' : 'statusline.mjs', i.toString(16).padStart(12, '0'));
    fs.writeFileSync(p, 'x');
    envelhecer(p);
  }
  const temporarios = () => fs.readdirSync(bin()).filter((n) => NOME_TMP.test(n)).length;
  assert.equal(temporarios(), 25);
  sincronizarShims(raiz);
  assert.equal(temporarios(), 5);
  sincronizarShims(raiz);
  assert.equal(temporarios(), 0);
});

// N-2: a varredura listava bin/ inteira e fazia um lstat por nome de
// temporário; os novos nunca saem, então um bin/ inundado custava milhares de
// lstat em todo SessionStart. Agora o opendir lê no máximo 256 entradas, faz
// no máximo 64 lstat e 20 remoções, e o Dir é sempre fechado. O resto espera a
// próxima sincronização.
const LER_MAX = 256;
const LSTAT_MAX = 64;

// Cria (ou apaga) arquivos vazios de bin/ em lotes paralelos de 128: no
// Windows, com antivírus, um a um leva o dobro. Lotes pequenos deixam poucos
// descritores abertos ao mesmo tempo (macOS: limite padrão 256).
async function emLotes(nomes, fazer) {
  for (let i = 0; i < nomes.length; i += 128) {
    await Promise.all(nomes.slice(i, i + 128).map((n) => fazer(path.join(bin(), n))));
  }
}
const plantarMuitos = (nomes) => emLotes(nomes, (p) => fsp.writeFile(p, ''));

// Roda `executar` contando, pelo objeto padrão de node:fs: opendirSync, cada
// readSync e closeSync do Dir aberto, lstat de nome de temporário e
// readdirSync. `lerLanca`: todo readSync lança {}.
function espiarVarredura(executar, { lerLanca = false } = {}) {
  const originais = { opendirSync: fs.opendirSync, lstatSync: fs.lstatSync, readdirSync: fs.readdirSync };
  const c = { aberturas: 0, leituras: 0, fechamentos: 0, lstatTmp: 0, readdir: 0, resultado: undefined };
  try {
    fs.opendirSync = (...args) => {
      const dir = originais.opendirSync(...args);
      c.aberturas++;
      const lerDir = dir.readSync.bind(dir);
      const fecharDir = dir.closeSync.bind(dir);
      dir.readSync = () => {
        c.leituras++;
        if (lerLanca) throw {};
        return lerDir();
      };
      dir.closeSync = () => {
        c.fechamentos++;
        return fecharDir();
      };
      return dir;
    };
    fs.lstatSync = (p, ...resto) => {
      if (NOME_TMP.test(path.basename(p))) c.lstatTmp++;
      return originais.lstatSync(p, ...resto);
    };
    fs.readdirSync = (...args) => {
      c.readdir++;
      return originais.readdirSync(...args);
    };
    c.resultado = executar();
  } finally {
    Object.assign(fs, originais);
  }
  return c;
}

test('varredura de bin/ inundado (mais de 5 000 nomes): no máximo 256 entradas lidas e 64 lstat', async () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  // 5 001 temporários novos com o nome exato: nenhum sai (têm menos de 1 h).
  // Sem limite, cada sincronização faria 5 001 lstat.
  const nomes = Array.from({ length: 5001 }, (_, i) => `.${i % 2 ? 'cli' : 'statusline'}.mjs.${i.toString(16).padStart(12, '0')}.tmp`);
  assert.ok(nomes.every((n) => NOME_TMP.test(n)));
  try {
    await plantarMuitos(nomes);
    assert.equal(fs.readdirSync(bin()).length, nomes.length + SHIMS.length);
    // Shims já certos: nenhum temporário da escrita atômica entra na contagem.
    const c = espiarVarredura(() => sincronizarShims(raiz));
    assert.deepEqual(c.resultado, { ok: true, alterados: [] });
    assert.equal(c.readdir, 0, 'a pasta não é listada inteira');
    assert.equal(c.aberturas, 1);
    assert.equal(c.fechamentos, 1);
    assert.ok(c.leituras <= LER_MAX, `leituras: ${c.leituras}`);
    assert.ok(c.lstatTmp <= LSTAT_MAX, `lstat: ${c.lstatTmp}`);
    // Todo nome é temporário, então para no 64º lstat, em qualquer ordem da
    // pasta; no meio, no máximo os dois shims.
    assert.equal(c.lstatTmp, LSTAT_MAX);
    assert.ok(c.leituras <= LSTAT_MAX + SHIMS.length, `leituras: ${c.leituras}`);
    assert.equal(fs.readdirSync(bin()).length, nomes.length + SHIMS.length);
  } finally {
    // unlink em paralelo: no Windows, um terço do tempo do rmSync do afterEach.
    await emLotes(nomes, (p) => fsp.unlink(p).catch(() => {}));
  }
});

test('varredura de bin/: lê no máximo 256 entradas, mesmo sem nenhum temporário', async () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  await plantarMuitos(Array.from({ length: 300 }, (_, i) => `alheio-${i}.txt`));
  const c = espiarVarredura(() => sincronizarShims(raiz));
  assert.deepEqual(c.resultado, { ok: true, alterados: [] });
  assert.equal(c.readdir, 0);
  assert.equal(c.leituras, LER_MAX);
  assert.equal(c.lstatTmp, 0);
  assert.equal(c.fechamentos, 1);
});

test('varredura de bin/: o Dir é fechado mesmo quando a leitura lança, e o shim é restaurado', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  fs.writeFileSync(arqShim('statusline.mjs'), 'adulterado');
  const c = espiarVarredura(() => sincronizarShims(raiz), { lerLanca: true });
  assert.deepEqual(c.resultado, { ok: true, alterados: ['statusline.mjs'] });
  assert.equal(c.aberturas, 1);
  assert.equal(c.leituras, 1);
  assert.equal(c.fechamentos, 1);
  assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
  // opendir que lança: a varredura desiste e a sincronização segue.
  fs.writeFileSync(arqShim('cli.mjs'), 'adulterado');
  const original = fs.opendirSync;
  let r;
  try {
    fs.opendirSync = () => { throw {}; };
    r = sincronizarShims(raiz);
  } finally {
    fs.opendirSync = original;
  }
  assert.deepEqual(r, { ok: true, alterados: ['cli.mjs'] });
  assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
});

// I-5: um shim adulterado e marcado somente leitura (attrib +R no Windows)
// fazia o rename falhar com EPERM a cada sessão, e a adulteração ficava.
test('shim adulterado e somente leitura é restaurado', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  fs.writeFileSync(arqShim('statusline.mjs'), "import('node:child_process').then((c) => c.execSync('echo pwned'));\n");
  fs.chmodSync(arqShim('statusline.mjs'), 0o444);
  assert.equal(fs.lstatSync(arqShim('statusline.mjs')).mode & 0o200, 0);
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs'] });
  assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
  assert.deepEqual(fs.readdirSync(bin()).sort(), ['cli.mjs', 'statusline.mjs']);
});

test('bin/ sem escrita para o dono volta a 0o700 e o shim é restaurado (POSIX)', { skip: process.platform === 'win32' && 'modo de pasta é do POSIX' }, () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  fs.writeFileSync(arqShim('statusline.mjs'), 'adulterado');
  fs.chmodSync(bin(), 0o555);
  try {
    assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: ['statusline.mjs'] });
    assert.equal(fs.lstatSync(bin()).mode & 0o777, 0o700);
    assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
  } finally {
    try { fs.chmodSync(bin(), 0o700); } catch { /* o afterEach apaga */ }
  }
});

// N-1: um hard link no lugar do shim divide o arquivo com um nome fora de
// bin/, e tirar o somente leitura (fchmod) mudaria o arquivo de fora também.
// O_NOFOLLOW não barra isso, porque hard link não é symlink. Com nlink > 1
// nada é tocado. No Windows o rename por cima do somente leitura dá EPERM e a
// falha aparece (shim_invalido). No POSIX o rename troca só a entrada de bin/.
// fs.linkSync não pede privilégio (NTFS nem POSIX).
function hardLink(t, alvo, caminho) {
  try {
    fs.linkSync(alvo, caminho);
    return true;
  } catch (e) {
    t.skip(`hard link indisponivel aqui (${e.code})`);
    return false;
  }
}

// Arquivo de fora, somente leitura, e o shim de statusline trocado por um hard
// link para ele. Devolve [caminho de fora, modo de fora] ou null (sem hard link).
function shimHardLink(t) {
  const fora = path.join(home, 'fora.txt');
  fs.writeFileSync(fora, 'original de fora');
  fs.chmodSync(fora, 0o444);
  fs.unlinkSync(arqShim('statusline.mjs'));
  if (!hardLink(t, fora, arqShim('statusline.mjs'))) return null;
  assert.equal(fs.lstatSync(arqShim('statusline.mjs')).nlink, 2);
  return [fora, fs.lstatSync(fora).mode];
}

const erroEperm = () => Object.assign(new Error('EPERM'), { code: 'EPERM' });

test('shim somente leitura que é hard link para um arquivo de fora: o arquivo de fora não muda', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  const plantado = shimHardLink(t);
  if (plantado === null) return;
  const [fora, modoFora] = plantado;
  try {
    const r = sincronizarShims(raiz);
    assert.equal(fs.lstatSync(fora).mode, modoFora);
    assert.equal(fs.lstatSync(fora).mode & 0o200, 0);
    assert.equal(ler(fora), 'original de fora');
    assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
    assert.deepEqual(fs.readdirSync(bin()).sort(), ['cli.mjs', 'statusline.mjs']);
    if (process.platform === 'win32') {
      assert.deepEqual(r, { ok: false, motivo: 'shim_invalido' });
      // Recusado sem tocar: a entrada de bin/ continua o hard link.
      assert.equal(fs.lstatSync(arqShim('statusline.mjs')).nlink, 2);
      assert.equal(ler(arqShim('statusline.mjs')), 'original de fora');
    } else {
      assert.deepEqual(r, { ok: true, alterados: ['statusline.mjs'] });
      assert.equal(ler(arqShim('statusline.mjs')), esperado(raiz, 'statusline.mjs'));
      assert.equal(fs.lstatSync(fora).nlink, 1);
    }
  } finally {
    try { fs.chmodSync(fora, 0o666); } catch { /* o afterEach apaga */ }
  }
});

// O lstat pode não ver o hard link (criado entre o lstat e o open): a
// checagem pelo descritor recusa também. O rename espiado dá o EPERM do
// Windows em qualquer plataforma.
test('hard link que só o fstat vê: recusado, e o arquivo de fora não muda', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  const plantado = shimHardLink(t);
  if (plantado === null) return;
  const [fora, modoFora] = plantado;
  const shim = arqShim('statusline.mjs');
  const originais = { lstatSync: fs.lstatSync, renameSync: fs.renameSync };
  let r;
  try {
    fs.lstatSync = (p, ...resto) => {
      const s = originais.lstatSync(p, ...resto);
      if (s && path.resolve(p) === shim) Object.defineProperty(s, 'nlink', { value: 1 });
      return s;
    };
    fs.renameSync = (de, para) => {
      if (path.resolve(para) === shim) throw erroEperm();
      return originais.renameSync(de, para);
    };
    r = sincronizarShims(raiz);
  } finally {
    Object.assign(fs, originais);
  }
  try {
    assert.deepEqual(r, { ok: false, motivo: 'shim_invalido' });
    assert.equal(fs.lstatSync(fora).mode, modoFora);
    assert.equal(ler(fora), 'original de fora');
    assert.equal(fs.lstatSync(shim).nlink, 2);
    assert.deepEqual(fs.readdirSync(bin()).sort(), ['cli.mjs', 'statusline.mjs']);
  } finally {
    try { fs.chmodSync(fora, 0o666); } catch { /* o afterEach apaga */ }
  }
});

// Tirar o somente leitura soma só a escrita do dono (modo | 0o200), sem abrir
// grupo e outros (antes era um 0o644 fixo). O rename espiado dá um EPERM na
// primeira tentativa, para o caminho rodar também no POSIX.
test('tirar o somente leitura só soma a escrita do dono', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  const shim = arqShim('statusline.mjs');
  fs.writeFileSync(shim, 'adulterado');
  fs.chmodSync(shim, 0o440);
  // 0o440 no POSIX; no Windows o Node mostra 0o444 para somente leitura.
  const antes = fs.lstatSync(shim).mode & 0o777;
  const originais = { fchmodSync: fs.fchmodSync, renameSync: fs.renameSync };
  const modos = [];
  let primeira = true;
  let r;
  try {
    fs.fchmodSync = (fd, modo) => {
      modos.push(modo);
      return originais.fchmodSync(fd, modo);
    };
    fs.renameSync = (de, para) => {
      if (primeira && path.resolve(para) === shim) {
        primeira = false;
        throw erroEperm();
      }
      return originais.renameSync(de, para);
    };
    r = sincronizarShims(raiz);
  } finally {
    Object.assign(fs, originais);
  }
  assert.deepEqual(r, { ok: true, alterados: ['statusline.mjs'] });
  assert.deepEqual(modos, [antes | 0o200]);
  assert.equal(ler(shim), esperado(raiz, 'statusline.mjs'));
});

// m-2: o nome do temporário leva 12 hex de crypto.randomBytes(6); com nome
// previsível dava para plantar um link ali antes da escrita.
test('temporário da escrita atômica: nome imprevisível, sempre dentro de bin/', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const original = fs.renameSync;
  const usados = [];
  try {
    fs.renameSync = (de, para) => { usados.push([de, para]); return original(de, para); };
    assert.equal(sincronizarShims(raiz).ok, true);
  } finally {
    fs.renameSync = original;
  }
  assert.equal(usados.length, 2);
  for (const [de, para] of usados) {
    assert.equal(path.dirname(de), bin());
    assert.match(path.basename(de), NOME_TMP);
    assert.ok(path.basename(de).startsWith(`.${path.basename(para)}.`), de);
  }
  const hex = (de) => path.basename(de).split('.').at(-2);
  assert.notEqual(hex(usados[0][0]), hex(usados[1][0]));
});

test('link pendente plantado no nome do temporário: nada é criado fora de bin/', (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  fs.mkdirSync(bin());
  const HEX = 'a1b2c3d4e5f6';
  const alvo = path.join(home, 'criado fora');
  const plantado = tmpDe('statusline.mjs', HEX);
  if (!link(t, alvo, plantado, LINK_PASTA)) return;
  const original = crypto.randomBytes;
  let r;
  try {
    crypto.randomBytes = () => Buffer.from(HEX, 'hex');
    r = sincronizarShims(raiz);
  } finally {
    crypto.randomBytes = original;
  }
  assert.equal(fs.existsSync(alvo), false);
  assert.deepEqual(r, { ok: false, motivo: 'EEXIST' });
  assert.ok(fs.lstatSync(plantado).isSymbolicLink());
  assert.equal(fs.existsSync(arqShim('statusline.mjs')), false);
  assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
});

// O fstat depois do 'wx' (como em ativas.js) só acusa algo numa corrida entre
// o lstat e o open; aqui ele é forçado. O shim não é trocado pelo que foi
// aberto, e o que ficou no nome sorteado não é apagado (pode não ser nosso);
// se for arquivo regular, a varredura o leva depois de 1 h.
test('temporário aberto que não é arquivo regular: tmp_invalido e o shim não é trocado', () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  sincronizarShims(raiz);
  fs.writeFileSync(arqShim('statusline.mjs'), 'adulterado');
  const original = fs.fstatSync;
  let r;
  try {
    fs.fstatSync = () => ({ isFile: () => false, size: -1, mode: 0 });
    r = sincronizarShims(raiz);
  } finally {
    fs.fstatSync = original;
  }
  assert.deepEqual(r, { ok: false, motivo: 'tmp_invalido' });
  assert.equal(ler(arqShim('statusline.mjs')), 'adulterado');
  assert.equal(ler(arqShim('cli.mjs')), esperado(raiz, 'cli.mjs'));
  const sobras = fs.readdirSync(bin()).filter((n) => !SHIMS.includes(n));
  assert.equal(sobras.length, 2, JSON.stringify(sobras));
  for (const n of sobras) assert.match(n, NOME_TMP);
});

// m-3: \\?\ e \\.\ são o namespace de dispositivo do Windows; como raiz de
// plugin, recusados (\\.\ nem gera URL importável). No POSIX não há esse
// namespace: //./tmp/p é só /tmp/p, uma raiz legítima.
test('raiz no namespace de dispositivo do Windows é recusada', { skip: process.platform !== 'win32' && 'namespace de dispositivo é do Windows' }, () => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const B = '\\';
  const casos = [`${B}${B}?${B}${raiz}`, `${B}${B}.${B}${raiz}`, `//?/${raiz}`, `//./${raiz}`, `${B}${B}?${B}UNC${B}127.0.0.1${B}x`];
  for (const caso of casos) {
    assert.deepEqual(sincronizarShims(caso), { ok: false, motivo: 'raiz_invalida' }, JSON.stringify(caso));
  }
  assert.equal(fs.existsSync(bin()), false);
});

test('raiz UNC (\\\\servidor\\compartilhamento) continua aceita (Windows)', { skip: process.platform !== 'win32' && 'UNC é do Windows' }, (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const unc = `\\\\127.0.0.1\\${raiz[0]}$${raiz.slice(2)}`;
  try {
    fs.lstatSync(path.join(unc, 'src', 'statusline.js'));
  } catch (e) {
    t.skip(`compartilhamento administrativo indisponivel (${e.code})`);
    return;
  }
  assert.deepEqual(sincronizarShims(unc), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  const conteudo = ler(arqShim('statusline.mjs'));
  assert.equal(conteudo, esperado(unc, 'statusline.mjs'));
  assert.ok(conteudo.startsWith('await import("file://127.0.0.1/'), conteudo);
  const p = rodarShim('statusline.mjs');
  assert.equal(p.status, 0, p.stderr);
  assert.ok(p.stdout.startsWith('alvo-statusline file://127.0.0.1/'), p.stdout);
});

// Ida e volta: a raiz só é aceita se fileURLToPath(pathToFileURL(raiz)) der o
// mesmo caminho (sem diferenciar maiúsculas no Windows). \\localhost\C$\... é
// lido pelo sistema, mas a URL perde o host (file:///C$/...) e o import do
// shim falharia a cada redesenho.
// Título sem barra invertida: o parser de TAP do Node 20.0 o truncava e perdia o SKIP.
test('raiz UNC em localhost é recusada: a URL perde o host (Windows)', { skip: process.platform !== 'win32' && 'UNC é do Windows' }, (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const unc = `\\\\localhost\\${raiz[0]}$${raiz.slice(2)}`;
  try {
    fs.lstatSync(path.join(unc, 'src', 'statusline.js'));
  } catch (e) {
    t.skip(`compartilhamento administrativo indisponivel (${e.code})`);
    return;
  }
  assert.equal(pathToFileURL(unc).host, '');
  for (const caso of [unc, `\\\\LOCALHOST\\${raiz[0]}$${raiz.slice(2)}`, `//localhost/${raiz[0]}$${raiz.slice(2).replaceAll('\\', '/')}`]) {
    assert.deepEqual(sincronizarShims(caso), { ok: false, motivo: 'raiz_invalida' }, caso);
  }
  assert.equal(fs.existsSync(bin()), false);
});

// A URL põe o host em minúsculas; no Windows nome de máquina não diferencia
// maiúsculas, então \\NOME-DA-MAQUINA\... segue aceito.
test('raiz UNC com o nome da máquina em maiúsculas continua aceita (Windows)', { skip: process.platform !== 'win32' && 'UNC é do Windows' }, (t) => {
  const raiz = criarRaiz(path.join(home, 'p'));
  const unc = `\\\\${os.hostname().toUpperCase()}\\${raiz[0]}$${raiz.slice(2)}`;
  try {
    fs.lstatSync(path.join(unc, 'src', 'statusline.js'));
  } catch (e) {
    t.skip(`compartilhamento administrativo indisponivel (${e.code})`);
    return;
  }
  let volta;
  try { volta = fileURLToPath(pathToFileURL(unc)); } catch (e) { volta = `erro ${e.code}`; }
  if (volta === unc || volta.toLowerCase() !== unc.toLowerCase()) {
    t.skip(`ida e volta nao difere so na caixa aqui (${volta})`);
    return;
  }
  assert.deepEqual(sincronizarShims(unc), { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  const p = rodarShim('statusline.mjs');
  assert.equal(p.status, 0, p.stderr);
  assert.ok(p.stdout.startsWith(`alvo-statusline file://${os.hostname().toLowerCase()}/`), p.stdout);
});

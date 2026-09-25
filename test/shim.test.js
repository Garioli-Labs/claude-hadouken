import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
const MODELO = {
  'statusline.mjs': (url) => `await import(${JSON.stringify(url)}).catch(() => {});\n`,
  // `\\n` aqui vira os dois caracteres \n dentro do shim: continua uma linha só.
  'cli.mjs': (url) => `await import(${JSON.stringify(url)}).catch(() => { process.stderr.write("${LINHA_CLI}\\n"); process.exitCode = 1; });\n`,
};
// Uma linha só, ASCII imprimível, e nenhuma aspa dentro da URL.
const FORMATO = {
  'statusline.mjs': /^await import\("file:\/\/[\x21\x23-\x7e]+"\)\.catch\(\(\) => \{\}\);\n$/,
  'cli.mjs': /^await import\("file:\/\/[\x21\x23-\x7e]+"\)\.catch\(\(\) => \{ process\.stderr\.write\("claude-hadouken: plugin files not found - open a new session\\n"\); process\.exitCode = 1; \}\);\n$/,
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
  assert.equal(ler(arqShim('cli.mjs')), `await import(${url('cli.js')}).catch(() => { process.stderr.write("claude-hadouken: plugin files not found - open a new session\\n"); process.exitCode = 1; });\n`);
  for (const nome of SHIMS) assert.equal(ler(arqShim(nome)).split('\n').length, 2, `${nome}: uma linha só`);
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

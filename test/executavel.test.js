import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { lerOrigin } from '../src/consumo.js';
import { resolverExecutavel } from '../src/executavel.js';
import { criarExecutorGh } from '../src/github.js';

// Sequestro de executável (fix round 1 da Task 10, Critical 1): o libuv do
// Node 20 no Windows procura um nome solto no cwd do filho antes do PATH, o
// do Node 24 segue uma entrada "." do PATH, e no POSIX uma entrada vazia ou
// "." faz o mesmo. O cwd do /consumo é um repo que pode ser hostil: um
// git.exe/gh.exe plantado nele nunca pode rodar. As sentinelas gravam o
// próprio caminho num arquivo de marca, então cada teste diz qual executável
// rodou, e não só se algum rodou. O gh de verdade nunca roda aqui.

const win = process.platform === 'win32';
const EXE = win ? '.exe' : '';
const tmps = [];
const novoTmp = (prefixo) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  tmps.push(d);
  return d;
};
// Um executável que acabou de sair ainda pode estar preso no Windows por
// alguns milissegundos: a remoção tenta de novo.
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

// No Windows, cada sentinela é um hard link de uma cópia do node.exe (o do
// Program Files não aceita hard link), que roda o preload de NODE_OPTIONS.
let baseNode = null;
function nodeBase() {
  if (baseNode === null) {
    baseNode = path.join(novoTmp('hdk base '), 'node.exe');
    fs.copyFileSync(process.execPath, baseNode);
  }
  return baseNode;
}

const aspasSh = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const GRANDE = 100_000;

// Cenário de sentinelas. Cada sentinela grava o próprio pid em `pid` e o
// próprio caminho em `marca`, escreve um origin do GitHub no stdout e sai
// com 0. Opções, na ordem em que agem: `stdin` lê o stdin até o fim;
// `stderr` escreve 100 000 bytes no stderr; `stdoutGrande` escreve 100 000
// bytes no stdout antes do origin; `dorme` fica parado 30 s em vez de sair.
// No Windows o comportamento vem do preload, síncrono, porque o node segue
// depois para o argv do git e sairia (process.execPath é o caminho do link);
// no POSIX, de um script sh com bit de execução e ferramentas por caminho
// absoluto (o PATH dos testes não tem /bin).
function cenario({ stdin = false, stderr = false, stdoutGrande = false, dorme = false } = {}) {
  const pasta = novoTmp('hdk marca ç ');
  const marca = path.join(pasta, 'marca');
  const arqPid = path.join(pasta, 'pid');
  let nodeOptions;
  if (win) {
    const pre = path.join(pasta, 'pre.cjs');
    fs.writeFileSync(pre, [
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(arqPid)}, String(process.pid));`,
      stdin ? 'fs.readFileSync(0);' : '',
      stderr ? `fs.writeSync(2, 'x'.repeat(${GRANDE}));` : '',
      `fs.appendFileSync(${JSON.stringify(marca)}, process.execPath + '\\n');`,
      stdoutGrande ? `fs.writeSync(1, 'x'.repeat(${GRANDE}));` : '',
      "fs.writeSync(1, 'https://github.com/o/r\\n');",
      dorme ? 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);' : '',
      'process.exit(0);',
    ].join('\n'));
    nodeOptions = `--require ${JSON.stringify(pre)}`;
  }
  const criar = (dir, nome) => {
    const arq = path.join(dir, nome + EXE);
    if (win) {
      try { fs.linkSync(nodeBase(), arq); } catch { fs.copyFileSync(nodeBase(), arq); }
    } else {
      fs.writeFileSync(arq, [
        '#!/bin/sh',
        `printf '%s' "$$" > ${aspasSh(arqPid)}`,
        stdin ? '/bin/cat > /dev/null' : '',
        stderr ? `/usr/bin/head -c ${GRANDE} /dev/zero | /usr/bin/tr '\\000' x >&2` : '',
        `printf '%s\\n' ${aspasSh(arq)} >> ${aspasSh(marca)}`,
        stdoutGrande ? `/usr/bin/head -c ${GRANDE} /dev/zero | /usr/bin/tr '\\000' x` : '',
        "printf 'https://github.com/o/r\\n'",
        dorme ? 'exec /bin/sleep 30' : '',
        '',
      ].join('\n'));
      fs.chmodSync(arq, 0o755);
    }
    return arq;
  };
  const rodaram = () => {
    try {
      return fs.readFileSync(marca, 'utf8').split('\n').filter(Boolean).map(normal);
    } catch {
      return [];
    }
  };
  const pid = () => Number(fs.readFileSync(arqPid, 'utf8'));
  return { criar, rodaram, pid, nodeOptions };
}

const normal = (p) => (win ? path.resolve(p).toLowerCase() : path.resolve(p));
const juntar = (...partes) => partes.join(path.delimiter);
// Entradas que um PATH descuidado tem e que apontam para o cwd do filho.
const RELATIVAS = ['', '.'];
const chavePath = () => (win ? Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH' : 'PATH');
const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// Roda `corpo` com PATH (null: sem PATH), NODE_OPTIONS e cwd do processo
// trocados, e desfaz tudo no fim (os testes de um arquivo rodam em
// sequência).
async function com({ PATH, nodeOptions, cwd }, corpo) {
  const chave = chavePath();
  const salvo = { path: process.env[chave], nodeOptions: process.env.NODE_OPTIONS, cwd: process.cwd() };
  try {
    if (PATH === null) delete process.env[chave];
    else if (PATH !== undefined) process.env[chave] = PATH;
    if (nodeOptions !== undefined) process.env.NODE_OPTIONS = nodeOptions;
    if (cwd !== undefined) process.chdir(cwd);
    return await corpo();
  } finally {
    process.chdir(salvo.cwd);
    if (salvo.path === undefined) delete process.env[chave];
    else process.env[chave] = salvo.path;
    if (salvo.nodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = salvo.nodeOptions;
  }
}

const temGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// ------------------------------------------------------------ lerOrigin (git)

test('lerOrigin: git plantado no repo nunca roda, nem com "." ou entrada vazia no PATH; o git do PATH roda', async () => {
  const c = cenario();
  const repo = novoTmp('hdk repo ç ');
  const bin = novoTmp('hdk bin ç ');
  c.criar(repo, 'git');
  const doPath = c.criar(bin, 'git');
  const r = await com({ PATH: juntar(...RELATIVAS, bin), nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  assert.deepEqual(c.rodaram(), [normal(doPath)]);
  assert.deepEqual(r, ['o/r']);
});

test('lerOrigin com o git de verdade no PATH: o git plantado no repo nunca roda', { skip: !temGit && 'git ausente' }, async () => {
  const c = cenario();
  const repo = novoTmp('hdk repo ç ');
  execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/real/repo.git'], { cwd: repo, stdio: 'ignore' });
  // Plantado só depois do git init: até aqui o próprio teste chama o git.
  c.criar(repo, 'git');
  const r = await com({ PATH: juntar(...RELATIVAS, process.env[chavePath()]), nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  assert.deepEqual(c.rodaram(), []);
  assert.deepEqual(r, ['real/repo']);
});

test('lerOrigin: sem git fora do repo, nada roda e o origin fica vazio', async () => {
  const c = cenario();
  const repo = novoTmp('hdk repo ç ');
  c.criar(repo, 'git');
  const r = await com({ PATH: juntar(...RELATIVAS), nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  assert.deepEqual(c.rodaram(), []);
  assert.deepEqual(r, []);
});

test('lerOrigin descarta o stderr do git: um git falador não estoura o teto nem apaga o origin', async () => {
  const c = cenario({ stderr: true });
  const repo = novoTmp('hdk repo ç ');
  const bin = novoTmp('hdk bin ç ');
  const doPath = c.criar(bin, 'git');
  const r = await com({ PATH: bin, nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  assert.deepEqual(c.rodaram(), [normal(doPath)]);
  assert.deepEqual(r, ['o/r']);
});

test('lerOrigin: o stdin do git é o dispositivo nulo, nenhum git fica esperando entrada', async () => {
  const c = cenario({ stdin: true });
  const repo = novoTmp('hdk repo ç ');
  const bin = novoTmp('hdk bin ç ');
  const doPath = c.criar(bin, 'git');
  const inicio = Date.now();
  const r = await com({ PATH: bin, nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  assert.ok(Date.now() - inicio < 4000, `${Date.now() - inicio} ms`);
  assert.deepEqual(c.rodaram(), [normal(doPath)]);
  assert.deepEqual(r, ['o/r']);
});

test('lerOrigin: stdout acima de 64 KiB mata o git e o origin fica vazio', async () => {
  const c = cenario({ stdoutGrande: true });
  const repo = novoTmp('hdk repo ç ');
  const bin = novoTmp('hdk bin ç ');
  const doPath = c.criar(bin, 'git');
  const r = await com({ PATH: bin, nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  assert.deepEqual(r, []);
  assert.deepEqual(c.rodaram(), [normal(doPath)]);
  assert.equal(vivo(c.pid()), false, 'o git sobreviveu ao teto');
});

test('lerOrigin: git que nunca termina leva SIGKILL no prazo de 5 s; a promessa só resolve depois que ele saiu', async () => {
  const c = cenario({ dorme: true });
  const repo = novoTmp('hdk repo ç ');
  const bin = novoTmp('hdk bin ç ');
  const doPath = c.criar(bin, 'git');
  const inicio = Date.now();
  const r = await com({ PATH: bin, nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
  const ms = Date.now() - inicio;
  assert.deepEqual(r, []);
  assert.ok(ms >= 4500 && ms < 15_000, `${ms} ms`);
  assert.deepEqual(c.rodaram(), [normal(doPath)]);
  assert.equal(vivo(c.pid()), false, 'o git sobreviveu ao prazo');
});

// Um processo preso em E/S do kernel (estado D no Linux) não sai nem com
// SIGKILL. O kill vira um no-op pelo spawn espiado (o import nomeado de um
// módulo nativo acompanha o objeto depois de syncBuiltinESMExports), e o
// git continua vivo: a promessa tem de resolver assim mesmo, 1 s depois.
test('lerOrigin: git que nem o SIGKILL tira do ar não segura o /consumo; 1 s depois do kill a promessa resolve', async () => {
  const c = cenario({ dorme: true });
  const repo = novoTmp('hdk repo ç ');
  const bin = novoTmp('hdk bin ç ');
  c.criar(bin, 'git');
  const original = childProcess.spawn;
  let kills = 0;
  childProcess.spawn = (...a) => {
    const filho = original(...a);
    filho.kill = () => { kills++; return true; };
    return filho;
  };
  syncBuiltinESMExports();
  try {
    const inicio = Date.now();
    const r = await com({ PATH: bin, nodeOptions: c.nodeOptions }, () => lerOrigin(repo));
    const ms = Date.now() - inicio;
    assert.deepEqual(r, []);
    assert.ok(ms >= 5500 && ms < 15_000, `${ms} ms`);
    assert.equal(kills, 1);
    assert.equal(vivo(c.pid()), true, 'o kill espiado deixou o git vivo');
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
    try { process.kill(c.pid(), 'SIGKILL'); } catch { /* já saiu */ }
  }
});

// ------------------------------------------------------------ executor do gh

test('criarExecutorGh padrão: gh plantado no cwd do processo nunca roda, nem com "." ou entrada vazia no PATH; o gh do PATH roda', async () => {
  const c = cenario();
  const cwd = novoTmp('hdk cwd ç ');
  const bin = novoTmp('hdk bin ç ');
  c.criar(cwd, 'gh');
  const doPath = c.criar(bin, 'gh');
  const r = await com({ PATH: juntar(...RELATIVAS, bin), nodeOptions: c.nodeOptions, cwd }, () => criarExecutorGh()(['api', 'repos/o/r']));
  assert.deepEqual(c.rodaram(), [normal(doPath)]);
  assert.deepEqual(r, { ok: true, stdout: 'https://github.com/o/r\n' });
});

test('criarExecutorGh padrão: a entrada do PATH que é o próprio cwd é pulada (grafia, barra final, caixa e link)', async (t) => {
  const c = cenario();
  const cwd = novoTmp('hdk cwd ç ');
  const bin = novoTmp('hdk bin ç ');
  c.criar(cwd, 'gh');
  const doPath = c.criar(bin, 'gh');
  const variantes = [cwd, `${cwd}${path.sep}`];
  if (win) variantes.push(cwd.toUpperCase(), cwd.toLowerCase());
  const ligado = path.join(novoTmp('hdk link '), 'ligado');
  try {
    fs.symlinkSync(cwd, ligado, win ? 'junction' : 'dir');
    variantes.push(ligado);
  } catch (e) {
    t.diagnostic(`sem link: ${e.code}`);
  }
  for (const v of variantes) {
    const r = await com({ PATH: juntar(v, bin), nodeOptions: c.nodeOptions, cwd }, () => criarExecutorGh()(['api', 'repos/o/r']));
    assert.deepEqual(r, { ok: true, stdout: 'https://github.com/o/r\n' }, v);
  }
  assert.deepEqual(c.rodaram(), variantes.map(() => normal(doPath)));
});

test('criarExecutorGh padrão: sem gh fora do cwd é gh ausente, sem criar processo', async () => {
  const c = cenario();
  const cwd = novoTmp('hdk cwd ç ');
  c.criar(cwd, 'gh');
  const r = await com({ PATH: juntar(...RELATIVAS, cwd), nodeOptions: c.nodeOptions, cwd }, () => criarExecutorGh()(['api', 'repos/o/r']));
  assert.deepEqual(r, { ok: false, motivo: 'gh ausente' });
  assert.deepEqual(c.rodaram(), []);
});

test('criarExecutorGh: executável injetado por caminho absoluto roda como veio; relativo com pasta é recusado sem criar processo', async () => {
  const c = cenario();
  const cwd = novoTmp('hdk cwd ç ');
  fs.mkdirSync(path.join(cwd, 'sub'));
  c.criar(path.join(cwd, 'sub'), 'gh');
  const bin = novoTmp('hdk bin ç ');
  const doBin = c.criar(bin, 'gh');
  const r = await com({ nodeOptions: c.nodeOptions, cwd }, async () => [
    await criarExecutorGh({ executavel: doBin })(['api', 'repos/o/r']),
    await criarExecutorGh({ executavel: path.join('sub', `gh${EXE}`) })(['api', 'repos/o/r']),
    await criarExecutorGh({ executavel: `.${path.sep}sub${path.sep}gh${EXE}` })(['api', 'repos/o/r']),
  ]);
  assert.deepEqual(r, [{ ok: true, stdout: 'https://github.com/o/r\n' }, { ok: false, motivo: 'gh ausente' }, { ok: false, motivo: 'gh ausente' }]);
  assert.deepEqual(c.rodaram(), [normal(doBin)]);
});

// ------------------------------------------------------------ resolverExecutavel

// Arquivo que o resolvedor examina (nunca executa): no POSIX com o modo dado.
function colocar(dir, arquivo, modo = 0o755) {
  const arq = path.join(dir, arquivo);
  fs.writeFileSync(arq, '#!/bin/sh\n');
  if (!win) fs.chmodSync(arq, modo);
  return arq;
}
const resolver = (ambiente, nome = 'gh') => com(ambiente, () => resolverExecutavel(nome));

test('resolverExecutavel: caminho absoluto da primeira entrada do PATH que tem o executável; o cwd nunca', async () => {
  const cwd = novoTmp('hdk cwd ç ');
  const vazia = novoTmp('hdk vazia ');
  const a = novoTmp('hdk a ç ');
  const b = novoTmp('hdk b ');
  colocar(cwd, `gh${EXE}`);
  const emA = colocar(a, `gh${EXE}`);
  const emB = colocar(b, `gh${EXE}`);
  const r = await resolver({ PATH: juntar(...RELATIVAS, cwd, vazia, a, b), cwd });
  assert.equal(r, emA);
  assert.ok(path.isAbsolute(r));
  assert.equal(await resolver({ PATH: juntar(cwd, b, a), cwd }), emB, 'a ordem do PATH decide');
  assert.equal(await resolver({ PATH: juntar(...RELATIVAS, cwd), cwd }), null, 'só o cwd tem: null');
});

test('resolverExecutavel: entradas relativas do PATH são ignoradas (vazia, ".", nome solto, subpasta; no Windows também C:rel e \\raiz)', async () => {
  const cwd = novoTmp('hdk cwd ç ');
  const rel = path.join(cwd, 'rel');
  fs.mkdirSync(rel);
  colocar(rel, `gh${EXE}`);
  colocar(cwd, `gh${EXE}`);
  const relativas = ['', '.', 'rel', `.${path.sep}rel`, `rel${path.sep}..${path.sep}rel`, `~${path.sep}rel`];
  // C:rel é relativo ao diretório corrente da unidade; \Users\... é relativo à
  // raiz da unidade corrente: nenhum dos dois é caminho completo.
  if (win) relativas.push(`${cwd.slice(0, 2)}rel`, rel.slice(2));
  for (const e of relativas) assert.equal(await resolver({ PATH: e, cwd }), null, JSON.stringify(e));
  assert.equal(await resolver({ PATH: juntar(...relativas), cwd }), null);
  assert.equal(await resolver({ PATH: juntar(...relativas, rel), cwd }), path.join(rel, `gh${EXE}`), 'a mesma pasta, por caminho absoluto, vale');
});

test('resolverExecutavel: no Windows só .exe (nunca .cmd, .bat, .com, .ps1 nem sem extensão); no POSIX só o nome exato', async () => {
  const d = novoTmp('hdk ext ');
  const extensoes = win ? ['.cmd', '.bat', '.com', '.ps1', ''] : ['.cmd', '.bat', '.com', '.ps1', '.exe', '.sh'];
  for (const ext of extensoes) colocar(d, `gh${ext}`);
  assert.equal(await resolver({ PATH: d }), null);
  const exato = colocar(d, `gh${EXE}`);
  assert.equal(await resolver({ PATH: juntar(d, novoTmp('hdk ext2 ')) }), exato, 'com o arquivo certo presente, é ele');
});

test('resolverExecutavel (POSIX): exige bit de execução', { skip: win && 'o Windows não tem bit de execução' }, async () => {
  const semX = novoTmp('hdk semx ');
  const comX = novoTmp('hdk comx ');
  colocar(semX, 'gh', 0o644);
  const certo = colocar(comX, 'gh', 0o755);
  assert.equal(await resolver({ PATH: semX }), null);
  assert.equal(await resolver({ PATH: juntar(semX, comX) }), certo);
});

test('resolverExecutavel: só arquivo regular (pasta com o nome do executável não serve)', async () => {
  const d = novoTmp('hdk pasta ');
  fs.mkdirSync(path.join(d, `gh${EXE}`));
  assert.equal(await resolver({ PATH: d }), null);
});

test('resolverExecutavel (Windows): entrada entre aspas vale sem as aspas', { skip: !win && 'aspas no PATH são coisa do Windows' }, async () => {
  const d = novoTmp('hdk aspas ç ');
  const arq = colocar(d, 'gh.exe');
  assert.equal(await resolver({ PATH: `"${d}"` }), arq);
});

test('resolverExecutavel: nome inválido ou PATH ausente é null, nunca lança', async () => {
  const d = novoTmp('hdk nomes ');
  colocar(d, `gh${EXE}`);
  const nomes = ['', '.', '..', 'a/gh', 'a\\gh', `../${path.basename(d)}/gh`, 'gh\0', 'x'.repeat(65), 'C:gh', '-gh', null, undefined, 42, {}, ['gh']];
  const r = await com({ PATH: d }, () => nomes.map((nome) => resolverExecutavel(nome)));
  assert.deepEqual(r, nomes.map(() => null));
  assert.equal(await resolver({ PATH: d }), path.join(d, `gh${EXE}`), 'controle: o nome válido acha');
  assert.equal(await resolver({ PATH: null }), null, 'sem PATH');
  assert.equal(await resolver({ PATH: '' }), null, 'PATH vazio');
});

test('resolverExecutavel: guarda o resultado por processo (nome, PATH e cwd); PATH novo procura de novo', async () => {
  const d = novoTmp('hdk cache ');
  const arq = colocar(d, `gh${EXE}`);
  assert.equal(await resolver({ PATH: d }), arq);
  fs.rmSync(arq);
  assert.equal(await resolver({ PATH: d }), arq, 'o mesmo PATH devolve o que foi guardado');
  assert.equal(await resolver({ PATH: juntar(d, novoTmp('hdk cache2 ')) }), null, 'PATH novo: procura de novo');
  const outro = colocar(d, `gh${EXE}`);
  assert.equal(await resolver({ PATH: d, cwd: novoTmp('hdk cache3 ') }), outro, 'cwd novo: procura de novo');
  assert.equal(await resolver({ PATH: d, cwd: d }), null, 'e a entrada que virou o cwd é pulada');
});

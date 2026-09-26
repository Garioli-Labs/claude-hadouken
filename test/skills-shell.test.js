import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Revisão final, I-3: as skills rodam o CLI pelo shell que o Claude Code usar
// (sh, bash ou zsh no Linux e no macOS; PowerShell ou Git Bash no Windows). O
// PowerShell não expande `~` para programa nativo: o node recebia
// "~/.claude/..." e resolvia contra o cwd. Aqui o texto exato de cada comando
// das duas skills roda em cada shell disponível, com a home apontando para uma
// pasta temporária (com espaço no nome) onde um cli.mjs de mentira imprime o
// caminho e os argumentos que recebeu. A home real nunca entra: HOME e
// USERPROFILE dos filhos são a pasta temporária.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['consumo', 'instalar'];
const STUB = 'console.log(JSON.stringify({ script: process.argv[1], args: process.argv.slice(2) }));\n';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const ESPERA_MS = 60_000;

const textoDa = (nome) => fs.readFileSync(path.join(RAIZ, 'skills', nome, 'SKILL.md'), 'utf8');

// Todo trecho entre crases que cita node ou cli.mjs, sem repetição.
function comandos() {
  const todos = SKILLS.flatMap((nome) => [...textoDa(nome).matchAll(/`([^`]*)`/g)].map((m) => m[1]));
  return [...new Set(todos.filter((c) => /\bnode\b|cli\.mjs/.test(c)))];
}

// Argumentos que o CLI deve receber: o que vem depois do caminho do cli.mjs.
function argumentosEsperados(comando) {
  const resto = comando.slice(comando.indexOf('cli.mjs') + 'cli.mjs'.length).replace(/^"/, '').trim();
  return resto === '' ? [] : resto.split(/\s+/);
}

function casaFalsa(t) {
  const raiz = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hadouken-skill-')));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const casa = path.join(raiz, 'casa falsa');
  const bin = path.join(casa, '.claude', 'hadouken', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const stub = path.join(bin, 'cli.mjs');
  fs.writeFileSync(stub, STUB);
  return { casa, stub, cwd: raiz };
}

function ambiente(extra, sem = []) {
  const env = { ...process.env, ...extra };
  for (const k of ['HADOUKEN_HOME', 'HADOUKEN_SETTINGS', ...sem]) delete env[k];
  return env;
}

// Roda todos os comandos numa invocação só do shell e confere, linha a linha,
// o caminho absoluto do stub e os argumentos.
function conferir(r, lista, stub) {
  assert.equal(r.error, undefined, String(r.error));
  const linhas = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('{'));
  assert.equal(linhas.length, lista.length, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  lista.forEach((comando, i) => {
    const saida = JSON.parse(linhas[i]);
    assert.equal(fs.realpathSync.native(saida.script), stub, comando);
    assert.deepEqual(saida.args, argumentosEsperados(comando), comando);
  });
}

test('skills: os comandos citados são os seis fixos, todos pelo "$HOME/..."', () => {
  const lista = comandos().sort();
  const cli = 'node "$HOME/.claude/hadouken/bin/cli.mjs"';
  assert.deepEqual(lista, [
    `${cli} consumo`, `${cli} consumo --json`,
    `${cli} instalar`, `${cli} instalar --aplicar`, `${cli} instalar --aplicar --substituir`, `${cli} instalar --remover`,
  ].sort());
});

test('skills: o único $ do texto é o de $HOME, e nenhuma declara arguments no frontmatter', () => {
  // O Claude Code troca $ARGUMENTS, $N, ${CLAUDE_...} e o $nome de cada
  // argumento declarado em `arguments:`; qualquer outro $ chega literal ao
  // shell. Com um `arguments:` declarado, um $HOME poderia deixar de chegar.
  for (const nome of SKILLS) {
    const texto = textoDa(nome);
    const frontmatter = texto.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, nome);
    assert.doesNotMatch(frontmatter[1], /^arguments\s*:/m, nome);
    for (const m of texto.matchAll(/\$(\w+|\{|\()/g)) assert.equal(m[1], 'HOME', `${nome}: ${m[0]}`);
  }
});

test('skills: cada comando roda no sh com a home de mentira', { skip: process.platform === 'win32' || !fs.existsSync('/bin/sh') }, (t) => {
  const { casa, stub, cwd } = casaFalsa(t);
  const lista = comandos();
  const r = spawnSync('/bin/sh', ['-c', lista.join('\n')], {
    cwd, env: ambiente({ HOME: casa }), encoding: 'utf8', timeout: ESPERA_MS,
  });
  conferir(r, lista, stub);
});

test('skills: cada comando roda no Windows PowerShell com $HOME vindo do USERPROFILE', { skip: process.platform !== 'win32' }, (t) => {
  const { casa, stub, cwd } = casaFalsa(t);
  const lista = comandos();
  // -EncodedCommand: o texto chega ao PowerShell sem nenhuma camada de aspas
  // no meio. HOME sai do ambiente: o $HOME do PowerShell vem do USERPROFILE.
  const codificado = Buffer.from(lista.join('\n'), 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificado], {
    cwd, env: ambiente({ USERPROFILE: casa }, ['HOME']), encoding: 'utf8', timeout: ESPERA_MS,
  });
  conferir(r, lista, stub);
});

test('skills: cada comando roda no Git Bash do Windows', { skip: process.platform !== 'win32' || !fs.existsSync(GIT_BASH) }, (t) => {
  const { casa, stub, cwd } = casaFalsa(t);
  const lista = comandos();
  const r = spawnSync(GIT_BASH, ['-c', lista.join('\n')], {
    cwd, env: ambiente({ HOME: casa, USERPROFILE: casa }), encoding: 'utf8', timeout: ESPERA_MS,
  });
  conferir(r, lista, stub);
});

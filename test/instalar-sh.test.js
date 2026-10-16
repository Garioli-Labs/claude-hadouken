import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarFalso } from './dados/instalador/claude-falso.mjs';

// install.sh (spec v0.5.2, passos 1 a 5) com claude, node, git, brew e curl
// falsos num PATH temporário. Não roda no Windows (o install.ps1 tem o teste
// dele). As rodadas usam --sim, menos as de "sem tty", que usam setsid (só
// Linux) para o /dev/tty não existir: sem isso, a pergunta esperaria no
// terminal de quem roda a suíte.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = path.join(repo, 'install.sh');
const pulaWin = process.platform === 'win32' ? 'install.sh não roda no Windows' : false;
const temSetsid = process.platform === 'linux' && spawnSync('setsid', ['--version']).status === 0;
const pastas = [];
after(() => { for (const d of pastas) fs.rmSync(d, { recursive: true, force: true }); });

function montar({ claude = true, versaoClaude, node = true } = {}) {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk sh '));
  pastas.push(casa);
  const bin = path.join(casa, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(casa, 'comandos.log');
  const falso = (nome, corpo) => fs.writeFileSync(path.join(bin, nome), `#!/bin/sh\n${corpo}\n`, { mode: 0o755 });
  falso('git', 'echo "git version 2.0.0"');
  falso('curl', `echo "curl $*" >> "${log}"; exit 1`);
  falso('brew', `echo "brew $*" >> "${log}"; exit 0`);
  if (node) falso('node', `exec "${process.execPath}" "$@"`);
  if (claude) instalarFalso(bin);
  const estado = path.join(casa, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [], log: [], raiz: casa, ...(versaoClaude ? { versao: versaoClaude } : {}) }));
  // O instalar-tudo.js "do plugin instalado" é um stub que grava o que recebeu.
  const stub = path.join(casa, 'claude-hadouken', 'src', 'instalar-tudo.js');
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  const saida = path.join(casa, 'stub.json');
  fs.writeFileSync(stub, "const fs = require('node:fs');\nfs.writeFileSync(process.env.STUB_SAIDA, JSON.stringify({ argv: process.argv.slice(2), claude: process.env.HADOUKEN_CLAUDE || null }));\n");
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: casa, FALSO_ESTADO: estado, STUB_SAIDA: saida, LANG: 'C.UTF-8' };
  const lerEstado = () => JSON.parse(fs.readFileSync(estado, 'utf8'));
  const lerStub = () => (fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, 'utf8')) : null);
  const lerLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  return { casa, bin, env, lerEstado, lerStub, lerLog };
}
const rodar = (m, args, opcoes = {}) => spawnSync('bash', [SCRIPT, ...args], { env: m.env, encoding: 'utf8', timeout: 60_000, ...opcoes });
const rodarSemTty = (m, args) => spawnSync('setsid', ['-w', 'bash', SCRIPT, ...args], { env: m.env, encoding: 'utf8', timeout: 60_000, input: '' });

test('install.sh: sintaxe (bash -n)', { skip: pulaWin }, () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('install.sh: tudo dentro de main, e main "$@" é a última linha', { skip: pulaWin }, () => {
  const linhas = fs.readFileSync(SCRIPT, 'utf8').trimEnd().split('\n');
  assert.equal(linhas.at(-1), 'main "$@"');
  // Fora das funções: só definições de função e constantes sem $ nem (.
  const soltas = linhas.filter((l) => /^[a-z]/i.test(l) && !/^[a-z_]+\(\) \{$/.test(l) && !/^[A-Z_]+=[^$(]*$/.test(l) && l !== 'main "$@"');
  assert.deepEqual(soltas, [], 'fora das funções, só definições');
});

test('install.sh: instalação nova, na ordem, e o instalar-tudo recebe as opções e o claude', { skip: pulaWin }, () => {
  const m = montar();
  const r = rodar(m, ['--sim', '--sem-extras', '--com-aprendizado']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log, [
    '--version', 'plugin marketplace add Garioli-Labs/claude-hadouken', 'plugin marketplace update claude-hadouken',
    'plugin list --json', 'plugin install claude-hadouken@claude-hadouken', 'plugin list --json',
  ]);
  assert.deepEqual(m.lerStub(), { argv: ['--sim', '--sem-extras', '--com-aprendizado'], claude: path.join(m.bin, 'claude') });
  assert.equal(m.lerLog(), '', 'nem curl nem brew');
});

test('install.sh: segunda rodada usa plugin update', { skip: pulaWin }, () => {
  const m = montar();
  rodar(m, ['--sim', '--sem-extras']);
  const r = rodar(m, ['--sim', '--sem-extras']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(m.lerEstado().log.includes('plugin update claude-hadouken@claude-hadouken'));
});

test('install.sh: claude abaixo de 2.1.251 recebe claude update', { skip: pulaWin }, () => {
  const m = montar({ versaoClaude: '2.1.200' });
  const r = rodar(m, ['--sim', '--sem-extras']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log.slice(0, 3), ['--version', 'update', '--version']);
});

test('install.sh: opção desconhecida sai 2 sem rodar nada', { skip: pulaWin }, () => {
  const m = montar();
  const r = rodar(m, ['--xyz']);
  assert.equal(r.status, 2);
  assert.deepEqual(m.lerEstado().log, []);
});

test('install.sh: sem tty, sem claude e sem --sim, para sem chamar o instalador do Claude Code', { skip: pulaWin || !temSetsid }, () => {
  const m = montar({ claude: false });
  const r = rodarSemTty(m, []);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(m.lerLog(), '');
  assert.equal(m.lerStub(), null);
});

test('install.sh: sem tty e com tudo presente, os extras ficam de fora (--sem-extras repassado)', { skip: pulaWin || !temSetsid }, () => {
  const m = montar();
  const r = rodarSemTty(m, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerStub().argv, ['--sem-extras']);
});

// No Mac, com o brew falso, o script pergunta antes de instalar o Node; sem
// setsid, a pergunta só vale "não" quando a suíte não roda num terminal (CI).
const pulaSemNode = pulaWin || fs.existsSync('/usr/bin/node') || fs.existsSync('/bin/node') || (process.platform === 'darwin' && process.stdin.isTTY);
test('install.sh: sem Node, para com o link do nodejs.org', { skip: pulaSemNode }, () => {
  const m = montar({ node: false });
  const r = process.platform === 'linux' && temSetsid ? rodarSemTty(m, []) : rodar(m, [], { input: '' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /nodejs\.org/);
  assert.equal(m.lerStub(), null);
});

test('install.sh: pela entrada (bash -s), com um claude que come a entrada, roda até o fim', { skip: pulaWin }, () => {
  const m = montar();
  const r = spawnSync('bash', ['-s', '--', '--sim', '--sem-extras'], {
    env: { ...m.env, FALSO_COMER_STDIN: '1' }, encoding: 'utf8', timeout: 60_000, input: fs.readFileSync(SCRIPT),
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerStub().argv, ['--sim', '--sem-extras']);
});

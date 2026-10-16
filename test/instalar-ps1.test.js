import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarFalso } from './dados/instalador/claude-falso.mjs';

// install.ps1 (spec v0.5.2) no Windows PowerShell 5.1, com claude.cmd e
// git.cmd falsos numa pasta com espaço. Só roda no win32. A entrada é sempre
// redirecionada (spawnSync), então toda pergunta vale "não" sem --sim.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = path.join(repo, 'install.ps1');
const soWin = process.platform === 'win32' ? false : 'install.ps1 só roda no Windows';
const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const SISTEMA = process.env.SystemRoot ?? 'C:\\Windows';

function montar({ claude = true, versaoClaude } = {}) {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk ps1 '));
  pastas.push(casa);
  const bin = path.join(casa, 'bin dir');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git.cmd'), '@echo git version 2.0.0\r\n');
  if (claude) instalarFalso(bin);
  const estado = path.join(casa, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [], log: [], raiz: casa, ...(versaoClaude ? { versao: versaoClaude } : {}) }));
  const stub = path.join(casa, 'hadouken', 'src', 'instalar-tudo.js');
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  const saida = path.join(casa, 'stub.json');
  fs.writeFileSync(stub, "const fs = require('node:fs');\nfs.writeFileSync(process.env.STUB_SAIDA, JSON.stringify({ argv: process.argv.slice(2), claude: process.env.HADOUKEN_CLAUDE || null }));\n");
  const Path = [bin, path.dirname(process.execPath), path.join(SISTEMA, 'System32'), SISTEMA, path.join(SISTEMA, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
  // Sem PATHEXT, o PowerShell trata node.exe como documento (CantActivateDocumentInPipeline).
  const env = { Path, PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD', SystemRoot: SISTEMA, USERPROFILE: casa, LOCALAPPDATA: path.join(casa, 'local'), FALSO_ESTADO: estado, STUB_SAIDA: saida, TEMP: os.tmpdir(), TMP: os.tmpdir() };
  return {
    bin, env,
    lerEstado: () => JSON.parse(fs.readFileSync(estado, 'utf8')),
    lerStub: () => (fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, 'utf8')) : null),
  };
}
const ps = (env, args) => spawnSync(path.join(SISTEMA, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { env, encoding: 'utf8', timeout: 120_000, input: '' });

test('install.ps1: só ASCII', () => {
  const bytes = fs.readFileSync(SCRIPT);
  assert.ok(bytes.every((b) => b < 0x80), 'byte fora do ASCII');
});

test('install.ps1: o parser do PowerShell não acha erro', { skip: soWin }, () => {
  const cmd = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replaceAll("'", "''")}', [ref]$null, [ref]$e); $e.Count`;
  const r = ps(process.env, ['-Command', cmd]);
  assert.equal(r.stdout.trim(), '0', r.stdout + r.stderr);
});

test('install.ps1 -File: instala o principal e chama o instalar-tudo com as opções', { skip: soWin }, () => {
  const m = montar();
  const r = ps(m.env, ['-File', SCRIPT, '--sim', '-SemExtras']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log, [
    '--version', 'plugin marketplace add Garioli-Labs/claude-hadouken', 'plugin marketplace update claude-hadouken',
    'plugin list --json', 'plugin install hadouken@claude-hadouken', 'plugin list --json',
  ]);
  assert.deepEqual(m.lerStub(), { argv: ['--sim', '--sem-extras'], claude: path.join(m.bin, 'claude.cmd') });
});

test('install.ps1 pelo iex: não fecha o PowerShell e deixa o código em $LASTEXITCODE', { skip: soWin }, () => {
  const m = montar();
  const cmd = `$env:HADOUKEN_INSTALAR = '--sim --sem-extras'; Get-Content -Raw -LiteralPath '${SCRIPT.replaceAll("'", "''")}' | iex; 'depois ' + $LASTEXITCODE; 'sobrou ' + [bool](Get-Variable Repasse, Claude -ErrorAction SilentlyContinue) + ' ' + [bool](Get-Command Hadouken-Principal -ErrorAction SilentlyContinue)`;
  const r = ps(m.env, ['-Command', cmd]);
  assert.match(r.stdout, /depois 0/, r.stdout + r.stderr);
  assert.match(r.stdout, /sobrou False False/, 'nem variável nem função do script na sessão de quem chamou');
  assert.deepEqual(m.lerStub().argv, ['--sim', '--sem-extras']);
});

test('install.ps1: claude abaixo de 2.1.251 recebe claude update', { skip: soWin }, () => {
  const m = montar({ versaoClaude: '2.1.200' });
  const r = ps(m.env, ['-File', SCRIPT, '--sim', '--sem-extras']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log.slice(0, 3), ['--version', 'update', '--version']);
});

test('install.ps1: sem claude e com a entrada redirecionada, sai 1 sem instalar', { skip: soWin }, () => {
  const m = montar({ claude: false });
  const r = ps(m.env, ['-File', SCRIPT]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(m.lerStub(), null);
  assert.match(r.stdout + r.stderr, /claude\.ai\/install\.ps1/);
});

test('install.ps1: opção desconhecida sai 2', { skip: soWin }, () => {
  const m = montar();
  assert.equal(ps(m.env, ['-File', SCRIPT, '--xyz']).status, 2);
  assert.deepEqual(m.lerEstado().log, []);
});

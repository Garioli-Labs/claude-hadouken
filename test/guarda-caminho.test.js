import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhoReal, dentroDe, chamaClaude, claudeComLiberar } from '../src/guarda/caminho.js';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('dentroDe: filho, a própria pasta, "..", irmão com prefixo, maiúsculas no Windows', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-cam-'));
  dirs.push(d);
  const dados = path.join(d, 'hadouken');
  fs.mkdirSync(dados);
  assert.equal(dentroDe(dados, path.join(dados, 'liberacao.json')), true);
  assert.equal(dentroDe(dados, path.join(dados, 'nova', 'x.json')), true);
  assert.equal(dentroDe(dados, dados), true);
  assert.equal(dentroDe(dados, path.join(dados, 'x', '..', 'guarda.json')), true);
  assert.equal(dentroDe(dados, path.join(dados, '..x.json')), true);
  assert.equal(dentroDe(dados, path.join(d, 'hadouken-outro', 'x')), false);
  assert.equal(dentroDe(dados, path.join(d, 'fora.txt')), false);
  if (process.platform === 'win32') assert.equal(dentroDe(dados, path.join(dados.toUpperCase(), 'guarda.json')), true);
  assert.equal(dentroDe(dados, 'relativo.json'), false);
  assert.equal(dentroDe(dados, 42), false);
  assert.ok(caminhoReal(path.join(dados, 'nao', 'existe')).endsWith(path.join('nao', 'existe')));
});

test('chamaClaude: casa o executável claude, não um caminho com claude no nome', () => {
  for (const c of ['claude -p x', 'cd . && claude -p x', 'FOO=1 claude --bare', '& claude -p x', 'C:/bin/claude.exe -p', 'npx claude', 'echo a; claude plugin list']) {
    assert.equal(chamaClaude(c), true, c);
  }
  for (const c of ['git status', 'cd "E:/Projetos DEV/claude-hadouken" && npm test', 'cat CLAUDE.md', 'echo claudette', null]) {
    assert.equal(chamaClaude(c), false, String(c));
  }
});

// Regra fixa da P4 (decisão do controlador na revisão da Task 13): claude
// junto com o comando de liberação é negado sempre. Casos de espaço, aspas,
// escapes de bash, PowerShell e cmd, prefixo de ambiente, cadeias e os
// lançadores npx e node do pacote.
test('claudeComLiberar: claude (ou o pacote) junto com o comando de liberação', () => {
  const sim = [
    'claude -p "/claude-hadouken:liberar 2h"',
    "claude -p '/claude-hadouken:liberar'",
    'claude -p /claude-hadouken:liberar',
    'claude "/claude-hadouken:liberar fable"',
    'claude.exe -p "/claude-hadouken:liberar caro"',
    '"C:/Program Files/Claude/claude.exe" -p "/claude-hadouken:liberar"',
    'C:\\Users\\x\\.local\\bin\\claude.exe -p "/claude-hadouken:liberar"',
    '"claude" -p "/claude-hadouken:liberar"',
    'npx @anthropic-ai/claude-code -p "/claude-hadouken:liberar fable"',
    'npx -y @anthropic-ai/claude-code@latest --print "claude-hadouken:liberar"',
    'node C:/npm/node_modules/@anthropic-ai/claude-code/cli.js -p "/claude-hadouken:liberar"',
    'node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js -p "/claude-hadouken:liberar"',
    'CLAUDE_CODE_ENTRYPOINT=cli claude -p "/claude-hadouken:liberar"',
    'env FOO=1 claude -p "/claude-hadouken:liberar"',
    'cd . && claude -p "/claude-hadouken:liberar"',
    'true; claude -p "/claude-hadouken:liberar"',
    'echo "/claude-hadouken:liberar 2h" | claude -p',
    "claude -p <<'EOF'\n/claude-hadouken:liberar 2h\nEOF",
    'claude -p "/claude-hadouken"":liberar"',
    'claude -p "/claude-hadouken\\:lib\\erar"',
    '& claude -p "/claude-hadouken`:liberar"',
    'cmd /c "claude -p /claude-hadouken^:liberar"',
    'claude -p "/Claude-Hadouken:LIBERAR"',
    'claude -p "/claude-hadouken: liberar"',
    'A=claude-hadouken; claude -p "/$A:liberar"',
    'claude -p "/liberar 2h"',
    '$(which claude) -p "/claude-hadouken:liberar"',
    "bash -c 'claude -p \"/claude-hadouken:liberar\"'",
    "Start-Process claude -ArgumentList '-p','/claude-hadouken:liberar'",
    'X=claude; $X -p "/claude-hadouken:liberar"',
    `${' '.repeat(10_000)}claude -p "/claude-hadouken:liberar"`,
    // Decisão do controlador (rodada 2): o texto com 'hadouken:liberar' nega
    // mesmo sem claude; quem só cita o comando grava o texto num arquivo.
    'echo "/claude-hadouken:liberar"',
    'grep -rn "claude-hadouken:liberar" src',
    'cd "E:/Projetos DEV/claude-hadouken" && grep -n "/claude-hadouken:liberar" README.md',
    'cat CLAUDE.md && echo /claude-hadouken:liberar',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
  const nao = [
    'git log --grep liberar',
    'echo liberar',
    'claude -p "revise src/hooks/liberar.js"',
    'claude plugin list | grep liberar',
    'git status',
    null, undefined, 42, {},
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, String(c));
});

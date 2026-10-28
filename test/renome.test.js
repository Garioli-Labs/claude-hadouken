import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_PRINCIPAL, DEPENDENCIAS_KIT } from '../src/instalar/claude-cli.js';
import { pedeLiberacao } from '../src/guarda/caminho.js';

// Task 11 da v0.5.2: o plugin claude-hadouken passa a se chamar hadouken. O
// marketplace (claude-hadouken), o repositório (Garioli-Labs/claude-hadouken),
// a pasta de dados (~/.claude/hadouken) e a extensão do VS Code
// (claude-hadouken-painel) ficam. O renames do marketplace migra quem tinha
// o nome antigo; num marketplace por git, o plugin novo ainda precisa de um
// install, que o instalador faz (o ID novo não está na lista).

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const json = (rel) => JSON.parse(ler(rel));
const NOVO = 'hadouken@claude-hadouken';

test('o plugin principal se chama hadouken, e o renames migra o nome antigo', () => {
  assert.equal(json('.claude-plugin/plugin.json').name, 'hadouken');
  const m = json('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'claude-hadouken');
  assert.deepEqual(m.plugins.filter((p) => p.source === './').map((p) => p.name), ['hadouken']);
  assert.deepEqual(m.renames, { 'claude-hadouken': 'hadouken' });
});

test('os ids e as dependências usam hadouken@claude-hadouken', () => {
  assert.equal(ID_PRINCIPAL, NOVO);
  assert.ok(DEPENDENCIAS_KIT.includes(NOVO));
  const deps = json('kit/.claude-plugin/plugin.json').dependencies;
  assert.ok(deps.includes('hadouken') && !deps.includes('claude-hadouken'));
  for (const rel of ['kit/testado.json', 'test/dados/kit-robo/testado.json']) {
    const t = json(rel).dependencias;
    assert.ok(NOVO in t && !('claude-hadouken@claude-hadouken' in t), rel);
  }
  assert.match(ler('install.sh'), /^ID=hadouken@claude-hadouken$/m);
  assert.match(ler('install.ps1'), /^\s*\$ID = 'hadouken@claude-hadouken'$/m);
});

test('os hooks dos comandos casam com hadouken:liberar, hadouken:aprender, hadouken:limites e hadouken:saude', () => {
  const matchers = json('hooks/hooks.json').hooks.UserPromptExpansion.map((h) => h.matcher).sort();
  assert.deepEqual(matchers, ['hadouken:aprender', 'hadouken:liberar', 'hadouken:limites', 'hadouken:saude']);
});

test('nenhum texto do plugin cita o nome antigo como comando ou id', () => {
  const pastas = ['src', 'skills', 'kit', 'hooks', 'rea', 'bench', 'wiki'];
  const soltos = ['README.md', 'README.en.md', 'SECURITY.md', 'install.sh', 'install.ps1'];
  const arquivos = [...soltos];
  const andar = (d) => {
    for (const e of fs.readdirSync(path.join(repo, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) andar(rel);
      else if (/\.(js|mjs|json|md|sh|ps1)$/.test(e.name)) arquivos.push(rel);
    }
  };
  for (const p of pastas) andar(p);
  const velhos = [];
  for (const rel of arquivos) {
    const t = ler(rel);
    if (/\/claude-hadouken:|claude-hadouken@claude-hadouken|(?<![\w/.-])claude-hadouken:[a-z]/.test(t)) velhos.push(rel);
  }
  assert.deepEqual(velhos, []);
});

test('a guarda nega os dois nomes do comando', () => {
  for (const t of ['claude -p "/hadouken:liberar 2h"', 'claude -p "/claude-hadouken:liberar 2h"', 'claude -p "/hadouken:aprender aprovar"']) {
    assert.equal(pedeLiberacao(t), true, t);
  }
});

const claude = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
const temClaude = claude.status === 0;
test('claude plugin validate . passa', { skip: temClaude ? false : 'sem claude no PATH', timeout: 120_000 }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', '.'], { cwd: repo, encoding: 'utf8', shell: process.platform === 'win32', timeout: 110_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stdout, /✘/);
});

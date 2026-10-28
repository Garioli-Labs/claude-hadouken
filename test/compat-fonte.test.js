import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Spec v0.5.5 §9.1, item 1: o `compat` do package.json é a fonte única das
// versões suportadas; o engines e os dois instaladores têm de bater com ele.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (nome) => fs.readFileSync(path.join(repo, nome), 'utf8');

test('compat do package.json bate com engines e instaladores', () => {
  const pkg = JSON.parse(ler('package.json'));
  assert.deepEqual(pkg.compat, { node: '>=20', claudeCode: '2.1.251' });
  assert.equal(pkg.engines.node, pkg.compat.node);
  const nodeMaior = pkg.compat.node.replace('>=', '');
  const sh = ler('install.sh');
  assert.match(sh, new RegExp(`^NODE_MIN=${nodeMaior}\\.0\\.0$`, 'm'));
  assert.match(sh, new RegExp(`^CLAUDE_MIN=${pkg.compat.claudeCode.replaceAll('.', '\\.')}$`, 'm'));
  const ps1 = ler('install.ps1');
  assert.match(ps1, new RegExp(`\\$NodeMin = \\[version\\]'${nodeMaior}\\.0\\.0'`));
  assert.match(ps1, new RegExp(`\\$ClaudeMin = \\[version\\]'${pkg.compat.claudeCode.replaceAll('.', '\\.')}'`));
});

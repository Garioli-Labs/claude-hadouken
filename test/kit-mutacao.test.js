import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// v0.6.0, Fatia 7, Tarefa 12 (spec §4 Fatia 7, bloco "Mutação"). A skill
// hadouken-kit:mutacao: fim da frente, só linhas alteradas, sobrevivente morto
// com teste ou justificado, ferramenta por stack, sem nota percentual.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ARQUIVO = path.join(repo, 'kit', 'skills', 'mutacao', 'SKILL.md');
const texto = () => fs.readFileSync(ARQUIVO, 'utf8');

test('mutacao: frontmatter com name: mutacao', () => {
  const m = texto().match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'frontmatter ausente');
  assert.match(m[1], /^name: mutacao$/m);
  assert.match(m[1], /^description: .+/m);
});

test('mutacao: cita as ferramentas por stack, o diff de linhas e o sobrevivente', () => {
  const t = texto();
  for (const termo of ['StrykerJS', 'npx', 'git diff -U0', 'mutmut', 'Stryker.NET', 'PIT', 'sobrevivente']) {
    assert.ok(t.includes(termo), `falta ${termo}`);
  }
});

test('mutacao: sem meta percentual', () => {
  assert.doesNotMatch(texto(), /\d+\s*%/);
});

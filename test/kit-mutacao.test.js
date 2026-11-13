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

test('mutacao: só o StrykerJS recebe faixas de linha (--mutate arq:ini-fim); as outras ferramentas rodam nos arquivos e descartam os sobreviventes fora do diff', () => {
  const t = texto();
  assert.ok(t.includes('--mutate "arq:ini-fim"'), 'falta a sintaxe de faixa do StrykerJS');
  assert.match(t, /mutmut, Stryker\.NET e PIT, rode nos arquivos alterados/);
  assert.match(t, /descarte os sobreviventes fora das linhas do `git diff -U0`/);
  assert.doesNotMatch(t, /passe só essas faixas à ferramenta/);
});

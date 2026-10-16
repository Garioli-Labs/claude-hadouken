import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINHAS_REGRA } from '../src/roteamento/regra.js';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AGENTES = fs.readdirSync(path.join(repo, 'agents')).map((a) => `hadouken:${a.replace(/\.md$/, '')}`);
const citados = (t) => [...t.matchAll(/hadouken:[a-z-]+/g)].map((m) => m[0]).filter((n) => n !== 'hadouken:roteamento' && n !== 'hadouken:liberar');

test('regra curta: no máximo 6 linhas e só agentes que existem (spec §2)', () => {
  assert.ok(LINHAS_REGRA.length >= 1 && LINHAS_REGRA.length <= 6);
  for (const n of citados(LINHAS_REGRA.join('\n'))) assert.ok(AGENTES.includes(n), n);
  assert.ok(LINHAS_REGRA.join('\n').includes('hadouken:roteamento'));
});

test('skill: abaixo de 8 000 caracteres (~2 mil tokens) e só agentes que existem', () => {
  const t = fs.readFileSync(path.join(repo, 'skills', 'roteamento', 'SKILL.md'), 'utf8');
  assert.ok(t.length < 8000, String(t.length));
  assert.match(t, /^name: roteamento$/m);
  assert.doesNotMatch(t, /disable-model-invocation/);
  for (const n of citados(t)) assert.ok(AGENTES.includes(n), n);
  for (const s of ['Fazer direto', 'Lançar agente', 'Brief', 'Pronto quando']) assert.ok(t.includes(s), s);
});

test('fluxo do kit aponta para hadouken:roteamento', () => {
  assert.ok(fs.readFileSync(path.join(repo, 'kit', 'skills', 'fluxo', 'SKILL.md'), 'utf8').includes('hadouken:roteamento'));
});

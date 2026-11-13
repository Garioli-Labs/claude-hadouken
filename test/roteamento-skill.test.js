import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETA } from '../src/agentes/paleta.js';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const texto = fs.readFileSync(path.join(repo, 'skills', 'roteamento', 'SKILL.md'), 'utf8');
const NOMES = PALETA.map((e) => e.nome);

// v0.6.0 (Fatia 5): a skill é prescritiva e curta. A paleta efetiva (model·effort)
// vem do SessionStart e de /hadouken:agentes, nunca de texto fixo na skill.
test('skill roteamento: cita os dez agentes da paleta', () => {
  assert.equal(NOMES.length, 10);
  for (const n of NOMES) assert.ok(texto.includes(`\`hadouken:${n}\``), n);
});

test('skill roteamento: não cita agente removido', () => {
  assert.doesNotMatch(texto, /executor/);
  assert.doesNotMatch(texto, /revisor-critico/);
});

test('skill roteamento: critério de "faça direto" e escada de modelos', () => {
  for (const s of ['3 chamadas de ferramenta', '~50 linhas', 'Haiku → Sonnet → Opus → Fable']) assert.ok(texto.includes(s), s);
});

test('skill roteamento: linha por despacho, brief e relatório', () => {
  for (const s of [
    'tipo → modelo·effort — motivo',
    'Tarefa / Objetivo / Arquivos / Não mexer / Pronto quando / Relatório',
    'até 40 linhas',
  ]) assert.ok(texto.includes(s), s);
});

test('skill roteamento: aponta /hadouken:agentes para a paleta efetiva', () => {
  assert.ok(texto.includes('/hadouken:agentes'));
});

test('skill roteamento: prevalência do usuário, effort por despacho e faixa de consumo', () => {
  assert.match(texto, /prevalece/);
  assert.match(texto, /parâmetro `effort`/);
  assert.match(texto, /`max`[^\n]*ok do usuário/);
  assert.match(texto, /modo econômico/);
  assert.match(texto, /modo folga/);
});

test('skill roteamento: sem model·effort fixo por agente na tabela', () => {
  assert.doesNotMatch(texto, /\b(Haiku|Sonnet|Opus|Fable)\s*·\s*(low|medium|high|xhigh|max)\b/i);
});

test('skill roteamento: todo /hadouken:<x> citado é comando que existe', () => {
  for (const m of texto.matchAll(/\/hadouken:([a-z0-9-]+)/g)) {
    assert.ok(fs.existsSync(path.join(repo, 'skills', m[1], 'SKILL.md')), m[1]);
  }
});

test('skill roteamento: sem termo do ambiente pessoal', () => {
  assert.doesNotMatch(texto, /ZZE2E|HOMOLOG|educbank|@[a-z0-9-]+\.(com|br)/i);
});

test('skill roteamento: até 90 linhas', () => {
  assert.ok(texto.trimEnd().split('\n').length <= 90, String(texto.split('\n').length));
});

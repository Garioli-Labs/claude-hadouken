import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhasRegra } from '../src/roteamento/regra.js';
import { PALETA, paletaEfetiva } from '../src/agentes/paleta.js';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AGENTES = fs.readdirSync(path.join(repo, 'agents')).map((a) => `hadouken:${a.replace(/\.md$/, '')}`);
const citados = (t) => [...t.matchAll(/hadouken:[a-z0-9-]+/g)].map((m) => m[0]).filter((n) => n !== 'hadouken:roteamento' && n !== 'hadouken:liberar');

// v0.6.0 (Fatia 3): o texto é gerado da paleta, uma linha por agente ativo.
// O teto de antes (6 linhas) vira o teto da paleta: abertura, uma linha por
// agente e fechamento, no máximo 1 600 caracteres (o SessionStart carrega o
// texto em toda sessão).
test('regra curta: abertura, uma linha por agente ativo e fechamento; até 1 600 caracteres; só agentes que existem', () => {
  const linhas = linhasRegra(paletaEfetiva());
  const texto = linhas.join('\n');
  assert.equal(linhas.length, PALETA.length + 2);
  assert.ok(texto.length <= 1600, String(texto.length));
  for (const n of citados(texto)) assert.ok(AGENTES.includes(n), n);
  assert.ok(texto.includes('hadouken:roteamento'));
  assert.ok(linhas[0].includes('hadouken:roteamento'));
});

test('regra curta: agente inativo sai do texto; entrada inválida só dá abertura e fechamento', () => {
  const efetiva = paletaEfetiva().map((e) => (e.nome === 'busca' ? { ...e, ativo: false } : e));
  const linhas = linhasRegra(efetiva);
  assert.equal(linhas.length, PALETA.length + 1);
  assert.ok(!linhas.join('\n').includes('hadouken:busca'));
  assert.equal(linhasRegra(null).length, 2);
  assert.equal(linhasRegra([{ nome: 'inexistente', ativo: true, model: 'x', effort: 'y' }]).length, 2);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLUXO = path.join(repo, 'kit', 'hooks', 'fluxo.js');

// As 22 skills que o plugin.json do mattpocock-skills 1.2.0 registra
// (conferidas no cache em 2026-10-14). Pedido do Sr. Garioli: todas com o
// seu momento, acionadas sozinhas.
const POCOCK = [
  'ask-matt', 'diagnosing-bugs', 'grill-with-docs', 'triage', 'improve-codebase-architecture',
  'setup-matt-pocock-skills', 'tdd', 'to-spec', 'to-tickets', 'wayfinder', 'implement', 'prototype',
  'research', 'domain-modeling', 'codebase-design', 'code-review', 'resolving-merge-conflicts',
  'grill-me', 'grilling', 'handoff', 'teach', 'writing-great-skills',
].map((s) => `mattpocock-skills:${s}`);

// Lista conferida em 2026-10-14 contra o cache instalado (superpowers 6.4.1,
// mattpocock-skills 1.2.0, poka-yoke 0.2.0) e as skills do próprio kit.
const EXISTENTES = new Set([
  'superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:subagent-driven-development',
  'superpowers:executing-plans', 'superpowers:test-driven-development', 'superpowers:systematic-debugging',
  'superpowers:requesting-code-review', 'superpowers:writing-skills',
  ...POCOCK,
  'poka-yoke:retro', 'hadouken-kit:yu-ux-web-expert', 'hadouken-kit:graphify', 'hadouken-kit:fluxo',
]);

function rodar(cwd, input = '') {
  return spawnSync(process.execPath, [FLUXO], { cwd, input, encoding: 'utf8', timeout: 5000 });
}
const contexto = () => JSON.parse(rodar(repo).stdout).hookSpecificOutput.additionalContext;

test('fluxo.js: sai 0 com stdin vazio e imprime JSON de SessionStart', () => {
  const r = rodar(repo);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  const t = j.hookSpecificOutput.additionalContext;
  assert.ok(t.length <= 1600, `${t.length} caracteres`);
  assert.ok(t.split('\n').length <= 5);
  assert.match(t, /superpowers:brainstorming/);
  assert.match(t, /hadouken-kit:fluxo/);
});

test('fluxo.js: mesma saída com stdin de verdade e com cwd com espaço', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit fluxo '));
  try {
    const a = rodar(repo).stdout;
    const b = rodar(tmp, JSON.stringify({ session_id: 'x', source: 'startup' })).stdout;
    assert.equal(a, b);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('fluxo.js: fronteira estática (spec §5.2)', () => {
  const texto = fs.readFileSync(FLUXO, 'utf8');
  assert.doesNotMatch(texto, /\b(?:import|require)\b[^\n]*['"](?:node:)?(?:fs|child_process|net|http|https|dgram)(?:\/[^'"]*)?['"]/);
  assert.doesNotMatch(texto, /process\.stdin|readFileSync|process\.env/);
});

test('hooks.json: SessionStart em forma exec com args e timeout 5', () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, 'kit', 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(h.hooks), ['SessionStart']);
  const c = h.hooks.SessionStart[0].hooks[0];
  assert.deepEqual(c, { type: 'command', command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/hooks/fluxo.js'], timeout: 5 });
});

test('SKILL fluxo: todo plugin:skill citado existe', () => {
  const s = fs.readFileSync(path.join(repo, 'kit', 'skills', 'fluxo', 'SKILL.md'), 'utf8');
  const citados = [...s.matchAll(/`([a-z0-9-]+:[a-z0-9-]+)`/g)].map((m) => m[1]);
  assert.ok(citados.length >= 15);
  for (const c of citados) assert.ok(EXISTENTES.has(c) || c.startsWith('poka-yoke:'), c);
});

test('SKILL fluxo: cada uma das 22 skills do Matt Pocock tem o seu momento na tabela', () => {
  const s = fs.readFileSync(path.join(repo, 'kit', 'skills', 'fluxo', 'SKILL.md'), 'utf8');
  for (const p of POCOCK) assert.ok(s.includes(`\`${p}\``), p);
});

test('o resumo do hook cita só nomes existentes e manda acionar sozinho', () => {
  const t = contexto();
  for (const m of t.matchAll(/([a-z0-9-]+:[a-z0-9-]+)/g)) assert.ok(EXISTENTES.has(m[1]), m[1]);
  assert.match(t, /sozinho/);
  // Os momentos do Matt Pocock que só ele cobre estão no resumo, não só na skill.
  for (const s of ['grilling', 'prototype', 'to-spec', 'to-tickets', 'wayfinder', 'handoff',
    'resolving-merge-conflicts', 'code-review', 'codebase-design', 'improve-codebase-architecture',
    'domain-modeling', 'research', 'triage', 'teach']) {
    assert.ok(t.includes(`mattpocock-skills:${s}`), s);
  }
});

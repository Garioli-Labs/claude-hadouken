import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLUXO = path.join(repo, 'kit', 'hooks', 'fluxo.js');

// As 27 skills que o plugin.json do mattpocock-skills 1.3.1 registra
// (conferidas no repositório em 2026-10-14; o kit não fixa versão, e a 1.3.1
// é a que se instala). Da 1.2.0 saíram resolving-merge-conflicts e
// writing-great-skills; entraram implement-spec, pr, retro, wizard,
// to-questionnaire, wait-what e writing-for-agents. Pedido do Sr. Garioli:
// todas com o seu momento, acionadas sozinhas.
const POCOCK = [
  'ask-matt', 'diagnosing-bugs', 'grill-with-docs', 'triage', 'improve-codebase-architecture',
  'setup-matt-pocock-skills', 'tdd', 'to-spec', 'to-tickets', 'wayfinder', 'implement', 'implement-spec',
  'prototype', 'research', 'domain-modeling', 'codebase-design', 'code-review', 'pr', 'retro', 'wizard',
  'grill-me', 'grilling', 'handoff', 'teach', 'to-questionnaire', 'wait-what', 'writing-for-agents',
].map((s) => `mattpocock-skills:${s}`);

// C1 da revisão final: estas 16 têm disable-model-invocation: true no
// frontmatter (mattpocock-skills 1.3.1, conferido em 2026-10-14); o modelo
// não as aciona, então o kit só as cita como /comando, para sugerir ao usuário.
const SO_USUARIO = ['ask-matt', 'grill-with-docs', 'implement', 'implement-spec',
  'improve-codebase-architecture', 'retro', 'setup-matt-pocock-skills', 'to-spec', 'to-tickets',
  'triage', 'wayfinder', 'grill-me', 'handoff', 'teach', 'to-questionnaire', 'wait-what',
].map((s) => `mattpocock-skills:${s}`);
// v0.5.2: depois do comando único, o cache dos terceiros fica sob o
// marketplace claude-hadouken; antes, sob o de cada um. Vale o que existir.
const primeiro = (...ps) => ps.find((p) => fs.existsSync(p)) ?? ps[0];
const CACHE_MATT = primeiro(
  path.join(os.homedir(), '.claude', 'plugins', 'cache', 'claude-hadouken', 'mattpocock-skills', '1.3.1'),
  path.join(os.homedir(), '.claude', 'plugins', 'cache', 'mattpocock', 'mattpocock-skills', '1.3.1'),
);

// Cita a skill no texto: as do usuário só com a barra; as outras só sem.
function citacoes(texto) {
  return [...texto.matchAll(/(\/?)([a-z0-9-]+:[a-z0-9-]+)/g)].map((m) => ({ barra: m[1] === '/', nome: m[2] }));
}
function conferirBarras(texto) {
  for (const c of citacoes(texto)) {
    if (!c.nome.startsWith('mattpocock-skills:')) continue;
    assert.equal(c.barra, SO_USUARIO.includes(c.nome), `${c.barra ? '/' : ''}${c.nome}`);
  }
}

// Lista conferida em 2026-10-14 contra o cache instalado (superpowers 6.4.1,
// mattpocock-skills 1.2.0, poka-yoke 0.2.0) e as skills do próprio kit.
const EXISTENTES = new Set([
  'superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:subagent-driven-development',
  'superpowers:executing-plans', 'superpowers:test-driven-development', 'superpowers:systematic-debugging',
  'superpowers:requesting-code-review', 'superpowers:writing-skills',
  ...POCOCK,
  'poka-yoke:retro', 'poka-yoke:audit', 'poka-yoke:authz',
  'hadouken-kit:yu-ux-web-expert', 'hadouken-kit:graphify', 'hadouken-kit:fluxo',
]);

// v0.5.1: os nomes de superpowers e poka-yoke da lista existem no cache
// instalado (nas versões do kit/testado.json), não só na lista acima.
const CACHE = path.join(os.homedir(), '.claude', 'plugins', 'cache');
const CACHE_DE = {
  superpowers: path.join(CACHE, 'claude-plugins-official', 'superpowers', '6.4.1'),
  'poka-yoke': primeiro(path.join(CACHE, 'claude-hadouken', 'poka-yoke', '0.2.0'), path.join(CACHE, 'poka-yoke', 'poka-yoke', '0.2.0')),
};

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
  const citados = [...s.matchAll(/`\/?([a-z0-9-]+:[a-z0-9-]+)`/g)].map((m) => m[1]);
  assert.ok(citados.length >= 15);
  for (const c of citados) assert.ok(EXISTENTES.has(c), c);
});

for (const [plugin, pasta] of Object.entries(CACHE_DE)) {
  test(`EXISTENTES: as ${plugin}:* existem no cache instalado`, { skip: !fs.existsSync(pasta) && `sem ${pasta}` }, () => {
    const nomes = new Set(fs.readdirSync(pasta, { recursive: true })
      .filter((f) => path.basename(f) === 'SKILL.md').map((f) => path.basename(path.dirname(f))));
    const nossos = [...EXISTENTES].filter((e) => e.startsWith(`${plugin}:`));
    assert.ok(nossos.length >= 3);
    for (const e of nossos) assert.ok(nomes.has(e.slice(plugin.length + 1)), e);
  });
}

test('SKILL fluxo: cada uma das 27 skills do Matt Pocock tem o seu momento na tabela', () => {
  const s = fs.readFileSync(path.join(repo, 'kit', 'skills', 'fluxo', 'SKILL.md'), 'utf8');
  for (const p of POCOCK) assert.ok(s.includes(`\`${p}\``) || s.includes(`\`/${p}\``), p);
  // Nenhuma citação do Matt fora da lista registrada (as que saíram na 1.3.1).
  for (const t of [s, contexto()]) {
    for (const c of citacoes(t)) if (c.nome.startsWith('mattpocock-skills:')) assert.ok(POCOCK.includes(c.nome), c.nome);
  }
  conferirBarras(s);
  assert.match(s, /sugira/);
});

// v0.5.1 (revisão): sem cache 1.3.1, o teste abaixo pula, inclusive no CI.
// A lista registrada e o disable-model-invocation de cada skill ficam num
// retrato do repositório mattpocock/skills (gerado do clone, 2026-10-14), e
// a versão do retrato é a do testado.json: os dois andam juntos.
test('POCOCK e SO_USUARIO batem com o retrato do mattpocock-skills testado', () => {
  const r = JSON.parse(fs.readFileSync(path.join(repo, 'test', 'dados', 'mattpocock-skills.json'), 'utf8'));
  const t = JSON.parse(fs.readFileSync(path.join(repo, 'kit', 'testado.json'), 'utf8'));
  assert.equal(r.versao, t.dependencias['mattpocock-skills@claude-hadouken']);
  assert.deepEqual(r.skills.map((s) => `mattpocock-skills:${s.nome}`).sort(), [...POCOCK].sort());
  assert.deepEqual(r.skills.filter((s) => s.soUsuario).map((s) => `mattpocock-skills:${s.nome}`).sort(), [...SO_USUARIO].sort());
});

test('SO_USUARIO bate com o frontmatter do mattpocock-skills instalado', { skip: !fs.existsSync(CACHE_MATT) && 'sem o cache 1.3.1' }, () => {
  const arquivos = fs.readdirSync(path.join(CACHE_MATT, 'skills'), { recursive: true })
    .filter((f) => path.basename(f) === 'SKILL.md' && !String(f).startsWith('deprecated'));
  let conferidas = 0;
  for (const f of arquivos) {
    const texto = fs.readFileSync(path.join(CACHE_MATT, 'skills', f), 'utf8');
    const nome = `mattpocock-skills:${/^name:\s*(\S+)/m.exec(texto)?.[1]}`;
    if (!POCOCK.includes(nome)) continue;
    conferidas++;
    assert.equal(/^disable-model-invocation:\s*true\s*$/m.test(texto), SO_USUARIO.includes(nome), nome);
  }
  assert.equal(conferidas, POCOCK.length, `${conferidas} conferidas`);
});

test('o resumo do hook cita só nomes existentes e manda acionar sozinho', () => {
  const t = contexto();
  for (const m of t.matchAll(/([a-z0-9-]+:[a-z0-9-]+)/g)) assert.ok(EXISTENTES.has(m[1]), m[1]);
  assert.match(t, /sozinho/);
  assert.match(t, /sugira/);
  conferirBarras(t);
  // Os momentos do Matt Pocock que só ele cobre estão no resumo, não só na skill.
  for (const s of ['grilling', 'prototype', 'to-spec', 'to-tickets', 'wayfinder', 'handoff',
    'code-review', 'codebase-design', 'improve-codebase-architecture',
    'domain-modeling', 'research', 'triage', 'teach', 'pr', 'wizard']) {
    // Nome inteiro: "pr" não pode casar com "prototype" (revisão v0.5.1).
    assert.ok(citacoes(t).some((c) => c.nome === `mattpocock-skills:${s}`), s);
  }
});

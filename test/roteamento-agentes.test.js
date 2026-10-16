import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerFrontmatter } from '../src/guarda/despacho.js';

// Spec roteamento §3: modelo, effort e ferramentas de cada agente.
const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ESPERADO = {
  busca: { model: 'haiku', effort: 'low', tools: ['Read', 'Grep', 'Glob'] },
  mecanico: { model: 'haiku', effort: 'low', tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'] },
  executor: { model: 'sonnet', effort: 'medium', tools: null },
  pesquisa: { model: 'sonnet', effort: 'low', tools: ['WebSearch', 'WebFetch', 'Read'] },
  revisor: { model: 'opus', effort: 'high', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
  'revisor-critico': { model: 'fable', effort: 'xhigh', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
};
const tools = (texto) => {
  const m = /^tools:\s*(.+)$/m.exec(texto.split('\n---')[0]);
  return m ? m[1].split(',').map((s) => s.trim()) : null;
};

test('os seis agentes existem com model, effort e tools da spec §3', () => {
  for (const [nome, e] of Object.entries(ESPERADO)) {
    const arq = path.join(repo, 'agents', `${nome}.md`);
    const fm = lerFrontmatter(arq);
    assert.deepEqual(fm, { model: e.model, effort: e.effort }, nome);
    const texto = fs.readFileSync(arq, 'utf8');
    assert.match(texto, new RegExp(`^name: ${nome}$`, 'm'), nome);
    assert.match(texto, /^description: .{40,}$/m, nome);
    assert.deepEqual(tools(texto), e.tools, nome);
  }
});

test('busca e revisores não editam; todo agente traz o contrato de relatório', () => {
  for (const nome of ['busca', 'revisor', 'revisor-critico']) {
    const t = tools(fs.readFileSync(path.join(repo, 'agents', `${nome}.md`), 'utf8'));
    assert.ok(!t.includes('Edit') && !t.includes('Write'), nome);
  }
  for (const nome of Object.keys(ESPERADO)) {
    const corpo = fs.readFileSync(path.join(repo, 'agents', `${nome}.md`), 'utf8');
    for (const item of ['Feito:', 'Arquivos:', 'Não feito:', 'Certeza:']) assert.ok(corpo.includes(item), `${nome} sem ${item}`);
  }
});

test('claude plugin validate aceita o plugin com os agentes', { skip: process.env.HADOUKEN_VALIDAR !== '1' }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', '.'], { cwd: repo, encoding: 'utf8', shell: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

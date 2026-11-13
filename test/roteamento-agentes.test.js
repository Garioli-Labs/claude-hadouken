import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerFrontmatter } from '../src/guarda/despacho.js';

// Spec roteamento §3: modelo, effort e ferramentas de cada agente.
const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const LEITURA = ['Read', 'Grep', 'Glob', 'Bash'];
const SEM_ESCRITA = 'Write, Edit, NotebookEdit';
// v0.6.0 (spec §4 Fatia 3): a paleta de dez agentes. `tools: null` = todas as
// ferramentas; `bloqueadas` = campo disallowedTools. Literal de propósito: é
// a segunda cópia da paleta, independente de src/agentes/paleta.js.
const ESPERADO = {
  busca: { model: 'haiku', effort: 'low', tools: ['Read', 'Grep', 'Glob'] },
  varredor: { model: 'haiku', effort: 'medium', tools: null, bloqueadas: SEM_ESCRITA },
  pesquisa: { model: 'sonnet', effort: 'low', tools: ['WebSearch', 'WebFetch', 'Read'] },
  mecanico: { model: 'haiku', effort: 'low', tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'] },
  'implementador-mecanico': { model: 'sonnet', effort: 'medium', tools: null },
  implementador: { model: 'sonnet', effort: 'high', tools: null },
  revisor: { model: 'sonnet', effort: 'high', tools: LEITURA },
  auditor: { model: 'fable', effort: 'high', tools: null, bloqueadas: SEM_ESCRITA },
  e2e: { model: 'sonnet', effort: 'high', tools: null },
  redator: { model: 'sonnet', effort: 'medium', tools: ['Read', 'Grep', 'Glob'] },
};
// Os seis de antes ficam com o relatório Feito/Arquivos/Não feito/Certeza; os
// seis novos, com Feito/Evidência/Não feito/Certeza (spec Fatia 3).
const COM_ARQUIVOS = new Set(['busca', 'mecanico', 'pesquisa', 'revisor']);
const tools = (texto) => {
  const m = /^tools:\s*(.+)$/m.exec(texto.split('\n---')[0]);
  return m ? m[1].split(',').map((s) => s.trim()) : null;
};

test('os dez agentes existem com model, effort e tools da spec v0.6.0 §4 Fatia 3', () => {
  for (const [nome, e] of Object.entries(ESPERADO)) {
    const arq = path.join(repo, 'agents', `${nome}.md`);
    const fm = lerFrontmatter(arq);
    assert.deepEqual(fm, { model: e.model, effort: e.effort }, nome);
    const texto = fs.readFileSync(arq, 'utf8');
    assert.match(texto, new RegExp(`^name: ${nome}$`, 'm'), nome);
    assert.match(texto, /^description: .{40,}$/m, nome);
    assert.deepEqual(tools(texto), e.tools, nome);
    assert.equal(/^disallowedTools:\s*(.+)$/m.exec(texto.split('\n---')[0])?.[1].trim() ?? null, e.bloqueadas ?? null, nome);
  }
  assert.deepEqual(fs.readdirSync(path.join(repo, 'agents')).sort(), Object.keys(ESPERADO).map((n) => `${n}.md`).sort());
});

test('busca, revisor, varredor e auditor não editam; todo agente traz o contrato de relatório', () => {
  for (const nome of ['busca', 'revisor']) {
    const t = tools(fs.readFileSync(path.join(repo, 'agents', `${nome}.md`), 'utf8'));
    assert.ok(!t.includes('Edit') && !t.includes('Write'), nome);
  }
  for (const nome of ['varredor', 'auditor']) assert.equal(ESPERADO[nome].bloqueadas, SEM_ESCRITA, nome);
  for (const nome of Object.keys(ESPERADO)) {
    const corpo = fs.readFileSync(path.join(repo, 'agents', `${nome}.md`), 'utf8');
    for (const item of ['Feito:', COM_ARQUIVOS.has(nome) ? 'Arquivos:' : 'Evidência:', 'Não feito:', 'Certeza:']) assert.ok(corpo.includes(item), `${nome} sem ${item}`);
  }
});

test('claude plugin validate aceita o plugin com os agentes', { skip: process.env.HADOUKEN_VALIDAR !== '1' }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', '.'], { cwd: repo, encoding: 'utf8', shell: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perfilRoteamento, familiaDoModelo } from '../src/guarda/despacho.js';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-rot-perfil-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const cfg = path.join(tmp, 'cfg');
fs.mkdirSync(path.join(cfg, 'agents'), { recursive: true });
fs.writeFileSync(path.join(cfg, 'agents', 'fable-max.md'), '---\nmodel: fable\neffort: max\n---\n');
const base = { cwd: tmp, dirConfigClaude: cfg, env: {}, modeloSessao: 'Opus 5.5', raizPlugin: repo };
const p = (ti, extra = {}) => perfilRoteamento({ ...base, toolInput: ti, ...extra });

test('familiaDoModelo pelos nomes e IDs', () => {
  assert.equal(familiaDoModelo('claude-haiku-5-5'), 'haiku');
  assert.equal(familiaDoModelo('Sonnet 5.5'), 'sonnet');
  assert.equal(familiaDoModelo('opus'), 'opus');
  assert.equal(familiaDoModelo('Fable 5.1'), 'fable');
  assert.equal(familiaDoModelo('gpt'), 'desconhecido');
  assert.equal(familiaDoModelo(7), 'desconhecido');
});

test('agente do plugin hadouken:x resolve pelo agents/ do plugin (foco 1)', () => {
  assert.deepEqual(p({ subagent_type: 'hadouken:busca' }), { agente: 'hadouken:busca', familia: 'haiku', effort: 'low', origem: 'frontmatter', doArquivo: { model: 'haiku', effort: 'low' } });
  assert.equal(p({ subagent_type: 'hadouken:busca', model: 'opus' }).familia, 'opus');
  assert.equal(p({ subagent_type: 'hadouken:busca', model: 'opus' }).origem, 'parametro');
  assert.equal(p({ subagent_type: 'hadouken:busca' }, { env: { CLAUDE_EFFORT: 'max' } }).effortDaSessao, undefined);
  assert.equal(p({ subagent_type: 'Explore' }, { env: { CLAUDE_EFFORT: 'xhigh' } }).effortDaSessao, true);
  assert.equal(p({ subagent_type: 'hadouken:nao-existe' }).familia, 'desconhecido');
  assert.equal(p({ subagent_type: 'hadouken:../../x' }).agente, null);
});

test('Explore: família só pelo parâmetro; agente do usuário pelo frontmatter', () => {
  assert.equal(p({ subagent_type: 'Explore' }).familia, 'desconhecido');
  assert.equal(p({ subagent_type: 'Explore', model: 'fable' }).familia, 'fable');
  assert.deepEqual(p({ subagent_type: 'fable-max' }).doArquivo, { model: 'fable', effort: 'max' });
  assert.equal(p({ subagent_type: 'general-purpose' }).familia, 'opus');
});

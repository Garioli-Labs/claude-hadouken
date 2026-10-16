import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_ROTEAMENTO, registrarDespacho, despachosRecentes, lerDespachos, hashesDePalavras } from '../src/roteamento/registro.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-rot-reg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const D = 86_400_000;
const ag = 1_800_000_000_000;
const reg = (o) => ({ sessao: 's1', agente: 'Explore', familia: 'haiku', effort: 'low', regra: null, decisao: 'passar', em: ag, tamPrompt: 50, palavras: [], ...o });

test('grava, lê 7 dias e corta em 500', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'a'));
  registrarDespacho(d, reg({ em: ag - 8 * D }));
  for (let i = 0; i < 510; i++) registrarDespacho(d, reg({ em: ag - i }));
  const l = lerDespachos(d, ag);
  assert.equal(l.length, 500);
  assert.ok(l.every((r) => ag - r.em <= 7 * D));
});

test('recentes só da sessão; campo inválido descarta o registro; arquivo-pasta é ausente', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'b'));
  registrarDespacho(d, reg({ sessao: 's2' }));
  registrarDespacho(d, reg({ agente: '<script>' }));
  assert.deepEqual(despachosRecentes(d, 's1', ag), []);
  assert.equal(despachosRecentes(d, 's2', ag).length, 1);
  const e = fs.mkdtempSync(path.join(tmp, 'c'));
  fs.mkdirSync(path.join(e, ARQ_ROTEAMENTO));
  assert.deepEqual(lerDespachos(e, ag), []);
});

test('palavras viram hashes; o texto nunca é gravado', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'd'));
  const h = hashesDePalavras('Revisar o diff da Task 3, revisar');
  assert.ok(h.length >= 3 && h.length <= 40 && h.every(Number.isInteger));
  registrarDespacho(d, reg({ palavras: h }));
  assert.doesNotMatch(fs.readFileSync(path.join(d, ARQ_ROTEAMENTO), 'utf8'), /Revisar/);
});

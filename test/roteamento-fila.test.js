import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { escolher, marcaDaSessao, TEXTOS, DIR_SESSOES } from '../src/roteamento/fila.js';
import { MARCAS_VALIDAS } from '../src/formato.js';

// Task 10 do plano do roteamento: a fila das sugestões, uma por 30 min por
// sessão, e a marca da barra.

const dirs = [];
function novo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk fila ç '));
  dirs.push(d);
  return d;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const T = Date.parse('2026-10-19T12:00:00.000Z');
const MIN = 60_000;
const O5 = { chave: 'O5', economia: 4 };
const SONNET = { chave: 'model-sonnet', economia: 3 };
const O2 = { chave: 'O2', economia: 1 };

test('sai a de maior economia, com a linha e a marca da tabela (foco 5)', () => {
  const dir = novo();
  assert.deepEqual(escolher({ dir, sessionId: 's1', candidatas: [O2, SONNET], agoraMs: T }),
    { chave: 'model-sonnet', linha: TEXTOS['model-sonnet'].linha, marca: '↓ sonnet' });
  assert.equal(marcaDaSessao(dir, 's1', T + MIN), '↓ sonnet');
});

test('uma por 30 min; depois, só quando a sugestão muda', () => {
  const dir = novo();
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [O5], agoraMs: T }).chave, 'O5');
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [SONNET], agoraMs: T + 29 * MIN }), null);
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [O5], agoraMs: T + 31 * MIN }), null);
  assert.equal(marcaDaSessao(dir, 's1', T + 31 * MIN), null);
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [O5, O2], agoraMs: T + 32 * MIN }).chave, 'O2');
  assert.equal(marcaDaSessao(dir, 's1', T + 33 * MIN), null); // O2 não tem marca
  // Outra sessão não é afetada.
  assert.equal(escolher({ dir, sessionId: 's2', candidatas: [O5], agoraMs: T + MIN }).chave, 'O5');
});

test('sessionId inválido, sem candidatas ou candidata desconhecida: null', () => {
  const dir = novo();
  assert.equal(escolher({ dir, sessionId: '../x', candidatas: [O5], agoraMs: T }), null);
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [], agoraMs: T }), null);
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [{ chave: 'X', economia: 9 }], agoraMs: T }), null);
  assert.equal(escolher(undefined), null);
  assert.equal(marcaDaSessao(dir, '../x', T), null);
});

test('arquivo da sessão corrompido conta como ausente', () => {
  const dir = novo();
  fs.mkdirSync(path.join(dir, DIR_SESSOES));
  fs.writeFileSync(path.join(dir, DIR_SESSOES, 's1.json'), '{ quebrado');
  assert.equal(marcaDaSessao(dir, 's1', T), null);
  assert.equal(escolher({ dir, sessionId: 's1', candidatas: [O5], agoraMs: T }).chave, 'O5');
});

test('arquivos com mais de 24 h são apagados', () => {
  const dir = novo();
  const pasta = path.join(dir, DIR_SESSOES);
  fs.mkdirSync(pasta);
  const velho = path.join(pasta, 'velha.json');
  fs.writeFileSync(velho, '{}');
  const antes = (T - 25 * 60 * MIN) / 1000;
  fs.utimesSync(velho, antes, antes);
  escolher({ dir, sessionId: 's1', candidatas: [O5], agoraMs: T });
  assert.equal(fs.existsSync(velho), false);
  assert.equal(fs.existsSync(path.join(pasta, 's1.json')), true);
});

test('as marcas da fila são as que a barra aceita', () => {
  const marcas = Object.values(TEXTOS).map((t) => t.marca).filter(Boolean);
  assert.deepEqual([...marcas].sort(), [...MARCAS_VALIDAS].sort());
});

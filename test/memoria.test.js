import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoriaDisponivel } from '../src/memoria.js';

// Memória "livre" para decidir se dá para rodar algo: no macOS o
// os.freemem() conta só páginas livres (o resto é cache reaproveitável) e
// quase sempre dá ~0; ali vale process.availableMemory(). Nas outras
// plataformas nada muda: os.freemem().

const GB = 1024 ** 3;
const livre = () => 0.08 * GB;
const disponivel = () => 4 * GB;

test('darwin com disponível válido: usa o disponível', () => {
  assert.equal(memoriaDisponivel({ plataforma: 'darwin', livre, disponivel }), 4 * GB);
});

test('darwin sem a função (Node antigo): cai no livre', () => {
  // undefined fica de fora: no parâmetro, vira o padrão (process.availableMemory).
  for (const ausente of [null, 'x', 42]) {
    assert.equal(memoriaDisponivel({ plataforma: 'darwin', livre, disponivel: ausente }), 0.08 * GB);
  }
});

test('darwin com valor inválido ou exceção: cai no livre', () => {
  for (const v of [0, -1, Number.NaN, Infinity, '4', null, undefined]) {
    assert.equal(memoriaDisponivel({ plataforma: 'darwin', livre, disponivel: () => v }), 0.08 * GB, String(v));
  }
  const lanca = () => { throw new Error('x'); };
  assert.equal(memoriaDisponivel({ plataforma: 'darwin', livre, disponivel: lanca }), 0.08 * GB);
});

test('linux e win32 ignoram o disponível', () => {
  for (const plataforma of ['linux', 'win32', 'freebsd']) {
    assert.equal(memoriaDisponivel({ plataforma, livre, disponivel }), 0.08 * GB, plataforma);
  }
});

test('o livre que lança propaga (cada consumidor já trata)', () => {
  const lanca = () => { throw new Error('livre'); };
  assert.throws(() => memoriaDisponivel({ plataforma: 'linux', livre: lanca }), /livre/);
  assert.throws(() => memoriaDisponivel({ plataforma: 'darwin', livre: lanca, disponivel: () => 0 }), /livre/);
});

test('padrões: sem argumento devolve um número finito', () => {
  const v = memoriaDisponivel();
  assert.ok(Number.isFinite(v) && v >= 0);
});

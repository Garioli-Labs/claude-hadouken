import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barrinha, CASAS, CHEIA, MARCA, VAZIA } from '../src/barrinha.js';

// Barrinha da v0.2.0 (spec §4 e §9): 8 casas de 12,5 pontos, travas de
// "uso visível nunca some" e "cheia só com 100", marca ┃ do ritmo.

test('constantes: 8 casas e os três glifos de largura 1', () => {
  assert.equal(CASAS, 8);
  assert.equal(CHEIA, '▰');
  assert.equal(VAZIA, '▱');
  assert.equal(MARCA, '┃');
});

test('fronteiras da spec: 0, 0,5, 1, 6,25, 12,5, 56,25, 99 e 100', () => {
  const casos = [
    [0, '▱▱▱▱▱▱▱▱'],
    [0.5, '▱▱▱▱▱▱▱▱'],
    [0.99, '▱▱▱▱▱▱▱▱'],
    [1, '▰▱▱▱▱▱▱▱'],
    [6.24, '▰▱▱▱▱▱▱▱'],
    [6.25, '▰▱▱▱▱▱▱▱'],
    [12.5, '▰▱▱▱▱▱▱▱'],
    [18.75, '▰▰▱▱▱▱▱▱'],
    [42, '▰▰▰▱▱▱▱▱'],
    [56.25, '▰▰▰▰▰▱▱▱'],
    [59, '▰▰▰▰▰▱▱▱'],
    [92, '▰▰▰▰▰▰▰▱'],
    [93.75, '▰▰▰▰▰▰▰▱'],
    [99, '▰▰▰▰▰▰▰▱'],
    [99.99, '▰▰▰▰▰▰▰▱'],
    [100, '▰▰▰▰▰▰▰▰'],
  ];
  for (const [pct, esperado] of casos) assert.equal(barrinha(pct), esperado, String(pct));
});

test('inválidos devolvem null: NaN, infinitos, fora de [0, 100], não número', () => {
  for (const v of [Number.NaN, Infinity, -Infinity, -1, -0.001, 100.1, 101, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, '42', null, undefined, true, {}, [], 42n]) {
    assert.equal(barrinha(v), null, String(v));
  }
  assert.equal(barrinha(-0), '▱▱▱▱▱▱▱▱');
});

test('marca: depois das k = round(marca / 12,5) primeiras casas', () => {
  const com61 = [[59, '▰▰▰▰▰┃▱▱▱'], [40, '▰▰▰▱▱┃▱▱▱'], [80, '▰▰▰▰▰┃▰▱▱']];
  for (const [u, esperado] of com61) assert.equal(barrinha(u, { marca: 61 }), esperado, String(u));
  assert.equal(barrinha(0, { marca: 0 }), '┃▱▱▱▱▱▱▱▱');
  assert.equal(barrinha(40, { marca: 0 }), '┃▰▰▰▱▱▱▱▱');
  assert.equal(barrinha(100, { marca: 100 }), '▰▰▰▰▰▰▰▰┃');
  assert.equal(barrinha(99, { marca: 100 }), '▰▰▰▰▰▰▰▱┃');
  assert.equal(barrinha(61, { marca: 50 }), '▰▰▰▰┃▰▱▱▱');
  // Cada fronteira: marca em k * 12,5 põe o ┃ depois de k casas.
  for (let k = 0; k <= CASAS; k++) {
    const b = barrinha(0, { marca: k * 12.5 });
    assert.equal(b.indexOf(MARCA), k, String(k));
  }
});

test('marca inválida sai sem marca; opcoes hostis nunca lançam', () => {
  const armadilha = { get marca() { throw new Error('getter'); } };
  for (const opcoes of [undefined, null, 7, 'x', {}, { marca: Number.NaN }, { marca: -1 }, { marca: 100.5 }, { marca: '50' }, { marca: null }, armadilha]) {
    assert.equal(barrinha(42, opcoes), '▰▰▰▱▱▱▱▱', String(opcoes));
  }
  assert.equal(barrinha(Number.NaN, { marca: 50 }), null, 'pct inválido é null mesmo com marca');
});

test('largura: 8 colunas sem marca, 9 com; só os três glifos', () => {
  for (let pct = 0; pct <= 100; pct += 0.5) {
    const sem = barrinha(pct);
    assert.equal([...sem].length, 8, String(pct));
    assert.match(sem, /^▰*▱*$/u, String(pct));
    const com = barrinha(pct, { marca: 100 - pct });
    assert.equal([...com].length, 9, String(pct));
    assert.equal(com.split(MARCA).length, 2, String(pct));
  }
});

test('monotonia: mais uso nunca tem menos casas cheias', () => {
  let antes = 0;
  for (let pct = 0; pct <= 100; pct += 0.25) {
    const n = [...barrinha(pct)].filter((c) => c === CHEIA).length;
    assert.ok(n >= antes, `${pct}: ${n} < ${antes}`);
    antes = n;
  }
});

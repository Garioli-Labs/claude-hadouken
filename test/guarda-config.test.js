import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PADRAO_GUARDA, LIBERACAO_TETO_H, guardaDaConfig, lerConfigGuarda } from '../src/guarda/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-cfg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('padrões quando não há chave guarda', () => {
  for (const v of [undefined, null, {}, { repos: ['a/b'] }]) {
    assert.deepEqual(guardaDaConfig(v), { config: { ...PADRAO_GUARDA }, avisos: [] });
  }
  assert.deepEqual(PADRAO_GUARDA, {
    ligada: true, teto5h: 90, horizonte5hMin: 90, margemReset5hMin: 15, teto7d: 85, horizonte7dH: 24,
    fableDespachosMax: 4, fableDespachosHoras: 5, liberacaoPadraoH: 2, liberacaoMaxH: 24, liberacaoTetoPontos7d: 10,
    fableTetoPct: 90,
  });
});

test('fable.tetoPct: padrão 90, faixa 50–100', () => {
  assert.equal(PADRAO_GUARDA.fableTetoPct, 90);
  assert.equal(guardaDaConfig({ guarda: { fable: { tetoPct: 75 } } }).config.fableTetoPct, 75);
  const r = guardaDaConfig({ guarda: { fable: { tetoPct: 40 } } });
  assert.equal(r.config.fableTetoPct, 90);
  assert.equal(r.avisos.length, 1);
});

test('campos válidos entram, inválidos usam o padrão com aviso fixo', () => {
  const { config, avisos } = guardaDaConfig({ guarda: {
    ligada: false, teto5h: 80, teto7d: 'x', horizonte7dH: 999,
    fableDespachos: { max: 2, horas: 3 }, liberacao: { padraoH: 1, maxH: 8, tetoPontos7d: 0 },
    margemRitmo7d: 20, __proto__: { teto5h: 1 },
  } });
  assert.equal(config.ligada, false);
  assert.equal(config.teto5h, 80);
  assert.equal(config.teto7d, 85);
  assert.equal(config.horizonte7dH, 24);
  assert.equal(config.fableDespachosMax, 2);
  assert.equal(config.fableDespachosHoras, 3);
  assert.equal(config.liberacaoPadraoH, 1);
  assert.equal(config.liberacaoMaxH, 8);
  assert.equal(config.liberacaoTetoPontos7d, 10);
  assert.deepEqual(avisos, [
    'config.json: guarda.teto7d inválido, usando 85',
    'config.json: guarda.horizonte7dH inválido, usando 24',
    'config.json: guarda.liberacao.tetoPontos7d inválido, usando 10',
  ]);
});

// LIBERACAO_TETO_H mora aqui e é o máximo das duas faixas da liberação;
// liberacao.js recusa na leitura qualquer liberação mais longa que ele.
test('LIBERACAO_TETO_H é o máximo de liberacao.padraoH e liberacao.maxH, e o padrão do maxH', () => {
  assert.equal(LIBERACAO_TETO_H, 24);
  assert.equal(PADRAO_GUARDA.liberacaoMaxH, LIBERACAO_TETO_H);
  const noTeto = guardaDaConfig({ guarda: { liberacao: { padraoH: LIBERACAO_TETO_H, maxH: LIBERACAO_TETO_H } } });
  assert.deepEqual([noTeto.config.liberacaoPadraoH, noTeto.config.liberacaoMaxH, noTeto.avisos], [LIBERACAO_TETO_H, LIBERACAO_TETO_H, []]);
  assert.deepEqual(guardaDaConfig({ guarda: { liberacao: { padraoH: LIBERACAO_TETO_H + 1, maxH: LIBERACAO_TETO_H + 1 } } }).avisos, [
    'config.json: guarda.liberacao.padraoH inválido, usando 2',
    'config.json: guarda.liberacao.maxH inválido, usando 24',
  ]);
});

test('padraoH acima de maxH é cortado em maxH', () => {
  assert.equal(guardaDaConfig({ guarda: { liberacao: { padraoH: 10, maxH: 4 } } }).config.liberacaoPadraoH, 4);
});

test('guarda que não é objeto: padrões com um aviso', () => {
  assert.deepEqual(guardaDaConfig({ guarda: [1] }).avisos, ['config.json: guarda inválida, usando os padrões']);
});

test('lerConfigGuarda: ausente, ilegível e válido', () => {
  assert.deepEqual(lerConfigGuarda(tmp), { config: { ...PADRAO_GUARDA }, avisos: [] });
  fs.writeFileSync(path.join(tmp, 'config.json'), '{quebrado');
  assert.deepEqual(lerConfigGuarda(tmp).avisos, ['config.json ilegível: guarda com os padrões']);
  assert.equal(lerConfigGuarda(tmp).config.ligada, true);
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ guarda: { teto7d: 70 } }));
  assert.equal(lerConfigGuarda(tmp).config.teto7d, 70);
  assert.deepEqual(lerConfigGuarda(null), { config: { ...PADRAO_GUARDA }, avisos: [] });
});

test('lerConfigGuarda: config.json presente que não abre é ilegível, não ausente (fail-closed)', (t) => {
  // lerJson devolve 'ausente' quando o open falha num arquivo que existe
  // (preso por outro processo, sem permissão). Aqui isso vira padrões com
  // aviso: um "ligada: false" que não se lê nunca desliga a guarda.
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('sem como negar a leitura de um arquivo aqui'); return; }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-cfg-'));
  try {
    const arq = path.join(d, 'config.json');
    fs.writeFileSync(arq, JSON.stringify({ guarda: { ligada: false } }));
    fs.chmodSync(arq, 0o000);
    assert.deepEqual(lerConfigGuarda(d), { config: { ...PADRAO_GUARDA }, avisos: ['config.json ilegível: guarda com os padrões'] });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregar } from '../src/agregacao.js';

const r = (o) => ({ requestId: Math.random().toString(), ts: 1000, sessionId: 's', subagente: false, projeto: 'A', model: 'claude-opus-5', effort: 'high', input: 10, output: 100, thinking: 0, cacheRead: 90, cacheCreate: 0, ...o });

test('agrega por projeto, modelo·effort e principal/subagente, com acerto de cache', () => {
  const a = agregar([r(), r({ projeto: 'B', effort: null }), r({ subagente: true, model: 'claude-haiku-4-5' }), r({ ts: 1 })], 500);
  assert.equal(a.total.respostas, 3);
  assert.equal(a.total.acertoCache, 0.9);
  assert.equal(a.porProjeto.A.respostas, 2);
  assert.equal(a.porModeloEffort['claude-opus-5·—'].respostas, 1);
  assert.equal(a.porModeloEffort['claude-haiku-4-5·high'].respostas, 1);
  assert.equal(a.principalVsSubagente.subagente.respostas, 1);
});

test('sem registros o acerto de cache é null, não zero', () => {
  assert.equal(agregar([], 0).total.acertoCache, null);
});

// ---------------------------------------------------------------------------
// Além do brief: somas, arredondamento, bordas e entrada hostil.

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const CSI8 = String.fromCodePoint(0x9b);
const LS = String.fromCodePoint(0x2028);
const vazia = { respostas: 0, input: 0, output: 0, thinking: 0, cacheRead: 0, cacheCreate: 0, acertoCache: null };

test('soma todos os campos e arredonda o acerto de cache a 3 casas', () => {
  const a = agregar([
    r({ input: 1, output: 2, thinking: 3, cacheRead: 1, cacheCreate: 1 }),
    r({ input: 0, output: 5, thinking: 7, cacheRead: 0, cacheCreate: 0 }),
  ], 0);
  assert.deepEqual(a.total, { respostas: 2, input: 1, output: 7, thinking: 10, cacheRead: 1, cacheCreate: 1, acertoCache: 0.333 });
  assert.equal(agregar([r({ input: 1, cacheRead: 2, cacheCreate: 0 })], 0).total.acertoCache, 0.667);
});

test('grupo com denominador zero tem acerto null e os outros seguem calculados', () => {
  const a = agregar([r({ projeto: 'Z', input: 0, cacheRead: 0, cacheCreate: 0 }), r({ projeto: 'Y' })], 0);
  assert.equal(a.porProjeto.Z.acertoCache, null);
  assert.equal(a.porProjeto.Y.acertoCache, 0.9);
  assert.deepEqual(a.principalVsSubagente.subagente, vazia);
});

test('ts igual a desdeMs entra; ts ausente, NaN, texto ou infinito fica de fora', () => {
  const a = agregar([
    r({ ts: 500 }), r({ ts: undefined }), r({ ts: Number.NaN }), r({ ts: '2026-09-25T10:00:00Z' }),
    r({ ts: Number.POSITIVE_INFINITY }), r({ ts: null }),
  ], 500);
  assert.equal(a.total.respostas, 1);
});

test('desdeMs inválido devolve o agregado vazio, nunca conta tudo', () => {
  for (const desde of [Number.NaN, undefined, null, '0', Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const a = agregar([r()], desde);
    assert.deepEqual(a.total, vazia);
    assert.deepEqual(Object.keys(a.porProjeto), []);
  }
});

test('registros que não são lista devolvem o agregado vazio', () => {
  for (const lista of [null, undefined, {}, 'x', 42, { length: 2, 0: r(), 1: r() }]) {
    const a = agregar(lista, 0);
    assert.deepEqual(a.total, vazia);
    assert.deepEqual(a.principalVsSubagente, { principal: vazia, subagente: vazia });
  }
  assert.doesNotThrow(() => agregar());
});

test('números inválidos contam como 0 (mesma regra da Task 8: inteiro de 0 a 1e9)', () => {
  const a = agregar([r({
    input: Number.NaN, output: Number.POSITIVE_INFINITY, thinking: -5, cacheRead: 1.5, cacheCreate: '10',
  }), r({ input: 1e10, output: 7, thinking: 1e9, cacheRead: 0, cacheCreate: 0 })], 0);
  assert.deepEqual(a.total, { respostas: 2, input: 0, output: 7, thinking: 1e9, cacheRead: 0, cacheCreate: 0, acertoCache: null });
});

test('subagente só com true estrito; o resto é principal', () => {
  const a = agregar([r({ subagente: 'true' }), r({ subagente: 1 }), r({ subagente: true }), r({ subagente: undefined })], 0);
  assert.equal(a.principalVsSubagente.principal.respostas, 3);
  assert.equal(a.principalVsSubagente.subagente.respostas, 1);
});

test('projeto e modelo ausentes viram —; effort fora da lista fixa vira —', () => {
  const a = agregar([
    r({ projeto: null, model: null, effort: 'ULTRA' }),
    r({ projeto: '', model: '   ', effort: { level: 'max' } }),
    r({ projeto: 42, model: {}, effort: 'xhigh' }),
  ], 0);
  assert.equal(a.porProjeto['—'].respostas, 3);
  assert.deepEqual(Object.keys(a.porModeloEffort).sort(), ['—·max', '—·xhigh', '—·—']);
});

test('chaves hostis de projeto e modelo não poluem protótipo nenhum', () => {
  const nomes = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__'];
  const a = agregar(nomes.map((n) => r({ projeto: n, model: n })), 0);
  for (const n of nomes) {
    assert.ok(Object.hasOwn(a.porProjeto, n), n);
    assert.equal(a.porProjeto[n].respostas, 1);
    assert.equal(a.porModeloEffort[`${n}·high`].respostas, 1);
  }
  assert.equal(Object.getPrototypeOf(a.porProjeto), null);
  assert.equal(Object.getPrototypeOf(a.porModeloEffort), null);
  assert.equal(Object.prototype.respostas, undefined);
  assert.equal(Object.respostas, undefined);
  assert.equal({}.respostas, undefined);
  assert.equal(a.total.respostas, nomes.length);
  // Serializa como objeto comum: o relatório --json não perde nenhuma chave.
  assert.equal(JSON.parse(JSON.stringify(a)).porProjeto.__proto__.respostas, 1);
});

// Controles C0/C1, separadores de linha e parágrafo, controles bidi, | e crase.
const proibido = (cp) => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029
  || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x7c || cp === 0x60;

test('texto hostil em projeto e modelo sai saneado das chaves (S2)', () => {
  const hostil = `${ESC}]8;;https://evil.example${BEL}clique${ESC}]8;;${BEL}${ESC}[31mX${RLO}${LRI}a|b\`c\nd${LS}e${CSI8}2Jf`;
  const longo = 'p'.repeat(500);
  const a = agregar([r({ projeto: hostil, model: hostil }), r({ projeto: longo, model: longo })], 0);
  const chaves = [...Object.keys(a.porProjeto), ...Object.keys(a.porModeloEffort)];
  for (const k of chaves) {
    assert.ok(Array.from(k).every((c) => !proibido(c.codePointAt(0))), JSON.stringify(k));
    assert.ok(!k.includes('evil.example'), JSON.stringify(k));
  }
  assert.deepEqual(Object.keys(a.porProjeto), ['cliqueXabcdef', longo.slice(0, 64)]);
  assert.deepEqual(Object.keys(a.porModeloEffort), ['cliqueXabcdef·high', `${longo.slice(0, 40)}·high`]);
});

test('registro hostil (getter que lança, Proxy, null) é pulado sem desalinhar as somas', () => {
  const lanca = r();
  Object.defineProperty(lanca, 'cacheCreate', { get() { throw new Error('x'); }, enumerable: true });
  const proxy = new Proxy({}, { get() { throw new Error('x'); } });
  const a = agregar([r(), lanca, proxy, null, 7, 'x', r({ projeto: 'B' })], 0);
  assert.equal(a.total.respostas, 2);
  assert.equal(a.total.input, 20);
  assert.equal(a.porProjeto.A.respostas, 1);
  assert.equal(a.principalVsSubagente.principal.respostas, 2);
});

test('o agregado não guarda referência aos registros de entrada', () => {
  const reg = [r()];
  const a = agregar(reg, 0);
  reg[0].input = 999;
  assert.equal(a.total.input, 10);
});

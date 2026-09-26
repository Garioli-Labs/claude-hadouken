import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregar, MAX_ROTULOS_SESSAO, MAX_SESSOES, pesoConsumo } from '../src/agregacao.js';

const r = (o) => ({ requestId: Math.random().toString(), ts: 1000, sessionId: 's', subagente: false, projeto: 'A', model: 'claude-opus-5', effort: 'high', input: 10, output: 100, thinking: 0, cacheRead: 90, cacheCreate: 0, cacheCreate1h: null, cacheCreate5m: null, ...o });
// Soma com os campos de cache criado zerados, para os testes que só olham os
// outros.
const soma = (o) => ({ respostas: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0, cacheCreate5m: 0, cacheCreateSemDetalhe: 0, acertoCache: null, ...o });

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
const vazia = soma();

test('soma todos os campos e arredonda o acerto de cache a 3 casas', () => {
  const a = agregar([
    r({ input: 1, output: 2, thinking: 3, cacheRead: 1, cacheCreate: 1 }),
    r({ input: 0, output: 5, thinking: 7, cacheRead: 0, cacheCreate: 0 }),
  ], 0);
  assert.deepEqual(a.total, soma({ respostas: 2, input: 1, output: 7, cacheRead: 1, cacheCreate: 1, cacheCreateSemDetalhe: 1, acertoCache: 0.333 }));
  assert.equal(agregar([r({ input: 1, cacheRead: 2, cacheCreate: 0 })], 0).total.acertoCache, 0.667);
});

// Adiado (spec 12): os transcripts trazem thinking_tokens só em parte das
// respostas; somar a ausência como 0 apresentaria um piso como total.
test('pensamento (thinking) não entra em nenhuma soma', () => {
  const a = agregar([r({ thinking: 40 }), r({ thinking: 7, sessionId: 't' })], 0);
  const somas = [a.total, ...Object.values(a.porProjeto), ...Object.values(a.porModeloEffort), a.principalVsSubagente.principal, ...Object.values(a.porSessao)];
  for (const s of somas) assert.equal(Object.hasOwn(s, 'thinking'), false);
  assert.doesNotMatch(JSON.stringify(a), /thinking/);
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
    assert.deepEqual(Object.keys(a.porSessao), []);
    assert.equal(a.sessoesOmitidas, 0);
  }
  assert.doesNotThrow(() => agregar());
});

test('números inválidos contam como 0 (mesma regra da Task 8: inteiro de 0 a 1e9)', () => {
  const a = agregar([r({
    input: Number.NaN, output: Number.POSITIVE_INFINITY, thinking: -5, cacheRead: 1.5, cacheCreate: '10',
  }), r({ input: 1e10, output: 7, thinking: 1e9, cacheRead: 0, cacheCreate: 0 })], 0);
  assert.deepEqual(a.total, soma({ respostas: 2, output: 7 }));
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

// ---------------------------------------------------------------------------
// Cache criado por duração (1 h e 5 min) e o balde "sem detalhe"

// Em toda soma do agregado: 1 h + 5 min + sem detalhe = total.
function todasAsSomas(a) {
  return [
    a.total, a.principalVsSubagente.principal, a.principalVsSubagente.subagente,
    ...Object.values(a.porProjeto), ...Object.values(a.porModeloEffort), ...Object.values(a.porSessao),
  ];
}
const confereReparticao = (a) => {
  for (const s of todasAsSomas(a)) assert.equal(s.cacheCreate1h + s.cacheCreate5m + s.cacheCreateSemDetalhe, s.cacheCreate, JSON.stringify(s));
};

test('cache criado: detalhe coerente vai para 1 h e 5 min; ausente fica sem detalhe, nunca deduzido', () => {
  const a = agregar([
    r({ projeto: 'com', cacheCreate: 150, cacheCreate1h: 100, cacheCreate5m: 50 }),
    r({ projeto: 'com', cacheCreate: 0, cacheCreate1h: 0, cacheCreate5m: 0 }),
    r({ projeto: 'sem', cacheCreate: 70, cacheCreate1h: null, cacheCreate5m: null }),
    r({ projeto: 'sem', cacheCreate: 30 }),
  ], 0);
  assert.deepEqual([a.porProjeto.com.cacheCreate1h, a.porProjeto.com.cacheCreate5m, a.porProjeto.com.cacheCreateSemDetalhe], [100, 50, 0]);
  assert.deepEqual([a.porProjeto.sem.cacheCreate1h, a.porProjeto.sem.cacheCreate5m, a.porProjeto.sem.cacheCreateSemDetalhe], [0, 0, 100]);
  assert.deepEqual([a.total.cacheCreate, a.total.cacheCreate1h, a.total.cacheCreate5m, a.total.cacheCreateSemDetalhe], [250, 100, 50, 100]);
  // O acerto de cache usa o total, repartido ou não.
  assert.equal(a.porProjeto.sem.acertoCache, Math.round((180 / (20 + 180 + 100)) * 1000) / 1000);
  confereReparticao(a);
});

test('cache criado: detalhe incompleto, inválido ou que não soma o total fica inteiro sem detalhe', () => {
  const ruins = {
    'só 1 h': { cacheCreate1h: 100, cacheCreate5m: null },
    'só 5 min': { cacheCreate1h: undefined, cacheCreate5m: 100 },
    negativo: { cacheCreate1h: -1, cacheCreate5m: 101 },
    fracionario: { cacheCreate1h: 99.5, cacheCreate5m: 0.5 },
    texto: { cacheCreate1h: '60', cacheCreate5m: 40 },
    NaN: { cacheCreate1h: Number.NaN, cacheCreate5m: 100 },
    infinito: { cacheCreate1h: Number.POSITIVE_INFINITY, cacheCreate5m: 0 },
    'acima de 1e9': { cacheCreate1h: 1e9 + 1, cacheCreate5m: 0 },
    objeto: { cacheCreate1h: { valueOf: () => 60 }, cacheCreate5m: 40 },
    'soma menor': { cacheCreate1h: 10, cacheCreate5m: 10 },
    'soma maior': { cacheCreate1h: 100, cacheCreate5m: 1 },
    // Visto em transcripts reais (2026-09-26): total 0 com 1 h positivo.
    'total zero com 1 h': { cacheCreate1h: 58, cacheCreate5m: 0, cacheCreate: 0 },
  };
  for (const [nome, extra] of Object.entries(ruins)) {
    const a = agregar([r({ cacheCreate: 100, ...extra })], 0);
    const total = extra.cacheCreate ?? 100;
    assert.deepEqual([a.total.cacheCreate1h, a.total.cacheCreate5m, a.total.cacheCreateSemDetalhe], [0, 0, total], nome);
    confereReparticao(a);
  }
  // Total inválido vale 0, e o detalhe que não soma 0 não entra.
  const a = agregar([r({ cacheCreate: 'x', cacheCreate1h: 5, cacheCreate5m: 5 })], 0);
  assert.deepEqual([a.total.cacheCreate, a.total.cacheCreate1h, a.total.cacheCreate5m, a.total.cacheCreateSemDetalhe], [0, 0, 0, 0]);
});

test('cache criado: getter que lança no detalhe derruba só o registro', () => {
  const lanca = r({ cacheCreate: 10 });
  Object.defineProperty(lanca, 'cacheCreate5m', { get() { throw new Error('x'); }, enumerable: true });
  const a = agregar([lanca, r({ cacheCreate: 30, cacheCreate1h: 30, cacheCreate5m: 0 })], 0);
  assert.equal(a.total.respostas, 1);
  assert.deepEqual([a.total.cacheCreate, a.total.cacheCreate1h, a.total.cacheCreateSemDetalhe], [30, 30, 0]);
});

// ---------------------------------------------------------------------------
// Por sessão

test('por sessão: somas, projetos e modelos (os de mais respostas primeiro), inclusive subagentes', () => {
  const a = agregar([
    r({ sessionId: 's1', projeto: 'P', model: 'claude-opus-5', input: 100 }),
    r({ sessionId: 's1', projeto: 'P', model: 'claude-haiku-4-5', subagente: true, input: 1 }),
    r({ sessionId: 's1', projeto: 'P', model: 'claude-haiku-4-5', subagente: true, input: 1 }),
    r({ sessionId: 's2', projeto: 'Q', model: 'claude-sonnet-5', cacheCreate: 9, cacheCreate1h: 9, cacheCreate5m: 0 }),
    r({ sessionId: null, projeto: 'Q' }),
    r({ sessionId: 's2', ts: 1 }),
  ], 500);
  assert.equal(Object.getPrototypeOf(a.porSessao), null);
  assert.deepEqual(Object.keys(a.porSessao), ['s1', 's2', '—'], 'maior consumo primeiro; sem sessionId vira —');
  const s1 = a.porSessao.s1;
  assert.deepEqual({ respostas: s1.respostas, input: s1.input, output: s1.output }, { respostas: 3, input: 102, output: 300 });
  assert.deepEqual(s1.projetos, ['P']);
  assert.deepEqual(s1.modelos, ['claude-haiku-4-5', 'claude-opus-5'], 'mais respostas primeiro');
  assert.equal(s1.acertoCache, Math.round((270 / (102 + 270)) * 1000) / 1000);
  assert.deepEqual([a.porSessao.s2.respostas, a.porSessao.s2.cacheCreate1h], [1, 9], 'ts antes de desdeMs fica de fora');
  assert.equal(a.sessoesOmitidas, 0);
  confereReparticao(a);
  // A soma das sessões é o total.
  const somaSessoes = Object.values(a.porSessao).reduce((t, s) => t + s.respostas, 0);
  assert.equal(somaSessoes, a.total.respostas);
});

test(`por sessão: no máximo ${MAX_ROTULOS_SESSAO} projetos e ${MAX_ROTULOS_SESSAO} modelos, empate pelo nome`, () => {
  const regs = [];
  for (let i = 0; i < 8; i++) for (let k = 0; k <= i; k++) regs.push(r({ sessionId: 's', projeto: `p${i}`, model: `m${i}` }));
  regs.push(r({ sessionId: 's', model: 'mb' }), r({ sessionId: 's', model: 'ma' }));
  const s = agregar(regs, 0).porSessao.s;
  assert.deepEqual(s.projetos, ['p7', 'p6', 'p5', 'p4', 'p3']);
  assert.deepEqual(s.modelos, ['m7', 'm6', 'm5', 'm4', 'm3']);
  const empate = agregar([r({ sessionId: 's', model: 'mb' }), r({ sessionId: 's', model: 'ma' })], 0).porSessao.s;
  assert.deepEqual(empate.modelos, ['ma', 'mb']);
});

test(`por sessão: só as ${MAX_SESSOES} de maior consumo; as outras são contadas e continuam no total`, () => {
  const n = MAX_SESSOES + 37;
  const regs = [];
  for (let i = 0; i < n; i++) regs.push(r({ sessionId: `s${String(i).padStart(4, '0')}`, input: i, output: 0, cacheRead: 0 }));
  const a = agregar(regs, 0);
  const ids = Object.keys(a.porSessao);
  assert.equal(ids.length, MAX_SESSOES);
  assert.equal(a.sessoesOmitidas, 37);
  assert.equal(ids[0], `s${String(n - 1).padStart(4, '0')}`, 'maior consumo primeiro');
  assert.ok(!Object.hasOwn(a.porSessao, 's0000'), 'o menor consumo sai');
  for (let i = 1; i < ids.length; i++) assert.ok(pesoConsumo(a.porSessao[ids[i - 1]]) >= pesoConsumo(a.porSessao[ids[i]]));
  assert.equal(a.total.respostas, n);
  // Empate de consumo: pelo id.
  const empate = agregar(Array.from({ length: MAX_SESSOES + 1 }, (_, i) => r({ sessionId: `e${String(i).padStart(4, '0')}` })), 0);
  assert.ok(!Object.hasOwn(empate.porSessao, `e${String(MAX_SESSOES).padStart(4, '0')}`));
  assert.equal(empate.sessoesOmitidas, 1);
});

test('malicioso: ids de sessão hostis saem saneados, sem protótipo e sem poluir nada', () => {
  const hostil = `${ESC}]8;;https://evil.example${BEL}clique${ESC}]8;;${BEL}${ESC}[31mS${RLO}${LRI}a|b\`c\nd${LS}e${CSI8}2Jf`;
  const enorme = 'z'.repeat(2_000_000);
  const nomes = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
  const a = agregar([
    r({ sessionId: hostil }), r({ sessionId: enorme }), r({ sessionId: '' }), r({ sessionId: 42 }),
    ...nomes.map((n) => r({ sessionId: n })),
  ], 0);
  assert.equal(Object.getPrototypeOf(a.porSessao), null);
  const ids = Object.keys(a.porSessao);
  for (const k of ids) {
    assert.ok(Array.from(k).every((c) => !proibido(c.codePointAt(0))), JSON.stringify(k));
    assert.ok(!k.includes('evil.example'), JSON.stringify(k));
    assert.ok([...k].length <= 64, `${k.length}`);
  }
  assert.ok(ids.includes('cliqueSabcdef'));
  assert.ok(ids.includes('z'.repeat(64)));
  assert.equal(a.porSessao['—'].respostas, 2, 'vazio e não-texto viram —');
  for (const n of nomes) assert.equal(a.porSessao[n].respostas, 1, n);
  assert.equal(Object.prototype.respostas, undefined);
  assert.equal({}.projetos, undefined);
  assert.equal(JSON.parse(JSON.stringify(a)).porSessao.__proto__.respostas, 1);
});

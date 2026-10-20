import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jaccard, maisForte } from '../src/roteamento/semana.js';
import { marcarRetrabalho, resumoRoteamento } from '../src/roteamento/retrabalho.js';

// Task 11 da v0.5.3 (spec roteamento §8): retrabalho e o resumo da semana.
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const d = (extra = {}) => ({ sessao: 's1', agente: 'Explore', familia: 'haiku', effort: null, regra: null, decisao: 'passar', em: T0, tamPrompt: 100, palavras: [1, 2, 3, 4, 5], ...extra });

test('jaccard sobre conjuntos; vazio com vazio dá 0', () => {
  assert.equal(jaccard(new Set([1, 2, 3]), new Set([2, 3, 4])), 0.5);
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test('ordem de força: haiku < sonnet < opus < fable; desconhecido nunca é mais forte', () => {
  assert.equal(maisForte('sonnet', 'haiku'), true);
  assert.equal(maisForte('fable', 'opus'), true);
  assert.equal(maisForte('haiku', 'sonnet'), false);
  assert.equal(maisForte('opus', 'opus'), false);
  assert.equal(maisForte('desconhecido', 'haiku'), false);
  assert.equal(maisForte('opus', 'desconhecido'), false);
});

test('retrabalho: Jaccard 0,6 conta, 0,59 não', () => {
  // 3 em comum de 5 na união = 0,6.
  const [a] = marcarRetrabalho([d({ palavras: [1, 2, 3, 4] }), d({ familia: 'sonnet', em: T0 + MIN, palavras: [1, 2, 3, 5] })]);
  assert.equal(a.retrabalho, true);
  // 59 em comum de 100 na união = 0,59.
  const comuns = Array.from({ length: 59 }, (_, i) => i);
  const x = [...comuns, ...Array.from({ length: 20 }, (_, i) => 500 + i)];
  const y = [...comuns, ...Array.from({ length: 21 }, (_, i) => 900 + i)];
  assert.equal(jaccard(new Set(x), new Set(y)), 0.59);
  const [b] = marcarRetrabalho([d({ palavras: x }), d({ familia: 'opus', em: T0 + MIN, palavras: y })]);
  assert.equal(b.retrabalho, false);
});

test('retrabalho: família mais fraca, 16 minutos depois ou outra sessão não contam', () => {
  const base = d({ familia: 'opus' });
  assert.equal(marcarRetrabalho([base, d({ familia: 'sonnet', em: T0 + MIN })])[0].retrabalho, false);
  assert.equal(marcarRetrabalho([d(), d({ familia: 'sonnet', em: T0 + 16 * MIN })])[0].retrabalho, false);
  assert.equal(marcarRetrabalho([d(), d({ familia: 'sonnet', em: T0 + 15 * MIN })])[0].retrabalho, true);
  assert.equal(marcarRetrabalho([d(), d({ sessao: 's2', familia: 'sonnet', em: T0 + MIN })])[0].retrabalho, false);
  // O relançamento em si não é retrabalho; a entrada não muda.
  const lista = [d(), d({ familia: 'sonnet', em: T0 + MIN })];
  const marcados = marcarRetrabalho(lista);
  assert.equal(marcados[1].retrabalho, false);
  assert.equal(Object.hasOwn(lista[0], 'retrabalho'), false);
});

// Tabela: mais despachos primeiro; empate pelo nome do agente e pela força.
test('resumo: contagens por agente e por regra a partir de 6 registros', () => {
  const despachos = [
    d({ decisao: 'negar', regra: 'N1', familia: 'opus', agente: 'Explore' }),
    d({ decisao: 'negar', regra: 'N2', familia: 'fable', agente: 'general-purpose', em: T0 + MIN, palavras: [9] }),
    d({ decisao: 'avisar', regra: 'A1', familia: 'fable', agente: 'general-purpose', em: T0 + 2 * MIN, palavras: [8] }),
    d({ agente: 'hadouken:mecanico', em: T0 + 3 * MIN }),
    d({ agente: 'hadouken:mecanico', familia: 'sonnet', em: T0 + 4 * MIN, sessao: 's9', palavras: [7] }),
    d({ agente: 'hadouken:mecanico', familia: 'sonnet', em: T0 + 5 * MIN }),
  ];
  const r = resumoRoteamento({ despachos, respostasSubagente: [] });
  assert.deepEqual(r.porRegra, { N1: 1, N2: 1, A1: 1, A2: 0, A3: 0 });
  assert.deepEqual(r.porAgente, [
    { agente: 'general-purpose', familia: 'fable', despachos: 2, negados: 1, avisados: 1, retrabalhoPct: 0 },
    { agente: 'hadouken:mecanico', familia: 'sonnet', despachos: 2, negados: 0, avisados: 0, retrabalhoPct: 0 },
    { agente: 'Explore', familia: 'opus', despachos: 1, negados: 1, avisados: 0, retrabalhoPct: 0 },
    { agente: 'hadouken:mecanico', familia: 'haiku', despachos: 1, negados: 0, avisados: 0, retrabalhoPct: 100 },
  ]);
  assert.equal(r.custoEvitado, null);
});

test('custo evitado: null com 4 respostas de Haiku; com 5, a mediana vezes os negados N1 e N2', () => {
  const resp = (t, model = 'claude-haiku-4-5') => ({ subagente: true, model, input: t, output: 0, cacheRead: 0, cacheCreate: 0 });
  const despachos = [d({ decisao: 'negar', regra: 'N1' }), d({ decisao: 'negar', regra: 'N2', em: T0 + MIN }), d({ decisao: 'avisar', regra: 'A1', em: T0 + 2 * MIN })];
  const quatro = [resp(100), resp(200), resp(300), resp(400), resp(9999, 'claude-opus-5-5')];
  assert.equal(resumoRoteamento({ despachos, respostasSubagente: quatro }).custoEvitado, null);
  const cinco = [...quatro, { ...resp(0), input: 10, output: 20, cacheRead: 30, cacheCreate: 40 }];
  // Tokens: 100, 200, 300, 400, 100 → mediana 200; dois negados → 400.
  assert.deepEqual(resumoRoteamento({ despachos, respostasSubagente: cinco }).custoEvitado, { tokens: 400, estimativa: true });
  // Respostas da sessão principal não entram.
  const principal = cinco.map((x) => ({ ...x, subagente: false }));
  assert.equal(resumoRoteamento({ despachos, respostasSubagente: principal }).custoEvitado, null);
});

test('resumo: entrada inválida não lança', () => {
  assert.deepEqual(resumoRoteamento(null), { porAgente: [], porRegra: { N1: 0, N2: 0, A1: 0, A2: 0, A3: 0 }, custoEvitado: null });
  assert.deepEqual(marcarRetrabalho('x'), []);
});

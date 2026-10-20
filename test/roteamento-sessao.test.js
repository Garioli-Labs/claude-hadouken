import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sugerirSessao } from '../src/roteamento/sessao.js';

// Task 8 do plano do roteamento: sugestão de modelo e effort para a sessão
// principal, a partir das últimas 15 respostas (Resposta[] da Task 7).

const ferr = (nome, extra = {}) => ({ nome, linhasMudadas: 0, leituraInteira: false, arquivoHash: 'aaaaaaaaaaaa', reverte: false, ...extra });
const resp = (ferramentas, resultados = [], pensamento = 0) => ({ em: 1, ferramentas, pensamento, usage: null, resultados });
const simples = () => resp([ferr('Read'), ferr('Edit', { linhasMudadas: 3 })]);
const varias = (n, f = simples) => Array.from({ length: n }, f);

test('15 simples em Fable high: effort-medium', () => {
  assert.deepEqual(sugerirSessao({ respostas: varias(15), modelo: 'Fable 5.1', effort: 'high' }), { chave: 'effort-medium', economia: 2 });
});

test('15 simples em Opus medium: model-sonnet', () => {
  assert.deepEqual(sugerirSessao({ respostas: varias(15), modelo: 'Opus 5.5', effort: 'medium' }), { chave: 'model-sonnet', economia: 3 });
});

test('Sonnet medium: nada', () => {
  assert.equal(sugerirSessao({ respostas: varias(15), modelo: 'Sonnet 5.5', effort: 'medium' }), null);
});

test('11 simples e 4 com Agent (73%): nada', () => {
  const rs = [...varias(11), ...varias(4, () => resp([ferr('Read'), ferr('Agent')]))];
  assert.equal(sugerirSessao({ respostas: rs, modelo: 'Opus 5.5', effort: 'high' }), null);
});

test('só 10 respostas: nada', () => {
  assert.equal(sugerirSessao({ respostas: varias(10), modelo: 'Fable 5.1', effort: 'high' }), null);
});

test('medium com o mesmo comando falhando 3 vezes: effort-high', () => {
  const falha = () => resp([ferr('Bash')], [{ nome: 'Bash', bytes: 10, linhasLidas: 0, falhou: true, comandoHash: 'bbbbbbbbbbbb' }]);
  const rs = [...varias(12, () => resp([ferr('Bash')])), ...varias(3, falha)];
  assert.deepEqual(sugerirSessao({ respostas: rs, modelo: 'Sonnet 5.5', effort: 'medium' }), { chave: 'effort-high', economia: 1 });
  const duas = [...varias(13, () => resp([ferr('Bash')])), ...varias(2, falha)];
  assert.equal(sugerirSessao({ respostas: duas, modelo: 'Sonnet 5.5', effort: 'medium' }), null);
});

test('medium com um Edit que desfaz o anterior (reverte): effort-high', () => {
  const rs = [...varias(14, () => resp([ferr('Bash')])), resp([ferr('Edit', { linhasMudadas: 1, reverte: true })])];
  assert.deepEqual(sugerirSessao({ respostas: rs, modelo: 'Sonnet 5.5', effort: 'medium' }), { chave: 'effort-high', economia: 1 });
});

test('modelo ou effort null: nada (foco 4)', () => {
  assert.equal(sugerirSessao({ respostas: varias(15), modelo: null, effort: 'high' }), null);
  assert.equal(sugerirSessao({ respostas: varias(15), modelo: 'Fable 5.1', effort: null }), null);
});

test('entrada inválida: nada', () => {
  assert.equal(sugerirSessao({ respostas: 'x', modelo: 'Fable 5.1', effort: 'high' }), null);
  assert.equal(sugerirSessao({ respostas: varias(15, () => null), modelo: 'Fable 5.1', effort: 'high' }), null);
  assert.equal(sugerirSessao(undefined), null);
});

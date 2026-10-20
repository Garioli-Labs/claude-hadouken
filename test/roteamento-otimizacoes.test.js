import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otimizacoesDaSessao } from '../src/roteamento/otimizacoes.js';
import { PADRAO_ROTEAMENTO } from '../src/roteamento/config.js';

// Task 9 do plano do roteamento: O1 (leituras repetidas), O2 (saída grande)
// e O5 (compactar), puras sobre o Resposta[] da Task 7.

const AGORA = Date.parse('2026-10-19T12:00:00.000Z');
const OT = PADRAO_ROTEAMENTO.otimizacoes;
const resp = (ferramentas = [], resultados = [], extra = {}) => ({ em: AGORA - 1000, ferramentas, pensamento: 0, usage: null, resultados, ...extra });
const leitura = (linhasLidas, extra = {}) => resp(
  [{ nome: 'Read', linhasMudadas: 0, leituraInteira: true, arquivoHash: 'aaaaaaaaaaaa', reverte: false, ...extra }],
  [{ nome: 'Read', bytes: 100, linhasLidas, falhou: false, comandoHash: null }]);
const saida = (nome, bytes) => resp([], [{ nome, bytes, linhasLidas: 0, falhou: false, comandoHash: 'bbbbbbbbbbbb' }]);
const chaves = (o) => otimizacoesDaSessao({ sessaoEstado: null, faixas: undefined, otimizacoes: OT, agoraMs: AGORA, ...o }).map((s) => s.chave);

test('O1: 3 leituras inteiras de 300+ linhas do mesmo arquivo', () => {
  assert.deepEqual(chaves({ respostas: [leitura(350), leitura(300), leitura(400)] }), ['O1']);
  assert.deepEqual(chaves({ respostas: [leitura(350), leitura(350)] }), []);
  assert.deepEqual(chaves({ respostas: [leitura(100), leitura(100), leitura(100)] }), []);
  assert.deepEqual(chaves({ respostas: [leitura(350), leitura(350), leitura(350, { leituraInteira: false })] }), []);
});

test('O2: saída de comando acima de 30 KiB', () => {
  assert.deepEqual(chaves({ respostas: [saida('Bash', 30_721)] }), ['O2']);
  assert.deepEqual(chaves({ respostas: [saida('PowerShell', 30_721)] }), ['O2']);
  assert.deepEqual(chaves({ respostas: [saida('Bash', 30_720)] }), []);
  assert.deepEqual(chaves({ respostas: [saida('Read', 90_000)] }), []);
});

test('O5: contexto alto com cache fraco ou pausa longa', () => {
  const usage = (cacheLido) => ({ entrada: 0, cacheLido, cacheCriado: 100 - cacheLido });
  const cinco = (pct, em = AGORA - 1000) => Array.from({ length: 5 }, () => resp([], [], { usage: usage(pct), em }));
  assert.deepEqual(chaves({ respostas: cinco(40), sessaoEstado: { context_pct: 75 } }), ['O5']);
  assert.deepEqual(chaves({ respostas: cinco(90), sessaoEstado: { context_pct: 75 } }), []);
  assert.deepEqual(chaves({ respostas: cinco(90, AGORA - 6 * 60_000), sessaoEstado: { context_pct: 75 } }), ['O5']);
  assert.deepEqual(chaves({ respostas: cinco(40), sessaoEstado: { context_pct: 60 } }), []);
});

test('ordem pela economia (O5, O1, O2) e cada chave desligada cala a sua', () => {
  const rs = [leitura(350), leitura(350), leitura(350), saida('Bash', 50_000)];
  rs[3].usage = { entrada: 100, cacheLido: 0, cacheCriado: 0 };
  const s = otimizacoesDaSessao({ respostas: rs, sessaoEstado: { context_pct: 80 }, otimizacoes: OT, agoraMs: AGORA });
  assert.deepEqual(s, [{ chave: 'O5', economia: 4 }, { chave: 'O1', economia: 2 }, { chave: 'O2', economia: 1 }]);
  const sem = (k) => chaves({ respostas: rs, sessaoEstado: { context_pct: 80 }, otimizacoes: { ...OT, [k]: false } });
  assert.deepEqual(sem('compactar'), ['O1', 'O2']);
  assert.deepEqual(sem('leiturasRepetidas'), ['O5', 'O2']);
  assert.deepEqual(sem('saidaGrande'), ['O5', 'O1']);
});

test('entrada inválida: lista vazia, sem lançar', () => {
  assert.deepEqual(otimizacoesDaSessao(undefined), []);
  assert.deepEqual(otimizacoesDaSessao({ respostas: [null], otimizacoes: OT, agoraMs: AGORA }), []);
});

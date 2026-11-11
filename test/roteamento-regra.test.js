import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhasRegra } from '../src/roteamento/regra.js';
import { PALETA, paletaEfetiva } from '../src/agentes/paleta.js';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AGENTES = fs.readdirSync(path.join(repo, 'agents')).map((a) => `hadouken:${a.replace(/\.md$/, '')}`);
const citados = (t) => [...t.matchAll(/(?<!\/)hadouken:[a-z0-9-]+/g)].map((m) => m[0]).filter((n) => n !== 'hadouken:roteamento' && n !== 'hadouken:liberar');

// v0.6.0 (Fatia 3): o texto é gerado da paleta, uma linha por agente ativo.
// O teto de antes (6 linhas) vira o teto da paleta: abertura, uma linha por
// agente e fechamento, no máximo 1 600 caracteres (o SessionStart carrega o
// texto em toda sessão).
test('regra curta: abertura, uma linha por agente ativo e fechamento; até 1 600 caracteres; só agentes que existem', () => {
  const linhas = linhasRegra(paletaEfetiva());
  const texto = linhas.join('\n');
  assert.equal(linhas.length, PALETA.length + 2);
  assert.ok(texto.length <= 1600, String(texto.length));
  for (const n of citados(texto)) assert.ok(AGENTES.includes(n), n);
  assert.ok(texto.includes('hadouken:roteamento'));
  assert.ok(linhas[0].includes('hadouken:roteamento'));
});

test('regra curta: agente inativo sai do texto; entrada inválida só dá abertura e fechamento', () => {
  const efetiva = paletaEfetiva().map((e) => (e.nome === 'busca' ? { ...e, ativo: false } : e));
  const linhas = linhasRegra(efetiva);
  assert.equal(linhas.length, PALETA.length + 1);
  assert.ok(!linhas.join('\n').includes('hadouken:busca'));
  assert.equal(linhasRegra(null).length, 2);
  assert.equal(linhasRegra([{ nome: 'inexistente', ativo: true, model: 'x', effort: 'y' }]).length, 2);
});

test('skill: abaixo de 8 000 caracteres (~2 mil tokens) e só agentes que existem', () => {
  const t = fs.readFileSync(path.join(repo, 'skills', 'roteamento', 'SKILL.md'), 'utf8');
  assert.ok(t.length < 8000, String(t.length));
  assert.match(t, /^name: roteamento$/m);
  assert.doesNotMatch(t, /disable-model-invocation/);
  for (const n of citados(t)) assert.ok(AGENTES.includes(n), n);
  for (const s of ['Fazer direto', 'Lançar agente', 'Brief', 'Pronto quando']) assert.ok(t.includes(s), s);
});

test('fluxo do kit aponta para hadouken:roteamento', () => {
  assert.ok(fs.readFileSync(path.join(repo, 'kit', 'skills', 'fluxo', 'SKILL.md'), 'utf8').includes('hadouken:roteamento'));
});

// Tabela LITERAL (não importa PALETA): prova que o texto do SessionStart traz
// o model·effort de cada agente, sem usar a mesma função da produção como régua.
test('regra curta: cada agente aparece com model·effort literal', () => {
  const esperado = [
    ['busca', 'haiku', 'low'], ['varredor', 'haiku', 'medium'], ['pesquisa', 'sonnet', 'low'],
    ['mecanico', 'haiku', 'low'], ['implementador-mecanico', 'sonnet', 'medium'],
    ['implementador', 'sonnet', 'high'], ['revisor', 'sonnet', 'high'],
    ['auditor', 'fable', 'high'], ['e2e', 'sonnet', 'high'], ['redator', 'sonnet', 'medium'],
  ];
  const linhas = linhasRegra(paletaEfetiva());
  for (const [nome, model, effort] of esperado) {
    const inicio = `hadouken:${nome} (${model}·${effort}):`;
    assert.ok(linhas.some((l) => l.startsWith(inicio)), inicio);
  }
});

test('regra curta: linha completa do auditor', () => {
  assert.ok(linhasRegra(paletaEfetiva()).includes(
    'hadouken:auditor (fable·high): auditoria adversarial de spec ou plano com impacto em produção, migração de dados, segurança, autenticação ou dinheiro, contra código vivo.',
  ));
});

// ===================== Mutação (Tarefa 13, M1a): textos fixos e o "use para" de cada agente

test('regra curta: abertura e fechamento literais; o fechamento manda fazer direto, sem agente', () => {
  const linhas = linhasRegra(paletaEfetiva());
  assert.equal(linhas[0], 'Roteamento: antes de lançar um agente, carregue hadouken:roteamento.');
  assert.equal(linhas.at(-1), 'Cabe em poucas chamadas sobre arquivos conhecidos: faça direto, sem agente.');
  assert.deepEqual(linhasRegra(null), [linhas[0], linhas.at(-1)]);
});

test('regra curta: elemento nulo ou que não é entrada da paleta é ignorado, sem lançar', () => {
  const [abertura, fechamento] = linhasRegra(null);
  assert.deepEqual(linhasRegra([null, undefined, 5, 'x']), [abertura, fechamento]);
  const busca = paletaEfetiva()[0];
  assert.equal(linhasRegra([null, busca, undefined]).length, 3);
});

// O "use para" de cada agente é o que o Claude lê para escolher quem lançar:
// o trecho essencial de cada um (o do auditor já tem a linha inteira acima).
test('regra curta: a linha de cada agente traz o seu "use para", terminada em ponto', () => {
  const esperado = [
    ['busca', 'achar arquivo e símbolo'], ['varredor', 'número de fonte primária'], ['pesquisa', 'doc, API e versão na web, com a URL'],
    ['mecanico', 'edição com instrução exata'], ['implementador-mecanico', 'fatia mecânica provada por teste'],
    ['implementador', 'fatia com spec e plano fechados'], ['revisor', 'review de fatia contra spec, plano e convenções'],
    ['auditor', 'auditoria adversarial de spec ou plano'], ['e2e', 'e2e onde o usuário vê'], ['redator', 'texto para terceiros'],
  ];
  const linhas = linhasRegra(paletaEfetiva());
  for (const [nome, trecho] of esperado) {
    const linha = linhas.find((l) => l.startsWith(`hadouken:${nome} (`));
    assert.ok(linha, nome);
    const uso = linha.slice(linha.indexOf('): ') + 3);
    assert.ok(uso.includes(trecho), `${nome}: ${linha}`);
    assert.ok(uso.endsWith('.') && uso.length > trecho.length, `${nome}: ${linha}`);
  }
});

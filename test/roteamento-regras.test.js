import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarRoteamento, pareceBusca } from '../src/roteamento/regras.js';
import { PADRAO_ROTEAMENTO } from '../src/roteamento/config.js';

const M = 60_000;
const ag = 1_800_000_000_000;
const perfil = (agente, familia, effort, origem = 'parametro', doArquivo = null) => ({ agente, familia, effort, origem, doArquivo });
const av = (o) => avaliarRoteamento({ descricao: '', prompt: 'x'.repeat(1000), recentes: [], config: PADRAO_ROTEAMENTO, liberado: false, agoraMs: ag, ...o });

test('N1: busca com Opus/Fable ou effort xhigh/max é negada', () => {
  assert.deepEqual(av({ perfil: perfil('Explore', 'fable', null) }), { decisao: 'negar', regra: 'N1' });
  assert.deepEqual(av({ perfil: perfil('Explore', 'desconhecido', 'xhigh') }), { decisao: 'negar', regra: 'N1' });
  assert.deepEqual(av({ perfil: perfil('hadouken:busca', 'haiku', 'max') }), { decisao: 'negar', regra: 'N1' });
  assert.deepEqual(av({ perfil: perfil('Explore', 'sonnet', 'high') }).decisao, 'passar');
  // Revisão do branch, achado 6: o effort só da sessão não nega.
  assert.notEqual(av({ perfil: { ...perfil('Explore', 'haiku', 'xhigh'), effortDaSessao: true } }).regra, 'N1');
});

test('N2: busca/mecanico com modelo forte no parâmetro', () => {
  assert.deepEqual(av({ perfil: perfil('hadouken:mecanico', 'opus', 'low') }), { decisao: 'negar', regra: 'N2' });
  assert.equal(av({ perfil: perfil('hadouken:mecanico', 'opus', 'low', 'frontmatter') }).regra, null);
});

test('liberação e config desligam N1/N2; avisos seguem', () => {
  // Sem o N1, o Fable fora do revisor-crítico ainda cai no A1: os avisos seguem.
  assert.deepEqual(av({ perfil: perfil('Explore', 'fable', null), liberado: true }), { decisao: 'avisar', regra: 'A1' });
  assert.deepEqual(av({ perfil: perfil('Explore', 'fable', null), config: { ...PADRAO_ROTEAMENTO, negarN1: false } }), { decisao: 'avisar', regra: 'A1' });
  assert.equal(av({ perfil: perfil('Explore', 'opus', 'xhigh'), liberado: true }).decisao, 'passar');
});

test('A1: Fable fora do revisor-crítico avisa; agente do usuário que declara Fable passa', () => {
  assert.deepEqual(av({ perfil: perfil('general-purpose', 'fable', 'high', 'sessao') }), { decisao: 'avisar', regra: 'A1' });
  assert.equal(av({ perfil: perfil('fable-xhigh', 'fable', 'xhigh', 'frontmatter', { model: 'fable', effort: 'xhigh' }) }).decisao, 'passar');
  assert.equal(av({ perfil: perfil('hadouken:revisor-critico', 'fable', 'xhigh', 'frontmatter', { model: 'fable', effort: 'xhigh' }) }).decisao, 'passar');
});

test('A2: Opus/Fable com descrição de busca avisa; revisor listando riscos não nega (só A2)', () => {
  assert.deepEqual(av({ perfil: perfil('general-purpose', 'opus', 'high', 'sessao'), descricao: 'Encontrar onde X é definido' }), { decisao: 'avisar', regra: 'A2' });
  const r = av({ perfil: perfil('hadouken:revisor', 'opus', 'high', 'frontmatter', { model: 'opus', effort: 'high' }), descricao: 'Listar os riscos da arquitetura' });
  assert.notEqual(r.decisao, 'negar');
  assert.equal(pareceBusca('  find usages of foo'), true);
  assert.equal(pareceBusca('Revisar o diff'), false);
});

test('A3: o sexto despacho curto em 10 min avisa', () => {
  const recentes = [1, 2, 3, 4, 5].map((i) => ({ em: ag - i * M, tamPrompt: 100 }));
  assert.deepEqual(av({ perfil: perfil('hadouken:executor', 'sonnet', 'medium', 'frontmatter'), prompt: 'curto', recentes }), { decisao: 'avisar', regra: 'A3' });
  assert.equal(av({ perfil: perfil('hadouken:executor', 'sonnet', 'medium', 'frontmatter'), prompt: 'curto', recentes: recentes.slice(1) }).decisao, 'passar');
});

test('config.avisos=false cala A1–A3; perfil vazio passa', () => {
  assert.equal(av({ perfil: perfil('general-purpose', 'fable', 'high', 'sessao'), config: { ...PADRAO_ROTEAMENTO, avisos: false } }).decisao, 'passar');
  assert.equal(av({ perfil: null }).decisao, 'passar');
});

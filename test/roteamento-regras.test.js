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
  // Sem o N1, o Fable fora do auditor ainda cai no A1: os avisos seguem.
  assert.deepEqual(av({ perfil: perfil('Explore', 'fable', null), liberado: true }), { decisao: 'avisar', regra: 'A1' });
  assert.deepEqual(av({ perfil: perfil('Explore', 'fable', null), config: { ...PADRAO_ROTEAMENTO, negarN1: false } }), { decisao: 'avisar', regra: 'A1' });
  assert.equal(av({ perfil: perfil('Explore', 'opus', 'xhigh'), liberado: true }).decisao, 'passar');
});

test('A1: Fable fora do auditor avisa; agente do usuário que declara Fable passa', () => {
  assert.deepEqual(av({ perfil: perfil('general-purpose', 'fable', 'high', 'sessao') }), { decisao: 'avisar', regra: 'A1' });
  assert.equal(av({ perfil: perfil('fable-xhigh', 'fable', 'xhigh', 'frontmatter', { model: 'fable', effort: 'xhigh' }) }).decisao, 'passar');
  assert.equal(av({ perfil: perfil('hadouken:auditor', 'fable', 'high', 'frontmatter', { model: 'fable', effort: 'high' }) }).decisao, 'passar');
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
  assert.deepEqual(av({ perfil: perfil('hadouken:implementador', 'sonnet', 'high', 'frontmatter'), prompt: 'curto', recentes }), { decisao: 'avisar', regra: 'A3' });
  assert.equal(av({ perfil: perfil('hadouken:implementador', 'sonnet', 'high', 'frontmatter'), prompt: 'curto', recentes: recentes.slice(1) }).decisao, 'passar');
});

test('config.avisos=false cala A1–A3; perfil vazio passa', () => {
  assert.equal(av({ perfil: perfil('general-purpose', 'fable', 'high', 'sessao'), config: { ...PADRAO_ROTEAMENTO, avisos: false } }).decisao, 'passar');
  assert.equal(av({ perfil: null }).decisao, 'passar');
});

// ===================== Mutação (Tarefa 13, M1a): N2, `aprovado` e A1 por effort max

const SEM_N1 = { ...PADRAO_ROTEAMENTO, negarN1: false };
const N1 = { decisao: 'negar', regra: 'N1' };

test('N2: busca, varredor e mecanico com modelo forte no parâmetro são negados; liberação e negarN2:false soltam', () => {
  for (const a of ['hadouken:busca', 'hadouken:varredor', 'hadouken:mecanico']) {
    assert.deepEqual(av({ perfil: perfil(a, 'opus', 'low'), config: SEM_N1 }), { decisao: 'negar', regra: 'N2' }, a);
    assert.deepEqual(av({ perfil: perfil(a, 'fable', 'low'), config: SEM_N1 }), { decisao: 'negar', regra: 'N2' }, a);
    assert.equal(av({ perfil: perfil(a, 'opus', 'low'), config: SEM_N1, liberado: true }).decisao, 'passar', `${a} liberado`);
    assert.equal(av({ perfil: perfil(a, 'opus', 'low'), config: { ...SEM_N1, negarN2: false } }).decisao, 'passar', `${a} negarN2:false`);
  }
  // Os outros agentes do plugin não entram na N2.
  assert.equal(av({ perfil: perfil('hadouken:implementador', 'opus', 'low'), config: SEM_N1 }).decisao, 'passar');
});

test('N1: config.subir ausente, nulo, sem o agente ou só herdado não aprova a família; a chave própria aprova', () => {
  const nega = (subir) => av({ perfil: perfil('Explore', 'fable', null), config: { ...PADRAO_ROTEAMENTO, subir } });
  for (const subir of [undefined, null, 'x', 5, [], {}, { 'hadouken:busca': 'fable' }, { Explore: 'opus' }, Object.create({ Explore: 'fable' })]) {
    assert.deepEqual(nega(subir), N1, String(subir));
  }
  assert.deepEqual(nega({ Explore: 'fable' }), { decisao: 'avisar', regra: 'A1' });
});

test('N1: agentes só aprova hadouken:<nome>; ausente, nulo, sem o agente ou de outro agente não aprova; o próprio aprova model e effort', () => {
  const busca = (agentes, familia = 'opus', effort = 'low') => av({ perfil: perfil('hadouken:busca', familia, effort), agentes });
  for (const agentes of [undefined, null, {}, { busca: null }, { busca: 'x' }, { varredor: { model: 'opus' } }, { busca: { model: 'sonnet' } }, Object.create({ busca: { model: 'opus' } })]) {
    assert.deepEqual(busca(agentes), N1, JSON.stringify(agentes) ?? String(agentes));
  }
  assert.equal(busca({ busca: { model: 'opus' } }).decisao, 'passar');
  assert.deepEqual(busca({ busca: { effort: 'max' } }, 'haiku', 'max'), { decisao: 'avisar', regra: 'A1' });
  assert.deepEqual(busca({ busca: { effort: 'high' } }, 'haiku', 'max'), N1);
  // Agente que não é do plugin não procura chave em agentes (nem a de nome "null").
  const explore = (agentes) => av({ perfil: perfil('Explore', 'opus', 'low'), agentes });
  assert.deepEqual(explore({ null: { model: 'opus' }, Explore: { model: 'opus' }, '': { model: 'opus' } }), N1);
  assert.deepEqual(explore(null), N1);
  assert.deepEqual(explore(undefined), N1);
});

test('A1: effort max avisa fora dos agentes de revisão, mesmo em família barata; xhigh e a revisão não', () => {
  assert.deepEqual(av({ perfil: perfil('general-purpose', 'sonnet', 'max', 'sessao') }), { decisao: 'avisar', regra: 'A1' });
  assert.deepEqual(av({ perfil: perfil('hadouken:implementador', 'haiku', 'max', 'parametro', { model: 'sonnet', effort: 'high' }) }), { decisao: 'avisar', regra: 'A1' });
  assert.equal(av({ perfil: perfil('hadouken:revisor', 'sonnet', 'max', 'parametro', { model: 'sonnet', effort: 'high' }) }).decisao, 'passar');
  assert.equal(av({ perfil: perfil('general-purpose', 'sonnet', 'xhigh', 'sessao') }).decisao, 'passar');
});

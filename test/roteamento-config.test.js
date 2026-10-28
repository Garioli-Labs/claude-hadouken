import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PADRAO_ROTEAMENTO, lerConfigRoteamento } from '../src/roteamento/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-rot-cfg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const com = (valor) => {
  const d = fs.mkdtempSync(path.join(tmp, 'd'));
  if (valor !== undefined) fs.writeFileSync(path.join(d, 'config.json'), typeof valor === 'string' ? valor : JSON.stringify(valor));
  return d;
};

test('sem arquivo ou sem chave: padrões, todos true, sem aviso', () => {
  for (const d of [com(), com({ repos: [] }), null]) {
    const r = lerConfigRoteamento(d);
    assert.deepEqual(r.config, PADRAO_ROTEAMENTO);
    assert.deepEqual(r.avisos, []);
  }
  assert.equal(Object.values(PADRAO_ROTEAMENTO.otimizacoes).every((v) => v === true), true);
});

test('chaves booleanas valem; inválidas usam o padrão com aviso fixo', () => {
  const r = lerConfigRoteamento(com({ roteamento: { negarN1: false, avisos: 'nao', otimizacoes: { compactar: false, mcpOciosos: 1 } } }));
  assert.equal(r.config.negarN1, false);
  assert.equal(r.config.avisos, true);
  assert.equal(r.config.otimizacoes.compactar, false);
  assert.equal(r.config.otimizacoes.mcpOciosos, true);
  assert.deepEqual(r.avisos, ['config.json: roteamento.avisos inválido, usando true', 'config.json: roteamento.otimizacoes.mcpOciosos inválido, usando true']);
});

test('JSON quebrado ou roteamento não-objeto: padrões com um aviso; __proto__ ignorado', () => {
  assert.deepEqual(lerConfigRoteamento(com('{')).config, PADRAO_ROTEAMENTO);
  assert.equal(lerConfigRoteamento(com({ roteamento: [] })).avisos.length, 1);
  const r = lerConfigRoteamento(com('{"roteamento":{"__proto__":{"negarN1":false}}}'));
  assert.equal(r.config.negarN1, true);
});

test('revisão do branch, achado 13: roteamento.subir é lido e a N2 respeita a subida', async () => {
  const { avaliarRoteamento } = await import('../src/roteamento/regras.js');
  const r = lerConfigRoteamento(com({ roteamento: { subir: { 'hadouken:mecanico': 'opus', 'x y': 'opus', 'hadouken:busca': 'gpt' } } }));
  assert.deepEqual(r.config.subir, { 'hadouken:mecanico': 'opus' });
  const perfil = (familia) => ({ agente: 'hadouken:mecanico', familia, effort: 'low', origem: 'parametro', doArquivo: null });
  const av = (familia) => avaliarRoteamento({ perfil: perfil(familia), descricao: '', prompt: 'x'.repeat(1000), recentes: [], config: r.config, liberado: false, agoraMs: 0 });
  assert.notEqual(av('opus').regra, 'N2');
  assert.equal(av('fable').regra, 'N2');
});

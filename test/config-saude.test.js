import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ITEM } from '../src/config/tabela.js';
import { lerConfiguracao, configSaude } from '../src/config/ler.js';
import { GRUPOS_LIMITES, lerPedidoLimites } from '../src/config/pedido.js';
import { gravarConfiguracao } from '../src/config/gravar.js';

// Spec v0.5.5 §7: os itens saude.* na tabela de limites.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-cfg-saude-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const com = (v) => {
  const d = fs.mkdtempSync(path.join(tmp, 'd'));
  if (v !== undefined) fs.writeFileSync(path.join(d, 'config.json'), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
};

const INTEIROS = {
  'saude.ram.amarelo': [85, 50, 98, 'maior'],
  'saude.ram.vermelho': [93, 55, 99, 'maior'],
  'saude.gpu.max': [85, 60, 105, 'maior'],
  'saude.cpu.max': [90, 60, 105, 'maior'],
  'saude.bateria.min': [15, 5, 50, 'menor'],
  'saude.disco.minGB': [5, 1, 100, 'menor'],
  'saude.tetoHooks.ms': [40, 10, 500, 'maior'],
  'saude.limpeza.mb': [50, 10, 1000, 'maior'],
};
const BOOLEANOS = ['saude.ligado', 'saude.liberarProprios', 'saude.tetoHooks', 'saude.compat', 'saude.conflitos', 'saude.limpeza', 'saude.economia'];

test('itens saude.* existem com padrão, faixa e grupo', () => {
  for (const [id, [padrao, min, max, frouxo]] of Object.entries(INTEIROS)) {
    const i = ITEM[id];
    assert.ok(i, id);
    assert.deepEqual([i.tipo, i.grupo, i.padrao, i.min, i.max, i.frouxo], ['inteiro', 'saude', padrao, min, max, frouxo], id);
  }
  for (const id of BOOLEANOS) {
    const i = ITEM[id];
    assert.ok(i, id);
    assert.deepEqual([i.tipo, i.grupo, i.padrao, i.frouxo], ['booleano', 'saude', true, 'desligar'], id);
  }
  assert.ok(GRUPOS_LIMITES.includes('saude'));
});

test('par RAM incoerente volta ao padrão', () => {
  const l = lerConfiguracao(com({ saude: { ram: { amarelo: 95, vermelho: 90 } } }));
  const v = (id) => l.itens.find((i) => i.id === id).valor;
  assert.equal(v('saude.ram.amarelo'), 85);
  assert.equal(v('saude.ram.vermelho'), 93);
});

test('/hadouken:limites aceita saude.ram.vermelho 90', () => {
  assert.equal(lerPedidoLimites('saude.ram.vermelho 90').acao, 'gravar');
});

test('gravar saude.tetoHooks.ms e saude.tetoHooks lado a lado', () => {
  const d = com();
  const r = gravarConfiguracao(d, { 'saude.tetoHooks.ms': 60, 'saude.tetoHooks': false }, { versao: 'ausente', agoraMs: Date.now() });
  assert.equal(r.ok, true);
  assert.deepEqual(configSaude(d).tetoHooks, { ligado: false, ms: 60 });
});

test('configSaude: padrões, configurados e config ilegível', () => {
  const padrao = {
    ligado: true, ram: { amarelo: 85, vermelho: 93 }, gpuMax: 85, cpuMax: 90, bateriaMin: 15, discoMinGB: 5,
    liberarProprios: true, tetoHooks: { ligado: true, ms: 40 }, compat: true, conflitos: true,
    limpeza: { ligada: true, mb: 50 }, economia: true,
  };
  assert.deepEqual(configSaude(com()), padrao);
  assert.deepEqual(configSaude(com('{')), padrao);
  const c = configSaude(com({ saude: { ligado: false, gpu: { max: 80 }, tetoHooks: { ms: 60 } } }));
  assert.equal(c.ligado, false);
  assert.equal(c.gpuMax, 80);
  assert.deepEqual(c.tetoHooks, { ligado: true, ms: 60 });
});

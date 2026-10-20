import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ITENS } from '../src/config/tabela.js';
import { lerConfiguracao, validar, faixasBarra, limiaresAlertas } from '../src/config/ler.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-cfg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const com = (v) => {
  const d = fs.mkdtempSync(path.join(tmp, 'd'));
  if (v !== undefined) fs.writeFileSync(path.join(d, 'config.json'), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
};
const item = (l, id) => l.itens.find((i) => i.id === id);

test('tabela: ids únicos, padrões da guarda iguais aos de hoje', () => {
  assert.equal(new Set(ITENS.map((i) => i.id)).size, ITENS.length);
  assert.equal(ITENS.find((i) => i.id === 'guarda.teto7d').padrao, PADRAO_GUARDA.teto7d);
  for (const i of ITENS.filter((x) => x.tipo === 'inteiro')) assert.ok(i.min <= i.padrao && i.padrao <= i.max, i.id);
});

test('sem arquivo: padrões, versao ausente; com arquivo: valor e versao estável', () => {
  const l = lerConfiguracao(com());
  assert.equal(l.versao, 'ausente');
  assert.equal(item(l, 'barra.ctx.amarelo').valor, 70);
  const d = com({ barra: { ctx: { amarelo: 60 } } });
  assert.equal(item(lerConfiguracao(d), 'barra.ctx.amarelo').valor, 60);
  assert.match(lerConfiguracao(d).versao, /^[0-9a-f]{16}$/);
  assert.equal(lerConfiguracao(d).versao, lerConfiguracao(d).versao);
});

test('validar: faixa, coerência, id desconhecido e __proto__', () => {
  const l = lerConfiguracao(com());
  assert.equal(validar({ 'barra.ctx.amarelo': 200 }, l).ok, false);
  assert.equal(validar({ 'barra.ctx.amarelo': 1.5 }, l).ok, false);
  assert.equal(validar({ 'barra.ctx.amarelo': 90, 'barra.ctx.vermelho': 80 }, l).ok, false);
  assert.equal(validar({ 'alertas.projecao5hMin.1': 90 }, l).ok, false);
  assert.equal(validar({ 'guarda.liberacao.padraoH': 10, 'guarda.liberacao.maxH': 5 }, l).ok, false);
  assert.equal(validar({ 'nao.existe': 1 }, l).ok, false);
  assert.equal(validar(JSON.parse('{"__proto__":{"x":1}}'), l).ok, true);
  assert.deepEqual(validar({ 'barra.ctx.amarelo': 60 }, l), { ok: true, erros: [], afrouxa: [] });
});

test('afrouxa: guarda mais frouxa que o efetivo; texto do erro sem o valor digitado', () => {
  const l = lerConfiguracao(com());
  assert.deepEqual(validar({ 'guarda.teto7d': 95, 'guarda.horizonte7dH': 12 }, l).afrouxa.sort(), ['guarda.horizonte7dH', 'guarda.teto7d']);
  assert.deepEqual(validar({ 'guarda.ligada': false }, l).afrouxa, ['guarda.ligada']);
  const e = validar({ 'guarda.teto7d': 9999 }, l).erros[0].texto;
  assert.ok(!e.includes('9999'));
  assert.match(e, /50–100/);
});

test('faixasBarra e limiaresAlertas: configurados, e padrões com config inválida', () => {
  const d = com({ barra: { ctx: { amarelo: 60, vermelho: 50 } }, alertas: { projecao7dH: 12 } });
  assert.deepEqual(faixasBarra(d).ctx, { amarelo: 70, vermelho: 85 });
  assert.equal(limiaresAlertas(d).seven_day[0][1], 12 * 3_600_000);
  assert.deepEqual(faixasBarra(com('{')), { ctx: { amarelo: 70, vermelho: 85 }, cache: { amarelo: 50, verde: 80 } });
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerAperto, aplicarAperto } from '../src/guarda/aperto.js';
import { lerConfigGuarda, lerConfigGuardaBase, PADRAO_GUARDA } from '../src/guarda/config.js';
import { avaliarGuarda } from '../src/guarda/avaliar.js';

// A guarda lê min(config.json, aperto aprendido) (spec aprendizado §4.4 e
// §8 "Guarda"). ajustes.json ausente, inválido ou link, ou aprendizado
// desligado: config.json puro. Pastas temporárias; nada toca ~/.claude.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aperto ç '));
  dirs.push(d);
  return d;
}
const agora = Date.UTC(2026, 9, 20, 18, 0);
const agoraS = agora / 1000;
const iso = (ms) => new Date(ms).toISOString();
function ligar(d) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(d, 'otel', 'ligado.json'), JSON.stringify({ v: 1, chaves: {}, criouEnv: false, em: iso(agora) }));
}
function gravarAjustes(d, vigentes) {
  fs.writeFileSync(path.join(d, 'ajustes.json'), JSON.stringify({ v: 1, seq: 0, vigentes, registros: [], bloqueios: {}, perfil: {} }));
}
function gravarEstado(d, u7) {
  const at = iso(agora);
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 10, resets_at: agoraS + 3 * 3600, at },
    seven_day: { used_percentage: u7, resets_at: agoraS + 4 * 86_400, at },
    sessoes: {}, historico: [],
  }));
}

test('sem aperto: ajustes.json ausente, desligado, inválido, fora da faixa ou link', (t) => {
  const d = novo();
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  gravarAjustes(d, { 'guarda.teto7d': 75 });
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null }, 'sem ligado.json o aprendizado está desligado');
  ligar(d);
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: 75 });
  fs.writeFileSync(path.join(d, 'ajustes.json'), '{"v":1,');
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  gravarAjustes(d, { 'guarda.teto7d': 40, 'guarda.fableTetoPct': 75.5 });
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  fs.writeFileSync(path.join(d, 'ajustes.json'), JSON.stringify({ v: 1, vigentes: { 'guarda.teto7d': 75 }, pad: 'x'.repeat(70 * 1024) }));
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null }, 'acima de 64 KiB');
  const alvo = path.join(d, 'alvo.json');
  fs.rmSync(path.join(d, 'ajustes.json'));
  fs.writeFileSync(alvo, JSON.stringify({ v: 1, vigentes: { 'guarda.teto7d': 75 } }));
  try {
    fs.symlinkSync(alvo, path.join(d, 'ajustes.json'));
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link'); return; }
    throw e;
  }
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
});

test('aplicarAperto: só o mínimo, nunca acima do config.json', () => {
  const base = { ...PADRAO_GUARDA, teto7d: 80, fableTetoPct: 90 };
  assert.deepEqual(aplicarAperto(base, { teto7d: 75, fableTetoPct: null }), { ...base, teto7d: 75 });
  assert.deepEqual(aplicarAperto(base, { teto7d: 95, fableTetoPct: 100 }), base);
  assert.deepEqual(aplicarAperto(base, null), base);
  assert.notEqual(aplicarAperto(base, { teto7d: 75, fableTetoPct: null }), base);
});

// Rodada 1 da revisão: aplicarAperto confere sozinho o piso 70 (o de
// valorDoItem), sem depender de quem o chama.
test('aplicarAperto: abaixo do piso 70 ou não finito é ignorado, mesmo chamado direto', () => {
  const base = { ...PADRAO_GUARDA, teto7d: 80, fableTetoPct: 90 };
  assert.deepEqual(aplicarAperto(base, { teto7d: 50, fableTetoPct: 50 }), base);
  assert.deepEqual(aplicarAperto(base, { teto7d: 69, fableTetoPct: 0 }), base);
  assert.deepEqual(aplicarAperto(base, { teto7d: -Infinity, fableTetoPct: Number.NaN }), base);
  assert.deepEqual(aplicarAperto(base, { teto7d: '75', fableTetoPct: [75] }), base);
  assert.deepEqual(aplicarAperto(base, { teto7d: 70, fableTetoPct: 89 }), { ...base, teto7d: 70, fableTetoPct: 89 });
});

test('aplicarAperto: config[campo] não numérico fica como está', () => {
  for (const ruim of ['80', '', null, undefined, Number.NaN, true, [80], { v: 80 }]) {
    const base = { ...PADRAO_GUARDA, teto7d: ruim, fableTetoPct: ruim };
    assert.deepEqual(aplicarAperto(base, { teto7d: 75, fableTetoPct: 75 }), base, String(ruim));
  }
});

test('ligado.json forjado (lista, __proto__, quebrado, vazio, pasta, grande): nunca afrouxa nem lança', () => {
  const conteudos = ['[1,2,3]', '{"__proto__":{"v":1,"ligado":false}}', '{"v":', '', 'null', '"x"'];
  for (const texto of conteudos) {
    const d = novo();
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { teto7d: 80, fable: { tetoPct: 90 } } }));
    fs.mkdirSync(path.join(d, 'otel'));
    fs.writeFileSync(path.join(d, 'otel', 'ligado.json'), texto);
    const base = lerConfigGuardaBase(d).config;
    assert.deepEqual(lerConfigGuarda(d).config, base, `${texto}, sem ajustes.json`);
    gravarAjustes(d, { 'guarda.teto7d': 95, 'guarda.fableTetoPct': 100 });
    assert.deepEqual(lerConfigGuarda(d).config, base, `${texto}, ajustes acima do config`);
    gravarAjustes(d, { 'guarda.teto7d': 75 });
    const c = lerConfigGuarda(d).config;
    assert.equal(c.teto7d, 75, texto);
    assert.deepEqual(c, { ...base, teto7d: 75 }, texto);
  }
  for (const forma of ['pasta', 'grande']) {
    const d = novo();
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { teto7d: 80 } }));
    fs.mkdirSync(path.join(d, 'otel'));
    if (forma === 'pasta') fs.mkdirSync(path.join(d, 'otel', 'ligado.json'));
    else fs.writeFileSync(path.join(d, 'otel', 'ligado.json'), `[${'1,'.repeat(3000)}1]`);
    gravarAjustes(d, { 'guarda.teto7d': 75 });
    assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null }, `ligado.json ${forma}: desligado`);
    assert.deepEqual(lerConfigGuarda(d), lerConfigGuardaBase(d), forma);
  }
});

test('lerConfigGuarda devolve o mínimo; lerConfigGuardaBase, o config.json puro', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { teto7d: 80 } }));
  ligar(d);
  gravarAjustes(d, { 'guarda.teto7d': 75, 'guarda.fableTetoPct': 85 });
  assert.equal(lerConfigGuarda(d).config.teto7d, 75);
  assert.equal(lerConfigGuarda(d).config.fableTetoPct, 85);
  assert.equal(lerConfigGuardaBase(d).config.teto7d, 80);
  gravarAjustes(d, { 'guarda.teto7d': 95 });
  assert.equal(lerConfigGuarda(d).config.teto7d, 80);
});

test('ajustes.json forjado não afrouxa, não desliga e não mexe em outro campo; config.json mais apertado vence', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { teto7d: 60, fable: { tetoPct: 72 }, teto5h: 80 } }));
  ligar(d);
  fs.writeFileSync(path.join(d, 'ajustes.json'), '{"v":1,"vigentes":{"guarda.teto7d":70,"guarda.fableTetoPct":100,'
    + '"guarda.ligada":false,"guarda.teto5h":100,"ligada":false,"teto7d":50,"__proto__":{"teto7d":50}},"ligada":false}');
  const { config } = lerConfigGuarda(d);
  assert.deepEqual(config, { ...lerConfigGuardaBase(d).config });
  assert.equal(config.ligada, true);
  assert.equal(config.teto7d, 60, 'o piso 70 do aperto nunca sobe o config.json');
  assert.equal(config.fableTetoPct, 72);
  assert.equal(config.teto5h, 80);
  assert.deepEqual(lerAperto(d), { fableTetoPct: 100, teto7d: 70 });
  gravarAjustes(d, { 'guarda.teto7d': '65', 'guarda.fableTetoPct': [71] });
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  gravarAjustes(d, ['guarda.teto7d', 71]);
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  fs.writeFileSync(path.join(d, 'ajustes.json'), JSON.stringify({ v: 2, vigentes: { 'guarda.teto7d': 71 } }));
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  assert.deepEqual(lerAperto(null), { fableTetoPct: null, teto7d: null });
  assert.deepEqual(lerConfigGuarda(null).config, PADRAO_GUARDA);
});

test('avaliarGuarda: 7d em 80% dispara G4 com aperto 75 e não dispara sem ele', () => {
  const d = novo();
  gravarEstado(d, 80);
  assert.equal(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).status, 'armada');
  const e = novo();
  gravarEstado(e, 80);
  ligar(e);
  gravarAjustes(e, { 'guarda.teto7d': 75 });
  const g = avaliarGuarda({ dir: e, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'disparada');
  assert.equal(g.motivos[0].gatilho, 'G4');
});

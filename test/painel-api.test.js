import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_DESLIGADO_USUARIO, desligar } from '../src/aprendizado/ligar.js';

// A API do painel (spec v0.5.3 VS Code §2.2): o que o shim painel.mjs expõe
// à extensão, já com a pasta de dados aplicada. HADOUKEN_HOME temporário.

const homeOriginal = process.env.HADOUKEN_HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk painel-api ç '));
process.env.HADOUKEN_HOME = home;
after(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(home, { recursive: true, force: true });
});

const NOMES = [
  'estadoPainel', 'talvezAtualizar', 'lerConfiguracao', 'validar', 'gravarConfiguracao', 'voltarAoPadrao', 'desfazer',
  'talvezConsultarVersao', 'estadoVersao', 'comandoAtualizar', 'ultimoEvento', 'ligarAprendizado', 'desligarAprendizado',
  'resumoRoteamento7d', 'estadoSaude', 'barraSaude', 'mudarModo',
];

test('painel-api exporta os nomes da spec §2.2, todos funções', async () => {
  const m = await import('../src/uso/painel-api.js');
  for (const n of NOMES) assert.equal(typeof m[n], 'function', n);
});

test('sem argumento, lê e grava na pasta do HADOUKEN_HOME', async () => {
  const m = await import('../src/uso/painel-api.js');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ barra: { ctx: { amarelo: 60 } } }));
  const lido = await m.lerConfiguracao();
  assert.equal(lido.itens.find((i) => i.id === 'barra.ctx.amarelo').valor, 60);
  assert.equal((await m.validar({ 'barra.ctx.amarelo': 5 })).ok, false);
  const g = await m.gravarConfiguracao({ 'barra.ctx.amarelo': 65 }, { versao: lido.versao });
  assert.equal(g.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), { barra: { ctx: { amarelo: 65 } } });
  assert.equal((await m.desfazer(g.desfazer)).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), { barra: { ctx: { amarelo: 60 } } });
  const v = (await m.lerConfiguracao()).versao;
  assert.equal((await m.voltarAoPadrao(['barra.ctx.amarelo'], { versao: v })).ok, true);
  assert.equal(await m.ultimoEvento(), null);
  assert.equal((await m.comandoAtualizar('win32')).shell, 'powershell');
  assert.equal((await m.estadoVersao()).nova, null);
  assert.notEqual(await m.resumoRoteamento7d(), undefined);
});

test('revisão do branch, achado 4: o interruptor do aprendizado mostra o ligado.json', async () => {
  const m = await import('../src/uso/painel-api.js');
  const valor = async () => (await m.lerConfiguracao()).itens.find((i) => i.id === 'aprendizado.ligado').valor;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aprendizado: { ligado: true } }));
  assert.equal(await valor(), false);
  fs.mkdirSync(path.join(home, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'otel', 'ligado.json'), '{}');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aprendizado: { ligado: false } }));
  assert.equal(await valor(), true);
  fs.rmSync(path.join(home, 'otel'), { recursive: true, force: true });
});

test('desligar grava o marcador de desligado pelo usuário', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk desligar ç '));
  try {
    const d = desligar({ dir, arquivo: path.join(dir, 'settings.json'), agoraMs: Date.UTC(2026, 9, 20), apagar: 'tudo', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
    assert.equal(d.ok, true);
    assert.equal(ARQ_DESLIGADO_USUARIO, 'aprendizado-desligado-pelo-usuario');
    assert.ok(fs.existsSync(path.join(dir, ARQ_DESLIGADO_USUARIO)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 13 (v0.5.5): mudarModo liga e desliga o leve; estadoSaude mostra; argumento estranho não grava', async () => {
  const m = await import('../src/uso/painel-api.js');
  fs.rmSync(path.join(home, 'config.json'), { force: true });
  assert.deepEqual(await m.mudarModo(true), { ok: true });
  const s = await m.estadoSaude();
  assert.equal(s.leve, true);
  assert.equal(s.acaoLeve, 'desligar');
  assert.equal(typeof s.resumo, 'string');
  assert.equal(await m.barraSaude(), 'leve');
  assert.deepEqual(await m.mudarModo(false), { ok: true });
  assert.equal(await m.barraSaude(), null);
  assert.equal((await m.estadoSaude()).leve, false);
  assert.deepEqual(await m.mudarModo('sim'), { ok: false, motivo: 'invalido' });
  assert.equal((await m.estadoSaude()).leve, false);
});

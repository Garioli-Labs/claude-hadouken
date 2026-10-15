import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COPIAS_ANTIGAS, FONTE, ligarAtualizacao, marketplaceConhecido } from '../src/instalar/atualizacao-auto.js';

// v0.5.2, atualização automática (spec, peça 2): extraKnownMarketplaces com
// autoUpdate e as cópias antigas dos terceiros desligadas, pelo gravador
// seguro da barra. Settings sempre em pasta temporária.

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk auto ç '));
  pastas.push(d);
  return d;
};
const AGORA = Date.parse('2026-10-15T12:00:00Z');
const lerArq = (a) => JSON.parse(fs.readFileSync(a, 'utf8'));
const backups = (a) => fs.readdirSync(path.dirname(a)).filter((n) => n.startsWith(`${path.basename(a)}.bak-hadouken-`)).sort();
const NOSSA = { source: 'github', repo: 'Garioli-Labs/claude-hadouken' };

test('constantes: a fonte do marketplace e as quatro cópias antigas', () => {
  assert.deepEqual(FONTE, NOSSA);
  assert.deepEqual(COPIAS_ANTIGAS, ['mattpocock-skills@mattpocock', 'poka-yoke@poka-yoke', 'fullstack-dev-skills@fullstack-dev-skills', 'ui-ux-pro-max@ui-ux-pro-max-skill']);
});

test('settings ausente: cria com a entrada do marketplace e autoUpdate', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  assert.deepEqual(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA }), { ok: true, acao: 'gravado', desligadas: [], backup: null });
  assert.deepEqual(lerArq(arq), { extraKnownMarketplaces: { 'claude-hadouken': { source: NOSSA, autoUpdate: true } } });
});

test('preserva as outras chaves do arquivo e da entrada, com backup dos bytes de antes', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  const antes = {
    theme: 'dark',
    extraKnownMarketplaces: { outro: { source: { source: 'github', repo: 'a/b' } }, 'claude-hadouken': { source: NOSSA, extra: 1 } },
  };
  fs.writeFileSync(arq, JSON.stringify(antes, null, 2));
  const bytes = fs.readFileSync(arq);
  const r = ligarAtualizacao({ arquivo: arq, agoraMs: AGORA });
  assert.equal(r.acao, 'gravado');
  assert.deepEqual(lerArq(arq), {
    theme: 'dark',
    extraKnownMarketplaces: { outro: antes.extraKnownMarketplaces.outro, 'claude-hadouken': { source: NOSSA, extra: 1, autoUpdate: true } },
  });
  assert.deepEqual(fs.readFileSync(r.backup), bytes);
});

test('segunda rodada: não regrava nem cria backup', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  fs.writeFileSync(arq, '{ "theme": "dark" }\n');
  assert.equal(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA }).acao, 'gravado');
  const bytes = fs.readFileSync(arq);
  const bk = backups(arq);
  assert.deepEqual(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA + 1000 }), { ok: true, acao: 'ja-estava', desligadas: [], backup: null });
  assert.deepEqual(fs.readFileSync(arq), bytes);
  assert.deepEqual(backups(arq), bk);
});

test('cópias antigas: true vira false; ausente não entra; false fica; outros plugins intactos', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  fs.writeFileSync(arq, JSON.stringify({
    extraKnownMarketplaces: { 'claude-hadouken': { source: NOSSA, autoUpdate: true } },
    enabledPlugins: { 'mattpocock-skills@mattpocock': true, 'poka-yoke@poka-yoke': false, 'outro@x': true },
  }));
  const r = ligarAtualizacao({ arquivo: arq, agoraMs: AGORA });
  assert.equal(r.acao, 'gravado', 'a entrada já estava, mas havia cópia antiga ligada');
  assert.deepEqual(r.desligadas, ['mattpocock-skills@mattpocock']);
  assert.deepEqual(lerArq(arq).enabledPlugins, { 'mattpocock-skills@mattpocock': false, 'poka-yoke@poka-yoke': false, 'outro@x': true });
});

test('entrada de outra fonte (ex.: directory de quem desenvolve) não é tocada', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  fs.writeFileSync(arq, JSON.stringify({ extraKnownMarketplaces: { 'claude-hadouken': { source: { source: 'directory', path: 'C:/dev/claude-hadouken' } } } }));
  const bytes = fs.readFileSync(arq);
  assert.deepEqual(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA }), { ok: false, motivo: 'outra-fonte' });
  assert.deepEqual(fs.readFileSync(arq), bytes);
});

test('recusas do gravador viram motivo, sem tocar no arquivo', (t) => {
  const d = novoTmp();
  const invalido = path.join(d, 'invalido.json');
  fs.writeFileSync(invalido, '{');
  assert.deepEqual(ligarAtualizacao({ arquivo: invalido, agoraMs: AGORA }), { ok: false, motivo: 'settings-invalido' });
  const forma = path.join(d, 'forma.json');
  fs.writeFileSync(forma, JSON.stringify({ extraKnownMarketplaces: [] }));
  assert.deepEqual(ligarAtualizacao({ arquivo: forma, agoraMs: AGORA }), { ok: false, motivo: 'settings-invalido' });
  const leitura = path.join(d, 'leitura.json');
  fs.writeFileSync(leitura, '{}');
  fs.chmodSync(leitura, 0o444);
  if (process.getuid?.() !== 0) assert.deepEqual(ligarAtualizacao({ arquivo: leitura, agoraMs: AGORA }), { ok: false, motivo: 'settings-somente-leitura' });
  fs.chmodSync(leitura, 0o644);
  for (const ruim of [{ arquivo: 'relativo.json', agoraMs: AGORA }, { arquivo: leitura, agoraMs: -1 }, null]) {
    assert.deepEqual(ligarAtualizacao(ruim), { ok: false, motivo: 'argumentos' });
  }
  const alvo = path.join(d, 'alvo.json');
  fs.writeFileSync(alvo, '{}');
  const link = path.join(d, 'link.json');
  try { fs.symlinkSync(alvo, link); } catch { t.diagnostic('sem permissão para criar link: parte do link pulada'); return; }
  assert.deepEqual(ligarAtualizacao({ arquivo: link, agoraMs: AGORA }), { ok: false, motivo: 'settings-link' });
});

test('marketplaceConhecido: ausente, nossa ou outra', () => {
  const d = novoTmp();
  const arq = path.join(d, 'known_marketplaces.json');
  assert.equal(marketplaceConhecido(arq), 'ausente');
  fs.writeFileSync(arq, JSON.stringify({ 'claude-hadouken': { source: NOSSA, installLocation: 'x' } }));
  assert.equal(marketplaceConhecido(arq), 'nossa');
  fs.writeFileSync(arq, JSON.stringify({ 'claude-hadouken': { source: { source: 'git', url: 'https://example.com/x.git' } } }));
  assert.equal(marketplaceConhecido(arq), 'outra');
  fs.writeFileSync(arq, '{');
  assert.equal(marketplaceConhecido(arq), 'ausente');
});

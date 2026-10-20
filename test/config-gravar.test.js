import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerConfiguracao } from '../src/config/ler.js';
import { desfazer, gravarConfiguracao, voltarAoPadrao } from '../src/config/gravar.js';
import { BLOQUEIO_MS } from '../src/aprendizado/ajustar.js';

// Gravar a configuração (spec v0.5.3 VS Code §2.1): atômico, com backup dos
// 3 mais novos, conferindo a versão lida (gravação concorrente), e soltando
// o aperto do aprendizado quando o senhor afrouxa a guarda. Pastas
// temporárias; nada toca ~/.claude.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const AGORA = Date.UTC(2026, 9, 20, 18, 0);
const iso = (ms) => new Date(ms).toISOString();
function novo(config) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk gravar ç '));
  dirs.push(d);
  if (config !== undefined) fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify(config));
  return d;
}
const arq = (d) => path.join(d, 'config.json');
const lerArq = (d) => JSON.parse(fs.readFileSync(arq(d), 'utf8'));
const versao = (d) => lerConfiguracao(d).versao;
const backups = (d) => fs.readdirSync(d).filter((n) => n.startsWith('config.json.bak-')).sort();
function ligar(d, vigentes) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(d, 'otel', 'ligado.json'), JSON.stringify({ v: 1, chaves: {}, criouEnv: false, em: iso(AGORA) }));
  fs.writeFileSync(path.join(d, 'ajustes.json'), JSON.stringify({ v: 1, seq: 0, vigentes, registros: [], bloqueios: {}, perfil: {} }));
}

test('gravar: mantém repos e guarda, e grava a chave nova', () => {
  const d = novo({ repos: [{ dono: 'a', nome: 'b' }], guarda: { teto5h: 80 } });
  const r = gravarConfiguracao(d, { 'barra.ctx.amarelo': 60 }, { versao: versao(d), agoraMs: AGORA });
  assert.equal(r.ok, true);
  assert.deepEqual(lerArq(d), { repos: [{ dono: 'a', nome: 'b' }], guarda: { teto5h: 80 }, barra: { ctx: { amarelo: 60 } } });
  assert.equal(r.versao, versao(d));
  assert.deepEqual(r.afrouxou, []);
});

test('gravar: os dois avisos de 5 h vão como lista', () => {
  const d = novo();
  assert.equal(gravarConfiguracao(d, { 'alertas.projecao5hMin.1': 20 }, { versao: 'ausente', agoraMs: AGORA }).ok, true);
  assert.deepEqual(lerArq(d), { alertas: { projecao5hMin: [60, 20] } });
});

test('backup: só os 3 mais novos, com o nome config.json.bak-AAAAMMDDTHHMMSSmmm', () => {
  const d = novo({});
  for (let i = 0; i < 4; i++) {
    const r = gravarConfiguracao(d, { 'barra.ctx.amarelo': 60 + i }, { versao: versao(d), agoraMs: AGORA + i * 1000 });
    assert.equal(r.ok, true);
  }
  const b = backups(d);
  assert.equal(b.length, 3);
  for (const n of b) assert.match(n, /^config\.json\.bak-\d{8}T\d{9}$/);
  assert.deepEqual(b, ['config.json.bak-20261020T180001000', 'config.json.bak-20261020T180002000', 'config.json.bak-20261020T180003000']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, b[2]), 'utf8')), { barra: { ctx: { amarelo: 62 } } });
});

test('gravação concorrente: versão velha devolve mudou e não mexe no arquivo', () => {
  const d = novo({ guarda: { teto5h: 80 } });
  const velha = versao(d);
  assert.equal(gravarConfiguracao(d, { 'barra.ctx.amarelo': 60 }, { versao: velha, agoraMs: AGORA }).ok, true);
  const antes = fs.readFileSync(arq(d), 'utf8');
  assert.deepEqual(gravarConfiguracao(d, { 'barra.ctx.amarelo': 65 }, { versao: velha, agoraMs: AGORA }), { ok: false, motivo: 'mudou' });
  assert.equal(fs.readFileSync(arq(d), 'utf8'), antes);
});

test('inválido: devolve os erros e o arquivo fica igual', () => {
  const d = novo({ guarda: { teto5h: 80 } });
  const antes = fs.readFileSync(arq(d), 'utf8');
  const r = gravarConfiguracao(d, { 'barra.ctx.amarelo': 90, 'barra.ctx.vermelho': 80 }, { versao: versao(d), agoraMs: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'invalido');
  assert.ok(r.erros.length > 0);
  assert.equal(fs.readFileSync(arq(d), 'utf8'), antes);
  assert.deepEqual(backups(d), []);
});

test('afrouxar guarda.teto7d com aperto vigente solta só esse aperto e bloqueia 7 dias', () => {
  const d = novo({ guarda: { teto7d: 85 } });
  ligar(d, { 'guarda.teto7d': 80, 'guarda.fableTetoPct': 85 });
  const r = gravarConfiguracao(d, { 'guarda.teto7d': 95 }, { versao: versao(d), agoraMs: AGORA });
  assert.equal(r.ok, true);
  assert.deepEqual(r.afrouxou, ['guarda.teto7d']);
  const aj = JSON.parse(fs.readFileSync(path.join(d, 'ajustes.json'), 'utf8'));
  assert.equal(aj.vigentes['guarda.teto7d'], null);
  assert.equal(aj.vigentes['guarda.fableTetoPct'], 85);
  assert.equal(aj.bloqueios['guarda.teto7d'], AGORA + BLOQUEIO_MS);
  const reg = aj.registros.at(-1);
  assert.deepEqual([reg.item, reg.antes, reg.depois, reg.origem], ['guarda.teto7d', 80, null, 'limites']);
  assert.equal(lerConfiguracao(d).itens.find((i) => i.id === 'guarda.teto7d').aperto, null);
});

test('voltar ao padrão: remove a chave e o objeto que fica vazio', () => {
  const d = novo({ repos: [], barra: { ctx: { amarelo: 60 }, cache: { verde: 90 } } });
  const r = voltarAoPadrao(d, ['barra.ctx.amarelo'], { versao: versao(d), agoraMs: AGORA });
  assert.equal(r.ok, true);
  assert.deepEqual(lerArq(d), { repos: [], barra: { cache: { verde: 90 } } });
  const r2 = voltarAoPadrao(d, ['barra.cache.verde'], { versao: r.versao, agoraMs: AGORA });
  assert.equal(r2.ok, true);
  assert.deepEqual(lerArq(d), { repos: [] });
  assert.equal(voltarAoPadrao(d, ['nao.existe'], { versao: r2.versao, agoraMs: AGORA }).motivo, 'invalido');
});

test('desfazer: volta os valores (inclusive a ausência); de novo ou vencido dá mudou', () => {
  const d = novo({ barra: { ctx: { vermelho: 90 } } });
  const original = fs.readFileSync(arq(d), 'utf8');
  const r = gravarConfiguracao(d, { 'barra.ctx.amarelo': 60, 'barra.ctx.vermelho': 95 }, { versao: versao(d), agoraMs: AGORA });
  assert.equal(r.ok, true);
  assert.deepEqual(r.desfazer.antes, { 'barra.ctx.amarelo': null, 'barra.ctx.vermelho': 90 });
  const tokenJson = JSON.parse(JSON.stringify(r.desfazer));
  const v = desfazer(d, tokenJson, { agoraMs: AGORA + 60_000 });
  assert.equal(v.ok, true);
  assert.deepEqual(lerArq(d), JSON.parse(original));
  assert.deepEqual(desfazer(d, tokenJson, { agoraMs: AGORA + 60_000 }), { ok: false, motivo: 'mudou' });
  const r2 = gravarConfiguracao(d, { 'barra.ctx.amarelo': 61 }, { versao: versao(d), agoraMs: AGORA });
  assert.deepEqual(desfazer(d, r2.desfazer, { agoraMs: AGORA + 15 * 60_000 + 1 }), { ok: false, motivo: 'mudou' });
});

test('config.json pasta, link ou quebrado: erro, sem lançar e sem sobrescrever', () => {
  const pasta = novo();
  fs.mkdirSync(arq(pasta));
  assert.deepEqual(gravarConfiguracao(pasta, { 'barra.ctx.amarelo': 60 }, { versao: versao(pasta), agoraMs: AGORA }), { ok: false, motivo: 'erro' });
  const quebrado = novo();
  fs.writeFileSync(arq(quebrado), '{');
  assert.deepEqual(gravarConfiguracao(quebrado, { 'barra.ctx.amarelo': 60 }, { versao: versao(quebrado), agoraMs: AGORA }), { ok: false, motivo: 'erro' });
  assert.equal(fs.readFileSync(arq(quebrado), 'utf8'), '{');
  const link = novo();
  const alvo = path.join(novo({}), 'config.json');
  try {
    fs.symlinkSync(alvo, arq(link));
  } catch {
    return; // sem permissão de criar link (Windows sem modo de desenvolvedor)
  }
  assert.deepEqual(gravarConfiguracao(link, { 'barra.ctx.amarelo': 60 }, { versao: versao(link), agoraMs: AGORA }), { ok: false, motivo: 'erro' });
  assert.equal(fs.readFileSync(alvo, 'utf8'), '{}');
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARQ_LIBERACAO, lerPedido, montarLiberacao, liberacaoValida, coberturaAtual, lerLiberacao, gravarLiberacao,
} from '../src/guarda/liberacao.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';
import { ARQ_GUARDA, travasVazias, gravarTravas, lerTravas, limparTravas } from '../src/guarda/travas.js';

const dirs = [];
const novo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-lib-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const H = 3_600_000;
const agora = Date.UTC(2026, 8, 29, 14, 40);
const agoraS = agora / 1000;

test('lerPedido: vazio, horas, janela, fable, caro e combinações', () => {
  const c = PADRAO_GUARDA;
  assert.deepEqual(lerPedido('', c), { ok: true, horas: 2, janela: false, fable: false, caro: false });
  assert.deepEqual(lerPedido('  8H ', c), { ok: true, horas: 8, janela: false, fable: false, caro: false });
  assert.deepEqual(lerPedido('janela fable', c), { ok: true, horas: null, janela: true, fable: true, caro: false });
  assert.deepEqual(lerPedido('caro 4h', c), { ok: true, horas: 4, janela: false, fable: false, caro: true });
  for (const ruim of ['25h', '0h', 'xh', 'fable fable', '2h 3h', 'janela 2h', 'rm -rf', 'a b c d', 'x'.repeat(65), null, 7]) {
    assert.deepEqual(lerPedido(ruim, c), { ok: false }, String(ruim));
  }
  assert.deepEqual(lerPedido('9h', { ...c, liberacaoMaxH: 8 }), { ok: false });
});

// Um escopo só vale escrito por inteiro em ASCII: um invisível colado, um
// dígito de largura cheia ou um NUL nunca viram `fable` ou `2h` (o escopo
// errado soltaria mais do que o usuário pediu).
test('lerPedido: invisível, dígito não ASCII e NUL são pedido inválido', () => {
  for (const ruim of ['fable\u200b', '\uff12h', '2h\u0000', 'caro\u00ad', '\u0662h']) {
    assert.deepEqual(lerPedido(ruim, PADRAO_GUARDA), { ok: false }, JSON.stringify(ruim));
  }
});

test('montarLiberacao: prazo, solta, base e teto de pontos', () => {
  const t = travasVazias();
  const lib = montarLiberacao({ pedido: lerPedido('fable', PADRAO_GUARDA), agoraMs: agora, usado7d: 84.4, travas: t, config: PADRAO_GUARDA, sessionId: 'sess-1', id: 'b3f0c2d1' });
  assert.deepEqual(lib, {
    v: 1, id: 'b3f0c2d1', criadaEm: new Date(agora).toISOString(), ate: new Date(agora + 2 * H).toISOString(),
    solta: ['five_hour', 'seven_day', 'fable-despachos', 'ilegivel', 'fable'], base7d: 84.4, tetoPontos7d: 10, sessao: 'sess-1', avisada: false,
  });
});

test('janela: até o reset da janela travada, no máximo maxH', () => {
  const t = { ...travasVazias(), seven_day: { resets_at: agoraS + 5 * 3600, gatilho: 'G2', desde: new Date(agora).toISOString() } };
  const lib = montarLiberacao({ pedido: lerPedido('janela', PADRAO_GUARDA), agoraMs: agora, usado7d: null, travas: t, config: PADRAO_GUARDA, sessionId: 's', id: '00000000' });
  assert.equal(lib.ate, new Date(agora + 5 * H).toISOString());
  const longe = { ...t, seven_day: { ...t.seven_day, resets_at: agoraS + 40 * 3600 } };
  assert.equal(montarLiberacao({ pedido: lerPedido('janela', PADRAO_GUARDA), agoraMs: agora, usado7d: null, travas: longe, config: PADRAO_GUARDA, sessionId: 's', id: '00000000' }).ate, new Date(agora + 24 * H).toISOString());
  assert.equal(montarLiberacao({ pedido: lerPedido('janela', PADRAO_GUARDA), agoraMs: agora, usado7d: null, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '00000000' }).ate, new Date(agora + 2 * H).toISOString());
});

test('coberturaAtual: prazo e +10 pontos de 7d encerram; 2h não solta G6 (S25)', () => {
  const lib = montarLiberacao({ pedido: lerPedido('2h', PADRAO_GUARDA), agoraMs: agora, usado7d: 84, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '00000000' });
  const c = coberturaAtual(lib, agora + H, 93.9);
  assert.equal(c.ativa, true);
  assert.equal(c.solta.has('fable'), false);
  assert.equal(c.solta.has('despacho-caro'), false);
  assert.deepEqual(coberturaAtual(lib, agora + H, 94), { ativa: false, solta: new Set(), fim: 'pontos' });
  assert.deepEqual(coberturaAtual(lib, agora + 2 * H, 50), { ativa: false, solta: new Set(), fim: 'prazo' });
  assert.deepEqual(coberturaAtual(null, agora, 50), { ativa: false, solta: new Set(), fim: null });
});

// Spec §6.4: liberação inválida é nenhuma liberação, também para quem pede
// a cobertura direto: um prazo ou uma base ilegível nunca deixam a
// liberação ativa.
test('coberturaAtual: liberação fora do esquema é nenhuma liberação', () => {
  const lib = montarLiberacao({ pedido: lerPedido('caro', PADRAO_GUARDA), agoraMs: agora, usado7d: 84, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '00000000' });
  const nenhuma = { ativa: false, solta: new Set(), fim: null };
  for (const estrago of [{ ate: 'x' }, { ate: undefined }, { base7d: undefined }, { base7d: 'oitenta' }, { tetoPontos7d: NaN }, { solta: 'fable' }]) {
    assert.deepEqual(coberturaAtual({ ...lib, ...estrago }, agora + H, 50), nenhuma, JSON.stringify(estrago));
  }
  assert.deepEqual(coberturaAtual(lib, NaN, 50), nenhuma);
  assert.equal(coberturaAtual(lib, agora + H, null).ativa, true);
});

test('liberacaoValida: esquema estrito; inválida é nenhuma liberação', () => {
  const lib = montarLiberacao({ pedido: lerPedido('caro', PADRAO_GUARDA), agoraMs: agora, usado7d: null, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: 'abcdef01' });
  assert.deepEqual(liberacaoValida(JSON.parse(JSON.stringify(lib)), agora), lib);
  for (const estrago of [{ id: 'xyz' }, { solta: ['tudo'] }, { solta: ['fable', 'fable'] }, { base7d: 101 }, { tetoPontos7d: 0 }, { sessao: '__proto__' }, { avisada: 'sim' }, { v: 2 }, { ate: 'ontem' }]) {
    assert.equal(liberacaoValida({ ...lib, ...estrago }, agora), null, JSON.stringify(estrago));
  }
});

test('gravar e ler; link e arquivo gigante são nenhuma liberação', (t) => {
  const d = novo();
  const lib = montarLiberacao({ pedido: lerPedido('', PADRAO_GUARDA), agoraMs: agora, usado7d: 10, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '12345678' });
  assert.deepEqual(gravarLiberacao(d, lib), { ok: true });
  assert.deepEqual(lerLiberacao(d, agora), lib);
  fs.writeFileSync(path.join(d, ARQ_LIBERACAO), JSON.stringify({ ...lib, x: 'y'.repeat(5000) }));
  assert.equal(lerLiberacao(d, agora), null);
  const d2 = novo();
  const alvo = path.join(d2, 'alvo.json');
  fs.writeFileSync(alvo, JSON.stringify(lib));
  try { fs.symlinkSync(alvo, path.join(d2, ARQ_LIBERACAO)); } catch { t.skip('sem permissão para criar link'); return; }
  assert.equal(lerLiberacao(d2, agora), null);
});

// Fail-closed (spec §6.4 e §14): uma pasta, ou um arquivo presente que não
// abre, no lugar de liberacao.json é nenhuma liberação, nunca um erro que
// solte a guarda. Sem como tirar a leitura (Windows, root), a segunda parte
// sai como skip; no CI de Linux e macOS ela roda.
test('pasta ou arquivo que não abre no lugar de liberacao.json: nenhuma liberação', (t) => {
  const d = novo();
  fs.mkdirSync(path.join(d, ARQ_LIBERACAO));
  assert.equal(lerLiberacao(d, agora), null);
  const d2 = novo();
  const lib = montarLiberacao({ pedido: lerPedido('fable caro', PADRAO_GUARDA), agoraMs: agora, usado7d: 10, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '12345678' });
  assert.deepEqual(gravarLiberacao(d2, lib), { ok: true });
  const arq = path.join(d2, ARQ_LIBERACAO);
  fs.chmodSync(arq, 0o000);
  try {
    let abre = true;
    try { fs.readFileSync(arq); } catch { abre = false; }
    if (abre) { t.skip('sem como tirar a permissão de leitura aqui'); return; }
    assert.equal(lerLiberacao(d2, agora), null);
  } finally {
    fs.chmodSync(arq, 0o600);
  }
});

// A gravação troca o link por um arquivo regular pela renomeação atômica e
// nunca escreve no alvo do link (outro arquivo do usuário).
test('gravar sobre um link o substitui e deixa o alvo intacto', (t) => {
  const d = novo();
  const alvo = path.join(d, 'alvo.json');
  fs.writeFileSync(alvo, '{"meu":"arquivo"}');
  const arq = path.join(d, ARQ_LIBERACAO);
  try { fs.symlinkSync(alvo, arq); } catch { t.skip('sem permissão para criar link'); return; }
  const lib = montarLiberacao({ pedido: lerPedido('4h', PADRAO_GUARDA), agoraMs: agora, usado7d: 10, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '12345678' });
  assert.deepEqual(gravarLiberacao(d, lib), { ok: true });
  assert.equal(fs.lstatSync(arq).isFile(), true);
  assert.deepEqual(lerLiberacao(d, agora), lib);
  assert.equal(fs.readFileSync(alvo, 'utf8'), '{"meu":"arquivo"}');
});

// Spec §4.5 ("só a liberação limpa") e decisão do controlador na Task 8:
// sobre um guarda.json ilegível, a liberação limpa o arquivo inteiro, mesmo
// sem o escopo `fable`; a avaliação seguinte trava de novo o que a condição
// ainda sustentar. Sobre um arquivo legível, a liberação comum não solta a
// trava de G6 (S25). As chaves de `solta` que não são trava ('ilegivel',
// 'despacho-caro') não mudam o arquivo.
test('solta de uma liberação comum passada a limparTravas: ilegível zera tudo, legível preserva G6', () => {
  const lib = montarLiberacao({ pedido: lerPedido('2h caro', PADRAO_GUARDA), agoraMs: agora, usado7d: 50, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's', id: '12345678' });
  const d = novo();
  fs.writeFileSync(path.join(d, ARQ_GUARDA), '{');
  assert.equal(lerTravas(d, agora).estado, 'ilegivel');
  assert.deepEqual(limparTravas(d, lib.solta, agora), { ok: true });
  assert.deepEqual(lerTravas(d, agora), { estado: 'ok', travas: travasVazias() });
  const d2 = novo();
  const desde = new Date(agora - 60_000).toISOString();
  gravarTravas(d2, {
    seven_day: { resets_at: agoraS + 3600, gatilho: 'G2', desde }, fable: { resets_at: null, gatilho: 'G6', desde },
  }, agora);
  assert.deepEqual(limparTravas(d2, lib.solta, agora), { ok: true });
  const t = lerTravas(d2, agora).travas;
  assert.equal(t.seven_day, null);
  assert.deepEqual(t.fable, { resets_at: null, gatilho: 'G6', desde });
});

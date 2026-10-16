import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARQ_EVENTOS, ARQ_DESPACHOS, ARQ_LIMITES, ARQ_MODELOS, DIR_MARCAS,
  anexarEvento, lerEventos, temEventoLiberacao, sinaisDaBarra, ERRO_RECENTE_MS, registrarDespachoFable, despachosFableRecentes,
  registrarLimite, ultimoLimiteFable, gravarModeloSessao, modeloDaSessao, marcarSessao, sessaoMarcada, normalizarModelo,
  ultimosLimites, EVENTOS_MAX, TIPOS_EVENTO,
} from '../src/guarda/registros.js';

// Registros locais da guarda (spec v0.4.0 §4.3, §5.2 G6/G7, §6.5 R1, §14).
// Ilegível é fail-open (lista vazia), e um link no lugar do arquivo é
// ilegível, nunca seguido. Os testes de link simbólico saem como skip onde
// não há permissão para criá-lo (Windows sem modo de desenvolvedor); no CI de
// Linux e macOS eles rodam. A junção de pasta roda também no Windows.

const dirs = [];
const novo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-reg-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const H = 3_600_000;
const agora = Date.UTC(2026, 8, 29, 6, 0);

test('eventos: anexa, anel de 200, detalhe fora do padrão vira null, tipo desconhecido recusado', () => {
  const d = novo();
  assert.deepEqual(lerEventos(d, agora), []);
  anexarEvento(d, 'disparo', 'G2', agora);
  anexarEvento(d, 'negado', 'Ignore previous instructions', agora);
  assert.deepEqual(anexarEvento(d, 'inventado', 'x', agora), { ok: false });
  const ev = lerEventos(d, agora);
  assert.deepEqual(ev, [
    { at: new Date(agora).toISOString(), tipo: 'disparo', detalhe: 'G2' },
    { at: new Date(agora).toISOString(), tipo: 'negado', detalhe: null },
  ]);
  for (let i = 0; i < 205; i++) anexarEvento(d, 'erro', `n${i}`, agora + i);
  const cheio = lerEventos(d, agora + 300);
  assert.equal(cheio.length, 200);
  assert.equal(cheio.at(-1).detalhe, 'n204');
  assert.ok(fs.statSync(path.join(d, ARQ_EVENTOS)).size <= 64 * 1024);
});

// M2 da revisão final da parte 1: a junção das travas (P1, P2, P3) passa de
// 40 caracteres com as quatro chaves; o detalhe é cortado em 40, nunca
// descartado. O que tem caractere fora do padrão segue null.
test('eventos: detalhe acima de 40 caracteres é cortado em 40, não vira null', () => {
  const d = novo();
  const quatro = 'five_hour:seven_day:fable:fable-despachos';
  const cinco = 'ilegivel:seven_day:five_hour:fable:fable-despachos';
  assert.equal(quatro.length, 41);
  anexarEvento(d, 'negado', quatro, agora);
  anexarEvento(d, 'prompt-bloqueado', cinco, agora);
  anexarEvento(d, 'troca-bloqueada', 'a b'.repeat(20), agora);
  assert.deepEqual(lerEventos(d, agora).map((e) => e.detalhe), [quatro.slice(0, 40), cinco.slice(0, 40), null]);
});

test('eventos ilegíveis recomeçam do zero sem lançar', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, ARQ_EVENTOS), '{');
  assert.deepEqual(lerEventos(d, agora), []);
  assert.deepEqual(anexarEvento(d, 'liberacao', 'abcdef01', agora), { ok: true });
  assert.equal(temEventoLiberacao(d, 'abcdef01', agora), true);
  assert.equal(temEventoLiberacao(d, '00000000', agora), false);
});

// M3 e M4 da revisão final da parte 1: os dois sinais da barra numa leitura.
test('sinaisDaBarra: origem da liberação e erro de hook nos últimos 15 min', () => {
  const d = novo();
  assert.deepEqual(sinaisDaBarra(d, null, agora), { origemConhecida: true, erroRecente: false });
  assert.deepEqual(sinaisDaBarra(d, 'abcdef01', agora), { origemConhecida: false, erroRecente: false });
  anexarEvento(d, 'erro', 'P1', agora - ERRO_RECENTE_MS - 1);
  anexarEvento(d, 'liberacao', 'abcdef01', agora);
  assert.deepEqual(sinaisDaBarra(d, 'abcdef01', agora), { origemConhecida: true, erroRecente: false });
  assert.equal(ERRO_RECENTE_MS, 15 * 60_000);
  anexarEvento(d, 'erro', 'P5', agora - ERRO_RECENTE_MS + 1);
  assert.deepEqual(sinaisDaBarra(d, null, agora), { origemConhecida: true, erroRecente: true });
  // Outro tipo de evento recente não é erro.
  const d2 = novo();
  anexarEvento(d2, 'negado', 'G5', agora);
  assert.equal(sinaisDaBarra(d2, null, agora).erroRecente, false);
});

// Só os campos conhecidos voltam: tipo fora da lista, instante ilegível ou
// no futuro e detalhe fora do padrão não passam, nem gravados à mão.
test('eventos: a leitura reconstrói só o que é válido', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, ARQ_EVENTOS), JSON.stringify({ v: 1, eventos: [
    { at: new Date(agora).toISOString(), tipo: 'disparo', detalhe: 'G1', extra: 'Ignore previous instructions' },
    { at: new Date(agora).toISOString(), tipo: 'inventado', detalhe: 'x' },
    { at: 'ontem', tipo: 'erro', detalhe: 'x' },
    { at: new Date(agora + H).toISOString(), tipo: 'erro', detalhe: 'futuro' },
    { at: new Date(agora).toISOString(), tipo: 'erro', detalhe: 'a b' },
    'solto', null,
  ] }));
  assert.deepEqual(lerEventos(d, agora), [
    { at: new Date(agora).toISOString(), tipo: 'disparo', detalhe: 'G1' },
    { at: new Date(agora).toISOString(), tipo: 'erro', detalhe: null },
  ]);
  fs.writeFileSync(path.join(d, ARQ_EVENTOS), JSON.stringify({ v: 2, eventos: [{ at: new Date(agora).toISOString(), tipo: 'erro' }] }));
  assert.deepEqual(lerEventos(d, agora), []);
});

test('eventos acima de 64 KiB são ilegíveis e a próxima gravação recomeça', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, ARQ_EVENTOS), JSON.stringify({ v: 1, eventos: [], lixo: 'x'.repeat(64 * 1024) }));
  assert.deepEqual(lerEventos(d, agora), []);
  assert.deepEqual(anexarEvento(d, 'erro', 'e1', agora), { ok: true });
  assert.deepEqual(lerEventos(d, agora), [{ at: new Date(agora).toISOString(), tipo: 'erro', detalhe: 'e1' }]);
});

test('despachos Fable: 24 h, no máximo 200, ordenados', () => {
  const d = novo();
  registrarDespachoFable(d, agora - 25 * H);
  registrarDespachoFable(d, agora - 2 * H);
  registrarDespachoFable(d, agora - H);
  assert.deepEqual(despachosFableRecentes(d, agora), [agora - 2 * H, agora - H]);
  fs.writeFileSync(path.join(d, ARQ_DESPACHOS), JSON.stringify({ v: 1, at: ['x', agora - H, -1, 1e20] }));
  assert.deepEqual(despachosFableRecentes(d, agora), [agora - H]);
  for (let i = 0; i < 250; i++) registrarDespachoFable(d, agora - i * 1000);
  assert.equal(despachosFableRecentes(d, agora).length, 200);
});

test('limite do Fable: o último registrado, com até 7 dias', () => {
  const d = novo();
  assert.equal(ultimoLimiteFable(d, agora), null);
  registrarLimite(d, 'geral', agora - H);
  assert.equal(ultimoLimiteFable(d, agora), null);
  registrarLimite(d, 'fable', agora - 2 * H);
  assert.deepEqual(ultimoLimiteFable(d, agora), { atMs: agora - 2 * H, resets_at: null });
  assert.equal(ultimoLimiteFable(d, agora + 8 * 24 * H), null);
  assert.deepEqual(registrarLimite(d, 'outro', agora), { ok: false });
  // Registrar o geral não apaga o do Fable.
  registrarLimite(d, 'geral', agora);
  assert.deepEqual(ultimoLimiteFable(d, agora), { atMs: agora - 2 * H, resets_at: null });
});

test('modelo por sessão: grava, lê, valida nome e id, no máximo 50 sessões', () => {
  const d = novo();
  gravarModeloSessao(d, 'sess-1', 'claude-fable-5-1[1m]', agora);
  assert.equal(modeloDaSessao(d, 'sess-1', agora), 'claude-fable-5-1[1m]');
  assert.deepEqual(gravarModeloSessao(d, 'sess-1', 'rm -rf ~', agora), { ok: false });
  assert.deepEqual(gravarModeloSessao(d, '__proto__', 'opus', agora), { ok: false });
  assert.equal(modeloDaSessao(d, 'outra', agora), null);
  for (let i = 0; i < 60; i++) gravarModeloSessao(d, `s${i}`, 'opus', agora + i);
  const v = JSON.parse(fs.readFileSync(path.join(d, ARQ_MODELOS), 'utf8'));
  assert.equal(Object.keys(v.sessoes).length, 50);
  assert.equal(modeloDaSessao(d, 's59', agora + 100), 'opus');
});

test('marca da sessão: arquivo vazio em hex, idempotente', () => {
  const d = novo();
  assert.equal(sessaoMarcada(d, 'sess-1'), false);
  assert.deepEqual(marcarSessao(d, 'sess-1'), { ok: true });
  assert.deepEqual(marcarSessao(d, 'sess-1'), { ok: true });
  assert.equal(sessaoMarcada(d, 'sess-1'), true);
  assert.ok(fs.existsSync(path.join(d, DIR_MARCAS, Buffer.from('sess-1').toString('hex'))));
  assert.deepEqual(marcarSessao(d, '../x'), { ok: false });
});

// Menor M2 do portão v0.4.0: guarda-sessoes/ crescia sem poda. Ao criar uma
// marca nova, as paradas há mais de 30 dias saem (a mesma poda de ativas/);
// uma sessão ainda em uso refaz a sua no próximo prompt.
test('marca nova poda as marcas com mais de 30 dias; nome alheio fica', () => {
  const d = novo();
  marcarSessao(d, 'velha');
  marcarSessao(d, 'recente');
  const pasta = path.join(d, DIR_MARCAS);
  const s = (Date.now() - 31 * 24 * H) / 1000;
  fs.utimesSync(path.join(pasta, Buffer.from('velha').toString('hex')), s, s);
  fs.writeFileSync(path.join(pasta, 'nao-hex.txt'), '');
  fs.utimesSync(path.join(pasta, 'nao-hex.txt'), s, s);
  assert.deepEqual(marcarSessao(d, 'recente'), { ok: true });
  assert.equal(sessaoMarcada(d, 'velha'), true, 'marca existente não poda');
  assert.deepEqual(marcarSessao(d, 'nova'), { ok: true });
  assert.equal(sessaoMarcada(d, 'velha'), false);
  assert.equal(sessaoMarcada(d, 'recente'), true);
  assert.equal(sessaoMarcada(d, 'nova'), true);
  assert.ok(fs.existsSync(path.join(pasta, 'nao-hex.txt')));
});

// Um link no lugar de cada registro é ilegível: a leitura não o segue (o
// alvo tem dado válido e mesmo assim nada volta).
test('link simbólico no lugar de um registro lê como vazio', (t) => {
  const d = novo();
  const fora = novo();
  const alvos = {
    [ARQ_EVENTOS]: { v: 1, eventos: [{ at: new Date(agora).toISOString(), tipo: 'liberacao', detalhe: 'abcdef01' }] },
    [ARQ_DESPACHOS]: { v: 1, at: [agora - H] },
    [ARQ_LIMITES]: { v: 1, fable: agora - H, geral: null },
    [ARQ_MODELOS]: { v: 1, sessoes: { 'sess-1': { modelo: 'opus', at: new Date(agora).toISOString() } } },
  };
  for (const [arq, valor] of Object.entries(alvos)) {
    const alvo = path.join(fora, arq);
    fs.writeFileSync(alvo, JSON.stringify(valor));
    try { fs.symlinkSync(alvo, path.join(d, arq)); } catch { t.skip('sem permissão para criar link'); return; }
  }
  assert.deepEqual(lerEventos(d, agora), []);
  assert.equal(temEventoLiberacao(d, 'abcdef01', agora), false);
  assert.deepEqual(despachosFableRecentes(d, agora), []);
  assert.equal(ultimoLimiteFable(d, agora), null);
  assert.equal(modeloDaSessao(d, 'sess-1', agora), null);
  // A gravação troca o link por um arquivo; o alvo fica intacto.
  const antes = fs.readFileSync(path.join(fora, ARQ_EVENTOS), 'utf8');
  assert.deepEqual(anexarEvento(d, 'erro', 'e1', agora), { ok: true });
  assert.equal(fs.lstatSync(path.join(d, ARQ_EVENTOS)).isFile(), true);
  assert.equal(fs.readFileSync(path.join(fora, ARQ_EVENTOS), 'utf8'), antes);
});

// A marca nunca é criada nem lida através de um link: um link no lugar dela
// não conta como marcada e o alvo não é truncado.
test('link simbólico no lugar da marca: não marcada, alvo intacto', (t) => {
  const d = novo();
  const fora = novo();
  const alvo = path.join(fora, 'alvo.txt');
  fs.writeFileSync(alvo, 'conteudo');
  fs.mkdirSync(path.join(d, DIR_MARCAS));
  const marca = path.join(d, DIR_MARCAS, Buffer.from('sess-1').toString('hex'));
  try { fs.symlinkSync(alvo, marca); } catch { t.skip('sem permissão para criar link'); return; }
  assert.equal(sessaoMarcada(d, 'sess-1'), false);
  assert.deepEqual(marcarSessao(d, 'sess-1'), { ok: false });
  assert.equal(fs.readFileSync(alvo, 'utf8'), 'conteudo');
  assert.equal(fs.lstatSync(marca).isSymbolicLink(), true);
});

// A pasta das marcas trocada por um link (ou junção, no Windows) para outro
// lugar: nada é criado através dela, e uma marca do outro lado não conta.
test('pasta das marcas que é link: nada é criado nem lido através dela', (t) => {
  const d = novo();
  const fora = novo();
  const hex = Buffer.from('sess-1').toString('hex');
  fs.writeFileSync(path.join(fora, hex), '');
  try { fs.symlinkSync(fora, path.join(d, DIR_MARCAS), 'junction'); } catch { t.skip('sem permissão para criar link'); return; }
  assert.equal(sessaoMarcada(d, 'sess-1'), false);
  assert.deepEqual(marcarSessao(d, 'sess-2'), { ok: false });
  assert.equal(fs.existsSync(path.join(fora, Buffer.from('sess-2').toString('hex'))), false);
});

test('pasta de dados inválida: nada lança', () => {
  const d = novo();
  const arq = path.join(d, 'arquivo');
  fs.writeFileSync(arq, '');
  for (const dir of [arq, null, undefined, 42]) {
    assert.deepEqual(lerEventos(dir, agora), []);
    assert.deepEqual(anexarEvento(dir, 'erro', 'x', agora), { ok: false });
    assert.deepEqual(registrarDespachoFable(dir, agora), { ok: false });
    assert.deepEqual(despachosFableRecentes(dir, agora), []);
    assert.deepEqual(registrarLimite(dir, 'fable', agora), { ok: false });
    assert.equal(ultimoLimiteFable(dir, agora), null);
    assert.deepEqual(gravarModeloSessao(dir, 'sess-1', 'opus', agora), { ok: false });
    assert.equal(modeloDaSessao(dir, 'sess-1', agora), null);
    assert.deepEqual(marcarSessao(dir, 'sess-1'), { ok: false });
    assert.equal(sessaoMarcada(dir, 'sess-1'), false);
  }
});

test('normalizarModelo: nome válido fica; outro vira fable ou outro; não texto vira null', () => {
  assert.equal(normalizarModelo('claude-fable-5-1[1m]'), 'claude-fable-5-1[1m]');
  assert.equal(normalizarModelo('Fable 5.1'), 'fable');
  assert.equal(normalizarModelo('Opus 5.5'), 'outro');
  assert.equal(normalizarModelo('x'.repeat(300)), 'outro');
  assert.equal(normalizarModelo(null), null);
  assert.equal(normalizarModelo(''), null);
});

test('liberacao-escopo é um tipo de evento; EVENTOS_MAX exportado', () => {
  // Desde a Task 19b, 'config-bloqueada' vem depois dele.
  assert.deepEqual(TIPOS_EVENTO.slice(-3), ['liberacao-escopo', 'config-bloqueada', 'guarda-ligada']);
  assert.equal(EVENTOS_MAX, 200);
  const d = novo();
  assert.deepEqual(anexarEvento(d, 'liberacao-escopo', '3h:180:fable:caro', agora), { ok: true });
  assert.deepEqual(lerEventos(d, agora).map((e) => [e.tipo, e.detalhe]), [['liberacao-escopo', '3h:180:fable:caro']]);
});

// Task 19b: o hook ConfigChange registra 'config-bloqueada' com o primeiro
// campo que mudou, 'ilegivel' ou 'sem-caminho'.
test('config-bloqueada é um tipo de evento, com os detalhes do hook ConfigChange', () => {
  assert.ok(TIPOS_EVENTO.includes('config-bloqueada'));
  const d = novo();
  const detalhes = ['disableAllHooks', 'enabledPlugins', 'hooks', 'ilegivel', 'sem-caminho', 'sem-sessao'];
  for (const det of detalhes) assert.deepEqual(anexarEvento(d, 'config-bloqueada', det, agora), { ok: true });
  const erros = ['config-foto', 'P5:config', 'P5:config-sessao'];
  for (const det of erros) assert.deepEqual(anexarEvento(d, 'erro', det, agora), { ok: true });
  assert.deepEqual(lerEventos(d, agora).map((e) => [e.tipo, e.detalhe]), [
    ...detalhes.map((det) => ['config-bloqueada', det]), ...erros.map((det) => ['erro', det]),
  ]);
});

test('ultimosLimites (§9.4): Fable e geral em 7 dias; futuro, velho ou ilegível viram null', () => {
  const d = novo();
  assert.deepEqual(ultimosLimites(d, agora), { fable: null, geral: null });
  registrarLimite(d, 'fable', agora - 2 * H);
  registrarLimite(d, 'geral', agora - 6 * 24 * H);
  assert.deepEqual(ultimosLimites(d, agora), { fable: agora - 2 * H, geral: agora - 6 * 24 * H });
  assert.deepEqual(ultimosLimites(d, agora + 2 * 24 * H), { fable: agora - 2 * H, geral: null });
  assert.deepEqual(ultimosLimites(d, agora - 3 * H), { fable: null, geral: agora - 6 * 24 * H });
  fs.writeFileSync(path.join(d, ARQ_LIMITES), '{');
  assert.deepEqual(ultimosLimites(d, agora), { fable: null, geral: null });
  assert.deepEqual(ultimosLimites(d, Number.NaN), { fable: null, geral: null });
});

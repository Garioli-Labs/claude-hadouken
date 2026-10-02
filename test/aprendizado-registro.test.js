import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhos, ligadoExiste, valorDoItem, chaveSugestao, TETO } from '../src/aprendizado/arquivos.js';
import {
  lerAprendizado, gravarAprendizado, ajustesVazios, lerAjustes, gravarAjustes, sugestoesVazias, lerSugestoes, gravarSugestoes,
  cursorVazio, lerCursor, gravarCursor, lerEventosApr, anexarEventoApr, lerLigado, gravarLigado, apagarLigado, pegarTrava,
  ajustesParaConsumo, intervaloDoPainelMs, faixasDoPainel, perfilDaPrevisao, _retomarTravaVencida,
  marcarEncerrada, desmarcarEncerrada, lerEncerradas, ENCERRADAS_LER_MAX, ENCERRADA_MAX_MS,
} from '../src/aprendizado/registro.js';
import { aprendizadoVazio, agregarRegistros, atualizarJanela, marcarSessao, inicioSemana, SEMANAS_MAX } from '../src/aprendizado/agregar.js';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aprendizado ç '));
  dirs.push(d);
  return d;
}
const AGORA = new Date(2026, 9, 20, 15, 0).getTime();
const D = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
function ligar(d) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  assert.equal(gravarLigado(d, { chaves: { OTEL_LOGS_EXPORTER: 'otlp' }, criouEnv: false }, AGORA).ok, true);
}

test('valorDoItem: faixas, inteiros, peso de 0,1 em 0,1 e null só na guarda', () => {
  assert.equal(valorDoItem('painel.intervaloS', 60), 60);
  assert.equal(valorDoItem('painel.intervaloS', 20), undefined);
  assert.equal(valorDoItem('painel.intervaloS', 60.5), undefined);
  assert.equal(valorDoItem('painel.intervaloS', null), undefined);
  assert.equal(valorDoItem('previsao.pesoPerfil', 0.3), 0.3);
  assert.equal(valorDoItem('previsao.pesoPerfil', 0.35), undefined);
  assert.equal(valorDoItem('guarda.teto7d', null), null);
  assert.equal(valorDoItem('guarda.teto7d', 69), undefined);
  assert.equal(valorDoItem('__proto__', 1), undefined);
  assert.equal(chaveSugestao({ tipo: 'afrouxar', item: 'guarda.teto7d' }), 'afrouxar:guarda.teto7d');
  assert.equal(
    chaveSugestao({ tipo: 'modelo', origem: 'sub:revisor', de: { modelo: 'a', effort: 'high' }, para: { modelo: 'b', effort: '-' } }),
    'modelo:sub:revisor|a|high|b|-',
  );
});

test('aprendizado.json: ida e volta; inválido, grande ou link vira vazio', (t) => {
  const d = novoDir();
  const ap = aprendizadoVazio(AGORA - 10 * D);
  agregarRegistros(ap, [{ t: 'req', em: AGORA - D, modelo: 'm', effort: 'high', origem: 'principal', custo: 1, entrada: 2, saida: 3, cacheLeitura: 4, cacheEscrita: 5, duracaoMs: 6, ttftMs: 7 }]);
  atualizarJanela(ap, 'd7', { pct: 70, resetMs: AGORA + D, emMs: AGORA - D });
  marcarSessao(ap, AGORA);
  assert.equal(gravarAprendizado(d, ap).ok, true);
  assert.deepEqual(lerAprendizado(d, AGORA), ap);
  fs.writeFileSync(caminhos(d).aprendizado, '{"v":1,"desde":');
  assert.equal(lerAprendizado(d, AGORA).sessoes, 0);
  fs.writeFileSync(caminhos(d).aprendizado, JSON.stringify({ ...ap, pad: 'x'.repeat(TETO.aprendizado) }));
  assert.equal(lerAprendizado(d, AGORA).semanas.length, 0);
  fs.rmSync(caminhos(d).aprendizado);
  const alvo = path.join(d, 'alvo.json');
  fs.writeFileSync(alvo, JSON.stringify(ap));
  try { fs.symlinkSync(alvo, caminhos(d).aprendizado); } catch (e) { if (e.code === 'EPERM') { t.skip('sem link'); return; } throw e; }
  assert.equal(lerAprendizado(d, AGORA).sessoes, 0);
});

test('aprendizado.json forjado: chaves de modelo fora do padrão e listas quebradas saem', () => {
  const d = novoDir();
  const texto = `{"v":1,"desde":${AGORA - D},"sessoes":3,"semanas":[{"inicio":"2026-10-19","ativo":${JSON.stringify(new Array(168).fill(0))},"modelos":{"__proto__":[1,2,3,4,5,6,7,8,9,10,11,12],"m|high|principal":[1,2],"n|high|principal":[1,1,1,1,1,1,1,1,1,1,1,1]}}],"ritmo":{"h5":"x"},"janelas":{"h5":[{"reset":${AGORA + 400 * D},"max":1}]}}`;
  fs.writeFileSync(caminhos(d).aprendizado, texto);
  const ap = lerAprendizado(d, AGORA);
  assert.equal(ap.sessoes, 3);
  assert.deepEqual(Object.keys(ap.semanas[0].modelos), ['n|high|principal']);
  assert.equal(ap.ritmo.h5.length, 24);
  assert.deepEqual(ap.janelas.h5, []);
  assert.equal(Object.getPrototypeOf(ap.semanas[0].modelos), Object.prototype);
});

// Regra da Task 3: um instante conta para a janela em (reset − duração,
// reset]; a tolerância só localiza a janela pelo reset. O carregador segue a
// mesma regra para o cruzou e o esgotou, e o reset vale até a duração mais a
// tolerância à frente de agora (a mesma conta do podar).
test('aprendizado.json forjado: instantes fora de (reset − duração, reset] e reset longe demais saem', () => {
  const d = novoDir();
  const H = 3_600_000;
  const reset = AGORA - D;
  const inicio = reset - 7 * D;
  const d7 = [
    { reset, max: 100, cruzou: { 60: inicio, 65: inicio + 1, 70: reset, 75: reset + 1 }, esgotou: reset + 1, disparou: true },
    { reset: reset - 7 * D, max: 50, cruzou: {}, esgotou: reset - 7 * D, disparou: false },
  ];
  const h5 = [
    { reset: AGORA + 5 * H + 600_000 + 1, max: 1 },
    { reset: AGORA + 5 * H, max: 2 },
  ];
  const fable = [{ reset: AGORA + 8 * D, max: 3 }, { reset: AGORA + 7 * D, max: 4 }];
  fs.writeFileSync(caminhos(d).aprendizado, JSON.stringify({ v: 1, desde: AGORA - 30 * D, sessoes: 1, semanas: [], janelas: { d7, h5, fable } }));
  const ap = lerAprendizado(d, AGORA);
  assert.deepEqual(ap.janelas.d7, [
    { reset: reset - 7 * D, max: 50, cruzou: {}, esgotou: reset - 7 * D, disparou: false },
    { reset, max: 100, cruzou: { 65: inicio + 1, 70: reset }, esgotou: null, disparou: true },
  ]);
  assert.deepEqual(ap.janelas.h5.map((j) => j.max), [2]);
  assert.deepEqual(ap.janelas.fable.map((j) => j.max), [4]);
});

test('aprendizado.json forjado: de janelas com reset dentro da tolerância, vale a primeira', () => {
  const d = novoDir();
  const r = AGORA - D;
  const d7 = [
    { reset: r + 600_001, max: 30 },
    { reset: r + 300_000, max: 20 },
    { reset: r, max: 10 },
  ];
  fs.writeFileSync(caminhos(d).aprendizado, JSON.stringify({ v: 1, desde: AGORA - 30 * D, sessoes: 0, semanas: [], janelas: { d7 } }));
  const ap = lerAprendizado(d, AGORA);
  assert.deepEqual(ap.janelas.d7.map((j) => [j.reset, j.max]), [[r, 10], [r + 600_001, 30]]);
});

// Revisão I1: a semana só vale com início numa segunda-feira que existe e
// que não está depois da semana de agora; o filtro vem antes do corte em
// SEMANAS_MAX, então uma semana forjada não toma a vaga de uma real nem a
// ponta que o perfilDe lê.
test('aprendizado.json forjado: semana futura, data que não existe ou fora de segunda sai', () => {
  const d = novoDir();
  const vazio = new Array(168).fill(0);
  const semana = (inicio) => ({ inicio, modelos: {}, ativo: vazio });
  const reais = [];
  for (let k = SEMANAS_MAX - 1; k >= 0; k--) reais.push(inicioSemana(AGORA - k * 7 * D));
  assert.equal(reais.at(-1), '2026-10-19');
  // 2099-01-05 é segunda, mas futura; 2026-10-13 é terça e 2026-09-31 não
  // existe, os dois no passado e dentro das 26 semanas.
  const forjadas = ['2099-01-05', '2026-99-99', '2026-10-20', '2026-10-13', '2026-09-31'];
  const semanas = [...reais.map(semana), ...forjadas.map(semana)];
  fs.writeFileSync(caminhos(d).aprendizado, JSON.stringify({ v: 1, desde: AGORA - 400 * D, sessoes: 0, semanas }));
  const ap = lerAprendizado(d, AGORA);
  assert.deepEqual(ap.semanas.map((s) => s.inicio), reais);
});

test('ajustes.json: vigentes fora da faixa voltam ao padrão, amarelo >= vermelho volta aos dois', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = 999;
  aj.vigentes['painel.amarelo'] = 85;
  aj.vigentes['painel.vermelho'] = 85;
  aj.vigentes['guarda.teto7d'] = 75;
  gravarAjustes(d, aj);
  const lido = lerAjustes(d, AGORA);
  assert.equal(lido.vigentes['painel.intervaloS'], 30);
  assert.equal(lido.vigentes['painel.amarelo'], 75);
  assert.equal(lido.vigentes['painel.vermelho'], 90);
  assert.equal(lido.vigentes['guarda.teto7d'], 75);
  assert.equal(lido.vigentes['guarda.fableTetoPct'], null);
});

test('Foco de revisão 4: registro de 2099 e bloqueio de 1 ano saem; bloqueio de 7 dias fica', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  aj.registros.push({ id: 'a1', item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: '2099-01-01T00:00:00Z', origem: 'auto' });
  aj.registros.push({ id: 'a2', item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: iso(AGORA - D), origem: 'auto' });
  aj.bloqueios['painel.amarelo'] = AGORA + 365 * D;
  aj.bloqueios['painel.intervaloS'] = AGORA + 7 * D;
  aj.bloqueios['coisa.qualquer; rm'] = AGORA + D;
  gravarAjustes(d, aj);
  const lido = lerAjustes(d, AGORA);
  assert.deepEqual(lido.registros.map((r) => r.id), ['a2']);
  assert.deepEqual(lido.bloqueios, { 'painel.intervaloS': AGORA + 7 * D });
  assert.equal(lido.seq, 2);
});

test('ajustes.json acima de 64 KiB: os registros mais antigos saem primeiro', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  for (let i = 1; i <= 200; i++) {
    aj.registros.push({ id: `a${i}`, item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: iso(AGORA - (201 - i) * 60_000), origem: 'auto' });
  }
  // Chaves longas demais para valer na leitura, mas a gravação não as
  // confere: 50 × ~620 bytes empurram o arquivo acima de 64 KiB.
  for (let i = 0; i < 50; i++) aj.bloqueios[`modelo:${'m'.repeat(600)}${i}`] = AGORA + D;
  aj.seq = 200;
  assert.equal(gravarAjustes(d, aj).ok, true);
  assert.ok(fs.statSync(caminhos(d).ajustes).size <= TETO.ajustes);
  const lido = lerAjustes(d, AGORA);
  assert.ok(lido.registros.length < 200);
  assert.equal(lido.registros.at(-1).id, 'a200');
});

test('sugestoes.json: ida e volta; afrouxar que não afrouxa e modelo com nome estranho saem', () => {
  const d = novoDir();
  const sug = sugestoesVazias();
  sug.seq = 3;
  sug.lista.push({ id: 's1', estado: 'pendente', em: iso(AGORA - D), tipo: 'afrouxar', item: 'guarda.teto7d', de: 75, para: 80 });
  sug.lista.push({ id: 's2', estado: 'pendente', em: iso(AGORA - D), tipo: 'afrouxar', item: 'guarda.teto7d', de: 80, para: 75 });
  sug.lista.push({ id: 's3', estado: 'pendente', em: iso(AGORA - D), tipo: 'modelo', origem: 'principal', de: { modelo: 'x y', effort: 'high' }, para: { modelo: 'b', effort: 'high' }, razao: 3, erroDe: 1, erroPara: 2 });
  sug.lista.push({ id: 's4', estado: 'aprovada', em: iso(AGORA - D), tipo: 'modelo', origem: 'sub:revisor', de: { modelo: 'a', effort: 'high' }, para: { modelo: 'b', effort: '-' }, razao: 3.5, erroDe: 1, erroPara: 1.5 });
  gravarSugestoes(d, sug);
  const lido = lerSugestoes(d, AGORA);
  assert.deepEqual(lido.lista.map((s) => s.id), ['s1', 's4']);
  assert.equal(lido.seq, 4);
});

test('cursor, eventos (50 no máximo) e ligado.json', () => {
  const d = novoDir();
  const c = cursorVazio();
  c.arquivo = { ino: '123', pos: 10 };
  c.historicoAte = AGORA - 1000;
  c.anuncio = { dia: '2026-10-20', ajustes: 3, sugestoes: 1 };
  c.avisos['porta-ocupada'] = '2026-10-20';
  c.fora['guarda.teto7d'] = '2026-10-20';
  gravarCursor(d, c);
  assert.deepEqual(lerCursor(d, AGORA), c);
  gravarCursor(d, { ...c, fora: { 'guarda.teto7d': 'ontem', 'item.inventado': '2026-10-20', 'painel.amarelo': '2026-10-19' } });
  assert.deepEqual(lerCursor(d, AGORA).fora, { 'painel.amarelo': '2026-10-19' }, 'só itens de ITENS com dia válido');
  gravarCursor(d, c);
  for (let i = 0; i < 60; i++) anexarEventoApr(d, 'porta-ocupada', AGORA + i);
  anexarEventoApr(d, 'inventado', AGORA);
  const ev = lerEventosApr(d, AGORA + 100);
  assert.equal(ev.length, 50);
  assert.ok(ev.every((e) => e.tipo === 'porta-ocupada'));
  assert.equal(lerLigado(d), null);
  assert.equal(ligadoExiste(d), false);
  fs.mkdirSync(path.join(d, 'otel'));
  gravarLigado(d, { chaves: { OTEL_LOGS_EXPORTER: 'otlp', 'rm -rf': 'x', OTEL_X: 'a b' }, criouEnv: true }, AGORA);
  assert.deepEqual(lerLigado(d), { chaves: { OTEL_LOGS_EXPORTER: 'otlp' }, criouEnv: true });
  assert.equal(ligadoExiste(d), true);
  apagarLigado(d);
  assert.equal(ligadoExiste(d), false);
});

test('Foco de revisão 3: a trava deixa um passo por vez; trava velha é retomada', () => {
  const d = novoDir();
  const a = pegarTrava(d);
  assert.equal(a.ok, true);
  const b = pegarTrava(d);
  assert.deepEqual(b, { ok: false, motivo: 'ocupada' });
  a.soltar();
  const c = pegarTrava(d);
  assert.equal(c.ok, true);
  const velho = (Date.now() - 10 * 60_000) / 1000;
  fs.utimesSync(caminhos(d).trava, velho, velho);
  const e = pegarTrava(d);
  assert.equal(e.ok, true);
  e.soltar();
});

test('a trava retomada não é solta pelo dono antigo', () => {
  const d = novoDir();
  const velhoDono = pegarTrava(d);
  assert.equal(velhoDono.ok, true);
  const velho = (Date.now() - 10 * 60_000) / 1000;
  fs.utimesSync(caminhos(d).trava, velho, velho);
  const novoDono = pegarTrava(d);
  assert.equal(novoDono.ok, true);
  velhoDono.soltar();
  assert.equal(fs.existsSync(caminhos(d).trava), true);
  assert.deepEqual(pegarTrava(d), { ok: false, motivo: 'ocupada' });
  novoDono.soltar();
  assert.equal(fs.existsSync(caminhos(d).trava), false);
});

// Revisão I3: dois passos veem a mesma trava vencida. A retomada renomeia a
// trava para um nome único antes de apagar; quem chega tarde (o arquivo já é
// a trava nova de outro) não leva nada e a devolve intacta, e quem perde o
// rename (ENOENT) não apaga nada.
test('a retomada que chega tarde não leva a trava nova de outro passo', () => {
  const d = novoDir();
  const arq = caminhos(d).trava;
  fs.writeFileSync(arq, 'morto');
  const velho = (Date.now() - 10 * 60_000) / 1000;
  fs.utimesSync(arq, velho, velho);
  // A e B leram o mtime vencido. A retoma primeiro; B perde o rename.
  assert.equal(_retomarTravaVencida(arq), true);
  assert.equal(fs.existsSync(arq), false);
  assert.equal(_retomarTravaVencida(arq), false);
  assert.equal(fs.existsSync(arq), false);
  // A cria a trava nova; B, atrasado, tenta retomar o que viu vencido.
  const a = pegarTrava(d);
  assert.equal(a.ok, true);
  const conteudo = fs.readFileSync(arq, 'utf8');
  assert.equal(_retomarTravaVencida(arq), false);
  assert.equal(fs.readFileSync(arq, 'utf8'), conteudo);
  assert.deepEqual(pegarTrava(d), { ok: false, motivo: 'ocupada' });
  a.soltar();
  assert.equal(fs.existsSync(arq), false);
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.startsWith('aprendizado.lock')), []);
});

test('gravarCursor nunca lança', () => {
  assert.deepEqual(gravarCursor(undefined, cursorVazio()), { ok: false });
  assert.deepEqual(gravarCursor(novoDir(), null), { ok: true });
});

test('consumidores: sem ligado.json nada vale; com ele, intervalo fora das horas ativas, faixas e peso', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = 120;
  aj.vigentes['painel.amarelo'] = 70;
  aj.vigentes['previsao.pesoPerfil'] = 0.3;
  aj.perfil.ritmoHora.h5[15] = 0.2;
  const hoje = new Date(AGORA);
  const dia = (hoje.getDay() + 6) % 7;
  // Uma hora ativa que não é a de agora: sem nenhuma, o intervalo não vale.
  aj.perfil.horasAtivas[dia] = 1 << ((hoje.getHours() + 1) % 24);
  gravarAjustes(d, aj);
  assert.equal(ajustesParaConsumo(d, AGORA), null);
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  assert.deepEqual(faixasDoPainel(d, AGORA), { amarelo: 75, vermelho: 90 });
  assert.equal(perfilDaPrevisao(d, AGORA), null);
  ligar(d);
  assert.equal(intervaloDoPainelMs(d, AGORA), 120_000);
  assert.deepEqual(faixasDoPainel(d, AGORA), { amarelo: 70, vermelho: 90 });
  assert.equal(perfilDaPrevisao(d, AGORA).peso, 0.3);
  assert.equal(perfilDaPrevisao(d, AGORA).h5[15], 0.2);
  aj.perfil.horasAtivas[dia] = 1 << hoje.getHours();
  gravarAjustes(d, aj);
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  fs.writeFileSync(caminhos(d).ajustes, 'quebrado');
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  assert.deepEqual(faixasDoPainel(d, AGORA), { amarelo: 75, vermelho: 90 });
});

// Rodada 2 da revisão da Task 12: a marca de sessão encerrada
// (otel/encerradas/<hex do id>), arquivo vazio com a data do fim.
const hex = (id) => Buffer.from(id, 'utf8').toString('hex');
const pastaEnc = (d) => path.join(caminhos(d).otel, 'encerradas');
function marcaCrua(d, nome, ms, conteudo = '') {
  fs.mkdirSync(pastaEnc(d), { recursive: true });
  const arq = path.join(pastaEnc(d), nome);
  fs.writeFileSync(arq, conteudo);
  fs.utimesSync(arq, ms / 1000, ms / 1000);
  return arq;
}

test('rodada 2: marcarEncerrada, lerEncerradas e desmarcarEncerrada', () => {
  const d = novoDir();
  assert.deepEqual([...lerEncerradas(d, AGORA)], [], 'sem pasta: vazio');
  assert.equal(marcarEncerrada(d, 'sessao-a', AGORA - 1000).ok, true);
  assert.equal(marcarEncerrada(d, 'sessao-b', AGORA - 2000).ok, true);
  assert.equal(marcarEncerrada(d, 'sessao-a', AGORA).ok, true, 'marcar de novo renova a data');
  const m = lerEncerradas(d, AGORA);
  assert.equal(m.get('sessao-a'), AGORA);
  assert.equal(m.get('sessao-b'), AGORA - 2000);
  assert.equal(m.size, 2);
  desmarcarEncerrada(d, 'sessao-a');
  desmarcarEncerrada(d, 'nunca-marcada');
  assert.deepEqual([...lerEncerradas(d, AGORA).keys()], ['sessao-b']);
  assert.equal(marcarEncerrada(d, '../fora', AGORA).ok, false);
  assert.equal(marcarEncerrada(d, 'x', Number.NaN).ok, false);
  assert.doesNotThrow(() => desmarcarEncerrada(d, '../fora'));
  assert.deepEqual(fs.readdirSync(pastaEnc(d)), [hex('sessao-b')]);
});

test('rodada 2: marca hostil (pasta, link, conteúdo, nome alheio, data fora) não vale e nada lança', () => {
  const d = novoDir();
  fs.mkdirSync(path.join(pastaEnc(d), hex('pasta')), { recursive: true });
  marcaCrua(d, hex('cheia'), AGORA - 1000, 'x'.repeat(4096));
  marcaCrua(d, hex('um-byte'), AGORA - 1000, '1');
  marcaCrua(d, 'zz', AGORA - 1000);
  marcaCrua(d, 'abc.txt', AGORA - 1000);
  marcaCrua(d, hex('sessao').toUpperCase(), AGORA - 1000);
  marcaCrua(d, hex('a b'), AGORA - 1000);
  marcaCrua(d, hex('../x'), AGORA - 1000);
  marcaCrua(d, hex('constructor'), AGORA - 1000);
  marcaCrua(d, hex('futura'), AGORA + 10 * 60_000);
  marcaCrua(d, hex('velha'), AGORA - ENCERRADA_MAX_MS - 60_000);
  marcaCrua(d, hex('boa'), AGORA - 1000);
  try {
    fs.symlinkSync(path.join(pastaEnc(d), hex('boa')), path.join(pastaEnc(d), hex('link')));
  } catch { /* sem permissão de link no Windows: o caso fica de fora */ }
  const m = lerEncerradas(d, AGORA);
  assert.deepEqual([...m], [['boa', AGORA - 1000]]);
  // Marcar sobre uma pasta com o nome da sessão: falha, sem lançar.
  assert.equal(marcarEncerrada(d, 'pasta', AGORA).ok, false);
  assert.ok(fs.lstatSync(path.join(pastaEnc(d), hex('pasta'))).isDirectory());
  desmarcarEncerrada(d, 'pasta');
  assert.ok(fs.lstatSync(path.join(pastaEnc(d), hex('pasta'))).isDirectory(), 'desmarcar não apaga pasta');
  // A marca vencida sai na próxima marcação (poda).
  assert.equal(marcarEncerrada(d, 'nova', AGORA).ok, true);
  assert.equal(fs.existsSync(path.join(pastaEnc(d), hex('velha'))), false);
  assert.equal(fs.existsSync(path.join(pastaEnc(d), 'zz')), true, 'nome alheio fica');
});

test('rodada 2: encerradas que é arquivo ou estado sem pasta otel: vazio, marcar falha, nada lança', () => {
  const d = novoDir();
  fs.mkdirSync(caminhos(d).otel, { recursive: true });
  fs.writeFileSync(pastaEnc(d), 'não sou pasta');
  assert.equal(lerEncerradas(d, AGORA).size, 0);
  assert.equal(marcarEncerrada(d, 'sessao-a', AGORA).ok, false);
  assert.doesNotThrow(() => desmarcarEncerrada(d, 'sessao-a'));
  assert.equal(fs.readFileSync(pastaEnc(d), 'utf8'), 'não sou pasta');
  assert.equal(lerEncerradas(path.join(d, 'nao-existe'), AGORA).size, 0);
  assert.equal(lerEncerradas(null, AGORA).size, 0);
  assert.equal(lerEncerradas(d, Number.NaN).size, 0);
});

test('rodada 2: lerEncerradas lê no máximo ENCERRADAS_LER_MAX entradas', () => {
  const d = novoDir();
  for (let i = 0; i < ENCERRADAS_LER_MAX + 40; i++) marcaCrua(d, hex(`s${i}`), AGORA - 1000);
  const m = lerEncerradas(d, AGORA);
  assert.ok(m.size > 0 && m.size <= ENCERRADAS_LER_MAX, `lidas: ${m.size}`);
});

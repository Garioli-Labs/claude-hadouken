import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aprendizadoVazio, inicioSemana, slotDaSemana, agregarRegistros, agregarHistorico, atualizarJanela, marcarNaJanela,
  marcarSessao, perfilDe, podar, CAMPOS_MODELO, SEMANAS_MAX, MODELOS_SEMANA_MAX, JANELAS_MAX,
} from '../src/aprendizado/agregar.js';

// Horário local: 5 de outubro de 2026 é uma segunda-feira.
const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const H = 3_600_000;
const req = (em, extra = {}) => ({
  t: 'req', em, modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', custo: 0.5, entrada: 100, saida: 10,
  cacheLeitura: 1000, cacheEscrita: 5, duracaoMs: 2000, ttftMs: 700, ...extra,
});

test('semana começa na segunda-feira local e o slot conta de segunda 0h', () => {
  assert.equal(inicioSemana(local(8, 15)), '2026-10-05');
  assert.equal(inicioSemana(local(11, 23)), '2026-10-05');
  assert.equal(inicioSemana(local(12, 0)), '2026-10-12');
  assert.equal(slotDaSemana(local(5, 0)), 0);
  assert.equal(slotDaSemana(local(11, 23)), 167);
  assert.equal(slotDaSemana(local(6, 10)), 34);
});

test('agregarRegistros soma por modelo·effort·origem e o tempo ativo por slot', () => {
  const ap = aprendizadoVazio(local(5, 0));
  agregarRegistros(ap, [
    req(local(6, 10)), req(local(6, 10, 5), { ttftMs: null, duracaoMs: null }),
    { t: 'erro', em: local(6, 10, 6), modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal' },
    { t: 'ferramenta', em: local(6, 10, 7), modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', ok: true },
    { t: 'ferramenta', em: local(6, 10, 8), modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', ok: false },
    { t: 'ativo', em: local(6, 10, 9), segundos: 90 },
  ]);
  assert.equal(ap.semanas.length, 1);
  const s = ap.semanas[0];
  assert.equal(CAMPOS_MODELO.length, 12);
  assert.deepEqual(s.modelos['claude-sonnet-5-5|high|principal'], [2, 1, 200, 20, 2000, 10, 2000, 700, 1, 1, 2, 1]);
  assert.equal(s.ativo[34], 1.5);
});

test('no máximo 40 chaves de modelo por semana', () => {
  const ap = aprendizadoVazio(local(5, 0));
  agregarRegistros(ap, Array.from({ length: 45 }, (_, i) => req(local(6, 10), { modelo: `modelo-${i}` })));
  assert.equal(Object.keys(ap.semanas[0].modelos).length, MODELOS_SEMANA_MAX);
});

test('agregarHistorico: ritmo por hora em pp/min, sem reset e sem buraco, e 2 min de atividade por ponto novo', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const t0 = local(6, 14);
  const pontos = [
    { at: new Date(t0).toISOString(), h5: 10, d7: 40 },
    { at: new Date(t0 + 2 * 60_000).toISOString(), h5: 12, d7: 40.5 },
    { at: new Date(t0 + 4 * 60_000).toISOString(), h5: 14, d7: 41 },
    { at: new Date(t0 + 6 * 60_000).toISOString(), h5: 1, d7: 41 },
    { at: new Date(t0 + 30 * 60_000).toISOString(), h5: 9, d7: 42 },
  ];
  const ate = agregarHistorico(ap, pontos, t0);
  assert.equal(ate, t0 + 30 * 60_000);
  assert.deepEqual(ap.ritmo.h5[14], [2, 2]);
  assert.deepEqual(ap.ritmo.d7[14], [0.5, 3]);
  assert.equal(ap.semanas[0].ativo[slotDaSemana(t0)], 8);
  assert.equal(agregarHistorico(ap, pontos, ate), ate);
  assert.deepEqual(ap.ritmo.h5[14], [2, 2]);
});

test('agregarHistorico: pontos com o mesmo instante contam a atividade uma vez só', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const t0 = local(6, 14);
  const pontos = [
    { at: new Date(t0).toISOString(), h5: 10, d7: 40 },
    { at: new Date(t0).toISOString(), h5: 10, d7: 40 },
    { at: new Date(t0 + 2 * 60_000).toISOString(), h5: 12, d7: 40 },
    { at: new Date(t0 + 2 * 60_000).toISOString(), h5: 12, d7: 40 },
  ];
  assert.equal(agregarHistorico(ap, pontos, t0 - 1), t0 + 2 * 60_000);
  assert.equal(ap.semanas[0].ativo[slotDaSemana(t0)], 4);
  assert.deepEqual(ap.ritmo.h5[14], [1, 1]);
  assert.deepEqual(ap.ritmo.d7[14], [0, 1]);
});

test('atualizarJanela: máximo, limiares cruzados, esgotou; outra janela pelo reset', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(6, 15);
  atualizarJanela(ap, 'h5', { pct: 55, resetMs: reset, emMs: reset - 4 * H });
  atualizarJanela(ap, 'h5', { pct: 62, resetMs: reset, emMs: reset - 3 * H });
  atualizarJanela(ap, 'h5', { pct: 81, resetMs: reset + 60_000, emMs: reset - 2 * H });
  atualizarJanela(ap, 'h5', { pct: 100, resetMs: reset, emMs: reset - H });
  assert.equal(ap.janelas.h5.length, 1);
  const j = ap.janelas.h5[0];
  assert.equal(j.max, 100);
  assert.equal(j.cruzou['60'], reset - 3 * H);
  assert.equal(j.cruzou['80'], reset - 2 * H);
  assert.equal(j.cruzou['95'], reset - H);
  assert.equal(j.esgotou, reset - H);
  atualizarJanela(ap, 'h5', { pct: 5, resetMs: reset + 5 * H, emMs: reset + H });
  assert.equal(ap.janelas.h5.length, 2);
  const antes = structuredClone(ap.janelas.h5);
  atualizarJanela(ap, 'h5', { pct: 50, resetMs: reset, emMs: reset + 1 });
  // Leitura depois do reset da janela: ignorada, nenhuma das duas muda.
  assert.deepEqual(ap.janelas.h5, antes);
});

test('atualizarJanela: leitura depois do reset não cria janela vazia', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(6, 15);
  atualizarJanela(ap, 'h5', { pct: 50, resetMs: reset, emMs: reset + 60_000 });
  assert.deepEqual(ap.janelas.h5, []);
});

test('atualizarJanela e marcarNaJanela usam a mesma borda: o reset entra, depois dele não', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(6, 15);
  atualizarJanela(ap, 'h5', { pct: 10, resetMs: reset, emMs: reset - H });
  atualizarJanela(ap, 'h5', { pct: 61, resetMs: reset, emMs: reset + 1 });
  marcarNaJanela(ap, 'h5', reset + 1, 'disparou');
  marcarNaJanela(ap, 'h5', reset + 1, 'esgotou');
  assert.deepEqual(ap.janelas.h5, [{ reset, max: 10, cruzou: {}, esgotou: null, disparou: false }]);
  atualizarJanela(ap, 'h5', { pct: 61, resetMs: reset, emMs: reset });
  marcarNaJanela(ap, 'h5', reset, 'disparou');
  assert.deepEqual(ap.janelas.h5, [{ reset, max: 61, cruzou: { 60: reset }, esgotou: null, disparou: true }]);
});

test('atualizarJanela: fora de ordem, cruzou e esgotou guardam o menor instante', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(6, 15);
  atualizarJanela(ap, 'h5', { pct: 70, resetMs: reset, emMs: reset - H });
  atualizarJanela(ap, 'h5', { pct: 65, resetMs: reset, emMs: reset - 3 * H });
  atualizarJanela(ap, 'h5', { pct: 100, resetMs: reset, emMs: reset - H / 2 });
  atualizarJanela(ap, 'h5', { pct: 100, resetMs: reset, emMs: reset - 2 * H });
  const j = ap.janelas.h5[0];
  assert.equal(j.cruzou['60'], reset - 3 * H);
  assert.equal(j.cruzou['65'], reset - 3 * H);
  assert.equal(j.cruzou['70'], reset - 2 * H);
  assert.equal(j.cruzou['95'], reset - 2 * H);
  assert.equal(j.esgotou, reset - 2 * H);
});

test('marcarNaJanela põe disparo e esgotamento na janela que contém o instante', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(12, 22);
  atualizarJanela(ap, 'fable', { pct: 40, resetMs: reset, emMs: reset - 3 * 24 * H });
  // Fora da janela (depois do reset e antes do início): nada muda.
  marcarNaJanela(ap, 'fable', reset + H, 'disparou');
  marcarNaJanela(ap, 'fable', reset + H, 'esgotou');
  marcarNaJanela(ap, 'fable', reset - 8 * 24 * H, 'disparou');
  assert.deepEqual(ap.janelas.fable[0], { reset, max: 40, cruzou: {}, esgotou: null, disparou: false });
  marcarNaJanela(ap, 'fable', reset - 2 * 24 * H, 'disparou');
  marcarNaJanela(ap, 'fable', reset - 24 * H, 'esgotou');
  // A janela recebeu 40%: nenhum limiar cruzado; o esgotamento põe o máximo em 100.
  assert.deepEqual(ap.janelas.fable[0], { reset, max: 100, cruzou: {}, esgotou: reset - 24 * H, disparou: true });
});

test('perfilDe: hora ativa em pelo menos metade das últimas 4 semanas; ritmo só com 3 amostras', () => {
  const ap = aprendizadoVazio(local(5, 0));
  for (const d of [5, 12, 19, 26]) agregarRegistros(ap, [{ t: 'ativo', em: local(d, 23, 59), segundos: 1 }]);
  agregarRegistros(ap, [{ t: 'ativo', em: local(5, 10), segundos: 600 }, { t: 'ativo', em: local(12, 10), segundos: 600 }]);
  agregarRegistros(ap, [{ t: 'ativo', em: local(19, 11), segundos: 600 }]);
  ap.ritmo.h5[10] = [3, 3];
  ap.ritmo.h5[11] = [2, 2];
  const p = perfilDe(ap);
  assert.equal(p.horasAtivas[0], 1 << 10);
  assert.deepEqual(p.horasAtivas.slice(1), [0, 0, 0, 0, 0, 0]);
  assert.equal(p.ritmoHora.h5[10], 1);
  assert.equal(p.ritmoHora.h5[11], null);
});

test('marcarSessao conta a sessão e 5 min de atividade', () => {
  const ap = aprendizadoVazio(local(5, 0));
  marcarSessao(ap, local(6, 10));
  marcarSessao(ap, local(6, 10, 30));
  assert.equal(ap.sessoes, 2);
  assert.equal(ap.semanas[0].ativo[34], 10);
});

test('podar: 26 semanas, tetos de janelas e janela com reset longe demais', () => {
  const ap = aprendizadoVazio(local(5, 0));
  for (let i = 0; i < 30; i++) agregarRegistros(ap, [req(local(5, 10) - i * 7 * 24 * H)]);
  for (let i = 0; i < 70; i++) atualizarJanela(ap, 'h5', { pct: 10, resetMs: local(5, 10) - i * 5 * H, emMs: local(5, 10) - i * 5 * H - H });
  ap.janelas.d7.push({ reset: local(5, 10) + 30 * 24 * H, max: 1, cruzou: {}, esgotou: null, disparou: false });
  podar(ap, local(5, 10));
  assert.equal(ap.semanas.length, SEMANAS_MAX);
  assert.equal(ap.semanas.at(-1).inicio, '2026-10-05');
  assert.equal(ap.janelas.h5.length, JANELAS_MAX.h5);
  assert.equal(ap.janelas.d7.length, 0);
});

test('podar: semana com mais de 40 modelos fica com os 40 de mais pedidos', () => {
  const ap = aprendizadoVazio(local(5, 0));
  agregarRegistros(ap, [req(local(6, 10))]);
  const s = ap.semanas[0];
  s.modelos = {};
  for (let i = 0; i < 45; i++) {
    const v = new Array(CAMPOS_MODELO.length).fill(0);
    v[0] = i;
    s.modelos[`modelo-${i}|-|outro`] = v;
  }
  podar(ap, local(6, 10));
  const modelos = ap.semanas[0].modelos;
  assert.equal(Object.keys(modelos).length, MODELOS_SEMANA_MAX);
  for (let i = 0; i < 5; i++) assert.equal(Object.hasOwn(modelos, `modelo-${i}|-|outro`), false);
  for (let i = 5; i < 45; i++) assert.equal(modelos[`modelo-${i}|-|outro`][0], i);
});

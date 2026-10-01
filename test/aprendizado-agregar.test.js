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
  atualizarJanela(ap, 'h5', { pct: 50, resetMs: reset, emMs: reset + 1 });
  assert.equal(ap.janelas.h5.length, 2);
});

test('marcarNaJanela põe disparo e esgotamento na janela que contém o instante', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(12, 22);
  atualizarJanela(ap, 'fable', { pct: 40, resetMs: reset, emMs: reset - 3 * 24 * H });
  marcarNaJanela(ap, 'fable', reset - 2 * 24 * H, 'disparou');
  marcarNaJanela(ap, 'fable', reset - 24 * H, 'esgotou');
  marcarNaJanela(ap, 'fable', reset + H, 'disparou');
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

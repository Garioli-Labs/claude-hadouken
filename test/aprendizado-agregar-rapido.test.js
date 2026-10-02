import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aprendizadoVazio, agregarRegistros } from '../src/aprendizado/agregar.js';
import { agregarRegistros as referencia } from './fixtures/agregar-referencia.mjs';

// agregarRegistros otimizado (revisão da Task 12, desempenho: dia local do
// último registro, chave do último registro e contagem de chaves por
// semana) tem de dar exatamente o mesmo que o original, congelado em
// test/fixtures/agregar-referencia.mjs. Registros fora de ordem, perto da
// meia-noite, em várias semanas, acima de MODELOS_SEMANA_MAX chaves, e em
// fusos com horário de verão (processo filho com TZ própria).

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Gera os registros e compara os dois agregadores; devolve null se iguais,
// ou a descrição da diferença. Roda aqui e no processo filho (o texto da
// função vai no -e).
function comparar(agregar, ref, aprendizadoVazio, inicioMs, semente) {
  let a = semente >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const um = (xs) => xs[Math.floor(r() * xs.length)];
  const H = 3_600_000;
  const modelos = Array.from({ length: 30 }, (_, i) => `claude-modelo-${i}`);
  const registros = [];
  let em = inicioMs;
  for (let i = 0; i < 6000; i++) {
    // Em geral para a frente, de minutos a horas; às vezes um salto para
    // trás ou para outra semana.
    const x = r();
    if (x < 0.05) em -= Math.floor(r() * 30 * H);
    else if (x < 0.08) em += Math.floor(r() * 9 * 24 * H);
    else if (x < 0.14) {
      // A meia-noite local seguinte exata, ou o último ms antes dela.
      const d = new Date(em);
      em = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - (r() < 0.5 ? 1 : 0);
    } else em += Math.floor(r() * 50 * 60_000);
    const base = { em, modelo: um(modelos.slice(0, r() < 0.7 ? 3 : 30)), effort: um(['high', 'xhigh', '-']), origem: um(['principal', 'sub', 'sub:a']) };
    const t = um(['req', 'req', 'req', 'erro', 'ferramenta', 'ativo']);
    if (t === 'ativo') registros.push({ t, em, segundos: Math.floor(r() * 900) });
    else if (t === 'req') {
      registros.push({
        ...base, t, custo: r(), entrada: 100, saida: 10, cacheLeitura: 1000, cacheEscrita: 5,
        duracaoMs: r() < 0.2 ? null : 2000, ttftMs: r() < 0.2 ? null : 700,
      });
    } else if (t === 'erro') registros.push({ ...base, t });
    else registros.push({ ...base, t, ok: r() < 0.7 });
  }
  // Uma semana já com chaves (vinda do aprendizado.json), perto do teto.
  const inicial = () => {
    const ap = aprendizadoVazio(inicioMs);
    ref(ap, registros.slice(0, 40).map((x) => ({ ...x, modelo: `claude-antigo-${x.em % 37}` })));
    return ap;
  };
  const novo = agregar(inicial(), registros);
  const esperado = ref(inicial(), registros);
  const j1 = JSON.stringify(novo);
  const j2 = JSON.stringify(esperado);
  if (j1 === j2) return null;
  let i = 0;
  while (i < j1.length && j1[i] === j2[i]) i++;
  return `diferem em ${i}: ${j1.slice(Math.max(0, i - 80), i + 80)} | ${j2.slice(Math.max(0, i - 80), i + 80)}`;
}

test('agregarRegistros otimizado dá o mesmo que o original (fuso desta máquina)', () => {
  for (const semente of [1, 2, 3]) {
    const r = comparar(agregarRegistros, referencia, aprendizadoVazio, new Date(2026, 8, 20, 22).getTime(), semente);
    assert.equal(r, null);
  }
});

test('agregarRegistros otimizado dá o mesmo que o original em fusos com horário de verão (processo filho com TZ)', () => {
  const agregar = pathToFileURL(path.join(AQUI, '..', 'src', 'aprendizado', 'agregar.js')).href;
  const ref = pathToFileURL(path.join(AQUI, 'fixtures', 'agregar-referencia.mjs')).href;
  // Dias antes de uma mudança de horário de 2026 em cada fuso.
  const casos = [
    ['America/New_York', '2026-03-06T00:00:00Z'], ['America/New_York', '2026-10-30T00:00:00Z'],
    ['Europe/London', '2026-03-27T00:00:00Z'], ['Europe/London', '2026-10-23T00:00:00Z'],
    ['Australia/Lord_Howe', '2026-04-03T00:00:00Z'], ['Australia/Lord_Howe', '2026-10-02T00:00:00Z'],
    ['America/Sao_Paulo', '2026-10-30T00:00:00Z'],
  ];
  for (const [tz, desde] of casos) {
    const codigo = `
      const { aprendizadoVazio, agregarRegistros } = await import(${JSON.stringify(agregar)});
      const { agregarRegistros: referencia } = await import(${JSON.stringify(ref)});
      ${comparar.toString()}
      const r = comparar(agregarRegistros, referencia, aprendizadoVazio, Date.parse(${JSON.stringify(desde)}), 7);
      process.stdout.write(r === null ? 'igual' : r);
    `;
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], {
      env: { ...process.env, TZ: tz, HADOUKEN_SEM_PAINEL: '1' }, encoding: 'utf8',
    });
    assert.equal(p.status, 0, `${tz}: ${p.stderr}`);
    assert.equal(p.stdout, 'igual', tz);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRitmo } from '../src/ritmo.js';

const H = 3600_000;
const reset = 1_800_000_000; // epoch s
const inicioMs = reset * 1000 - 168 * H;

const casos = [
  { nome: 'início da janela', usado: 0, agora: inicioMs, esperado: 0, desvio: 0, modo: 'normal' },
  { nome: 'meio da janela no ritmo', usado: 50, agora: inicioMs + 84 * H, esperado: 50, desvio: 0, modo: 'normal' },
  { nome: 'exatamente +10 é normal', usado: 60, agora: inicioMs + 84 * H, esperado: 50, desvio: 10, modo: 'normal' },
  { nome: '+10.1 é econômico', usado: 60.1, agora: inicioMs + 84 * H, esperado: 50, desvio: 10.1, modo: 'economico' },
  { nome: 'exatamente -10 é normal', usado: 40, agora: inicioMs + 84 * H, esperado: 50, desvio: -10, modo: 'normal' },
  { nome: '-10.5 é folga', usado: 39.5, agora: inicioMs + 84 * H, esperado: 50, desvio: -10.5, modo: 'folga' },
  { nome: 'relógio antes da janela: clamp 0', usado: 5, agora: inicioMs - 5 * H, esperado: 0, desvio: 5, modo: 'normal' },
  { nome: 'depois do reset: clamp 100', usado: 80, agora: reset * 1000 + H, esperado: 100, desvio: -20, modo: 'folga' },
];

for (const c of casos) {
  test(`calcularRitmo: ${c.nome}`, () => {
    assert.deepEqual(
      calcularRitmo({ usado7d: c.usado, resetsAt7d: reset, agoraMs: c.agora }),
      { esperado: c.esperado, desvio: c.desvio, modo: c.modo },
    );
  });
}

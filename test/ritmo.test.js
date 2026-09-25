import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRitmo, LIMIAR_PONTOS } from '../src/ritmo.js';

const H = 3600_000;
const reset = 1_800_000_000; // epoch s
const inicioMs = reset * 1000 - 168 * H;
// Momento em que o esperado é 50,4 (os casos da revisão da Task 5, M-2).
const agora504 = inicioMs + 0.504 * 168 * H;

// O modo sai dos inteiros exibidos: piso de usado menos piso de esperado,
// contra ±LIMIAR_PONTOS (M-2 e N-5). `desvio` é essa distância inteira.
const casos = [
  { nome: 'início da janela', usado: 0, agora: inicioMs, esperado: 0, desvio: 0, modo: 'normal' },
  { nome: 'meio da janela no ritmo', usado: 50, agora: inicioMs + 84 * H, esperado: 50, desvio: 0, modo: 'normal' },
  { nome: 'exatamente +10 é normal', usado: 60, agora: inicioMs + 84 * H, esperado: 50, desvio: 10, modo: 'normal' },
  { nome: '60,1% aparece como 60%: +10, normal', usado: 60.1, agora: inicioMs + 84 * H, esperado: 50, desvio: 10, modo: 'normal' },
  { nome: '+11 é econômico', usado: 61, agora: inicioMs + 84 * H, esperado: 50, desvio: 11, modo: 'economico' },
  { nome: 'exatamente -10 é normal', usado: 40, agora: inicioMs + 84 * H, esperado: 50, desvio: -10, modo: 'normal' },
  { nome: '39,5% aparece como 39%: -11, folga', usado: 39.5, agora: inicioMs + 84 * H, esperado: 50, desvio: -11, modo: 'folga' },
  { nome: 'M-2: 60,5% contra 50,4% é 60/50, normal', usado: 60.5, agora: agora504, esperado: 50.4, desvio: 10, modo: 'normal' },
  { nome: 'M-2: 60,99% contra 50,4% é 60/50, normal', usado: 60.99, agora: agora504, esperado: 50.4, desvio: 10, modo: 'normal' },
  { nome: 'M-2: 61% contra 50,4% é 61/50, econômico', usado: 61, agora: agora504, esperado: 50.4, desvio: 11, modo: 'economico' },
  { nome: 'M-2: 40,3% contra 50,4% é 40/50, normal', usado: 40.3, agora: agora504, esperado: 50.4, desvio: -10, modo: 'normal' },
  { nome: 'M-2: 39,99% contra 50,4% é 39/50, folga', usado: 39.99, agora: agora504, esperado: 50.4, desvio: -11, modo: 'folga' },
  { nome: 'relógio antes da janela: clamp 0', usado: 5, agora: inicioMs - 5 * H, esperado: 0, desvio: 5, modo: 'normal' },
  { nome: 'depois do reset: clamp 100', usado: 80, agora: reset * 1000 + H, esperado: 100, desvio: -20, modo: 'folga' },
];

test('calcularRitmo: o limiar de 7d é um só, 10 pontos', () => {
  assert.equal(LIMIAR_PONTOS, 10);
});

for (const c of casos) {
  test(`calcularRitmo: ${c.nome}`, () => {
    assert.deepEqual(
      calcularRitmo({ usado7d: c.usado, resetsAt7d: reset, agoraMs: c.agora }),
      { esperado: c.esperado, desvio: c.desvio, modo: c.modo },
    );
  });
}

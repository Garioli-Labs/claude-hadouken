process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avancarUteis, minutosUteis } from '../src/janela.js';

// J4: dia de troca de horário. Em 1/11/2026 (fim do horário de verão em Nova
// York) o dia local tem 25 h: das 00:00 às 12:00 locais passam 13 h reais.
// A janela de domingo 00:00-12:00 vale 780 min, não 720.
test('J4: minutosUteis conta o dia de volta do horário de verão em hora local', () => {
  assert.equal(new Date(2026, 10, 1, 0, 0).getTimezoneOffset(), 240, 'a TZ de Nova York não foi aplicada');
  assert.equal(new Date(2026, 10, 1, 12, 0).getTimezoneOffset(), 300);
  const dom = { dias: [0], inicioMin: 0, fimMin: 720 };
  const t1 = new Date(2026, 10, 1, 0, 0).getTime();
  const t2 = new Date(2026, 10, 1, 12, 0).getTime();
  assert.equal(minutosUteis(dom, t1, t2), 780);
  // O dia inteiro (25 h reais) também vale só a janela: 780, e o dia seguinte não entra.
  assert.equal(minutosUteis(dom, t1, new Date(2026, 10, 2, 0, 0).getTime()), 780);
});

// F5: dia de troca para o horário de verão. Em 8/3/2026 (início do horário de
// verão em Nova York) o relógio pula de 02:00 para 03:00: o dia local tem 23 h.
test('J4: minutosUteis atravessando a troca para o horário de verão, em hora local', () => {
  assert.equal(new Date(2026, 2, 8, 0, 0).getTimezoneOffset(), 300, 'a TZ de Nova York não foi aplicada');
  assert.equal(new Date(2026, 2, 8, 12, 0).getTimezoneOffset(), 240);
  const em = (h, m) => new Date(2026, 2, 8, h, m).getTime();
  // Domingo 00:00 a 12:00 locais: 11 h reais (a hora 02:00 a 03:00 não existe) = 660 min.
  const manha = { dias: [0], inicioMin: 0, fimMin: 720 };
  assert.equal(minutosUteis(manha, em(0, 0), em(12, 0)), 660);
  // Janela 01:00 a 04:00 locais: 01:00 EST a 04:00 EDT são 2 h reais = 120 min.
  const noite = { dias: [0], inicioMin: 60, fimMin: 240 };
  assert.equal(minutosUteis(noite, em(0, 0), em(12, 0)), 120);
  // O dia inteiro (23 h reais) vale só a janela, e o dia seguinte não entra.
  assert.equal(minutosUteis(noite, em(0, 0), new Date(2026, 2, 9, 0, 0).getTime()), 120);
  assert.equal(minutosUteis(manha, em(0, 0), new Date(2026, 2, 9, 0, 0).getTime()), 660);
});

// J4 (borda): a borda `inicio` que cai na hora pulada vale o primeiro instante
// válido depois do salto. Em 8/3/2026 o relógio de Nova York vai de 02:00 EST
// para 03:00 EDT (07:00Z); `inicio 02:30` começa às 03:00 EDT, não às 03:30.
test('J4: inicio na hora pulada (08/03, 02:30) começa no primeiro instante válido, 03:00 EDT', () => {
  const todos = { dias: [0, 1, 2, 3, 4, 5, 6], inicioMin: 150, fimMin: 1260 };
  const meiaNoite = new Date(2026, 2, 8, 0, 0).getTime();
  const um = avancarUteis(todos, meiaNoite, 1);
  assert.equal(new Date(um - 60_000).toISOString(), '2026-03-08T07:00:00.000Z');
  // 02:30 → 21:00 locais: 03:00 EDT a 21:00 EDT = 18 h = 1080 min úteis no dia.
  assert.equal(minutosUteis(todos, meiaNoite, new Date(2026, 2, 9, 0, 0).getTime()), 1080);
});

test('J4: fim na hora pulada (08/03, 02:30) vale o primeiro instante válido, 03:00 EDT', () => {
  const madrugada = { dias: [0], inicioMin: 60, fimMin: 150 };
  // 01:00 EST (06:00Z) até 03:00 EDT (07:00Z): 60 min reais, não 90.
  assert.equal(minutosUteis(madrugada, new Date(2026, 2, 8, 0, 0).getTime(), new Date(2026, 2, 9, 0, 0).getTime()), 60);
});

// J4 (borda): na hora repetida (01/11/2026, 01:00 a 02:00 ocorrem duas vezes)
// a borda vale a primeira ocorrência: 01:30 EDT = 05:30Z.
test('J4: inicio na hora repetida (01/11, 01:30) começa na primeira ocorrência, 05:30Z', () => {
  const todos = { dias: [0, 1, 2, 3, 4, 5, 6], inicioMin: 90, fimMin: 1260 };
  const meiaNoite = new Date(2026, 10, 1, 0, 0).getTime();
  const um = avancarUteis(todos, meiaNoite, 1);
  assert.equal(new Date(um - 60_000).toISOString(), '2026-11-01T05:30:00.000Z');
});

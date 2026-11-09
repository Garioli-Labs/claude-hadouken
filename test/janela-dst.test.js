process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutosUteis } from '../src/janela.js';

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

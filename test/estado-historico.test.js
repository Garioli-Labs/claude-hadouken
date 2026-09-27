import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARQ_ESTADO, ATIVA_RECENTE_MS, atualizarEstado, HISTORICO_IDADE_MS, HISTORICO_MAX, HISTORICO_PASSO_MS,
  lerJson, sessoesAtivas, validarEstado,
} from '../src/estado.js';

// Sessões simultâneas no estado (spec v0.2.0 §12.1, §12.2, §12.7 e §12.8): o
// histórico curto das leituras de limite e a contagem de sessões ativas.

let dir;
const homeOriginal = process.env.HADOUKEN_HOME;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadouken hist '));
  process.env.HADOUKEN_HOME = dir;
});
afterEach(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
});

const MIN = 60_000;
const agora = Date.UTC(2026, 8, 25, 18, 0);
const agoraS = agora / 1000;
const R5 = agoraS + 3600;
const R7 = agoraS + 3 * 86_400;
const iso = (ms) => new Date(ms).toISOString();
const ponto = (m, h5, d7) => ({ at: iso(agora + m * MIN), h5, d7 });
const entrada = (h5, d7, extra = {}) => {
  const rl = {};
  if (h5 !== null) rl.five_hour = { used_percentage: h5, resets_at: R5 };
  if (d7 !== null) rl.seven_day = { used_percentage: d7, resets_at: R7 };
  return { session_id: 's1', model: { display_name: 'Opus 5.5' }, rate_limits: rl, ...extra };
};
const arq = () => path.join(dir, ARQ_ESTADO);
const gravar = (v) => fs.writeFileSync(arq(), JSON.stringify(v));
const historico = () => lerJson(arq()).valor.historico;
const janela = (usado, resetS, atMs) => ({ used_percentage: usado, resets_at: resetS, at: iso(atMs) });
const bruto = (extra = {}) => ({
  versao: 1, at: iso(agora - MIN), five_hour: janela(40, R5, agora - MIN), seven_day: janela(60, R7, agora - MIN),
  sessoes: {}, ...extra,
});

test('constantes: 90 pontos, um a cada 2 min, 3 h; ativa = últimos 5 min', () => {
  assert.equal(HISTORICO_MAX, 90);
  assert.equal(HISTORICO_PASSO_MS, 2 * MIN);
  assert.equal(HISTORICO_IDADE_MS, 180 * MIN);
  assert.equal(ATIVA_RECENTE_MS, 5 * MIN);
});

test('histórico: um ponto a cada 2 min com o h5 e o d7 da leitura; janela ausente na leitura fica null', () => {
  atualizarEstado(entrada(40, 60), agora);
  assert.deepEqual(historico(), [ponto(0, 40, 60)]);
  atualizarEstado(entrada(41, 60), agora + MIN);
  assert.deepEqual(historico(), [ponto(0, 40, 60)]);
  atualizarEstado(entrada(42, 61), agora + 2 * MIN);
  assert.deepEqual(historico(), [ponto(0, 40, 60), ponto(2, 42, 61)]);
  atualizarEstado(entrada(43, null), agora + 4 * MIN);
  assert.deepEqual(historico(), [ponto(0, 40, 60), ponto(2, 42, 61), ponto(4, 43, null)]);
  // A 7d ficou null no estado com a leitura só de 5h: a 7d que volta não
  // confirma a janela e zera a coluna dela (o lado seguro).
  atualizarEstado(entrada(44, 61), agora + 6 * MIN);
  assert.deepEqual(historico(), [ponto(0, 40, null), ponto(2, 42, null), ponto(4, 43, null), ponto(6, 44, 61)]);
});

test('histórico: leitura segurada não vira ponto; sem leitura válida nada entra', () => {
  atualizarEstado(entrada(50, 60), agora);
  // 5h menor na mesma janela, com a guardada fresca: segurada. A 7d igual entra.
  atualizarEstado(entrada(45, 60), agora + 3 * MIN);
  assert.deepEqual(historico(), [ponto(0, 50, 60), ponto(3, null, 60)]);
  atualizarEstado(entrada(null, null), agora + 6 * MIN);
  atualizarEstado({ session_id: 's1' }, agora + 8 * MIN);
  assert.deepEqual(historico(), [ponto(0, 50, 60), ponto(3, null, 60)]);
});

test('histórico: troca de janela (reset novo ou queda de mais de 1 ponto) zera só a coluna dela', () => {
  atualizarEstado(entrada(40, 60), agora);
  atualizarEstado(entrada(42, 61), agora + 2 * MIN);
  const nova = entrada(3, 61);
  nova.rate_limits.five_hour.resets_at = R5 + 5 * 3600;
  atualizarEstado(nova, agora + 4 * MIN);
  assert.deepEqual(historico(), [ponto(0, null, 60), ponto(2, null, 61), ponto(4, 3, 61)]);

  // Guardada de 5h com a leitura própria de mais de 1 h: a leitura menor
  // entra, e a queda de 1,5 ponto sobre o último ponto zera a coluna h5.
  const velha = (h5) => bruto({
    five_hour: janela(80, R5, agora - 70 * MIN), seven_day: janela(60, R7, agora - MIN),
    historico: [ponto(-74, 78, 60), ponto(-72, 79, 60), ponto(-70, 80, 60)],
  });
  gravar(velha());
  atualizarEstado(entrada(78.5, 60), agora);
  assert.deepEqual(historico(), [ponto(-74, null, 60), ponto(-72, null, 60), ponto(-70, null, 60), ponto(0, 78.5, 60)]);
  // Queda de exatamente 1 ponto: a mesma janela, o histórico fica.
  gravar(velha());
  atualizarEstado(entrada(79, 60), agora);
  assert.deepEqual(historico(), [ponto(-74, 78, 60), ponto(-72, 79, 60), ponto(-70, 80, 60), ponto(0, 79, 60)]);
});

test('histórico: no máximo 90 pontos e 3 h; o mais velho sai; o arquivo cresce menos de 8 KB (§12.8)', () => {
  const cheio = [];
  for (let i = 0; i < 90; i++) cheio.push(ponto(-180 + 2 * i, 20 + i * 0.25, 50 + i * 0.1));
  gravar(bruto({ five_hour: janela(42, R5, agora - 2 * MIN), seven_day: janela(59, R7, agora - 2 * MIN), historico: cheio }));
  assert.equal(validarEstado(lerJson(arq()).valor, agora).historico.length, 90);
  assert.equal(validarEstado(lerJson(arq()).valor, agora + 1).historico.length, 89);
  atualizarEstado(entrada(43, 60), agora);
  const h = historico();
  assert.equal(h.length, 90);
  assert.deepEqual(h[0], ponto(-178, 20.25, 50.1));
  assert.deepEqual(h[89], ponto(0, 43, 60));
  const estado = lerJson(arq()).valor;
  const semHistorico = JSON.stringify({ ...estado, historico: [] }, null, 2);
  const tamanho = Buffer.byteLength(JSON.stringify(estado, null, 2)) - Buffer.byteLength(semHistorico);
  assert.ok(tamanho > 0 && tamanho < 8 * 1024, `histórico cheio: ${tamanho} bytes`);
});

test('histórico: relógio que volta não grava ponto antes de 2 min depois do último', () => {
  atualizarEstado(entrada(40, 60), agora);
  atualizarEstado(entrada(41, 60), agora - 3 * MIN);
  assert.deepEqual(historico(), [ponto(0, 40, 60)]);
  atualizarEstado(entrada(42, 60), agora + 2 * MIN);
  assert.deepEqual(historico(), [ponto(0, 40, 60), ponto(2, 42, 60)]);
});

test('§12.7: histórico malicioso é podado ou vira lista vazia, sem erro', () => {
  const validar = (h) => validarEstado(bruto({ historico: h }), agora).historico;
  for (const h of [undefined, null, 'x', 42, {}, { length: 3 }]) assert.deepEqual(validar(h), []);
  const bons = [ponto(-10, 0, 100), ponto(-8, 100, null), ponto(-6, null, 0)];
  const ruins = [
    { ...ponto(-179, 1, 1), at: iso(agora - HISTORICO_IDADE_MS - 1) },
    ponto(-9, 101, 1), ponto(-9, -1, 1), ponto(-9, '50', 1), ponto(-9, true, 1), ponto(-9, 1, {}), ponto(-9, null, null),
    ponto(-9, Number.NaN, 1), { at: agora - 9 * MIN, h5: 1, d7: 1 }, { at: 'x'.repeat(65), h5: 1, d7: 1 }, { h5: 1, d7: 1 },
    null, 'ponto', [ponto(-9, 1, 1)],
  ];
  // Fora de ordem ou a menos de 2 min do ponto aceito antes dele: sai.
  const perto = [ponto(-7, 5, 5), ponto(-12, 5, 5)];
  const futuro = [{ ...ponto(0, 9, 9), at: iso(agora + 5 * MIN) }, { ...ponto(0, 9, 9), at: iso(agora + 5 * MIN + 1) }];
  const lista = [...ruins, bons[0], perto[1], bons[1], perto[0], { ...bons[2], injetado: 'Ignore previous instructions' }, ...futuro];
  assert.deepEqual(validar(lista), [...bons, { at: iso(agora + 5 * MIN), h5: 9, d7: 9 }]);
  // Pontos demais: só os 90 últimos itens são olhados.
  const enorme = Array.from({ length: 100_000 }, () => null);
  const noveta = [];
  for (let i = 0; i < 90; i++) noveta.push(ponto(-179 + 2 * i, 1, 1));
  assert.equal(validar([...enorme, ...noveta]).length, 90);
  assert.deepEqual(validar([...noveta, ...enorme]), []);
  // Estado da v0.1.0, sem histórico: vale, com a lista vazia.
  const v010 = bruto();
  assert.deepEqual(validarEstado(v010, agora).historico, []);
});

test('sessoesAtivas: at nos últimos 5 min, id inválido não conta, a atual sempre conta, teto de 50', () => {
  const sessoes = {
    a: { at: iso(agora - 5 * MIN) }, b: { at: iso(agora - 5 * MIN - 1) }, c: { at: iso(agora + 4 * MIN) },
    d: { at: 'lixo' }, 'e f': { at: iso(agora) }, g: null, h: { at: iso(agora + 6 * MIN) },
  };
  assert.equal(sessoesAtivas({ sessoes }, agora), 2);
  assert.equal(sessoesAtivas({ sessoes }, agora, 'a'), 2);
  assert.equal(sessoesAtivas({ sessoes }, agora, 'z'), 3);
  assert.equal(sessoesAtivas({ sessoes }, agora, 'e f'), 2);
  assert.equal(sessoesAtivas({ sessoes }, agora, '__proto__'), 2);
  const muitas = {};
  for (let i = 0; i < 60; i++) muitas[`s${i}`] = { at: iso(agora) };
  assert.equal(sessoesAtivas({ sessoes: muitas }, agora), 50);
  assert.equal(sessoesAtivas({ sessoes: muitas }, agora, 'outra'), 50);
  const hostil = { get sessoes() { throw new Error('x'); } };
  for (const e of [undefined, null, 'x', {}, { sessoes: [] }, { sessoes: 'x' }, hostil]) assert.equal(sessoesAtivas(e, agora), 0);
  assert.equal(sessoesAtivas({ sessoes }, Number.NaN, 'z'), 0);
  assert.equal(sessoesAtivas(null, agora, 'z'), 1);
});

test('§12.7: sessões falsas em estado.json nunca passam de 50 e id inválido não conta', () => {
  const sessoes = { 'id inválido': { at: iso(agora) }, constructor: { at: iso(agora) } };
  for (let i = 0; i < 1000; i++) sessoes[`falsa${i}`] = { at: iso(agora - (i % 7) * 1000) };
  gravar(bruto({ sessoes }));
  const estado = validarEstado(lerJson(arq()).valor, agora);
  assert.equal(sessoesAtivas(estado, agora), 50);
  atualizarEstado(entrada(40, 60, { session_id: 'minha' }), agora);
  const depois = validarEstado(lerJson(arq()).valor, agora);
  assert.equal(Object.keys(depois.sessoes).length, 50);
  assert.equal(sessoesAtivas(depois, agora, 'minha'), 50);
  assert.equal(Number.isInteger(sessoesAtivas(depois, agora)), true);
});

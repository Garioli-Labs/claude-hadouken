import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gravarModo, lerModo, lerRegistroAvisos, gravarRegistroAvisos, MODO_LEVE_MS } from '../src/saude/modo.js';

// Spec v0.5.5 §6.C: o modo leve dura 4 h e acaba sozinho.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-saude-modo-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novoDir = () => fs.mkdtempSync(path.join(tmp, 'd'));
const AGORA = 1_800_000_000_000;

test('sem arquivo: normal', () => {
  assert.deepEqual(lerModo(novoDir(), AGORA), { leve: false, ateMs: null });
});

test('leve dura 4 h e expira sozinho', () => {
  const d = novoDir();
  assert.equal(MODO_LEVE_MS, 4 * 3_600_000);
  assert.deepEqual(gravarModo(d, true, AGORA), { ok: true, ateMs: AGORA + MODO_LEVE_MS });
  assert.deepEqual(lerModo(d, AGORA + 1000), { leve: true, ateMs: AGORA + MODO_LEVE_MS });
  assert.deepEqual(lerModo(d, AGORA + MODO_LEVE_MS), { leve: false, ateMs: null });
});

test('normal desliga na hora', () => {
  const d = novoDir();
  gravarModo(d, true, AGORA);
  assert.deepEqual(gravarModo(d, false, AGORA + 10), { ok: true, ateMs: null });
  assert.deepEqual(lerModo(d, AGORA + 20), { leve: false, ateMs: null });
});

test('arquivo forjado com prazo além de 4 h ou lixo: normal', () => {
  const d = novoDir();
  const arq = path.join(d, 'saude-modo.json');
  fs.writeFileSync(arq, JSON.stringify({ v: 1, leve: true, ateMs: AGORA + 10 * 3_600_000 }));
  assert.equal(lerModo(d, AGORA).leve, false);
  fs.writeFileSync(arq, '{lixo');
  assert.equal(lerModo(d, AGORA).leve, false);
});

test('registro dos avisos: ida e volta, ausente e lixo dão undefined', () => {
  const d = novoDir();
  assert.equal(lerRegistroAvisos(d), undefined);
  const reg = { episodios: { ram: { inicioMs: AGORA, fimAbaixoMs: null, avisadoUsuario: true, nivel: 2, sessoes: ['abc'] } }, modoAnunciado: {} };
  assert.equal(gravarRegistroAvisos(d, reg).ok, true);
  assert.deepEqual(lerRegistroAvisos(d), reg);
  fs.writeFileSync(path.join(d, 'saude-avisos.json'), 'x');
  assert.equal(lerRegistroAvisos(d), undefined);
});

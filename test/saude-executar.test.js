import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar, rodarArquivo } from '../src/saude/executar.js';

// O adaptador real da costura `executar` do coletor (spec v0.5.5 §6.A): spawn
// sem shell, mata no prazo, corta a saída grande. Testado com o próprio node.

const node = process.execPath;

test('rodarArquivo: saída e código zero', async () => {
  const r = await rodarArquivo(node, ['-e', 'process.stdout.write("olá")'], { prazoMs: 10_000 });
  assert.deepEqual(r, { ok: true, stdout: 'olá' });
});

test('rodarArquivo: código diferente de zero não vale', async () => {
  const r = await rodarArquivo(node, ['-e', 'process.stdout.write("x"); process.exit(3)'], { prazoMs: 10_000 });
  assert.deepEqual(r, { ok: false, stdout: '', motivo: 'erro' });
});

test('rodarArquivo: estoura o prazo, é morto e volta logo', async () => {
  const t0 = Date.now();
  const r = await rodarArquivo(node, ['-e', 'setTimeout(() => {}, 20000)'], { prazoMs: 300 });
  assert.deepEqual(r, { ok: false, stdout: '', motivo: 'prazo' });
  assert.ok(Date.now() - t0 < 5000);
});

test('rodarArquivo: saída acima do teto é descartada', async () => {
  const r = await rodarArquivo(node, ['-e', 'process.stdout.write("a".repeat(5000))'], { prazoMs: 10_000, maxBytes: 1000 });
  assert.deepEqual(r, { ok: false, stdout: '', motivo: 'grande' });
});

test('rodarArquivo: arquivo inexistente não lança', async () => {
  const r = await rodarArquivo('/nao/existe/programa-x', [], { prazoMs: 1000 });
  assert.equal(r.ok, false);
});

test('executar: nome fora da lista não roda nada', async () => {
  assert.deepEqual(await executar('rm', ['-rf', '/'], { prazoMs: 1000 }), { ok: false, stdout: '', motivo: 'erro' });
  assert.deepEqual(await executar('powershell', 'nao-lista', { prazoMs: 1000 }), { ok: false, stdout: '', motivo: 'erro' });
});

test('executar: o leitor da plataforma responde de verdade', { timeout: 20_000 }, async () => {
  if (process.platform === 'win32') {
    const r = await executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; "ação"'], { prazoMs: 15_000 });
    assert.equal(r.ok, true);
    assert.equal(r.stdout.trim(), 'ação');
  } else {
    const r = await executar('ps', ['-axo', 'pid=,comm='], { prazoMs: 5000 });
    assert.equal(r.ok, true);
    assert.match(r.stdout, new RegExp(`\\b${process.pid}\\b`));
  }
});

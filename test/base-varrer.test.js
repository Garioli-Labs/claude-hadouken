import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { varrerTmpVelhos } from '../src/base.js';

test('varrerTmpVelhos nunca remove um .tmp velho com hard link', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk varrer '));
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk fora '));
  try {
    const alvo = path.join(fora, 'alvo.txt');
    fs.writeFileSync(alvo, 'conteudo');
    fs.chmodSync(alvo, 0o444);
    const ligado = path.join(pasta, 'x.tmp');
    fs.linkSync(alvo, ligado);
    const sozinho = path.join(pasta, 'y.tmp');
    fs.writeFileSync(sozinho, '');
    const velho = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(sozinho, velho, velho);
    fs.utimesSync(alvo, velho, velho);

    varrerTmpVelhos(pasta, (n) => n.endsWith('.tmp'));

    assert.ok(fs.existsSync(ligado), 'hard link fica');
    assert.ok(!fs.existsSync(sozinho), 'tmp velho comum sai');
    assert.equal(fs.statSync(alvo).mode & 0o222, 0, 'alvo continua somente leitura');
    assert.equal(fs.readFileSync(alvo, 'utf8'), 'conteudo');
  } finally {
    for (const d of [pasta, fora]) {
      try {
        for (const n of fs.readdirSync(d)) fs.chmodSync(path.join(d, n), 0o644);
      } catch { /* ja removido */ }
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
});

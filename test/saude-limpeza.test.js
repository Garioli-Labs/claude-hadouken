import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { limparDados } from '../src/saude/limpeza.js';

// Spec v0.5.5 §6.C: a pasta de dados não cresce sem fim. Só arquivos do
// hadouken no primeiro nível; o venv nunca é tocado.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-limpeza-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novoDir = () => fs.mkdtempSync(path.join(tmp, 'd'));
const MB = 1024 * 1024;
const AGORA = Date.UTC(2026, 9, 28, 19, 40);
const DIA = 86_400_000;

// Linhas JSON de ~100 bytes até passar de `bytes`.
function historico(arq, bytes) {
  const linha = (i) => `${JSON.stringify({ i, x: 'a'.repeat(80) })}\n`;
  const partes = [];
  let total = 0;
  for (let i = 0; total < bytes; i++) {
    const l = linha(i);
    partes.push(l);
    total += l.length;
  }
  fs.writeFileSync(arq, partes.join(''));
}

test('histórico acima de 5 MB fica em 4 MB em linha inteira', () => {
  const d = novoDir();
  const arq = path.join(d, 'historico.jsonl');
  historico(arq, 6 * MB);
  const antes = fs.statSync(arq).size;
  const r = limparDados(d, { tetoMb: 1000, agoraMs: AGORA });
  const depois = fs.statSync(arq).size;
  assert.ok(depois <= 4 * MB && depois > 4 * MB - 200, String(depois));
  assert.deepEqual(r.cortes, [{ arquivo: 'historico.jsonl', antesBytes: antes, depoisBytes: depois }]);
  const texto = fs.readFileSync(arq, 'utf8');
  assert.ok(texto.endsWith('\n'));
  // Toda linha inteira e as mais novas ficaram.
  const linhas = texto.trimEnd().split('\n').map((l) => JSON.parse(l));
  const ultima = fs.readFileSync(arq, 'utf8').trimEnd().split('\n').length;
  assert.ok(ultima > 0);
  assert.ok(linhas.at(-1).i > linhas[0].i);
});

test('histórico de 5 MB ou menos fica como está', () => {
  const d = novoDir();
  historico(path.join(d, 'historico.jsonl'), 3 * MB);
  assert.deepEqual(limparDados(d, { tetoMb: 1000, agoraMs: AGORA }).cortes, []);
});

test('índice acima de 10 MB é apagado', () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, 'indice-transcripts.json'), Buffer.alloc(11 * MB, 0x20));
  fs.writeFileSync(path.join(d, 'indice-hooks.json'), '{}');
  const r = limparDados(d, { tetoMb: 1000, agoraMs: AGORA });
  assert.ok(!fs.existsSync(path.join(d, 'indice-transcripts.json')));
  assert.ok(fs.existsSync(path.join(d, 'indice-hooks.json')));
  assert.deepEqual(r.cortes, [{ arquivo: 'indice-transcripts.json', antesBytes: 11 * MB, depoisBytes: 0 }]);
});

test('venv intocado, mesmo acima do teto', () => {
  const d = novoDir();
  fs.mkdirSync(path.join(d, 'venv', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(d, 'venv', 'lib', 'grande.bin'), Buffer.alloc(12 * MB));
  fs.writeFileSync(path.join(d, 'venv', 'historico.jsonl'), Buffer.alloc(6 * MB, 0x61));
  fs.writeFileSync(path.join(d, 'venv', 'x.corrompido-2020-01-01-0000'), 'velho');
  assert.deepEqual(limparDados(d, { tetoMb: 10, agoraMs: AGORA }).cortes, []);
  assert.equal(fs.statSync(path.join(d, 'venv', 'lib', 'grande.bin')).size, 12 * MB);
  assert.ok(fs.existsSync(path.join(d, 'venv', 'x.corrompido-2020-01-01-0000')));
});

test('quarentena com mais de 30 dias apagada', () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, 'estado.json.corrompido-2026-09-01-1000'), 'velha');
  fs.writeFileSync(path.join(d, 'estado.json.corrompido-2026-10-20-1000'), 'nova');
  fs.writeFileSync(path.join(d, 'estado.json.corrompido-lixo'), 'sem data');
  const r = limparDados(d, { tetoMb: 1000, agoraMs: AGORA });
  assert.deepEqual(fs.readdirSync(d).sort(), ['estado.json.corrompido-2026-10-20-1000', 'estado.json.corrompido-lixo']);
  assert.deepEqual(r.cortes.map((c) => c.arquivo), ['estado.json.corrompido-2026-09-01-1000']);
});

test('acima do teto: primeiro o histórico velho, depois o atual', () => {
  const d = novoDir();
  historico(path.join(d, 'historico.1.jsonl'), 3 * MB);
  historico(path.join(d, 'historico.jsonl'), 4 * MB);
  fs.writeFileSync(path.join(d, 'config.json'), '{}');
  const r = limparDados(d, { tetoMb: 2, agoraMs: AGORA });
  assert.ok(!fs.existsSync(path.join(d, 'historico.1.jsonl')));
  const atual = fs.statSync(path.join(d, 'historico.jsonl')).size;
  assert.ok(atual <= 2 * MB, String(atual));
  assert.ok(fs.readFileSync(path.join(d, 'historico.jsonl'), 'utf8').endsWith('\n'));
  assert.deepEqual(r.cortes.map((c) => c.arquivo), ['historico.1.jsonl', 'historico.jsonl']);
  assert.ok(fs.existsSync(path.join(d, 'config.json')));
});

test('histórico sem quebra de linha no fim do corte fica vazio, não pela metade', () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, 'historico.jsonl'), Buffer.alloc(6 * MB, 0x61));
  limparDados(d, { tetoMb: 1000, agoraMs: AGORA });
  assert.equal(fs.statSync(path.join(d, 'historico.jsonl')).size, 0);
});

test('dir inválido não lança', () => {
  assert.deepEqual(limparDados(null, { tetoMb: 50, agoraMs: AGORA }), { cortes: [] });
  assert.deepEqual(limparDados(path.join(tmp, 'nao'), { tetoMb: 50, agoraMs: AGORA }), { cortes: [] });
});

test('não usa data do arquivo: quarentena recém-renomeada de arquivo antigo fica', () => {
  const d = novoDir();
  const arq = path.join(d, 'alertas.json.corrompido-2026-10-28-1900');
  fs.writeFileSync(arq, 'x');
  const velho = new Date(AGORA - 90 * DIA);
  fs.utimesSync(arq, velho, velho);
  limparDados(d, { tetoMb: 1000, agoraMs: AGORA });
  assert.ok(fs.existsSync(arq));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configColetor, SENSIVEIS, PORTA, HOST } from '../src/aprendizado/config-coletor.js';

// Fronteiras de §3.1 e a primeira barreira (§5.1, §8 "Filtro"). O teste das
// fronteiras lê o texto de src/, como o S24 de test/guarda-ameacas.test.js,
// e vale para todo arquivo novo de src/aprendizado das tasks seguintes.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function listarJs(dir) {
  const achados = [];
  if (!fs.existsSync(dir)) return achados;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) achados.push(...listarJs(p));
    else if (e.name.endsWith('.js')) achados.push(p);
  }
  return achados;
}

const REDE = /node:(?:http|https|net|dns|tls|dgram)\b|from ['"](?:http|https|net|dns|tls|dgram)['"]|\bfetch\s*\(|\bWebSocket\b/;
const FILHO = /node:child_process|from ['"]child_process['"]|process\.binding\s*\(/;

test('§3.1: só baixar.js tem rede e só coletor.js tem processo filho', () => {
  const arquivos = listarJs(path.join(repo, 'src', 'aprendizado'));
  assert.ok(arquivos.length > 0);
  for (const a of arquivos) {
    const nome = path.basename(a);
    const t = fs.readFileSync(a, 'utf8');
    if (nome !== 'baixar.js') assert.doesNotMatch(t, REDE, a);
    if (nome !== 'coletor.js') assert.doesNotMatch(t, FILHO, a);
  }
});

test('§3.1: src/guarda continua sem rede e sem processo filho, com o aperto', () => {
  for (const a of listarJs(path.join(repo, 'src', 'guarda'))) {
    const t = fs.readFileSync(a, 'utf8');
    assert.doesNotMatch(t, REDE, a);
    assert.doesNotMatch(t, FILHO, a);
  }
});

test('o hook do comando aprender, quando existir, não tem rede nem processo filho', () => {
  const a = path.join(repo, 'src', 'hooks', 'aprender.js');
  if (!fs.existsSync(a)) return;
  const t = fs.readFileSync(a, 'utf8');
  assert.doesNotMatch(t, REDE);
  assert.doesNotMatch(t, FILHO);
});

test('§8 Filtro: a configuração gerada tem cada delete, no recurso e nos atributos', () => {
  const r = configColetor({ arquivoTelemetria: 'C:/Users/José/.claude/hadouken/otel/telemetria.jsonl' });
  assert.equal(r.ok, true);
  const t = r.texto;
  for (const k of SENSIVEIS) {
    assert.equal(t.split(`- key: ${k}\n        action: delete`).length - 1, 2, k);
  }
  assert.equal(t.split('- pattern: ^vcs\\..*\n        action: delete').length - 1, 2);
  assert.ok(t.includes(`        endpoint: ${HOST}:${PORTA}\n`));
  assert.doesNotMatch(t, /grpc|extensions|otlphttp|debug|0\.0\.0\.0|localhost|traces:/);
  assert.equal(t.match(/^ {2}file:$/gm).length, 1);
  assert.match(t, /max_megabytes: 5\n\s+max_days: 30\n\s+max_backups: 3/);
  assert.match(t, /metrics:\n\s+level: none/);
  assert.equal(t.split('processors: [memory_limiter, resource/hadouken, attributes/hadouken, batch]').length - 1, 2);
  assert.ok(t.includes("path: 'C:/Users/José/.claude/hadouken/otel/telemetria.jsonl'"));
});

test('caminho com aspas, $, quebra de linha ou vazio é recusado', () => {
  for (const ruim of ["C:/a'b/t.jsonl", 'C:/a$b/t.jsonl', 'C:/a\nb/t.jsonl', '', null]) {
    assert.deepEqual(configColetor({ arquivoTelemetria: ruim }), { ok: false, motivo: 'caminho-inseguro' });
  }
});

test('barras invertidas viram barras normais', () => {
  const r = configColetor({ arquivoTelemetria: 'C:\\Users\\x\\otel\\telemetria.jsonl' });
  assert.ok(r.texto.includes("path: 'C:/Users/x/otel/telemetria.jsonl'"));
});

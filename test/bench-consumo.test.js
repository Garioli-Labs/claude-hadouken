import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// bench/consumo.mjs (Task 12b): forma do objeto --json que
// bench/rodar-todos.mjs lê, com a árvore mínima (1 pasta de projeto, 36
// transcripts de uma requisição cada) e poucas rodadas, para o teste ficar
// rápido. O bench roda num processo filho com HOME e USERPROFILE numa pasta
// temporária vazia, sem CLAUDE_CONFIG_DIR, e com um HADOUKEN_HOME de guarda:
// nada disso pode ser criado nem tocado, porque o bench usa só as pastas
// temporárias dele.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bench = path.join(repo, 'bench', 'consumo.mjs');

function rodar(args, dir) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const K = k.toUpperCase();
    if (K === 'CLAUDE_CONFIG_DIR' || K === 'HADOUKEN_HOME' || K === 'HOME' || K === 'USERPROFILE') continue;
    env[k] = v;
  }
  env.HOME = path.join(dir, 'home');
  env.USERPROFILE = env.HOME;
  env.HADOUKEN_HOME = path.join(dir, 'guarda');
  return spawnSync(process.execPath, [bench, ...args], { cwd: repo, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
}

function comPasta(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk teste bench consumo '));
  try {
    fs.mkdirSync(path.join(dir, 'home'));
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const positivo = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;

test('bench/consumo.mjs --json: objeto com as quatro linhas, n pedido e as metas da spec 9', () => {
  comPasta((dir) => {
    const r = rodar(['0.01', '1', '2', '--projetos=1', '--json'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    const saida = r.stdout.trim().split('\n');
    assert.equal(saida.length, 1, 'com --json, só o objeto');
    const v = JSON.parse(saida[0]);
    assert.equal(v.bench, 'consumo');
    assert.equal(v.plataforma, process.platform);
    assert.equal(v.node, process.version);
    assert.equal(v.alvoQuenteMs, 2_000);
    assert.equal(v.alvoFrioMs, 15_000);
    assert.equal(v.rodadasFrio, 1);
    assert.equal(v.rodadasQuente, 2);
    assert.equal(v.aquecimento, 1);
    assert.equal(v.projetos, 1);
    assert.equal(v.arquivos, 36);
    assert.ok(positivo(v.bytesGerados) && Number.isFinite(v.msGeracao));
    assert.equal(v.fixture.sessoes, 50);
    assert.ok(positivo(v.fixture.bytesEstado));
    assert.deepEqual(v.github, { repo: 'exemplo/app-sintetico', runs: 30, jobsPorRun: 3, chamadasFrio: 32 });
    assert.deepEqual(v.linhas.map((l) => [l.id, l.cenario, l.n, l.alvoMs]), [
      ['frio', 'com-repo', 1, 15_000],
      ['quente', 'com-repo', 2, 2_000],
      ['frio-sem-repo', 'sem-repo', 1, 15_000],
      ['quente-sem-repo', 'sem-repo', 2, 2_000],
    ]);
    for (const l of v.linhas) {
      assert.equal(typeof l.nome, 'string');
      for (const k of ['min', 'p50', 'media', 'p95', 'max']) assert.ok(positivo(l[k]), `${l.id}.${k}`);
      assert.ok(l.min <= l.p50 && l.p50 <= l.p95 && l.p95 <= l.max, l.id);
    }
    assert.equal(v.tmpRemovido, true);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'home')), [], 'nada criado na home');
    assert.equal(fs.existsSync(path.join(dir, 'guarda')), false, 'HADOUKEN_HOME de quem chama intocado');
  });
});

test('bench/consumo.mjs: argumento fora do formato sai com 2 e a linha de uso, sem medir', () => {
  comPasta((dir) => {
    const casos = [
      ['-1', '--json'], ['abc'], ['1', '0', '1'], ['1', '1.5', '1'], ['1', '1', '1', '1'],
      ['1', '--projetos=7'], ['1', '--projetos=1', '--projetos=2'],
    ];
    for (const args of casos) {
      const r = rodar(args, dir);
      assert.equal(r.status, 2, JSON.stringify(args));
      assert.match(r.stderr, /^usage: node bench\/consumo\.mjs/, JSON.stringify(args));
      assert.equal(r.stdout, '', JSON.stringify(args));
    }
    assert.deepEqual(fs.readdirSync(path.join(dir, 'home')), []);
  });
});

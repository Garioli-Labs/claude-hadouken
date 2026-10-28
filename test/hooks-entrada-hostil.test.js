import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Spec v0.5.5 §6.F (Task 14): todo hook de hooks/hooks.json, com entrada
// estragada, sai com 0 e não escreve nada, nem em stdout nem em stderr.
// O hadouken não pode travar nem derrubar o turno de ninguém. Cada hook roda
// numa pasta de dados e numa CLAUDE_CONFIG_DIR temporárias, sem disparar o
// coletor nem o painel.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
const SCRIPTS = [...new Set([...JSON.stringify(hooks).matchAll(/src\/hooks\/([a-z-]+\.js)/g)].map((m) => m[1]))].sort();
const ENTRADAS = [
  ['vazio', ''],
  ['chave aberta', '{'],
  ['lista', '[]'],
  ['session_id número', '{"session_id":5}'],
  ['1 MB de texto', 'a'.repeat(1024 * 1024)],
];

const pastas = [];
after(() => { for (const p of pastas) fs.rmSync(p, { recursive: true, force: true }); });

function ambiente() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk hostil ç '));
  pastas.push(home);
  return {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1',
    HADOUKEN_SAUDE_DISPARAR: '0', CLAUDE_CONFIG_DIR: path.join(home, 'sem-config'),
  };
}

test('a lista cobre os 15 hooks do hooks.json', () => {
  assert.deepEqual(SCRIPTS, [
    'aprender.js', 'guarda-agenda.js', 'guarda-arquivos.js', 'guarda-config.js', 'guarda-despacho.js', 'guarda-filha.js',
    'guarda-modelo.js', 'liberar.js', 'limite-atingido.js', 'limites.js', 'modelo-trocado.js', 'prompt-submit.js',
    'saude.js', 'session-end.js', 'session-start.js',
  ]);
});

for (const script of SCRIPTS) {
  test(`entrada hostil: ${script} sai com 0 e em silêncio`, () => {
    for (const [nome, entrada] of ENTRADAS) {
      const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', script)], {
        input: entrada, env: ambiente(), encoding: 'utf8', timeout: 20_000, cwd: os.tmpdir(),
      });
      assert.equal(r.error, undefined, `${script} / ${nome}: ${r.error}`);
      assert.equal(r.status, 0, `${script} / ${nome}: código ${r.status}\n${r.stderr}`);
      // O retrato da 0.5.4, conferido antes da Task 14: nenhum hook diz nada
      // com entrada estragada (nem decisão, nem aviso, nem stack trace).
      assert.equal(r.stderr, '', `${script} / ${nome}: stderr\n${r.stderr}`);
      assert.equal(r.stdout, '', `${script} / ${nome}: stdout\n${r.stdout}`);
    }
  });
}

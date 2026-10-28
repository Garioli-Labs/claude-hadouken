import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Spec v0.5.5 §6.H (Task 14): o plugin não engorda. Os números foram medidos
// no começo da Task 14 e ficam fixos aqui; subir algum deles é decisão, não
// acidente.
// - Pacote: os arquivos do git fora de test, bench, docs e wiki (o que vai
//   para o cache do Claude Code e conta no disco de quem instala), até 1,25×
//   os 2 349 663 bytes medidos.
// - Hooks quentes: o grafo de imports estáticos de cada um (o que carrega
//   em todo evento; o import() dinâmico só carrega quando há o que dizer),
//   até o medido + 4.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACOTE_MEDIDO = 2_349_663;
const FORA = new Set(['venv', 'node_modules', '.git', 'test', 'bench', 'docs', 'wiki']);
const MODULOS_MEDIDOS = { 'prompt-submit.js': 4, 'session-start.js': 4, 'guarda-despacho.js': 4, 'guarda-filha.js': 5 };

function arquivosDoGit() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

const IMPORT = /^\s*(?:import|export)\s[^;]*?from\s+'(\.{1,2}\/[^']+)'|^\s*import\s+'(\.{1,2}\/[^']+)'/gm;
function grafo(arq, vistos = new Set()) {
  if (vistos.has(arq)) return vistos;
  vistos.add(arq);
  for (const m of fs.readFileSync(arq, 'utf8').matchAll(IMPORT)) grafo(path.resolve(path.dirname(arq), m[1] ?? m[2]), vistos);
  return vistos;
}

const arquivos = arquivosDoGit();
test('peso: o pacote fica abaixo de 1,25× o medido no começo da v0.5.5', { skip: arquivos === null ? 'sem git' : false }, () => {
  let total = 0;
  for (const a of arquivos) {
    if (FORA.has(a.split('/')[0])) continue;
    try { total += fs.statSync(path.join(repo, a)).size; } catch { /* apagado e ainda não commitado */ }
  }
  assert.ok(total <= Math.round(PACOTE_MEDIDO * 1.25), `pacote com ${total} bytes; teto ${Math.round(PACOTE_MEDIDO * 1.25)}`);
});

test('peso: os hooks quentes carregam no máximo o medido + 4 módulos sem aviso', () => {
  for (const [hook, medido] of Object.entries(MODULOS_MEDIDOS)) {
    const n = grafo(path.join(repo, 'src', 'hooks', hook)).size;
    assert.ok(n <= medido + 4, `${hook}: ${n} módulos estáticos; teto ${medido + 4}`);
  }
});

test('peso: o contador de imports enxerga um import estático novo', () => {
  // Sem isto, um regex quebrado deixaria o teste acima sempre verde.
  const n = grafo(path.join(repo, 'src', 'hooks', 'prompt-submit.js'));
  assert.ok(n.size >= 2, [...n].join('\n'));
  assert.ok([...n].some((a) => a.endsWith(`${path.sep}comum.js`)), [...n].join('\n'));
});

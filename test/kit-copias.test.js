import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const kit = path.join(repo, 'kit', 'skills');

function todos(dir) {
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) r.push(p, ...todos(p)); else r.push(p);
  }
  return r;
}

test('graphify: licença MIT, NOTICE e aviso do pacote 0.9.25 logo depois do frontmatter', () => {
  const g = path.join(kit, 'graphify');
  assert.match(fs.readFileSync(path.join(g, 'LICENSE-MIT'), 'utf8'), /MIT License/);
  assert.ok(fs.statSync(path.join(g, 'NOTICE')).size > 0);
  const s = fs.readFileSync(path.join(g, 'SKILL.md'), 'utf8');
  assert.match(s, /^---\nname: graphify\n/);
  const corpo = s.split('\n---\n')[1].trimStart();
  assert.match(corpo.split('\n')[0], /pip install graphifyy==0\.9\.25/);
  assert.ok(fs.readdirSync(path.join(g, 'references')).length >= 8);
});

test('yu-ux: ATTRIBUTIONS.md, setup.sh e manifestos do vendor, sem node_modules nem __pycache__', () => {
  const y = path.join(kit, 'yu-ux-web-expert');
  for (const f of ['ATTRIBUTIONS.md', 'SKILL.md', 'scripts/setup.sh', 'vendor/package.json', 'vendor/package-lock.json']) {
    assert.ok(fs.existsSync(path.join(y, f)), f);
  }
  for (const p of todos(y)) {
    assert.doesNotMatch(p, /node_modules|__pycache__|\.pyc$|\.python_bin$/, p);
  }
  assert.equal(fs.readdirSync(path.join(y, 'references')).filter((n) => n.endsWith('.md')).length, 12);
});

// Conferido em 2026-10-14 (v0.5.1) com o kit 1.0.0 instalado: ao carregar a
// skill, o Claude Code troca ${CLAUDE_PLUGIN_ROOT} pelo caminho do cache, com
// barras normais e o espaço preservado ("C:/Users/Lucas Garioli/.claude/
// plugins/cache/claude-hadouken/hadouken-kit/1.0.0/skills/yu-ux-web-expert/").
test('yu-ux: o SKILL.md diz onde a skill mora dentro do plugin', () => {
  const s = fs.readFileSync(path.join(kit, 'yu-ux-web-expert', 'SKILL.md'), 'utf8');
  assert.match(s, /^---\nname: yu-ux-web-expert\n/);
  assert.match(s, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/yu-ux-web-expert\//);
});

test('nenhum arquivo do kit é link simbólico', () => {
  for (const p of todos(path.join(repo, 'kit'))) assert.ok(!fs.lstatSync(p).isSymbolicLink(), p);
});

// C2 da revisão final: skill distribuída pelo marketplace não libera
// ferramenta de escrita ou execução sem pergunta (a yu-ux lê páginas de
// terceiros; uma injeção viraria comando).
test('nenhum SKILL.md do kit dispensa a pergunta de Bash, Write, Edit ou WebFetch', () => {
  for (const nome of fs.readdirSync(kit)) {
    const s = fs.readFileSync(path.join(kit, nome, 'SKILL.md'), 'utf8');
    const frente = s.split('\n---\n')[0];
    const linha = /^allowed-tools:(.*)$/m.exec(frente)?.[1] ?? '';
    assert.doesNotMatch(linha, /\b(?:Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch)\b/, nome);
  }
});

// I2 da revisão final: o .gitignore da yu-ux ignora vendor/; o clone do
// GitHub precisa dos manifestos com o lock.
test('yu-ux: vendor/package.json e package-lock.json estão no git', () => {
  const r = spawnSync('git', ['ls-files', 'kit/skills/yu-ux-web-expert/vendor'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const l = r.stdout.trim().split('\n');
  assert.ok(l.includes('kit/skills/yu-ux-web-expert/vendor/package.json'), r.stdout);
  assert.ok(l.includes('kit/skills/yu-ux-web-expert/vendor/package-lock.json'), r.stdout);
});

// I3 da revisão final: o graphify 0.9.25 é Apache-2.0 (o MIT vale só para o
// que veio antes da relicença); o NOTICE aponta para o LICENSE.
test('graphify: LICENSE (Apache-2.0) da tag v0.9.25 junto do NOTICE', () => {
  const g = path.join(kit, 'graphify');
  assert.match(fs.readFileSync(path.join(g, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
  const r = spawnSync('git', ['ls-files', 'kit/skills/graphify/LICENSE'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'kit/skills/graphify/LICENSE');
});

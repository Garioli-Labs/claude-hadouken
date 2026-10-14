import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('yu-ux: o SKILL.md diz onde a skill mora dentro do plugin', () => {
  const s = fs.readFileSync(path.join(kit, 'yu-ux-web-expert', 'SKILL.md'), 'utf8');
  assert.match(s, /^---\nname: yu-ux-web-expert\n/);
  assert.match(s, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/yu-ux-web-expert\//);
});

test('nenhum arquivo do kit é link simbólico', () => {
  for (const p of todos(path.join(repo, 'kit'))) assert.ok(!fs.lstatSync(p).isSymbolicLink(), p);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSAO_REA } from '../rea/lancar.mjs';
import { GRAPHIFY } from '../src/instalar-tudo.js';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));

// Sem o clean-architecture desde 2026-10-14: o plugin.json dele virou link
// simbólico no upstream e, no Windows (git sem symlinks), a instalação falha
// com JSON parse error e derruba o kit inteiro.
// v0.5.2: os terceiros do kit são entradas deste marketplace, com sha fixo;
// só o superpowers continua no marketplace oficial.
const ALLOW = ['claude-plugins-official'];
// Issue #2: com `source: 'github'` (repo curto) ou git-subdir com url curta,
// o Claude Code tenta SSH (git@github.com:) antes; num Mac sem a host key do
// github.com, a instalação falha. Por isso a URL HTTPS completa.
const TERCEIROS = {
  'mattpocock-skills': { source: 'url', url: 'https://github.com/mattpocock/skills.git', sha: '49dd158d1076134a641b33efb035946536778336' },
  'poka-yoke': { source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke', sha: '726a575e3d48d07d908abfcbb192cae09671fff2' },
  'fullstack-dev-skills': { source: 'url', url: 'https://github.com/jeffallan/claude-skills.git', sha: '882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf' },
  'ui-ux-pro-max': { source: 'url', url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git', sha: 'e353a508767c6d39f0e7698b084dbfc8699fffd3' },
};

test('issue #2: nenhum terceiro faz o Claude Code tentar SSH (só URL https://github.com/…/.git)', () => {
  const m = ler('.claude-plugin/marketplace.json');
  for (const p of m.plugins.filter((x) => typeof x.source !== 'string')) {
    assert.ok(p.source.source === 'url' || p.source.source === 'git-subdir', `${p.name}: fonte ${p.source.source}`);
    assert.match(p.source.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/, p.name);
  }
});

test('marketplace: as três locais apontam para pasta com plugin.json de mesmo nome e versão', () => {
  const m = ler('.claude-plugin/marketplace.json');
  const locais = m.plugins.filter((p) => typeof p.source === 'string');
  assert.deepEqual(locais.map((p) => p.name).sort(), ['hadouken', 'hadouken-kit', 'hadouken-rea']);
  for (const p of locais) {
    const man = ler(path.join(p.source, '.claude-plugin', 'plugin.json'));
    assert.equal(man.name, p.name, p.source);
    assert.equal(man.version, p.version, `${p.name}: versão do marketplace = do plugin.json`);
  }
});

test('marketplace: cada terceiro com fonte url/git-subdir, sha de 40 hex e sem versão própria', () => {
  const m = ler('.claude-plugin/marketplace.json');
  const terceiros = m.plugins.filter((p) => typeof p.source !== 'string');
  assert.deepEqual(terceiros.map((p) => p.name).sort(), Object.keys(TERCEIROS).sort());
  for (const p of terceiros) {
    // O sha é do robô (kit-atualizar): sobe a cada versão nova do terceiro.
    const { sha: _a, ...fonte } = p.source;
    const { sha: _b, ...esperada } = TERCEIROS[p.name];
    assert.deepEqual(fonte, esperada, p.name);
    assert.match(p.source.sha, /^[0-9a-f]{40}$/, p.name);
    assert.equal(p.version, undefined, `${p.name}: a versão vem do plugin.json do terceiro`);
  }
});

test('marketplace: allowlist só com o oficial', () => {
  const m = ler('.claude-plugin/marketplace.json');
  assert.deepEqual(m.allowCrossMarketplaceDependenciesOn, ALLOW);
  const kit = ler('kit/.claude-plugin/plugin.json');
  for (const d of kit.dependencies) {
    if (typeof d === 'object' && d.marketplace) assert.ok(ALLOW.includes(d.marketplace), d.name);
  }
});

test('kit: versão igual à do marketplace, dependências só por nome (menos o superpowers) e sem faixa de versão', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.equal(kit.name, 'hadouken-kit');
  assert.match(kit.version, /^\d+\.\d+\.\d+$/);
  assert.equal(ler('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'hadouken-kit').version, kit.version);
  assert.deepEqual(kit.dependencies, [
    'hadouken',
    { name: 'superpowers', marketplace: 'claude-plugins-official' },
    'mattpocock-skills',
    'poka-yoke',
    'fullstack-dev-skills',
    'ui-ux-pro-max',
  ]);
  for (const d of kit.dependencies) if (typeof d === 'object') assert.equal(d.version, undefined, d.name);
});

// v0.5.1: o kit leva código próprio (MIT) e a cópia do graphify 0.9.25
// (Apache-2.0, com o LICENSE dela); o rótulo diz os dois.
test('kit: licença MIT AND Apache-2.0, como o conteúdo', () => {
  assert.equal(ler('kit/.claude-plugin/plugin.json').license, 'MIT AND Apache-2.0');
  assert.match(fs.readFileSync(path.join(repo, 'kit', 'skills', 'graphify', 'LICENSE'), 'utf8'), /Apache License/);
});

test('kit: o REA não é dependência do kit (dependência sobe sempre ligada)', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.ok(!JSON.stringify(kit.dependencies).includes('rea'));
});

test('testado.json: uma versão para cada dependência, chaves novas e as mesmas versões', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  const t = ler('kit/testado.json');
  const chaves = kit.dependencies.map((d) =>
    typeof d === 'string' ? `${d}@claude-hadouken` : `${d.name}@${d.marketplace}`).sort();
  assert.deepEqual(Object.keys(t.dependencias).sort(), chaves);
  for (const v of Object.values(t.dependencias)) assert.match(v, /^\d+\.\d+\.\d+$/);
  // As versões dos terceiros e do rea-agents são do robô; aqui, só o que anda
  // junto: o principal com o plugin.json, o REA com o lançador, o pip com o
  // instalador (revisão final, Important 3).
  assert.equal(t.dependencias['hadouken@claude-hadouken'], ler('.claude-plugin/plugin.json').version);
  assert.equal(t.npm['rea-agents'], VERSAO_REA);
  assert.deepEqual(t.pip, { graphifyy: GRAPHIFY.split('==')[1] });
});

test('rea: desligado por padrão, MIT, e o .mcp.json abre o lançador com node', () => {
  const r = ler('rea/.claude-plugin/plugin.json');
  assert.equal(r.name, 'hadouken-rea');
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
  assert.equal(ler('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'hadouken-rea').version, r.version);
  assert.equal(r.defaultEnabled, false);
  assert.equal(r.license, 'MIT');
  assert.match(r.description, /permiss/i);
  const mcp = ler('rea/.mcp.json');
  assert.deepEqual(mcp, { mcpServers: { rea: {
    command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/lancar.mjs'] } } });
});

test('hadouken: plugin.json, package.json e marketplace em 0.5.7', () => {
  assert.equal(ler('.claude-plugin/plugin.json').version, '0.5.7');
  assert.equal(ler('package.json').version, '0.5.7');
  assert.equal(ler('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'hadouken').version, '0.5.7');
});

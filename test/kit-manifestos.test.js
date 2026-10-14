import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));

const ALLOW = ['claude-plugins-official', 'mattpocock', 'poka-yoke',
  'clean-architecture-skills', 'fullstack-dev-skills', 'ui-ux-pro-max-skill'];

test('marketplace: três entradas, cada uma aponta para pasta com plugin.json de mesmo nome', () => {
  const m = ler('.claude-plugin/marketplace.json');
  assert.deepEqual(m.plugins.map((p) => p.name).sort(),
    ['claude-hadouken', 'hadouken-kit', 'hadouken-rea']);
  for (const p of m.plugins) {
    const man = ler(path.join(p.source, '.claude-plugin', 'plugin.json'));
    assert.equal(man.name, p.name, p.source);
    assert.equal(man.version, p.version, `${p.name}: versão do marketplace = do plugin.json`);
  }
});

test('marketplace: allowlist exata e toda dependência com marketplace está nela', () => {
  const m = ler('.claude-plugin/marketplace.json');
  assert.deepEqual(m.allowCrossMarketplaceDependenciesOn, ALLOW);
  const kit = ler('kit/.claude-plugin/plugin.json');
  for (const d of kit.dependencies) {
    if (typeof d === 'object' && d.marketplace) assert.ok(ALLOW.includes(d.marketplace), d.name);
  }
});

test('kit: dependências exatas e sem faixa de versão', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.equal(kit.name, 'hadouken-kit');
  assert.equal(kit.version, '1.0.0');
  assert.deepEqual(kit.dependencies, [
    'claude-hadouken',
    { name: 'superpowers', marketplace: 'claude-plugins-official' },
    { name: 'mattpocock-skills', marketplace: 'mattpocock' },
    { name: 'poka-yoke', marketplace: 'poka-yoke' },
    { name: 'clean-architecture', marketplace: 'clean-architecture-skills' },
    { name: 'fullstack-dev-skills', marketplace: 'fullstack-dev-skills' },
    { name: 'ui-ux-pro-max', marketplace: 'ui-ux-pro-max-skill' },
  ]);
  for (const d of kit.dependencies) if (typeof d === 'object') assert.equal(d.version, undefined, d.name);
});

test('kit: o REA não é dependência do kit (dependência sobe sempre ligada)', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.ok(!JSON.stringify(kit.dependencies).includes('rea'));
});

test('testado.json: uma versão para cada dependência, e nenhuma sobrando', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  const t = ler('kit/testado.json');
  const chaves = kit.dependencies.map((d) =>
    typeof d === 'string' ? `${d}@claude-hadouken` : `${d.name}@${d.marketplace}`).sort();
  assert.deepEqual(Object.keys(t.dependencias).sort(), chaves);
  for (const v of Object.values(t.dependencias)) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(t.npm['rea-agents'], '6.1.0');
});

test('rea: desligado por padrão, MIT, e o .mcp.json abre o lançador com node', () => {
  const r = ler('rea/.claude-plugin/plugin.json');
  assert.equal(r.name, 'hadouken-rea');
  assert.equal(r.version, '1.0.0');
  assert.equal(r.defaultEnabled, false);
  assert.equal(r.license, 'MIT');
  assert.match(r.description, /permiss/i);
  const mcp = ler('rea/.mcp.json');
  assert.deepEqual(mcp, { mcpServers: { rea: {
    command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/lancar.mjs'] } } });
});

test('claude-hadouken intocado: plugin.json segue 0.4.0', () => {
  assert.equal(ler('.claude-plugin/plugin.json').version, '0.4.0');
});

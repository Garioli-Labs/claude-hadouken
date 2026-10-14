import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararVersoes, relatorio, fontes, versaoDe } from '../.github/scripts/kit-versoes.mjs';

test('versaoDe: plugin.json direto ou a entrada do marketplace.json', () => {
  assert.equal(versaoDe({ version: '1.2.0' }, { arquivo: 'p.json' }), '1.2.0');
  const m = { plugins: [{ name: 'outro', version: '9.0.0' }, { name: 'clean-architecture', version: '1.0.0' }] };
  assert.equal(versaoDe(m, { entrada: 'clean-architecture' }), '1.0.0');
  assert.equal(versaoDe(m, { entrada: 'sumiu' }), null);
  assert.equal(versaoDe(null, { arquivo: 'p.json' }), null);
  // Em 2026-10-14 o plugin.json do clean-architecture virou link simbólico no
  // upstream (raw devolve o texto do alvo): a fonte dele é o marketplace.json.
  assert.equal(fontes['clean-architecture@clean-architecture-skills'].entrada, 'clean-architecture');
});

test('compararVersoes', () => {
  assert.equal(compararVersoes('1.2.0', '1.2.0'), 'igual');
  assert.equal(compararVersoes('1.2.0', '1.3.5'), 'menor');
  assert.equal(compararVersoes('1.2.0', '1.2.1'), 'menor');
  assert.equal(compararVersoes('1.2.0', '2.0.0'), 'principal');
  assert.equal(compararVersoes('0.4.16', '0.5.0'), 'menor');   // 0.x: só a principal conta
  assert.equal(compararVersoes('6.1.0', '7.0.0'), 'principal');
  assert.equal(compararVersoes('1.2.0', undefined), 'invalida');
  assert.equal(compararVersoes('1.2.0', 'main'), 'invalida');
});

test('relatorio: só principal vira issue; menor e inválida vão para o resumo', () => {
  const r = relatorio(
    { dependencias: { 'a@m': '1.0.0', 'b@m': '1.0.0', 'c@m': '1.0.0' }, npm: { 'rea-agents': '6.1.0' } },
    { 'a@m': '2.0.0', 'b@m': '1.1.0', 'c@m': null, 'npm:rea-agents': '7.0.0' });
  assert.deepEqual(r.principais.map((p) => p.chave), ['a@m', 'npm:rea-agents']);
  assert.match(r.resumo, /b@m.*1\.0\.0.*1\.1\.0/);
  assert.match(r.resumo, /c@m.*não consegui ler/);
});

test('fontes: cada dependência do testado.json tem de onde ler', () => {
  const t = { dependencias: {
    'claude-hadouken@claude-hadouken': '0.4.0', 'superpowers@claude-plugins-official': '6.4.1',
    'mattpocock-skills@mattpocock': '1.2.0', 'poka-yoke@poka-yoke': '0.2.0',
    'clean-architecture@clean-architecture-skills': '1.0.0', 'fullstack-dev-skills@fullstack-dev-skills': '0.4.16',
    'ui-ux-pro-max@ui-ux-pro-max-skill': '2.13.0' } };
  for (const k of Object.keys(t.dependencias)) {
    assert.ok(fontes[k], k);
    assert.match(fontes[k].repo, /^[\w.-]+\/[\w.-]+$/, k);
  }
});

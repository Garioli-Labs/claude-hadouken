import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararVersoes, relatorio, fontes, versaoDe, urlDaFonte } from '../.github/scripts/kit-versoes.mjs';

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

// v0.5.1: publicada abaixo da testada (tag retirada, rebaixamento) não é
// "menor"; aparece como anterior no resumo e não vira issue.
test('compararVersoes: rebaixamento é anterior, em qualquer posição', () => {
  assert.equal(compararVersoes('2.0.0', '1.9.9'), 'anterior');
  assert.equal(compararVersoes('1.3.0', '1.2.9'), 'anterior');
  assert.equal(compararVersoes('1.2.5', '1.2.4'), 'anterior');
  assert.equal(compararVersoes('1.2.0', '1.10.0'), 'menor');   // número, não texto
});

// v0.5.1: a versão publicada vem de repositório de terceiro. Para a issue e o
// resumo vai só o x.y.z lido; o resto do texto fica fora.
test('relatorio: só o x.y.z da publicada chega à issue e ao resumo', () => {
  const lixo = '2.0.0 <img src=x> @todos [link](http://x)';
  const r = relatorio({ dependencias: { 'a@m': '1.0.0' } }, { 'a@m': lixo });
  assert.deepEqual(r.principais, [{ chave: 'a@m', testada: '1.0.0', publicada: '2.0.0' }]);
  assert.doesNotMatch(r.resumo, /img|@todos|http/);
  const s = relatorio({ dependencias: { 'a@m': '1.0.0' } }, { 'a@m': '0.9.0' });
  assert.deepEqual(s.principais, []);
  assert.match(s.resumo, /anterior/);
});

test('relatorio: só principal vira issue; menor e inválida vão para o resumo', () => {
  const r = relatorio(
    { dependencias: { 'a@m': '1.0.0', 'b@m': '1.0.0', 'c@m': '1.0.0' }, npm: { 'rea-agents': '6.1.0' } },
    { 'a@m': '2.0.0', 'b@m': '1.1.0', 'c@m': null, 'npm:rea-agents': '7.0.0' });
  assert.deepEqual(r.principais.map((p) => p.chave), ['a@m', 'npm:rea-agents']);
  assert.match(r.resumo, /b@m.*1\.0\.0.*1\.1\.0/);
  assert.match(r.resumo, /c@m.*não consegui ler/);
});

// v0.5.1: o superpowers que o Claude Code instala é o do sha que o
// marketplace oficial fixa, não o HEAD do obra/superpowers (em 2026-10-14 o
// HEAD era 7.0.0 e o sha fixado, 6.4.1). A fonte lê a entrada e o sha.
test('fontes: superpowers pelo sha fixado no marketplace oficial', () => {
  const f = fontes['superpowers@claude-plugins-official'];
  assert.deepEqual(f, { repo: 'anthropics/claude-plugins-official', arquivo: '.claude-plugin/marketplace.json', entrada: 'superpowers', pelaFonte: '.claude-plugin/plugin.json' });
  const m = { plugins: [{ name: 'superpowers', source: { source: 'url', url: 'https://github.com/obra/superpowers.git', sha: '5bf4e78011075bcfc0dc295f0724994cd123ee71' } }] };
  assert.equal(urlDaFonte(m, f), 'https://raw.githubusercontent.com/obra/superpowers/5bf4e78011075bcfc0dc295f0724994cd123ee71/.claude-plugin/plugin.json');
  for (const ruim of [
    { plugins: [{ name: 'superpowers', source: { source: 'url', url: 'https://gitlab.com/obra/superpowers.git', sha: '5bf4e78011075bcfc0dc295f0724994cd123ee71' } }] },
    { plugins: [{ name: 'superpowers', source: { source: 'url', url: 'https://github.com/obra/superpowers.git', sha: 'main' } }] },
    { plugins: [{ name: 'superpowers', source: { source: 'url', url: 'https://github.com/obra/../x.git', sha: '5bf4e78011075bcfc0dc295f0724994cd123ee71' } }] },
    { plugins: [] }, null,
  ]) assert.equal(urlDaFonte(ruim, f), null, JSON.stringify(ruim));
});

// v0.5.1: confere contra o kit/testado.json de verdade, não contra uma cópia.
test('fontes: cada dependência do testado.json tem de onde ler', async () => {
  const fs = await import('node:fs');
  const t = JSON.parse(fs.readFileSync(new URL('../kit/testado.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(t.dependencias).length >= 6);
  for (const k of Object.keys(t.dependencias)) {
    assert.ok(fontes[k], k);
    assert.match(fontes[k].repo, /^[\w.-]+\/[\w.-]+$/, k);
  }
});

// I5 da revisão final: o job agendado tem issues: write; as actions vão por
// SHA de commit e sem a credencial persistida, como no ci.yml.
test('kit-versoes.yml: actions por SHA, sem credencial persistida e sem cache', async () => {
  const fs = await import('node:fs');
  const y = fs.readFileSync(new URL('../.github/workflows/kit-versoes.yml', import.meta.url), 'utf8');
  const usos = [...y.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(usos.length >= 2);
  for (const u of usos) assert.match(u, /@[0-9a-f]{40}$/, u);
  assert.match(y, /persist-credentials:\s*false/);
  assert.match(y, /package-manager-cache:\s*false/);
});

// v0.5.1: uma issue por versão publicada, aberta ou fechada. Antes a busca
// olhava só as abertas, e fechar a issue a fazia voltar na segunda seguinte.
test('kit-versoes.yml: não reabre a issue de uma versão já avisada', async () => {
  const fs = await import('node:fs');
  const y = fs.readFileSync(new URL('../.github/workflows/kit-versoes.yml', import.meta.url), 'utf8');
  assert.match(y, /gh issue list --state all /);
  assert.doesNotMatch(y, /--state open/);
  assert.match(y, /--search "in:title \\"\$\{titulo\}\\""/);
  assert.match(y, /select\(\.title == \$ENV\.TITULO\)/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { avaliarDependencias, lerRepos, repoDeOrigem, TERCEIROS_KIT } from '../src/instalar/dedup.js';

// v0.6.0, Fatia 1 (spec §4 e casos D1–D10): a avaliação das dependências de
// terceiros do kit é pura sobre o que o `claude plugin list --json` e os
// registros de marketplace dizem. Disco só em pasta temporária.

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk dedup ç '));
  pastas.push(d);
  return d;
};
const p = (version, enabled, scope = 'user') => ({ version, enabled, scope });
const MATT = 'mattpocock-skills@claude-hadouken';
const avaliar = (plugins, { repos = new Map(), testado = {}, deps = [MATT] } = {}) => avaliarDependencias({ deps, plugins: new Map(plugins), repos, testado });

test('TERCEIROS_KIT: as cinco dependências de terceiros, sem o hadouken', () => {
  assert.deepEqual(TERCEIROS_KIT, [
    'superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken', 'poka-yoke@claude-hadouken',
    'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken',
  ]);
});

// ------------------------------------------------------------ avaliarDependencias

test('duplicada por nome', () => {
  const r = avaliarDependencias({
    deps: ['mattpocock-skills@claude-hadouken'], repos: new Map(), testado: {},
    plugins: new Map([['mattpocock-skills@claude-hadouken', p('1.3.2', true)], ['mattpocock-skills@mattpocock', p('1.3.2', true)]]),
  });
  assert.deepEqual(r[0], { id: 'mattpocock-skills@claude-hadouken', nome: 'mattpocock-skills', estado: 'duplicada', instalada: true, equivalente: 'mattpocock-skills@mattpocock', desligada: null, versao: null });
});

test('D4: mesmo repo com outro nome é equivalente; sem a cópia do kit, nada em dobro', () => {
  const repos = new Map([[MATT, 'mattpocock/skills'], ['skills@x', 'mattpocock/skills']]);
  const [r] = avaliar([['skills@x', p('1.3.2', true)]], { repos });
  assert.equal(r.estado, 'equivalente');
  assert.equal(r.equivalente, 'skills@x');
  assert.equal(r.instalada, false);
});

test('repo diferente e nome diferente não é equivalente; repo desconhecido (null) nunca casa', () => {
  const [a] = avaliar([['skills@x', p('1', true)]], { repos: new Map([[MATT, 'mattpocock/skills'], ['skills@x', 'outro/skills']]) });
  assert.equal(a.estado, 'ausente');
  const [b] = avaliar([['skills@x', p('1', true)]], { repos: new Map([[MATT, null], ['skills@x', null]]) });
  assert.equal(b.estado, 'ausente');
});

test('D3: homônimo de repo diferente conta como equivalente', () => {
  const repos = new Map([[MATT, 'mattpocock/skills'], ['mattpocock-skills@outro', 'fulano/skills']]);
  const [r] = avaliar([['mattpocock-skills@outro', p('0.1.0', true)]], { repos });
  assert.equal(r.estado, 'equivalente');
  assert.equal(r.equivalente, 'mattpocock-skills@outro');
});

test('D1: cópia do usuário desligada não conta; a do kit ligada é própria', () => {
  const [r] = avaliar([[MATT, p('1.3.2', true)], ['mattpocock-skills@mattpocock', p('1.3.2', false)]]);
  assert.equal(r.estado, 'propria');
  assert.equal(r.equivalente, null);
  assert.equal(r.instalada, true);
});

test('sem cópia nenhuma: ausente e não instalada', () => {
  const [r] = avaliar([]);
  assert.deepEqual(r, { id: MATT, nome: 'mattpocock-skills', estado: 'ausente', instalada: false, equivalente: null, desligada: null, versao: null });
});

test('D5: escopo project é ignorado, na do usuário e na do kit', () => {
  const [a] = avaliar([['mattpocock-skills@mattpocock', p('1.3.2', true, 'project')]]);
  assert.equal(a.estado, 'ausente');
  assert.equal(a.equivalente, null);
  const [b] = avaliar([[MATT, p('1.3.2', true, 'project')]]);
  assert.deepEqual([b.estado, b.instalada], ['ausente', false]);
});

test('cópia do kit instalada e desligada, sem equivalente: ausente mas instalada', () => {
  const [r] = avaliar([[MATT, p('1.3.2', false)]]);
  assert.deepEqual([r.estado, r.instalada, r.equivalente], ['ausente', true, null]);
});

test('cópia do kit desligada com equivalente ligado: equivalente, instalada', () => {
  const [r] = avaliar([[MATT, p('1.3.2', false)], ['mattpocock-skills@mattpocock', p('1.3.2', true)]]);
  assert.deepEqual([r.estado, r.instalada, r.equivalente], ['equivalente', true, 'mattpocock-skills@mattpocock']);
});

test('o equivalente é o primeiro id em ordem alfabética', () => {
  const [r] = avaliar([['mattpocock-skills@zeta', p('1', true)], ['mattpocock-skills@alfa', p('1', true)], ['mattpocock-skills@mm', p('1', true)]]);
  assert.equal(r.equivalente, 'mattpocock-skills@alfa');
});

test('versão do equivalente diferente da testada: as duas versões; igual (D9) ou sem testada: null', () => {
  const eq = (v) => [['mattpocock-skills@mattpocock', p(v, true)]];
  const testado = { [MATT]: '1.3.2' };
  assert.deepEqual(avaliar(eq('1.3.1'), { testado })[0].versao, { equivalente: '1.3.1', testada: '1.3.2' });
  assert.equal(avaliar(eq('1.3.2'), { testado })[0].versao, null, 'D9');
  assert.equal(avaliar(eq('1.3.1'))[0].versao, null, 'sem testado.json');
  const dupla = avaliar([[MATT, p('1.3.2', true)], ...eq('1.3.1')], { testado })[0];
  assert.deepEqual([dupla.estado, dupla.versao], ['duplicada', { equivalente: '1.3.1', testada: '1.3.2' }]);
});

test('D10: superpowers de outro marketplace segue a mesma regra', () => {
  const [r] = avaliar([['superpowers@claude-plugins-official', p('6.4.1', false)], ['superpowers@outro', p('6.4.0', true)]], { deps: ['superpowers@claude-plugins-official'] });
  assert.deepEqual([r.estado, r.equivalente, r.instalada], ['equivalente', 'superpowers@outro', true]);
});

test('uma avaliação por dependência, na ordem de deps; entradas de lixo não derrubam', () => {
  const r = avaliarDependencias({ deps: ['a@m', 'b@m'], plugins: new Map([['a@m', p('1', true)]]), repos: new Map(), testado: {} });
  assert.deepEqual(r.map((x) => [x.id, x.estado]), [['a@m', 'propria'], ['b@m', 'ausente']]);
  assert.deepEqual(avaliarDependencias({ deps: ['a@m'], plugins: null, repos: undefined, testado: null }).map((x) => x.estado), ['ausente']);
});

// ------------------------------------------------------------ repoDeOrigem

test('repoDeOrigem: relativo, github, url e git-subdir normalizados; o resto é null', () => {
  assert.equal(repoDeOrigem('./', 'mattpocock/skills'), 'mattpocock/skills');
  assert.equal(repoDeOrigem('./', 'MattPocock/Skills'), 'mattpocock/skills');
  assert.equal(repoDeOrigem('./', null), null);
  assert.equal(repoDeOrigem({ source: 'github', repo: 'A/B' }), 'a/b');
  assert.equal(repoDeOrigem({ source: 'url', url: 'https://github.com/jeffallan/claude-skills.git' }), 'jeffallan/claude-skills');
  assert.equal(repoDeOrigem({ source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke' }), 'rainmanjam/poka-yoke/plugins/poka-yoke');
  assert.equal(repoDeOrigem({ source: 'url', url: 'https://gitlab.com/x/y.git' }), null);
  assert.equal(repoDeOrigem({ source: 'npm', package: 'x' }), null);
  assert.equal(repoDeOrigem(undefined, 'a/b'), null);
  assert.equal(repoDeOrigem({ source: 'github', repo: 'semBarra' }), null);
});

test('repoDeOrigem: origem = repo + subpasta (D4, D11), minúsculas, sem ./ e sem / no fim', () => {
  assert.equal(repoDeOrigem('./plugins/outro', 'Dono/Mono'), 'dono/mono/plugins/outro');
  assert.equal(repoDeOrigem('./plugins/Outro/', 'dono/mono'), 'dono/mono/plugins/outro');
  assert.equal(repoDeOrigem('./', 'dono/mono'), 'dono/mono');
  assert.equal(repoDeOrigem('.', 'dono/mono'), 'dono/mono');
  assert.equal(repoDeOrigem('./plugins/outro', null), null);
  assert.equal(repoDeOrigem({ source: 'git-subdir', url: 'https://github.com/A/B', path: './Plugins/X/' }), 'a/b/plugins/x');
  assert.equal(repoDeOrigem({ source: 'git-subdir', url: 'https://github.com/a/b.git', path: '' }), 'a/b');
  assert.equal(repoDeOrigem({ source: 'git-subdir', url: 'https://github.com/a/b.git' }), null, 'git-subdir sem path não tem origem');
  assert.equal(repoDeOrigem({ source: 'url', url: 'https://github.com/a/b.git', path: 'x' }), 'a/b', 'url vale só o repo');
  assert.equal(repoDeOrigem({ source: 'github', repo: 'a/b', path: 'x' }), 'a/b', 'github vale só o repo');
});

// ------------------------------------------------------------ lerRepos

test('lerRepos: repo de cada plugin pelo known_marketplaces.json e pelo marketplace.json de cada um', () => {
  const d = novoTmp();
  const loc = path.join(d, 'marketplaces', 'mattpocock');
  const outro = path.join(d, 'marketplaces', 'claude-hadouken');
  fs.mkdirSync(path.join(loc, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(outro, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(d, 'known_marketplaces.json'), JSON.stringify({
    mattpocock: { source: { source: 'github', repo: 'mattpocock/skills' }, installLocation: loc },
    'claude-hadouken': { source: { source: 'github', repo: 'Garioli-Labs/claude-hadouken' }, installLocation: outro },
    quebrado: { source: { source: 'github', repo: 'x/y' }, installLocation: path.join(d, 'nao-existe') },
  }));
  fs.writeFileSync(path.join(loc, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'mattpocock-skills', source: './' }] }));
  fs.writeFileSync(path.join(outro, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [
    { name: 'hadouken', source: './' },
    { name: 'poka-yoke', source: { source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke', sha: 'abc' } },
    { name: 'sem-repo', source: { source: 'url', url: 'https://gitlab.com/x/y.git' } },
  ] }));
  const repos = lerRepos(d);
  assert.equal(repos.get('mattpocock-skills@mattpocock'), 'mattpocock/skills');
  assert.equal(repos.get('hadouken@claude-hadouken'), 'garioli-labs/claude-hadouken');
  assert.equal(repos.get('poka-yoke@claude-hadouken'), 'rainmanjam/poka-yoke/plugins/poka-yoke');
  assert.equal(repos.get('sem-repo@claude-hadouken'), null);
  assert.equal(repos.size, 4, 'marketplace ilegível é pulado');
});

test('lerRepos: pasta sem known_marketplaces.json, JSON inválido ou forma errada dão Map vazio, sem lançar', () => {
  const d = novoTmp();
  assert.equal(lerRepos(d).size, 0);
  assert.equal(lerRepos(path.join(d, 'nao-existe')).size, 0);
  assert.equal(lerRepos(undefined).size, 0);
  fs.writeFileSync(path.join(d, 'known_marketplaces.json'), '{');
  assert.equal(lerRepos(d).size, 0);
  fs.writeFileSync(path.join(d, 'known_marketplaces.json'), '[]');
  assert.equal(lerRepos(d).size, 0);
});

// ------------------------------------------------------------ D11 e D4 com subpasta, pelos registros

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(conteudo));
}
// known_marketplaces.json + marketplace.json de cada marketplace: { nome: { repo, plugins } }.
function registrar(d, marketplaces) {
  const conhecidos = {};
  for (const [nome, m] of Object.entries(marketplaces)) {
    const loc = path.join(d, 'marketplaces', nome);
    conhecidos[nome] = { source: { source: 'github', repo: m.repo }, installLocation: loc };
    gravar(path.join(loc, '.claude-plugin', 'marketplace.json'), { plugins: m.plugins });
  }
  gravar(path.join(d, 'known_marketplaces.json'), conhecidos);
}

test('D11: plugin irmão de um marketplace monorepo (subpasta) não é equivalente de uma dependência do mesmo repo na raiz', () => {
  const d = novoTmp();
  const FULL = 'fullstack-dev-skills@claude-hadouken';
  registrar(d, {
    'claude-hadouken': { repo: 'Garioli-Labs/claude-hadouken', plugins: [{ name: 'fullstack-dev-skills', source: { source: 'url', url: 'https://github.com/Mono/Repo.git' } }] },
    mk: { repo: 'mono/repo', plugins: [{ name: 'outro-plugin', source: './plugins/outro' }, { name: 'raiz-plugin', source: './' }] },
  });
  const repos = lerRepos(d);
  assert.equal(repos.get('outro-plugin@mk'), 'mono/repo/plugins/outro');
  assert.equal(repos.get(FULL), 'mono/repo');
  const [irmao] = avaliar([[FULL, p('1.0.0', true)], ['outro-plugin@mk', p('1.0.0', true)]], { repos, deps: [FULL] });
  assert.deepEqual([irmao.estado, irmao.equivalente], ['propria', null]);
  const [raiz] = avaliar([[FULL, p('1.0.0', true)], ['raiz-plugin@mk', p('1.0.0', true)]], { repos, deps: [FULL] });
  assert.deepEqual([raiz.estado, raiz.equivalente], ['duplicada', 'raiz-plugin@mk'], 'a mesma raiz do mesmo repo é equivalente');
});

test('D4 com subpasta: poka-yoke de um marketplace relativo em plugins/poka-yoke é equivalente ao git-subdir do kit', () => {
  const d = novoTmp();
  const POKA = 'poka-yoke@claude-hadouken';
  registrar(d, {
    'claude-hadouken': { repo: 'Garioli-Labs/claude-hadouken', plugins: [{ name: 'poka-yoke', source: { source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke' } }] },
    'poka-yoke': { repo: 'rainmanjam/poka-yoke', plugins: [{ name: 'guardrails', source: './plugins/poka-yoke' }, { name: 'poka-yoke-docs', source: './docs' }] },
  });
  const repos = lerRepos(d);
  const [a] = avaliar([['guardrails@poka-yoke', p('0.2.0', true)]], { repos, deps: [POKA] });
  assert.deepEqual([a.estado, a.equivalente], ['equivalente', 'guardrails@poka-yoke']);
  const [b] = avaliar([['poka-yoke-docs@poka-yoke', p('0.2.0', true)]], { repos, deps: [POKA] });
  assert.equal(b.estado, 'ausente', 'outra subpasta do mesmo repo não conta');
});

test('D1: cópia do usuário desligada (mesmo nome ou mesma origem) aparece em `desligada`; ligada ou de outra origem, não', () => {
  const [a] = avaliar([[MATT, p('1.3.2', true)], ['mattpocock-skills@mattpocock', p('1.3.2', false)]]);
  assert.deepEqual([a.estado, a.desligada], ['propria', 'mattpocock-skills@mattpocock']);
  const repos = new Map([[MATT, 'mattpocock/skills'], ['skills@x', 'mattpocock/skills'], ['skills@y', 'outro/skills']]);
  const [b] = avaliar([[MATT, p('1.3.2', true)], ['skills@x', p('1', false)], ['skills@y', p('1', false)]], { repos });
  assert.equal(b.desligada, 'skills@x');
  const [c] = avaliar([[MATT, p('1.3.2', true)], ['skills@y', p('1', false)]], { repos });
  assert.equal(c.desligada, null);
  const [d] = avaliar([[MATT, p('1.3.2', true)], ['mattpocock-skills@mattpocock', p('1.3.2', false, 'project')]]);
  assert.equal(d.desligada, null, 'escopo project é ignorado');
});

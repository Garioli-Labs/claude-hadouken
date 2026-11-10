import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as proj from '../src/instalar/dedup.js';
import * as kit from '../kit/hooks/dependencias.js';

// v0.6.0, Fatia 1, Tarefa 2 (spec §4 "SessionStart do kit" e "kit autocontido",
// casos D6, D7 e D8; plano RF1 e RF2). O kit é autocontido (o cache dele não
// tem src/): kit/hooks/dependencias.js é cópia da avaliação de
// src/instalar/dedup.js, e o teste de paridade garante o mesmo resultado para
// as mesmas fixtures. Disco só em pasta temporária.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLUXO = path.join(repo, 'kit', 'hooks', 'fluxo.js');
const RAIZ_KIT = path.join(repo, 'kit');

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk kitdep ç '));
  pastas.push(d);
  return d;
};
const gravar = (arquivo, conteudo) => {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
};

const p = (version, enabled, scope = 'user', extra = {}) => ({ version, enabled, scope, ...extra });
const MATT = 'mattpocock-skills@claude-hadouken';
const POKA = 'poka-yoke@claude-hadouken';
const MATT_USUARIO = 'mattpocock-skills@mattpocock';
const KIT = 'hadouken-kit@claude-hadouken';

// ------------------------------------------------------------ paridade

test('paridade: TERCEIROS_KIT igual nas duas cópias', () => {
  assert.deepEqual(kit.TERCEIROS_KIT, proj.TERCEIROS_KIT);
  assert.deepEqual([...kit.TERCEIROS_KIT], [
    'superpowers@claude-plugins-official', MATT, POKA,
    'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken',
  ]);
});

// As fixtures de test/dedup.test.js, uma por caso.
const CASOS = [
  ['duplicada por nome', { deps: [MATT], plugins: [[MATT, p('1.3.2', true)], [MATT_USUARIO, p('1.3.2', true)]] }],
  ['D4 mesmo repo, outro nome', { deps: [MATT], repos: [[MATT, 'mattpocock/skills'], ['skills@x', 'mattpocock/skills']], plugins: [['skills@x', p('1.3.2', true)]] }],
  ['repo e nome diferentes', { deps: [MATT], repos: [[MATT, 'mattpocock/skills'], ['skills@x', 'outro/skills']], plugins: [['skills@x', p('1', true)]] }],
  ['repo desconhecido nunca casa', { deps: [MATT], repos: [[MATT, null], ['skills@x', null]], plugins: [['skills@x', p('1', true)]] }],
  ['D3 homônimo de outro repo', { deps: [MATT], repos: [[MATT, 'mattpocock/skills'], ['mattpocock-skills@outro', 'fulano/skills']], plugins: [['mattpocock-skills@outro', p('0.1.0', true)]] }],
  ['D1 cópia do usuário desligada', { deps: [MATT], plugins: [[MATT, p('1.3.2', true)], [MATT_USUARIO, p('1.3.2', false)]] }],
  ['sem cópia nenhuma', { deps: [MATT], plugins: [] }],
  ['D5 escopo project', { deps: [MATT], plugins: [[MATT_USUARIO, p('1.3.2', true, 'project')], [MATT, p('1.3.2', true, 'project')]] }],
  ['kit instalado e desligado, sem equivalente (D8)', { deps: [MATT], plugins: [[MATT, p('1.3.2', false)]] }],
  ['kit desligado com equivalente ligado', { deps: [MATT], plugins: [[MATT, p('1.3.2', false)], [MATT_USUARIO, p('1.3.2', true)]] }],
  ['equivalente em ordem alfabética', { deps: [MATT], plugins: [['mattpocock-skills@zeta', p('1', true)], ['mattpocock-skills@alfa', p('1', true)], ['mattpocock-skills@mm', p('1', true)]] }],
  ['versão diferente da testada', { deps: [MATT], testado: { [MATT]: '1.3.2' }, plugins: [[MATT_USUARIO, p('1.3.1', true)]] }],
  ['versão igual à testada (D9)', { deps: [MATT], testado: { [MATT]: '1.3.2' }, plugins: [[MATT_USUARIO, p('1.3.2', true)]] }],
  ['D10 superpowers de outro marketplace', { deps: ['superpowers@claude-plugins-official'], plugins: [['superpowers@claude-plugins-official', p('6.4.1', false)], ['superpowers@outro', p('6.4.0', true)]] }],
  ['D11 irmão de monorepo em subpasta não casa com a raiz', { deps: ['fullstack-dev-skills@claude-hadouken'], repos: [['fullstack-dev-skills@claude-hadouken', 'mono/repo'], ['outro-plugin@mk', 'mono/repo/plugins/outro']], plugins: [['fullstack-dev-skills@claude-hadouken', p('1', true)], ['outro-plugin@mk', p('1', true)]] }],
  ['D4 mesma subpasta, nome diferente', { deps: [POKA], repos: [[POKA, 'rainmanjam/poka-yoke/plugins/poka-yoke'], ['guardrails@poka-yoke', 'rainmanjam/poka-yoke/plugins/poka-yoke']], plugins: [['guardrails@poka-yoke', p('0.2.0', true)]] }],
  ['D1 desligada por origem', { deps: [MATT], repos: [[MATT, 'mattpocock/skills'], ['skills@x', 'mattpocock/skills']], plugins: [[MATT, p('1', true)], ['skills@x', p('1', false)]] }],
  ['uma avaliação por dependência, na ordem', { deps: ['a@m', 'b@m'], plugins: [['a@m', p('1', true)]] }],
  ['G1 cópia do kit com auto', { deps: [MATT], plugins: [[MATT, p('1.3.2', true, 'user', { auto: true })], [MATT_USUARIO, p('1.3.2', true)]] }],
  ['G1 auto que não é true', { deps: [MATT], plugins: [[MATT, p('1.3.2', true, 'user', { auto: 'true' })], [MATT_USUARIO, p('1.3.2', true)]] }],
  ['G3 dependentes ligados, desligado, de projeto e o próprio', { deps: [MATT], plugins: [
    [MATT, p('1.3.2', true, 'user', { auto: true, dependencias: [MATT] })], [MATT_USUARIO, p('1.3.2', true)],
    ['z@m', p('1', true, 'user', { dependencias: [MATT] })], ['a@m', p('1', true, 'user', { dependencias: ['x@m', MATT] })],
    ['off@m', p('1', false, 'user', { dependencias: [MATT] })], ['proj@m', p('1', true, 'project', { dependencias: [MATT] })],
    ['lixo@m', p('1', true, 'user', { dependencias: 'x' })],
  ] }],
];

for (const [nome, f] of CASOS) {
  test(`paridade: avaliarDependencias — ${nome}`, () => {
    const entrada = () => ({ deps: f.deps, plugins: new Map(f.plugins), repos: new Map(f.repos ?? []), testado: f.testado ?? {} });
    const esperado = proj.avaliarDependencias(entrada());
    assert.ok(esperado.length > 0, 'a fixture produz avaliação');
    assert.deepStrictEqual(kit.avaliarDependencias(entrada()), esperado);
  });
}

test('paridade: avaliarDependencias com entrada de lixo', () => {
  for (const lixo of [{ deps: ['a@m'], plugins: null, repos: undefined, testado: null }, undefined, {}]) {
    assert.deepStrictEqual(kit.avaliarDependencias(lixo), proj.avaliarDependencias(lixo));
  }
});

test('paridade: repoDeOrigem', () => {
  const entradas = [
    ['./', 'mattpocock/skills'], ['./', 'MattPocock/Skills'], ['./', null], ['.', 'a/b'], ['outro', 'a/b'],
    [{ source: 'github', repo: 'A/B' }], [{ source: 'github', repo: 'semBarra' }],
    [{ source: 'url', url: 'https://github.com/jeffallan/claude-skills.git' }],
    [{ source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke' }],
    [{ source: 'url', url: 'https://gitlab.com/x/y.git' }], [{ source: 'npm', package: 'x' }],
    [undefined, 'a/b'], [null], [42], [[]],
    ['./plugins/outro', 'Dono/Mono'], ['./plugins/Outro/', 'dono/mono'], ['./plugins/outro', null], ['.', 'a/b'],
    [{ source: 'git-subdir', url: 'https://github.com/A/B', path: './Plugins/X/' }],
    [{ source: 'git-subdir', url: 'https://github.com/a/b.git', path: '' }], [{ source: 'git-subdir', url: 'https://github.com/a/b.git' }],
    [{ source: 'url', url: 'https://github.com/a/b.git', path: 'x' }], [{ source: 'github', repo: 'a/b', path: 'x' }],
    [{ source: 'url', url: 'git@github.com:A/B' }], [{ source: 'url', url: 'git@github.com:A/B.git' }], [{ source: 'url', url: 'https://www.github.com/A/B' }],
    [{ source: 'git-subdir', url: 'git@github.com:A/B.git', path: 'plugins/X' }], [{ source: 'git-subdir', url: 'git@github.com:A/B.git' }],
    [{ source: 'url', url: 'git@gitlab.com:A/B.git' }], [{ source: 'url', url: 'git@github.com:semBarra' }],
    ['plugins/x', 'Dono/Mono'], ['Plugins/X/', 'dono/mono'], ['plugins/x', null], ['https://github.com/a/b', 'dono/mono'],
    ['git@github.com:a/b.git', 'dono/mono'], ['/abs/x', 'dono/mono'], ['C:\\x', 'dono/mono'], ['', 'dono/mono'],
  ];
  for (const e of entradas) assert.deepStrictEqual(kit.repoDeOrigem(...e), proj.repoDeOrigem(...e), JSON.stringify(e));
});

function montarMarketplaces(d) {
  const loc = path.join(d, 'marketplaces', 'mattpocock');
  const outro = path.join(d, 'marketplaces', 'claude-hadouken');
  gravar(path.join(d, 'known_marketplaces.json'), {
    mattpocock: { source: { source: 'github', repo: 'mattpocock/skills' }, installLocation: loc },
    'claude-hadouken': { source: { source: 'github', repo: 'Garioli-Labs/claude-hadouken' }, installLocation: outro },
    quebrado: { source: { source: 'github', repo: 'x/y' }, installLocation: path.join(d, 'nao-existe') },
  });
  gravar(path.join(loc, '.claude-plugin', 'marketplace.json'), { plugins: [{ name: 'mattpocock-skills', source: './' }] });
  gravar(path.join(outro, '.claude-plugin', 'marketplace.json'), { plugins: [
    { name: 'hadouken', source: './' },
    { name: 'poka-yoke', source: { source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke', sha: 'abc' } },
    { name: 'sem-repo', source: { source: 'url', url: 'https://gitlab.com/x/y.git' } },
  ] });
}

test('paridade: lerRepos em pasta de fixture (e nos casos de pasta ruim)', () => {
  const d = novoTmp();
  montarMarketplaces(d);
  const esperado = proj.lerRepos(d);
  assert.equal(esperado.size, 4);
  assert.deepStrictEqual(kit.lerRepos(d), esperado);

  const vazia = novoTmp();
  for (const alvo of [vazia, path.join(vazia, 'nao-existe'), undefined]) {
    assert.deepStrictEqual(kit.lerRepos(alvo), proj.lerRepos(alvo));
  }
  for (const conteudo of ['{', '[]']) {
    gravar(path.join(vazia, 'known_marketplaces.json'), conteudo);
    assert.deepStrictEqual(kit.lerRepos(vazia), proj.lerRepos(vazia));
  }
});

test('paridade: lerRepos com marketplace monorepo (subpasta) e a avaliação D11 e D4 por subpasta nas duas cópias', () => {
  const d = novoTmp();
  const FULL = 'fullstack-dev-skills@claude-hadouken';
  const conhecidos = {};
  for (const [nome, repo, plugins] of [
    ['claude-hadouken', 'Garioli-Labs/claude-hadouken', [
      { name: 'fullstack-dev-skills', source: { source: 'url', url: 'https://github.com/Mono/Repo.git' } },
      { name: 'poka-yoke', source: { source: 'git-subdir', url: 'https://github.com/rainmanjam/poka-yoke.git', path: 'plugins/poka-yoke' } },
    ]],
    ['mk', 'mono/repo', [{ name: 'outro-plugin', source: './plugins/outro' }]],
    ['poka-yoke', 'rainmanjam/poka-yoke', [{ name: 'guardrails', source: './plugins/poka-yoke' }]],
  ]) {
    const loc = path.join(d, 'marketplaces', nome);
    conhecidos[nome] = { source: { source: 'github', repo }, installLocation: loc };
    gravar(path.join(loc, '.claude-plugin', 'marketplace.json'), { plugins });
  }
  gravar(path.join(d, 'known_marketplaces.json'), conhecidos);
  const esperado = proj.lerRepos(d);
  assert.deepStrictEqual(kit.lerRepos(d), esperado);
  assert.equal(esperado.get('outro-plugin@mk'), 'mono/repo/plugins/outro');
  assert.equal(esperado.get(POKA), 'rainmanjam/poka-yoke/plugins/poka-yoke');
  const plugins = () => new Map([[FULL, p('1.0.0', true)], [POKA, p('0.2.0', true)], ['outro-plugin@mk', p('1.0.0', true)], ['guardrails@poka-yoke', p('0.2.0', true)]]);
  const avaliacao = proj.avaliarDependencias({ deps: [FULL, POKA], plugins: plugins(), repos: esperado, testado: {} });
  assert.deepEqual(avaliacao.map((a) => [a.id, a.estado, a.equivalente]), [[FULL, 'propria', null], [POKA, 'duplicada', 'guardrails@poka-yoke']]);
  assert.deepStrictEqual(kit.avaliarDependencias({ deps: [FULL, POKA], plugins: plugins(), repos: kit.lerRepos(d), testado: {} }), avaliacao);
});

// ------------------------------------------------------------ lerRegistro

// Monta <cfg>/plugins/installed_plugins.json e <cfg>/settings.json.
// instalados: { id: [entradas] }; habilitados: { id: valor }.
// O registro de um usuário que usa o kit tem o hadouken-kit no escopo user;
// semKit: true tira essa entrada.
function montarConfig({ instalados, habilitados, instaladosBruto, settingsBruto, semKit = false } = {}) {
  const cfg = novoTmp();
  if (instaladosBruto !== undefined) gravar(path.join(cfg, 'plugins', 'installed_plugins.json'), instaladosBruto);
  else if (instalados !== undefined) gravar(path.join(cfg, 'plugins', 'installed_plugins.json'), { version: 2, plugins: semKit ? instalados : { ...instalados, [KIT]: usuario() } });
  if (settingsBruto !== undefined) gravar(path.join(cfg, 'settings.json'), settingsBruto);
  else if (habilitados !== undefined) gravar(path.join(cfg, 'settings.json'), { enabledPlugins: habilitados });
  return cfg;
}
const usuario = (version = '1.0.0', auto = false) => [{ scope: 'user', version, installPath: '/x', ...(auto ? { auto: true } : {}) }];

test('lerRegistro: só scope user, cruzado com enabledPlugins === true; o resto é desligado', () => {
  const cfg = montarConfig({
    instalados: { [MATT]: usuario('1.3.2'), [POKA]: usuario('0.2.0'), 'a@m': usuario('2.0.0'), 'b@m': usuario('3.0.0') },
    habilitados: { [MATT]: true, [POKA]: false, 'a@m': 'true', 'fantasma@m': true },
  });
  const r = kit.lerRegistro(cfg);
  assert.deepEqual([...r.plugins], [
    [MATT, { version: '1.3.2', enabled: true, scope: 'user', installPath: '/x', auto: false, dependencias: [] }],
    [POKA, { version: '0.2.0', enabled: false, scope: 'user', installPath: '/x', auto: false, dependencias: [] }],
    ['a@m', { version: '2.0.0', enabled: false, scope: 'user', installPath: '/x', auto: false, dependencias: [] }],
    ['b@m', { version: '3.0.0', enabled: false, scope: 'user', installPath: '/x', auto: false, dependencias: [] }],
    [KIT, { version: '1.0.0', enabled: false, scope: 'user', installPath: '/x', auto: false, dependencias: [] }],
  ]);
  assert.ok(r.repos instanceof Map);
});

test('G1/G3: lerRegistro lê `auto` da entrada de escopo user e as `dependencias` do manifesto só dos plugins ligados', () => {
  const comManifesto = (dependencies) => {
    const pasta = novoTmp();
    gravar(path.join(pasta, '.claude-plugin', 'plugin.json'), { name: 'x', dependencies });
    return pasta;
  };
  const cfg = montarConfig({
    instalados: {
      [MATT]: [{ scope: 'project', projectPath: '/p', auto: true }, { scope: 'user', version: '1.3.2', installPath: '/x', auto: true }],
      'ligado@mk': [{ scope: 'user', version: '1', installPath: comManifesto(['solta', 'outra@m2', { name: 'obj', version: '^1' }]) }],
      'desligado@mk': [{ scope: 'user', version: '1', installPath: comManifesto(['solta']) }],
      'sem-caminho@mk': [{ scope: 'user', version: '1' }],
    },
    habilitados: { [MATT]: true, 'ligado@mk': true, 'sem-caminho@mk': true },
  });
  const { plugins } = kit.lerRegistro(cfg);
  assert.equal(plugins.get(MATT).auto, true);
  assert.equal(plugins.get('ligado@mk').auto, false);
  assert.deepEqual(plugins.get('ligado@mk').dependencias, ['solta@mk', 'outra@m2', 'obj@mk']);
  assert.deepEqual(plugins.get('desligado@mk').dependencias, [], 'desligado não tem o manifesto lido');
  assert.deepEqual(plugins.get('sem-caminho@mk').dependencias, []);
});

test('G3: dependenciasDoManifesto do kit é igual ao do projeto (paridade) em formatos válidos e inválidos', () => {
  const manifestos = [
    { dependencies: ['solta', 'outra@mk2', { name: 'obj' }, { name: 'obj2', version: '^1.2' }, { name: 'obj3', marketplace: 'mk3' }] },
    { dependencies: ['ok', '', 7, null, { versao: '1' }, { name: 3 }, ['x'], 'a@b@c'] },
    { dependencies: 'solta' }, { name: 'x' }, [], '{quebrado',
  ];
  for (const m of manifestos) {
    const d = novoTmp();
    gravar(path.join(d, '.claude-plugin', 'plugin.json'), m);
    assert.deepStrictEqual(kit.dependenciasDoManifesto(d, 'x@mk1'), proj.dependenciasDoManifesto(d, 'x@mk1'), JSON.stringify(m));
    assert.ok(Array.isArray(kit.dependenciasDoManifesto(d, 'x@mk1')));
  }
  for (const alvo of [novoTmp(), undefined, null, 7]) assert.deepStrictEqual(kit.dependenciasDoManifesto(alvo, 'x@mk1'), proj.dependenciasDoManifesto(alvo, 'x@mk1'));
  assert.deepEqual(kit.dependenciasDoManifesto((() => { const d = novoTmp(); gravar(path.join(d, '.claude-plugin', 'plugin.json'), { dependencies: ['solta'] }); return d; })(), 'x@mk1'), ['solta@mk1']);
});

test('lerRegistro: os repos vêm de <cfg>/plugins/known_marketplaces.json', () => {
  const cfg = montarConfig({ instalados: { [MATT]: usuario() }, habilitados: { [MATT]: true } });
  montarMarketplaces(path.join(cfg, 'plugins'));
  assert.equal(kit.lerRegistro(cfg).repos.get(MATT_USUARIO), 'mattpocock/skills');
});

test('RF1: instalado sem chave em enabledPlugins conta como desligado (não é equivalente, não gera "em dobro")', () => {
  const cfg = montarConfig({
    instalados: { [MATT]: usuario('1.3.2'), [MATT_USUARIO]: usuario('1.3.2') },
    habilitados: { [MATT]: true },
  });
  const { plugins, repos } = kit.lerRegistro(cfg);
  assert.equal(plugins.get(MATT_USUARIO).enabled, false);
  const [a] = kit.avaliarDependencias({ deps: [MATT], plugins, repos, testado: {} });
  assert.equal(a.estado, 'propria');
  assert.equal(a.equivalente, null);
  assert.deepEqual(kit.linhasAviso([a]), []);
});

test('RF2: duas entradas do mesmo id (project e user): só a de usuário conta; só project não conta', () => {
  const cfg = montarConfig({
    instalados: {
      [MATT_USUARIO]: [{ scope: 'project', version: '9.9.9', projectPath: '/p' }, { scope: 'user', version: '1.3.2' }],
      'so-projeto@m': [{ scope: 'project', version: '1.0.0', projectPath: '/p' }],
    },
    habilitados: { [MATT_USUARIO]: true, 'so-projeto@m': true },
  });
  const { plugins } = kit.lerRegistro(cfg);
  assert.deepEqual(plugins.get(MATT_USUARIO), { version: '1.3.2', enabled: true, scope: 'user', installPath: null, auto: false, dependencias: [] });
  assert.equal(plugins.has('so-projeto@m'), false);
  const [dup] = kit.avaliarDependencias({ deps: [MATT], plugins: new Map([...plugins, [MATT, p('1.3.2', true)]]), repos: new Map(), testado: {} });
  assert.deepEqual([dup.estado, dup.equivalente], ['duplicada', MATT_USUARIO]);
  const [sem] = kit.avaliarDependencias({ deps: ['so-projeto@outro'], plugins, repos: new Map(), testado: {} });
  assert.deepEqual([sem.estado, sem.equivalente], ['ausente', null]);
});

test('lerRegistro: qualquer falha de leitura dá null (D6, D7 e formas erradas)', () => {
  const ok = { instalados: { [MATT]: usuario() }, habilitados: { [MATT]: true } };
  assert.notEqual(kit.lerRegistro(montarConfig(ok)), null, 'controle');
  assert.equal(kit.lerRegistro(montarConfig({ habilitados: {} })), null, 'D6: sem installed_plugins.json');
  assert.equal(kit.lerRegistro(montarConfig({ instalados: ok.instalados })), null, 'sem settings.json');
  assert.equal(kit.lerRegistro(montarConfig({ ...ok, settingsBruto: '{quebrado' })), null, 'D7: settings.json inválido');
  assert.equal(kit.lerRegistro(montarConfig({ ...ok, instaladosBruto: '{quebrado' })), null, 'installed_plugins.json inválido');
  assert.equal(kit.lerRegistro(montarConfig({ ...ok, instaladosBruto: { version: 2 } })), null, 'sem plugins');
  assert.equal(kit.lerRegistro(montarConfig({ ...ok, instaladosBruto: { version: 2, plugins: [] } })), null, 'plugins não é objeto');
  assert.equal(kit.lerRegistro(montarConfig({ ...ok, settingsBruto: [] })), null, 'settings não é objeto');
  assert.equal(kit.lerRegistro(montarConfig({ ...ok, settingsBruto: { enabledPlugins: [] } })), null, 'enabledPlugins não é objeto');
  assert.equal(kit.lerRegistro(path.join(novoTmp(), 'nao-existe')), null);
  assert.equal(kit.lerRegistro(undefined), null);
});

test('D12: formato v1 (plugins[id] objeto), plugins {} e registro só de projeto → lerRegistro null', () => {
  const habilitados = { [MATT]: true };
  const v1 = { version: 1, plugins: { [KIT]: { version: '1.0.0', installPath: '/x' }, [MATT]: { version: '1.3.2', installPath: '/y' } } };
  assert.equal(kit.lerRegistro(montarConfig({ habilitados, instaladosBruto: v1 })), null, 'v1');
  assert.equal(kit.lerRegistro(montarConfig({ habilitados, instaladosBruto: { version: 2, plugins: {} } })), null, 'plugins {}');
  const soProjeto = { [KIT]: [{ scope: 'project', version: '1.0.0', projectPath: '/p' }], [MATT]: usuario('1.3.2') };
  assert.equal(kit.lerRegistro(montarConfig({ habilitados, instalados: soProjeto, semKit: true })), null, 'kit só no escopo project');
  assert.equal(kit.lerRegistro(montarConfig({ habilitados, instalados: { [MATT]: usuario('1.3.2') }, semKit: true })), null, 'sem o kit');
  assert.notEqual(kit.lerRegistro(montarConfig({ habilitados, instalados: { [MATT]: usuario('1.3.2') } })), null, 'controle: com o kit no escopo user');
});

test('lerRegistro: settings sem enabledPlugins = tudo desligado; entrada de lixo em um id não derruba os outros', () => {
  const cfg = montarConfig({
    instalados: { [MATT]: usuario(), lixo2: [null, 7], lixo3: [{ scope: 'user' }] },
    settingsBruto: {},
  });
  const { plugins } = kit.lerRegistro(cfg);
  assert.equal(plugins.get(MATT).enabled, false);
  assert.equal(plugins.has('lixo2'), false);
});

// ------------------------------------------------------------ linhasAviso

const av = (id, estado, extra = {}) => ({ id, nome: id.split('@')[0], estado, instalada: false, equivalente: null, versao: null, auto: false, dependentes: [], ...extra });

test('linhasAviso: o texto da duplicada, para o terminal; ausente (instalada ou não), propria e equivalente não geram linha', () => {
  const linhas = kit.linhasAviso([
    av(MATT, 'duplicada', { instalada: true, equivalente: MATT_USUARIO, auto: true }),
    av(POKA, 'ausente'),
    av('fullstack-dev-skills@claude-hadouken', 'ausente', { instalada: true }),
    av('ui-ux-pro-max@claude-hadouken', 'propria', { instalada: true }),
    av('superpowers@claude-plugins-official', 'equivalente', { equivalente: 'superpowers@outro' }),
  ]);
  assert.deepEqual(linhas, [
    'hadouken-kit: mattpocock-skills em dobro (mattpocock-skills@mattpocock e mattpocock-skills@claude-hadouken). Desligue a cópia do kit, no terminal: claude plugin disable mattpocock-skills@claude-hadouken --scope user',
  ]);
});

test('G1 no aviso: duplicada sem `auto` (o usuário instalou as duas) → só avisa que as duas fazem o mesmo e mostra o comando para desligar uma, no terminal', () => {
  const linhas = kit.linhasAviso([av(MATT, 'duplicada', { instalada: true, equivalente: MATT_USUARIO, auto: false })]);
  assert.deepEqual(linhas, [
    'hadouken-kit: mattpocock-skills em dobro (mattpocock-skills@mattpocock e mattpocock-skills@claude-hadouken); as duas fazem o mesmo. Para ficar com uma, no terminal: claude plugin disable mattpocock-skills@claude-hadouken --scope user',
  ]);
});

test('G3 no aviso: duplicada cuja cópia do kit tem dependente ligado não gera linha (o comando falharia), com ou sem `auto`', () => {
  for (const auto of [true, false]) {
    assert.deepEqual(kit.linhasAviso([av(MATT, 'duplicada', { instalada: true, equivalente: MATT_USUARIO, auto, dependentes: ['app@m'] })]), [], `auto=${auto}`);
  }
});

test('G5: todo comando "claude plugin" de aviso diz que é para o terminal', () => {
  const linhas = kit.linhasAviso([
    av(MATT, 'duplicada', { instalada: true, equivalente: MATT_USUARIO, auto: true }),
    av(POKA, 'duplicada', { instalada: true, equivalente: 'guardrails@poka-yoke', auto: false }),
    av('a@m', 'ausente'),
    av('b@m', 'ausente', { instalada: true }),
  ]);
  assert.equal(linhas.length, 2, 'ausente não gera linha');
  for (const l of linhas) assert.match(l, /, no terminal: claude plugin disable /, l);
});

test('linhasAviso: entrada vazia ou de lixo dá lista vazia, sem lançar', () => {
  assert.deepEqual(kit.linhasAviso([]), []);
  assert.deepEqual(kit.linhasAviso(undefined), []);
  assert.deepEqual(kit.linhasAviso(null), []);
  assert.deepEqual(kit.linhasAviso([null, 3, {}]), []);
});

// ------------------------------------------------------------ pastaConfig

test('pastaConfig: CLAUDE_CONFIG_DIR absoluto; senão ~/.claude', () => {
  const casa = path.join(path.sep, 'h');
  const abs = path.resolve(path.sep, 'cfg', 'x');
  assert.equal(kit.pastaConfig({ CLAUDE_CONFIG_DIR: abs }, casa), abs);
  assert.equal(kit.pastaConfig({}, casa), path.join(casa, '.claude'));
  assert.equal(kit.pastaConfig({ CLAUDE_CONFIG_DIR: 'relativo/x' }, casa), path.join(casa, '.claude'));
  assert.equal(kit.pastaConfig({ CLAUDE_CONFIG_DIR: '' }, casa), path.join(casa, '.claude'));
});

// ------------------------------------------------------------ hook (SessionStart do kit)

function rodar(cwd, cfg, { fluxo = FLUXO } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
  return spawnSync(process.execPath, [fluxo], { cwd, input: '', encoding: 'utf8', timeout: 10000, env });
}
function saida(cfg, opcoes) {
  const r = rodar(repo, cfg, opcoes);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const TODAS = Object.fromEntries(proj.TERCEIROS_KIT.map((id) => [id, usuario('1.0.0')]));
const TODAS_LIGADAS = Object.fromEntries(proj.TERCEIROS_KIT.map((id) => [id, true]));
const cenario = ({ instalados = {}, habilitados = {} } = {}) =>
  montarConfig({ instalados: { ...TODAS, ...instalados }, habilitados: { ...TODAS_LIGADAS, ...habilitados } });

// O additionalContext "de hoje": a constante que o fluxo.js sempre imprimiu.
const CONTEXTO = saida(novoTmp()).hookSpecificOutput.additionalContext;

test('hook: pasta de config sem registro (D6) → só o additionalContext de hoje, sem systemMessage', () => {
  const j = saida(novoTmp());
  assert.deepEqual(Object.keys(j), ['hookSpecificOutput']);
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(CONTEXTO, /^hadouken-kit: acione as skills sozinho/);
  assert.ok(CONTEXTO.split('\n').length <= 5);
  assert.ok(CONTEXTO.length <= 2400, `${CONTEXTO.length} caracteres`);
});

test('hook: tudo próprio → sem systemMessage e o mesmo additionalContext', () => {
  const j = saida(cenario());
  assert.equal(j.systemMessage, undefined);
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
});

test('hook: duplicada com a cópia do kit instalada como dependência (auto) → systemMessage com a linha de desligar a cópia do kit, para o terminal, com --scope user', () => {
  const j = saida(cenario({ instalados: { [MATT]: usuario('1.0.0', true), [MATT_USUARIO]: usuario('1.3.2') }, habilitados: { [MATT_USUARIO]: true } }));
  assert.equal(j.systemMessage, 'hadouken-kit: mattpocock-skills em dobro (mattpocock-skills@mattpocock e mattpocock-skills@claude-hadouken). Desligue a cópia do kit, no terminal: claude plugin disable mattpocock-skills@claude-hadouken --scope user');
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
});

test('G1 no hook: duplicada sem `auto` → o aviso diz que as duas fazem o mesmo; não manda desligar a cópia do kit', () => {
  const j = saida(cenario({ instalados: { [MATT_USUARIO]: usuario('1.3.2') }, habilitados: { [MATT_USUARIO]: true } }));
  assert.equal(j.systemMessage, 'hadouken-kit: mattpocock-skills em dobro (mattpocock-skills@mattpocock e mattpocock-skills@claude-hadouken); as duas fazem o mesmo. Para ficar com uma, no terminal: claude plugin disable mattpocock-skills@claude-hadouken --scope user');
  assert.doesNotMatch(j.systemMessage, /Desligue a cópia do kit/);
});

// Plugin do usuário, ligado, com manifesto sintético em tmp, que declara `dependencies`.
function dependenteLigado(id, dependencies, manifestoBruto) {
  const pasta = novoTmp();
  gravar(path.join(pasta, '.claude-plugin', 'plugin.json'), manifestoBruto ?? { name: id.split('@')[0], dependencies });
  return [{ scope: 'user', version: '1.0.0', installPath: pasta }];
}

test('G3 no hook: outro plugin ligado depende da cópia do kit → nenhuma linha de disable (o comando falharia); desligado ou manifesto ilegível, a linha volta', () => {
  const base = { [MATT]: usuario('1.0.0', true), [MATT_USUARIO]: usuario('1.3.2') };
  const ligado = cenario({ instalados: { ...base, 'app@claude-hadouken': dependenteLigado('app@claude-hadouken', ['mattpocock-skills']) }, habilitados: { [MATT_USUARIO]: true, 'app@claude-hadouken': true } });
  assert.equal(saida(ligado).systemMessage, undefined);
  const objeto = cenario({ instalados: { ...base, 'app@x': dependenteLigado('app@x', [{ name: 'mattpocock-skills', marketplace: 'claude-hadouken', version: '^1.3' }]) }, habilitados: { [MATT_USUARIO]: true, 'app@x': true } });
  assert.equal(saida(objeto).systemMessage, undefined, 'objeto com marketplace');
  const desligado = cenario({ instalados: { ...base, 'app@claude-hadouken': dependenteLigado('app@claude-hadouken', [MATT]) }, habilitados: { [MATT_USUARIO]: true } });
  assert.match(saida(desligado).systemMessage, /Desligue a cópia do kit, no terminal: claude plugin disable mattpocock-skills@claude-hadouken --scope user/);
  const quebrado = cenario({ instalados: { ...base, 'app@claude-hadouken': dependenteLigado('app@claude-hadouken', null, '{quebrado') }, habilitados: { [MATT_USUARIO]: true, 'app@claude-hadouken': true } });
  assert.match(saida(quebrado).systemMessage, /^hadouken-kit: mattpocock-skills em dobro/, 'manifesto ilegível = sem dependências');
});

test('hook: terceiro ausente e não instalado → sem systemMessage (é sugerido, não exigido)', () => {
  const cfg = montarConfig({
    instalados: Object.fromEntries(Object.entries(TODAS).filter(([id]) => id !== POKA)),
    habilitados: TODAS_LIGADAS,
  });
  const j = saida(cfg);
  assert.equal(j.systemMessage, undefined);
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
});

test('D8: ausente, instalada e desligada, sem outra cópia → sem systemMessage (o aviso não manda religar)', () => {
  const j = saida(cenario({ habilitados: { [POKA]: false } }));
  assert.equal(j.systemMessage, undefined);
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
});

test('hook: várias linhas se unem por \\n; o terceiro desligado ao lado não gera linha', () => {
  const j = saida(cenario({
    instalados: { [MATT_USUARIO]: usuario(), 'poka-yoke@poka-yoke': usuario() },
    habilitados: { [MATT_USUARIO]: true, 'poka-yoke@poka-yoke': true, 'fullstack-dev-skills@claude-hadouken': false },
  }));
  assert.equal(j.systemMessage.split('\n').length, 2);
  assert.match(j.systemMessage, /^hadouken-kit: mattpocock-skills em dobro/);
  assert.match(j.systemMessage, /\nhadouken-kit: poka-yoke em dobro/);
  assert.doesNotMatch(j.systemMessage, /fullstack/);
});

test('hook: cópia do kit não instalada com equivalente ligado → sem aviso (satisfeita pela outra)', () => {
  const instalados = Object.fromEntries(Object.entries(TODAS).filter(([id]) => id !== MATT));
  const j = saida(montarConfig({
    instalados: { ...instalados, [MATT_USUARIO]: usuario() },
    habilitados: { ...TODAS_LIGADAS, [MATT_USUARIO]: true },
  }));
  assert.equal(j.systemMessage, undefined);
});

test('RF1 no hook: cópia do usuário instalada sem chave em enabledPlugins → sem linha "em dobro"', () => {
  const j = saida(cenario({ instalados: { [MATT_USUARIO]: usuario('1.3.2') } }));
  assert.equal(j.systemMessage, undefined);
});

test('RF2 no hook: cópia do usuário só em escopo project → não conta; com user também → conta', () => {
  const soProjeto = cenario({ instalados: { [MATT_USUARIO]: [{ scope: 'project', version: '1.3.2', projectPath: '/p' }] }, habilitados: { [MATT_USUARIO]: true } });
  assert.equal(saida(soProjeto).systemMessage, undefined);
  const comUsuario = cenario({
    instalados: { [MATT_USUARIO]: [{ scope: 'project', version: '1.3.2', projectPath: '/p' }, { scope: 'user', version: '1.3.2' }] },
    habilitados: { [MATT_USUARIO]: true },
  });
  assert.match(saida(comUsuario).systemMessage, /^hadouken-kit: mattpocock-skills em dobro/);
});

test('D12 no hook: registro v1, plugins {} ou kit só em project → sem systemMessage e o mesmo additionalContext', () => {
  const v1 = { version: 1, plugins: Object.fromEntries([KIT, ...proj.TERCEIROS_KIT].map((id) => [id, { version: '1.0.0', installPath: '/x' }])) };
  const soProjeto = { ...TODAS, [KIT]: [{ scope: 'project', version: '1.0.0', projectPath: '/p' }] };
  for (const [nome, cfg] of [
    ['v1', montarConfig({ instaladosBruto: v1, habilitados: TODAS_LIGADAS })],
    ['plugins {}', montarConfig({ instaladosBruto: { version: 2, plugins: {} }, habilitados: TODAS_LIGADAS })],
    ['kit só em project', montarConfig({ instalados: soProjeto, habilitados: TODAS_LIGADAS, semKit: true })],
  ]) {
    const j = saida(cfg);
    assert.equal(j.systemMessage, undefined, nome);
    assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO, nome);
  }
});

test('D7: settings.json inválido → sem systemMessage, additionalContext igual ao de hoje', () => {
  const cfg = montarConfig({ instalados: { ...TODAS, [MATT_USUARIO]: usuario() }, settingsBruto: '{quebrado' });
  const j = saida(cfg);
  assert.equal(j.systemMessage, undefined);
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
});

test('hook: exceção ao carregar a avaliação → só o additionalContext (fluxo.js sozinho, sem o módulo ao lado)', () => {
  const sozinho = path.join(novoTmp(), 'hooks');
  fs.mkdirSync(sozinho, { recursive: true });
  fs.copyFileSync(FLUXO, path.join(sozinho, 'fluxo.js'));
  fs.copyFileSync(path.join(RAIZ_KIT, 'package.json'), path.join(sozinho, '..', 'package.json'));
  const cfg = cenario({ instalados: { [MATT_USUARIO]: usuario() }, habilitados: { [MATT_USUARIO]: true } });
  const j = saida(cfg, { fluxo: path.join(sozinho, 'fluxo.js') });
  assert.deepEqual(Object.keys(j), ['hookSpecificOutput']);
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
});

test('hook sem package.json ao lado (Node sem detecção de módulo): sai 0 e imprime o additionalContext, sem aviso', () => {
  const sozinho = path.join(novoTmp(), 'hooks');
  fs.mkdirSync(sozinho, { recursive: true });
  fs.copyFileSync(FLUXO, path.join(sozinho, 'fluxo.js'));
  fs.copyFileSync(path.join(RAIZ_KIT, 'hooks', 'dependencias.js'), path.join(sozinho, 'dependencias.js'));
  assert.equal(fs.existsSync(path.join(sozinho, '..', 'package.json')), false);
  const cfg = cenario({ instalados: { [MATT_USUARIO]: usuario() }, habilitados: { [MATT_USUARIO]: true } });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
  const r = spawnSync(process.execPath, ['--no-experimental-detect-module', path.join(sozinho, 'fluxo.js')], { cwd: repo, input: '', encoding: 'utf8', timeout: 10000, env });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.hookSpecificOutput.additionalContext, CONTEXTO);
  assert.equal(j.systemMessage, undefined, 'sem package.json o aviso some, o contexto fica');
});

test('kit autocontido: dependencias.js não importa src/ nem módulo fora de node:', () => {
  const texto = fs.readFileSync(path.join(RAIZ_KIT, 'hooks', 'dependencias.js'), 'utf8');
  const origens = [...texto.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(origens.length >= 3, 'o regex enxerga os imports');
  for (const o of origens) assert.match(o, /^node:/, o);
  assert.doesNotMatch(texto, /\brequire\s*\(/);
});

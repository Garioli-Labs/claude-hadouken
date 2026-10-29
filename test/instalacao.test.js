import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { conferirInstalacao, linhaSessaoAntiga, raizEmUso, textoInstalacao } from '../src/instalacao.js';

// v0.5.7: o hadouken igual em qualquer PC. A versão que vale é a registrada
// no installed_plugins.json do Claude Code; uma sessão aberta antes da
// atualização não puxa atalhos nem extensão para trás, e o /hadouken:saude
// mostra o que difere, com o conserto.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk instalacao ç '));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

// Um PC de mentira: <c>/plugins/cache/claude-hadouken/hadouken/<versões>, o
// installed_plugins.json e a pasta de dados com bin/ e painel/.
function montarPc({ versoes = ['0.5.5', '0.5.6'], registrada = '0.5.6', instalados = null, extensao = null, shims = null } = {}) {
  const base = path.join(tmp, `pc${n++}`);
  const dirConfig = path.join(base, 'claude');
  const cache = path.join(dirConfig, 'plugins', 'cache', 'claude-hadouken', 'hadouken');
  const raizes = {};
  for (const v of versoes) {
    const r = path.join(cache, v);
    fs.mkdirSync(path.join(r, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(r, 'src'), { recursive: true });
    fs.writeFileSync(path.join(r, 'src', 'statusline.js'), '');
    fs.writeFileSync(path.join(r, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'hadouken', version: v }));
    fs.writeFileSync(path.join(r, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'claude-hadouken', plugins: [], renames: { 'claude-hadouken': 'hadouken' } }));
    raizes[v] = r;
  }
  const plugins = instalados ?? {
    'hadouken@claude-hadouken': [{ scope: 'user', installPath: path.join(cache, registrada), version: registrada }],
  };
  fs.writeFileSync(path.join(dirConfig, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  const dir = path.join(base, 'dados');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'painel'), { recursive: true });
  if (extensao !== null) fs.writeFileSync(path.join(dir, 'painel', 'instalado.json'), JSON.stringify({ versao: extensao, em: 'x' }));
  for (const [nome, v] of Object.entries(shims ?? {})) {
    const alvo = nome === 'painel.mjs' ? 'uso/painel-api.js' : nome.replace('.mjs', '.js');
    fs.writeFileSync(path.join(dir, 'bin', nome), `export * from ${JSON.stringify(pathToFileURL(path.join(raizes[v] ?? path.join(cache, v), 'src', alvo)).href)};\n`);
  }
  return { dirConfig, dir, raizes, cache };
}

test('raizEmUso: sessão antiga (0.5.5) usa a raiz registrada (0.5.6)', () => {
  const pc = montarPc();
  assert.equal(raizEmUso(pc.raizes['0.5.5'], { dirConfig: pc.dirConfig }), pc.raizes['0.5.6']);
  assert.equal(raizEmUso(pc.raizes['0.5.6'], { dirConfig: pc.dirConfig }), pc.raizes['0.5.6']);
});

test('raizEmUso: rebaixar de propósito vale (a registrada é a mais velha)', () => {
  const pc = montarPc({ registrada: '0.5.5' });
  assert.equal(raizEmUso(pc.raizes['0.5.6'], { dirConfig: pc.dirConfig }), pc.raizes['0.5.5']);
});

test('raizEmUso: sem registro, registro de outra pasta (repo de desenvolvimento) ou raiz registrada sumida → a da sessão', () => {
  const pc = montarPc();
  const repo = path.join(tmp, 'repo');
  assert.equal(raizEmUso(repo, { dirConfig: pc.dirConfig }), repo);
  assert.equal(raizEmUso(pc.raizes['0.5.5'], { dirConfig: path.join(tmp, 'nao-existe') }), pc.raizes['0.5.5']);
  const sumida = montarPc({ versoes: ['0.5.5'], registrada: '0.5.6' });
  assert.equal(raizEmUso(sumida.raizes['0.5.5'], { dirConfig: sumida.dirConfig }), sumida.raizes['0.5.5']);
  fs.writeFileSync(path.join(pc.dirConfig, 'plugins', 'installed_plugins.json'), '{quebrado');
  assert.equal(raizEmUso(pc.raizes['0.5.5'], { dirConfig: pc.dirConfig }), pc.raizes['0.5.5']);
  assert.equal(raizEmUso(undefined, { dirConfig: pc.dirConfig }), undefined);
  assert.equal(raizEmUso('relativo', { dirConfig: pc.dirConfig }), 'relativo');
});

test('raizEmUso: com escopo de usuário e de projeto, vale o de usuário; installPath inválido é ignorado', () => {
  const pc = montarPc();
  const gravar = (lista) => fs.writeFileSync(path.join(pc.dirConfig, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'hadouken@claude-hadouken': lista } }));
  gravar([
    { scope: 'project', projectPath: '/p', installPath: pc.raizes['0.5.5'], version: '0.5.5' },
    { scope: 'user', installPath: pc.raizes['0.5.6'], version: '0.5.6' },
  ]);
  assert.equal(raizEmUso(pc.raizes['0.5.5'], { dirConfig: pc.dirConfig }), pc.raizes['0.5.6']);
  gravar([{ scope: 'user', installPath: null, version: '0.5.6' }, { scope: 'user', installPath: 'relativo/0.5.6', version: '0.5.6' }]);
  assert.equal(raizEmUso(pc.raizes['0.5.5'], { dirConfig: pc.dirConfig }), pc.raizes['0.5.5']);
});

test('conferirInstalacao: tudo na registrada → em dia', () => {
  const pc = montarPc({ extensao: '0.5.6', shims: { 'statusline.mjs': '0.5.6', 'cli.mjs': '0.5.6', 'painel.mjs': '0.5.6' } });
  const c = conferirInstalacao({ dir: pc.dir, raiz: pc.raizes['0.5.6'], dirConfig: pc.dirConfig });
  assert.deepEqual(c, { sessao: '0.5.6', registrada: '0.5.6', extensao: '0.5.6', atalhos: ['0.5.6'], restos: [] });
  assert.equal(textoInstalacao(c), 'em dia (plugin, extensão do VS Code e atalhos na 0.5.6)');
});

test('conferirInstalacao: o caso do pc-nando — sessão 0.5.5, extensão 0.5.3, atalho velho e plugin antigo', () => {
  const pc = montarPc({
    extensao: '0.5.3',
    shims: { 'statusline.mjs': '0.5.5', 'cli.mjs': '0.5.5', 'painel.mjs': '0.5.6' },
  });
  const instalados = JSON.parse(fs.readFileSync(path.join(pc.dirConfig, 'plugins', 'installed_plugins.json'), 'utf8'));
  instalados.plugins['claude-hadouken@claude-hadouken'] = [{ scope: 'user', installPath: path.join(pc.dirConfig, 'x'), version: '0.3.0' }];
  instalados.plugins['outro@outra-loja'] = [{ scope: 'user', installPath: '/y', version: '1.0.0' }];
  fs.writeFileSync(path.join(pc.dirConfig, 'plugins', 'installed_plugins.json'), JSON.stringify(instalados));
  const c = conferirInstalacao({ dir: pc.dir, raiz: pc.raizes['0.5.5'], dirConfig: pc.dirConfig });
  assert.deepEqual(c, { sessao: '0.5.5', registrada: '0.5.6', extensao: '0.5.3', atalhos: ['0.5.5', '0.5.6'], restos: ['claude-hadouken@claude-hadouken'] });
  const t = textoInstalacao(c);
  assert.match(t, /esta sessão abriu com a 0\.5\.5 e a instalada é a 0\.5\.6: feche com \/exit e volte com claude -c/);
  assert.match(t, /extensão do VS Code na 0\.5\.3: rode node ~\/\.claude\/hadouken\/bin\/cli\.mjs painel instalar/);
  assert.match(t, /atalhos em 0\.5\.5, 0\.5\.6: a próxima sessão acerta/);
  assert.match(t, /plugin antigo instalado: remova com claude plugin uninstall claude-hadouken@claude-hadouken/);
});

test('conferirInstalacao: sem registro, sem extensão e sem atalhos', () => {
  const pc = montarPc();
  const c = conferirInstalacao({ dir: pc.dir, raiz: pc.raizes['0.5.6'], dirConfig: path.join(tmp, 'nada') });
  assert.deepEqual(c, { sessao: '0.5.6', registrada: null, extensao: null, atalhos: [], restos: [] });
  assert.equal(textoInstalacao(c), 'extensão do VS Code não instalada: rode node ~/.claude/hadouken/bin/cli.mjs painel instalar');
});

test('conferirInstalacao: atalho apontando para versão apagada conta como "ausente"', () => {
  const pc = montarPc({ extensao: '0.5.6', shims: { 'statusline.mjs': '0.4.0', 'cli.mjs': '0.5.6', 'painel.mjs': '0.5.6' } });
  const c = conferirInstalacao({ dir: pc.dir, raiz: pc.raizes['0.5.6'], dirConfig: pc.dirConfig });
  assert.deepEqual(c.atalhos, ['0.5.6', 'ausente']);
  assert.match(textoInstalacao(c), /atalhos em 0\.5\.6, ausente: a próxima sessão acerta/);
});

test('conferirInstalacao e textoInstalacao nunca lançam', () => {
  assert.deepEqual(conferirInstalacao({}), { sessao: null, registrada: null, extensao: null, atalhos: [], restos: [] });
  assert.equal(textoInstalacao(null), 'não deu para conferir agora');
  assert.equal(textoInstalacao(conferirInstalacao({})), 'não deu para conferir agora');
});

test('linhaSessaoAntiga: só com as duas versões válidas e diferentes', () => {
  assert.equal(linhaSessaoAntiga('0.5.5', '0.5.6'),
    'hadouken: esta sessão abriu com o plugin 0.5.5 e o instalado é o 0.5.6. Para usar o novo: /exit e claude -c.');
  assert.equal(linhaSessaoAntiga('0.5.6', '0.5.6'), null);
  assert.equal(linhaSessaoAntiga(null, '0.5.6'), null);
  assert.equal(linhaSessaoAntiga('0.5.5', 'x; rm'), null);
});

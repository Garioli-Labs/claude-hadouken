import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerEventos } from '../src/guarda/registros.js';
import * as msg from '../src/guarda/mensagens.js';

// P5 estendida (Task 0 da parte 2, vinda da revisão final da parte 1, com as
// decisões do controlador): além da pasta de dados, a P5 nega sempre as
// ferramentas de edição nos settings do usuário (~/.claude e
// CLAUDE_CONFIG_DIR) e no próprio plugin (CLAUDE_PLUGIN_ROOT e o que tiver
// claude-hadouken em <config>/plugins/), e, nos settings de projeto, só a
// edição cujo texto novo mexe em hooks, plugins ou disableAllHooks. Cada hook
// num processo filho, com HOME e USERPROFILE falsos (o ~ do filho), pasta de
// dados, CLAUDE_CONFIG_DIR e raiz do plugin temporários e
// HADOUKEN_SEM_PAINEL=1. Nenhum teste toca o ~/.claude de verdade. Sem
// estado.json a guarda não dispara, e nenhuma sessão é registrada.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = path.join(repo, 'src', 'hooks', 'guarda-arquivos.js');
const WIN = process.platform === 'win32';

const raizes = [];
after(() => { for (const r of raizes) fs.rmSync(r, { recursive: true, force: true }); });

function conferirHome(home) {
  assert.ok(typeof home === 'string' && path.isAbsolute(home), `HADOUKEN_HOME ausente: ${home}`);
  assert.ok(home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
}

// casa: o ~ falso; dados: a pasta de dados padrão dentro dele; cfg: o
// CLAUDE_CONFIG_DIR; plugin: a raiz do plugin; projeto: um repositório.
function cenario(nome = 'hdk p5 ç ') {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), nome));
  raizes.push(raiz);
  const c = {
    raiz,
    casa: path.join(raiz, 'casa'),
    cfg: path.join(raiz, 'cfg'),
    plugin: path.join(raiz, 'plugin'),
    projeto: path.join(raiz, 'projeto'),
  };
  c.dados = path.join(c.casa, '.claude', 'hadouken');
  for (const d of [c.dados, c.cfg, path.join(c.plugin, 'hooks'), path.join(c.projeto, '.claude'), path.join(c.projeto, 'src')]) fs.mkdirSync(d, { recursive: true });
  return c;
}

const SOBREPOSTAS = ['HOME', 'USERPROFILE', 'HADOUKEN_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_PLUGIN_ROOT', 'HADOUKEN_SEM_PAINEL', 'CLAUDE_EFFORT', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_ENTRYPOINT'];
function ambiente(c, extra = {}) {
  const env = { ...process.env };
  // No Windows o ambiente não diferencia maiúsculas: nenhuma grafia antiga
  // dessas variáveis sobra ao lado da nova.
  for (const k of Object.keys(env)) if (SOBREPOSTAS.includes(k.toUpperCase())) delete env[k];
  Object.assign(env, {
    HOME: c.casa, USERPROFILE: c.casa, HADOUKEN_HOME: c.dados, CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_PLUGIN_ROOT: c.plugin,
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra,
  });
  conferirHome(env.HADOUKEN_HOME);
  assert.ok(env.HOME.startsWith(os.tmpdir()) && env.USERPROFILE.startsWith(os.tmpdir()), 'casa fora do temporário');
  return env;
}

const ferramenta = (tool_name, tool_input, cwd = os.tmpdir()) => ({ session_id: 'nao-registrada', hook_event_name: 'PreToolUse', tool_name, tool_input, cwd });
const rodar = (c, entrada, extra) => spawnSync(process.execPath, [script], { input: JSON.stringify(entrada), env: ambiente(c, extra), encoding: 'utf8', timeout: 15_000 });
const negacao = (razao) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razao } });

function saida(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.length > 0, 'saída vazia');
  return JSON.parse(r.stdout);
}
function semSaida(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
}
const detalhes = (c) => lerEventos(c.dados, Date.now()).filter((e) => e.tipo === 'arquivo-negado').map((e) => e.detalhe);

const edit = (file_path, new_string = 'b') => ({ file_path, old_string: 'a', new_string });

test('P5: settings do usuário, em ~/.claude e no CLAUDE_CONFIG_DIR, são negados sempre, com qualquer conteúdo', () => {
  const c = cenario();
  // Guarda desligada: a P5 nem lê a configuração.
  fs.writeFileSync(path.join(c.dados, 'config.json'), JSON.stringify({ guarda: { ligada: false } }));
  const settings = path.join(c.casa, '.claude', 'settings.json');
  const casos = [
    ferramenta('Edit', edit(settings)),
    ferramenta('Edit', edit('~/.claude/settings.json', '"permissions": {}')),
    // Relativo a partir de ~/.claude.
    ferramenta('Write', { file_path: 'settings.local.json', content: '{}' }, path.join(c.casa, '.claude')),
    ferramenta('MultiEdit', { file_path: path.join(c.cfg, 'settings.json'), edits: [{ old_string: 'a', new_string: 'b' }] }),
    ferramenta('NotebookEdit', { notebook_path: path.join(c.cfg, 'settings.local.json'), new_source: '' }),
  ];
  if (WIN) {
    casos.push(ferramenta('Edit', edit(settings.toUpperCase())));
    // os.tmpdir() pode vir no nome curto 8.3: o caminho longo também nega.
    const longo = fs.realpathSync.native(c.casa);
    if (longo !== c.casa) casos.push(ferramenta('Write', { file_path: path.join(longo, '.claude', 'settings.json'), content: '{}' }));
  }
  for (const e of casos) assert.deepEqual(saida(rodar(c, e)), negacao(msg.P5_PROTEGIDO_TEXTO), JSON.stringify(e.tool_input));
  assert.deepEqual(detalhes(c), Array(casos.length).fill('P5:settings'));
});

test('P5: a raiz do plugin e o claude-hadouken dentro de plugins/ são negados sempre', () => {
  const c = cenario();
  const cache = path.join(c.casa, '.claude', 'plugins', 'cache', 'x', 'claude-hadouken', '0.4.0', 'src', 'guarda', 'caminho.js');
  const casos = [
    ferramenta('Edit', edit(path.join(c.plugin, 'hooks', 'hooks.json'))),
    ferramenta('Edit', edit(cache)),
    ferramenta('Write', { file_path: path.join(c.casa, '.claude', 'plugins', 'marketplaces', 'claude-hadouken', 'README.md'), content: '' }),
    // Com CLAUDE_CONFIG_DIR, os plugins ficam nele.
    ferramenta('Write', { file_path: path.join(c.cfg, 'plugins', 'cache', 'm', 'claude-hadouken', '0.4.0', 'src', 'x.js'), content: '' }),
    ferramenta('NotebookEdit', { notebook_path: path.join(c.plugin, 'n.ipynb'), new_source: '' }),
    ferramenta('Edit', edit(path.join(c.plugin, 'hooks', '..', 'src', 'hooks', 'guarda-arquivos.js'))),
  ];
  if (WIN) casos.push(ferramenta('MultiEdit', { file_path: cache.toUpperCase(), edits: [] }));
  for (const e of casos) assert.deepEqual(saida(rodar(c, e)), negacao(msg.P5_PROTEGIDO_TEXTO), JSON.stringify(e.tool_input));
  assert.deepEqual(detalhes(c), Array(casos.length).fill('P5:plugin'));
});

// Decisão do controlador (opção E): os settings de projeto também desligam
// os hooks do plugin (disableAllHooks, enabledPlugins), então a edição nega
// quando o texto novo traz uma dessas chaves, "hooks" ou claude-hadouken. O
// resto do arquivo (permissões, por exemplo) segue editável.
test('P5: settings de projeto negados só quando o texto novo mexe em hooks, plugins ou disableAllHooks', () => {
  const c = cenario();
  const settings = path.join(c.projeto, '.claude', 'settings.json');
  const local = path.join(c.projeto, '.claude', 'settings.local.json');
  const negados = [
    ferramenta('Write', { file_path: settings, content: '{"disableAllHooks": true}' }),
    ferramenta('Edit', edit(settings, '"hooks": {')),
    ferramenta('MultiEdit', { file_path: local, edits: [{ old_string: 'a', new_string: '"allow": []' }, { old_string: 'b', new_string: '"enabledPlugins": {"claude-hadouken@m": false}' }] }),
    // Relativo ao projeto, sem diferenciar maiúsculas.
    ferramenta('Edit', edit(path.join('.claude', 'settings.json'), '"ENABLEDPLUGINS": {}'), c.projeto),
    // A chave escrita com escape \u do JSON.
    ferramenta('Edit', edit(settings, '"disableAll\\u0048ooks": true')),
    ferramenta('Write', { file_path: local, content: '{"permissions": {"allow": ["Edit(~/.claude/plugins/cache/x/claude-hadouken/**)"]}}' }),
  ];
  for (const e of negados) assert.deepEqual(saida(rodar(c, e)), negacao(msg.P5_SETTINGS_PROJETO_TEXTO), JSON.stringify(e.tool_input));
  const passam = [
    ferramenta('Edit', edit(settings, '"allow": ["Bash(npm test)"]')),
    ferramenta('Write', { file_path: settings, content: '{"permissions": {"allow": ["Read"]}}' }),
    // "hooks" só conta como chave, entre aspas.
    ferramenta('Edit', edit(settings, '"allow": ["Bash(npx husky hooks)"]')),
    ferramenta('MultiEdit', { file_path: local, edits: [{ old_string: 'a', new_string: '"deny": ["WebFetch"]' }] }),
    // Outro arquivo na mesma pasta .claude.
    ferramenta('Write', { file_path: path.join(c.projeto, '.claude', 'outro.json'), content: '{"disableAllHooks": true}' }),
  ];
  for (const e of passam) semSaida(rodar(c, e));
  assert.deepEqual(detalhes(c), Array(negados.length).fill('P5:settings-projeto'));
});

test('P5: outro plugin, arquivo comum, Read e raiz de plugin relativa passam', () => {
  const c = cenario();
  const passam = [
    ferramenta('Edit', edit(path.join(c.casa, '.claude', 'plugins', 'cache', 'outro-plugin', 'x.js'))),
    ferramenta('Write', { file_path: path.join(c.projeto, 'src', 'a.js'), content: '' }),
    ferramenta('Read', { file_path: path.join(c.casa, '.claude', 'settings.json') }),
  ];
  for (const e of passam) semSaida(rodar(c, e));
  // CLAUDE_PLUGIN_ROOT só vale como caminho absoluto.
  semSaida(rodar(c, ferramenta('Edit', edit(path.join(c.raiz, 'plugin', 'x.js')), c.raiz), { CLAUDE_PLUGIN_ROOT: 'plugin' }));
  assert.deepEqual(detalhes(c), []);
  // O claude-hadouken só conta no trecho dentro de plugins/: uma casa com esse
  // nome no caminho não nega o outro plugin.
  const d = cenario('claude-hadouken casa ');
  semSaida(rodar(d, ferramenta('Edit', edit(path.join(d.casa, '.claude', 'plugins', 'cache', 'outro-plugin', 'x.js')))));
  assert.deepEqual(detalhes(d), []);
});

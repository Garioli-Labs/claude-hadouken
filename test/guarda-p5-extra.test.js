import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerEventos } from '../src/guarda/registros.js';
import * as msg from '../src/guarda/mensagens.js';
import { mexeNaGuarda } from '../src/guarda/caminho.js';

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

// Rodada 1 da revisão da Task 0: o texto antigo também conta. Um old_string
// curto ('false') casa dentro de uma chave protegida que já está no arquivo e
// vira o valor dela; então, com old_string abaixo de 40 caracteres (Edit ou
// qualquer edits[] do MultiEdit), a P5 lê o arquivo atual (lstat antes, com
// teto) e nega quando ele tem uma das chaves, e nega quando a leitura falha.
// O Write troca o arquivo todo: nega quando o atual tem uma das chaves.
test('P5: settings de projeto negados quando o texto antigo ou o arquivo atual tocam as chaves da guarda', () => {
  const c = cenario();
  const comHooks = path.join(c.projeto, '.claude', 'settings.json');
  const comPlugins = path.join(c.projeto, '.claude', 'settings.local.json');
  fs.writeFileSync(comHooks, '{\n  "disableAllHooks": false,\n  "permissions": {"allow": ["Bash(npm test)"]}\n}\n');
  fs.writeFileSync(comPlugins, '{"enabledPlugins": {"claude-hadouken@m": true}}');
  const outro = path.join(c.raiz, 'outro');
  fs.mkdirSync(path.join(outro, '.claude'), { recursive: true });
  const semChaves = path.join(outro, '.claude', 'settings.json');
  fs.writeFileSync(semChaves, '{"permissions": {"allow": []}, "spinnerTipsEnabled": false, "x": true}');
  // Leitura que falha: acima do teto (1 MiB) e uma pasta no lugar do arquivo.
  const grande = path.join(outro, '.claude', 'settings.local.json');
  fs.writeFileSync(grande, `{"x": "${'a'.repeat(1_048_576)}"}`);
  const terceiro = path.join(c.raiz, 'terceiro');
  const pasta = path.join(terceiro, '.claude', 'settings.json');
  fs.mkdirSync(pasta, { recursive: true });
  const negados = [
    ferramenta('Edit', { file_path: comHooks, old_string: 'false', new_string: 'true' }),
    ferramenta('Edit', { file_path: comPlugins, old_string: 'true', new_string: 'false' }),
    ferramenta('MultiEdit', { file_path: comHooks, edits: [{ old_string: '"allow": ["Bash(npm test)"]', new_string: '"allow": []' }, { old_string: 'false', new_string: 'true' }] }),
    // old_string longo com a chave: apagar ou trocar a chave conta.
    ferramenta('Edit', { file_path: comHooks, old_string: '"disableAllHooks": false,\n  "permissions"', new_string: '"permissions"' }),
    // A chave no old_string de um edits[], com escape \u, num arquivo sem ela.
    ferramenta('MultiEdit', { file_path: semChaves, edits: [{ old_string: '"enabled\\u0050lugins": {"x@m": true}, "permissions": {}', new_string: '"permissions": {}' }] }),
    ferramenta('Write', { file_path: comPlugins, content: '{}' }),
    ferramenta('Edit', { file_path: grande, old_string: 'a', new_string: 'b' }),
    ferramenta('Edit', { file_path: pasta, old_string: 'a', new_string: 'b' }),
  ];
  for (const e of negados) assert.deepEqual(saida(rodar(c, e)), negacao(msg.P5_SETTINGS_PROJETO_TEXTO), JSON.stringify(e.tool_input).slice(0, 200));
  const passam = [
    // A mesma edição curta num settings sem as chaves.
    ferramenta('Edit', { file_path: semChaves, old_string: 'false', new_string: 'true' }),
    ferramenta('MultiEdit', { file_path: semChaves, edits: [{ old_string: 'true', new_string: 'false' }, { old_string: '[]', new_string: '["Read"]' }] }),
    ferramenta('Write', { file_path: semChaves, content: '{"permissions": {"allow": ["Read"]}}' }),
    // old_string de 40 caracteres ou mais, sem as chaves, num arquivo com elas.
    ferramenta('Edit', { file_path: comHooks, old_string: '"permissions": {"allow": ["Bash(npm test)"]}', new_string: '"permissions": {"allow": ["Bash(npm test)", "Read"]}' }),
    // Arquivo ainda inexistente: não há chave atual; o texto novo é conferido.
    ferramenta('Edit', { file_path: path.join(terceiro, '.claude', 'settings.local.json'), old_string: '', new_string: '{"permissions": {}}' }),
  ];
  for (const e of passam) semSaida(rodar(c, e));
  assert.deepEqual(detalhes(c), Array(negados.length).fill('P5:settings-projeto'));
});

// Rodada 2 da revisão da Task 0: depois dos filtros pelo texto, a P5 aplica a
// edição ao arquivo atual (Edit: a primeira ocorrência, ou todas com
// replace_all; MultiEdit: em ordem; Write: o content) e compara
// disableAllHooks, enabledPlugins e hooks antes e depois. Nega quando um
// valor muda, quando o resultado deixa de ser JSON num arquivo que tinha uma
// dessas chaves e quando a edição não se aplica. Fecha o old_string de 40
// caracteres ou mais que cobre só o valor e a chave montada em várias edições.
test('P5: settings de projeto: a edição simulada que muda disableAllHooks, enabledPlugins ou hooks é negada', () => {
  const c = cenario();
  const proj = (nome, texto) => {
    const d = path.join(c.raiz, nome, '.claude');
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, 'settings.json');
    fs.writeFileSync(f, texto);
    return f;
  };
  const PERM = '"permissions": {"allow": ["Bash(npm test)"]}';
  const VALOR = `false, ${PERM}`;
  const REPETIDO = 'false, "env": {"A": "1234567890123456789012345678"}';
  const MONTADA = `AllHookz": true, ${PERM.slice(0, -2)}`;
  for (const t of [PERM, VALOR, REPETIDO, MONTADA]) assert.ok(t.length >= 40, t);
  const valor = proj('valor', `{"disableAllHooks": ${VALOR}}`);
  const todos = proj('todos', `{"permissions": {"x": ${REPETIDO}}, "disableAllHooks": ${REPETIDO}}`);
  const montada = proj('montada', `{"disableAllHookz": true, ${PERM}}`);
  const multi = proj('multi', `{${PERM}}`);
  const quebra = proj('quebra', `{"hooks": {}, ${PERM}}`);
  const plugins = proj('plugins', `{"enabledPlugins": {"claude-hadouken@m": true}, ${PERM}}`);
  const livre = proj('livre', `{${PERM}, "x": 1}`);
  const conserto = proj('conserto', `{${PERM},}`);
  const negados = [
    // old_string longo que cobre só o valor ao lado de "disableAllHooks": .
    ferramenta('Edit', { file_path: valor, old_string: VALOR, new_string: VALOR.replace('false', 'true') }),
    // replace_all que vira false em true também no disableAllHooks.
    ferramenta('Edit', { file_path: todos, old_string: REPETIDO, new_string: REPETIDO.replace('false', 'true'), replace_all: true }),
    // A chave montada: o arquivo tem disableAllHookz e a edição troca o z.
    ferramenta('Edit', { file_path: montada, old_string: MONTADA, new_string: MONTADA.replace('Hookz', 'Hooks') }),
    // Montada dentro de um MultiEdit, sem a palavra inteira em nenhum texto.
    ferramenta('MultiEdit', { file_path: multi, edits: [{ old_string: '{"permissions"', new_string: '{"disableAllHookz": true, "permissions"' }, { old_string: 'Hookz', new_string: 'Hooks' }] }),
    // O resultado deixa de ser JSON num arquivo que tem "hooks".
    ferramenta('Edit', { file_path: quebra, old_string: `${PERM}}`, new_string: PERM }),
    // A edição não se aplica: o old_string não está no arquivo.
    ferramenta('Edit', { file_path: valor, old_string: VALOR.replace('npm test', 'npm run build'), new_string: VALOR }),
  ];
  for (const e of negados) assert.deepEqual(saida(rodar(c, e)), negacao(msg.P5_SETTINGS_PROJETO_TEXTO), JSON.stringify(e.tool_input));
  const passam = [
    // Permissão num arquivo com enabledPlugins: o valor dos plugins não muda.
    ferramenta('Edit', { file_path: plugins, old_string: PERM, new_string: PERM.replace(']', ', "Read"]') }),
    // Sem replace_all, só a primeira ocorrência (a das permissões) muda.
    ferramenta('Edit', { file_path: todos, old_string: REPETIDO, new_string: REPETIDO.replace('false', 'true') }),
    // Resultado fora do JSON num arquivo sem as chaves e sem as palavras.
    ferramenta('Edit', { file_path: livre, old_string: `${PERM}, "x": 1}`, new_string: `${PERM}, "x": 1,}` }),
    // Consertar um settings quebrado sem as chaves.
    ferramenta('Edit', { file_path: conserto, old_string: `${PERM},}`, new_string: `${PERM}}` }),
  ];
  for (const e of passam) semSaida(rodar(c, e));
  assert.deepEqual(detalhes(c), Array(negados.length).fill('P5:settings-projeto'));
});

// A simulação, direto na função, nos limites: hooks aninhado 100 mil níveis
// (a comparação não usa recursão, então não estoura a pilha), a chave com
// escape \u no arquivo, o replace_all que explodiria o tamanho e o
// replace_all que não é booleano. Na dúvida, nega.
test('mexeNaGuarda: a simulação aguenta aninhamento fundo, escape no arquivo e replace_all enorme', () => {
  const PERM = '"permissions": {"allow": ["Bash(npm test)"]}';
  const fundo = 100_000;
  const aninhado = `{"hooks": ${'['.repeat(fundo)}${']'.repeat(fundo)}, ${PERM}}`;
  const ler = (texto) => () => ({ ok: true, texto });
  const perm = { file_path: 'x', old_string: PERM, new_string: PERM.replace(']', ', "Read"]') };
  assert.equal(mexeNaGuarda(perm, ler(aninhado), 'Edit'), false);
  const dentro = `${'['.repeat(40)}]]]`;
  assert.equal(mexeNaGuarda({ file_path: 'x', old_string: dentro, new_string: `${'['.repeat(40)}1]]]` }, ler(aninhado), 'Edit'), true);
  const escapada = `{"disable\\u0041llHooks": false, ${PERM}}`;
  assert.equal(mexeNaGuarda({ file_path: 'x', old_string: `false, ${PERM}`, new_string: `true, ${PERM}` }, ler(escapada), 'Edit'), true);
  const grande = `{"a": "${'b'.repeat(500_000)}"}`;
  assert.equal(mexeNaGuarda({ file_path: 'x', old_string: 'b', new_string: 'c'.repeat(100_000), replace_all: true }, ler(grande), 'Edit'), true);
  const livre = `{${PERM}}`;
  assert.equal(mexeNaGuarda({ ...perm, replace_all: 'true' }, ler(livre), 'Edit'), true);
  assert.equal(mexeNaGuarda({ ...perm, replace_all: false }, ler(livre), 'Edit'), false);
  // Ferramenta desconhecida ou edits que não é lista: a simulação falha.
  assert.equal(mexeNaGuarda(perm, ler(livre), 'NotebookEdit'), true);
  assert.equal(mexeNaGuarda({ file_path: 'x', edits: 'a' }, ler(livre), 'MultiEdit'), true);
  // Fim de linha CRLF no arquivo não impede a simulação de um old_string com LF.
  const crlf = `{\r\n  "disableAllHooks": false,\r\n  ${PERM}\r\n}\r\n`;
  assert.equal(mexeNaGuarda({ file_path: 'x', old_string: `${PERM}\n}`, new_string: `${PERM.replace(']', ', "Read"]')}\n}` }, ler(crlf), 'Edit'), false);
});

// Rodada 1 da revisão da Task 0: o compartilhamento administrativo da própria
// máquina (\\localhost\C$, \\127.0.0.1\C$, \\?\UNC\localhost\C$, com barra
// normal também, e o nome da máquina) vira a letra do disco antes da
// classificação; sem isso, os settings do usuário passavam por esse caminho.
test('P5: settings do usuário pelo compartilhamento administrativo (\\\\localhost\\C$) são negados', { skip: !WIN && 'só Windows' }, () => {
  const c = cenario();
  const settings = path.join(c.casa, '.claude', 'settings.json');
  const disco = settings[0];
  const resto = settings.slice(2);
  const casos = [
    `\\\\localhost\\${disco}$${resto}`,
    `\\\\127.0.0.1\\${disco.toLowerCase()}$${resto}`,
    `\\\\?\\UNC\\LOCALHOST\\${disco}$${resto}`,
    `//localhost/${disco}$${resto.replace(/\\/g, '/')}`,
    `\\\\${os.hostname()}\\${disco}$${resto}`,
  ].map((p) => ferramenta('Edit', edit(p)));
  for (const e of casos) assert.deepEqual(saida(rodar(c, e)), negacao(msg.P5_PROTEGIDO_TEXTO), e.tool_input.file_path);
  assert.deepEqual(detalhes(c), Array(casos.length).fill('P5:settings'));
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

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chamaClaude, claudeComLiberar } from '../src/guarda/caminho.js';
import { protecaoLigada, PROTECOES } from '../src/guarda/protecoes.js';
import { ITEM } from '../src/config/tabela.js';
import { GRUPOS_LIMITES, lerPedidoLimites } from '../src/config/pedido.js';

// Emenda 3 da spec v0.5.3 VS Code (§12): o cwd do hook não conta como
// claude, e cada proteção fixa tem um interruptor no config.json.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CWD = 'C:/Projetos DEV/Claude Hadouken/claude-hadouken';

test('§12.1 o cwd com Claude no meio não conta como claude', () => {
  const opc = { cwd: CWD };
  assert.equal(chamaClaude(`node "${CWD}/x.mjs"`), true, 'sem cwd, o falso positivo de antes');
  assert.equal(chamaClaude(`node "${CWD}/x.mjs"`, opc), false);
  assert.equal(chamaClaude(`node "${CWD.replace(/\//g, '\\')}\\x.mjs"`, opc), false);
  assert.equal(chamaClaude(`node "${CWD.replace(/\//g, '\\')}\\x.mjs"`, { cwd: CWD.replace(/\//g, '\\') }), false);
  assert.equal(chamaClaude('bash "/c/projetos dev/claude hadouken/claude-hadouken/t.sh"', opc), false);
  assert.equal(chamaClaude(`NODE "${CWD.toUpperCase()}/X.MJS"`, opc), false);
  assert.equal(chamaClaude(`cd "${CWD}" && node x.mjs`, opc), false);
  assert.equal(claudeComLiberar(`node "${CWD}/x.mjs" $HOME *.js`), true, 'sem cwd, o falso positivo de antes');
  assert.equal(claudeComLiberar(`node "${CWD}/x.mjs" $HOME *.js`, opc), false);
});

test('§12.1 o que é claude continua sendo', () => {
  const opc = { cwd: CWD };
  assert.equal(chamaClaude(`"${CWD}/claude.exe" -p oi`, opc), true);
  assert.equal(chamaClaude(`node x.mjs && claude -p oi`, opc), true);
  assert.equal(chamaClaude(`cd "${CWD}" && claude -p oi`, opc), true);
  assert.equal(chamaClaude('C:/x/claude -p oi', { cwd: 'C:/x/claude' }), true, 'cwd terminado em claude não some');
  assert.equal(chamaClaude('/usr/bin/claude -p', { cwd: '/' }), true, 'raiz não neutraliza');
  assert.equal(chamaClaude('/usr/bin/claude -p', { cwd: 'usr' }), true, 'relativo não neutraliza');
  assert.equal(chamaClaude('C:/x/claude.exe -p', { cwd: 'C:/x' }), true);
  assert.equal(chamaClaude('C:/xy/claude -p', { cwd: 'C:/x' }), true, 'prefixo sem separador não troca');
  assert.equal(claudeComLiberar(`claude -p "/hadouken:liberar"`, opc), true);
  assert.equal(claudeComLiberar(`node "${CWD}/x.mjs"; claude -p "$X hadouken"`, opc), true);
  assert.equal(chamaClaude(`node x`, { cwd: 42 }), false, 'cwd inválido é ignorado');
});

const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function novoHome(config) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk protecoes '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg'), { recursive: true });
  fs.mkdirSync(path.join(d, 'casa'), { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(d, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return d;
}

test('§12.2 os quatro itens na tabela e no /hadouken:limites', () => {
  assert.deepEqual(PROTECOES, ['protecoes.sessaoFilha', 'protecoes.arquivos', 'protecoes.hooks', 'protecoes.agenda']);
  for (const id of PROTECOES) {
    assert.equal(ITEM[id].tipo, 'booleano');
    assert.equal(ITEM[id].grupo, 'protecoes');
    assert.equal(ITEM[id].padrao, true);
    assert.equal(ITEM[id].frouxo, 'desligar');
  }
  assert.ok(GRUPOS_LIMITES.includes('protecoes'));
  assert.deepEqual(lerPedidoLimites('protecoes.arquivos desliga'), { acao: 'gravar', id: 'protecoes.arquivos', valor: false });
});

test('§12.2 protecaoLigada: falha fechada', () => {
  assert.equal(protecaoLigada(null, 'protecoes.arquivos'), true);
  assert.equal(protecaoLigada(novoHome(), 'protecoes.arquivos'), true, 'sem config.json');
  assert.equal(protecaoLigada(novoHome('{ruim'), 'protecoes.arquivos'), true, 'ilegível');
  assert.equal(protecaoLigada(novoHome({ protecoes: { arquivos: 'nao' } }), 'protecoes.arquivos'), true, 'inválido');
  assert.equal(protecaoLigada(novoHome({ protecoes: { arquivos: false } }), 'protecoes.arquivos'), false);
  assert.equal(protecaoLigada(novoHome({ protecoes: { arquivos: false } }), 'protecoes.hooks'), true);
  assert.equal(protecaoLigada(novoHome(), 'barra.ctx.amarelo'), true, 'id que não é proteção');
});

function rodar(script, entrada, home) {
  const casa = path.join(home, 'casa');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['HOME', 'USERPROFILE'].includes(k.toUpperCase())));
  Object.assign(env, { HOME: casa, USERPROFILE: casa, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'), HADOUKEN_SEM_PAINEL: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', script)], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const SID = '11111111-2222-3333-4444-555555555555';
const CASOS = [
  ['sessaoFilha', 'guarda-filha.js', () => ({ session_id: SID, tool_name: 'Bash', tool_input: { command: 'claude -p "/hadouken:liberar"' } })],
  ['arquivos', 'guarda-arquivos.js', (home) => ({ session_id: SID, tool_name: 'Write', tool_input: { file_path: path.join(home, 'config.json'), content: '{}' } })],
  ['hooks', 'guarda-config.js', (home) => ({ hook_event_name: 'ConfigChange', source: 'project_settings', file_path: path.join(home, 's.json') })],
  ['agenda', 'guarda-agenda.js', () => ({ session_id: SID, tool_name: 'CronCreate', tool_input: { prompt: '/hadouken:liberar' } })],
];

for (const [chave, script, entrada] of CASOS) {
  test(`§12.2 ${script}: nega ligado, passa desligado`, () => {
    const ligado = novoHome();
    assert.match(rodar(script, entrada(ligado), ligado), /deny|block/, 'controle: ligado nega');
    const desligado = novoHome({ protecoes: { [chave]: false } });
    assert.equal(rodar(script, entrada(desligado), desligado).trim(), '', 'desligado passa calado');
  });
}

test('§12.1 guarda-filha usa o cwd do stdin', () => {
  const home = novoHome();
  const saida = rodar('guarda-filha.js', { session_id: SID, cwd: CWD, tool_name: 'Bash', tool_input: { command: `node "${CWD}/x.mjs" $HOME *.js` } }, home);
  assert.equal(saida.trim(), '');
});

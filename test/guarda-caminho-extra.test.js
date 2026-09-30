import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import { chamaClaude, claudeComLiberar } from '../src/guarda/caminho.js';
import { lerEventos } from '../src/guarda/registros.js';

// Rodada de correção da Task 16 (revisão): continuação de linha dentro da
// palavra claude, comando longo na P4 comum, '~' e caminho relativo na P5, e
// a decisão do controlador sobre a posição de comando e a expansão de bash
// que não dá para avaliar. Mesmo arnês de test/guarda-hooks.test.js: cada
// hook num processo filho, com HADOUKEN_HOME e CLAUDE_CONFIG_DIR temporários,
// HADOUKEN_SEM_PAINEL=1 e CLAUDE_EFFORT, CLAUDE_CODE_SUBAGENT_MODEL e
// CLAUDE_CODE_ENTRYPOINT do processo de teste fora do filho.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptDe = (nome) => path.join(repo, 'src', 'hooks', nome);

const homes = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk caminho ç '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg'), { recursive: true });
  return d;
}
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function conferirHome(home) {
  assert.ok(typeof home === 'string' && path.isAbsolute(home), `HADOUKEN_HOME ausente: ${home}`);
  assert.ok(home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
}

function ambiente(home, extra = {}) {
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'),
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_EFFORT: undefined, CLAUDE_CODE_SUBAGENT_MODEL: undefined, CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  conferirHome(env.HADOUKEN_HOME);
  return env;
}

// `opcoes` vai para o spawnSync (cwd do processo do hook).
function rodar(script, entrada, home, extra = {}, opcoes = {}) {
  return spawnSync(process.execPath, [scriptDe(script)], {
    input: JSON.stringify(entrada), env: ambiente(home, extra), encoding: 'utf8', timeout: 15_000, ...opcoes,
  });
}

function registrar(home, id) {
  conferirHome(home);
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try { registrarSessao(id, Date.now()); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
}

// estado.json lido agora; u7 86 dispara G4 (teto 85).
function gravarEstado(home, u7) {
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const at = new Date(agora).toISOString();
  fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 20, resets_at: s + 3 * 3600, at },
    seven_day: { used_percentage: u7, resets_at: s + 4 * 86_400, at },
    sessoes: {}, historico: [],
  }));
}

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

const ferramenta = (id, tool_name, tool_input, cwd = os.tmpdir()) => ({ session_id: id, hook_event_name: 'PreToolUse', tool_name, tool_input, cwd });
const negacao = (razao) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razao } });
const LIBERAR_NEGADO = negacao('hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /claude-hadouken:liberar.');
const P4_NEGADO = negacao('hadouken: bloqueado: sessões claude filhas ficam fechadas com a guarda ativa.');
const P5_NEGADO = negacao('hadouken: bloqueado: arquivos do hadouken só o usuário edita.');
const eventos = (home, tipo) => lerEventos(home, Date.now()).filter((e) => e.tipo === tipo);

test('claudeComLiberar: continuação de linha dentro da palavra claude (bash, PowerShell, cmd)', () => {
  for (const fim of ['\n', '\r\n']) {
    for (const c of [`cla\\${fim}ude -p /claude-hadouken:liberar`, `cla\`${fim}ude -p /claude-hadouken:liberar`, `cla^${fim}ude -p /claude-hadouken:liberar`]) {
      assert.equal(claudeComLiberar(c), true, JSON.stringify(c));
    }
  }
});

test('chamaClaude: 20 KB antes do claude não escapam do corte', () => {
  assert.equal(chamaClaude(`${' '.repeat(20_000)}claude -p x`), true);
  assert.equal(chamaClaude(`echo ${'a'.repeat(20_000)} && claude -p x`), true);
  assert.equal(chamaClaude(`echo ${'a'.repeat(20_000)}`), false);
});

// Decisão do controlador (rodada 1): claude só conta em posição de comando de
// algum segmento; texto entre aspas conta quando é o argumento de -c, /c, /k,
// -Command ou eval (e $(...) e crase, que o bash executa mesmo entre aspas).
test('claudeComLiberar: só claude em posição de comando conta; mensagem de commit passa', () => {
  const nao = [
    'git commit -m "feat: liberar guard for claude"',
    'git commit -m "P4 nega claude -p /claude-hadouken:liberar"',
    "git commit -m 'docs: claude e /claude-hadouken:liberar'",
    "git commit -m \"$(cat <<'EOF'\nfeat: a P4 nega o comando claude-hadouken:liberar\n\nclaude-hadouken: liberar só pelo usuário\nEOF\n)\"",
    'echo "claude -p /claude-hadouken:liberar" > nota.txt',
    'gh pr create --title "liberar" --body "claude -p /claude-hadouken:liberar"',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
  const sim = [
    'bash -c "claude -p /claude-hadouken:liberar"',
    "sh -lc 'claude -p /claude-hadouken:liberar'",
    "powershell -Command \"claude -p '/claude-hadouken:liberar'\"",
    'pwsh -c "& claude -p /claude-hadouken:liberar"',
    'cmd /k claude -p /claude-hadouken:liberar',
    'cmd.exe /s /c "claude -p /claude-hadouken:liberar"',
    'eval "claude -p /claude-hadouken:liberar"',
    "Invoke-Expression 'claude -p /claude-hadouken:liberar'",
    'git commit -m "$(claude -p /claude-hadouken:liberar)"',
    'echo `claude -p /claude-hadouken:liberar`',
    'find . -exec claude -p /claude-hadouken:liberar ;',
    'sudo -u root claude -p /claude-hadouken:liberar',
    'command claude -p /claude-hadouken:liberar',
    'exec claude -p /claude-hadouken:liberar',
    'pnpm dlx @anthropic-ai/claude-code -p /claude-hadouken:liberar',
    'bunx @anthropic-ai/claude-code -p /claude-hadouken:liberar',
    '(claude -p /claude-hadouken:liberar)',
    'if true; then claude -p /claude-hadouken:liberar; fi',
    'false || claude -p /claude-hadouken:liberar',
    'x & claude -p /claude-hadouken:liberar',
    'echo x\nclaude -p /claude-hadouken:liberar',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

// Decisão do controlador (rodada 1): com claude em posição de comando, o
// texto com 'hadouken' e { $ ` * ou ? nega, porque não dá para saber o que o
// bash expande (:libe{rar,}, :lib?rar, $X). Na dúvida, nega.
test('claudeComLiberar: expansão de chaves, variável, crase e glob junto de hadouken nega', () => {
  const sim = [
    'claude -p "/claude-hadouken:libe{rar,}"',
    'claude -p /claude-hadouken:lib?rar',
    'claude -p "/claude-hadouken:libera*"',
    'claude -p "/claude-hadouken:$X"',
    'claude -p "/claude-hadouken:`printf liberar`"',
    'claude -p "/claude-hadouken:$(printf liberar)"',
    'cd "E:/Projetos DEV/claude-hadouken" && claude -p "revise $ARQ"',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
  const nao = [
    'claude -p "revise src/*.js"',
    'cd "E:/Projetos DEV/claude-hadouken" && ls src/*.js',
    'echo "$HOME/claude-hadouken" && git log --grep "liberar?"',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
});

test('P4 ponta a ponta: continuação nega; commit que cita claude passa; 20 KB antes do claude não escapam', () => {
  const home = novoHome();
  registrar(home, 's1');
  gravarEstado(home, 40);
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: 'cla\\\nude -p /claude-hadouken:liberar' }), home)), LIBERAR_NEGADO);
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'PowerShell', { command: 'cla`\r\nude -p /claude-hadouken:liberar' }), home)), LIBERAR_NEGADO);
  semSaida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: 'git commit -m "feat: liberar guard for claude"' }), home));
  gravarEstado(home, 86);
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: `echo ${'a'.repeat(20_000)} && claude -p x` }), home)), P4_NEGADO);
  assert.deepEqual(eventos(home, 'liberacao-recusada').map((e) => e.detalhe), ['P4', 'P4']);
  assert.equal(eventos(home, 'filha-negada').length, 1);
});

// A pasta de dados no lugar de verdade (~/.claude/hadouken), dentro de um
// temporário que faz as vezes da casa do usuário (HOME e USERPROFILE).
test('P5: "~" e caminho relativo são resolvidos antes de conferir', () => {
  const casa = novoHome();
  const dados = path.join(casa, '.claude', 'hadouken');
  fs.mkdirSync(dados, { recursive: true });
  const env = { HOME: casa, USERPROFILE: casa };
  const projeto = path.join(casa, 'projeto');
  const casos = [
    ['Write', { file_path: '~/.claude/hadouken/liberacao.json', content: '{}' }, os.tmpdir()],
    ['Edit', { file_path: '../.claude/hadouken/guarda.json', old_string: 'a', new_string: 'b' }, projeto],
    ['MultiEdit', { file_path: 'config.json', edits: [] }, dados],
    ['NotebookEdit', { notebook_path: '../../n.ipynb', new_source: '' }, path.join(dados, 'x', 'y')],
  ];
  if (process.platform === 'win32') casos.push(['Write', { file_path: '~\\.claude\\hadouken\\guarda.json', content: '' }, os.tmpdir()]);
  for (const [tool, input, cwd] of casos) assert.deepEqual(saida(rodar('guarda-arquivos.js', ferramenta('s1', tool, input, cwd), dados, env)), P5_NEGADO, `${tool} ${cwd}`);
  // cwd ausente ou relativo: vale o cwd do processo do hook.
  for (const cwd of ['sem', 'relativo', 42]) {
    const entrada = ferramenta('s1', 'Write', { file_path: 'liberacao.json', content: '' }, cwd);
    if (cwd === 'sem') delete entrada.cwd;
    assert.deepEqual(saida(rodar('guarda-arquivos.js', entrada, dados, env, { cwd: dados })), P5_NEGADO, String(cwd));
  }
  // Fora da pasta de dados, passa.
  semSaida(rodar('guarda-arquivos.js', ferramenta('s1', 'Write', { file_path: '~/fora.txt', content: '' }), dados, env));
  semSaida(rodar('guarda-arquivos.js', ferramenta('s1', 'Write', { file_path: 'fora.txt', content: '' }, projeto), dados, env));
  semSaida(rodar('guarda-arquivos.js', ferramenta('s1', 'Write', { file_path: '~outro/.claude/hadouken/x.json', content: '' }, projeto), dados, env));
  assert.equal(eventos(dados, 'arquivo-negado').length, casos.length + 3);
});

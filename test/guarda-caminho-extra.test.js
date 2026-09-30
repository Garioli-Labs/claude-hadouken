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
const LIBERAR_NEGADO = negacao('hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /claude-hadouken:liberar. Se o texto só cita o comando (numa mensagem de commit, por exemplo), use git commit -F <arquivo>.');
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

// Decisão do controlador (rodada 1): claude em posição de comando de algum
// segmento conta; texto entre aspas conta quando é o argumento de -c, /c, /k,
// -Command ou eval (e $(...) e crase, que o bash executa mesmo entre aspas).
// Rodada 2: o texto que cita 'hadouken:liberar' nega mesmo fora da posição de
// comando (mensagem de commit, echo, gh); só a que não cita passa.
test('claudeComLiberar: claude em posição de comando nega; mensagem que cita hadouken:liberar também (rodada 2)', () => {
  const nao = [
    'git commit -m "feat: liberar guard for claude"',
    "git commit -m 'fix: claude -p pede para liberar a guarda'",
    'gh pr create --title "liberar" --body "claude pede; o usuário libera"',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
  const sim = [
    'git commit -m "docs: claude must not run /claude-hadouken:liberar"',
    'git commit -m "P4 nega claude -p /claude-hadouken:liberar"',
    "git commit -m 'docs: claude e /claude-hadouken:liberar'",
    "git commit -m \"$(cat <<'EOF'\nfeat: a P4 nega o comando claude-hadouken:liberar\n\nclaude-hadouken: liberar só pelo usuário\nEOF\n)\"",
    'echo "claude -p /claude-hadouken:liberar" > nota.txt',
    'gh pr create --title "liberar" --body "claude -p /claude-hadouken:liberar"',
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

// Decisão do controlador (rodada 2): parar de caçar variantes. claudeComLiberar
// é a união de (a) o texto normalizado com 'hadouken:liberar', (b) claude como
// palavra em qualquer lugar junto de ':liberar' ou '/liberar' como palavra, ou
// de 'hadouken' com { $ ` * ? + ( ! ou %, e (c) o leitor de posição de
// comando. Os casos A a D passavam pela rodada 1. Cada um vai com o texto
// literal (a), com o nome curto e com chaves (b, sem 'hadouken:liberar').
test('claudeComLiberar (rodada 2): redirecionamento, cmd /c e -Command, bloco do PowerShell e ponto negam', () => {
  const casos = [
    '>o claude -p ARG', '2>&1 claude -p ARG', '<in claude -p ARG', // A
    'cmd /c start claude -p ARG', 'cmd /c call claude -p ARG', "powershell -Command Start-Process claude -ArgumentList '-p','ARG'", // B
    'try { claude -p ARG } catch {}', '1 | ForEach-Object { claude -p ARG }', 'Start-Job { claude -p ARG }', 'try {claude -p ARG}', // C
    '. claude -p ARG', // D
  ];
  for (const arg of ['/claude-hadouken:liberar', '"/liberar 2h"', '"/claude-hadouken:libe{rar,}"']) {
    for (const c of casos) assert.equal(claudeComLiberar(c.replace('ARG', arg)), true, c.replace('ARG', arg));
  }
});

test('claudeComLiberar (rodada 2): texto levado a outro interpretador e concatenação junto de hadouken negam', () => {
  const sim = [
    'echo "claude -p /claude-hadouken:liberar" | bash',
    "python -c \"os.system('claude -p /claude-hadouken:liberar')\"",
    "python -c \"import os; os.system('cl' + 'aude -p /claude-hadouken:liberar')\"",
    'claude -p ("/claude-hadouken:lib"+"erar")',
    "& claude -p ('/claude-hadouken:' + 'lib' + 'erar')",
    "python -c \"import subprocess; subprocess.run(['claude', '-p', '/claude-hadouken:lib' + 'erar'])\"",
    'claude -p "/claude-hadouken:lib$(echo erar)"',
    'claude -p "/claude-hadouken:lib%X%"',
    'claude -p "/claude-hadouken:lib!X!"',
    'git commit -m "docs: CLAUDE must not run /Claude-Hadouken:Liberar"',
    'echo "/claude-hadouken:lib\\\nerar"',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
  // Sem 'hadouken:liberar' no texto, sem claude como palavra (claude-hadouken
  // e ~/.claude não são a palavra) ou sem liberar nem hadouken: passa.
  const nao = [
    'git commit -m "feat: liberar guard for claude"',
    'claude -p "resuma o README.md"',
    'ls ~/.claude/hadouken/*.json',
    'cd "E:/Projetos DEV/claude-hadouken" && node --test',
    'cd "E:/Projetos DEV/claude-hadouken" && git log --grep "liberar" -- src/*.js',
    'claude -p "revise src/hooks/liberar.js e src/hooks/liberar/"',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
});

// Decisão do controlador (rodada 3): claude só conta como palavra com início,
// espaço, ; & | ( { ' " crase = / ou \ antes e fim, espaço, ; & | ) ' " ou
// crase depois, com .exe, .cmd ou .ps1 opcionais; nada de - . ou : grudado.
// O nome deste repositório e a pasta de dados passam com $, * ou (.
test('claudeComLiberar (rodada 3): claude grudado a - . : } ] ou , não é palavra; com caminho ou .exe, .cmd, .ps1 é', () => {
  const nao = [
    'cd "E:/Projetos DEV/claude-hadouken-guarda" && echo $X',
    'ls ~/.claude/hadouken/*',
    "git commit -m \"$(cat <<'EOF'\nfix: claude-hadouken bar (P4)\n\nclaude-hadouken: a barra mostra a guarda\nEOF\n)\"",
    'git commit -F msg.txt',
    'cat ~/.claude/claude.json | grep "hadouken*"',
    'echo claude: $X hadouken',
    'echo {claude} $X hadouken',
    'echo [claude] $X hadouken',
    'echo claude, $X hadouken',
    'echo claude.bat $X hadouken',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
  const sim = [
    '/usr/bin/claude -p "/liberar 2h"',
    '"C:\\x\\claude.exe" -p "/liberar 2h"',
    'claude.cmd -p "/liberar 2h"',
    '.\\claude.ps1 -p "/liberar 2h"',
    'X=claude; $X -p "/claude-hadouken:libe{rar,}"',
    "Start-Process 'claude' -ArgumentList '-p','/liberar'",
    '`claude` -p "/liberar 2h"',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

test('P4 ponta a ponta (rodada 3): comandos do controlador que citam o repositório ou a pasta de dados passam, com a guarda disparada', () => {
  const home = novoHome();
  registrar(home, 's1');
  gravarEstado(home, 86);
  const casos = [
    'cd "E:/Projetos DEV/claude-hadouken-guarda" && echo $X',
    'ls ~/.claude/hadouken/*',
    "git commit -m \"$(cat <<'EOF'\nfix: claude-hadouken bar (P4)\nEOF\n)\"",
    'git commit -F msg.txt',
  ];
  for (const command of casos) semSaida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command }), home));
  assert.equal(eventos(home, 'liberacao-recusada').length, 0);
  assert.equal(eventos(home, 'filha-negada').length, 0);
});

// Decisão do controlador (rodada 4): antes do teste (b), e só dele, cada
// trailer exato 'Co-Authored-By: Claude ... <noreply@anthropic.com>' (sem
// diferenciar maiúsculas) vira um espaço. O resto da linha e do comando
// continua conferido; (a) e (c) não mudam.
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const heredoc = (...linhas) => `git commit -m "$(cat <<'EOF'\n${linhas.join('\n')}\nEOF\n)"`;
const MENSAGEM = ['feat: claude-hadouken guard on the bar', '', 'The hadouken guard shows on the status bar.'];

test('claudeComLiberar (rodada 4): o trailer Co-Authored-By do Claude sai antes do (b); o resto do comando continua conferido', () => {
  const commit = heredoc(...MENSAGEM, '', TRAILER);
  assert.equal(claudeComLiberar(commit), false, commit);
  const sim = [
    heredoc(...MENSAGEM, 'claude -p /claude-hadouken:liberar', '', TRAILER),
    'Co-Authored-By: Claude x <noreply@anthropic.com>; claude -p "$(echo hadouken)"',
    'Co-Authored-By: Claude x <outro@example.com> && claude -p x hadouken$',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

// Casos que só o (b) pega: o leitor da posição de comando lê '>o' ou 'echo'
// como o comando. Provam que sai cada trailer exato, e só ele.
test('claudeComLiberar (rodada 4): só o trailer exato sai; antes e depois dele, na mesma linha, conta', () => {
  const nao = [
    'echo "hadouken$X" # CO-AUTHORED-BY:\tCLAUDE X <NOREPLY@ANTHROPIC.COM>',
    'echo "hadouken$X" # Co-Authored-By: Claude a <noreply@anthropic.com> Co-Authored-By: Claude b <noreply@anthropic.com>',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
  const sim = [
    'Co-Authored-By: Claude x <noreply@anthropic.com>; >o claude -p "hadouken$X"',
    '>o claude -p "hadouken$X" # Co-Authored-By: Claude x <noreply@anthropic.com>',
    'echo "hadouken$X" # Co-Authored-By: Claude x <outro@example.com>',
    'echo "hadouken$X" # Co-Authored-By: Claude <x> <noreply@anthropic.com>',
    'echo "hadouken$X" # Co-Authored-By: Claude x\n<noreply@anthropic.com>',
    'echo "hadouken$X" # Co-Authored-By: Claude x <noreply@anthropic.com.br>',
    // Montado com aspas no meio: não é o trailer exato; sem as aspas, claude é palavra.
    'echo "hadouken$X" # Co-Authored-By: Cl""aude x <noreply@anthropic.com>',
    // (a) e (c) ainda leem o trailer: o texto da liberação e um comando dentro dele.
    'git commit -m "Co-Authored-By: Claude /claude-hadouken:liberar <noreply@anthropic.com>"',
    'Co-Authored-By: Claude x; claude -p "hadouken$X" <noreply@anthropic.com>',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

// A regex da decisão aplicada com replace é quadrática quando muitos começos
// de trailer dividem uma linha sem '<' (medido: este texto de 440 KB leva
// 15 s, acima do tempo do hook, que então passa). A remoção tem de ser linear.
test('claudeComLiberar (rodada 4): muitos começos de trailer sem o endereço não custam tempo quadrático', () => {
  const texto = `claude -p "hadouken$X" ${'co-authored-by: claude'.repeat(20_000)}`;
  const t0 = performance.now();
  assert.equal(claudeComLiberar(texto), true);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

// Decisão do controlador (rodada 2): acima de 1 MiB (1_048_576 unidades de
// texto), liberar em qualquer lugar nega sem o leitor. Os comandos abaixo não
// têm claude nem hadouken: só o limite nega.
test('claudeComLiberar (rodada 2): comando com mais de 1 MiB e liberar em qualquer lugar nega sem ler', () => {
  const MIB = 1_048_576;
  const com = (texto, total) => `${texto} ${'a'.repeat(total - texto.length - 1)}`;
  assert.equal(com('echo liberar', MIB + 1).length, MIB + 1);
  assert.equal(claudeComLiberar(com('echo liberar', MIB + 1)), true);
  assert.equal(claudeComLiberar(com('echo LIBERAR', MIB + 1)), true);
  assert.equal(claudeComLiberar(`echo ${'a'.repeat(MIB)} lib\\erar`), true);
  assert.equal(claudeComLiberar(com('echo liberar', MIB)), false);
  assert.equal(claudeComLiberar(com('echo nada', MIB + 1)), false);
});

test('P4 ponta a ponta (rodada 2): commit que cita hadouken:liberar nega com o texto do -F; redirecionamento e 1 MiB negam', () => {
  const home = novoHome();
  registrar(home, 's1');
  gravarEstado(home, 40);
  const casos = [
    'git commit -m "docs: claude must not run /claude-hadouken:liberar"',
    '2>&1 claude -p /claude-hadouken:liberar',
    'cmd /c start claude -p "/liberar 2h"',
    `echo liberar ${'a'.repeat(1_048_576)}`,
  ];
  for (const command of casos) assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command }), home)), LIBERAR_NEGADO, command.slice(0, 80));
  semSaida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: 'git commit -m "feat: liberar guard for claude"' }), home));
  assert.deepEqual(eventos(home, 'liberacao-recusada').map((e) => e.detalhe), Array(casos.length).fill('P4'));
  assert.equal(eventos(home, 'filha-negada').length, 0);
  // A P4 lê o stdin até 16 MiB (o teto comum é 1 MiB): a P4 comum também vê
  // um comando acima de 1 MiB. Acima de 16 MiB o hook passa calado (R1).
  gravarEstado(home, 86);
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: `echo ${'a'.repeat(2 * 1_048_576)} && claude -p x` }), home)), P4_NEGADO);
  semSaida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: `echo liberar ${'a'.repeat(16 * 1_048_576)}` }), home));
  assert.equal(eventos(home, 'filha-negada').length, 1);
  assert.equal(eventos(home, 'liberacao-recusada').length, casos.length);
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

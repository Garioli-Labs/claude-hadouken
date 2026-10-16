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
const LIBERAR_NEGADO = negacao('hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /hadouken:liberar. Se o texto só cita o comando (numa mensagem de commit, por exemplo), use git commit -F <arquivo>.');
const P4_NEGADO = negacao('hadouken: bloqueado: sessões claude filhas ficam fechadas com a guarda ativa.');
const P5_NEGADO = negacao('hadouken: bloqueado: arquivos do hadouken só o usuário edita.');
const eventos = (home, tipo) => lerEventos(home, Date.now()).filter((e) => e.tipo === tipo);

test('claudeComLiberar: continuação de linha dentro da palavra claude (bash, PowerShell, cmd)', () => {
  for (const fim of ['\n', '\r\n']) {
    for (const c of [`cla\\${fim}ude -p /hadouken:liberar`, `cla\`${fim}ude -p /hadouken:liberar`, `cla^${fim}ude -p /hadouken:liberar`]) {
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
    'git commit -m "docs: claude must not run /hadouken:liberar"',
    'git commit -m "P4 nega claude -p /hadouken:liberar"',
    "git commit -m 'docs: claude e /hadouken:liberar'",
    "git commit -m \"$(cat <<'EOF'\nfeat: a P4 nega o comando hadouken:liberar\n\nclaude-hadouken: liberar só pelo usuário\nEOF\n)\"",
    'echo "claude -p /hadouken:liberar" > nota.txt',
    'gh pr create --title "liberar" --body "claude -p /hadouken:liberar"',
    'bash -c "claude -p /hadouken:liberar"',
    "sh -lc 'claude -p /hadouken:liberar'",
    "powershell -Command \"claude -p '/hadouken:liberar'\"",
    'pwsh -c "& claude -p /hadouken:liberar"',
    'cmd /k claude -p /hadouken:liberar',
    'cmd.exe /s /c "claude -p /hadouken:liberar"',
    'eval "claude -p /hadouken:liberar"',
    "Invoke-Expression 'claude -p /hadouken:liberar'",
    'git commit -m "$(claude -p /hadouken:liberar)"',
    'echo `claude -p /hadouken:liberar`',
    'find . -exec claude -p /hadouken:liberar ;',
    'sudo -u root claude -p /hadouken:liberar',
    'command claude -p /hadouken:liberar',
    'exec claude -p /hadouken:liberar',
    'pnpm dlx @anthropic-ai/claude-code -p /hadouken:liberar',
    'bunx @anthropic-ai/claude-code -p /hadouken:liberar',
    '(claude -p /hadouken:liberar)',
    'if true; then claude -p /hadouken:liberar; fi',
    'false || claude -p /hadouken:liberar',
    'x & claude -p /hadouken:liberar',
    'echo x\nclaude -p /hadouken:liberar',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

// Decisão do controlador (rodada 1): com claude em posição de comando, o
// texto com 'hadouken' e { $ ` * ou ? nega, porque não dá para saber o que o
// bash expande (:libe{rar,}, :lib?rar, $X). Na dúvida, nega.
test('claudeComLiberar: expansão de chaves, variável, crase e glob junto de hadouken nega', () => {
  const sim = [
    'claude -p "/hadouken:libe{rar,}"',
    'claude -p /hadouken:lib?rar',
    'claude -p "/hadouken:libera*"',
    'claude -p "/hadouken:$X"',
    'claude -p "/hadouken:`printf liberar`"',
    'claude -p "/hadouken:$(printf liberar)"',
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
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: 'cla\\\nude -p /hadouken:liberar' }), home)), LIBERAR_NEGADO);
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'PowerShell', { command: 'cla`\r\nude -p /hadouken:liberar' }), home)), LIBERAR_NEGADO);
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
  for (const arg of ['/hadouken:liberar', '"/liberar 2h"', '"/hadouken:libe{rar,}"']) {
    for (const c of casos) assert.equal(claudeComLiberar(c.replace('ARG', arg)), true, c.replace('ARG', arg));
  }
});

test('claudeComLiberar (rodada 2): texto levado a outro interpretador e concatenação junto de hadouken negam', () => {
  const sim = [
    'echo "claude -p /hadouken:liberar" | bash',
    "python -c \"os.system('claude -p /hadouken:liberar')\"",
    "python -c \"import os; os.system('cl' + 'aude -p /hadouken:liberar')\"",
    'claude -p ("/hadouken:lib"+"erar")',
    "& claude -p ('/hadouken:' + 'lib' + 'erar')",
    "python -c \"import subprocess; subprocess.run(['claude', '-p', '/hadouken:lib' + 'erar'])\"",
    'claude -p "/hadouken:lib$(echo erar)"',
    'claude -p "/hadouken:lib%X%"',
    'claude -p "/hadouken:lib!X!"',
    'git commit -m "docs: CLAUDE must not run /Claude-Hadouken:Liberar"',
    'echo "/hadouken:lib\\\nerar"',
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
    'X=claude; $X -p "/hadouken:libe{rar,}"',
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

// Decisões do controlador (rodadas 4 e 5): antes do teste (b), e só dele, o
// trailer 'Co-Authored-By: Claude ... <noreply@anthropic.com>' (sem
// diferenciar maiúsculas) vira um espaço, mas só quando começa a linha
// (espaços ou tabs antes), o trecho entre Claude e o endereço não tem
// ; & | ( ) $ crase aspas barra invertida nem quebra de linha, e depois do
// endereço vêm só espaços ou tabs e o fim da linha, o fim do texto ou uma
// aspa de fechamento. O resto do comando continua conferido; (a) e (c) não
// mudam.
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const heredoc = (...linhas) => `git commit -m "$(cat <<'EOF'\n${linhas.join('\n')}\nEOF\n)"`;
const MENSAGEM = ['feat: claude-hadouken guard on the bar', '', 'The hadouken guard shows on the status bar.'];

test('claudeComLiberar (rodadas 4 e 5): o trailer do Claude sai antes do (b) no heredoc e no -m; o resto do comando continua conferido', () => {
  const nao = [
    heredoc(...MENSAGEM, '', TRAILER),
    `git commit -m "feat: claude-hadouken guard (P4)\n\nThe hadouken bar.\n\n${TRAILER}"`,
    `git commit -m 'feat: claude-hadouken guard (P4)\n\n${TRAILER}' -- src/guarda/caminho.js`,
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
  const sim = [
    heredoc(...MENSAGEM, 'claude -p /hadouken:liberar', '', TRAILER),
    'Co-Authored-By: Claude x <noreply@anthropic.com>; claude -p "$(echo hadouken)"',
    'Co-Authored-By: Claude x <outro@example.com> && claude -p x hadouken$',
    // Rodada 5: o comando que a regra da rodada 4 deixava passar, e o trailer
    // seguido de outro comando na mesma linha.
    'X=:liberar; echo "Co-Authored-By: Claude x"; >o claude -p "/claude-hadouken$X"; echo "<noreply@anthropic.com>"',
    'Co-Authored-By: Claude x <noreply@anthropic.com> && claude -p x hadouken$',
  ];
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

// Casos que só o (b) pega: o leitor da posição de comando lê '>o', 'echo' ou
// 'co-authored-by:' como o comando. Provam que sai cada trailer da regra, e
// só ele.
test('claudeComLiberar (rodadas 4 e 5): só sai o trailer que começa a linha, sem metacaractere no trecho e com o fim da linha depois', () => {
  const nao = [
    'echo "hadouken$X"\nCO-AUTHORED-BY:\tCLAUDE X <NOREPLY@ANTHROPIC.COM>',
    'echo "hadouken$X"\nCo-Authored-By: Claude a <noreply@anthropic.com>\r\n \tCo-Authored-By: Claude b <noreply@anthropic.com>  ',
  ];
  for (const c of nao) assert.equal(claudeComLiberar(c), false, c);
  const sim = [
    // O resto do comando, antes e depois do trailer, conta.
    'Co-Authored-By: Claude x <noreply@anthropic.com>\n>o claude -p "hadouken$X"',
    '>o claude -p "hadouken$X"\nCo-Authored-By: Claude x <noreply@anthropic.com>',
    'git commit -m "x\nCo-Authored-By: Claude x <noreply@anthropic.com>" && >o claude -p "hadouken$X"',
    // No meio da linha, ou com mais que espaços e o fim da linha depois do endereço.
    'echo "hadouken$X" # Co-Authored-By: Claude x <noreply@anthropic.com>',
    'echo "hadouken$X"\nCo-Authored-By: Claude x <noreply@anthropic.com> && echo y',
    'echo "hadouken$X"\nCo-Authored-By: Claude x <noreply@anthropic.com> y',
    // Não é o trailer exato (o de aspas no meio, sem as aspas, tem claude como palavra).
    'echo "hadouken$X"\nCo-Authored-By: Claude x <outro@example.com>',
    'echo "hadouken$X"\nCo-Authored-By: Claude <x> <noreply@anthropic.com>',
    'echo "hadouken$X"\nCo-Authored-By: Claude x\n<noreply@anthropic.com>',
    'echo "hadouken$X"\nCo-Authored-By: Claude x <noreply@anthropic.com.br>',
    'echo "hadouken$X"\nCo-Authored-By: Cl""aude x <noreply@anthropic.com>',
    // (a) e (c) ainda leem o trailer: o texto da liberação e um -c com claude.
    'git commit -m "x\nCo-Authored-By: Claude /hadouken:liberar <noreply@anthropic.com>"',
    'Co-Authored-By: Claude -c claude /liberar <noreply@anthropic.com>',
  ];
  // Metacaractere no trecho entre Claude e o endereço.
  for (const m of [';', '&', '|', '(', ')', '$', '`', "'", '"', '\\']) {
    sim.push(`echo "hadouken$X"\nCo-Authored-By: Claude x${m}y <noreply@anthropic.com>`);
  }
  for (const c of sim) assert.equal(claudeComLiberar(c), true, c);
});

// A regex da rodada 4, sem âncora e aplicada com replace, é quadrática quando
// muitos começos de trailer dividem uma linha sem '<' (medido: o primeiro
// trecho abaixo, 440 KB, leva 15 s, acima do tempo do hook, que então passa).
// Ancorada no começo da linha (rodada 5), tenta um começo por linha: linear.
test('claudeComLiberar (rodadas 4 e 5): muitos começos de trailer sem o endereço não custam tempo quadrático', () => {
  const comecos = 'co-authored-by: claude'.repeat(20_000);
  const texto = `claude -p "hadouken$X" ${comecos}\n${comecos}\n${'co-authored-by: claude x\n'.repeat(20_000)}`;
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
    'git commit -m "docs: claude must not run /hadouken:liberar"',
    '2>&1 claude -p /hadouken:liberar',
    'cmd /c start claude -p "/liberar 2h"',
    `echo liberar ${'a'.repeat(1_048_576)}`,
  ];
  for (const command of casos) assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command }), home)), LIBERAR_NEGADO, command.slice(0, 80));
  semSaida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: 'git commit -m "feat: liberar guard for claude"' }), home));
  assert.deepEqual(eventos(home, 'liberacao-recusada').map((e) => e.detalhe), Array(casos.length).fill('P4'));
  assert.equal(eventos(home, 'filha-negada').length, 0);
  // A P4 lê o stdin até 4 MiB (o teto comum é 1 MiB): a P4 comum também vê
  // um comando acima de 1 MiB. Acima de 4 MiB, ver o teste da Task 18 abaixo.
  gravarEstado(home, 86);
  assert.deepEqual(saida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: `echo ${'a'.repeat(2 * 1_048_576)} && claude -p x` }), home)), P4_NEGADO);
  assert.equal(eventos(home, 'filha-negada').length, 1);
  assert.equal(eventos(home, 'liberacao-recusada').length, casos.length);
});

// Decisão do controlador (Task 18, Step 0, achado 1 da revisão das rodadas
// 2 a 5 da Task 16): redireção grudada em claude (claude>o, claude<x) e
// '-FilePath:claude' escapavam das três regras e do chamaClaude. '<' e '>'
// entram no conjunto de depois, e ':' no de antes, das três regex de claude.
test('claudeComLiberar e chamaClaude (Task 18): redireção grudada e -FilePath:claude negam; o que passava segue passando', () => {
  const sim = [
    'claude>o -p "/claude-hado$u""ken:liberar"',
    'claude>/dev/null -p "/hadouken:lib$x"',
    'claude</dev/null -p /hadouken:liberar',
    'claude>o -p /hadouken:lib{,}erar',
    '2>&1 claude>o -p /hadouken:lib`echo erar`',
    "Start-Process -FilePath:claude -ArgumentList '-p','/hadouken:lib$x'",
  ];
  for (const c of sim) {
    assert.equal(claudeComLiberar(c), true, `claudeComLiberar: ${c}`);
    assert.equal(chamaClaude(c), true, `chamaClaude: ${c}`);
  }
  // A P4 comum também: claude grudado na redireção, sem o texto da liberação.
  for (const c of ['claude>o -p x', 'claude<pedido.txt', '2>&1 claude>o -p x', 'Start-Process -FilePath:claude']) {
    assert.equal(chamaClaude(c), true, c);
  }
  const nao = [
    'cd "E:/Projetos DEV/claude-hadouken" && echo $X',
    'ls ~/.claude/hadouken/*',
    'cat ~/.claude/claude.json | grep "hadouken*"',
    'git commit -F msg.txt',
  ];
  for (const c of nao) {
    assert.equal(claudeComLiberar(c), false, `claudeComLiberar: ${c}`);
    assert.equal(chamaClaude(c), false, `chamaClaude: ${c}`);
  }
  // O commit em heredoc com o trailer do Claude segue fora do claudeComLiberar
  // (o chamaClaude casa o trailer; o git commit não chega à P4, ver hooks.json).
  assert.equal(claudeComLiberar(heredoc(...MENSAGEM, '', TRAILER)), false);
});

// Decisão do controlador (Task 18, Step 0, achado 3): com 16 MiB, os dois
// leitores somavam 10 a 14 s, acima do timeout de 10 s da P4, e o hook
// passava. O teto do stdin da P4 caiu para 4 MiB; o pior caso de 4 MiB passa
// pelos dois leitores, em sequência como no hook, em menos de 5 s (a segunda
// leitura sai da memória de lancamentoDe, em caminho.js). Conta o tempo de
// CPU do processo, não o de relógio: o node --test roda os arquivos em
// paralelo, e na suíte inteira o relógio dobrava (sem a memória, 5,2 s contra
// 2,3 s sozinho, medido no Windows).
test('P4 (Task 18): o pior caso de 4 MiB nos dois leitores, em sequência, fica abaixo de 5 s', () => {
  const T = 4 * 1_048_576;
  const cab = 'hadouken$ ';
  for (const rep of ['$x ', 'eval x; ', 'a=b ', 'env ']) {
    const texto = cab + rep.repeat(Math.ceil((T - cab.length) / rep.length)).slice(0, T - cab.length);
    assert.equal(texto.length, T);
    const c0 = process.cpuUsage();
    assert.equal(claudeComLiberar(texto), false, rep);
    assert.equal(chamaClaude(texto), false, rep);
    const { user, system } = process.cpuUsage(c0);
    const ms = (user + system) / 1000;
    assert.ok(ms < 5000, `${JSON.stringify(rep)}: ${ms.toFixed(0)} ms de CPU`);
  }
});

// Decisão do controlador (Task 18, Step 0, achado 3): acima de 4 MiB de
// stdin a P4 não lê o comando. Nega se o texto cru tiver 'claude' (sem
// diferenciar maiúsculas) ou 'liberar', em qualquer ponto, inclusive depois
// dos 4 MiB; senão, passa, mesmo com a guarda disparada (R1).
test('P4 ponta a ponta (Task 18): acima de 4 MiB nega sem ler com claude ou liberar; sem eles passa', () => {
  const home = novoHome();
  registrar(home, 's1');
  gravarEstado(home, 40);
  const MIB = 1_048_576;
  const casos = [
    `echo liberar ${'a'.repeat(4 * MIB)}`,
    `echo CLAUDE ${'a'.repeat(4 * MIB)}`,
    `echo ${'a'.repeat(5 * MIB)} && cLaUdE -p x`,
  ];
  for (const command of casos) {
    const entrada = ferramenta('s1', 'Bash', { command });
    assert.ok(Buffer.byteLength(JSON.stringify(entrada)) > 4 * MIB);
    assert.deepEqual(saida(rodar('guarda-filha.js', entrada, home)), LIBERAR_NEGADO, command.slice(0, 20));
  }
  assert.deepEqual(eventos(home, 'liberacao-recusada').map((e) => e.detalhe), Array(casos.length).fill('P4'));
  gravarEstado(home, 86);
  semSaida(rodar('guarda-filha.js', ferramenta('s1', 'Bash', { command: `echo ${'a'.repeat(4 * MIB)} && git status` }), home));
  assert.equal(eventos(home, 'filha-negada').length, 0);
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

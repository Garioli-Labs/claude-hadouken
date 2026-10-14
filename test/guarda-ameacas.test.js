import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { avaliarGuarda } from '../src/guarda/avaliar.js';

// Ameaças da guarda (spec v0.4.0 §12: S10, S15, S24) e a ligação dos hooks em
// hooks/hooks.json (§4.2), com as decisões do controlador na Task 18: timeout
// de 10 s no prompt-submit (agora bloqueia) e um handler da P4 com `if` para
// cada lançador explícito, nunca um curinga que leve o git commit à P4.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('S10: a skill liberar não pode ser carregada pelo modelo e o corpo não manda gravar', () => {
  const t = ler('skills', 'liberar', 'SKILL.md');
  const [, fm, corpo] = t.split(/^---$/m);
  assert.match(fm, /^disable-model-invocation: true$/m);
  assert.match(corpo, /nada foi liberado/);
  assert.doesNotMatch(corpo, /\bnode\b|liberacao\.json|guarda\.json|\$ARGUMENTS|`/);
});

test('S24: módulos da guarda, hooks novos e o custo dos hooks não importam rede nem child_process', () => {
  const arquivos = [
    ...fs.readdirSync(path.join(repo, 'src', 'guarda')).map((f) => path.join('src', 'guarda', f)),
    ...['guarda-despacho.js', 'guarda-filha.js', 'guarda-arquivos.js', 'guarda-modelo.js', 'modelo-trocado.js', 'limite-atingido.js', 'liberar.js',
      'guarda-agenda.js', 'guarda-config.js']
      .map((f) => path.join('src', 'hooks', f)),
    path.join('src', 'custo-hooks.js'), path.join('src', 'indice-hooks.js'),
    // M6 da revisão final da parte 1: avaliar.js importa a leitura do uso
    // oficial, que mora ao lado do painel (que roda o claude); ela só lê.
    path.join('src', 'uso', 'ler-uso.js'),
    // Task 6 do aprendizado: guarda/aperto.js importa o módulo leve de nomes
    // do aprendizado, que também entra no grafo da guarda.
    path.join('src', 'aprendizado', 'arquivos.js'),
  ];
  for (const a of arquivos) {
    const t = ler(a);
    assert.doesNotMatch(t, /node:(?:http|https|net|dns|tls|child_process|dgram)|\bfetch\s*\(|from ['"](?:http|https|net|dns|tls|child_process)['"]/, a);
  }
});

test('S15: afrouxar o config.json não solta a trava', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-s15-'));
  dirs.push(d);
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const at = new Date(agora).toISOString();
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({ versao: 1, at, five_hour: null, seven_day: { used_percentage: 86, resets_at: s + 86_400, at }, sessoes: {}, historico: [] }));
  assert.equal(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).status, 'disparada');
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { teto7d: 99 } }));
  assert.deepEqual(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).ativas, ['seven_day']);
});

// Os `if` da P4 (decisão do controlador na Task 18): claude e cada lançador
// explícito. PowerShell(& *) ficou de fora: a doc não confirma que o `&` entra
// no texto casado, e o spike S9 mostrou que PowerShell(claude *) já casa
// '& claude -p' (R1 no SECURITY.md). M8 da revisão final da parte 1: no
// PowerShell também bash e sh (o bash do Git ou do WSL no PATH do Windows
// abre `bash -c "claude -p ..."`), como no Bash.
const IF_P4 = [
  'Bash(claude *)', 'Bash(npx *)', 'Bash(node *)', 'Bash(bash *)', 'Bash(sh *)', 'Bash(cmd *)', 'Bash(pwsh *)', 'Bash(powershell *)',
  'PowerShell(claude *)', 'PowerShell(npx *)', 'PowerShell(node *)', 'PowerShell(bash *)', 'PowerShell(sh *)', 'PowerShell(cmd *)',
  'PowerShell(pwsh *)', 'PowerShell(powershell *)', 'PowerShell(Start-Process *)',
];

test('hooks.json liga cada hook novo em forma exec, com os timeouts da spec', () => {
  const h = JSON.parse(ler('hooks', 'hooks.json')).hooks;
  const handlers = Object.entries(h).flatMap(([evento, grupos]) => grupos.flatMap((g) => g.hooks.map((x) => ({ evento, matcher: g.matcher, ...x }))));
  // O aprender (aprendizado, R5) tem timeout próprio de 600 s e teste próprio
  // em test/aprendizado-comando.test.js.
  const novos = handlers.filter((x) => Array.isArray(x.args) && !x.args[0].endsWith('/aprender.js'));
  // 45 = 10 fora da P4 e da P5 estendida (P1, P5 x4 na pasta de dados,
  // liberar, P3, PostModelSwitch, StopFailure e o hook da agenda, C1 da
  // revisão final) + 17 da P4, um por `if` de IF_P4 (8 Bash, 9 PowerShell)
  // + 18 da P5 estendida (Task 0 da parte 2, ifP5 abaixo: 3 `if` a mais em
  // cada uma das 4 ferramentas e 2 de settings de projeto em Write, Edit e
  // MultiEdit). O brief da parte 1 contava 11 com a P4 em 2 handlers; a Task
  // 18 trocou esses 2 pelos 15, e o M8 da revisão final somou 2. 46 desde a
  // Task 19b: + 1 do ConfigChange (guarda-config.js).
  assert.equal(novos.length, 46);
  for (const x of novos) {
    assert.equal(x.command, 'node');
    assert.equal(x.args.length, 1);
    assert.match(x.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/src\/hooks\/[a-z-]+\.js$/);
    assert.ok(fs.existsSync(path.join(repo, x.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', ''))), x.args[0]);
    assert.equal(x.timeout, ['PostModelSwitch', 'StopFailure'].includes(x.evento) ? 5 : 10);
  }
  // A P5: um handler por `if`, no grupo da sua ferramenta. Task 0 da parte 2:
  // os settings do usuário e os plugins em todas as quatro; os settings de
  // projeto (negados pelo conteúdo, decisão do controlador) em Write, Edit e
  // MultiEdit, que trazem o texto novo. O de projeto é ancorado na raiz do
  // disco (`//**/`): o spike S13 (b) mostrou, no 2.1.251 do Windows, que o
  // `**/` sem âncora não casa caminho absoluto nenhum, nem dentro do cwd.
  const ifP5 = (tool) => [
    `${tool}(~/.claude/hadouken/**)`, `${tool}(~/.claude/settings.json)`, `${tool}(~/.claude/settings.local.json)`, `${tool}(~/.claude/plugins/**)`,
    ...(tool === 'NotebookEdit' ? [] : [`${tool}(//**/.claude/settings.json)`, `${tool}(//**/.claude/settings.local.json)`]),
  ];
  const p5 = novos.filter((x) => x.args[0].endsWith('/guarda-arquivos.js'));
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    assert.deepEqual(p5.filter((x) => x.matcher === tool).map((x) => [x.evento, x.if]), ifP5(tool).map((i) => ['PreToolUse', i]), tool);
  }
  assert.equal(p5.length, 22);
  // O hook da agenda: um handler PreToolUse, sem `if`, com a lista exata e os
  // schedulers MCP (Task 0 da parte 2). O matcher com outro caractere além de
  // letras, dígitos, _ e | é uma regex do JavaScript, sem âncora e que
  // diferencia maiúsculas (doc de hooks): as classes de caractere fazem o
  // "sem diferenciar maiúsculas".
  const agenda = novos.filter((x) => x.args[0].endsWith('/guarda-agenda.js'));
  const MATCHER_AGENDA = 'CronCreate|ScheduleWakeup|RemoteTrigger|mcp__.*([Cc][Rr][Oo][Nn]|[Ss][Cc][Hh][Ee][Dd][Uu][Ll][Ee]|[Tt][Rr][Ii][Gg][Gg][Ee][Rr]|[Tt][Aa][Ss][Kk]).*';
  assert.deepEqual(agenda.map((x) => [x.evento, x.matcher, x.if, x.timeout]), [['PreToolUse', MATCHER_AGENDA, undefined, 10]]);
  const re = new RegExp(MATCHER_AGENDA);
  for (const t of ['CronCreate', 'ScheduleWakeup', 'RemoteTrigger', 'mcp__scheduled-tasks__create_scheduled_task', 'mcp__Agenda__CreateTrigger', 'mcp__x__CRON_add', 'mcp__y__runTask']) {
    assert.ok(re.test(t), t);
  }
  for (const t of ['Bash', 'Agent', 'Task', 'TaskCreate', 'mcp__github__create_issue']) assert.ok(!re.test(t), t);
  // Task 19b (spike S13 (a)): o ConfigChange segura a mudança de
  // disableAllHooks, enabledPlugins ou hooks nos settings. Um grupo, um
  // handler exec, sem matcher (o hook confere o source por conta própria) e
  // sem `if`, timeout 10.
  assert.deepEqual(h.ConfigChange, [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/hooks/guarda-config.js'], timeout: 10 }] }]);
  const cfg = novos.filter((x) => x.args[0].endsWith('/guarda-config.js'));
  assert.deepEqual(cfg.map((x) => [x.evento, x.matcher, x.if, x.timeout]), [['ConfigChange', undefined, undefined, 10]]);
  // A P4: um handler por `if`, cada um no grupo da sua ferramenta.
  const p4 = novos.filter((x) => x.args[0].endsWith('/guarda-filha.js'));
  assert.deepEqual(p4.map((x) => x.if), IF_P4);
  for (const x of p4) assert.equal(x.matcher, x.if.slice(0, x.if.indexOf('(')));
  // Nenhum `if` de Bash ou PowerShell com curinga antes do nome
  // (Bash(*claude*) levaria o git commit com o trailer do Claude à P4). Os de
  // caminho da P5 (//**/.claude/settings.json) são glob de arquivo, outra regra.
  for (const x of handlers) if (x.if !== undefined && /^(?:Bash|PowerShell)\(/.test(x.if)) assert.match(x.if, /^[A-Za-z]+\([^*]/, x.if);
  // Os três hooks antigos seguem em forma de shell; o prompt-submit bloqueia
  // desde a v0.4.0 e tem 10 s.
  const antigos = handlers.filter((x) => !Array.isArray(x.args));
  assert.deepEqual(antigos.map((x) => [x.evento, x.timeout]), [['SessionStart', 5], ['UserPromptSubmit', 10], ['SessionEnd', 5]]);
  for (const x of antigos) assert.match(x.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/src\/hooks\/[a-z-]+\.js"$/);
});

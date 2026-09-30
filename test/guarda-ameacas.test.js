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

test('S24: módulos da guarda e hooks novos não importam rede nem child_process', () => {
  const arquivos = [
    ...fs.readdirSync(path.join(repo, 'src', 'guarda')).map((f) => path.join('src', 'guarda', f)),
    ...['guarda-despacho.js', 'guarda-filha.js', 'guarda-arquivos.js', 'guarda-modelo.js', 'modelo-trocado.js', 'limite-atingido.js', 'liberar.js']
      .map((f) => path.join('src', 'hooks', f)),
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
// '& claude -p' (R1 no SECURITY.md).
const IF_P4 = [
  'Bash(claude *)', 'Bash(npx *)', 'Bash(node *)', 'Bash(bash *)', 'Bash(sh *)', 'Bash(cmd *)', 'Bash(pwsh *)', 'Bash(powershell *)',
  'PowerShell(claude *)', 'PowerShell(npx *)', 'PowerShell(node *)', 'PowerShell(cmd *)', 'PowerShell(pwsh *)', 'PowerShell(powershell *)',
  'PowerShell(Start-Process *)',
];

test('hooks.json liga cada hook novo em forma exec, com os timeouts da spec', () => {
  const h = JSON.parse(ler('hooks', 'hooks.json')).hooks;
  const handlers = Object.entries(h).flatMap(([evento, grupos]) => grupos.flatMap((g) => g.hooks.map((x) => ({ evento, matcher: g.matcher, ...x }))));
  const novos = handlers.filter((x) => Array.isArray(x.args));
  // 24 = 9 fora da P4 (P1, P5 x4, liberar, P3, PostModelSwitch, StopFailure)
  // + 15 da P4, um por `if` de IF_P4 (8 Bash, 7 PowerShell). O brief contava 11
  // com a P4 em 2 handlers; a Task 18 trocou esses 2 pelos 15.
  assert.equal(novos.length, 24);
  for (const x of novos) {
    assert.equal(x.command, 'node');
    assert.equal(x.args.length, 1);
    assert.match(x.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/src\/hooks\/[a-z-]+\.js$/);
    assert.ok(fs.existsSync(path.join(repo, x.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', ''))), x.args[0]);
    assert.equal(x.timeout, ['PostModelSwitch', 'StopFailure'].includes(x.evento) ? 5 : 10);
  }
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    assert.ok(novos.some((x) => x.matcher === tool && x.if === `${tool}(~/.claude/hadouken/**)`), tool);
  }
  // A P4: um handler por `if`, cada um no grupo da sua ferramenta.
  const p4 = novos.filter((x) => x.args[0].endsWith('/guarda-filha.js'));
  assert.deepEqual(p4.map((x) => x.if), IF_P4);
  for (const x of p4) assert.equal(x.matcher, x.if.slice(0, x.if.indexOf('(')));
  // Nenhum `if` com curinga antes do nome (Bash(*claude*) levaria o git commit
  // com o trailer do Claude à P4).
  for (const x of handlers) if (x.if !== undefined) assert.match(x.if, /^[A-Za-z]+\([^*]/, x.if);
  // Os três hooks antigos seguem em forma de shell; o prompt-submit bloqueia
  // desde a v0.4.0 e tem 10 s.
  const antigos = handlers.filter((x) => !Array.isArray(x.args));
  assert.deepEqual(antigos.map((x) => [x.evento, x.timeout]), [['SessionStart', 5], ['UserPromptSubmit', 10], ['SessionEnd', 5]]);
  for (const x of antigos) assert.match(x.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/src\/hooks\/[a-z-]+\.js"$/);
});

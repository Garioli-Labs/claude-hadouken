import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import { avaliarGuarda } from '../src/guarda/avaliar.js';

// Replay do incidente de 2026-09-28/29 (spec v0.4.0 §1.1 e §1.3, critério 1):
// uma sessão despacha revisores fable-xhigh em sequência, e o 7d sobe 3 pontos
// por revisor. A guarda nega o primeiro (G5, despacho caro). Depois do
// /claude-hadouken:liberar caro, passam 4 e o quinto é negado, porque a
// liberação acaba com +10 pontos de 7d e o G7 conta 4 Fable em 5 h.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const H = 3_600_000;
const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function preparar() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk replay '));
  homes.push(home);
  assert.ok(home.startsWith(os.tmpdir()));
  fs.mkdirSync(path.join(home, 'cfg', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, 'cfg', 'agents', 'fable-xhigh.md'), '---\nname: fable-xhigh\nmodel: fable\neffort: xhigh\n---\nRevisor.\n');
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try { registrarSessao('s1', Date.now()); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME; else process.env.HADOUKEN_HOME = antes;
  }
  return home;
}
function estado(home, u7) {
  const agora = Date.now();
  const at = new Date(agora).toISOString();
  fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({ versao: 1, at, five_hour: null,
    seven_day: { used_percentage: u7, resets_at: Math.floor(agora / 1000) + 4 * 86_400, at }, sessoes: {}, historico: [] }));
}
function hook(home, nome, entrada) {
  const env = { ...process.env, HADOUKEN_HOME: home, HADOUKEN_SEM_PAINEL: '1', CLAUDE_CONFIG_DIR: path.join(home, 'cfg'), CLAUDE_EFFORT: 'high', CLAUDE_CODE_ENTRYPOINT: 'cli' };
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', nome)], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout);
}
const revisor = { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'fable-xhigh', description: 'review', prompt: 'x' }, cwd: os.tmpdir() };

test('replay: G5 nega o primeiro revisor; com liberar caro, passam 4 e o quinto para', () => {
  const home = preparar();
  estado(home, 60);
  assert.match(hook(home, 'guarda-despacho.js', revisor).stopReason, /despacho caro: Fable com effort xhigh/);
  const lib = hook(home, 'liberar.js', { session_id: 's1', hook_event_name: 'UserPromptExpansion', command_name: 'claude-hadouken:liberar', command_args: 'caro' });
  assert.equal(lib.decision, 'block');
  const resultados = [];
  for (let i = 0; i < 16; i++) {
    estado(home, 60 + 3 * i);
    const o = hook(home, 'guarda-despacho.js', revisor);
    resultados.push(o === null ? 'passou' : 'negado');
    if (o !== null) {
      assert.equal(o.stopReason, 'hadouken parou o turno: 4 despachos Fable em 5 h, teto 4. Para seguir, digite /claude-hadouken:liberar.');
      break;
    }
  }
  assert.deepEqual(resultados, ['passou', 'passou', 'passou', 'passou', 'negado']);
});

test('B1: 26 min de histórico de 7d não disparam G2; 2 h 10 min disparam', () => {
  const home = preparar();
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const serie = (min) => {
    const pts = [];
    for (let t = min; t >= 0; t -= 2) pts.push({ at: new Date(agora - t * 60_000).toISOString(), h5: null, d7: 76 - (t / 60) * 3 });
    return pts;
  };
  const gravar = (historico) => {
    const at = new Date(agora).toISOString();
    fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({ versao: 1, at, five_hour: null,
      seven_day: { used_percentage: 76, resets_at: s + 4 * 86_400, at }, sessoes: {}, historico }));
  };
  gravar(serie(26));
  assert.equal(avaliarGuarda({ dir: home, agoraMs: agora, sessionId: 's1' }).status, 'armada');
  fs.rmSync(path.join(home, 'guarda.json'), { force: true });
  gravar(serie(130));
  const g = avaliarGuarda({ dir: home, agoraMs: agora, sessionId: 's1' });
  assert.deepEqual(g.ativas, ['seven_day']);
  assert.equal(g.motivos[0].gatilho, 'G2');
  assert.ok(g.motivos[0].dados.quandoMs - agora <= 24 * H);
});

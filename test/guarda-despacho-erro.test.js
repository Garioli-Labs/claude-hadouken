import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import { lerEventos } from '../src/guarda/registros.js';
import { falharAberto } from '../src/hooks/comum.js';

// Fail-open visível da P1 (spec v0.4.0 §4.5): uma exceção depois do gate deixa
// o despacho passar e registra o evento 'erro' com o detalhe 'P1'. Arquivo à
// parte de test/guarda-hooks.test.js, com um spawn mínimo próprio: o filho
// recebe HADOUKEN_HOME e CLAUDE_CONFIG_DIR temporários, HADOUKEN_SEM_PAINEL=1 e
// nenhum CLAUDE_EFFORT ou CLAUDE_CODE_SUBAGENT_MODEL do processo de teste.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const hook = path.join(repo, 'src', 'hooks', 'guarda-despacho.js');

const homes = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk erro ç '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg'), { recursive: true });
  return d;
}
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function conferirHome(home) {
  assert.ok(typeof home === 'string' && path.isAbsolute(home), `HADOUKEN_HOME ausente: ${home}`);
  assert.ok(home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
}

function comHome(home, fn) {
  conferirHome(home);
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try { return fn(); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
}

function rodar(entrada, home, preload) {
  conferirHome(home);
  const env = { ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'), HADOUKEN_SEM_PAINEL: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' };
  delete env.CLAUDE_EFFORT;
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, ['--require', preload, hook], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 15_000 });
}

// 7d em 86%: G4 dispara e a P1 vai negar, então a escrita do deny é a
// exceção depois da avaliação.
function gravarEstadoDisparado(home) {
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const at = new Date(agora).toISOString();
  fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 20, resets_at: s + 3 * 3600, at },
    seven_day: { used_percentage: 86, resets_at: s + 4 * 86_400, at },
    sessoes: {}, historico: [],
  }));
}

const eventos = (home, tipo) => lerEventos(home, Date.now()).filter((e) => e.tipo === tipo);

test('P1: exceção depois da avaliação deixa o despacho passar e registra erro P1', () => {
  const home = novoHome();
  comHome(home, () => registrarSessao('s1', Date.now()));
  gravarEstadoDisparado(home);
  // Pré-carregado no filho: a escrita no stdout lança (emitirJson do deny).
  const preload = path.join(home, 'stdout-quebrado.cjs');
  fs.writeFileSync(preload, "process.stdout.write = () => { throw new Error('stdout quebrado'); };\n");
  const r = rodar({
    session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose' }, cwd: os.tmpdir(),
  }, home, preload);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
  const erros = eventos(home, 'erro');
  assert.equal(erros.length, 1);
  assert.equal(erros[0].detalhe, 'P1');
  assert.equal(eventos(home, 'negado').length, 0);
});

test('falharAberto: exceção síncrona ou rejeição registra erro; sucesso não; registro impossível não lança', async () => {
  const home = novoHome();
  const agora = Date.now();
  await falharAberto(home, 'P1', agora, () => { throw new Error('x'); });
  await falharAberto(home, 'P1', agora, async () => { throw new Error('y'); });
  let rodou = false;
  await falharAberto(home, 'P1', agora, () => { rodou = true; });
  assert.equal(rodou, true);
  assert.deepEqual(eventos(home, 'erro').map((e) => e.detalhe), ['P1', 'P1']);
  await falharAberto(null, 'P1', agora, () => { throw new Error('z'); });
});

// Wall time of the three plugin hooks, from spawn to exit, as Claude Code runs
// them. Zero dependencies. Usage:
//
//   node bench/hooks-p95.mjs [runs]     (default 100 runs after 5 warm-up rounds)
//
// Spec section 9 sets a target only for the prompt hook (UserPromptSubmit),
// which runs before every prompt of every open session: p95 <= 250 ms on
// Windows, <= 150 ms on Linux and macOS. SessionStart and SessionEnd run once
// per session and have no target; their rows are informative. This script
// only reports the numbers (and whether each prompt-hook p95 is within the
// target of this platform); it asserts the outputs, not the target.
//
// Worst-case disk state, built in a temporary HADOUKEN_HOME that is removed at
// the end:
// - the measured session is registered, alongside 999 other registration files;
// - estado.json holds 50 sessions (its cap) and both rate-limit windows;
// - alertas.json holds both windows and 256 sem_leitura entries (its cap);
// - the shims in <home>/bin/ are already in sync with this checkout;
// - stdin is a realistic hook payload.
// Scenarios: prompt hook registered (gate, renew, read state and alert memory,
// evaluate, atomic write) and unregistered (gate only, loads neither estado.js
// nor alerta.js); SessionStart (register, shim sync, state line); SessionEnd
// registered (gate, read state, append one history line) and unregistered;
// and a bare `node -e ""` as the floor of any Node script.
//
// The scenarios are interleaved: every round runs each scenario once, in a
// fresh random order (Fisher-Yates), so machine drift (thermal, antivirus,
// background load) spreads over all rows instead of biasing whichever block
// ran during it. The warm-up rounds are shared the same way and not measured.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUNS = Number.parseInt(process.argv[2] ?? '100', 10);
const WARMUPS = 5;
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error('usage: node bench/hooks-p95.mjs [runs]');
  process.exit(2);
}
const ALVO_P95_MS = process.platform === 'win32' ? 250 : 150;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = (nome) => path.join(repo, 'src', 'hooks', nome);
const importar = (arq) => import(pathToFileURL(path.join(repo, 'src', arq)).href);

// Fisher-Yates on a copy.
function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench hooks '));
try {
  const { registrarSessao, DIR_ATIVAS } = await importar('ativas.js');
  const { atualizarEstado, ARQ_ESTADO } = await importar('estado.js');
  const { sincronizarShims } = await importar('shim.js');
  const { ARQ_ALERTAS } = await importar('hooks/alertas-gravados.js');
  const { ARQ_HISTORICO } = await importar('hooks/historico.js');

  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const uuid = (i) => `${i.toString(16).padStart(8, '0')}-1111-2222-3333-444455556666`;
  const barra = (id) => ({
    session_id: id,
    cwd: 'C:/projetos/proj x',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    effort: { level: 'high' },
    context_window: { used_percentage: 31 },
    prompt_cache: { hit_ratio: 0.9749 },
    rate_limits: { five_hour: { used_percentage: 42, resets_at: s + 3600 }, seven_day: { used_percentage: 61, resets_at: s + 3 * 86400 } },
  });
  const comum = (id, evento) => ({
    session_id: id,
    transcript_path: 'C:/Users/sintetico/.claude/projects/proj-x/abc.jsonl',
    cwd: 'C:/projetos/proj x',
    permission_mode: 'default',
    hook_event_name: evento,
  });
  const promptDe = (id) => ({ ...comum(id, 'UserPromptSubmit'), prompt: 'Refatore o parser e rode a suíte inteira antes do commit.' });
  const inicioDe = (id) => ({ ...comum(id, 'SessionStart'), source: 'startup' });
  const fimDe = (id) => ({ ...comum(id, 'SessionEnd'), reason: 'prompt_input_exit' });

  // The library functions read HADOUKEN_HOME at call time; set it only while
  // building the fixture.
  const homeAntes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try {
    // Oldest first, all within 30 days, so the prune on each register keeps them.
    for (let i = 999; i >= 1; i--) {
      const r = registrarSessao(uuid(i), agora - i * 60_000);
      if (!r.ok) throw new Error(`fixture: register ${i} failed: ${r.motivo}`);
    }
    if (!registrarSessao(uuid(0), agora).ok) throw new Error('fixture: register target failed');
    for (let i = 49; i >= 0; i--) atualizarEstado(barra(uuid(i)), agora - i * 1000);
    const r = sincronizarShims(repo);
    if (!r.ok) throw new Error(`fixture: shim sync failed: ${r.motivo}`);
  } finally {
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
  const semLeitura = {};
  for (let i = 1000; i < 1256; i++) semLeitura[uuid(i)] = true;
  fs.writeFileSync(path.join(home, ARQ_ALERTAS), JSON.stringify({
    at: new Date(agora).toISOString(),
    five_hour: { resets_at: s + 3600, faixa: 'ok' },
    seven_day: { resets_at: s + 3 * 86400, faixa: 'economico' },
    sem_leitura: semLeitura,
  }, null, 2));
  const nAtivas = fs.readdirSync(path.join(home, DIR_ATIVAS)).length;
  const estado = JSON.parse(fs.readFileSync(path.join(home, ARQ_ESTADO), 'utf8'));
  const nSessoes = Object.keys(estado.sessoes).length;
  const bytesAlertas = fs.statSync(path.join(home, ARQ_ALERTAS)).size;

  // Hook output: nothing, or one JSON object with the event's context.
  let linhaInicio = '';
  const contexto = (nome, evento) => (out) => {
    const v = JSON.parse(out);
    if (v?.hookSpecificOutput?.hookEventName !== evento || typeof v.hookSpecificOutput.additionalContext !== 'string') {
      throw new Error(`${nome}: unexpected output ${JSON.stringify(out)}`);
    }
    return v.hookSpecificOutput.additionalContext;
  };
  const vazioOuContexto = (nome, evento) => (out) => { if (out !== '') contexto(nome, evento)(out); };
  const semSaida = (nome) => (out) => {
    if (out !== '') throw new Error(`${nome}: expected no output, got ${JSON.stringify(out)}`);
  };
  const cenarios = [
    { nome: 'prompt registered', argv: [hook('prompt-submit.js')], stdin: JSON.stringify(promptDe(uuid(0))), conferir: vazioOuContexto('prompt registered', 'UserPromptSubmit'), alvo: true },
    { nome: 'prompt unregistered', argv: [hook('prompt-submit.js')], stdin: JSON.stringify(promptDe('nao-registrada')), conferir: semSaida('prompt unregistered'), alvo: true },
    {
      nome: 'session start',
      argv: [hook('session-start.js')],
      stdin: JSON.stringify(inicioDe(uuid(0))),
      conferir: (out) => { linhaInicio = contexto('session start', 'SessionStart')(out); },
      alvo: false,
    },
    { nome: 'session end registered', argv: [hook('session-end.js')], stdin: JSON.stringify(fimDe(uuid(0))), conferir: semSaida('session end registered'), alvo: false },
    { nome: 'session end unregistered', argv: [hook('session-end.js')], stdin: JSON.stringify(fimDe('nao-registrada')), conferir: semSaida('session end unregistered'), alvo: false },
    { nome: 'bare node -e ""', argv: ['-e', ''], stdin: '', conferir: () => {}, alvo: false },
  ];

  const env = { ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo };
  function rodar(c) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, c.argv, { input: c.stdin, env, encoding: 'utf8' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.status !== 0 || r.stderr !== '') throw new Error(`${c.nome}: status ${r.status}, stderr ${JSON.stringify(r.stderr)}`);
    c.conferir(r.stdout);
    return ms;
  }
  for (let i = 0; i < WARMUPS; i++) for (const c of embaralhar(cenarios)) rodar(c);
  const tempos = new Map(cenarios.map((c) => [c, []]));
  for (let i = 0; i < RUNS; i++) for (const c of embaralhar(cenarios)) tempos.get(c).push(rodar(c));

  const historico = fs.readFileSync(path.join(home, ARQ_HISTORICO), 'utf8').split('\n').filter(Boolean);
  const esperadas = WARMUPS + RUNS;
  if (historico.length !== esperadas) throw new Error(`session end: ${historico.length} history lines, expected ${esperadas}`);

  const quantil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)];
  const resumo = (lista) => {
    const o = [...lista].sort((a, b) => a - b);
    const media = o.reduce((soma, x) => soma + x, 0) / o.length;
    return { n: o.length, min: o[0], p50: quantil(o, 0.5), media, p95: quantil(o, 0.95), max: o[o.length - 1] };
  };
  const fmt = (x) => x.toFixed(1).padStart(6);
  console.log(`node ${process.version} ${process.platform} ${os.arch()}, ${os.cpus()[0]?.model ?? 'cpu?'}`);
  console.log(`fixture: ${nAtivas} registration files, ${nSessoes} sessions in estado.json, alertas.json ${bytesAlertas} B with 256 sem_leitura entries`);
  console.log(`runs: ${RUNS} interleaved rounds after ${WARMUPS} shared warm-up rounds, spawn to exit`);
  for (const c of cenarios) {
    const r = resumo(tempos.get(c));
    const veredito = c.alvo ? (r.p95 <= ALVO_P95_MS ? '  within target' : '  OVER target') : '';
    console.log(`${c.nome.padEnd(26)} n=${r.n}  min=${fmt(r.min)}  p50=${fmt(r.p50)}  mean=${fmt(r.media)}  p95=${fmt(r.p95)}  max=${fmt(r.max)} ms${veredito}`);
  }
  console.log(`session start context: ${JSON.stringify(linhaInicio)}`);
  console.log(`history lines appended: ${historico.length}`);
  console.log(`target (spec 9) on ${process.platform}: p95 <= ${ALVO_P95_MS} ms for the prompt hook rows; reported, not asserted`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

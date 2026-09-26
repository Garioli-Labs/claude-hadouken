// Wall time of the three plugin hooks, from spawn to exit, as Claude Code runs
// them. Zero dependencies. Usage:
//
//   node bench/hooks-p95.mjs [runs] [--json]     (default 100 runs after 5 warm-up rounds)
//
// --json prints a single JSON object (fixture facts and one row per scenario,
// keyed by a stable `id`) instead of the text report; bench/rodar-todos.mjs
// reads it.
//
// Spec section 9 gives the three hooks the status line target: p95 <= 250 ms
// on Windows, <= 150 ms on Linux and macOS. The prompt hook (UserPromptSubmit)
// runs before every prompt of every open session; SessionStart and SessionEnd
// run once per session and share the same target (spec 6.5, 2026-09-26). The
// bare `node -e ""` row is the floor, with no target. This script only reports
// the numbers (and whether each hook p95 is within the target of this
// platform); it asserts the outputs, not the target.
//
// Worst-case disk state, built in a temporary HADOUKEN_HOME that is removed at
// the end:
// - the measured session is registered, alongside 999 other registration files;
// - estado.json holds 50 sessions (its cap) and both rate-limit windows;
// - alertas.json holds both windows and 256 sem_leitura entries (its cap);
// - the shims in <home>/bin/ are already in sync with this checkout;
// - stdin is a realistic hook payload.
// Scenarios:
// - prompt hook registered, in two rows. Both run the gate, renew, read the
//   state and the alert memory, and evaluate.
//   - "unchanged" is the common prompt: the memory is what this fixture
//     evaluates to, with an `at` 1 min old, so the hook writes nothing.
//   - "writes" has the same memory with an `at` 10 min old, so the hook
//     rewrites alertas.json atomically (Task 7 review M2: the memory is
//     rewritten only when it changes or its `at` is 5 min old or more).
//   Each row plants its memory before the timed spawn and checks afterwards
//   that the file was left alone, or rewritten, as it claims.
// - prompt hook unregistered: gate only; loads neither estado.js nor alerta.js.
// - SessionStart: register, shim sync, state line.
// - SessionEnd registered (gate, read state, append one history line) and
//   unregistered.
// - a bare `node -e ""` as the floor of any Node script.
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

const argumentos = process.argv.slice(2);
const SAIDA_JSON = argumentos.includes('--json');
const posicionais = argumentos.filter((a) => a !== '--json');
const RUNS = Number.parseInt(posicionais[0] ?? '100', 10);
const WARMUPS = 5;
if (!Number.isInteger(RUNS) || RUNS < 1 || posicionais.length > 1) {
  console.error('usage: node bench/hooks-p95.mjs [runs] [--json]');
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

  const env = { ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo };
  // One untimed prompt settles the alert memory to what this fixture
  // evaluates to (the 7d band of the seeded memory differs from the reading).
  const arqAlertas = path.join(home, ARQ_ALERTAS);
  const stdinPrompt = JSON.stringify(promptDe(uuid(0)));
  const acomodar = spawnSync(process.execPath, [hook('prompt-submit.js')], { input: stdinPrompt, env, encoding: 'utf8' });
  if (acomodar.status !== 0 || acomodar.stderr !== '') throw new Error(`fixture: settling prompt failed: ${acomodar.stderr}`);
  vazioOuContexto('fixture', 'UserPromptSubmit')(acomodar.stdout);
  const memoriaEstavel = JSON.parse(fs.readFileSync(arqAlertas, 'utf8'));
  let memoriaPlantada = '';
  const plantarMemoria = (idadeMs) => () => {
    memoriaPlantada = JSON.stringify({ ...memoriaEstavel, at: new Date(Date.now() - idadeMs).toISOString() }, null, 2);
    fs.writeFileSync(arqAlertas, memoriaPlantada);
  };
  const memoriaGravada = (nome, esperaGravar) => (out) => {
    semSaida(nome)(out);
    const gravou = fs.readFileSync(arqAlertas, 'utf8') !== memoriaPlantada;
    if (gravou !== esperaGravar) throw new Error(`${nome}: alertas.json was ${gravou ? '' : 'not '}rewritten`);
  };

  const cenarios = [
    {
      id: 'prompt-registrada-sem-gravar',
      nome: 'prompt reg. unchanged',
      argv: [hook('prompt-submit.js')],
      stdin: stdinPrompt,
      preparar: plantarMemoria(60_000),
      conferir: memoriaGravada('prompt reg. unchanged', false),
      alvo: true,
    },
    {
      id: 'prompt-registrada-grava',
      nome: 'prompt reg. writes',
      argv: [hook('prompt-submit.js')],
      stdin: stdinPrompt,
      preparar: plantarMemoria(10 * 60_000),
      conferir: memoriaGravada('prompt reg. writes', true),
      alvo: true,
    },
    { id: 'prompt-nao-registrada', nome: 'prompt unregistered', argv: [hook('prompt-submit.js')], stdin: JSON.stringify(promptDe('nao-registrada')), conferir: semSaida('prompt unregistered'), alvo: true },
    {
      id: 'session-start',
      nome: 'session start',
      argv: [hook('session-start.js')],
      stdin: JSON.stringify(inicioDe(uuid(0))),
      conferir: (out) => { linhaInicio = contexto('session start', 'SessionStart')(out); },
      alvo: true,
    },
    { id: 'session-end-registrada', nome: 'session end registered', argv: [hook('session-end.js')], stdin: JSON.stringify(fimDe(uuid(0))), conferir: semSaida('session end registered'), alvo: true },
    { id: 'session-end-nao-registrada', nome: 'session end unregistered', argv: [hook('session-end.js')], stdin: JSON.stringify(fimDe('nao-registrada')), conferir: semSaida('session end unregistered'), alvo: true },
    { id: 'node-vazio', nome: 'bare node -e ""', argv: ['-e', ''], stdin: '', conferir: () => {}, alvo: false },
  ];

  function rodar(c) {
    c.preparar?.();
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
  if (SAIDA_JSON) {
    console.log(JSON.stringify({
      bench: 'hooks-p95',
      plataforma: process.platform,
      node: process.version,
      alvoP95Ms: ALVO_P95_MS,
      rodadas: RUNS,
      aquecimento: WARMUPS,
      fixture: { ativas: nAtivas, sessoes: nSessoes, bytesAlertas, linhasHistorico: historico.length },
      linhas: cenarios.map((c) => ({ id: c.id, nome: c.nome, alvo: c.alvo, ...resumo(tempos.get(c)) })),
    }));
  } else {
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
    console.log(`target (spec 9) on ${process.platform}: p95 <= ${ALVO_P95_MS} ms for every hook row (not the bare node floor); reported, not asserted`);
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

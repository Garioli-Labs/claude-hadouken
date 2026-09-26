// Wall time of the status line, from spawn to exit, as Claude Code runs it on
// every refresh. Zero dependencies. Usage:
//
//   node bench/statusline-p95.mjs [runs] [--json]     (default 100 runs after 5 warm-up rounds)
//
// --json prints a single JSON object (fixture facts and one row per scenario,
// keyed by a stable `id`) instead of the text report; bench/rodar-todos.mjs
// reads it.
//
// Spec section 9 sets the target: p95 <= 250 ms on Windows, <= 150 ms on
// Linux and macOS. This script only reports the numbers (and whether each p95
// is within the target of this platform); it asserts the outputs, not the
// target.
//
// Worst-case disk state, built in a temporary HADOUKEN_HOME that is removed at
// the end:
// - the measured session is registered, alongside 999 other registration files;
// - estado.json holds 50 sessions (its cap) and both rate-limit windows;
// - stdin is a realistic, complete statusline payload.
// Scenarios: registered (gate, merge, atomic write, render), unregistered (gate
// only, prints nothing), the same two through the stable shim
// <home>/bin/statusline.mjs (what settings.json runs), and a bare `node -e ""`
// as the floor of any Node script.
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
  console.error('usage: node bench/statusline-p95.mjs [runs] [--json]');
  process.exit(2);
}
const ALVO_P95_MS = process.platform === 'win32' ? 250 : 150;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'src', 'statusline.js');
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

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench '));
try {
  const { registrarSessao, DIR_ATIVAS } = await importar('ativas.js');
  const { atualizarEstado, ARQ_ESTADO } = await importar('estado.js');
  const { sincronizarShims, DIR_BIN } = await importar('shim.js');

  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const uuid = (i) => `${i.toString(16).padStart(8, '0')}-1111-2222-3333-444455556666`;
  const entrada = (id) => ({
    session_id: id,
    transcript_path: 'C:/Users/sintetico/.claude/projects/proj-x/abc.jsonl',
    cwd: 'C:/projetos/proj x',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    workspace: { current_dir: 'C:/projetos/proj x', project_dir: 'C:/projetos/proj x' },
    version: '2.5.0',
    output_style: { name: 'default' },
    effort: { level: 'high' },
    cost: { total_cost_usd: 1.23, total_duration_ms: 456789, total_api_duration_ms: 123456, total_lines_added: 10, total_lines_removed: 2 },
    exceeds_200k_tokens: false,
    context_window: { used_percentage: 31, total_input_tokens: 62000, total_output_tokens: 9000, context_window_size: 200000 },
    prompt_cache: { hit_ratio: 0.9749 },
    rate_limits: { five_hour: { used_percentage: 42, resets_at: s + 3600 }, seven_day: { used_percentage: 61, resets_at: s + 3 * 86400 } },
  });

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
    for (let i = 49; i >= 0; i--) atualizarEstado(entrada(uuid(i)), agora - i * 1000);
    const r = sincronizarShims(repo);
    if (!r.ok) throw new Error(`fixture: shim sync failed: ${r.motivo}`);
  } finally {
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
  const nAtivas = fs.readdirSync(path.join(home, DIR_ATIVAS)).length;
  const estado = JSON.parse(fs.readFileSync(path.join(home, ARQ_ESTADO), 'utf8'));
  const nSessoes = Object.keys(estado.sessoes).length;

  // The caller's NO_COLOR decides whether the bar is coloured; the check strips
  // the only escapes the bar may carry (the fixed colour codes).
  const PREFIXO_BARRA = 'Opus 5.5\u00b7high \u2502 5h 42%';
  const CORES_FIXAS = /\x1b\[(?:3[123]|0)m/g;
  let barra = '';
  const barraCerta = (nome) => (out) => {
    if (!out.replace(CORES_FIXAS, '').startsWith(PREFIXO_BARRA)) throw new Error(`${nome}: unexpected output ${JSON.stringify(out)}`);
    barra = out;
  };
  const semSaida = (nome) => (out) => {
    if (out !== '') throw new Error(`${nome}: expected no output, got ${JSON.stringify(out)}`);
  };
  const shim = path.join(home, DIR_BIN, 'statusline.mjs');
  const registrada = JSON.stringify(entrada(uuid(0)));
  const naoRegistrada = JSON.stringify(entrada('nao-registrada'));
  const cenarios = [
    { id: 'registrada', nome: 'registered (full path)', argv: [script], stdin: registrada, conferir: barraCerta('registered'), alvo: true },
    { id: 'nao-registrada', nome: 'unregistered (gate only)', argv: [script], stdin: naoRegistrada, conferir: semSaida('unregistered'), alvo: true },
    { id: 'registrada-shim', nome: 'registered via shim', argv: [shim], stdin: registrada, conferir: barraCerta('registered via shim'), alvo: true },
    { id: 'nao-registrada-shim', nome: 'unregistered via shim', argv: [shim], stdin: naoRegistrada, conferir: semSaida('unregistered via shim'), alvo: true },
    { id: 'node-vazio', nome: 'bare node -e ""', argv: ['-e', ''], stdin: '', conferir: () => {}, alvo: false },
  ];

  const env = { ...process.env, HADOUKEN_HOME: home };
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

  const quantil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)];
  const resumo = (lista) => {
    const o = [...lista].sort((a, b) => a - b);
    const media = o.reduce((soma, x) => soma + x, 0) / o.length;
    return { n: o.length, min: o[0], p50: quantil(o, 0.5), media, p95: quantil(o, 0.95), max: o[o.length - 1] };
  };
  const fmt = (x) => x.toFixed(1).padStart(6);
  const bytesEstado = fs.statSync(path.join(home, ARQ_ESTADO)).size;
  if (SAIDA_JSON) {
    console.log(JSON.stringify({
      bench: 'statusline-p95',
      plataforma: process.platform,
      node: process.version,
      alvoP95Ms: ALVO_P95_MS,
      rodadas: RUNS,
      aquecimento: WARMUPS,
      cor: !process.env.NO_COLOR,
      fixture: { ativas: nAtivas, sessoes: nSessoes, bytesEstado },
      linhas: cenarios.map((c) => ({ id: c.id, nome: c.nome, alvo: c.alvo, ...resumo(tempos.get(c)) })),
    }));
  } else {
    console.log(`node ${process.version} ${process.platform} ${os.arch()}, ${os.cpus()[0]?.model ?? 'cpu?'}`);
    console.log(`fixture: ${nAtivas} registration files, ${nSessoes} sessions in estado.json (${bytesEstado} B)`);
    console.log(`runs: ${RUNS} interleaved rounds after ${WARMUPS} shared warm-up rounds, spawn to exit; colour ${process.env.NO_COLOR ? 'off (NO_COLOR)' : 'on'}`);
    for (const c of cenarios) {
      const r = resumo(tempos.get(c));
      const veredito = c.alvo ? (r.p95 <= ALVO_P95_MS ? '  within target' : '  OVER target') : '';
      console.log(`${c.nome.padEnd(26)} n=${r.n}  min=${fmt(r.min)}  p50=${fmt(r.p50)}  mean=${fmt(r.media)}  p95=${fmt(r.p95)}  max=${fmt(r.max)} ms${veredito}`);
    }
    console.log(`bar: ${JSON.stringify(barra)}`);
    console.log(`target (spec 9) on ${process.platform}: p95 <= ${ALVO_P95_MS} ms for the status line rows; reported, not asserted`);
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

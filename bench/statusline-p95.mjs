// Wall time of `node src/statusline.js`, from spawn to exit, as Claude Code
// runs it on every refresh. Zero dependencies. Usage:
//
//   node bench/statusline-p95.mjs [runs]     (default 100 runs after 5 warm-ups)
//
// Spec section 9 sets the target p95 <= 150 ms. This script only reports the
// numbers; it asserts the outputs, not the target.
//
// Worst-case disk state, built in a temporary HADOUKEN_HOME that is removed at
// the end:
// - the measured session is registered, alongside 999 other registration files;
// - estado.json holds 50 sessions (its cap) and both rate-limit windows;
// - stdin is a realistic, complete statusline payload.
// Scenarios: registered (gate, merge, atomic write, render), unregistered (gate
// only, prints nothing), and a bare `node -e ""` as the floor of any Node script.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUNS = Number.parseInt(process.argv[2] ?? '100', 10);
const WARMUPS = 5;
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error('usage: node bench/statusline-p95.mjs [runs]');
  process.exit(2);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'src', 'statusline.js');
const importar = (arq) => import(pathToFileURL(path.join(repo, 'src', arq)).href);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench '));
try {
  const { registrarSessao, DIR_ATIVAS } = await importar('ativas.js');
  const { atualizarEstado, ARQ_ESTADO } = await importar('estado.js');

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
  } finally {
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
  const nAtivas = fs.readdirSync(path.join(home, DIR_ATIVAS)).length;
  const estado = JSON.parse(fs.readFileSync(path.join(home, ARQ_ESTADO), 'utf8'));
  const nSessoes = Object.keys(estado.sessoes).length;

  const env = { ...process.env, HADOUKEN_HOME: home };
  const quantil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)];
  function medir(argv, stdin, conferir) {
    const tempos = [];
    for (let i = 0; i < RUNS + WARMUPS; i++) {
      const t0 = process.hrtime.bigint();
      const r = spawnSync(process.execPath, argv, { input: stdin, env, encoding: 'utf8' });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (r.status !== 0 || r.stderr !== '') throw new Error(`run ${i}: status ${r.status}, stderr ${JSON.stringify(r.stderr)}`);
      conferir(r.stdout);
      if (i >= WARMUPS) tempos.push(ms);
    }
    tempos.sort((a, b) => a - b);
    return { n: tempos.length, min: tempos[0], p50: quantil(tempos, 0.5), p95: quantil(tempos, 0.95), max: tempos[tempos.length - 1] };
  }

  // The caller's NO_COLOR decides whether the bar is coloured; the check strips
  // the only escapes the bar may carry (the fixed colour codes).
  const PREFIXO_BARRA = 'Opus 5.5\u00b7high \u2502 5h 42%';
  const CORES_FIXAS = /\x1b\[(?:3[123]|0)m/g;
  let barra = '';
  const registrada = medir([script], JSON.stringify(entrada(uuid(0))), (out) => {
    if (!out.replace(CORES_FIXAS, '').startsWith(PREFIXO_BARRA)) throw new Error(`registered: unexpected output ${JSON.stringify(out)}`);
    barra = out;
  });
  const naoRegistrada = medir([script], JSON.stringify(entrada('nao-registrada')), (out) => {
    if (out !== '') throw new Error(`unregistered: expected no output, got ${JSON.stringify(out)}`);
  });
  const nodeVazio = medir(['-e', ''], '', () => {});

  const fmt = (x) => x.toFixed(1).padStart(6);
  const linha = (nome, r) => `${nome.padEnd(26)} n=${r.n}  min=${fmt(r.min)}  p50=${fmt(r.p50)}  p95=${fmt(r.p95)}  max=${fmt(r.max)} ms`;
  console.log(`node ${process.version} ${process.platform} ${os.arch()}, ${os.cpus()[0]?.model ?? 'cpu?'}`);
  console.log(`fixture: ${nAtivas} registration files, ${nSessoes} sessions in estado.json (${fs.statSync(path.join(home, ARQ_ESTADO)).size} B)`);
  console.log(`runs: ${RUNS} measured after ${WARMUPS} warm-ups, spawn to exit; colour ${process.env.NO_COLOR ? 'off (NO_COLOR)' : 'on'}`);
  console.log(linha('registered (full path)', registrada));
  console.log(linha('unregistered (gate only)', naoRegistrada));
  console.log(linha('bare node -e ""', nodeVazio));
  console.log(`bar: ${JSON.stringify(barra)}`);
  console.log('target (spec 9): p95 <= 150 ms for the registered path; not asserted here');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

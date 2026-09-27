// A/B wall time of two plugin roots, paired and interleaved, from spawn to
// exit. Zero dependencies. Usage:
//
//   node bench/ab-raizes.mjs <rootA> <rootB> [pairs] [--json] [--allow-different-folders]
//   (default 200 pairs after 10 warm-up rounds)
//
// Each root is a plugin tree with package.json and src/, and the two roots
// must be sibling folders in the same parent folder (so on the same volume):
// where the files sit moves the timings on its own. In Task 9 of plan v0.2.0
// an A/A run with identical sources, A in a temporary folder and B the working
// tree of the repo, favoured B by 0.7 to 4.5 ms, above the 1.0 ms threshold
// below; with both copies in one folder it was neutral on every scenario. So
// never the working tree against a temporary copy: extract both side by side,
// for example
//   mkdir -p <parent>/a <parent>/b
//   git archive <base> package.json src | tar -x -C <parent>/a
//   git archive <commit> package.json src | tar -x -C <parent>/b
// (for uncommitted changes, `tar -c package.json src | tar -x -C <parent>/b`
// run in the working tree). Roots whose parent folders differ, compared after
// resolving links and 8.3 names and without case on Windows, are refused with
// exit code 2 and no verdict; --allow-different-folders measures them anyway,
// with a warning on stderr, a WARNING line in the report and
// "mesmaPasta": false in --json. Each child gets 15 s; one that has not exited
// by then is killed and the run fails with the scenario's name, no verdict.
// Plan v0.2.0, Task 9: an optimisation is
// kept only if B beats A on the scenario it targets and no scenario regresses,
// in two independent runs:
// - gain: median of the paired differences (B - A) <= -1.0 ms and B faster in
//   at least 55 % of the pairs;
// - regression: median >= +1.0 ms and B slower in at least 55 % of the pairs;
// - anything else is neutral.
// The median is the true one: with an even number of pairs, the mean of the
// two middle differences (the lower one alone would lean toward gain).
// This script only reports the verdict of one run; it never changes a file of
// either root.
//
// Worst-case disk state as in statusline-p95.mjs, built once with root A's own
// library in a temporary HADOUKEN_HOME and copied (timestamps kept) to a
// second one, so each root reads and writes only its own copy:
// - the measured session is registered, alongside 999 other registration files;
// - estado.json holds 50 sessions (its cap) and both rate-limit windows, plus
//   the full history of spec v0.2.0 §12.8 (90 points over 3 h; a root from
//   before §12 ignores the key);
// - stdin is a realistic payload.
// Before every round, each `at` in estado.json moves forward by the time
// elapsed since the fixture was built (as in hooks-p95.mjs), and both homes
// get the same bytes, so the 50 sessions stay inside the 5 min active window
// and the 90 history points inside the 3 h horizon however long the run
// takes. Checked each round, untimed, with the §12 library of root A (or of
// root B when A is older than §12); a root with §12 must also print
// "50 sessões" and the 7d forecast on the registered status line.
// Scenarios, each run on both roots: status line registered and unregistered,
// prompt hook registered and unregistered. Every round visits the scenarios in
// a fresh random order (Fisher-Yates) and flips a coin for which root runs
// first, so machine drift spreads over both roots. NODE_COMPILE_CACHE and
// NODE_DISABLE_COMPILE_CACHE are removed from the children's environment: the
// roots decide about the compile cache, not the caller's shell.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argumentos = process.argv.slice(2);
const SAIDA_JSON = argumentos.includes('--json');
const PASTAS_DIFERENTES = '--allow-different-folders';
const PERMITIR_PASTAS = argumentos.includes(PASTAS_DIFERENTES);
const posicionais = argumentos.filter((a) => a !== '--json' && a !== PASTAS_DIFERENTES);
const PARES = Number.parseInt(posicionais[2] ?? '200', 10);
const WARMUPS = 10;
const LIMIAR_MS = 1.0;
const MAIORIA = 0.55;
const PRAZO_FILHO_MS = 15_000;
if (posicionais.length < 2 || posicionais.length > 3 || !Number.isInteger(PARES) || PARES < 1) {
  console.error(`usage: node bench/ab-raizes.mjs <rootA> <rootB> [pairs] [--json] [${PASTAS_DIFERENTES}]`);
  process.exit(2);
}
const raizes = posicionais.slice(0, 2).map((r) => path.resolve(r));
for (const raiz of raizes) {
  for (const arq of ['package.json', 'src/statusline.js', 'src/hooks/prompt-submit.js', 'src/ativas.js', 'src/estado.js']) {
    if (!fs.statSync(path.join(raiz, arq), { throwIfNoEntry: false })?.isFile()) {
      console.error(`not a plugin root (missing ${arq}): ${raiz}`);
      process.exit(2);
    }
  }
}
const [raizA, raizB] = raizes;
// Both roots in the same parent folder (see the header).
const pastaMae = (raiz) => {
  const p = path.dirname(fs.realpathSync.native(raiz));
  return process.platform === 'win32' ? p.toLowerCase() : p;
};
const MESMA_PASTA = pastaMae(raizA) === pastaMae(raizB);
const AVISO_PASTAS = `roots in different parent folders (${path.dirname(raizA)} and ${path.dirname(raizB)}): `
  + `the location alone can move the timings by more than the ${LIMIAR_MS.toFixed(1)} ms threshold (Task 9 A/A control)`;
if (!MESMA_PASTA) {
  if (!PERMITIR_PASTAS) {
    console.error(`refused, no verdict: ${AVISO_PASTAS}. Put both roots in one parent folder, or pass ${PASTAS_DIFERENTES} to measure anyway.`);
    process.exit(2);
  }
  console.error(`WARNING: ${AVISO_PASTAS}; measuring anyway (${PASTAS_DIFERENTES}).`);
}
const importar = (raiz, arq) => import(pathToFileURL(path.join(raiz, 'src', arq)).href);

// Fisher-Yates on a copy.
function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk ab '));
try {
  const homeA = path.join(tmp, 'home A');
  const homeB = path.join(tmp, 'home B');
  fs.mkdirSync(homeA);
  const { registrarSessao } = await importar(raizA, 'ativas.js');
  const estadoA = await importar(raizA, 'estado.js');
  const { atualizarEstado, ARQ_ESTADO } = estadoA;

  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const uuid = (i) => `${i.toString(16).padStart(8, '0')}-1111-2222-3333-444455556666`;
  const barra = (id) => ({
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
  const promptDe = (id) => ({
    session_id: id,
    transcript_path: 'C:/Users/sintetico/.claude/projects/proj-x/abc.jsonl',
    cwd: 'C:/projetos/proj x',
    permission_mode: 'default',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Refatore o parser e rode a suíte inteira antes do commit.',
  });

  // The library functions read HADOUKEN_HOME at call time; set it only while
  // building the fixture.
  const homeAntes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = homeA;
  try {
    // Oldest first, all within 30 days, so the prune on each register keeps them.
    for (let i = 999; i >= 1; i--) {
      const r = registrarSessao(uuid(i), agora - i * 60_000);
      if (!r.ok) throw new Error(`fixture: register ${i} failed: ${r.motivo}`);
    }
    if (!registrarSessao(uuid(0), agora).ok) throw new Error('fixture: register target failed');
    for (let i = 49; i >= 0; i--) atualizarEstado(barra(uuid(i)), agora - i * 1000);
    // Full history (spec v0.2.0 §12.8), as in statusline-p95.mjs: 90 points
    // 2 min apart, the newest 30 s ago. Literal numbers, not root A's
    // constants: a root from before §12 has none of them.
    const arqEstado = path.join(homeA, ARQ_ESTADO);
    const cheio = JSON.parse(fs.readFileSync(arqEstado, 'utf8'));
    cheio.historico = Array.from({ length: 90 }, (_, k) => {
      const i = 89 - k;
      return { at: new Date(agora - 30_000 - i * 120_000).toISOString(), h5: 42 - i * 0.25, d7: 61 - i * 0.07 };
    });
    fs.writeFileSync(arqEstado, JSON.stringify(cheio, null, 2));
  } finally {
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
  fs.cpSync(homeA, homeB, { recursive: true, preserveTimestamps: true });

  // The worst case stays live for the whole run (see the header).
  // Root A's estado.js, already loaded for the fixture, does the check when it
  // has §12. Root B's is loaded only when A lacks §12 or when a text probe of
  // B's src/estado.js says B lacks it: a negative probe would switch B's
  // output check off, so B's own module has to confirm it (a probe that
  // misses §12 throws). A positive probe keeps the check on, and a wrong one
  // fails there, loudly. The probe is also cross-checked against A's module.
  const temSecao12 = (m) => typeof m?.validarEstado === 'function' && typeof m?.sessoesAtivas === 'function' && Number.isInteger(m?.HISTORICO_MAX);
  const SONDA_SECAO12 = [/^export function validarEstado\(/m, /^export function sessoesAtivas\(/m, /^export const HISTORICO_MAX = /m];
  const sondaSecao12 = (raiz) => {
    const fonte = fs.readFileSync(path.join(raiz, 'src', 'estado.js'), 'utf8');
    return SONDA_SECAO12.every((re) => re.test(fonte));
  };
  const secao12A = temSecao12(estadoA);
  if (sondaSecao12(raizA) !== secao12A) throw new Error('bench: the §12 text probe disagrees with root A\'s estado.js; update SONDA_SECAO12');
  let estadoB = secao12A ? null : await importar(raizB, 'estado.js');
  if (estadoB === null && !sondaSecao12(raizB)) {
    estadoB = await importar(raizB, 'estado.js');
    if (temSecao12(estadoB)) throw new Error('bench: the §12 text probe missed root B\'s §12; update SONDA_SECAO12');
  }
  const secao12B = estadoB === null ? true : temSecao12(estadoB);
  const conferidor = secao12A ? estadoA : secao12B ? estadoB : null;
  const arqsEstado = [homeA, homeB].map((h) => path.join(h, ARQ_ESTADO));
  const estadoBase = JSON.parse(fs.readFileSync(arqsEstado[0], 'utf8'));
  function reancorar() {
    const agoraRodada = Date.now();
    const desvio = agoraRodada - agora;
    const mover = (o) => { if (typeof o?.at === 'string') o.at = new Date(Date.parse(o.at) + desvio).toISOString(); };
    const e = structuredClone(estadoBase);
    for (const o of [e, e.five_hour, e.seven_day, ...Object.values(e.sessoes ?? {}), ...(Array.isArray(e.historico) ? e.historico : [])]) mover(o);
    const texto = JSON.stringify(e, null, 2);
    for (const arq of arqsEstado) fs.writeFileSync(arq, texto);
    if (conferidor === null) return;
    const valido = conferidor.validarEstado(e, agoraRodada);
    if (valido?.historico?.length !== conferidor.HISTORICO_MAX || conferidor.sessoesAtivas(valido, agoraRodada, uuid(0)) !== 50) {
      throw new Error('fixture: the worst case decayed');
    }
  }

  // Output checks that hold for any version from v0.1.0 on: the bar starts
  // with the model, then (from spec v0.2.0 §12 on, while other sessions are
  // active) the sessions segment, then the 5h label, and shows 42%;
  // unregistered prints nothing.
  const CORES_FIXAS = /\x1b\[(?:3[123]|0)m/g;
  const INICIO_BARRA = /^Opus 5\.5\u00b7high \u2502 (?:\d+ sess\u00f5es \u2502 )?5h /;
  const barraCerta = (nome) => (out, lado) => {
    const limpa = out.replace(CORES_FIXAS, '');
    if (!INICIO_BARRA.test(limpa) || !limpa.includes(' 42% ')) throw new Error(`${nome}: unexpected output ${JSON.stringify(out)}`);
    // A root with §12 shows the worst case: 50 sessions and the 7d forecast.
    if (lado.secao12 && (!limpa.includes(' 50 sessões │ ') || !limpa.includes(' →100% '))) {
      throw new Error(`${nome} (${lado.nome}): worst case missing from ${JSON.stringify(out)}`);
    }
  };
  const semSaida = (nome) => (out) => {
    if (out !== '') throw new Error(`${nome}: expected no output, got ${JSON.stringify(out)}`);
  };
  const qualquer = () => {};
  const cenarios = [
    { id: 'statusline-registrada', nome: 'status line registered', arq: ['statusline.js'], stdin: JSON.stringify(barra(uuid(0))), conferir: barraCerta('status line registered') },
    { id: 'statusline-nao-registrada', nome: 'status line unregistered', arq: ['statusline.js'], stdin: JSON.stringify(barra('nao-registrada')), conferir: semSaida('status line unregistered') },
    { id: 'prompt-registrada', nome: 'prompt registered', arq: ['hooks', 'prompt-submit.js'], stdin: JSON.stringify(promptDe(uuid(0))), conferir: qualquer },
    { id: 'prompt-nao-registrada', nome: 'prompt unregistered', arq: ['hooks', 'prompt-submit.js'], stdin: JSON.stringify(promptDe('nao-registrada')), conferir: semSaida('prompt unregistered') },
  ];

  const ambiente = (home) => {
    const env = { ...process.env, HADOUKEN_HOME: home };
    delete env.NODE_COMPILE_CACHE;
    delete env.NODE_DISABLE_COMPILE_CACHE;
    return env;
  };
  const lados = [
    { nome: 'A', raiz: raizA, env: ambiente(homeA), secao12: secao12A },
    { nome: 'B', raiz: raizB, env: ambiente(homeB), secao12: secao12B },
  ];
  function rodar(c, lado) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [path.join(lado.raiz, 'src', ...c.arq)], {
      input: c.stdin, env: lado.env, encoding: 'utf8', timeout: PRAZO_FILHO_MS,
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.error?.code === 'ETIMEDOUT') {
      throw new Error(`${c.nome} (${lado.nome}): no exit within ${PRAZO_FILHO_MS / 1000} s, child killed; no verdict`);
    }
    if (r.error) throw new Error(`${c.nome} (${lado.nome}): spawn failed: ${r.error.message}`);
    if (r.status !== 0 || r.stderr !== '') throw new Error(`${c.nome} (${lado.nome}): status ${r.status}, stderr ${JSON.stringify(r.stderr)}`);
    c.conferir(r.stdout, lado);
    return ms;
  }
  // One pair: both roots, in a random order.
  const par = (c) => {
    const ordem = Math.random() < 0.5 ? lados : [lados[1], lados[0]];
    const t = {};
    for (const lado of ordem) t[lado.nome] = rodar(c, lado);
    return t;
  };
  for (let i = 0; i < WARMUPS; i++) {
    reancorar();
    for (const c of embaralhar(cenarios)) par(c);
  }
  const medidas = new Map(cenarios.map((c) => [c, []]));
  for (let i = 0; i < PARES; i++) {
    reancorar();
    for (const c of embaralhar(cenarios)) medidas.get(c).push(par(c));
  }

  const quantil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)];
  // True median: the mean of the two middle values when the count is even.
  const medianaVerdadeira = (o) => (o.length % 2 === 1 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2);
  const ordenar = (lista) => [...lista].sort((a, b) => a - b);
  const linhas = cenarios.map((c) => {
    const m = medidas.get(c);
    const a = ordenar(m.map((t) => t.A));
    const b = ordenar(m.map((t) => t.B));
    const dif = ordenar(m.map((t) => t.B - t.A));
    const bMaisRapido = m.filter((t) => t.B < t.A).length / m.length;
    const bMaisLento = m.filter((t) => t.B > t.A).length / m.length;
    const mediana = medianaVerdadeira(dif);
    const veredito = mediana <= -LIMIAR_MS && bMaisRapido >= MAIORIA ? 'gain'
      : mediana >= LIMIAR_MS && bMaisLento >= MAIORIA ? 'regression' : 'neutral';
    return {
      id: c.id, nome: c.nome, n: m.length,
      a: { p50: quantil(a, 0.5), p95: quantil(a, 0.95) },
      b: { p50: quantil(b, 0.5), p95: quantil(b, 0.95) },
      medianaDiferenca: mediana, bMaisRapido, bMaisLento, veredito,
    };
  });
  if (SAIDA_JSON) {
    console.log(JSON.stringify({
      bench: 'ab-raizes', plataforma: process.platform, node: process.version,
      pares: PARES, aquecimento: WARMUPS, limiarMs: LIMIAR_MS, maioria: MAIORIA, mesmaPasta: MESMA_PASTA, linhas,
    }));
  } else {
    const fmt = (x) => x.toFixed(1).padStart(6);
    const pct = (x) => `${(x * 100).toFixed(0).padStart(3)}%`;
    console.log(`node ${process.version} ${process.platform} ${os.arch()}, ${os.cpus()[0]?.model ?? 'cpu?'}`);
    console.log(`A: ${raizA}`);
    console.log(`B: ${raizB}`);
    if (!MESMA_PASTA) console.log(`WARNING: ${AVISO_PASTAS}; measured anyway (${PASTAS_DIFERENTES}), read the verdicts with that bias in mind`);
    console.log(`${PARES} interleaved pairs after ${WARMUPS} shared warm-up rounds; gain: median(B - A) <= -${LIMIAR_MS} ms and B faster in >= ${Math.round(MAIORIA * 100)}% of pairs`);
    for (const l of linhas) {
      console.log(`${l.nome.padEnd(26)} A p50=${fmt(l.a.p50)} p95=${fmt(l.a.p95)}  B p50=${fmt(l.b.p50)} p95=${fmt(l.b.p95)}  median(B-A)=${fmt(l.medianaDiferenca)} ms  B faster ${pct(l.bMaisRapido)}  ${l.veredito}`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

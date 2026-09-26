// Runs the four benches in sequence and prints one Markdown report: the
// machine first, then one table with p50, p95, n, the spec section 9 target
// and whether each row is within it. Zero dependencies. Usage:
//
//   node bench/rodar-todos.mjs
//
// The CI job `bench` appends this output to $GITHUB_STEP_SUMMARY.
//
// Report-only: a number over its target never changes the exit code. The exit
// code is 1 only when a bench itself fails (its own output checks, a crash, a
// timeout, or output that is not the expected JSON): that is a broken bench or
// a broken plugin, not a slow machine. The report is printed either way.
//
// Each bench builds its worst-case fixture in its own temporary directory and
// removes it. HADOUKEN_HOME is still set for them, as a guard: the caller's
// value when set (CI points it at runner.temp), otherwise a temporary
// directory created and removed here. The real ~/.claude/hadouken is never
// used.
//
// Progress goes to stderr, so stdout carries only the Markdown report.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// n = 100 for the p95 benches; 500 MB is the transcripts bench default volume,
// and the /consumo bench runs over the same volume with 5 cold and 20 warm
// runs per scenario.
const RODADAS = 100;
const TRANSCRIPTS_MB = 500;
const CONSUMO_FRIO = 5;
const CONSUMO_QUENTE = 20;
// Per bench; the CI job has its own limit on top.
const PRAZO_BENCH_MS = 10 * 60_000;
const SAIDA_MAX = 16 * 1024 * 1024;
const STDERR_LINHAS = 20;

// Spec section 9 (Sr. Garioli, 2026-09-25): status line and prompt hook p95
// <= 250 ms on Windows, <= 150 ms on Linux and macOS, and since 2026-09-26 the
// SessionStart and SessionEnd hooks with the same target (spec 6.5);
// /consumo warm <= 2 s, cold <= 15 s.
const WINDOWS = process.platform === 'win32';
const ALVO_P95_MS = WINDOWS ? 250 : 150;
const ALVO_QUENTE_MS = 2_000;
const ALVO_FRIO_MS = 15_000;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Text from the OS, the environment or a bench's stderr, made safe for one
// Markdown line: no ANSI/OSC sequences, no control characters, no pipes or
// backticks, bounded length.
const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;
function limpar(texto, max = 120) {
  return String(texto)
    .replace(ANSI, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[|`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const finito = (x) => typeof x === 'number' && Number.isFinite(x);
const fmtMs = (x) => (finito(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : '—');
const fmtMB = (bytes) => (finito(bytes) ? (bytes / (1024 * 1024)).toFixed(1) : '—');
const carga1min = () => (WINDOWS ? '— (não existe no Windows)' : os.loadavg()[0].toFixed(2));

function maquina() {
  const cpus = os.cpus();
  const nucleos = typeof os.availableParallelism === 'function' ? os.availableParallelism() : cpus.length;
  const linhas = [
    `- SO: ${limpar(`${os.type()} ${os.release()}`)} (${process.platform} ${os.arch()})`,
    `- CPU: ${cpus.length > 0 ? limpar(cpus[0].model) : '—'}`,
    `- Núcleos lógicos: ${nucleos}`,
    `- Memória: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
    `- Node: ${process.version}`,
    `- Carga média de 1 min no início: ${carga1min()}`,
  ];
  // GitHub-hosted runners name their image; absent elsewhere.
  if (process.env.ImageOS) linhas.push(`- Imagem do runner: ${limpar(`${process.env.ImageOS} ${process.env.ImageVersion ?? ''}`, 64)}`);
  return linhas;
}

// Runs one bench with --json. Returns { ok, dados, motivo, stderr, segundos }:
// `dados` is the parsed JSON whenever the last stdout line is a JSON object,
// even on failure, so that the numbers it has still reach the table.
function rodarBench(arquivo, args, env) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [path.join(repo, 'bench', arquivo), ...args, '--json'], {
    cwd: repo, env, encoding: 'utf8', timeout: PRAZO_BENCH_MS, maxBuffer: SAIDA_MAX, windowsHide: true,
  });
  const segundos = (performance.now() - t0) / 1000;
  let dados = null;
  try {
    const v = JSON.parse(String(r.stdout ?? '').trim().split('\n').pop());
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) dados = v;
  } catch { /* sem JSON: motivo abaixo */ }
  let motivo = null;
  if (r.error) motivo = r.error.code === 'ETIMEDOUT' ? `tempo esgotado (${PRAZO_BENCH_MS / 60_000} min)` : `não rodou (${limpar(r.error.code ?? 'erro', 32)})`;
  else if (r.status !== 0) motivo = r.signal ? `morto por ${r.signal}` : `código de saída ${r.status}`;
  else if (dados === null) motivo = 'a saída não é o JSON esperado';
  return { ok: motivo === null, dados, motivo, stderr: String(r.stderr ?? ''), segundos };
}

// Rows of the p95 benches, by the stable `id` each bench gives its scenarios.
// `alvo`: 'p95' (spec 9 target of this platform) or 'referencia' (the floor,
// no target).
const LINHAS_P95 = [
  ['statusline', 'registrada', 'statusline, sessão registrada (caminho completo)', 'p95'],
  ['statusline', 'registrada-shim', 'statusline, sessão registrada, via shim', 'p95'],
  ['statusline', 'nao-registrada', 'statusline, sessão não registrada (só o gate)', 'p95'],
  ['statusline', 'nao-registrada-shim', 'statusline, sessão não registrada, via shim', 'p95'],
  ['hooks', 'prompt-registrada-sem-gravar', 'hook de prompt, sessão registrada, sem gravar', 'p95'],
  ['hooks', 'prompt-registrada-grava', 'hook de prompt, sessão registrada, grava alertas.json', 'p95'],
  ['hooks', 'prompt-nao-registrada', 'hook de prompt, sessão não registrada (só o gate)', 'p95'],
  ['hooks', 'session-start', 'hook SessionStart', 'p95'],
  ['hooks', 'session-end-registrada', 'hook SessionEnd, sessão registrada (anexa ao historico.jsonl)', 'p95'],
  ['hooks', 'session-end-nao-registrada', 'hook SessionEnd, sessão não registrada (só o gate)', 'p95'],
  ['statusline', 'node-vazio', 'piso: `node -e ""` sem script', 'referencia'],
];
const LINHAS_TRANSCRIPTS = [
  ['frio', 'índice de transcripts, frio', ALVO_FRIO_MS],
  ['quente-sem-mudanca', 'índice de transcripts, quente sem mudança', ALVO_QUENTE_MS],
  ['quente-1pct', 'índice de transcripts, quente com +1 %', ALVO_QUENTE_MS],
];
// The whole /consumo, by the `id` of bench/consumo.mjs (the scenario with a
// repo in config.json and the fake gh).
const LINHAS_CONSUMO = [
  ['quente', '`/consumo` quente (índice e cache do GitHub prontos, dados sem mudança)', ALVO_QUENTE_MS],
  ['frio', '`/consumo` frio (primeira execução: sem índice nem cache do GitHub)', ALVO_FRIO_MS],
];

const plataformaAlvo = WINDOWS ? 'Windows' : 'Linux/macOS';
const linhaTabela = (celulas) => `| ${celulas.join(' | ')} |`;
const dentro = (valor, alvo) => (finito(valor) ? (valor <= alvo ? 'sim' : 'não') : '—');
const linhaValida = (l) => l !== undefined && finito(l.p50) && finito(l.p95) && Number.isSafeInteger(l.n);
const segundos = (alvoMs) => `${alvoMs / 1000} s`;

function tabela(resultados, falhas) {
  const saida = [
    linhaTabela(['medida', 'p50 (ms)', 'p95 (ms)', 'n', 'meta (spec §9)', 'dentro da meta']),
    '|---|---:|---:|---:|---|---|',
  ];
  for (const [bench, id, medida, alvo] of LINHAS_P95) {
    const dados = resultados[bench]?.dados;
    const linha = Array.isArray(dados?.linhas) ? dados.linhas.find((l) => l?.id === id) : undefined;
    const ok = linhaValida(linha);
    if (!ok && resultados[bench]?.ok) falhas.push({ bench, motivo: `linha ${id} ausente ou inválida no JSON` });
    const p50 = ok ? linha.p50 : null;
    const p95 = ok ? linha.p95 : null;
    const n = ok ? String(linha.n) : '—';
    const comMeta = alvo === 'p95';
    const meta = comMeta ? `p95 ≤ ${ALVO_P95_MS} ms (${plataformaAlvo})` : '— (referência: a partida do Node)';
    const veredito = comMeta ? dentro(p95, ALVO_P95_MS) : '—';
    saida.push(linhaTabela([medida, fmtMs(p50), fmtMs(p95), n, meta, veredito]));
  }
  const dadosT = resultados.transcripts?.dados;
  for (const [id, medida, alvo] of LINHAS_TRANSCRIPTS) {
    const m = Array.isArray(dadosT?.medidas) ? dadosT.medidas.find((x) => x?.id === id) : undefined;
    const ok = m !== undefined && finito(m.ms);
    if (!ok && resultados.transcripts?.ok) falhas.push({ bench: 'transcripts', motivo: `medida ${id} ausente ou inválida no JSON` });
    const ms = ok ? m.ms : null;
    const rotulo = alvo === ALVO_FRIO_MS ? '/consumo frio' : '/consumo quente';
    saida.push(linhaTabela([medida, fmtMs(ms), fmtMs(ms), ok ? '1' : '—', `≤ ${segundos(alvo)} (meta do ${rotulo})`, dentro(ms, alvo)]));
  }
  const dadosC = resultados.consumo?.dados;
  for (const [id, medida, alvo] of LINHAS_CONSUMO) {
    const linha = Array.isArray(dadosC?.linhas) ? dadosC.linhas.find((l) => l?.id === id) : undefined;
    const ok = linhaValida(linha);
    if (!ok && resultados.consumo?.ok) falhas.push({ bench: 'consumo', motivo: `linha ${id} ausente ou inválida no JSON` });
    const p95 = ok ? linha.p95 : null;
    saida.push(linhaTabela([medida, fmtMs(ok ? linha.p50 : null), fmtMs(p95), ok ? String(linha.n) : '—', `p95 ≤ ${segundos(alvo)}`, dentro(p95, alvo)]));
  }
  return saida;
}

function notas(resultados) {
  const s = resultados.statusline?.dados;
  const h = resultados.hooks?.dados;
  const t = resultados.transcripts?.dados;
  const c = resultados.consumo?.dados;
  const saida = [
    `- n: rodadas medidas, com os cenários de cada bench intercalados em ordem aleatória, depois de ${finito(s?.aquecimento) ? s.aquecimento : 5} rodadas de aquecimento descartadas; tempo do spawn à saída do processo, como o Claude Code roda a barra e os hooks.`,
  ];
  if (s?.fixture && h?.fixture) {
    saida.push(`- Fixture da barra e dos hooks: ${s.fixture.ativas} arquivos de registro em ativas/, ${s.fixture.sessoes} sessões em estado.json (${s.fixture.bytesEstado} B), alertas.json com ${h.fixture.bytesAlertas} B; cor da barra ${s.cor ? 'ligada' : 'desligada (NO_COLOR)'}.`);
  }
  if (t) {
    const iguais = t.incrementalIgualCheio === true ? 'sim' : 'não';
    saida.push(`- Índice de transcripts: uma medida por linha (n = 1), no processo, sobre ${fmtMB(t.bytesGerados)} MB sintéticos em ${t.arquivos} arquivos (+${fmtMB(t.bytesAnexados)} MB na linha +1 %). A meta mostrada é a do \`/consumo\` inteiro: o índice é só uma parte dele, então ficar dentro dela aqui é necessário, não suficiente. Incremental igual à releitura completa: ${iguais}.`);
  }
  if (c) {
    const semRepo = (id) => (Array.isArray(c.linhas) ? c.linhas.find((l) => l?.id === id)?.p95 : undefined);
    saida.push(`- \`/consumo\`: cada rodada é um processo (spawn à saída, como o CLI) sobre os mesmos ${fmtMB(c.bytesGerados)} MB sintéticos em ${c.arquivos} arquivos, estado.json com ${c.fixture?.sessoes} sessões e 1 repo no config.json; frio = HADOUKEN_HOME novo a cada rodada, quente = a mesma pasta da segunda execução em diante; aquecimento: ${c.aquecimento} rodada fria por cenário, descartada (no lugar das 5 acima). GitHub: executor falso do gh, sem rede (${c.github?.chamadasFrio} chamadas no frio, nenhuma no quente). Sem repo (git num cwd sem origin): p95 frio ${fmtMs(semRepo('frio-sem-repo'))} ms, quente ${fmtMs(semRepo('quente-sem-repo'))} ms.`);
  }
  saida.push(`- Carga média de 1 min no fim: ${carga1min()}.`);
  const duracoes = Object.entries(resultados).map(([nome, r]) => `${nome} ${r.segundos.toFixed(0)} s`);
  saida.push(`- Duração: ${duracoes.join(', ')}.`);
  return saida;
}

// The stderr tail of a failed bench, as a fenced block: `limpar` turns every
// backtick into a quote, so no line of it can close the fence.
function blocoStderr(stderr) {
  const linhas = stderr.split(/\r?\n/).map((l) => limpar(l, 300)).filter((l) => l !== '');
  return ['```text', ...(linhas.length === 0 ? ['(stderr vazio)'] : linhas.slice(-STDERR_LINHAS)), '```'];
}

const BENCHES = [
  ['statusline', 'statusline-p95.mjs', [String(RODADAS)], `${RODADAS} rodadas`],
  ['hooks', 'hooks-p95.mjs', [String(RODADAS)], `${RODADAS} rodadas`],
  ['transcripts', 'transcripts.mjs', [String(TRANSCRIPTS_MB)], `${TRANSCRIPTS_MB} MB sintéticos`],
  ['consumo', 'consumo.mjs', [String(TRANSCRIPTS_MB), String(CONSUMO_FRIO), String(CONSUMO_QUENTE)], `${TRANSCRIPTS_MB} MB sintéticos, ${CONSUMO_FRIO} frios e ${CONSUMO_QUENTE} quentes por cenário`],
];

let homeTemp = null;
try {
  let home = process.env.HADOUKEN_HOME;
  if (!home) {
    homeTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk rodar-todos '));
    home = homeTemp;
  }
  const env = { ...process.env, HADOUKEN_HOME: home };

  console.log('## Bench do claude-hadouken');
  console.log('');
  console.log('Relatório, sem gate: nenhum número muda o código de saída. Números indicativos: dependem da máquina e da carga dela durante a medida.');
  console.log('');
  console.log('**Máquina**');
  console.log('');
  for (const l of maquina()) console.log(l);
  console.log('');

  const resultados = {};
  BENCHES.forEach(([nome, arquivo, args, descricao], i) => {
    process.stderr.write(`[${i + 1}/${BENCHES.length}] ${arquivo} (${descricao})...\n`);
    resultados[nome] = rodarBench(arquivo, args, env);
    const r = resultados[nome];
    process.stderr.write(`[${i + 1}/${BENCHES.length}] ${arquivo}: ${r.ok ? 'ok' : `FALHOU: ${r.motivo}`} em ${r.segundos.toFixed(0)} s\n`);
  });

  const falhas = BENCHES.filter(([nome]) => !resultados[nome].ok).map(([nome]) => ({ bench: nome, motivo: resultados[nome].motivo }));
  if (resultados.transcripts.dados && resultados.transcripts.dados.incrementalIgualCheio !== true) {
    falhas.push({ bench: 'transcripts', motivo: 'o índice incremental difere da releitura completa' });
  }
  const linhasTabela = tabela(resultados, falhas);
  for (const l of linhasTabela) console.log(l);
  console.log('');
  for (const l of notas(resultados)) console.log(l);

  if (falhas.length > 0) {
    console.log('');
    console.log('**Falhas de bench** (não são números fora da meta: o bench ou o plugin quebrou)');
    for (const f of falhas) {
      console.log('');
      console.log(`${f.bench}: ${f.motivo}`);
      const stderr = resultados[f.bench]?.stderr ?? '';
      if (!resultados[f.bench]?.ok) {
        console.log('');
        for (const l of blocoStderr(stderr)) console.log(l);
      }
    }
    process.exitCode = 1;
  }
} finally {
  if (homeTemp !== null) fs.rmSync(homeTemp, { recursive: true, force: true });
}

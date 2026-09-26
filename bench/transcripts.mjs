// Cold and warm timings of indexarTranscripts over synthetic transcripts.
// Zero dependencies. Usage:
//
//   node bench/transcripts.mjs [MB] [--json]   (default 500 MB of synthetic data)
//   node bench/transcripts.mjs --real          (read-only run over ~/.claude/projects)
//
// --json (synthetic data only) prints a single JSON object (the generated
// volume, the incremental == full check and one entry per measurement, keyed
// by a stable `id`) instead of the text report; bench/rodar-todos.mjs reads it.
//
// Spec section 9 sets the targets: warm (1 % appended) <= 2 s, cold <= 15 s.
// This script reports the numbers and checks that the incremental result
// equals a full re-read; it does not assert the targets.
//
// Synthetic tree, in a temporary directory removed at the end: 6 project
// folders x 12 sessions, each session with a <session>/subagents folder of 2
// agent-*.jsonl files (216 transcripts), plus a few files the walk must skip.
// The line mix follows the shape measured on a real week of transcripts
// (2026-09-25: ~23 KB and ~8 lines per request, ~1.9 usage lines per request):
// per request one user line, 1 to 3 assistant lines with the same requestId and
// growing usage (one per apiBlockIndex), 4 tool-result lines without usage,
// every 20th request a tool result that carries a "usage" key outside
// message.usage (parsed, then discarded), and every 300th request a ~1 MB
// tool-result line.
//
// Scenarios: cold (no index), warm with nothing changed, warm after appending
// ~1 % of the bytes as complete requests to 8 files, and a cold re-read of the
// appended tree in a fresh data dir to check that incremental == full.
//
// --real: HADOUKEN_HOME points at a temporary directory, so the user's index
// is never touched; the transcripts are only read. Prints timings and counts
// only, never any content.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { indexarTranscripts, ARQ_INDICE } = await import(pathToFileURL(path.join(repo, 'src', 'transcripts.js')).href);

const DIA = 86_400_000;
const agora = Date.now();
const desdeMs = agora - 7 * DIA;
const MB = 1024 * 1024;

const ms = (t0) => Math.round(performance.now() - t0);
const mb = (n) => (n / MB).toFixed(1);
const rss = () => mb(process.memoryUsage().rss);

const argumentos = process.argv.slice(2);
const SAIDA_JSON = argumentos.includes('--json');
const posicionais = argumentos.filter((a) => a !== '--json');
// Text report lines; with --json only the final object is printed.
const log = SAIDA_JSON ? () => {} : (linha) => console.log(linha);
const medidas = [];

async function medir(id, rotulo, raiz, home) {
  process.env.HADOUKEN_HOME = home;
  const t0 = performance.now();
  const r = await indexarTranscripts({ raiz, desdeMs });
  const tempo = ms(t0);
  let indice = 0;
  // Compact size: the cap (16 MiB) is measured on the compact JSON, which is
  // how the index is written once gravarJsonAtomico honours { compacto: true }.
  let compacto = 0;
  try {
    const texto = fs.readFileSync(path.join(home, ARQ_INDICE), 'utf8');
    indice = Buffer.byteLength(texto);
    compacto = Buffer.byteLength(JSON.stringify(JSON.parse(texto)));
  } catch { /* sem índice */ }
  const saida = {
    id, rotulo, ms: tempo, arquivos: r.arquivos, registros: r.registros.length, linhasInvalidas: r.linhasInvalidas,
    ilegiveis: r.ilegiveis, truncado: r.truncado, indiceMB: mb(indice), indiceCompactoMB: mb(compacto), rssMB: rss(),
  };
  medidas.push(saida);
  log(JSON.stringify(saida));
  return { r, saida, indice, compacto };
}

const somaSaida = (r) => r.registros.reduce((s, x) => s + x.output + x.input + x.thinking + x.cacheRead + x.cacheCreate, 0);

const USO = 'usage: node bench/transcripts.mjs [MB] [--json] | --real';

if (posicionais[0] === '--real') {
  if (SAIDA_JSON || posicionais.length > 1) {
    console.error(USO);
    process.exit(2);
  }
  const raiz = path.join(os.homedir(), '.claude', 'projects');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench real '));
  try {
    console.log(`node ${process.version} ${process.platform}; real tree, read-only; index in a temp dir`);
    await medir('real-frio', 'real cold', raiz, home);
    await medir('real-quente-1', 'real warm 1', raiz, home);
    const { r, indice, compacto } = await medir('real-quente-2', 'real warm 2', raiz, home);
    if (r.registros.length > 0) {
      console.log(`index bytes per record: ${Math.round(indice / r.registros.length)} as written, ${Math.round(compacto / r.registros.length)} compact`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  process.exit(0);
}

const alvoMB = posicionais[0] === undefined ? 500 : Number(posicionais[0]);
if (!Number.isFinite(alvoMB) || alvoMB <= 0 || posicionais.length > 1) {
  console.error(USO);
  process.exit(2);
}

// PRNG determinístico (mulberry32): mesmo conteúdo a cada execução.
function prng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260925);
const inteiro = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const LETRAS = 'abcdefghijklmnopqrstuvwxyz      ';
const POOL = Array.from({ length: 256 * 1024 }, () => LETRAS[Math.floor(rnd() * LETRAS.length)]).join('');
function texto(n) {
  if (n <= POOL.length) {
    const i = inteiro(0, POOL.length - n);
    return POOL.slice(i, i + n);
  }
  return POOL.repeat(Math.ceil(n / POOL.length)).slice(0, n);
}
const uuid = () => [8, 4, 4, 4, 12].map((n) => Array.from({ length: n }, () => '0123456789abcdef'[inteiro(0, 15)]).join('')).join('-');

let seqReq = 0;
// Uma resposta completa (todas as linhas dela), como texto terminado em \n.
function requisicao(ctx) {
  const req = `req_011CT${(seqReq++).toString(36).padStart(10, '0')}`;
  const msg = `msg_01${req.slice(9)}`;
  ctx.ts += inteiro(2_000, 60_000);
  const ts = () => new Date(Math.min(ctx.ts, agora - 60_000)).toISOString();
  const base = `"parentUuid":"${uuid()}","isSidechain":${ctx.sub},"userType":"external","cwd":"${ctx.cwd}","sessionId":"${ctx.sessao}","version":"2.5.0","gitBranch":"main"`;
  const linhas = [];
  linhas.push(`{${base},"type":"user","message":{"role":"user","content":"${texto(inteiro(500, 3_000))}"},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
  const blocos = inteiro(1, 3);
  const input = inteiro(1, 20);
  const cacheRead = inteiro(10_000, 180_000);
  const cacheCreate = inteiro(0, 20_000);
  let output = inteiro(10, 200);
  for (let b = 0; b < blocos; b++) {
    output += inteiro(0, 800);
    const conteudo = b % 2 === 0
      ? `[{"type":"text","text":"${texto(inteiro(300, 4_000))}"}]`
      : `[{"type":"tool_use","id":"toolu_${req.slice(9)}${b}","name":"Bash","input":{"command":"${texto(inteiro(50, 1_500))}"}}]`;
    linhas.push(`{${base},"message":{"id":"${msg}","type":"message","role":"assistant","model":"claude-opus-5-5","content":${conteudo},"stop_reason":null,"usage":{"input_tokens":${input},"cache_creation_input_tokens":${cacheCreate},"cache_read_input_tokens":${cacheRead},"output_tokens":${output},"output_tokens_details":{"thinking_tokens":${Math.floor(output / 3)}},"service_tier":"standard"}},"requestId":"${req}","type":"assistant","uuid":"${uuid()}","timestamp":"${ts()}","effort":"high","apiBlockIndex":${b}}`);
  }
  for (let k = 0; k < 4; k++) {
    linhas.push(`{${base},"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_${req.slice(9)}","type":"tool_result","content":"${texto(inteiro(500, 7_500))}"}]},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
  }
  if (seqReq % 20 === 0) {
    linhas.push(`{${base},"type":"user","message":{"role":"user","content":"ok"},"toolUseResult":{"status":"completed","usage":{"input_tokens":5,"output_tokens":900}},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
  }
  if (seqReq % 300 === 0) {
    linhas.push(`{${base},"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"${texto(inteiro(800_000, 1_200_000))}"}]},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
  }
  return `${linhas.join('\n')}\n`;
}

// Escreve requisições em `arq` até `bytes`, em blocos de ~4 MB.
function preencher(arq, ctx, bytes, flag) {
  const fd = fs.openSync(arq, flag);
  let total = 0;
  let pendente = [];
  let tamPendente = 0;
  try {
    while (total < bytes) {
      const t = requisicao(ctx);
      pendente.push(t);
      tamPendente += t.length;
      total += t.length;
      if (tamPendente >= 4 * MB) {
        fs.writeSync(fd, pendente.join(''));
        pendente = [];
        tamPendente = 0;
      }
    }
    if (pendente.length > 0) fs.writeSync(fd, pendente.join(''));
  } finally {
    fs.closeSync(fd);
  }
  return total;
}

const PROJETOS = 6;
const SESSOES = 12;
const AGENTES = 2;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench transcripts '));
let resultado = null;
try {
  const raiz = path.join(tmp, 'projects');
  const alvo = alvoMB * MB;
  const porPrincipal = (alvo * 0.75) / (PROJETOS * SESSOES);
  const porAgente = (alvo * 0.25) / (PROJETOS * SESSOES * AGENTES);
  const ativos = [];
  let bytes = 0;
  let arquivos = 0;
  const t0 = performance.now();
  for (let p = 0; p < PROJETOS; p++) {
    const nomeProjeto = `C--Users-sintetico-proj-${p}`;
    const dirP = path.join(raiz, nomeProjeto);
    fs.mkdirSync(dirP, { recursive: true });
    fs.writeFileSync(path.join(dirP, 'notas.txt'), 'nao e transcript\n');
    for (let s = 0; s < SESSOES; s++) {
      const sessao = uuid();
      const cwd = `/home/sintetico/proj-${p}`;
      const ctx = { sessao, cwd, sub: false, ts: agora - 6.5 * DIA + (s * DIA) / 2 };
      const principal = path.join(dirP, `${sessao}.jsonl`);
      bytes += preencher(principal, ctx, porPrincipal, 'w');
      arquivos++;
      if (s === SESSOES - 1 && ativos.length < 8) ativos.push({ arq: principal, ctx });
      const dirSub = path.join(dirP, sessao, 'subagents');
      fs.mkdirSync(dirSub, { recursive: true });
      fs.writeFileSync(path.join(dirSub, 'agent-x.meta.json'), '{}\n');
      for (let a = 0; a < AGENTES; a++) {
        const ctxA = { sessao, cwd, sub: true, ts: ctx.ts - DIA / 4 };
        const arqA = path.join(dirSub, `agent-${uuid().slice(0, 17)}.jsonl`);
        bytes += preencher(arqA, ctxA, porAgente, 'w');
        arquivos++;
        if (s === SESSOES - 1 && p < 2 && a === 0) ativos.push({ arq: arqA, ctx: ctxA });
      }
    }
  }
  const msGeracao = ms(t0);
  log(`node ${process.version} ${process.platform}; generated ${arquivos} transcripts, ${mb(bytes)} MB in ${msGeracao} ms`);

  const home = path.join(tmp, 'home');
  const frio = await medir('frio', 'cold', raiz, home);
  await medir('quente-sem-mudanca', 'warm, unchanged', raiz, home);

  // ~1 % dos bytes como requisições completas, espalhado por 8 arquivos ativos.
  const porAtivo = (bytes * 0.01) / ativos.length;
  let anexados = 0;
  for (const { arq, ctx } of ativos) anexados += preencher(arq, ctx, porAtivo, 'a');
  log(`appended ${mb(anexados)} MB (${((anexados / bytes) * 100).toFixed(2)} %) to ${ativos.length} files`);
  const morno = await medir('quente-1pct', 'warm, +1 %', raiz, home);
  const cheio = await medir('frio-releitura', 'cold re-read of the appended tree (fresh index)', raiz, path.join(tmp, 'home-cheio'));

  const iguais = morno.r.registros.length === cheio.r.registros.length
    && morno.r.linhasInvalidas === cheio.r.linhasInvalidas
    && somaSaida(morno.r) === somaSaida(cheio.r);
  log(`incremental == full: ${iguais} (records ${morno.r.registros.length} vs ${cheio.r.registros.length}; tokens ${somaSaida(morno.r)} vs ${somaSaida(cheio.r)})`);
  const porRegistro = (n) => Math.round(n / Math.max(1, frio.r.registros.length));
  log(`index bytes per record: ${porRegistro(frio.indice)} as written, ${porRegistro(frio.compacto)} compact`);
  if (!iguais) process.exitCode = 1;
  resultado = { arquivos, bytesGerados: bytes, msGeracao, bytesAnexados: anexados, incrementalIgualCheio: iguais };
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  const removido = !fs.existsSync(tmp);
  log(`temp dir removed: ${removido}`);
  // Only after a complete run: a failure leaves the exception on stderr and no JSON.
  if (SAIDA_JSON && resultado !== null) {
    console.log(JSON.stringify({ bench: 'transcripts', plataforma: process.platform, node: process.version, ...resultado, tmpRemovido: removido, medidas }));
  }
}

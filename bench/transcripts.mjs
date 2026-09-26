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
// tool-result line. The generator lives in bench/lib/transcripts-sinteticos.mjs,
// shared with bench/consumo.mjs.
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
import { criarGerador, DIA, MB } from './lib/transcripts-sinteticos.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { indexarTranscripts, ARQ_INDICE } = await import(pathToFileURL(path.join(repo, 'src', 'transcripts.js')).href);

const agora = Date.now();
const desdeMs = agora - 7 * DIA;

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

const gerador = criarGerador(agora);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench transcripts '));
let resultado = null;
try {
  const raiz = path.join(tmp, 'projects');
  const t0 = performance.now();
  const { arquivos, bytes, ativos } = gerador.gerarArvore(raiz, alvoMB * MB);
  const msGeracao = ms(t0);
  log(`node ${process.version} ${process.platform}; generated ${arquivos} transcripts, ${mb(bytes)} MB in ${msGeracao} ms`);

  const home = path.join(tmp, 'home');
  const frio = await medir('frio', 'cold', raiz, home);
  await medir('quente-sem-mudanca', 'warm, unchanged', raiz, home);

  // ~1 % dos bytes como requisições completas, espalhado por 8 arquivos ativos.
  const porAtivo = (bytes * 0.01) / ativos.length;
  let anexados = 0;
  for (const { arq, ctx } of ativos) anexados += gerador.preencher(arq, ctx, porAtivo, 'a');
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

// Timings of the learning step (spec aprendizado section 7): worst case (20 MB
// of new telemetry over 26 weeks of aggregates) and common case (a few KB
// new). Zero dependencies. Usage:
//
//   node bench/aprendizado.mjs [--json]
//
// Targets: worst <= 300 ms, common <= 30 ms. Report-only, like the other
// benches: a number over its target never changes the exit code; the exit
// code is 1 only when the bench itself fails (the step returns ok: false or
// the count check fails). Everything lives in a temporary directory removed at
// the end; the real ~/.claude/hadouken is never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CAMPOS_MODELO, inicioSemana, MODELOS_SEMANA_MAX, SEMANAS_MAX } from '../src/aprendizado/agregar.js';
import { caminhos } from '../src/aprendizado/arquivos.js';
import { ARQ_TELEMETRIA } from '../src/aprendizado/otlp.js';
import { rodarPasso } from '../src/aprendizado/passo.js';
import { gravarAprendizado, lerCursor } from '../src/aprendizado/registro.js';

const JSON_OUT = process.argv.includes('--json');
const MB = 1024 * 1024;
const PIOR_BYTES = 19.5 * MB;
const DIA = 86_400_000;
const agora = Date.now();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-bench-aprendizado-'));

const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) });
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
// Resource attributes like a real export (the Collector would have deleted the
// identity ones; the reader drops whatever is left).
const RECURSO = attrs({ 'service.name': S('claude-code'), 'service.version': S('2.1.300'), 'os.type': S('windows'), 'host.arch': S('amd64') });
function linha(ms, i) {
  const a = attrs({
    'event.name': S('api_request'), model: S(i % 3 === 0 ? 'claude-opus-5-5' : 'claude-sonnet-5-5'), effort: S(i % 2 ? 'high' : 'xhigh'),
    query_source: S(i % 5 === 0 ? 'agent:custom' : 'repl_main_thread'), 'agent.name': S(`agente-${i % 7}`), cost_usd: { doubleValue: 0.0123 },
    input_tokens: I(1200 + i % 50), output_tokens: I(300), cache_read_tokens: I(50_000), cache_creation_tokens: I(900), duration_ms: I(2400), ttft_ms: I(800),
    'terminal.type': S('vscode'), 'prompt.id': S(`p-${i}`),
  });
  return `${JSON.stringify({ resourceLogs: [{ resource: { attributes: RECURSO }, scopeLogs: [{ logRecords: [{ timeUnixNano: `${BigInt(ms) * 1_000_000n}`, body: S('claude_code.api_request'), attributes: a }] }] }] })}\n`;
}

// 26 full weeks: 40 model keys each, every activity slot filled, full windows.
function agregadosCheios() {
  const semanas = [];
  for (let w = SEMANAS_MAX - 1; w >= 0; w--) {
    const modelos = {};
    for (let k = 0; k < MODELOS_SEMANA_MAX; k++) modelos[`claude-modelo-${k}|high|${k % 2 ? 'principal' : `sub:agente-${k}`}`] = new Array(CAMPOS_MODELO.length).fill(7);
    semanas.push({ inicio: inicioSemana(agora - w * 7 * DIA), modelos, ativo: new Array(168).fill(30) });
  }
  const resumo = (reset) => ({ reset, max: 90, cruzou: { 60: reset - 3 * 3_600_000, 75: reset - 2 * 3_600_000, 90: reset - 3_600_000 }, esgotou: null, disparou: false });
  return {
    v: 1, desde: agora - 180 * DIA, sessoes: 900, semanas,
    ritmo: { h5: Array.from({ length: 24 }, () => [12, 40]), d7: Array.from({ length: 24 }, () => [2, 40]) },
    janelas: {
      h5: Array.from({ length: 60 }, (_, i) => resumo(agora - i * 5 * 3_600_000)),
      d7: Array.from({ length: 12 }, (_, i) => resumo(agora - i * 7 * DIA)),
      fable: Array.from({ length: 12 }, (_, i) => resumo(agora - i * 7 * DIA)),
    },
  };
}

function medir(rotulo, alvoMs) {
  const t0 = performance.now();
  const r = rodarPasso({ dir, agoraMs: agora, inicio: false });
  const ms = performance.now() - t0;
  if (!r.ok) throw new Error(`${rotulo}: rodarPasso devolveu ${JSON.stringify(r)}`);
  return { id: rotulo, ms: Math.round(ms * 10) / 10, alvoMs, dentro: ms <= alvoMs };
}

let codigo = 0;
try {
  gravarAprendizado(dir, agregadosCheios());
  fs.mkdirSync(caminhos(dir).otel, { recursive: true });
  const arq = path.join(caminhos(dir).otel, ARQ_TELEMETRIA);
  const fd = fs.openSync(arq, 'w');
  let bytes = 0;
  let n = 0;
  while (bytes < PIOR_BYTES) {
    const l = linha(agora - 6 * DIA + n * 20, n);
    fs.writeSync(fd, l);
    bytes += Buffer.byteLength(l);
    n++;
  }
  fs.closeSync(fd);
  const pior = medir('pior', 300);
  // Own check: the whole file was read in one step (the current weeks are
  // already at 40 keys, so the counts may not grow; the cursor must).
  const lido = lerCursor(dir, agora).arquivo;
  if (lido === null || lido.pos !== bytes) throw new Error(`the worst case stopped at ${lido?.pos ?? 'null'} of ${bytes} bytes`);
  fs.appendFileSync(arq, Array.from({ length: 4 }, (_, i) => linha(agora - 1000 + i, i)).join(''));
  const comum = medir('comum', 30);
  const saida = { linhas: n, mb: Math.round((bytes / MB) * 10) / 10, medidas: [pior, comum] };
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(saida)}\n`);
  else {
    process.stdout.write(`learning step, ${saida.mb} MB / ${n} lines of new telemetry over ${SEMANAS_MAX} weeks of aggregates\n`);
    for (const m of saida.medidas) process.stdout.write(`  ${m.id.padEnd(6)} ${String(m.ms).padStart(8)} ms  (target <= ${m.alvoMs} ms: ${m.dentro ? 'ok' : 'OVER'})\n`);
  }
} catch (e) {
  process.stderr.write(`bench failed: ${e?.message ?? e}\n`);
  codigo = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exitCode = codigo;

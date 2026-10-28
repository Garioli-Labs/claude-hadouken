// Tokens per point of the 7-day limit, measured on this machine's own data
// (plan v0.5.6, Task 1). Zero dependencies. Usage:
//
//   node bench/tokens-por-ponto.mjs [--json] [--min-pontos N]
//
// Readings of the 7-day window come from historico.jsonl (one per session
// end, plus the rotated historico.1.jsonl) and the short history in
// estado.json. Consecutive readings of the same window (same resets_at) are
// chained into intervals whose percentage rose by at least N points (default
// 3, so the integer rounding of each reading moves the result by at most a
// third). The responses of the transcripts with a timestamp inside each
// interval are summed by three metrics and divided by the rise:
//
//   saida                     output tokens
//   entradaNaoCacheada+saida  input + cache creation + output
//   pesoCache                 input + 1.25 x cache creation + 0.1 x cache read
//                             + 5 x output (input-equivalent price weights)
//
// Report per metric: n, median and coefficient of variation. Only reads:
// the transcript index is the regular cache the reports already use. Usage
// on another machine of the same account moves the limit without leaving
// transcripts here, which shows up as outliers (high tokens per point is
// impossible this way; low is the signature).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_ESTADO, dirDados, lerJson } from '../src/estado.js';
import { indexarTranscripts } from '../src/transcripts.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const iMin = args.indexOf('--min-pontos');
const MIN_PONTOS = iMin >= 0 ? Number(args[iMin + 1]) : 3;
// Same window when resets_at differs by less than this (the server's value
// jitters by a few seconds between readings).
const TOLERANCIA_RESET_S = 120;

const METRICAS = {
  saida: (r) => r.output,
  'entradaNaoCacheada+saida': (r) => r.input + r.cacheCreate + r.output,
  pesoCache: (r) => r.input + 1.25 * r.cacheCreate + 0.1 * r.cacheRead + 5 * r.output,
};

function leituraDe(j) {
  if (j === null || typeof j !== 'object') return null;
  const pct = j.used_percentage;
  const reset = j.resets_at;
  const ms = Date.parse(j.at);
  if (!Number.isFinite(pct) || !Number.isFinite(reset) || !Number.isFinite(ms)) return null;
  return { ms, pct, reset };
}

function leituras(dir) {
  const r = [];
  for (const nome of ['historico.1.jsonl', 'historico.jsonl']) {
    let texto;
    try { texto = fs.readFileSync(path.join(dir, nome), 'utf8'); } catch { continue; }
    for (const linha of texto.split('\n')) {
      if (linha.trim() === '') continue;
      try {
        const l = leituraDe(JSON.parse(linha).seven_day);
        if (l) r.push(l);
      } catch { /* broken line */ }
    }
  }
  const est = lerJson(path.join(dir, ARQ_ESTADO));
  if (est.ok) {
    const reset = est.valor?.seven_day?.resets_at;
    for (const p of est.valor.historico ?? []) {
      const ms = Date.parse(p.at);
      if (Number.isFinite(p.d7) && Number.isFinite(ms) && Number.isFinite(reset)) r.push({ ms, pct: p.d7, reset });
    }
  }
  r.sort((a, b) => a.ms - b.ms);
  return r.filter((x, i) => i === 0 || x.ms !== r[i - 1].ms);
}

// Non-overlapping intervals inside one window, each with a rise >= MIN_PONTOS.
// A drop (or a new resets_at) restarts the chain.
function intervalos(lista) {
  const r = [];
  let ini = null;
  for (const p of lista) {
    if (ini === null || Math.abs(p.reset - ini.reset) > TOLERANCIA_RESET_S || p.pct < ini.pct) {
      ini = p;
      continue;
    }
    if (p.pct - ini.pct >= MIN_PONTOS) {
      r.push({ de: ini.ms, ate: p.ms, pontos: p.pct - ini.pct });
      ini = p;
    }
  }
  return r;
}

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cv = (v) => {
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  const dp = Math.sqrt(v.reduce((a, b) => a + (b - media) ** 2, 0) / v.length);
  return media > 0 ? dp / media : Infinity;
};
// Robust spread: 1.4826 x MAD / median (equals cv for normal data, but a few
// intervals spent on claude.ai or another machine do not drag it).
const cvRobusto = (v) => {
  const m = mediana(v);
  return m > 0 ? (1.4826 * mediana(v.map((x) => Math.abs(x - m)))) / m : Infinity;
};

const dir = dirDados();
if (dir === null) {
  console.error('sem diretório de dados');
  process.exit(1);
}
const lista = leituras(dir);
const ints = intervalos(lista);
const config = process.env.CLAUDE_CONFIG_DIR;
const raiz = typeof config === 'string' && path.isAbsolute(config)
  ? path.join(config, 'projects')
  : path.join(os.homedir(), '.claude', 'projects');
const desde = ints.length ? ints[0].de : Date.now();
const idx = await indexarTranscripts({ raiz, desdeMs: desde });

const linhas = ints.map((it) => {
  const dentro = idx.registros.filter((r) => r.ts > it.de && r.ts <= it.ate);
  const porPonto = {};
  for (const [nome, f] of Object.entries(METRICAS)) porPonto[nome] = dentro.reduce((a, r) => a + f(r), 0) / it.pontos;
  return { de: new Date(it.de).toISOString(), ate: new Date(it.ate).toISOString(), pontos: it.pontos, respostas: dentro.length, porPonto };
});
// An interval with no response here was spent on another machine: out.
const validas = linhas.filter((l) => l.respostas > 0);
const resumo = {};
for (const nome of Object.keys(METRICAS)) {
  const v = validas.map((l) => l.porPonto[nome]);
  resumo[nome] = v.length ? { n: v.length, mediana: Math.round(mediana(v)), cv: Number(cv(v).toFixed(3)), cvRobusto: Number(cvRobusto(v).toFixed(3)) } : { n: 0 };
}

if (json) {
  console.log(JSON.stringify({ leituras: lista.length, minPontos: MIN_PONTOS, intervalos: linhas, resumo, truncado: idx.truncado }, null, 2));
} else {
  console.log(`leituras de 7d: ${lista.length}; intervalos com alta >= ${MIN_PONTOS} pontos: ${ints.length} (${validas.length} com respostas aqui)`);
  for (const l of linhas) {
    const v = Object.values(l.porPonto).map((x) => Math.round(x).toLocaleString('pt-BR')).join(' | ');
    console.log(`  ${l.de.slice(0, 16)} → ${l.ate.slice(0, 16)}  +${l.pontos}  ${l.respostas} resp  ${v}`);
  }
  for (const [nome, r] of Object.entries(resumo)) {
    console.log(r.n ? `${nome}: n=${r.n} mediana=${r.mediana.toLocaleString('pt-BR')} cv=${r.cv} cvRobusto=${r.cvRobusto}` : `${nome}: sem dados`);
  }
  if (idx.truncado) console.log('aviso: índice dos transcripts truncado');
}

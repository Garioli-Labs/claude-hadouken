import { numeroFinito } from '../base.js';
import { TOLERANCIA_JANELA_S } from '../util.js';

// Agregados do aprendizado (spec aprendizado §3.1 e §4.1): nunca evento cru.
// Por semana (segunda-feira local), somas por modelo·effort·origem e minutos
// ativos por dia da semana × hora; ritmo das janelas por hora do dia; e um
// resumo de cada janela (5h, 7d, Fable) com o máximo, o instante em que
// cruzou cada limiar, o esgotamento e se a guarda disparou. Sem E/S: as
// funções mudam o objeto que recebem e o devolvem. Retenção de §5.4: 26
// semanas (podar).

const H = 3_600_000;
export const CAMPOS_MODELO = Object.freeze([
  'pedidos', 'custo', 'entrada', 'saida', 'cacheLeitura', 'cacheEscrita', 'duracaoMs', 'ttftMs', 'nTtft', 'erros', 'ferramentas', 'falhas',
]);
export const CHAVE_MODELO = /^[A-Za-z0-9._:[\]-]{1,80}\|(?:low|medium|high|xhigh|max|-)\|(?:principal|outro|sub|sub:[A-Za-z0-9._-]{1,40})$/;
export const SEMANAS_MAX = 26;
export const MODELOS_SEMANA_MAX = 40;
export const JANELAS_MAX = Object.freeze({ h5: 60, d7: 12, fable: 12 });
export const DURACAO_JANELA_MS = Object.freeze({ h5: 5 * H, d7: 7 * 24 * H, fable: 7 * 24 * H });
export const LIMIARES = Object.freeze([60, 65, 70, 75, 80, 85, 90, 95]);
// Minutos num slot (dia × hora) de uma semana para ele contar como ativo.
export const ATIVO_MIN = 5;
// Amostras mínimas de uma hora do dia para o ritmo dela valer.
export const RITMO_N_MIN = 3;
const MINUTOS_POR_SESSAO = 5;
const MINUTOS_POR_PONTO = 2;
const SLOT_MAX_MIN = 60;
const RITMO_N_TETO = 5000;
const PASSO_MIN = 1;
const PASSO_MAX = 10;
const TOLERANCIA_MS = TOLERANCIA_JANELA_S * 1000;

const pares = () => Array.from({ length: 24 }, () => [0, 0]);
const dois = (n) => String(n).padStart(2, '0');

export function aprendizadoVazio(agoraMs) {
  return { v: 1, desde: agoraMs, sessoes: 0, semanas: [], ritmo: { h5: pares(), d7: pares() }, janelas: { h5: [], d7: [], fable: [] } };
}

export function inicioSemana(ms) {
  const d = new Date(ms);
  const seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${seg.getFullYear()}-${dois(seg.getMonth() + 1)}-${dois(seg.getDate())}`;
}

export function slotDaSemana(ms) {
  const d = new Date(ms);
  return ((d.getDay() + 6) % 7) * 24 + d.getHours();
}

function semanaDe(ap, ms) {
  const inicio = inicioSemana(ms);
  let s = ap.semanas.find((x) => x.inicio === inicio);
  if (s === undefined) {
    s = { inicio, modelos: {}, ativo: new Array(168).fill(0) };
    ap.semanas.push(s);
    ap.semanas.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  }
  return s;
}

function somarAtivo(ap, ms, minutos) {
  const s = semanaDe(ap, ms);
  const slot = slotDaSemana(ms);
  s.ativo[slot] = Math.min(SLOT_MAX_MIN, s.ativo[slot] + minutos);
}

export function agregarRegistros(ap, registros) {
  for (const r of registros) {
    if (r.t === 'ativo') {
      somarAtivo(ap, r.em, r.segundos / 60);
      continue;
    }
    const s = semanaDe(ap, r.em);
    const chave = `${r.modelo}|${r.effort}|${r.origem}`;
    if (!Object.hasOwn(s.modelos, chave)) {
      if (Object.keys(s.modelos).length >= MODELOS_SEMANA_MAX) continue;
      s.modelos[chave] = new Array(CAMPOS_MODELO.length).fill(0);
    }
    const v = s.modelos[chave];
    if (r.t === 'req') {
      v[0] += 1;
      v[1] += r.custo;
      v[2] += r.entrada;
      v[3] += r.saida;
      v[4] += r.cacheLeitura;
      v[5] += r.cacheEscrita;
      v[6] += r.duracaoMs ?? 0;
      if (r.ttftMs !== null) {
        v[7] += r.ttftMs;
        v[8] += 1;
      }
    } else if (r.t === 'erro') {
      v[9] += 1;
    } else if (r.t === 'ferramenta') {
      v[10] += 1;
      if (!r.ok) v[11] += 1;
    }
  }
  return ap;
}

// Pontos do histórico de estado.json ({ at, h5, d7 }, a cada 2 min). Cada
// ponto depois de `desdeMs` conta 2 min de atividade; cada par seguido (de 1
// a 10 min, sem queda, que é reset) soma a taxa em pp/min à hora do dia do
// segundo ponto. Devolve o maior instante processado (o novo cursor).
export function agregarHistorico(ap, pontos, desdeMs) {
  const validos = [];
  for (const p of Array.isArray(pontos) ? pontos : []) {
    const t = typeof p?.at === 'string' ? Date.parse(p.at) : Number.NaN;
    if (!numeroFinito(t)) continue;
    validos.push({ t, h5: numeroFinito(p.h5) ? p.h5 : null, d7: numeroFinito(p.d7) ? p.d7 : null });
  }
  validos.sort((a, b) => a.t - b.t);
  let ate = desdeMs;
  for (let i = 0; i < validos.length; i++) {
    const q = validos[i];
    if (q.t <= desdeMs) continue;
    somarAtivo(ap, q.t, MINUTOS_POR_PONTO);
    const p = validos[i - 1];
    const minutos = p === undefined ? 0 : (q.t - p.t) / 60_000;
    if (minutos >= PASSO_MIN && minutos <= PASSO_MAX) {
      for (const col of ['h5', 'd7']) {
        if (p[col] === null || q[col] === null || q[col] < p[col]) continue;
        const par = ap.ritmo[col][new Date(q.t).getHours()];
        par[0] += (q[col] - p[col]) / minutos;
        par[1] += 1;
        if (par[1] > RITMO_N_TETO) {
          par[0] /= 2;
          par[1] /= 2;
        }
      }
    }
    ate = Math.max(ate, q.t);
  }
  return ate;
}

export function atualizarJanela(ap, tipo, leitura) {
  const { pct, resetMs, emMs } = leitura ?? {};
  if (!numeroFinito(pct) || !numeroFinito(resetMs) || !numeroFinito(emMs)) return ap;
  if (emMs > resetMs + TOLERANCIA_MS || emMs <= resetMs - DURACAO_JANELA_MS[tipo]) return ap;
  const lista = ap.janelas[tipo];
  let j = lista.find((x) => Math.abs(x.reset - resetMs) <= TOLERANCIA_MS);
  if (j === undefined) {
    j = { reset: resetMs, max: 0, cruzou: {}, esgotou: null, disparou: false };
    lista.push(j);
    lista.sort((a, b) => a.reset - b.reset);
  }
  if (emMs > j.reset) return ap;
  const v = Math.max(0, Math.min(100, pct));
  if (v > j.max) j.max = v;
  for (const T of LIMIARES) {
    if (v >= T && !Object.hasOwn(j.cruzou, String(T))) j.cruzou[String(T)] = emMs;
  }
  if (v >= 100 && j.esgotou === null) j.esgotou = emMs;
  return ap;
}

export function marcarNaJanela(ap, tipo, emMs, oque) {
  if (!numeroFinito(emMs)) return ap;
  const j = ap.janelas[tipo].find((x) => emMs <= x.reset && emMs > x.reset - DURACAO_JANELA_MS[tipo]);
  if (j === undefined) return ap;
  if (oque === 'disparou') {
    j.disparou = true;
  } else if (oque === 'esgotou' && (j.esgotou === null || emMs < j.esgotou)) {
    j.esgotou = emMs;
    j.max = 100;
  }
  return ap;
}

export function marcarSessao(ap, agoraMs) {
  ap.sessoes = Math.min(ap.sessoes + 1, 1_000_000);
  somarAtivo(ap, agoraMs, MINUTOS_POR_SESSAO);
  return ap;
}

// Horas ativas: o slot com ATIVO_MIN minutos em pelo menos metade das
// últimas (até) 4 semanas. Máscara de 24 bits por dia (segunda = 0).
export function perfilDe(ap) {
  const semanas = ap.semanas.slice(-4);
  const horasAtivas = [0, 0, 0, 0, 0, 0, 0];
  for (let slot = 0; slot < 168; slot++) {
    const n = semanas.filter((s) => s.ativo[slot] >= ATIVO_MIN).length;
    if (n > 0 && n * 2 >= semanas.length) horasAtivas[Math.floor(slot / 24)] |= 1 << (slot % 24);
  }
  const ritmoHora = {};
  for (const col of ['h5', 'd7']) {
    ritmoHora[col] = ap.ritmo[col].map(([soma, n]) => (n >= RITMO_N_MIN ? Math.round((soma / n) * 1e4) / 1e4 : null));
  }
  return { horasAtivas, ritmoHora };
}

export function podar(ap, agoraMs) {
  ap.semanas = ap.semanas.slice(-SEMANAS_MAX);
  for (const s of ap.semanas) {
    const chaves = Object.keys(s.modelos);
    if (chaves.length <= MODELOS_SEMANA_MAX) continue;
    const manter = chaves.sort((a, b) => s.modelos[b][0] - s.modelos[a][0]).slice(0, MODELOS_SEMANA_MAX);
    s.modelos = Object.fromEntries(manter.map((k) => [k, s.modelos[k]]));
  }
  for (const tipo of Object.keys(JANELAS_MAX)) {
    ap.janelas[tipo] = ap.janelas[tipo]
      .filter((j) => j.reset <= agoraMs + DURACAO_JANELA_MS[tipo] + TOLERANCIA_MS)
      .slice(-JANELAS_MAX[tipo]);
  }
  return ap;
}

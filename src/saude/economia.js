import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { lerEventos } from '../guarda/registros.js';
import { lerDespachos } from '../roteamento/registro.js';
import { resumoRoteamento } from '../roteamento/retrabalho.js';

// Resumo semanal de economia (spec v0.5.5 §6.J e §9.1 item 3). Conta só o que
// já é registrado: da guarda, os despachos negados ou perguntados e as trocas
// de modelo seguradas (guarda-eventos.json); do roteamento, os rebaixamentos
// exigidos (negar) ou sugeridos (avisar) em roteamento.json. Tokens só com
// base medida (a mediana das respostas de Haiku, como o resumo do
// roteamento); sem base, só as contagens. O texto sempre diz "estimativa".

export const ARQ_ECONOMIA = 'economia-semana.json';
const SEMANA_MS = 7 * 86_400_000;
const GUARDA = new Set(['negado', 'perguntado']);

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Semana ISO 8601 no fuso local: 'AAAA-Www' (a semana começa na segunda; a
// do ano é a que tem a quinta-feira).
export function semanaIso(ms) {
  const d = new Date(ms);
  const quinta = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const ano = quinta.getFullYear();
  const primeira = new Date(ano, 0, 4);
  const inicio = new Date(ano, 0, 4 - ((primeira.getDay() + 6) % 7));
  const semana = 1 + Math.round((quinta - inicio) / SEMANA_MS - 3 / 7);
  return `${ano}-W${String(semana).padStart(2, '0')}`;
}

// opções: dir, agoraMs, respostasSubagente (do índice de transcripts; só o
// /hadouken:saude passa, porque o SessionStart não lê o índice) →
// { texto|null, contagens: { guarda, trocas, rebaixamentos }, tokensEstimados|null }.
// Nunca lança.
export function resumoEconomia({ dir, agoraMs = Date.now(), respostasSubagente = [] }) {
  const contagens = { guarda: 0, trocas: 0, rebaixamentos: 0 };
  let tokensEstimados = null;
  try {
    for (const e of lerEventos(dir, agoraMs)) {
      if (agoraMs - Date.parse(e.at) > SEMANA_MS) continue;
      if (GUARDA.has(e.tipo)) contagens.guarda++;
      else if (e.tipo === 'troca-bloqueada') contagens.trocas++;
    }
    const despachos = lerDespachos(dir, agoraMs);
    contagens.rebaixamentos = despachos.filter((r) => r.decisao === 'negar' || r.decisao === 'avisar').length;
    const t = resumoRoteamento({ despachos, respostasSubagente }).custoEvitado?.tokens;
    if (Number.isSafeInteger(t) && t > 0) tokensEstimados = t;
  } catch { /* o que deu até aqui */ }
  const partes = [];
  if (contagens.guarda > 0) partes.push(plural(contagens.guarda, 'despacho perguntado ou negado pela guarda', 'despachos perguntados ou negados pela guarda'));
  if (contagens.trocas > 0) partes.push(plural(contagens.trocas, 'troca de modelo segurada', 'trocas de modelo seguradas'));
  if (contagens.rebaixamentos > 0) partes.push(plural(contagens.rebaixamentos, 'rebaixamento do roteamento', 'rebaixamentos do roteamento'));
  if (partes.length === 0) return { texto: null, contagens, tokensEstimados: null };
  const tokens = tokensEstimados === null ? '' : `; ~${tokensEstimados >= 1000 ? `${Math.round(tokensEstimados / 1000)} mil` : tokensEstimados} tokens poupados`;
  return { texto: `hadouken na semana (estimativa): ${partes.join(', ')}${tokens}.`, contagens, tokensEstimados };
}

// O SessionStart: a linha do resumo só no primeiro da semana ISO
// (economia-semana.json), com saude.ligado e saude.economia. A semana sem
// nada a contar também conta como vista. Gravação que falha: não fala (senão
// falaria em toda sessão). Nunca lança.
export function linhaDaSemana({ dir, agoraMs = Date.now(), config }) {
  try {
    if (config === null || typeof config !== 'object' || config.ligado === false || !config.economia) return null;
    const semana = semanaIso(agoraMs);
    const arq = path.join(dir, ARQ_ECONOMIA);
    const r = lerJson(arq, 1024);
    if (r.ok && r.valor?.semana === semana) return null;
    if (!gravarJsonAtomico(arq, { v: 1, semana }).ok) return null;
    return resumoEconomia({ dir, agoraMs }).texto;
  } catch {
    return null;
  }
}

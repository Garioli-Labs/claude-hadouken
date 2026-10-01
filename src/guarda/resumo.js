import { numeroFinito } from '../base.js';
import { EVENTOS_MAX, lerEventos, ultimosLimites } from './registros.js';

// Resumo da guarda nos últimos 7 dias para o /consumo (spec v0.4.0 §9.4;
// decisão 10 do plano da parte 2): disparos por gatilho, despachos negados,
// prompts e trocas bloqueados, liberações com escopo e prazo, despachos de
// modelo desconhecido e os últimos limites atingidos. Só lê
// guarda-eventos.json e limites-atingidos.json; nunca avalia nem grava (nada
// de avaliarGuarda, que grava travas). Os detalhes dos eventos já passaram
// pela regra DETALHE de registros.js; aqui só viram números e rótulos fixos.
// Nunca lança.

const SEMANA_MS = 7 * 86_400_000;
export const GATILHOS = Object.freeze(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
export const ESCOPOS_MAX = 20;
const MINUTOS_MAX = 1440;
const ESCOPO = /^(janela|(?:[1-9]|1\d|2[0-4])h):(\d{1,4})(:fable)?(:caro)?$/;
// Tipo de evento → contador do resumo. 'disparo', 'negado',
// 'liberacao-escopo' e 'arquivo-negado' têm tratamento próprio.
const CONTADOR = Object.freeze({
  __proto__: null,
  'prompt-bloqueado': 'prompts', 'troca-bloqueada': 'trocas', liberacao: 'liberacoes', 'liberacao-recusada': 'recusadas',
  desconhecido: 'desconhecidos', 'filha-negada': 'filhas', erro: 'erros',
});
// 'arquivo-negado' com detalhe P5:settings, P5:plugin ou P5:settings-projeto
// é uma edição negada nos settings ou no próprio plugin (Task 0 da parte 2);
// os outros detalhes (o nome da ferramenta) são escritas na pasta de dados.
const PREFIXO_PROTEGIDO = 'P5:';

// Detalhe de um evento 'liberacao-escopo' (detalheEscopo, liberacao.js) →
// { prazo, minutos, fable, caro }, ou null fora da forma.
export function escopoDe(detalhe) {
  const m = typeof detalhe === 'string' ? ESCOPO.exec(detalhe) : null;
  if (m === null) return null;
  const minutos = Number(m[2]);
  if (minutos > MINUTOS_MAX) return null;
  return { prazo: m[1], minutos, fable: m[3] !== undefined, caro: m[4] !== undefined };
}

// `parcial`: guarda-eventos.json guarda só os EVENTOS_MAX mais novos; com a
// lista cheia e o mais velho ainda dentro dos 7 dias, eventos da semana podem
// ter saído, e as contagens são um piso.
export function resumoGuarda(dir, agoraMs) {
  try {
    if (typeof dir !== 'string' || dir === '' || !numeroFinito(agoraMs)) return null;
    const desde = agoraMs - SEMANA_MS;
    const eventos = lerEventos(dir, agoraMs);
    const r = {
      desde: new Date(desde).toISOString(),
      disparos: Object.fromEntries(GATILHOS.map((g) => [g, 0])),
      negados: 0, negadosCaro: 0, prompts: 0, trocas: 0, liberacoes: 0, recusadas: 0, escopos: [],
      desconhecidos: 0, filhas: 0, arquivos: 0, protegidos: 0, erros: 0,
      limites: { fable: null, geral: null },
      parcial: eventos.length >= EVENTOS_MAX && Date.parse(eventos[0].at) >= desde,
    };
    for (const e of eventos) {
      const t = Date.parse(e.at);
      if (!(t >= desde)) continue;
      if (e.tipo === 'disparo') {
        if (GATILHOS.includes(e.detalhe)) r.disparos[e.detalhe]++;
      } else if (e.tipo === 'negado') {
        r.negados++;
        if (e.detalhe === 'G5') r.negadosCaro++;
      } else if (e.tipo === 'liberacao-escopo') {
        const s = escopoDe(e.detalhe);
        if (s !== null) r.escopos.push({ at: e.at, ...s });
      } else if (e.tipo === 'arquivo-negado') {
        if (typeof e.detalhe === 'string' && e.detalhe.startsWith(PREFIXO_PROTEGIDO)) r.protegidos++;
        else r.arquivos++;
      } else if (CONTADOR[e.tipo] !== undefined) {
        r[CONTADOR[e.tipo]]++;
      }
    }
    r.escopos = r.escopos.slice(-ESCOPOS_MAX);
    const lim = ultimosLimites(dir, agoraMs);
    for (const k of ['fable', 'geral']) if (lim[k] !== null && lim[k] >= desde) r.limites[k] = new Date(lim[k]).toISOString();
    return r;
  } catch {
    return null;
  }
}

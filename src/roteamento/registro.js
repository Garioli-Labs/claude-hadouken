import crypto from 'node:crypto';
import path from 'node:path';
import { lerJson, gravarJsonAtomico } from '../estado.js';

// Registro dos despachos para a medição (spec roteamento §8): 7 dias, até 500,
// sem texto de despacho (só tamanhos e hashes de palavras). Nunca lança.
export const ARQ_ROTEAMENTO = 'roteamento.json';
const MAX = 500;
const MAX_BYTES = 512 * 1024;
const SEMANA_MS = 7 * 86_400_000;
const AGENTE = /^[A-Za-z0-9_:-]{1,80}$/;
const FAMILIAS = new Set(['haiku', 'sonnet', 'opus', 'fable', 'desconhecido']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', null]);
const REGRAS = new Set(['N1', 'N2', 'A1', 'A2', 'A3', null]);
const DECISOES = new Set(['negar', 'avisar', 'passar']);
const SESSAO = /^[A-Za-z0-9-]{1,80}$/;
const inteiro = (n) => Number.isSafeInteger(n) && n >= 0;

function valido(r) {
  return r !== null && typeof r === 'object' && SESSAO.test(r.sessao) && AGENTE.test(r.agente) && FAMILIAS.has(r.familia)
    && EFFORTS.has(r.effort) && REGRAS.has(r.regra) && DECISOES.has(r.decisao) && inteiro(r.em) && inteiro(r.tamPrompt)
    && Array.isArray(r.palavras) && r.palavras.length <= 40 && r.palavras.every((h) => Number.isInteger(h) && h >= 0 && h < 2 ** 32);
}
const limpo = (r) => ({ sessao: r.sessao, agente: r.agente, familia: r.familia, effort: r.effort, regra: r.regra, decisao: r.decisao, em: r.em, tamPrompt: r.tamPrompt, palavras: r.palavras });

export function hashesDePalavras(texto) {
  try {
    if (typeof texto !== 'string') return [];
    const unicas = [...new Set(texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/).filter((p) => p.length >= 3))].slice(0, 40);
    return unicas.map((p) => crypto.createHash('sha256').update(p).digest().readUInt32BE(0));
  } catch {
    return [];
  }
}

export function lerDespachos(dir, agoraMs) {
  try {
    const lido = lerJson(path.join(dir, ARQ_ROTEAMENTO), MAX_BYTES);
    if (!lido.ok || !Array.isArray(lido.valor?.despachos)) return [];
    return lido.valor.despachos.filter((r) => valido(r) && agoraMs - r.em <= SEMANA_MS && r.em <= agoraMs + 300_000).map(limpo).slice(-MAX);
  } catch {
    return [];
  }
}

export function registrarDespacho(dir, r) {
  try {
    if (!valido(r)) return false;
    const lista = [...lerDespachos(dir, r.em), limpo(r)].slice(-MAX);
    return gravarJsonAtomico(path.join(dir, ARQ_ROTEAMENTO), { versao: 1, despachos: lista }).ok === true;
  } catch {
    return false;
  }
}

export function despachosRecentes(dir, sessao, agoraMs) {
  return lerDespachos(dir, agoraMs).filter((r) => r.sessao === sessao).map((r) => ({ em: r.em, tamPrompt: r.tamPrompt }));
}

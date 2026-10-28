import path from 'node:path';
import { gravarJsonAtomico } from '../estado.js';
import { instante, numeroFinito } from '../base.js';
import { lerSemLink } from './arquivo.js';

// Trava da guarda (spec v0.4.0 §5.3 e §4.5). Um gatilho que dispara grava a
// trava da janela dele; ela fica até uma liberação que a cubra ou até o reset
// (resets_at no passado a derruba na leitura). Várias sessões gravam fundindo
// a união, com renomeação atômica; uma gravação perdida numa corrida volta na
// avaliação seguinte, porque a condição continua valendo.
// Fail-closed: arquivo presente e ilegível é estado 'ilegivel', que o
// avaliador trata como disparada, e gravarTravas nunca o sobrescreve (senão
// estragar o arquivo e esperar um gatilho novo soltaria a guarda). Só
// limparTravas, chamada pela liberação, o reescreve.

export const ARQ_GUARDA = 'guarda.json';
export const GUARDA_MAX_BYTES = 16 * 1024;
export const CHAVES_TRAVA = Object.freeze(['five_hour', 'seven_day', 'fable', 'fable-despachos']);
const GATILHOS = new Set(['G1', 'G2', 'G3', 'G4', 'G6', 'G7']);
const VERSAO = 1;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const travasVazias = () => ({ five_hour: null, seven_day: null, fable: null, 'fable-despachos': null });

// Uma trava do arquivo, reconstruída: gatilho conhecido, resets_at null ou
// epoch em segundos plausível, desde legível por instante. `undefined` quando
// é inválida (o arquivo inteiro fica ilegível); null quando venceu.
function travaValida(t, agoraMs) {
  if (t === null) return null;
  if (!ehObjeto(t) || !GATILHOS.has(t.gatilho)) return undefined;
  const r = t.resets_at;
  if (r !== null && (!numeroFinito(r) || r <= 0 || r >= 1e11)) return undefined;
  const desde = instante(t.desde, agoraMs);
  if (desde === null) return undefined;
  if (r !== null && r * 1000 <= agoraMs) return null;
  return { resets_at: r, gatilho: t.gatilho, desde: new Date(desde).toISOString() };
}

export function travasValidas(valor, agoraMs) {
  try {
    if (!ehObjeto(valor) || valor.v !== VERSAO || !ehObjeto(valor.travas) || !numeroFinito(agoraMs)) return null;
    const t = travasVazias();
    for (const k of CHAVES_TRAVA) {
      if (!Object.hasOwn(valor.travas, k)) continue;
      const v = travaValida(valor.travas[k], agoraMs);
      if (v === undefined) return null;
      t[k] = v;
    }
    return t;
  } catch {
    return null;
  }
}

export function lerTravas(dir, agoraMs) {
  try {
    const lido = lerSemLink(path.join(dir, ARQ_GUARDA), GUARDA_MAX_BYTES);
    if (!lido.ok) return { estado: lido.motivo === 'ausente' ? 'ausente' : 'ilegivel', travas: travasVazias() };
    const t = travasValidas(lido.valor, agoraMs);
    return t === null ? { estado: 'ilegivel', travas: travasVazias() } : { estado: 'ok', travas: t };
  } catch {
    return { estado: 'ilegivel', travas: travasVazias() };
  }
}

// União por chave: a trava que já existe fica (a primeira decide o `desde`).
export function unirTravas(a, b) {
  const r = travasVazias();
  for (const k of CHAVES_TRAVA) r[k] = a?.[k] ?? b?.[k] ?? null;
  return r;
}

const iguais = (a, b) => CHAVES_TRAVA.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// Grava só na transição (spec §5.3): a união muda algo em relação ao lido.
// Arquivo ausente lê como vazias, então sem trava nova ele continua ausente.
export function gravarTravas(dir, novas, agoraMs) {
  try {
    const lido = lerTravas(dir, agoraMs);
    if (lido.estado === 'ilegivel') return { ok: false, motivo: 'ilegivel', gravou: false };
    const novasValidas = travasValidas({ v: VERSAO, travas: ehObjeto(novas) ? novas : {} }, agoraMs);
    if (novasValidas === null) return { ok: false, motivo: 'invalida', gravou: false };
    const uniao = unirTravas(lido.travas, novasValidas);
    if (iguais(uniao, lido.travas)) return { ok: true, gravou: false };
    const r = gravarJsonAtomico(path.join(dir, ARQ_GUARDA), { v: VERSAO, travas: uniao });
    return r.ok ? { ok: true, gravou: true } : { ok: false, motivo: r.motivo, gravou: false };
  } catch {
    return { ok: false, motivo: 'inesperado', gravou: false };
  }
}

// Só a liberação chama: zera as chaves pedidas e regrava, mesmo sobre um
// arquivo ilegível (que vira vazio mais o que era legível, isto é, nada).
// soSeLegivel: só grava sobre um guarda.json lido ok; a soltura automática da
// Emenda 5 nunca reescreve um arquivo ilegível (revisão do branch, achado 8).
export function limparTravas(dir, chaves, agoraMs, { soSeLegivel = false } = {}) {
  try {
    const lido = lerTravas(dir, agoraMs);
    if (soSeLegivel && lido.estado !== 'ok') return { ok: false };
    const t = lido.estado === 'ok' ? { ...lido.travas } : travasVazias();
    for (const k of Array.isArray(chaves) ? chaves : []) if (CHAVES_TRAVA.includes(k)) t[k] = null;
    return { ok: gravarJsonAtomico(path.join(dir, ARQ_GUARDA), { v: VERSAO, travas: t }).ok };
  } catch {
    return { ok: false };
  }
}

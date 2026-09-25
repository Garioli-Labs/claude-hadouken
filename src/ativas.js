import path from 'node:path';
import { dirDados, lerJson, gravarJsonAtomico, idValido, instante, SESSAO_MAX_MS } from './estado.js';

// Registro de ativação (spec 8.2). O Claude Code recarrega a `statusLine` em
// sessões já abertas, então instalar o plugin mudaria a barra delas; só as
// sessões que passaram pelo SessionStart do plugin (registrarSessao) ganham
// barra e hooks, e todas as outras ficam como estavam. Formato:
// { versao: 1, sessoes: { <id>: { at: ISO } } }. Ids e instantes passam pelos
// mesmos validadores de estado.json.

export const ARQ_ATIVAS = 'ativas.json';

const VERSAO = 1;
const MAX_ATIVAS = 200;
// Faixa em que new Date(ms).toISOString() não lança.
const DATA_MAX_MS = 8.64e15;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const agoraValido = (ms) => typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= DATA_MAX_MS;

function arquivo() {
  const dir = dirDados();
  return dir === null ? null : path.join(dir, ARQ_ATIVAS);
}

// Instante (ms) de uma entrada ainda válida: `at` aceito por `instante` e no
// máximo SESSAO_MAX_MS no passado. Senão null.
function vigencia(entrada, agoraMs) {
  if (!ehObjeto(entrada)) return null;
  const t = instante(entrada.at, agoraMs);
  return t !== null && agoraMs - t <= SESSAO_MAX_MS ? t : null;
}

// Mapa `sessoes` de um registro lido do disco; qualquer desvio do formato → null.
function sessoesDoRegistro(valor) {
  if (!ehObjeto(valor) || valor.versao !== VERSAO || !ehObjeto(valor.sessoes)) return null;
  return valor.sessoes;
}

// Grava (ou renova) a sessão no registro. Chamado pelo hook SessionStart.
// Relê o arquivo, descarta ids inválidos e entradas com mais de 24 h, guarda
// no máximo 200 (a atual e as mais recentes) e regrava de forma atômica. Um
// registro ilegível ou fora do formato recomeça do zero. Motivos de falha:
// 'id_invalido', 'agora', 'sem_diretorio', o motivo de gravarJsonAtomico ou
// 'inesperado'. Nunca lança.
export function registrarSessao(sessionId, agoraMs) {
  try {
    if (!idValido(sessionId)) return { ok: false, motivo: 'id_invalido' };
    if (!agoraValido(agoraMs)) return { ok: false, motivo: 'agora' };
    const arq = arquivo();
    if (arq === null) return { ok: false, motivo: 'sem_diretorio' };
    const lido = lerJson(arq);
    const anteriores = (lido.ok && sessoesDoRegistro(lido.valor)) || {};
    const outras = [];
    for (const [id, entrada] of Object.entries(anteriores)) {
      if (id === sessionId || !idValido(id)) continue;
      const t = vigencia(entrada, agoraMs);
      if (t !== null) outras.push([id, t]);
    }
    outras.sort((a, b) => b[1] - a[1]);
    // Mapa sem protótipo: nenhuma chave alcança Object.prototype, e o JSON
    // gravado continua um objeto comum.
    const sessoes = Object.create(null);
    sessoes[sessionId] = { at: new Date(agoraMs).toISOString() };
    for (const [id, t] of outras.slice(0, MAX_ATIVAS - 1)) sessoes[id] = { at: new Date(t).toISOString() };
    const r = gravarJsonAtomico(arq, { versao: VERSAO, sessoes });
    return r.ok ? { ok: true } : { ok: false, motivo: r.motivo };
  } catch {
    return { ok: false, motivo: 'inesperado' };
  }
}

// A sessão passou pelo SessionStart do plugin nas últimas 24 h? Leitura pura:
// não grava, não poda, não renova. Id inválido, sem diretório de dados,
// arquivo ausente, grande, ilegível ou fora do formato → false. Nunca lança.
export function sessaoAtiva(sessionId, agoraMs) {
  try {
    if (!idValido(sessionId) || !agoraValido(agoraMs)) return false;
    const arq = arquivo();
    if (arq === null) return false;
    const lido = lerJson(arq);
    if (!lido.ok) return false;
    const sessoes = sessoesDoRegistro(lido.valor);
    if (sessoes === null || !Object.hasOwn(sessoes, sessionId)) return false;
    return vigencia(sessoes[sessionId], agoraMs) !== null;
  } catch {
    return false;
  }
}

import path from 'node:path';
import { DATA_MAX_MS, instante, numeroFinito } from '../base.js';
import { lerJson } from '../estado.js';

// Leitura validada de <dirDados>/uso-oficial.json (spec, emenda E4 e
// E8/S28), fora de painel.js (guarda v0.4.0, emenda E7): a guarda
// (src/guarda/avaliar.js) lê a semana do Fable daqui, e src/guarda/** não
// pode abrir processos, que painel.js abre para rodar o /usage. Este arquivo
// só importa node:path, ../base.js e ../estado.js. painel.js importa daqui e
// reexporta lerUso, ARQ_USO e BLOQUEIO_CUSTO_MS.

export const ARQ_USO = 'uso-oficial.json';
// Trava de custo (E2): o /usage passou a chamar o modelo; 24 h sem ler.
export const BLOQUEIO_CUSTO_MS = 24 * 3_600_000;

export const VERSAO = 1;
// Teto do uso-oficial.json (o arquivo real tem uns 500 bytes).
const MAX_USO_BYTES = 16 * 1024;
// Folga de relógio para o `ate` do bloqueio, a mesma de instante (base.js).
const FOLGA_RELOGIO_MS = 5 * 60_000;
const MAX_ISO = 64;

// Motivos gravados em estado.motivo: o sucesso e as falhas de rodarUso.
export const MOTIVOS_RODAR = new Set(['sem-claude', 'tempo', 'saida', 'custo', 'formato', 'erro']);
const MOTIVOS_GRAVADOS = new Set(['ok', ...MOTIVOS_RODAR]);

export const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const naFaixaDoDate = (ms) => numeroFinito(ms) && Math.abs(ms) <= DATA_MAX_MS;

// Janela gravada (S28): { pct em [0, 100], resetsAtMs finito e positivo, ou
// null }. Qualquer outra forma é "sem leitura" (null), nunca 0. Devolve uma
// cópia só com os dois campos, cada um lido uma vez.
export function janelaGravada(j) {
  if (!ehObjeto(j) || !Object.hasOwn(j, 'resetsAtMs')) return null;
  const pct = j.pct;
  const resetsAtMs = j.resetsAtMs;
  if (!numeroFinito(pct) || pct < 0 || pct > 100) return null;
  if (resetsAtMs !== null && !(naFaixaDoDate(resetsAtMs) && resetsAtMs > 0)) return null;
  return { pct, resetsAtMs };
}

// estado: { motivo de lista fechada, em legível por instante }, senão null.
function estadoGravado(e, agoraMs) {
  if (!ehObjeto(e)) return null;
  const motivo = e.motivo;
  const em = instante(e.em, agoraMs);
  if (!MOTIVOS_GRAVADOS.has(motivo) || em === null) return null;
  return { motivo, em: new Date(em).toISOString() };
}

// bloqueado: { motivo 'custo', ate legível }. O `ate` fica no futuro, então
// não passa por instante (que recusa mais de 5 min à frente); o teto é o
// próprio bloqueio mais a folga de relógio, para um arquivo mexido não travar
// a leitura por meses. Vencido continua legível: quem chama decide.
function bloqueioGravado(b, agoraMs) {
  if (!ehObjeto(b) || b.motivo !== 'custo' || typeof b.ate !== 'string' || b.ate.length > MAX_ISO) return null;
  const ate = Date.parse(b.ate);
  if (!naFaixaDoDate(ate) || ate > agoraMs + BLOQUEIO_CUSTO_MS + FOLGA_RELOGIO_MS) return null;
  return { motivo: 'custo', ate: new Date(ate).toISOString() };
}

// uso-oficial.json validado (E4, S28): versão 1, lido com teto de 16 KiB, e
// reconstruído só com campos no schema. Sem `lidoEm` legível as janelas não
// têm data e saem; `estado` e `bloqueado` ficam, cada um validado à parte.
// `modelos` só guarda o fable. Arquivo ausente, ilegível ou de outra versão:
// null. Nunca lança.
export function lerUso(dir, agoraMs) {
  try {
    if (typeof dir !== 'string' || dir === '' || !naFaixaDoDate(agoraMs)) return null;
    const lido = lerJson(path.join(dir, ARQ_USO), MAX_USO_BYTES);
    if (!lido.ok || !ehObjeto(lido.valor) || lido.valor.versao !== VERSAO) return null;
    const v = lido.valor;
    const lidoMs = instante(v.lidoEm, agoraMs);
    const comLeitura = lidoMs !== null;
    const modelos = {};
    const fable = comLeitura && ehObjeto(v.modelos) ? janelaGravada(v.modelos.fable) : null;
    if (fable !== null) modelos.fable = fable;
    return {
      versao: VERSAO,
      lidoEm: comLeitura ? new Date(lidoMs).toISOString() : null,
      sessao: comLeitura ? janelaGravada(v.sessao) : null,
      semana: comLeitura ? janelaGravada(v.semana) : null,
      modelos,
      estado: estadoGravado(v.estado, agoraMs),
      bloqueado: bloqueioGravado(v.bloqueado, agoraMs),
    };
  } catch {
    return null;
  }
}

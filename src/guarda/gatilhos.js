import { numeroFinito } from '../base.js';

// Gatilhos da guarda (spec v0.4.0 §5.2, D1 emendado em 2026-09-29). Puro:
// sem E/S e sem relógio. Por janela, o teto vem antes da projeção (G3 antes de
// G1, G4 antes de G2): o motivo exibido é o mais concreto. G5 (despacho caro)
// é decidido por despacho na P1; o ritmo linear não trava mais (D1).

const MIN = 60_000;
const H = 60 * MIN;
const SEMANA_S = 7 * 86_400;
const vazio = () => ({ five_hour: null, seven_day: null, fable: null, 'fable-despachos': null });

// Emenda E7: leitura oficial do Fable (uso-oficial.json) com até 15 min.
// Velha, ausente, fora do schema ou de antes do reset do Fable: sem piso
// (§5.5, sem inventar número; a mesma regra da barra).
// Exportada: a barra (mensagens.segmentoBarra) usa o mesmo limite de frescor.
export const FRESCA_FABLE_MS = 15 * MIN;

function fableFresco(u, agoraMs) {
  if (u === null || typeof u !== 'object') return null;
  const { pct, resetsAtMs, idadeMs } = u;
  if (!numeroFinito(pct) || pct < 0 || pct > 100) return null;
  if (!numeroFinito(idadeMs) || idadeMs < 0 || idadeMs > FRESCA_FABLE_MS) return null;
  if (resetsAtMs !== null && !(numeroFinito(resetsAtMs) && resetsAtMs > agoraMs)) return null;
  return { pct, resetsAtMs, idadeMs };
}

// Só depois de fableFresco, que já recusa o reset que passou.
const resetDoFable = (u) => (u.resetsAtMs === null ? null : Math.ceil(u.resetsAtMs / 1000));

function teto(l, tetoPct, gatilho, margemMs, agoraMs) {
  if (!l || !numeroFinito(l.used_percentage) || l.used_percentage < tetoPct) return null;
  if (l.resets_at * 1000 - agoraMs < margemMs) return null;
  return { gatilho, resets_at: l.resets_at, dados: { usado: l.used_percentage, teto: tetoPct, fresca: l.fresca === true, idadeMs: l.idadeMs } };
}

function projecao(l, quandoMs, horizonteMs, gatilho, margemMs, agoraMs) {
  if (!l || l.fresca !== true || !numeroFinito(quandoMs) || quandoMs <= agoraMs) return null;
  if (quandoMs - agoraMs > horizonteMs) return null;
  if (l.resets_at * 1000 - agoraMs < margemMs) return null;
  return { gatilho, resets_at: l.resets_at, dados: { quandoMs } };
}

// Despachos Fable dentro da janela de G7, em ordem. Exportada: a contagem da
// barra (mensagens.segmentoBarra) usa a mesma janela.
export function contarNaJanela(despachos, horas, agoraMs) {
  const janela = horas * H;
  return (Array.isArray(despachos) ? despachos : [])
    .filter((t) => numeroFinito(t) && t > agoraMs - janela && t <= agoraMs + 5 * MIN)
    .sort((a, b) => a - b);
}

// A trava cai quando a contagem volta abaixo do teto: quando o despacho de
// índice n − max sai da janela. Com max 0, não cai sozinha. Único lugar que
// calcula esse reset.
function fimDaContagem(r, max, horas) {
  return max === 0 ? null : Math.ceil((r[r.length - max] + horas * H) / 1000);
}

// G7. Com o piso oficial (Fable em fable.tetoPct ou mais, numa leitura de até
// 15 min), o teto vira 0 até o reset do Fable (E7).
function g7(despachos, max, horas, agoraMs, piso = null) {
  const r = contarNaJanela(despachos, horas, agoraMs);
  if (piso !== null) return { gatilho: 'G7', resets_at: piso.resets_at, dados: { n: r.length, max: 0, horas, pct: piso.pct } };
  if (r.length < max) return null;
  return { gatilho: 'G7', resets_at: fimDaContagem(r, max, horas), dados: { n: r.length, max, horas } };
}

function g6(limite, l7, agoraMs) {
  if (!limite || !numeroFinito(limite.atMs) || limite.atMs > agoraMs + 5 * MIN) return null;
  const atS = Math.floor(limite.atMs / 1000);
  let reset = numeroFinito(limite.resets_at) ? limite.resets_at : null;
  if (reset === null && l7 && numeroFinito(l7.resets_at) && l7.resets_at > atS) reset = l7.resets_at;
  if (reset === null) reset = atS + SEMANA_S;
  if (reset * 1000 <= agoraMs) return null;
  return { gatilho: 'G6', resets_at: reset, dados: { atMs: limite.atMs, fonte: 'local' } };
}

// G6 pela leitura oficial: 100% ou mais trava até o reset do Fable (ou, sem
// ele, pela mesma regra do G6 local: reset de 7d, senão 7 dias).
function g6Oficial(u, l7, agoraMs) {
  if (u === null || u.pct < 100) return null;
  const atMs = agoraMs - u.idadeMs;
  const reset = resetDoFable(u);
  if (reset !== null) return { gatilho: 'G6', resets_at: reset, dados: { atMs, fonte: 'oficial' } };
  const d = g6({ atMs, resets_at: null }, l7, agoraMs);
  return d === null ? null : { ...d, dados: { atMs, fonte: 'oficial' } };
}

export function avaliarGatilhos({ leituras, previsao, config, agoraMs, despachosFable, limiteFable, usoFable } = {}) {
  try {
    if (!numeroFinito(agoraMs) || config === null || typeof config !== 'object') return vazio();
    const l5 = leituras?.five_hour ?? null;
    const l7 = leituras?.seven_day ?? null;
    const margem5 = config.margemReset5hMin * MIN;
    const r = vazio();
    r.five_hour = teto(l5, config.teto5h, 'G3', margem5, agoraMs)
      ?? projecao(l5, previsao?.five_hour, config.horizonte5hMin * MIN, 'G1', margem5, agoraMs);
    r.seven_day = teto(l7, config.teto7d, 'G4', 0, agoraMs)
      ?? projecao(l7, previsao?.seven_day, config.horizonte7dH * H, 'G2', 0, agoraMs);
    const u = fableFresco(usoFable ?? null, agoraMs);
    r.fable = g6(limiteFable, l7, agoraMs) ?? g6Oficial(u, l7, agoraMs);
    const piso = u !== null && u.pct >= config.fableTetoPct ? { pct: u.pct, resets_at: resetDoFable(u) } : null;
    r['fable-despachos'] = g7(despachosFable, config.fableDespachosMax, config.fableDespachosHoras, agoraMs, piso);
    return r;
  } catch {
    return vazio();
  }
}

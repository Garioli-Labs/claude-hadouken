import { numeroFinito } from '../base.js';

// Gatilhos da guarda (spec v0.4.0 §5.2, D1 emendado em 2026-09-29). Puro:
// sem E/S e sem relógio. Por janela, o teto vem antes da projeção (G3 antes de
// G1, G4 antes de G2): o motivo exibido é o mais concreto. G5 (despacho caro)
// é decidido por despacho na P1; o ritmo linear não trava mais (D1).

const MIN = 60_000;
const H = 60 * MIN;
const SEMANA_S = 7 * 86_400;
const vazio = () => ({ five_hour: null, seven_day: null, fable: null, 'fable-despachos': null });

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

function g7(despachos, max, horas, agoraMs) {
  const janela = horas * H;
  const r = (Array.isArray(despachos) ? despachos : [])
    .filter((t) => numeroFinito(t) && t > agoraMs - janela && t <= agoraMs + 5 * MIN)
    .sort((a, b) => a - b);
  if (r.length < max) return null;
  // A trava cai quando a contagem volta abaixo do teto: quando o despacho de
  // índice n − max sai da janela. Com max 0, não cai sozinha.
  const resets_at = max === 0 ? null : Math.ceil((r[r.length - max] + janela) / 1000);
  return { gatilho: 'G7', resets_at, dados: { n: r.length, max, horas } };
}

function g6(limite, l7, agoraMs) {
  if (!limite || !numeroFinito(limite.atMs) || limite.atMs > agoraMs + 5 * MIN) return null;
  const atS = Math.floor(limite.atMs / 1000);
  let reset = numeroFinito(limite.resets_at) ? limite.resets_at : null;
  if (reset === null && l7 && numeroFinito(l7.resets_at) && l7.resets_at > atS) reset = l7.resets_at;
  if (reset === null) reset = atS + SEMANA_S;
  if (reset * 1000 <= agoraMs) return null;
  return { gatilho: 'G6', resets_at: reset, dados: { atMs: limite.atMs } };
}

export function avaliarGatilhos({ leituras, previsao, config, agoraMs, despachosFable, limiteFable } = {}) {
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
    r.fable = g6(limiteFable, l7, agoraMs);
    r['fable-despachos'] = g7(despachosFable, config.fableDespachosMax, config.fableDespachosHoras, agoraMs);
    return r;
  } catch {
    return vazio();
  }
}

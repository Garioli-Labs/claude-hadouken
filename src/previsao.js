import { numeroFinito } from './base.js';

// Previsão de estouro das janelas de limite (spec v0.2.0 §12.3). Puro: sem
// I/O e sem relógio; quem chama passa o agora. Entram o histórico que
// estado.js validou (lista de { at, h5, d7 }, do ponto mais velho ao mais
// novo) e os limites que podem ser mostrados agora (limitesValidos); sai, por
// janela, o instante (ms) em que a porcentagem chega a 100 no ritmo atual, ou
// null.
//
// Ritmo = inclinação por mínimos quadrados da porcentagem contra o tempo, com
// os pontos dos últimos JANELA_5H_MS (5h) ou JANELA_7D_MS (7d). As
// porcentagens são as da conta inteira, então o ritmo já soma todas as
// sessões, registradas ou não. Sem previsão abaixo do mínimo por janela em
// REGRAS_JANELA (pontos e cobertura), inclinação ≤ 0 ou não finita, ou
// previsão que não cai antes do reset (o reset chega primeiro). Nunca lança.

export const JANELA_5H_MS = 20 * 60_000;
export const JANELA_7D_MS = 3 * 3_600_000;
export const PONTOS_MIN = 3;
export const COBERTURA_MIN_MS = 6 * 60_000;
// Regras por janela (spec v0.4.0 §10, item 2, proposta 2 da pesquisa): no 7d,
// 26 min de pontos projetavam estouro semanal a partir de uma rajada (B1).
// O 7d exige 2 h de cobertura e 10 pontos; o 5h fica como na v0.2.
export const REGRAS_JANELA = Object.freeze({
  five_hour: Object.freeze({ pontosMin: PONTOS_MIN, coberturaMinMs: COBERTURA_MIN_MS }),
  seven_day: Object.freeze({ pontosMin: 10, coberturaMinMs: 2 * 3_600_000 }),
});
const MINUTO_MS = 60_000;
// Ponto até 5 min no futuro ainda vale: a mesma folga de relógio de instante
// (base.js), que o estado já aplicou ao validar o histórico.
const FUTURO_MS = 5 * 60_000;
const ALCANCE = Object.freeze({
  five_hour: ['h5', JANELA_5H_MS, REGRAS_JANELA.five_hour],
  seven_day: ['d7', JANELA_7D_MS, REGRAS_JANELA.seven_day],
});

// Regras válidas: inteiro ≥ 2 de pontos e cobertura finita > 0; qualquer
// outra coisa usa as de 5h (a mais branda, como antes). Nunca lança.
function regrasValidas(regras) {
  try {
    const { pontosMin, coberturaMinMs } = regras ?? {};
    if (Number.isInteger(pontosMin) && pontosMin >= 2 && numeroFinito(coberturaMinMs) && coberturaMinMs > 0) {
      return { pontosMin, coberturaMinMs };
    }
  } catch { /* getter hostil: padrão */ }
  return REGRAS_JANELA.five_hour;
}

// Inclinação, em pontos percentuais por minuto, de uma lista de pontos
// [instante ms, porcentagem]. null com menos de regras.pontosMin pontos,
// cobertura (mais novo − mais velho) menor que regras.coberturaMinMs, ponto
// que não seja par de números finitos, ou resultado não finito. Sem regras
// válidas, valem as de 5h. O tempo entra em minutos a partir da média, o que
// evita somar quadrados de instantes epoch em ms.
export function inclinacao(pontos, regras = REGRAS_JANELA.five_hour) {
  try {
    const { pontosMin, coberturaMinMs } = regrasValidas(regras);
    if (!Array.isArray(pontos) || pontos.length < pontosMin) return null;
    let somaT = 0;
    let somaP = 0;
    let menor = Infinity;
    let maior = -Infinity;
    for (const ponto of pontos) {
      if (!Array.isArray(ponto)) return null;
      const [t, p] = ponto;
      if (!numeroFinito(t) || !numeroFinito(p)) return null;
      somaT += t;
      somaP += p;
      if (t < menor) menor = t;
      if (t > maior) maior = t;
    }
    if (!(maior - menor >= coberturaMinMs)) return null;
    const mediaT = somaT / pontos.length;
    const mediaP = somaP / pontos.length;
    let sxy = 0;
    let sxx = 0;
    for (const [t, p] of pontos) {
      const x = (t - mediaT) / MINUTO_MS;
      sxy += x * (p - mediaP);
      sxx += x * x;
    }
    const b = sxy / sxx;
    return numeroFinito(b) ? b : null;
  } catch {
    return null;
  }
}

// Previsão de uma janela: os pontos da coluna dentro do alcance (de agora −
// alcance até agora + FUTURO_MS, porcentagem em [0, 100]), a inclinação deles
// e agora + (100 − usado) ÷ inclinação (com as regras da janela), arredondado
// ao ms. Só vale se cair depois de agora e antes do reset.
function preverJanela(historico, coluna, alcance, regras, janela, agoraMs) {
  if (janela === null || typeof janela !== 'object') return null;
  const usado = janela.used_percentage;
  const resetS = janela.resets_at;
  // resets_at é conferido antes da conta: texto, booleano, lista ou objeto
  // com valueOf virariam número na multiplicação.
  if (!numeroFinito(usado) || usado < 0 || usado >= 100 || !numeroFinito(resetS)) return null;
  const resetMs = resetS * 1000;
  if (!numeroFinito(resetMs) || resetMs <= agoraMs) return null;
  const pontos = [];
  for (const p of historico) {
    if (p === null || typeof p !== 'object') continue;
    const t = typeof p.at === 'string' ? Date.parse(p.at) : Number.NaN;
    const v = p[coluna];
    if (!numeroFinito(t) || t < agoraMs - alcance || t > agoraMs + FUTURO_MS) continue;
    if (!numeroFinito(v) || v < 0 || v > 100) continue;
    pontos.push([t, v]);
  }
  const b = inclinacao(pontos, regras);
  if (b === null || b <= 0) return null;
  const quando = Math.round(agoraMs + ((100 - usado) / b) * MINUTO_MS);
  return numeroFinito(quando) && quando > agoraMs && quando < resetMs ? quando : null;
}

// { five_hour, seven_day }: o instante (ms) previsto para cada janela chegar
// a 100%, ou null. `historico` é a lista validada de estado.js; `limites`, a
// saída de limitesValidos (ou null); `agoraMs`, o agora de quem chama.
// Entrada inválida ou hostil dá as duas null. Nunca lança.
export function preverEstouro(opcoes) {
  const previsao = { five_hour: null, seven_day: null };
  try {
    const { historico, limites, agoraMs } = opcoes ?? {};
    if (!Array.isArray(historico) || !numeroFinito(agoraMs) || limites === null || typeof limites !== 'object') return previsao;
    for (const [k, [coluna, alcance, regras]] of Object.entries(ALCANCE)) {
      previsao[k] = preverJanela(historico, coluna, alcance, regras, limites[k], agoraMs);
    }
    return previsao;
  } catch {
    return { five_hour: null, seven_day: null };
  }
}

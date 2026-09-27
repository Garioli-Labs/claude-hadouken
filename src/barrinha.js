import { numeroFinito } from './base.js';

// Barrinha de progresso (spec v0.2.0 §4): 8 casas de 12,5 pontos, ▰ cheia e
// ▱ vazia, e a marca ┃ opcional na fronteira do esperado do ritmo. Casa
// única dos glifos e da conta (test/casa-unica.test.js): a barra
// (formato.js) e o relatório (relatorio.js) a importam, nenhum outro arquivo
// de src/ os define. Pura; nunca lança. Largura 1 cada: ▰ e ▱ têm East
// Asian Width neutra; ┃ é ambígua, como o │ e o · que a barra já usa
// desde a v0.1.0 (largura 2 só em terminal com locale CJK).

export const CASAS = 8;
export const CHEIA = '▰';
export const VAZIA = '▱';
export const MARCA = '┃';
const PONTOS_POR_CASA = 100 / CASAS;

const noIntervalo = (n) => numeroFinito(n) && n >= 0 && n <= 100;

// Casas cheias de um valor já validado em [0, 100]: arredondamento, com duas
// travas. Uso de 1 ponto ou mais nunca some (mínimo 1 casa) e a barra só
// enche com 100 (99,9 fica com 7).
function cheias(pct) {
  const n = Math.round(pct / PONTOS_POR_CASA);
  if (n === 0 && pct >= 1) return 1;
  if (n === CASAS && pct < 100) return CASAS - 1;
  return n;
}

// barrinha(pct, { marca }) -> texto de 8 colunas (9 com a marca) ou null.
// pct fora de [0, 100] ou que não é número finito: null (quem chama mostra
// —). marca (0–100) põe ┃ depois das k = round(marca / 12,5) primeiras
// casas; marca inválida sai sem marca. `opcoes` é lida com cuidado: nulo,
// primitivo ou getter que lança valem como "sem marca".
export function barrinha(pct, opcoes) {
  if (!noIntervalo(pct)) return null;
  const n = cheias(pct);
  const casas = CHEIA.repeat(n) + VAZIA.repeat(CASAS - n);
  let marca;
  try {
    marca = opcoes !== null && typeof opcoes === 'object' ? opcoes.marca : undefined;
  } catch {
    marca = undefined;
  }
  if (!noIntervalo(marca)) return casas;
  const k = Math.round(marca / PONTOS_POR_CASA);
  return casas.slice(0, k) + MARCA + casas.slice(k);
}

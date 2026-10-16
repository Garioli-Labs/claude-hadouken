import { LINHAS_REGRA } from '../src/roteamento/regra.js';

// v0.5.3 (spec roteamento §2): o SessionStart termina sempre com a regra
// curta do roteamento. Os testes que comparam o contexto inteiro usam estes
// ajudantes, e um teste próprio confere a presença da regra.
export const REGRA = LINHAS_REGRA.join('\n');
export const comRegra = (texto) => `${texto}\n${REGRA}`;
export function semRegra(texto) {
  if (typeof texto !== 'string') return texto;
  const fim = `\n${REGRA}`;
  return texto.endsWith(fim) ? texto.slice(0, -fim.length) : texto;
}

// Contas da semana do roteamento (spec roteamento §8), puras: a semelhança
// das palavras de dois despachos e a ordem de força das famílias.
const FORCA = Object.freeze({ haiku: 1, sonnet: 2, opus: 3, fable: 4 });

export function jaccard(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return 0;
  let comuns = 0;
  for (const x of a) if (b.has(x)) comuns++;
  const uniao = a.size + b.size - comuns;
  return uniao === 0 ? 0 : comuns / uniao;
}

// `a` é mais forte que `b`; família desconhecida nunca entra na comparação.
export function maisForte(a, b) {
  const fa = FORCA[a];
  const fb = FORCA[b];
  return fa !== undefined && fb !== undefined && fa > fb;
}

export const forca = (f) => FORCA[f] ?? 0;

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

// O3 (spec roteamento §7): servidores MCP ligados sem nenhuma chamada em 7
// dias. O nome passa pela regex depois de virar o nome da ferramenta (o
// Claude Code troca o que não é letra, número, _ ou - por _). `sobDemanda`
// (true, false ou null) vem igual em cada item. Ordem alfabética, até 30.
const SERVIDOR = /^[A-Za-z0-9_.-]{1,64}$/;
const nomeDaFerramenta = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_');
export function mcpParados(entrada) {
  try {
    const { servidores, chamadas7d, sobDemanda } = entrada;
    const usados = chamadas7d instanceof Set ? chamadas7d : new Set();
    const marca = sobDemanda === true || sobDemanda === false ? sobDemanda : null;
    const nomes = [...new Set((Array.isArray(servidores) ? servidores : []).filter((s) => typeof s === 'string' && SERVIDOR.test(s) && !s.includes('..')))];
    return nomes.filter((s) => !usados.has(nomeDaFerramenta(s)) && !usados.has(s)).sort().slice(0, 30).map((servidor) => ({ servidor, sobDemanda: marca }));
  } catch {
    return [];
  }
}

// O4 (spec roteamento §7): o contexto que já chega antes do primeiro prompt.
// `primeiras`: { tokens, caracteresPrompt } da primeira resposta de cada
// sessão principal; desconta ceil(caracteres / 4) do prompt. `itens`: rótulo
// validado e o tamanho em caracteres (o texto nunca chega aqui); os 5 maiores,
// em caracteres / 4. Sem nenhuma sessão: null. Mediana: a do meio por baixo.
const ITEM = /^[A-Za-z0-9_:.@() À-ÿ-]{1,100}$/;
const natural = (n) => Number.isSafeInteger(n) && n >= 0;
export function contextoFixo(entrada) {
  try {
    const { primeiras, itens } = entrada;
    const valores = (Array.isArray(primeiras) ? primeiras : [])
      .filter((p) => p !== null && typeof p === 'object' && natural(p.tokens) && natural(p.caracteresPrompt))
      .map((p) => Math.max(0, p.tokens - Math.ceil(p.caracteresPrompt / 4)))
      .sort((a, b) => a - b);
    if (valores.length === 0) return null;
    const maiores = (Array.isArray(itens) ? itens : [])
      .filter((x) => x !== null && typeof x === 'object' && typeof x.item === 'string' && ITEM.test(x.item) && natural(x.caracteres))
      .sort((a, b) => b.caracteres - a.caracteres || (a.item < b.item ? -1 : 1))
      .slice(0, 5)
      .map((x) => ({ item: x.item, tokensEstimados: Math.ceil(x.caracteres / 4) }));
    return { medianaTokens: valores[Math.floor((valores.length - 1) / 2)], maiores };
  } catch {
    return null;
  }
}

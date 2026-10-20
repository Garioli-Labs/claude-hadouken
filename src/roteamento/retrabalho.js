import { forca, jaccard, maisForte } from './semana.js';

// Retrabalho e o resumo de 7 dias do roteamento (spec roteamento §8), a
// partir de lerDespachos e das respostas de subagente do índice de
// transcripts. Só números e nomes de agente; nunca lança.
const PRAZO_MS = 15 * 60_000;
const SEMELHANCA = 0.6;
const MIN_HAIKU = 5;
const REGRAS = ['N1', 'N2', 'A1', 'A2', 'A3'];
const rodou = (r) => r.decisao !== 'negar';

// Um despacho é retrabalho quando, até 15 min depois, a mesma sessão relança
// em família mais forte com Jaccard ≥ 0,6 nas palavras. Os negados não
// rodaram, então não são nem o original nem o relançamento. Devolve cópias.
export function marcarRetrabalho(despachos) {
  if (!Array.isArray(despachos)) return [];
  const lista = despachos.filter((r) => r !== null && typeof r === 'object');
  return lista.map((r) => {
    const palavras = new Set(Array.isArray(r.palavras) ? r.palavras : []);
    const retrabalho = rodou(r) && lista.some((o) => o !== r && rodou(o) && o.sessao === r.sessao
      && o.em > r.em && o.em - r.em <= PRAZO_MS && maisForte(o.familia, r.familia)
      && jaccard(palavras, new Set(Array.isArray(o.palavras) ? o.palavras : [])) >= SEMELHANCA);
    return { ...r, retrabalho };
  });
}

const tokensDe = (x) => [x.input, x.output, x.cacheRead, x.cacheCreate].reduce((s, n) => s + (Number.isSafeInteger(n) && n >= 0 ? n : 0), 0);

// Mediana (a do meio por baixo) dos tokens das respostas de subagente em
// Haiku, vezes os negados N1 e N2. Sem 5 respostas de Haiku: null.
function custoEvitado(despachos, respostas) {
  const haiku = (Array.isArray(respostas) ? respostas : [])
    .filter((x) => x !== null && typeof x === 'object' && x.subagente === true && typeof x.model === 'string' && x.model.toLowerCase().includes('haiku'))
    .map(tokensDe).sort((a, b) => a - b);
  if (haiku.length < MIN_HAIKU) return null;
  const negados = despachos.filter((r) => r.decisao === 'negar' && (r.regra === 'N1' || r.regra === 'N2')).length;
  return { tokens: haiku[Math.floor((haiku.length - 1) / 2)] * negados, estimativa: true };
}

export function resumoRoteamento(entrada) {
  const vazio = { porAgente: [], porRegra: Object.fromEntries(REGRAS.map((k) => [k, 0])), custoEvitado: null };
  try {
    if (entrada === null || typeof entrada !== 'object') return vazio;
    const despachos = marcarRetrabalho(entrada.despachos);
    const porRegra = { ...vazio.porRegra };
    const grupos = new Map();
    for (const r of despachos) {
      if (Object.hasOwn(porRegra, r.regra)) porRegra[r.regra]++;
      const chave = `${r.agente}\0${r.familia}`;
      const g = grupos.get(chave) ?? { agente: r.agente, familia: r.familia, despachos: 0, negados: 0, avisados: 0, retrabalhos: 0 };
      g.despachos++;
      if (r.decisao === 'negar') g.negados++;
      if (r.decisao === 'avisar') g.avisados++;
      if (r.retrabalho) g.retrabalhos++;
      grupos.set(chave, g);
    }
    const porAgente = [...grupos.values()]
      .sort((a, b) => b.despachos - a.despachos || (a.agente < b.agente ? -1 : a.agente > b.agente ? 1 : 0) || forca(a.familia) - forca(b.familia))
      .map(({ retrabalhos, ...g }) => ({ ...g, retrabalhoPct: Math.round((100 * retrabalhos) / g.despachos) }));
    return { porAgente, porRegra, custoEvitado: custoEvitado(despachos, entrada.respostasSubagente) };
  } catch {
    return vazio;
  }
}

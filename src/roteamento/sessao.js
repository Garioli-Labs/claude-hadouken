import { familiaDoModelo } from '../guarda/despacho.js';

// Sugestão para a sessão principal (spec roteamento §7). Só o hook decide,
// sem modelo. Precisa das últimas 15 respostas; null em qualquer dúvida.
const N = 15;
const SIMPLES = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write']);
const DESPACHO = new Set(['Agent', 'Task', 'Workflow']);
const ALTO = new Set(['high', 'xhigh', 'max']);
const BAIXO = new Set(['low', 'medium']);
const PENSAMENTO_MAX = 8000; // ~2 mil tokens

const simples = (r) => r.pensamento <= PENSAMENTO_MAX && r.ferramentas.length > 0
  && r.ferramentas.every((f) => SIMPLES.has(f.nome) && f.linhasMudadas < 40) && !r.ferramentas.some((f) => DESPACHO.has(f.nome));

function dificuldade(rs) {
  const falhas = new Map();
  for (const r of rs) for (const x of r.resultados) if (x.falhou && x.comandoHash) falhas.set(x.comandoHash, (falhas.get(x.comandoHash) ?? 0) + 1);
  if ([...falhas.values()].some((n) => n >= 3)) return true;
  return rs.some((r) => r.ferramentas.some((f) => f.reverte === true));
}

// A desestruturação fica dentro do try: uma entrada ausente devolve null.
export function sugerirSessao(entrada) {
  try {
    const { respostas, modelo, effort } = entrada;
    if (!Array.isArray(respostas) || respostas.length < N || typeof modelo !== 'string' || typeof effort !== 'string') return null;
    const rs = respostas.slice(-N);
    const familia = familiaDoModelo(modelo);
    const forte = familia === 'opus' || familia === 'fable';
    if ((forte || ALTO.has(effort)) && rs.filter(simples).length / N >= 0.8) {
      if (ALTO.has(effort)) return { chave: 'effort-medium', economia: 2 };
      if (forte) return { chave: 'model-sonnet', economia: 3 };
    }
    if (BAIXO.has(effort) && dificuldade(rs)) return { chave: 'effort-high', economia: 1 };
    return null;
  } catch {
    return null;
  }
}

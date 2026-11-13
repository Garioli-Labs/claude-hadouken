import { PALETA } from '../agentes/paleta.js';

// Regra curta do roteamento (spec roteamento §2; v0.6.0 Fatia 3): sempre no
// contexto do SessionStart. O texto é gerado da paleta efetiva: uma linha por
// agente ativo, com model·effort e o "use para"; a tabela inteira mora na
// skill hadouken:roteamento, carregada na hora de despachar.
const ABERTURA = 'Roteamento: antes de lançar um agente, carregue hadouken:roteamento.';
const FECHAMENTO = 'Cabe em poucas chamadas sobre arquivos conhecidos: faça direto, sem agente.';
const USO = new Map(PALETA.map((p) => [p.nome, p.uso]));

export function linhasRegra(efetiva) {
  const linhas = [ABERTURA];
  if (Array.isArray(efetiva)) {
    for (const e of efetiva) {
      if (e?.ativo === true && USO.has(e.nome)) linhas.push(`hadouken:${e.nome} (${e.model}·${e.effort}): ${USO.get(e.nome)}.`);
    }
  }
  linhas.push(FECHAMENTO);
  return linhas;
}

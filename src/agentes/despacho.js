import { PALETA, REMOVIDOS } from './paleta.js';

// Decisão da paleta sobre um despacho (spec v0.6.0 §4 Fatia 3 e 4). Pura:
// recebe o que o hook leu e devolve a ação. Nunca lança; na dúvida, passa.
//   { acao: 'passa' }
//   { acao: 'negar', razao }
// A injeção de model/effort (acao 'injetar') é da Tarefa 6b.
// `agentes` é a chave `agentes` já validada (lerAgentes).
const FERRAMENTAS = new Set(['Agent', 'Task']);
const PREFIXO = 'hadouken:';
const POR_NOME = new Map(PALETA.map((p) => [p.nome, p]));

const inativo = (agentes, nome) => agentes !== null && typeof agentes === 'object' && Object.hasOwn(agentes, nome) && agentes[nome]?.ativo === false;

// Primeiro substituto ativo da cadeia da tabela; null quando a cadeia acaba
// em "faça direto" ou volta a um agente já visto (dois inativos se apontando).
function substitutoAtivo(agentes, nome) {
  const vistos = new Set([nome]);
  let atual = POR_NOME.get(nome)?.substituto ?? null;
  while (atual !== null && !vistos.has(atual)) {
    if (!inativo(agentes, atual)) return atual;
    vistos.add(atual);
    atual = POR_NOME.get(atual)?.substituto ?? null;
  }
  return null;
}

export function avaliarPaleta({ toolName, toolInput, agentes = {} } = {}) {
  const passa = { acao: 'passa' };
  try {
    if (!FERRAMENTAS.has(toolName)) return passa;
    const tipo = toolInput !== null && typeof toolInput === 'object' ? toolInput.subagent_type : undefined;
    if (typeof tipo !== 'string' || !tipo.startsWith(PREFIXO)) return passa;
    const nome = tipo.slice(PREFIXO.length);
    if (Object.hasOwn(REMOVIDOS, nome)) return { acao: 'negar', razao: `hadouken:${nome} saiu na 0.6.0; use hadouken:${REMOVIDOS[nome]}` };
    if (POR_NOME.has(nome) && inativo(agentes, nome)) {
      const substituto = substitutoAtivo(agentes, nome);
      return { acao: 'negar', razao: `hadouken:${nome} está desligado na config; ${substituto === null ? 'faça direto' : `use hadouken:${substituto}`}` };
    }
    return passa;
  } catch {
    return passa;
  }
}

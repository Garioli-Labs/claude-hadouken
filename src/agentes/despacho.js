import { PALETA, REMOVIDOS } from './paleta.js';
import { ausente, MODELS, EFFORTS } from './config.js';

// Decisão da paleta sobre um despacho (spec v0.6.0 §4 Fatia 3 e 4). Pura:
// recebe o que o hook leu e devolve a ação. Nunca lança; na dúvida, passa.
//   { acao: 'passa' }
//   { acao: 'negar', razao }
//   { acao: 'injetar', updatedInput }  (o tool_input inteiro + model/effort da config)
// Ordem (spec §4 Fatia 4): remoção, `ativo`, injeção; `fork`, Workflow e outro
// plugin passam. `agentes` é a chave `agentes` já validada (lerAgentes).
const FERRAMENTAS = new Set(['Agent', 'Task']);
const PREFIXO = 'hadouken:';
const POR_NOME = new Map(PALETA.map((p) => [p.nome, p]));

const FECHADAS = Object.freeze({ model: MODELS, effort: EFFORTS });
const inativo = (agentes, nome) => agentes !== null && typeof agentes === 'object' && Object.hasOwn(agentes, nome) && agentes[nome]?.ativo === false;

// O substituto da tabela, um nível só (spec §4 Fatia 4): null quando a tabela
// manda "faça direto" ou quando o substituto também está inativo.
function substitutoAtivo(agentes, nome) {
  const substituto = POR_NOME.get(nome)?.substituto ?? null;
  return substituto !== null && !inativo(agentes, substituto) ? substituto : null;
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
    // Injeção: só o campo ausente, e só com valor da lista fechada (MODELS,
    // EFFORTS), mesmo com `agentes` não validado. O campo explícito
    // do despacho nunca é sobrescrito (A1). `fork` e agente de outro plugin já
    // saíram acima (não começam por `hadouken:`).
    if (!POR_NOME.has(nome)) return passa;
    const c = Object.hasOwn(agentes, nome) && agentes[nome] !== null && typeof agentes[nome] === 'object' ? agentes[nome] : {};
    const injetado = {};
    for (const campo of ['model', 'effort']) {
      if (!ausente(toolInput[campo]) || typeof c[campo] !== 'string' || !FECHADAS[campo].has(c[campo])) continue;
      injetado[campo] = c[campo];
    }
    if (Object.keys(injetado).length === 0) return passa;
    return { acao: 'injetar', updatedInput: { ...toolInput, ...injetado } };
  } catch {
    return passa;
  }
}

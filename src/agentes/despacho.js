import { REMOVIDOS } from './paleta.js';

// Decisão da paleta sobre um despacho (spec v0.6.0 §4 Fatia 3 e 4). Pura:
// recebe o que o hook leu e devolve a ação. Nunca lança; na dúvida, passa.
//   { acao: 'passa' }
//   { acao: 'negar', razao }
//   { acao: 'injetar', updatedInput }   (Fatia 4)
const FERRAMENTAS = new Set(['Agent', 'Task']);
const PREFIXO = 'hadouken:';

export function avaliarPaleta({ toolName, toolInput, agentes: _agentes = {} } = {}) {
  const passa = { acao: 'passa' };
  try {
    if (!FERRAMENTAS.has(toolName)) return passa;
    const tipo = toolInput !== null && typeof toolInput === 'object' ? toolInput.subagent_type : undefined;
    if (typeof tipo !== 'string' || !tipo.startsWith(PREFIXO)) return passa;
    const nome = tipo.slice(PREFIXO.length);
    if (Object.hasOwn(REMOVIDOS, nome)) return { acao: 'negar', razao: `hadouken:${nome} saiu na 0.6.0; use hadouken:${REMOVIDOS[nome]}` };
    return passa;
  } catch {
    return passa;
  }
}

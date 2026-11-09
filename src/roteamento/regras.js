// Regras do roteamento (spec roteamento §6). Negar só por campos
// estruturados (agente, família, effort, origem); avisar pode olhar a
// descrição. Ordem: N1, N2, A1, A2, A3; a primeira que casa decide. Nunca
// lança: falha é 'passar'.
import { AGENTES_REVISAO } from '../agentes/paleta.js';

const BUSCA = new Set(['Explore', 'hadouken:busca', 'hadouken:varredor']);
const BARATOS = new Set(['hadouken:busca', 'hadouken:varredor', 'hadouken:mecanico']);
const REVISAO = new Set(AGENTES_REVISAO.map((nome) => `hadouken:${nome}`));
const FORTES = new Set(['opus', 'fable']);
const EFFORT_ALTO = new Set(['xhigh', 'max']);
const VERBOS_BUSCA = /^\s*(encontr|procur|list|localiz|onde fica|find|search|locate)/i;
const A3_JANELA_MS = 10 * 60_000;
const A3_MAX = 5;
const A3_PROMPT = 400;
const PASSA = Object.freeze({ decisao: 'passar', regra: null });

export const pareceBusca = (d) => typeof d === 'string' && VERBOS_BUSCA.test(d);

const PREFIXO_PLUGIN = 'hadouken:';

// O que o usuário aprovou para o agente: a família em `roteamento.subir` ou em
// `agentes.<nome>.model`, e o effort em `agentes.<nome>.effort`. `agentes` vale
// para `hadouken:<nome>`; outro agente só tem o `subir`.
function aprovado(agente, familia, effort, config, agentes) {
  const subir = config.subir !== null && typeof config.subir === 'object' && Object.hasOwn(config.subir, agente) && config.subir[agente] === familia;
  const nome = agente.startsWith(PREFIXO_PLUGIN) ? agente.slice(PREFIXO_PLUGIN.length) : null;
  const c = nome !== null && agentes !== null && typeof agentes === 'object' && Object.hasOwn(agentes, nome) && agentes[nome] !== null && typeof agentes[nome] === 'object' ? agentes[nome] : null;
  return {
    familia: subir || (c !== null && c.model === familia),
    effort: c !== null && typeof c.effort === 'string' && c.effort === effort,
  };
}

export function avaliarRoteamento({ perfil, descricao, prompt, recentes, config, liberado, agoraMs, agentes = {} }) {
  try {
    if (perfil === null || typeof perfil !== 'object' || perfil.agente === null) return PASSA;
    const { agente, familia, effort, origem, doArquivo } = perfil;
    const ok = aprovado(agente, familia, effort, config, agentes);
    // N1: o effort que só veio da sessão não conta; o Explore não o escolheu.
    // A família e o effort que o usuário aprovou (subir, agentes) não são negados.
    const fortePedido = FORTES.has(familia) && !ok.familia;
    const effortPedido = EFFORT_ALTO.has(effort) && perfil.effortDaSessao !== true && !ok.effort;
    if (!liberado && config.negarN1 && BUSCA.has(agente) && (fortePedido || effortPedido)) return { decisao: 'negar', regra: 'N1' };
    // N2: a subida que o usuário aprovou para este agente não é negada.
    if (!liberado && config.negarN2 && BARATOS.has(agente) && origem === 'parametro' && FORTES.has(familia) && !ok.familia) return { decisao: 'negar', regra: 'N2' };
    if (!config.avisos) return PASSA;
    // A1: Fable ou effort max fora dos agentes de revisão. Um agente cujo próprio
    // arquivo declara Fable ou max foi escolhido de propósito: passa.
    const declarado = doArquivo !== null && (/fable/i.test(doArquivo.model ?? '') || doArquivo.effort === 'max');
    if ((familia === 'fable' || effort === 'max') && !REVISAO.has(agente) && !declarado) return { decisao: 'avisar', regra: 'A1' };
    // A2: os agentes de revisão do plugin ficam de fora; "listar os riscos" é revisão.
    if (FORTES.has(familia) && pareceBusca(descricao) && !REVISAO.has(agente)) return { decisao: 'avisar', regra: 'A2' };
    const curtos = (Array.isArray(recentes) ? recentes : []).filter((r) => agoraMs - r.em <= A3_JANELA_MS && r.tamPrompt < A3_PROMPT);
    if (typeof prompt === 'string' && prompt.length < A3_PROMPT && curtos.length >= A3_MAX) return { decisao: 'avisar', regra: 'A3' };
    return PASSA;
  } catch {
    return PASSA;
  }
}

// Regras do roteamento (spec roteamento §6). Negar só por campos
// estruturados (agente, família, effort, origem); avisar pode olhar a
// descrição. Ordem: N1, N2, A1, A2, A3; a primeira que casa decide. Nunca
// lança: falha é 'passar'.
const BUSCA = new Set(['Explore', 'hadouken:busca']);
const BARATOS = new Set(['hadouken:busca', 'hadouken:mecanico']);
const FORTES = new Set(['opus', 'fable']);
const EFFORT_ALTO = new Set(['xhigh', 'max']);
const VERBOS_BUSCA = /^\s*(encontr|procur|list|localiz|onde fica|find|search|locate)/i;
const A3_JANELA_MS = 10 * 60_000;
const A3_MAX = 5;
const A3_PROMPT = 400;
const PASSA = Object.freeze({ decisao: 'passar', regra: null });

export const pareceBusca = (d) => typeof d === 'string' && VERBOS_BUSCA.test(d);

export function avaliarRoteamento({ perfil, descricao, prompt, recentes, config, liberado, agoraMs }) {
  try {
    if (perfil === null || typeof perfil !== 'object' || perfil.agente === null) return PASSA;
    const { agente, familia, effort, origem, doArquivo } = perfil;
    if (!liberado && config.negarN1 && BUSCA.has(agente) && (FORTES.has(familia) || EFFORT_ALTO.has(effort))) return { decisao: 'negar', regra: 'N1' };
    if (!liberado && config.negarN2 && BARATOS.has(agente) && origem === 'parametro' && FORTES.has(familia)) return { decisao: 'negar', regra: 'N2' };
    if (!config.avisos) return PASSA;
    // A1: Fable ou effort max fora do revisor-crítico. Um agente cujo próprio
    // arquivo declara Fable ou max foi escolhido de propósito: passa.
    const declarado = doArquivo !== null && (/fable/i.test(doArquivo.model ?? '') || doArquivo.effort === 'max');
    if ((familia === 'fable' || effort === 'max') && agente !== 'hadouken:revisor-critico' && !declarado) return { decisao: 'avisar', regra: 'A1' };
    // A2: os revisores do plugin ficam de fora; "listar os riscos" é revisão.
    if (FORTES.has(familia) && pareceBusca(descricao) && !agente.startsWith('hadouken:revisor')) return { decisao: 'avisar', regra: 'A2' };
    const curtos = (Array.isArray(recentes) ? recentes : []).filter((r) => agoraMs - r.em <= A3_JANELA_MS && r.tamPrompt < A3_PROMPT);
    if (typeof prompt === 'string' && prompt.length < A3_PROMPT && curtos.length >= A3_MAX) return { decisao: 'avisar', regra: 'A3' };
    return PASSA;
  } catch {
    return PASSA;
  }
}

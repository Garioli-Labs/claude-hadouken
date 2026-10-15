import path from 'node:path';
import { bloqueioDeEscrita, gravarSettings, lerSettings } from '../configuracao.js';
import { lerJson } from '../estado.js';

// Atualização automática (spec v0.5.2, "Atualização automática", peça 2).
// Fora de sessão, o instalador grava no settings.json do usuário
// extraKnownMarketplaces["claude-hadouken"] com a fonte do GitHub e
// autoUpdate: true (essa chave vence a de known_marketplaces.json), e põe
// false em enabledPlugins para as cópias antigas dos terceiros que estiverem
// true, para as skills não aparecerem em dobro. Tudo pelo gravador da barra
// (configuracao.js): sem link, teto, UTF-8 estrito, formato do original,
// backup e troca conferida pelo lstat. Preserva o resto do arquivo e da
// entrada; uma entrada com fonte de outro lugar (ex.: directory, de quem
// desenvolve o plugin) não é tocada ('outra-fonte'). Nada é desinstalado:
// desfazer é pôr true de volta. Nunca lança.

export const MARKETPLACE = 'claude-hadouken';
export const FONTE = Object.freeze({ source: 'github', repo: 'Garioli-Labs/claude-hadouken' });
export const COPIAS_ANTIGAS = Object.freeze([
  'mattpocock-skills@mattpocock', 'poka-yoke@poka-yoke', 'fullstack-dev-skills@fullstack-dev-skills', 'ui-ux-pro-max@ui-ux-pro-max-skill',
]);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (motivo) => ({ ok: false, motivo });
const fonteNossa = (s) => ehObjeto(s) && s.source === FONTE.source && s.repo === FONTE.repo;
const arquivoValido = (a) => typeof a === 'string' && a.length > 0 && !a.includes('\0') && path.isAbsolute(a);

export function ligarAtualizacao(opcoes) {
  try {
    const { arquivo, agoraMs } = ehObjeto(opcoes) ? opcoes : {};
    if (!arquivoValido(arquivo) || !Number.isSafeInteger(agoraMs) || agoraMs < 0) return falha('argumentos');
    const lido = lerSettings(arquivo);
    if (!lido.ok) return falha(lido.motivo);
    const s = lido.existe ? lido.settings : {};
    const ekm = s.extraKnownMarketplaces;
    const ep = s.enabledPlugins;
    if ((ekm !== undefined && !ehObjeto(ekm)) || (ep !== undefined && !ehObjeto(ep))) return falha('settings-invalido');
    const atual = ekm !== undefined && Object.hasOwn(ekm, MARKETPLACE) ? ekm[MARKETPLACE] : undefined;
    if (atual !== undefined && !ehObjeto(atual)) return falha('settings-invalido');
    if (atual !== undefined && Object.hasOwn(atual, 'source') && !fonteNossa(atual.source)) return falha('outra-fonte');
    const desligar = COPIAS_ANTIGAS.filter((k) => ep !== undefined && Object.hasOwn(ep, k) && ep[k] === true);
    const pronta = atual !== undefined && fonteNossa(atual.source) && atual.autoUpdate === true;
    if (pronta && desligar.length === 0) return { ok: true, acao: 'ja-estava', desligadas: [], backup: null };
    const bloqueio = bloqueioDeEscrita(lido);
    if (bloqueio !== null) return falha(bloqueio.motivo);
    const entrada = { ...(atual ?? {}), source: atual?.source ?? { ...FONTE }, autoUpdate: true };
    const novo = { ...s, extraKnownMarketplaces: { ...(ekm ?? {}), [MARKETPLACE]: entrada } };
    if (desligar.length > 0) novo.enabledPlugins = { ...ep, ...Object.fromEntries(desligar.map((k) => [k, false])) };
    const g = gravarSettings(arquivo, lido, novo, agoraMs);
    return g.ok ? { ok: true, acao: 'gravado', desligadas: desligar, backup: g.backup } : falha(g.motivo);
  } catch {
    return falha('erro-interno');
  }
}

// O marketplace claude-hadouken em <config>/plugins/known_marketplaces.json
// (onde o `claude plugin marketplace add` o registra): 'nossa' (GitHub
// Garioli-Labs/claude-hadouken), 'outra' (qualquer outra fonte) ou 'ausente'
// (sem arquivo, ilegível ou sem a entrada). Nunca lança.
export function marketplaceConhecido(arquivo) {
  try {
    const r = lerJson(arquivo, 1024 * 1024);
    if (!r.ok || !ehObjeto(r.valor) || !Object.hasOwn(r.valor, MARKETPLACE)) return 'ausente';
    const e = r.valor[MARKETPLACE];
    return ehObjeto(e) && fonteNossa(e.source) ? 'nossa' : 'outra';
  } catch {
    return 'ausente';
  }
}

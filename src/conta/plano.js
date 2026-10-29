import os from 'node:os';
import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { lerTextoSemLink } from '../guarda/arquivo.js';

// O plano da conta (plano v0.5.6, decisão 3). A fonte é só o campo
// organizationRateLimitTier do .claude.json do Claude Code: o arquivo de
// configuração, nunca o de credenciais. Só o coletor desanexado o lê (nunca
// um hook), no máximo uma vez a cada 24 h, com teto de 8 MB, e guarda em
// conta-plano.json apenas o rótulo. Sem plano conhecido vale 'desconhecido',
// o comportamento da v0.5.5.

export const ARQ_PLANO = 'conta-plano.json';
export const ROTULO_PLANO = Object.freeze({ pro: 'Pro', max5: 'Max 5x', max20: 'Max 20x' });

const VALE_MS = 24 * 3600_000;
const TETO_BYTES = 8 * 1024 * 1024;
const BOM = String.fromCodePoint(0xfeff);
const PLANOS = new Set(Object.keys(ROTULO_PLANO));

// <dir>/.claude.json com CLAUDE_CONFIG_DIR absoluto, senão <home>/.claude.json
// (na pasta do usuário, não em ~/.claude/). home inválido: null.
export function arquivoClaudeJson(env, home) {
  const config = env?.CLAUDE_CONFIG_DIR;
  if (typeof config === 'string' && path.isAbsolute(config)) return path.join(config, '.claude.json');
  return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude.json') : null;
}

// O rótulo do campo, ou null. Nunca devolve outro pedaço do arquivo.
export function planoDoClaude(texto) {
  try {
    if (typeof texto !== 'string') return null;
    const j = JSON.parse(texto.startsWith(BOM) ? texto.slice(1) : texto);
    const tier = j !== null && typeof j === 'object' ? j.organizationRateLimitTier : null;
    if (typeof tier !== 'string') return null;
    if (tier.endsWith('_max_20x')) return 'max20';
    if (tier.endsWith('_max_5x')) return 'max5';
    return tier.includes('pro') ? 'pro' : null;
  } catch {
    return null;
  }
}

// deps: dir, agoraMs, arquivo (o .claude.json, ou null), ler (arquivo,
// maxBytes) → { ok, texto }. Com conta-plano.json de menos de 24 h não lê
// nada. Devolve { lido }. Nunca lança.
export function atualizarPlano({
  dir, agoraMs = Date.now(), arquivo = arquivoClaudeJson(process.env, os.homedir()), ler = lerTextoSemLink,
}) {
  try {
    const atual = lerJson(path.join(dir, ARQ_PLANO));
    const em = atual.ok ? atual.valor?.em : null;
    if (Number.isFinite(em) && em <= agoraMs && agoraMs - em < VALE_MS) return { lido: false };
    if (arquivo === null) return { lido: false };
    const l = ler(arquivo, TETO_BYTES);
    if (!l?.ok) return { lido: false };
    const plano = planoDoClaude(l.texto) ?? 'desconhecido';
    gravarJsonAtomico(path.join(dir, ARQ_PLANO), { v: 1, plano, em: agoraMs }, { compacto: true });
    return { lido: true };
  } catch {
    return { lido: false };
  }
}

// O plano guardado pelo coletor: 'pro' | 'max5' | 'max20' | 'desconhecido'.
export function planoEfetivo(dir) {
  try {
    if (typeof dir !== 'string' || dir === '') return 'desconhecido';
    const l = lerJson(path.join(dir, ARQ_PLANO));
    const plano = l.ok ? l.valor?.plano : null;
    return PLANOS.has(plano) ? plano : 'desconhecido';
  } catch {
    return 'desconhecido';
  }
}

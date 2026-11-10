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
// v0.5.9: o Max 20x virou Ultra (sem a janela de 5 h em conta verificada) e o
// Max 5x virou só Max. Os nomes antigos gravados são lidos como os novos.
export const ROTULO_PLANO = Object.freeze({ pro: 'Pro', max: 'Max', ultra: 'Ultra' });
const ANTIGOS = Object.freeze({ max5: 'max', max20: 'ultra' });
const migrar = (p) => (Object.hasOwn(ANTIGOS, p) ? ANTIGOS[p] : p);

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
    if (tier.endsWith('_max_20x') || tier.includes('ultra')) return 'ultra';
    if (tier.endsWith('_max_5x') || tier.includes('max')) return 'max';
    return tier.includes('pro') ? 'pro' : null;
  } catch {
    return null;
  }
}

// deps: dir, agoraMs, arquivo (o .claude.json, ou null), ler (arquivo,
// maxBytes) → { ok, texto }. Com conta-plano.json de menos de 24 h não lê
// nada. Sem arquivo ou com a leitura falha, a tentativa é gravada com o plano
// de antes (ou desconhecido): o coletor roda a cada minuto e não relê 8 MB a
// cada rodada. Devolve { lido }. Nunca lança.
export function atualizarPlano({ dir, agoraMs = Date.now(), arquivo, ler = lerTextoSemLink }) {
  try {
    const atual = lerJson(path.join(dir, ARQ_PLANO));
    const em = atual.ok ? atual.valor?.em : null;
    if (Number.isFinite(em) && em <= agoraMs && agoraMs - em < VALE_MS) return { lido: false };
    const alvo = arquivo === undefined ? arquivoClaudeJson(process.env, os.homedir()) : arquivo;
    const l = alvo === null ? null : ler(alvo, TETO_BYTES);
    const anterior = atual.ok && PLANOS.has(migrar(atual.valor?.plano)) ? migrar(atual.valor.plano) : 'desconhecido';
    const plano = l?.ok ? planoDoClaude(l.texto) ?? 'desconhecido' : anterior;
    gravarJsonAtomico(path.join(dir, ARQ_PLANO), { v: 1, plano, em: agoraMs }, { compacto: true });
    return { lido: l?.ok === true };
  } catch {
    return { lido: false };
  }
}

// O texto do plano nos relatórios (Task 6). Só os rótulos da lista fixa;
// qualquer outra coisa é "não identificado".
export function textoPlano(plano) {
  return Object.hasOwn(ROTULO_PLANO, plano) ? `${ROTULO_PLANO[plano]} (do Claude Code)` : 'não identificado (os relatórios mostram só tokens)';
}

// No Ultra sem leitura da janela de 5 h, ela não aparece (barra, dica, avisos).
// Com leitura (conta não verificada), aparece e vale.
export const semCincoHoras = (plano, janela5h) => plano === 'ultra' && (janela5h === null || janela5h === undefined);

// O plano guardado pelo coletor: 'pro' | 'max' | 'ultra' | 'desconhecido'.
export function planoEfetivo(dir) {
  try {
    if (typeof dir !== 'string' || dir === '') return 'desconhecido';
    const l = lerJson(path.join(dir, ARQ_PLANO));
    const plano = l.ok ? migrar(l.valor?.plano) : null;
    return PLANOS.has(plano) ? plano : 'desconhecido';
  } catch {
    return 'desconhecido';
  }
}

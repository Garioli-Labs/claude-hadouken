import crypto from 'node:crypto';
import path from 'node:path';
import { bloqueioDeEscrita, gravarSettings, lerSettings } from '../configuracao.js';
import { HOST, PORTA } from './config-coletor.js';

// O `env` do settings.json (spec aprendizado §3.2 passos 4 e 5, `desligar`,
// §6 última linha; R1). Toda leitura e gravação passa pelo gravador da barra
// (configuracao.js): sem link, teto de bytes, UTF-8 estrito, formato do
// original (BOM, CRLF, indentação), cópia <settings>.bak-hadouken-<ms> e troca
// conferida pelo lstat. O `ligar` só acrescenta as chaves de CHAVES_LIGAR que
// faltam (as que já estão com o mesmo valor ficam e não são "nossas"); o
// `desligar` só tira as que o `ligar` gravou e que ainda têm o valor dele.
// Recusa (§3.2 passo 5) com conteúdo ligado ou outro endpoint OTLP, no `env`
// ou no ambiente. Argumentos com as regras da barra (arquivoDe e agoraDe de
// configuracao.js): o arquivo é caminho absoluto, não vazio e sem NUL, e
// agoraMs, que entra no nome da cópia, é inteiro seguro não negativo; fora
// disso, 'argumentos' sem ler nada. Nenhuma função lança.

export const ENDPOINT = `http://${HOST}:${PORTA}`;
export const CHAVES_LIGAR = Object.freeze({
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
  // Emenda A1: tira a conta das métricas; intervalos curtos para sessões
  // curtas; métricas em delta (o leitor só soma delta, otlp.js).
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: 'false',
  OTEL_METRIC_EXPORT_INTERVAL: '10000',
  OTEL_LOGS_EXPORT_INTERVAL: '5000',
  OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
});
export const INTERRUPTORES_CONTEUDO = Object.freeze(['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS', 'OTEL_LOG_RAW_API_BODIES']);
export const OUTROS_ENDPOINTS = Object.freeze([
  'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
]);
const DESLIGADO = new Set(['', '0', 'false', 'no', 'off']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (motivo) => ({ ok: false, motivo });
const valorDe = (obj, k) => (ehObjeto(obj) && Object.hasOwn(obj, k) ? obj[k] : undefined);
const arquivoValido = (a) => typeof a === 'string' && a.length > 0 && !a.includes('\0') && path.isAbsolute(a);
const agoraValido = (ms) => Number.isSafeInteger(ms) && ms >= 0;

// String() sem lançar: um valor que não vira texto (objeto sem protótipo, que
// o JSON.parse nunca dá) fica null, diferente de todo texto, e o plano recusa.
function textoDe(valor) {
  try {
    return String(valor);
  } catch {
    return null;
  }
}

// "Ligado" é qualquer valor fora de vazio, 0, false, no e off (sem caixa e
// sem espaços nas pontas), como o Claude Code lê as chaves booleanas.
export function interruptorLigado(valor) {
  if (valor === undefined || valor === null) return false;
  try {
    return !DESLIGADO.has(String(valor).trim().toLowerCase());
  } catch {
    return true;
  }
}

export function planejarLigar(settings, ambiente) {
  const temEnv = ehObjeto(settings) && Object.hasOwn(settings, 'env');
  const env = temEnv ? settings.env : {};
  if (!ehObjeto(env)) return falha('env-invalido');
  for (const k of INTERRUPTORES_CONTEUDO) {
    if (interruptorLigado(valorDe(env, k)) || interruptorLigado(valorDe(ambiente, k))) return falha('conteudo-ligado');
  }
  for (const k of OUTROS_ENDPOINTS) {
    for (const v of [valorDe(env, k), valorDe(ambiente, k)]) {
      if (v !== undefined && v !== null && v !== '' && textoDe(v) !== ENDPOINT) return falha('outro-endpoint');
    }
  }
  const adicionar = [];
  for (const [k, v] of Object.entries(CHAVES_LIGAR)) {
    const atual = valorDe(env, k);
    if (atual === undefined) adicionar.push(k);
    else if (textoDe(atual) !== v) return falha('env-conflito');
  }
  return { ok: true, adicionar, criaEnv: !temEnv };
}

export function planejarDesligar(settings, ligado) {
  const env = valorDe(settings, 'env');
  if (!ehObjeto(env) || !ehObjeto(ligado?.chaves)) return { remover: [], removeEnv: false };
  const remover = Object.keys(ligado.chaves).filter((k) => Object.hasOwn(env, k) && env[k] === ligado.chaves[k]);
  const sobra = Object.keys(env).filter((k) => !remover.includes(k));
  return { remover, removeEnv: ligado.criouEnv === true && sobra.length === 0 };
}

// R4: a assinatura entra no código de confirmação; qualquer byte diferente
// entre a prévia e o ligar muda o código.
export function assinaturaSettings(lido) {
  return lido?.existe === true ? crypto.createHash('sha256').update(lido.bytes).digest('hex') : 'ausente';
}

function planoDoArquivo(arquivo, ambiente) {
  const lido = lerSettings(arquivo);
  if (!lido.ok) return lido;
  const settings = lido.existe ? lido.settings : {};
  const p = planejarLigar(settings, ambiente);
  if (!p.ok) return p;
  if (p.adicionar.length > 0) {
    const b = bloqueioDeEscrita(lido);
    if (b !== null) return b;
  }
  return { ok: true, lido, settings, ...p };
}

export function consultarLigar(opcoes) {
  try {
    const { arquivo, ambiente } = opcoes ?? {};
    if (!arquivoValido(arquivo)) return falha('argumentos');
    const c = planoDoArquivo(arquivo, ambiente);
    return c.ok ? { ok: true, assinatura: assinaturaSettings(c.lido), adicionar: c.adicionar, criaEnv: c.criaEnv } : c;
  } catch {
    return falha('erro-interno');
  }
}

export function aplicarLigar(opcoes) {
  try {
    const { arquivo, agoraMs, ambiente, esperado } = opcoes ?? {};
    if (!arquivoValido(arquivo) || !agoraValido(agoraMs)) return falha('argumentos');
    const c = planoDoArquivo(arquivo, ambiente);
    if (!c.ok) return c;
    if (assinaturaSettings(c.lido) !== esperado) return falha('settings-mudou');
    if (c.adicionar.length === 0) return { ok: true, adicionadas: {}, criouEnv: false, backup: null };
    const adicionadas = Object.fromEntries(c.adicionar.map((k) => [k, CHAVES_LIGAR[k]]));
    // Espalhar mantém a posição de `env` e das chaves do usuário; as nossas
    // entram no fim do `env` (ou o `env` entra no fim do arquivo).
    const env = c.criaEnv ? adicionadas : { ...c.settings.env, ...adicionadas };
    const g = gravarSettings(arquivo, c.lido, { ...c.settings, env }, agoraMs);
    return g.ok ? { ok: true, adicionadas, criouEnv: c.criaEnv, backup: g.backup } : g;
  } catch {
    return falha('erro-interno');
  }
}

export function aplicarDesligar(opcoes) {
  try {
    const { arquivo, agoraMs, ligado } = opcoes ?? {};
    if (!arquivoValido(arquivo) || !agoraValido(agoraMs)) return falha('argumentos');
    const lido = lerSettings(arquivo);
    if (!lido.ok) return lido;
    if (!lido.existe) return { ok: true, removidas: [], backup: null };
    const p = planejarDesligar(lido.settings, ligado);
    if (p.remover.length === 0 && !p.removeEnv) return { ok: true, removidas: [], backup: null };
    const b = bloqueioDeEscrita(lido);
    if (b !== null) return b;
    const novo = { ...lido.settings };
    if (p.removeEnv) {
      delete novo.env;
    } else {
      const env = { ...lido.settings.env };
      for (const k of p.remover) delete env[k];
      novo.env = env;
    }
    const g = gravarSettings(arquivo, lido, novo, agoraMs);
    return g.ok ? { ok: true, removidas: p.remover, backup: g.backup } : g;
  } catch {
    return falha('erro-interno');
  }
}

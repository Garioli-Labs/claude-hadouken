import fs from 'node:fs';
import { lerStdinVigiando, dirDados } from '../base.js';

// O que os três hooks do plugin (spec 6.5) têm em comum: ler o JSON do
// stdin, escrever o contexto no formato do Claude Code e sair sempre com
// código 0, sem stack trace. Nenhum hook bloqueia o prompt nem devolve erro ao
// Claude: qualquer falha termina calada.
//
// Este arquivo fica no caminho curto de todo hook (antes do gate de ativação,
// spec 8.2), então só importa base.js (lerStdinVigiando, dirDados) e o
// node:fs, que base.js já carrega.
//
// Prazos (spec 8.1, S9): só a leitura do stdin tem prazo próprio (1 s, em
// lerStdinVigiando). O trabalho depois do gate é E/S síncrona sem prazo,
// porque o Node não interrompe uma chamada síncrona sem um worker; o limite de
// fora é o timeout de cada hook em hooks/hooks.json (5 s; 10 s nos que
// bloqueiam, desde a v0.4.0). Numa home em rede travada o prompt espera no
// máximo isso (resíduo aceito, M5 da revisão da Task 7; a barra tem o mesmo
// formato).

// Se o Claude Code fechar o pipe antes da escrita, o EPIPE vira evento de
// erro no stdout; sem ouvinte ele derrubaria o processo com código 1.
process.stdout.on('error', () => {});

// Escreve { hookSpecificOutput: { hookEventName, additionalContext } }. O
// JSON.stringify escapa todo controle C0; o texto vem só de rótulos do código
// e números validados (spec 8.1, S1), então nada de fora chega aqui.
export function emitirContexto(evento, texto) {
  if (typeof evento !== 'string' || typeof texto !== 'string' || texto.length === 0) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: texto } }));
}

// Escreve uma saída de hook já montada: as decisões da guarda (spec v0.4.0
// §4.2: deny, continue:false, decision:block). Os textos vêm só de
// src/guarda/mensagens.js; o JSON.stringify escapa todo controle C0.
export function emitirJson(valor) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return;
  process.stdout.write(JSON.stringify(valor));
}

// Interruptor da proteção (Emenda 3 da spec v0.5.3 VS Code, §12.2), por
// import dinâmico como o registro abaixo. Falha fechada: sem o módulo, a
// proteção vale.
export async function protecaoLigada(id) {
  try {
    return (await import('../guarda/protecoes.js')).protecaoLigada(dirDados(), id);
  } catch {
    return true;
  }
}

// Fail-open visível dos hooks da guarda (spec v0.4.0 §4.5): qualquer exceção
// em fn (import que falha, avaliação, perfil, mensagem, escrita) deixa o hook
// passar e registra o evento 'erro' com o detalhe do hook (rótulo fixo, ex.
// 'P1'). Uma saída que fn já escreveu antes de lançar fica como está. O
// registro vem por import dinâmico, para este arquivo seguir só com base.js no
// caminho curto, e nunca lança: sem registro, o hook passa do mesmo jeito.
export async function falharAberto(dir, detalhe, agoraMs, fn) {
  try {
    await fn();
  } catch {
    await registrarErro(dir, detalhe, agoraMs);
  }
}

async function registrarErro(dir, detalhe, agoraMs) {
  try {
    const { anexarEvento } = await import('../guarda/registros.js');
    anexarEvento(dir, 'erro', detalhe, agoraMs);
  } catch { /* nada a fazer: o hook passa */ }
}

// M5 da revisão final da parte 1 (spec v0.4.0 §4.5, fail-open visível): o
// stdin acima do teto (sem a vigia casar) ou cortado pelo prazo, sem JSON
// inteiro, deixa a chamada passar e registra 'erro' com o rótulo do hook. Sem
// o JSON não há session_id, então não há gate de sessão; por isso só grava na
// pasta de dados que já existe (anexarEvento criaria a pasta de quem nunca
// ativou o plugin). Nunca lança. Exportada para o hook da agenda, que também
// a chama com o JSON ilegível (Task 0 da parte 2, guarda-agenda.js).
export async function avisarLeituraFalha(rotulo) {
  try {
    const dir = dirDados();
    if (dir === null || fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) return;
    await registrarErro(dir, rotulo, Date.now());
  } catch { /* o hook passa */ }
}

// Objeto JSON do stdin, ou null (vazio, inválido, lista, primitivo, acima do
// teto de lerStdinVigiando).
function entradaDe(texto) {
  try {
    const v = JSON.parse(texto);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Lê o stdin, chama fn(entrada | null, leitura) e sai com 0 aconteça o que
// acontecer: erro síncrono, promessa rejeitada ou stdin quebrado. Usa exitCode
// (nunca process.exit) para que a escrita no stdout termine antes da saída.
// maxBytes troca o teto de 1 MiB do stdin (spec 8.1, S9) e vigia procura uma
// RegExp no texto cru acima dele (lerStdinVigiando em base.js); leitura é
// { excedeu, casou, cortado, texto }, com texto o stdin cru lido ('' acima do
// teto). Só o hook da agenda lê o texto cru, para falhar fechada sem JSON
// (Task 0 da parte 2); os outros hooks o ignoram. A P4 (guarda-filha.js) troca
// o teto e usa a vigia, porque a regra fixa precisa ver o comando inteiro; o
// hook da agenda usa a vigia. rotulo (o detalhe do evento, ex. 'P1') liga o
// aviso de leitura que falhou (avisarLeituraFalha, M5), depois de fn: o deny
// da vigia sai primeiro. Os hooks de antes da guarda não passam rótulo.
// opcoes.prazoMs (spec v0.5.5 §6.F): o prazo interno, 80% do timeout do
// hooks.json. Chegou nele, o processo sai com 0 sem mais nada, o que vale
// como permitir; o timer é unref e não segura um hook que acabou. Só
// session-start, prompt-submit e session-end o usam; os hooks da guarda e
// o liberar nunca.
export function rodarHook(fn, maxBytes, vigia, rotulo, opcoes) {
  const prazoMs = opcoes?.prazoMs;
  if (Number.isFinite(prazoMs) && prazoMs > 0) setTimeout(() => process.exit(0), prazoMs).unref();
  lerStdinVigiando(undefined, maxBytes, vigia)
    .then(async (r) => {
      const entrada = entradaDe(r.texto);
      try {
        await fn(entrada, { excedeu: r.excedeu, casou: r.casou, cortado: r.cortado, texto: r.texto });
      } finally {
        const falhou = (r.excedeu && !r.casou) || (r.cortado && entrada === null);
        if (typeof rotulo === 'string' && falhou) await avisarLeituraFalha(rotulo);
      }
    })
    .catch(() => {})
    .finally(() => { process.exitCode = 0; });
}

// Spec v0.4.0 §10, item 3 (proposta 3): a entrada de hook que vem de dentro
// de um subagente. O sinal é o agent_id (texto não vazio). Na falta dele, o
// transcript_path com a pasta subagents, com / ou \. É só reserva: pelo S1 da
// parte 1, o PreToolUse de dentro do subagente traz o caminho da mãe. Só
// confere forma; nada daqui vira texto. Nunca lança.
// Portão dos comandos que só valem digitados (/hadouken:liberar e
// /hadouken:limites; a razão de cada lista está no cabeçalho de liberar.js).
// Origem e expansão em listas fechadas: qualquer outro valor, inclusive
// ausente, é recusado. CLAUDE_CODE_ENTRYPOINT sdk-* (-p e SDK) também.
const ORIGENS = Object.freeze(['plugin']);
const EXPANSOES = Object.freeze(['slash_command']);
export const digitado = (entrada) => ORIGENS.includes(entrada.command_source) && EXPANSOES.includes(entrada.expansion_type);
export function entrypointSdk() {
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT;
  return typeof ep === 'string' && /^sdk/i.test(ep);
}

// A pasta subagents conta só como pasta mãe do arquivo
// (<sessão>/subagents/agent-<id>.jsonl). Uma pasta subagents mais acima (a
// home ou o CLAUDE_CONFIG_DIR dentro dela) faria da thread principal um
// subagente: a sessão nunca se registraria e a guarda inteira sairia cedo,
// calada (concern 1 da revisão da Task 9). A pasta mãe do transcript da
// thread principal é o cwd saneado, que nunca é "subagents".
const PASTA_SUBAGENTES = /[\\/]subagents[\\/][^\\/]+$/;
const CAMINHO_MAX = 4096;
export function dentroDeSubagente(entrada) {
  try {
    if (entrada === null || typeof entrada !== 'object') return false;
    const id = entrada.agent_id;
    if (typeof id === 'string' && id.length > 0) return true;
    const t = entrada.transcript_path;
    return typeof t === 'string' && t.length <= CAMINHO_MAX && PASTA_SUBAGENTES.test(t);
  } catch {
    return false;
  }
}

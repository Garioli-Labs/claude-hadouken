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
// ativou o plugin). Nunca lança.
async function avisarLeituraFalha(rotulo) {
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
// { excedeu, casou, cortado }. A P4 (guarda-filha.js) troca o teto e usa a
// vigia, porque a regra fixa precisa ver o comando inteiro; o hook da agenda
// usa a vigia. rotulo (o detalhe do evento, ex. 'P1') liga o aviso de leitura
// que falhou (avisarLeituraFalha, M5), depois de fn: o deny da vigia sai
// primeiro. Os hooks de antes da guarda não passam rótulo.
export function rodarHook(fn, maxBytes, vigia, rotulo) {
  lerStdinVigiando(undefined, maxBytes, vigia)
    .then(async (r) => {
      const entrada = entradaDe(r.texto);
      try {
        await fn(entrada, { excedeu: r.excedeu, casou: r.casou, cortado: r.cortado });
      } finally {
        const falhou = (r.excedeu && !r.casou) || (r.cortado && entrada === null);
        if (typeof rotulo === 'string' && falhou) await avisarLeituraFalha(rotulo);
      }
    })
    .catch(() => {})
    .finally(() => { process.exitCode = 0; });
}

import path from 'node:path';
import { ARQ_ESTADO, lerJson, validarEstado, leiturasComPiso } from '../estado.js';
import { avaliarGuarda, modeloNoEstado } from './avaliar.js';
import { lerConfigGuarda } from './config.js';
import { lerLiberacao, coberturaAtual, gravarLiberacao } from './liberacao.js';
import { marcarSessao, anexarEvento, modeloDaSessao } from './registros.js';
import { p2Usuario, posLiberacao } from './mensagens.js';

// Decisão do UserPromptSubmit (spec v0.4.0 §4.2 P2 e §6.1). Numa sessão cujo
// modelo é Fable (modelos.json, senão o display_name do estado), com trava
// ativa, o prompt digitado é bloqueado; o reason vai só ao usuário (C10).
// Passam sem bloqueio:
//   - '/claude-hadouken:...', para a liberação nunca travar a si mesma;
//   - '<task-notification>...', o turno automático que entrega o resultado de
//     um subagente em segundo plano (achado S6: o UserPromptSubmit dele tem as
//     mesmas chaves de um prompt digitado; só o começo do texto o separa).
// Um prompt digitado pelo usuário começando com '<task-notification>' também
// passa: é o usuário, e a P1 segue valendo para o que o turno despachar.
// Linha pós-liberação: uma vez, na sessão que liberou (avisada: true).
// Erro (status 'erro' ou exceção): nada bloqueia e o evento 'erro' é
// registrado (fail-open visível, §4.5). `avaliar` só existe para o teste
// forçar o erro ou contar as avaliações; o hook nunca o passa.
//
// M9 da revisão final da parte 1 (§9.2): o modelo da sessão vem primeiro, e a
// avaliação completa só roda numa sessão Fable, a única que a P2 bloqueia.
// Fora do Fable (ou com o modelo desconhecido), só liberacao.json para a linha
// pós-liberação; config.json e estado.json só quando há linha a dar. Troca
// assumida: a §5.3 lista a P2 entre quem grava a trava na transição; fora do
// Fable quem grava é a barra, a P1 ou a P3 (a avaliação seguinte de qualquer
// um deles), e a trava é a mesma.

const NADA = Object.freeze({ bloquear: null, linha: null });
const ISENTOS = ['/claude-hadouken:', '<task-notification>'];
const FABLE = /fable/i;

function registrarErro(dir, agoraMs) {
  try {
    if (typeof dir === 'string') anexarEvento(dir, 'erro', 'P2', agoraMs);
  } catch {
    // O registro do erro nunca derruba o prompt.
  }
}

function lerEstado(dir, agoraMs) {
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  return lido.ok ? validarEstado(lido.valor, agoraMs) : null;
}

// Sessão fora do Fable: a linha pós-liberação com o mesmo critério da
// avaliação completa (guarda ligada, liberação desta sessão ainda não avisada
// e cobertura ativa, com o 7d do estado para o teto de pontos).
function linhaForaDoFable(dir, sessionId, agoraMs, estadoLido) {
  const lib = lerLiberacao(dir, agoraMs);
  if (!lib || lib.sessao !== sessionId || lib.avisada) return { ...NADA };
  if (!lerConfigGuarda(dir).config.ligada) return { ...NADA };
  const usado7d = leiturasComPiso(estadoLido(), agoraMs).seven_day?.used_percentage;
  if (coberturaAtual(lib, agoraMs, usado7d).ativa && gravarLiberacao(dir, { ...lib, avisada: true }).ok) {
    return { bloquear: null, linha: posLiberacao(lib, agoraMs) };
  }
  return { ...NADA };
}

export function decidirPrompt({ dir, sessionId, prompt, agoraMs, avaliar = avaliarGuarda } = {}) {
  try {
    if (typeof dir !== 'string') return { ...NADA };
    marcarSessao(dir, sessionId);
    const texto = typeof prompt === 'string' ? prompt.trimStart() : '';
    if (ISENTOS.some((p) => texto.startsWith(p))) return { ...NADA };
    // estado.json lido no máximo uma vez, e só se alguém precisar dele.
    let estado;
    const estadoLido = () => {
      if (estado === undefined) estado = lerEstado(dir, agoraMs);
      return estado;
    };
    const modelo = modeloDaSessao(dir, sessionId, agoraMs) ?? modeloNoEstado(estadoLido(), sessionId);
    if (typeof modelo !== 'string' || !FABLE.test(modelo)) return linhaForaDoFable(dir, sessionId, agoraMs, estadoLido);
    const g = avaliar({ dir, agoraMs, sessionId });
    if (g.status === 'erro') {
      anexarEvento(dir, 'erro', 'P2', agoraMs);
      return { ...NADA };
    }
    if (g.ativas.length > 0) {
      anexarEvento(dir, 'prompt-bloqueado', g.ativas.join(':'), agoraMs);
      return { bloquear: p2Usuario(g.motivos, g.ativas, agoraMs), linha: null };
    }
    const lib = g.liberacao;
    if (lib && g.cobertura.ativa && lib.sessao === sessionId && !lib.avisada
      && gravarLiberacao(dir, { ...lib, avisada: true }).ok) {
      return { bloquear: null, linha: posLiberacao(lib, agoraMs) };
    }
    return { ...NADA };
  } catch {
    registrarErro(dir, agoraMs);
    return { ...NADA };
  }
}

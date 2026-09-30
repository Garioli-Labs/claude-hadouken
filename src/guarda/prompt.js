import { avaliarGuarda } from './avaliar.js';
import { gravarLiberacao } from './liberacao.js';
import { marcarSessao, anexarEvento } from './registros.js';
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
// forçar o erro; o hook nunca o passa.

const NADA = Object.freeze({ bloquear: null, linha: null });
const ISENTOS = ['/claude-hadouken:', '<task-notification>'];

function registrarErro(dir, agoraMs) {
  try {
    if (typeof dir === 'string') anexarEvento(dir, 'erro', 'P2', agoraMs);
  } catch {
    // O registro do erro nunca derruba o prompt.
  }
}

export function decidirPrompt({ dir, sessionId, prompt, agoraMs, avaliar = avaliarGuarda } = {}) {
  try {
    if (typeof dir !== 'string') return { ...NADA };
    marcarSessao(dir, sessionId);
    const texto = typeof prompt === 'string' ? prompt.trimStart() : '';
    if (ISENTOS.some((p) => texto.startsWith(p))) return { ...NADA };
    const g = avaliar({ dir, agoraMs, sessionId });
    if (g.status === 'erro') {
      anexarEvento(dir, 'erro', 'P2', agoraMs);
      return { ...NADA };
    }
    const fable = typeof g.modeloSessao === 'string' && /fable/i.test(g.modeloSessao);
    if (fable && g.ativas.length > 0) {
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

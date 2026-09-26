import { join } from 'node:path';
import { rodarHook } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva, renovarSessao } from '../ativas.js';

// Hook SessionEnd (spec 6.5, 8.2 e adendo A/C da Task 7): anexa uma linha ao
// histórico de sessões (historico.js) com o consumo do último instantâneo.
// Não imprime nada: o Claude Code já encerrou a conversa.
//
// Sessão sem registro ativo, session_id inválido ou sem diretório de dados:
// nada gravado. estado.js e historico.js vêm por import dinâmico depois do
// gate, como no UserPromptSubmit.
//
// O session_id passa por idValido aqui mesmo, antes de qualquer uso, como no
// SessionStart e no UserPromptSubmit (revisão final de segurança), sem
// depender da checagem interna de ativas.js.

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  if (dirDados() === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  renovarSessao(sessionId, agoraMs);
  const [{ ARQ_ESTADO, lerJson }, { registroHistorico, anexarHistorico }] = await Promise.all([
    import('../estado.js'),
    import('./historico.js'),
  ]);
  const dir = dirDados();
  if (dir === null) return;
  const lido = lerJson(join(dir, ARQ_ESTADO));
  const registro = registroHistorico({ entrada, estadoBruto: lido.ok ? lido.valor : null, sessionId, agoraMs });
  anexarHistorico(dir, registro);
});

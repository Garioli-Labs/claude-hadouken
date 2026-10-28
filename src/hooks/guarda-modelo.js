import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';

// Hook PreModelSwitch (spec v0.4.0 §4.2 P3). Sem matcher em hooks.json: o
// hook confere to_model por conta própria (C12: o matcher não cobre nome
// desconhecido) e roda só em troca de modelo, que é rara. Com trava ativa,
// nega a troca para o Fable com deny. Desde a v0.5.4, com guarda.perguntar
// (o padrão), pede confirmação (ask): o ask aceito no seletor é um segundo
// caminho de liberação, de propósito, porque quem troca o modelo é o usuário.
// Trocar para longe do Fable passa.
// Erro ao avaliar: passa e registra 'erro' P3 (fail-open visível, §4.5),
// tanto o status 'erro' de avaliarGuarda quanto qualquer exceção depois do
// gate (falharAberto, em comum.js).

async function avaliarTroca(dir, sessionId, agoraMs) {
  const [{ avaliarGuarda }, reg, msg] = await Promise.all([
    import('../guarda/avaliar.js'),
    import('../guarda/registros.js'),
    import('../guarda/mensagens.js'),
  ]);
  reg.marcarSessao(dir, sessionId);
  const g = avaliarGuarda({ dir, agoraMs, sessionId });
  if (g.status === 'erro') {
    reg.anexarEvento(dir, 'erro', 'P3', agoraMs);
    return;
  }
  if (g.ativas.length === 0) return;
  // guarda.perguntar (v0.5.4): a troca é do próprio usuário; com perguntar,
  // ele confirma no seletor em vez de ter a troca negada.
  if (g.config.perguntar) {
    emitirJson({ hookSpecificOutput: { hookEventName: 'PreModelSwitch', permissionDecision: 'ask', permissionDecisionReason: msg.p3Perguntar(g.motivos, agoraMs) } });
    reg.anexarEvento(dir, 'perguntado', `P3:${g.ativas.join(':')}`, agoraMs);
    return;
  }
  emitirJson({ hookSpecificOutput: { hookEventName: 'PreModelSwitch', permissionDecision: 'deny', permissionDecisionReason: msg.p3Usuario(g.motivos, g.ativas, agoraMs) } });
  reg.anexarEvento(dir, 'troca-bloqueada', g.ativas.join(':'), agoraMs);
}

rodarHook(async (entrada) => {
  if (entrada === null || typeof entrada.to_model !== 'string' || !/fable/i.test(entrada.to_model.slice(0, 200))) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  // Depois do gate, toda exceção passa e vira evento 'erro' (§4.5).
  await falharAberto(dir, 'P3', agoraMs, () => avaliarTroca(dir, sessionId, agoraMs));
}, undefined, undefined, 'P3');

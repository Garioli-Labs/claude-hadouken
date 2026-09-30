import os from 'node:os';
import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';

// Hook PreToolUse de Agent|Task|Workflow (spec v0.4.0 §4.2 P1, §4.3 e D1
// emendado: G5 despacho caro). Nega o despacho novo quando:
//   - há trava geral ativa (ilegível, 5h ou 7d), qualquer modelo;
//   - há trava do Fable ativa e o despacho é Fable;
//   - o despacho é caro e a liberação ativa não solta 'despacho-caro'.
// Na thread principal (sem agent_id, spike S1) acrescenta continue:false e
// stopReason (D3 opção A, spike S5). Dentro de subagente, só o deny.
// Quando passa, conta o despacho Fable (G7) e registra o perfil desconhecido.
// Erro ao avaliar: passa e registra 'erro' (fail-open visível, §4.5), tanto
// o status 'erro' de avaliarGuarda quanto qualquer exceção depois do gate
// (falharAberto, em comum.js).
// Caminho curto até o gate, como os outros hooks; a guarda vem por import
// dinâmico depois dele.

const FERRAMENTAS = new Set(['Agent', 'Task', 'Workflow']);
const GERAIS = new Set(['ilegivel', 'five_hour', 'seven_day']);
const DO_FABLE = new Set(['fable', 'fable-despachos']);
const DESCONHECIDO = Object.freeze({ modelo: 'desconhecido', effort: null, origem: 'desconhecido' });

function negar(razaoClaude, razaoUsuario) {
  const saida = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razaoClaude } };
  if (razaoUsuario !== null) Object.assign(saida, { continue: false, stopReason: razaoUsuario });
  emitirJson(saida);
}

function casa() {
  try { return os.homedir(); } catch { return null; }
}

async function avaliarDespacho(entrada, dir, sessionId, agoraMs) {
  const [{ avaliarGuarda }, desp, reg, msg] = await Promise.all([
    import('../guarda/avaliar.js'),
    import('../guarda/despacho.js'),
    import('../guarda/registros.js'),
    import('../guarda/mensagens.js'),
  ]);
  reg.marcarSessao(dir, sessionId);
  const g = avaliarGuarda({ dir, agoraMs, sessionId });
  if (g.status === 'erro') {
    reg.anexarEvento(dir, 'erro', 'P1', agoraMs);
    return;
  }
  if (g.status === 'desligada') return;
  const noSubagente = typeof entrada.agent_id === 'string' && entrada.agent_id.length > 0;
  const perfil = entrada.tool_name === 'Workflow' ? DESCONHECIDO : desp.perfilDoDespacho({
    toolInput: entrada.tool_input, cwd: entrada.cwd, dirConfigClaude: desp.dirConfigClaude(process.env, casa()),
    env: process.env, modeloSessao: g.modeloSessao,
  });

  const chaves = g.ativas.filter((k) => GERAIS.has(k) || (perfil.modelo === 'fable' && DO_FABLE.has(k)));
  if (chaves.length > 0) {
    const motivos = g.motivos.filter((mo) => chaves.includes(mo.trava));
    negar(
      noSubagente ? msg.p1Subagente(motivos, agoraMs) : msg.p1Claude(motivos, agoraMs),
      noSubagente ? null : msg.p1Usuario(motivos, chaves, agoraMs),
    );
    reg.anexarEvento(dir, 'negado', chaves.join(':'), agoraMs);
    return;
  }
  if (desp.despachoCaro(perfil) && !g.cobertura.solta.has('despacho-caro')) {
    negar(noSubagente ? msg.caroSubagente(perfil) : msg.caroClaude(perfil), noSubagente ? null : msg.caroUsuario(perfil));
    reg.anexarEvento(dir, 'negado', 'G5', agoraMs);
    return;
  }
  if (perfil.modelo === 'fable') reg.registrarDespachoFable(dir, agoraMs);
  if (perfil.modelo === 'desconhecido') reg.anexarEvento(dir, 'desconhecido', 'modelo', agoraMs);
  else if (perfil.effort === null) reg.anexarEvento(dir, 'desconhecido', 'effort', agoraMs);
}

rodarHook(async (entrada) => {
  if (entrada === null || !FERRAMENTAS.has(entrada.tool_name)) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  // Depois do gate, toda exceção passa e vira evento 'erro' (§4.5).
  await falharAberto(dir, 'P1', agoraMs, () => avaliarDespacho(entrada, dir, sessionId, agoraMs));
}, undefined, undefined, 'P1');

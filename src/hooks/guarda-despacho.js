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
// Antes do gate roda só a paleta (spec v0.6.0 §4 Fatia 4): agente removido ou
// desligado na config é negado com a guarda ligada ou não, e model/effort da
// config entram no despacho (updatedInput) quando faltam. Fora isso, caminho
// curto até o gate, como os outros hooks; a guarda vem por import dinâmico
// depois dele.

const FERRAMENTAS = new Set(['Agent', 'Task', 'Workflow']);
const GERAIS = new Set(['ilegivel', 'five_hour', 'seven_day']);
const DO_FABLE = new Set(['fable', 'fable-despachos']);
const DESCONHECIDO = Object.freeze({ modelo: 'desconhecido', effort: null, origem: 'desconhecido' });

// Uma saída por chamada (spec v0.6.0 §4 Fatia 4, passos 4 e 5). `saiu` marca
// que alguma decisão da guarda já foi escrita; sem ela, a injeção pendente da
// paleta sai sozinha no fim. Nenhuma saída deste hook devolve
// permissionDecision 'allow' (variante A, decisão do Fernando em 10/11/2026).
let saiu = false;
function emitir(saida) {
  saiu = true;
  emitirJson(saida);
}

// O `deny` prevalece e sai sem updatedInput.
function negar(razaoClaude, razaoUsuario) {
  const saida = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razaoClaude } };
  if (razaoUsuario !== null) Object.assign(saida, { continue: false, stopReason: razaoUsuario });
  emitir(saida);
}

// guarda.perguntar: na thread principal, o usuário aprova ou recusa na tela
// do Claude Code; nada para o turno. Dentro de subagente não há a quem
// perguntar com segurança, e o deny sem stop de antes continua. Com injeção
// pendente, o `ask` leva o updatedInput.
function perguntar(razaoUsuario, injecao) {
  const saida = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: razaoUsuario } };
  if (injecao !== null) saida.hookSpecificOutput.updatedInput = injecao;
  emitir(saida);
}

function casa() {
  try { return os.homedir(); } catch { return null; }
}

// Spec v0.6.0 §4 Fatia 4, passo 2: a paleta roda antes de todos os portões da
// guarda (session_id, sessão ativa, status erro, guarda desligada). Agente
// removido na 0.6.0 ou desligado na config (`ativo: false`) é negado com o
// substituto; o turno não para (o modelo relança). Só despachos `hadouken:*`
// carregam os módulos da paleta: o resto segue no caminho curto. Devolve o
// `agentes` lido (para N1/N2 e o perfil efetivo), se já negou e a injeção
// pendente (o tool_input original inteiro mais model/effort da config, ou
// null). A injeção só sai na saída final. `dir` null: sem config, e a remoção
// (pura) ainda nega.
async function aplicarPaleta(entrada, dir) {
  const ti = entrada.tool_input;
  const tipo = ti !== null && typeof ti === 'object' ? ti.subagent_type : undefined;
  if (entrada.tool_name === 'Workflow' || typeof tipo !== 'string' || !tipo.startsWith('hadouken:')) return { negou: false, agentes: {}, injecao: null };
  const [{ avaliarPaleta }, { lerAgentes }] = await Promise.all([import('../agentes/despacho.js'), import('../agentes/config.js')]);
  const { agentes } = lerAgentes(dir);
  const paleta = avaliarPaleta({ toolName: entrada.tool_name, toolInput: ti, agentes });
  if (paleta.acao === 'negar') {
    negar(paleta.razao, null);
    return { negou: true, agentes, injecao: null };
  }
  return { negou: false, agentes, injecao: paleta.acao === 'injetar' ? paleta.updatedInput : null };
}

async function avaliarDespacho(entrada, dir, sessionId, agoraMs, agentes, injecao) {
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
    env: process.env, modeloSessao: g.modeloSessao, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT, agentes,
  });

  const chaves = g.ativas.filter((k) => GERAIS.has(k) || (perfil.modelo === 'fable' && DO_FABLE.has(k)));
  if (chaves.length > 0) {
    const motivos = g.motivos.filter((mo) => chaves.includes(mo.trava));
    if (!noSubagente && g.config.perguntar) {
      perguntar(msg.p1Perguntar(motivos, agoraMs), injecao);
      reg.anexarEvento(dir, 'perguntado', `P1:${chaves.join(':')}`, agoraMs);
      // O hook não sabe a resposta: conta o Fable já (G7), a favor da cota.
      if (perfil.modelo === 'fable') reg.registrarDespachoFable(dir, agoraMs);
      return;
    }
    negar(
      noSubagente ? msg.p1Subagente(motivos, agoraMs) : msg.p1Claude(motivos, agoraMs),
      noSubagente ? null : msg.p1Usuario(motivos, chaves, agoraMs),
    );
    reg.anexarEvento(dir, 'negado', chaves.join(':'), agoraMs);
    return;
  }
  if (desp.despachoCaro(perfil) && !g.cobertura.solta.has('despacho-caro')) {
    if (!noSubagente && g.config.perguntar) {
      perguntar(msg.caroPerguntar(perfil), injecao);
      reg.anexarEvento(dir, 'perguntado', 'G5', agoraMs);
      if (perfil.modelo === 'fable') reg.registrarDespachoFable(dir, agoraMs);
      return;
    }
    negar(noSubagente ? msg.caroSubagente(perfil) : msg.caroClaude(perfil), noSubagente ? null : msg.caroUsuario(perfil));
    reg.anexarEvento(dir, 'negado', 'G5', agoraMs);
    return;
  }
  // Spec roteamento §6: depois das travas e do G5 (foco 2), N1/N2 negam e
  // A1–A3 avisam. Workflow não tem agente: fica de fora. A negação não para o
  // turno: o modelo relança com o agente barato. emitirJson roda no máximo
  // uma vez: depois do aviso, o resto só grava registros.
  if (entrada.tool_name !== 'Workflow') {
    const [{ lerConfigRoteamento }, { avaliarRoteamento }, rot] = await Promise.all([
      import('../roteamento/config.js'), import('../roteamento/regras.js'), import('../roteamento/registro.js'),
    ]);
    const ti = entrada.tool_input !== null && typeof entrada.tool_input === 'object' ? entrada.tool_input : {};
    const pr = desp.perfilRoteamento({ toolInput: ti, cwd: entrada.cwd, dirConfigClaude: desp.dirConfigClaude(process.env, casa()), env: process.env, modeloSessao: g.modeloSessao, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT });
    const prompt = typeof ti.prompt === 'string' ? ti.prompt : '';
    const { config } = lerConfigRoteamento(dir);
    const d = avaliarRoteamento({ perfil: pr, descricao: ti.description, prompt, recentes: rot.despachosRecentes(dir, sessionId, agoraMs), config, liberado: g.cobertura.ativa === true, agoraMs, agentes });
    // O registro leva o que o Agent vai rodar (com a injeção); as regras veem o
    // que o Claude escreveu (pr).
    const efetivo = injecao === null ? pr : desp.perfilRoteamento({ toolInput: injecao, cwd: entrada.cwd, dirConfigClaude: desp.dirConfigClaude(process.env, casa()), env: process.env, modeloSessao: g.modeloSessao, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT });
    if (pr.agente !== null) rot.registrarDespacho(dir, { sessao: sessionId, agente: pr.agente, familia: efetivo.familia, effort: efetivo.effort, regra: d.regra, decisao: d.decisao, em: agoraMs, tamPrompt: Math.min(prompt.length, 1e6), palavras: rot.hashesDePalavras(ti.description) });
    if (d.decisao === 'negar') {
      negar(noSubagente ? msg.N_SUBAGENTE : (d.regra === 'N1' ? msg.N1_CLAUDE : msg.N2_CLAUDE), null);
      reg.anexarEvento(dir, 'roteamento-negado', d.regra, agoraMs);
      return;
    }
    if (d.decisao === 'avisar') {
      const aviso = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg[`${d.regra}_CLAUDE`] } };
      if (injecao !== null) aviso.hookSpecificOutput.updatedInput = injecao;
      emitir(aviso);
      reg.anexarEvento(dir, 'roteamento-aviso', d.regra, agoraMs);
    }
  }
  if (perfil.modelo === 'fable') reg.registrarDespachoFable(dir, agoraMs);
  if (perfil.modelo === 'desconhecido') reg.anexarEvento(dir, 'desconhecido', 'modelo', agoraMs);
  else if (perfil.effort === null) reg.anexarEvento(dir, 'desconhecido', 'effort', agoraMs);
}

rodarHook(async (entrada) => {
  if (entrada === null || !FERRAMENTAS.has(entrada.tool_name)) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  // Ordem dos portões (spec v0.6.0 §4 Fatia 4): paleta, session_id válido,
  // pasta de dados, sessão ativa, e só então a guarda. Exceção na paleta passa
  // e vira evento 'erro' (falharAberto), como na guarda.
  let paleta = { negou: false, agentes: {}, injecao: null };
  await falharAberto(dir, 'P1', agoraMs, async () => { paleta = await aplicarPaleta(entrada, dir); });
  if (paleta.negou) return;
  // A injeção pendente sai ao fim, depois dos portões e da guarda, quando
  // nenhuma decisão da guarda foi escrita (deny, ask e aviso já a levam, ou
  // prevalecem sem ela). Portão fechado ou status erro também injetam (A10).
  try {
    const sessionId = entrada.session_id;
    if (!idValido(sessionId)) return;
    if (dir === null) return;
    if (!sessaoAtiva(sessionId, agoraMs)) return;
    // Depois do gate, toda exceção passa e vira evento 'erro' (§4.5).
    await falharAberto(dir, 'P1', agoraMs, () => avaliarDespacho(entrada, dir, sessionId, agoraMs, paleta.agentes, paleta.injecao));
  } finally {
    if (!saiu && paleta.injecao !== null) emitir({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: paleta.injecao } });
  }
}, undefined, undefined, 'P1');

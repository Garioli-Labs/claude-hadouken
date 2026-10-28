import crypto from 'node:crypto';
import path from 'node:path';
import { rodarHook, emitirJson, falharAberto, digitado, entrypointSdk } from './comum.js';
import { dirDados, idValido } from '../base.js';

// Hook UserPromptExpansion de /hadouken:liberar (spec v0.4.0 §6, D4 =
// opção C em 2026-09-29: sem código). Sempre bloqueia a expansão
// (decision:block): o corpo da skill não chega ao Claude e o modelo não é
// chamado (spike S2). Recusa quando CLAUDE_CODE_ENTRYPOINT indica -p ou SDK
// (sdk-cli, sdk-ts, sdk-py): o modelo não abre uma sessão filha para se
// liberar (a P4 fecha `claude *` com a guarda disparada; R1 declara npx, node
// e comandos ofuscados). O argumento nunca volta no texto: só a gramática de
// lerPedido decide, e a resposta sai de mensagens.js.
// Sem gate de sessão ativa: a liberação é do usuário e vale para a conta.
// Qualquer exceção depois do gate, inclusive a do import de mensagens.js, vira
// evento 'erro' (§4.5, falharAberto em comum.js) e a resposta "nada
// liberado": uma liberação que falha nunca fica gravada.
// Spike S12 da parte 2 (2.1.287): o `claude -p` aberto de uma sessão do VS Code
// recebeu entrypoint `sdk-cli`, então o filho -p já é recusado aqui. O
// `claude-vscode` segue aceito: é o `/liberar` digitado numa sessão normal do
// VS Code.
//
// Origem (C1 da revisão final da parte 1): só o comando digitado libera. A
// lista de origens aceitas é fechada, e qualquer outro valor, inclusive
// ausente, é recusado antes da marca de sessão, como a recusa do entrypoint.
// Os valores aceitos são os que o comando digitado traz de fato: a doc
// oficial (hooks, "UserPromptExpansion input", conferida em 2026-09-30) só
// tipa `expansion_type` ('slash_command' ou 'mcp_prompt') e mostra
// `command_source: "plugin"` no exemplo, com o campo opcional e sem lista de
// valores; o spike S2 (2.1.284) viu 'plugin' e 'slash_command' neste comando.
// Limite honesto: na 2.1.286 instalada, `command_source` é a fonte da
// definição do comando (plugin, projeto, usuário), não quem o disparou, e
// seria o mesmo 'plugin' numa tarefa agendada. Esta lista recusa as origens
// que a revisão citou (skill_tool, scheduled_task, /loop, queued_prompt) e
// qualquer rótulo novo; quem fecha a tarefa agendada e o /loop hoje são o
// `disable-model-invocation: true` da skill (a doc de scheduled tasks: um
// disparo agendado não roda essa skill, ela chega como texto) e o hook da
// agenda (guarda-agenda.js), que nega criar a tarefa com o pedido. Se uma
// versão nova rotular o comando digitado com outro valor, ele é recusado
// (fail-closed) até a lista ganhar o valor.

const COMANDO = 'hadouken:liberar';
// O mesmo texto de NAO_GRAVADO (mensagens.js), só para quando o import dele
// falha: a expansão continua bloqueada e nada é liberado.
// test/guarda-liberar-extra.test.js confere que os dois são iguais.
const NAO_GRAVADO_RESERVA = 'hadouken: nada liberado. A liberação não pôde ser gravada.';

// O texto da resposta. Tudo o que pode lançar (inclusive o próprio texto de
// confirmação e o escopo do evento) vem antes de gravarLiberacao; depois dela
// só limparTravas e anexarEvento, que nunca lançam. Assim uma exceção nunca
// deixa liberação gravada junto com a resposta "nada liberado".
async function decidir(entrada, dir, sessionId, agoraMs, msg) {
  const [{ lerConfigGuarda, gravarGuardaLigada }, est, trv, lib, reg] = await Promise.all([
    import('../guarda/config.js'),
    import('../estado.js'),
    import('../guarda/travas.js'),
    import('../guarda/liberacao.js'),
    import('../guarda/registros.js'),
  ]);
  // A recusa de -p e SDK vem antes de qualquer outra gravação: a sessão filha
  // deixa só o evento 'liberacao-recusada', nem a marca de sessão.
  if (entrypointSdk()) {
    reg.anexarEvento(dir, 'liberacao-recusada', 'entrypoint', agoraMs);
    return msg.RECUSADO_ENTRYPOINT;
  }
  if (!digitado(entrada)) {
    reg.anexarEvento(dir, 'liberacao-recusada', 'origem', agoraMs);
    return msg.RECUSADO_ORIGEM;
  }
  reg.marcarSessao(dir, sessionId);
  // off | on: liga ou desliga a guarda inteira (guarda.ligada), depois dos
  // mesmos portões da liberação.
  const chave = typeof entrada.command_args === 'string' ? entrada.command_args.trim().toLowerCase() : '';
  if (chave === 'off' || chave === 'on') {
    const ligada = chave === 'on';
    if (!gravarGuardaLigada(dir, ligada).ok) return msg.GUARDA_NAO_ALTERADA;
    reg.anexarEvento(dir, 'guarda-ligada', chave, agoraMs);
    return ligada ? msg.GUARDA_LIGADA : msg.GUARDA_DESLIGADA;
  }
  const { config } = lerConfigGuarda(dir);
  const pedido = lib.lerPedido(typeof entrada.command_args === 'string' ? entrada.command_args : '', config);
  if (!pedido.ok) {
    reg.anexarEvento(dir, 'liberacao-recusada', 'args', agoraMs);
    return msg.recusadoArgs(config.liberacaoMaxH);
  }
  // A base de 7d é a mesma leitura que avaliarGuarda passa a coberturaAtual
  // (leiturasComPiso, a mais fresca do estado.json): o fim por pontos compara
  // valores da mesma fonte.
  const lido = est.lerJson(path.join(dir, est.ARQ_ESTADO));
  const estado = lido.ok ? est.validarEstado(lido.valor, agoraMs) : null;
  const usado7d = est.leiturasComPiso(estado, agoraMs).seven_day?.used_percentage ?? null;
  const liberacao = lib.montarLiberacao({
    pedido, agoraMs, usado7d, travas: trv.lerTravas(dir, agoraMs).travas, config, sessionId,
    id: crypto.randomBytes(4).toString('hex'),
  });
  const texto = msg.liberado(liberacao, agoraMs);
  // Escopo e prazo para a "Guarda (7 dias)" do /consumo (spec v0.4.0 §9.4;
  // decisão 9 do plano da parte 2), calculado antes de gravar. null com
  // entrada inválida: o evento não sai.
  const escopo = lib.detalheEscopo(liberacao, pedido);
  if (!lib.gravarLiberacao(dir, liberacao).ok) return msg.NAO_GRAVADO;
  // Com guarda.json ilegível, limparTravas regrava as quatro chaves null
  // (§4.5: só a liberação limpa); a avaliação seguinte retrava o que a
  // condição ainda sustentar e a liberação não cobrir.
  trv.limparTravas(dir, liberacao.solta.filter((k) => trv.CHAVES_TRAVA.includes(k)), agoraMs);
  reg.anexarEvento(dir, 'liberacao', liberacao.id, agoraMs);
  // Evento à parte: o de 'liberacao' continua só com o id, que
  // temEventoLiberacao (R1) compara. Uma liberação ocupa agora 2 dos
  // EVENTOS_MAX (200) lugares do registro.
  if (escopo !== null) reg.anexarEvento(dir, 'liberacao-escopo', escopo, agoraMs);
  return texto;
}

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const sessionId = entrada.session_id;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = NAO_GRAVADO_RESERVA;
  // Com dir null, falharAberto não tem onde registrar (anexarEvento nunca
  // lança) e a resposta segue "nada liberado".
  await falharAberto(dir, 'liberar', agoraMs, async () => {
    const msg = await import('../guarda/mensagens.js');
    reason = msg.NAO_GRAVADO;
    if (!idValido(sessionId) || dir === null) return;
    reason = await decidir(entrada, dir, sessionId, agoraMs, msg);
  });
  emitirJson({ decision: 'block', reason });
}, undefined, undefined, 'liberar');

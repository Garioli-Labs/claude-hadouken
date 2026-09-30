import crypto from 'node:crypto';
import path from 'node:path';
import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';

// Hook UserPromptExpansion de /claude-hadouken:liberar (spec v0.4.0 §6, D4 =
// opção C em 2026-09-29: sem código). Sempre bloqueia a expansão
// (decision:block): o corpo da skill não chega ao Claude e o modelo não é
// chamado (spike S2). Recusa quando CLAUDE_CODE_ENTRYPOINT indica -p ou SDK
// (sdk-cli, sdk-ts, sdk-py): o modelo não abre uma sessão filha para se
// liberar (a P4 fecha `claude *` com a guarda disparada; R1 declara npx, node
// e comandos ofuscados). O argumento nunca volta no texto: só a gramática de
// lerPedido decide, e a resposta sai de mensagens.js.
// Sem gate de sessão ativa: a liberação é do usuário e vale para a conta.
// Qualquer exceção depois do gate vira evento 'erro' (§4.5, falharAberto em
// comum.js) e a resposta "nada liberado": uma liberação que falha nunca fica
// gravada.

const COMANDO = 'claude-hadouken:liberar';

// O texto da resposta. Tudo o que pode lançar (inclusive o próprio texto de
// confirmação) vem antes de gravarLiberacao; depois dela só limparTravas e
// anexarEvento, que nunca lançam. Assim uma exceção nunca deixa liberação
// gravada junto com a resposta "nada liberado".
async function decidir(entrada, dir, sessionId, agoraMs, msg) {
  const [{ lerConfigGuarda }, est, trv, lib, reg] = await Promise.all([
    import('../guarda/config.js'),
    import('../estado.js'),
    import('../guarda/travas.js'),
    import('../guarda/liberacao.js'),
    import('../guarda/registros.js'),
  ]);
  reg.marcarSessao(dir, sessionId);
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT;
  if (typeof ep === 'string' && /^sdk/i.test(ep)) {
    reg.anexarEvento(dir, 'liberacao-recusada', 'entrypoint', agoraMs);
    return msg.RECUSADO_ENTRYPOINT;
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
  if (!lib.gravarLiberacao(dir, liberacao).ok) return msg.NAO_GRAVADO;
  // Com guarda.json ilegível, limparTravas regrava as quatro chaves null
  // (§4.5: só a liberação limpa); a avaliação seguinte retrava o que a
  // condição ainda sustentar e a liberação não cobrir.
  trv.limparTravas(dir, liberacao.solta.filter((k) => trv.CHAVES_TRAVA.includes(k)), agoraMs);
  reg.anexarEvento(dir, 'liberacao', liberacao.id, agoraMs);
  return texto;
}

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const msg = await import('../guarda/mensagens.js');
  const sessionId = entrada.session_id;
  const dir = dirDados();
  if (!idValido(sessionId) || dir === null) return emitirJson({ decision: 'block', reason: msg.NAO_GRAVADO });
  const agoraMs = Date.now();
  let reason = msg.NAO_GRAVADO;
  await falharAberto(dir, 'liberar', agoraMs, async () => { reason = await decidir(entrada, dir, sessionId, agoraMs, msg); });
  emitirJson({ decision: 'block', reason });
});

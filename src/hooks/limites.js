import { rodarHook, emitirJson, falharAberto, digitado, entrypointSdk } from './comum.js';
import { dirDados } from '../base.js';

// Hook UserPromptExpansion de /hadouken:limites (spec v0.5.3 VS Code §2.2).
// Sempre bloqueia a expansão (decision:block), como /hadouken:liberar: o
// corpo da skill não chega ao Claude e o modelo não é chamado. Mesmo portão
// (comum.js): recusa -p e SDK, e qualquer origem que não seja o comando
// digitado, antes de ler ou gravar qualquer coisa. O argumento nunca volta
// no texto: só a gramática de lerPedidoLimites decide, e a resposta sai de
// config/mensagens.js. Qualquer exceção vira evento 'erro' (falharAberto) e
// a resposta "nada mudado".

const COMANDO = 'hadouken:limites';
// O mesmo texto de NAO_GRAVADO (config/mensagens.js), para quando o import
// dele falha.
const NAO_GRAVADO_RESERVA = 'hadouken: nada mudado. A configuração não pôde ser gravada.';

async function decidir(entrada, dir, agoraMs, msg) {
  if (entrypointSdk()) return msg.RECUSADO_ENTRYPOINT;
  if (!digitado(entrada)) return msg.RECUSADO_ORIGEM;
  const [{ lerPedidoLimites, GRUPOS_LIMITES }, { lerConfiguracao }, { gravarConfiguracao, voltarAoPadrao }, { ITEM, ITENS }] = await Promise.all([
    import('../config/pedido.js'),
    import('../config/ler.js'),
    import('../config/gravar.js'),
    import('../config/tabela.js'),
  ]);
  const pedido = lerPedidoLimites(typeof entrada.command_args === 'string' ? entrada.command_args : '');
  if (pedido.acao === 'invalido') return msg.INVALIDO;
  const lido = lerConfiguracao(dir);
  if (pedido.acao === 'mostrar') return msg.tabela(lido.itens.filter((i) => GRUPOS_LIMITES.includes(i.grupo)), lido.avisos);
  const opcoes = { versao: lido.versao, agoraMs };
  let r;
  if (pedido.acao === 'gravar') r = gravarConfiguracao(dir, { [pedido.id]: pedido.valor }, opcoes);
  else if (pedido.acao === 'padrao') r = voltarAoPadrao(dir, [pedido.id], opcoes);
  else r = voltarAoPadrao(dir, ITENS.filter((i) => GRUPOS_LIMITES.includes(i.grupo)).map((i) => i.id), opcoes);
  if (!r.ok) {
    if (r.motivo === 'invalido') return msg.recusado(r.erros);
    return r.motivo === 'mudou' ? msg.MUDOU : msg.NAO_GRAVADO;
  }
  if (pedido.acao === 'padrao-tudo') return msg.PADRAO_TUDO;
  const item = ITEM[pedido.id];
  if (pedido.acao === 'padrao') return msg.padrao(item);
  const antes = lido.itens.find((i) => i.id === pedido.id);
  return msg.gravado(item, pedido.valor, r.afrouxou.includes(pedido.id) && antes.aperto !== null);
}

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = NAO_GRAVADO_RESERVA;
  await falharAberto(dir, 'limites', agoraMs, async () => {
    const msg = await import('../config/mensagens.js');
    reason = msg.NAO_GRAVADO;
    if (dir === null) return;
    reason = await decidir(entrada, dir, agoraMs, msg);
  });
  emitirJson({ decision: 'block', reason });
}, undefined, undefined, 'limites');

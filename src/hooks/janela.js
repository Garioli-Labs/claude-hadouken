import { rodarHook, emitirJson, falharAberto, digitado, entrypointSdk } from './comum.js';
import { dirDados } from '../base.js';

// Hook UserPromptExpansion de /hadouken:janela (spec v0.6.0 §4, Fatia 2).
// Sempre bloqueia a expansão (decision:block), como /hadouken:saude: o texto
// vai só ao usuário e o modelo não é chamado. Mesmo portão (comum.js): recusa
// -p e SDK, e qualquer origem que não seja o comando digitado, antes de ler ou
// gravar qualquer coisa. Sem argumento mostra a janela; `<dias> <início>-<fim>`
// grava a chave `janela` do config.json; `off` a remove. O argumento nunca
// volta no texto: só a gramática de lerArgsJanela decide e a resposta sai das
// constantes daqui. Qualquer exceção vira evento 'erro' (falharAberto) e a
// resposta "nada mudado".

const COMANDO = 'hadouken:janela';
const RECUSADO_ENTRYPOINT = 'hadouken: nada mudado. /hadouken:janela só vale digitado numa sessão normal, não em -p nem no SDK.';
const RECUSADO_ORIGEM = 'hadouken: nada mudado. /hadouken:janela só vale digitado pelo usuário.';
const NAO_GRAVADO = 'hadouken: nada mudado. A janela não pôde ser gravada (config.json ilegível ou sem permissão de escrita).';
const SEM_JANELA = 'hadouken: sem janela: ritmo em 168 h.';
const REMOVIDA = 'hadouken: janela removida: ritmo em 168 h.';

async function decidir(entrada, dir) {
  if (entrypointSdk()) return RECUSADO_ENTRYPOINT;
  if (!digitado(entrada)) return RECUSADO_ORIGEM;
  const j = await import('../janela.js');
  const pedido = j.lerArgsJanela(entrada.command_args);
  if (pedido.acao === 'erro') return `hadouken: nada mudado. ${pedido.msg}`;
  if (pedido.acao === 'mostrar') {
    const { janela, aviso } = j.lerJanela(dir);
    if (janela !== null) return `hadouken: janela ${j.descreverJanela(janela)}.`;
    return aviso === null ? SEM_JANELA : `hadouken: ${aviso}.`;
  }
  if (pedido.acao === 'remover') return j.gravarJanela(dir, null).ok ? REMOVIDA : NAO_GRAVADO;
  if (!j.gravarJanela(dir, pedido.valor).ok) return NAO_GRAVADO;
  return `hadouken: janela ${j.descreverJanela(j.validarJanela(pedido.valor).janela)}. O ritmo de 7 dias passa a contar só esse horário.`;
}

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = 'hadouken: nada mudado. Erro interno ao tratar /hadouken:janela.';
  await falharAberto(dir, 'janela', agoraMs, async () => {
    if (dir === null) return;
    reason = await decidir(entrada, dir);
  });
  emitirJson({ decision: 'block', reason });
}, undefined, undefined, 'janela');

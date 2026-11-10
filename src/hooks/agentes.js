import { rodarHook, emitirJson, falharAberto, digitado, entrypointSdk } from './comum.js';
import { dirDados } from '../base.js';

// Hook UserPromptExpansion de /hadouken:agentes (spec v0.6.0 §4, Fatia 4).
// Sempre bloqueia a expansão (decision:block), como /hadouken:janela: o texto
// vai só ao usuário e o modelo não é chamado. Mesmo portão (comum.js): recusa
// -p e SDK, e qualquer origem que não seja o comando digitado, antes de ler ou
// gravar qualquer coisa. Sem argumento mostra a paleta efetiva (uma linha por
// agente); `<agente> <modelo> [effort]`, `<agente> off|on` e `<agente> padrao`
// trocam só agentes.<agente> do config.json. O argumento nunca volta no texto:
// só a gramática de lerArgsAgentes decide e a resposta sai das constantes e da
// paleta daqui. Qualquer exceção vira evento 'erro' (falharAberto) e a resposta
// "nada mudado".

const COMANDO = 'hadouken:agentes';
const RECUSADO_ENTRYPOINT = 'hadouken: nada mudado. /hadouken:agentes só vale digitado numa sessão normal, não em -p nem no SDK.';
const RECUSADO_ORIGEM = 'hadouken: nada mudado. /hadouken:agentes só vale digitado pelo usuário.';
const NAO_GRAVADO = 'hadouken: nada mudado. Os agentes não puderam ser gravados (config.json ilegível ou sem permissão de escrita).';
const VALE = 'Vale nos próximos despachos; o texto do início da sessão só muda na próxima.';

// 'revisor: sonnet·high → opus·high', 'busca: haiku·low', 'auditor: fable·high (desligado)'.
function linhaDe(e, padrao) {
  const atual = `${e.model}·${e.effort}`;
  const base = e.override ? `${padrao.model}·${padrao.effort} → ${atual}` : atual;
  return `${e.nome}: ${base}${e.ativo ? '' : ' (desligado)'}`;
}

async function decidir(entrada, dir) {
  if (entrypointSdk()) return RECUSADO_ENTRYPOINT;
  if (!digitado(entrada)) return RECUSADO_ORIGEM;
  const [c, { PALETA, paletaEfetiva }] = await Promise.all([import('../agentes/config.js'), import('../agentes/paleta.js')]);
  const pedido = c.lerArgsAgentes(entrada.command_args);
  if (pedido.acao === 'erro') return `hadouken: nada mudado. ${pedido.msg}`;
  const tabela = () => {
    const lido = c.lerAgentes(dir);
    return { lido, linhas: paletaEfetiva(lido.agentes).map((e) => linhaDe(e, PALETA.find((p) => p.nome === e.nome))) };
  };
  if (pedido.acao === 'mostrar') {
    const { lido, linhas } = tabela();
    return [...linhas, ...lido.avisos].join('\n');
  }
  const atual = c.lerAgentes(dir).agentes[pedido.nome];
  const gravou = pedido.acao === 'remover'
    ? c.gravarAgente(dir, pedido.nome, null)
    : c.gravarAgente(dir, pedido.nome, c.combinarAgente(atual, pedido.valor));
  if (!gravou.ok) return NAO_GRAVADO;
  const linha = tabela().linhas.find((l) => l.startsWith(`${pedido.nome}:`));
  if (pedido.acao === 'remover') return `hadouken: ${pedido.nome}: padrão (${linha.slice(pedido.nome.length + 2)}). ${VALE}`;
  return `hadouken: ${linha}. ${VALE}`;
}

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = 'hadouken: nada mudado. Erro interno ao tratar /hadouken:agentes.';
  await falharAberto(dir, 'agentes', agoraMs, async () => {
    if (dir === null) return;
    reason = await decidir(entrada, dir);
  });
  emitirJson({ decision: 'block', reason });
}, undefined, undefined, 'agentes');

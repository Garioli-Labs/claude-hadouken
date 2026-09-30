import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';
import { chamaClaude, claudeComLiberar } from '../guarda/caminho.js';

// Hook PreToolUse de Bash e PowerShell com `if: "Bash(claude *)"` e
// `if: "PowerShell(claude *)"` (spec v0.4.0 §4.2 P4, spike S9). Com a guarda
// disparada, nega abrir uma sessão claude filha: uma sessão -p não carrega a
// trava desta conversa na cabeça e poderia despachar à vontade. O hook
// confere o comando de novo (chamaClaude), para uma versão que ignore o `if`.
// Best-effort: npx, node .../cli.js e comandos ofuscados escapam (R1). Erro:
// passa e registra (fail-open visível, §4.5, falharAberto em comum.js).
//
// Regra fixa, antes de tudo (decisão do controlador na revisão da Task 13):
// claude junto com o comando de liberação é negado sempre, disparada ou não,
// com sessão registrada ou não, com a guarda desligada. Uma sessão `claude -p`
// aberta do Bash de uma sessão do VS Code herda
// CLAUDE_CODE_ENTRYPOINT=claude-vscode (C23), e o hook do liberar não a
// recusa pelo entrypoint; negar o lançamento aqui é a defesa. A regra é só
// texto (claudeComLiberar, import estático: não depende de um import dinâmico
// que falhe) e, na dúvida, nega: sem mensagens.js, sai o texto de reserva;
// sem registros.js, o deny sai sem o evento.
// Resíduo: um script fora da ferramenta Bash ou PowerShell (arquivo .sh ou
// .ps1, npm run), o pedido lido de arquivo (claude -p < pedido.txt) e comandos
// ofuscados ainda chegam ao liberar; o `if` do hooks.json (Task 18) decide
// quais lançadores chegam a este hook. SECURITY.md declara (Task 18).

const FERRAMENTAS = new Set(['Bash', 'PowerShell']);
// O mesmo texto de P4_LIBERAR_TEXTO (mensagens.js), só para quando o import
// dele falha. test/guarda-hooks.test.js confere que os dois são iguais.
const P4_LIBERAR_RESERVA = 'hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /claude-hadouken:liberar.';

const negar = (razao) => emitirJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razao } });

// O deny sai primeiro; o evento vem depois e nunca o impede.
async function negarLiberacao() {
  let razao = P4_LIBERAR_RESERVA;
  try {
    const msg = await import('../guarda/mensagens.js');
    if (typeof msg.P4_LIBERAR_TEXTO === 'string') razao = msg.P4_LIBERAR_TEXTO;
  } catch { /* texto de reserva */ }
  negar(razao);
  try {
    const dir = dirDados();
    if (dir !== null) (await import('../guarda/registros.js')).anexarEvento(dir, 'liberacao-recusada', 'P4', Date.now());
  } catch { /* o deny já saiu */ }
}

async function avaliarFilha(tool, dir, sessionId, agoraMs) {
  const [{ avaliarGuarda }, reg, msg] = await Promise.all([
    import('../guarda/avaliar.js'),
    import('../guarda/registros.js'),
    import('../guarda/mensagens.js'),
  ]);
  const g = avaliarGuarda({ dir, agoraMs, sessionId });
  if (g.status === 'erro') {
    reg.anexarEvento(dir, 'erro', 'P4', agoraMs);
    return;
  }
  if (g.ativas.length === 0) return;
  negar(msg.P4_TEXTO);
  reg.anexarEvento(dir, 'filha-negada', tool, agoraMs);
}

rodarHook(async (entrada) => {
  if (entrada === null || !FERRAMENTAS.has(entrada.tool_name)) return;
  const comando = entrada.tool_input?.command;
  if (claudeComLiberar(comando)) {
    await negarLiberacao();
    return;
  }
  if (!chamaClaude(comando)) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  // Depois do gate, toda exceção passa e vira evento 'erro' (§4.5).
  await falharAberto(dir, 'P4', agoraMs, () => avaliarFilha(entrada.tool_name, dir, sessionId, agoraMs));
});

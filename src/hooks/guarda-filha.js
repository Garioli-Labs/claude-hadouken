import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';
import { chamaClaude, claudeComLiberar } from '../guarda/caminho.js';

// Hook PreToolUse de Bash e PowerShell com `if: "Bash(claude *)"` e
// `if: "PowerShell(claude *)"` (spec v0.4.0 §4.2 P4, spike S9) e, por decisão
// do controlador na Task 18, um handler com `if` para cada lançador explícito
// (npx, node, bash, sh, cmd, pwsh, powershell; no PowerShell, Start-Process;
// bash e sh no PowerShell desde o M8 da revisão final da parte 1, para o bash
// do Git ou do WSL), nunca um curinga que traga o git commit. Com a guarda disparada, nega abrir
// uma sessão claude filha: uma sessão -p não carrega a trava desta conversa na
// cabeça e poderia despachar à vontade. O hook confere o comando de novo
// (chamaClaude), para uma versão que ignore o `if`. Best-effort: lançadores
// fora da lista e comandos ofuscados escapam (R1). Erro: passa e registra
// (fail-open visível, §4.5, falharAberto em comum.js).
//
// Regra fixa, antes de tudo (decisão do controlador na revisão da Task 13):
// claude junto com o comando de liberação é negado sempre, disparada ou não,
// com sessão registrada ou não, com a guarda desligada. Uma sessão `claude -p`
// aberta do Bash de uma sessão do VS Code herda
// CLAUDE_CODE_ENTRYPOINT=claude-vscode (C23), e o hook do liberar não a
// recusa pelo entrypoint; negar o lançamento aqui é a defesa. A regra é só
// texto (claudeComLiberar, import estático: não depende de um import dinâmico
// que falhe) e, na dúvida, nega: sem mensagens.js, sai o texto de reserva;
// sem registros.js, o deny sai sem o evento. Desde a rodada 2 da revisão da
// Task 16 a regra é a união de três testes (claudeComLiberar em
// guarda/caminho.js) e também nega o texto que só cita 'hadouken:liberar',
// com ou sem claude; o texto do deny aponta o git commit -F.
// Resíduo: um script fora da ferramenta Bash ou PowerShell (arquivo .sh ou
// .ps1, npm run), o pedido lido de arquivo (claude -p < pedido.txt) e comandos
// ofuscados ainda chegam ao liberar; o `if` do hooks.json decide quais
// lançadores chegam a este hook. SECURITY.md declara (R1).

const FERRAMENTAS = new Set(['Bash', 'PowerShell']);
// Decisão do controlador na rodada 2 da revisão da Task 16: acima de 1 MiB,
// 'liberar' em qualquer lugar do comando nega sem ler. Com o teto comum do
// stdin (1 MiB, spec 8.1, S9) o JSON desse comando nem chegaria aqui e o hook
// passaria calado; a P4 lê mais, até TETO_STDIN.
// Decisão do controlador na Task 18 (Step 0, achado 3 da revisão das rodadas
// 2 a 5): com 16 MiB os dois leitores (claudeComLiberar e chamaClaude)
// somavam 10 a 14 s, acima do timeout de 10 s da P4, e o hook passava. O teto
// cai para 4 MiB (o pior caso medido fica abaixo de 5 s,
// test/guarda-caminho-extra.test.js). Acima dele o comando não é lido: o
// stdin cru segue até o fim (sem acumular, lerStdinVigiando em base.js) e, se
// tiver 'claude' (sem diferenciar maiúsculas) ou 'liberar' em qualquer ponto,
// a P4 nega pela regra fixa; senão, passa (R1) e registra o evento 'erro' P4,
// como quando o prazo de 1 s corta a leitura (M5 da revisão final da parte 1,
// decisão do controlador: passa; rodarHook em comum.js). O stdin do Claude
// Code traz o transcript_path, em geral dentro de ~/.claude, então na prática
// acima de 4 MiB a P4 nega.
const TETO_STDIN = 4 * 1_048_576;
const VIGIA_ACIMA = /claude|liberar/i;
// O mesmo texto de P4_LIBERAR_TEXTO (mensagens.js), só para quando o import
// dele falha. test/guarda-hooks.test.js confere que os dois são iguais.
const P4_LIBERAR_RESERVA = 'hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /hadouken:liberar. Se o texto só cita o comando (numa mensagem de commit, por exemplo), use git commit -F <arquivo>.';

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

rodarHook(async (entrada, leitura) => {
  if (leitura?.casou === true) {
    await negarLiberacao();
    return;
  }
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
}, TETO_STDIN, VIGIA_ACIMA, 'P4');

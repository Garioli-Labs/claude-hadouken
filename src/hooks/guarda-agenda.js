import { rodarHook, emitirJson, avisarLeituraFalha } from './comum.js';
import { dirDados } from '../base.js';
import { pedeLiberacao } from '../guarda/caminho.js';

// Hook PreToolUse de CronCreate|ScheduleWakeup|RemoteTrigger (C1 da revisão
// final da parte 1, defesa em profundidade do liberar) e, desde a Task 0 da
// parte 2, dos schedulers MCP (mcp__ com cron, schedule, trigger ou task no
// nome, sem diferenciar maiúsculas). Uma tarefa agendada
// (CronCreate), a próxima volta de um /loop (ScheduleWakeup) ou uma rotina
// no claude.ai (RemoteTrigger) disparam um prompt sem o usuário digitar; se
// ele pedir a liberação, o modelo se liberaria com uma chamada de ferramenta.
// Negado sempre, disparada ou não, com sessão registrada ou não, com a guarda
// desligada, como a regra fixa da P4 (guarda-filha.js): o texto de algum
// campo da entrada (prompt, reason, o body livre do RemoteTrigger) com o
// pedido (pedeLiberacao em guarda/caminho.js: 'hadouken:liberar' no texto
// normalizado ou '/liberar' como palavra). A decisão é só texto (import
// estático) e, na dúvida, nega: sem mensagens.js, sai o texto de reserva;
// sem registros.js, o deny sai sem o evento 'liberacao-recusada'.
// As outras camadas: o liberar recusa a origem que não é o comando digitado
// (liberar.js) e a skill tem `disable-model-invocation: true`, que a doc
// (scheduled tasks) diz impedir o disparo agendado de rodá-la.
// Resíduo (R1, SECURITY.md): a tarefa durável gravada direto no
// .claude/scheduled_tasks.json (pelo shell ou pelas ferramentas de edição) não
// passa por aqui.

const FERRAMENTAS = new Set(['CronCreate', 'ScheduleWakeup', 'RemoteTrigger']);
// O nome do scheduler MCP, como o matcher de hooks/hooks.json (lá com classes
// de caractere, porque o matcher diferencia maiúsculas). Ancorado no começo:
// linear num tool_name enorme. O evento leva o rótulo fixo 'agenda:mcp',
// nunca o nome que veio do stdin.
const MCP_AGENDA = /^mcp__.*(?:cron|schedule|trigger|task)/i;
const rotuloDe = (nome) => {
  if (FERRAMENTAS.has(nome)) return nome;
  return typeof nome === 'string' && MCP_AGENDA.test(nome) ? 'agenda:mcp' : null;
};
// Acima de 1 MiB de stdin (o teto comum, spec 8.1, S9) o JSON não é lido;
// 'liberar' em qualquer ponto do texto cru nega (lerStdinVigiando em base.js),
// como a vigia da P4.
const VIGIA = /liberar/i;
// O mesmo texto de AGENDA_LIBERAR_TEXTO (mensagens.js), só para quando o
// import dele falha. test/guarda-hooks.test.js confere que os dois são iguais.
const AGENDA_LIBERAR_RESERVA = 'hadouken: bloqueado: uma tarefa agendada, um loop ou uma rotina não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /claude-hadouken:liberar. Se o texto só cita o comando, tire-o do prompt agendado.';

// Todo texto da entrada, a qualquer profundidade, sem recursão: o JSON.parse
// aceita 200 mil níveis de lista, e uma varredura recursiva estouraria a pilha.
function algumTextoPede(valor) {
  const pilha = [valor];
  while (pilha.length > 0) {
    const v = pilha.pop();
    if (typeof v === 'string') {
      if (pedeLiberacao(v)) return true;
    } else if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) pilha.push(v[k]);
    }
  }
  return false;
}

// O deny sai primeiro; o evento vem depois e nunca o impede.
async function negar(detalhe) {
  let razao = AGENDA_LIBERAR_RESERVA;
  try {
    const msg = await import('../guarda/mensagens.js');
    if (typeof msg.AGENDA_LIBERAR_TEXTO === 'string') razao = msg.AGENDA_LIBERAR_TEXTO;
  } catch { /* texto de reserva */ }
  emitirJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razao } });
  try {
    const dir = dirDados();
    if (dir !== null) (await import('../guarda/registros.js')).anexarEvento(dir, 'liberacao-recusada', detalhe, Date.now());
  } catch { /* o deny já saiu */ }
}

// Falha fechada (Task 0 da parte 2): sem JSON legível (truncado, lista,
// texto solto), o texto cru lido do stdin com o pedido de liberação nega. Sem
// o pedido, passa e registra 'erro' agenda (spec v0.4.0 §4.5), só na pasta de
// dados que já existe. A leitura cortada pelo prazo já é registrada pelo
// rodarHook (M5), então não é registrada de novo aqui. Stdin vazio ou só com
// espaços não é erro.
async function semEntrada(leitura) {
  const texto = leitura?.texto;
  if (typeof texto !== 'string' || !/\S/.test(texto)) return;
  if (pedeLiberacao(texto)) {
    await negar('agenda');
    return;
  }
  if (leitura.cortado !== true) await avisarLeituraFalha('agenda');
}

rodarHook(async (entrada, leitura) => {
  if (leitura?.casou === true) {
    await negar('agenda');
    return;
  }
  if (entrada === null) {
    await semEntrada(leitura);
    return;
  }
  const rotulo = rotuloDe(entrada.tool_name);
  if (rotulo === null) return;
  let pede;
  try {
    pede = algumTextoPede(entrada.tool_input);
  } catch {
    pede = true;
  }
  if (pede) await negar(rotulo);
}, undefined, VIGIA, 'agenda');

import fs from 'node:fs';
import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';

// Hook ConfigChange (Task 19b, spike S13 (a) da Task 2 da parte 2; decisão do
// Sr. Garioli em 2026-10-01). Segura, na sessão em curso, a mudança de
// disableAllHooks, enabledPlugins ou hooks nos settings feita fora da P5: o
// sed -i (ou qualquer escrita pelo shell, ou do próprio usuário) em
// .claude/settings.json, que a P5 não vê (R1, SECURITY.md). O S13 mediu, no
// Claude Code 2.1.287 do Windows: toda escrita externa em
// <cwd>/.claude/settings.json dispara o ConfigChange cerca de 1 s depois, com
// cwd, file_path (absoluto), hook_event_name, prompt_id, session_id, source e
// transcript_path, sem o conteúdo velho nem o novo; e
// {"decision":"block","reason":...} segura a mudança (os hooks seguiram
// rodando depois de disableAllHooks true, do plugin em false no
// enabledPlugins e de hooks: {}). O arquivo no disco fica mudado; a próxima
// sessão o lê.
// Ordem:
// 1. Sem a pasta de dados, passa calado: nenhuma sessão foi registrada (o
//    registro mora em <dirDados>/ativas), e um evento a criaria (a mesma regra
//    de avisarLeituraFalha em comum.js).
// 2. source fora de ORIGENS (config-base.js, a única lista; fix round 2, M4):
//    passa.
// 3. Sem session_id válido (fix round 2, M2): não há gate nem fotografia de
//    sessão. Nos settings do projeto (ORIGENS_DO_PROJETO), falha fechada:
//    bloqueia com o detalhe 'sem-sessao'. No do usuário, passa e registra
//    'erro' P5:config-sessao. Vem antes do gate porque o gate (sessaoAtiva)
//    devolve false para um id inválido, e o caso passaria calado.
// 4. Gate de sessão (como P1 a P4; a P5 nega sem ele): sessão não registrada
//    passa sem saída. A fotografia só existe para as sessões que o
//    SessionStart registrou; sem o gate, numa sessão que o plugin não guarda,
//    toda mudança do usuário num settings com enabledPlugins seria comparada
//    com o arquivo ausente e bloqueada.
// 5. A decisão (decisaoConfig em guarda/config-base.js) compara a impressão
//    atual dos três campos com a fotografia que o primeiro SessionStart desta
//    sessão tirou (a do session_id do stdin; a de outra sessão nunca vale, fix
//    round 1). Diferente: bloqueia com CONFIG_BLOQUEADA_TEXTO e o evento
//    'config-bloqueada' (o primeiro campo que mudou, 'ilegivel' ou
//    'sem-caminho'); igual, ou mudança só em outros campos: passa sem saída.
//    A impressão atual ilegível sempre bloqueia, mesmo com a fotografia também
//    ilegível (fix round 2, M1): um settings em JSONC que o Claude Code aceite
//    não pode esconder um disableAllHooks.
// Exceção inesperada depois do passo 1: passa e registra 'erro' P5:config
// (fail-open visível, §4.5, falharAberto em comum.js). O bloqueio sai antes
// do evento, e o evento nunca o impede. Sem rede e sem child_process (S24).

function pastaExiste(dir) {
  try {
    return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

async function bloquear(dir, detalhe, agoraMs) {
  const msg = await import('../guarda/mensagens.js');
  emitirJson({ decision: 'block', reason: msg.CONFIG_BLOQUEADA_TEXTO });
  try {
    (await import('../guarda/registros.js')).anexarEvento(dir, 'config-bloqueada', detalhe, agoraMs);
  } catch { /* o bloqueio já saiu */ }
}

rodarHook(async (entrada) => {
  if (entrada === null) return;
  const dir = dirDados();
  if (dir === null || !pastaExiste(dir)) return;
  const agoraMs = Date.now();
  await falharAberto(dir, 'P5:config', agoraMs, async () => {
    const cfg = await import('../guarda/config-base.js');
    if (!cfg.ORIGENS.includes(entrada.source)) return;
    const sessionId = entrada.session_id;
    if (!idValido(sessionId)) {
      if (cfg.ORIGENS_DO_PROJETO.includes(entrada.source)) await bloquear(dir, 'sem-sessao', agoraMs);
      else (await import('../guarda/registros.js')).anexarEvento(dir, 'erro', 'P5:config-sessao', agoraMs);
      return;
    }
    if (!sessaoAtiva(sessionId, agoraMs)) return;
    const detalhe = cfg.decisaoConfig(dir, sessionId, entrada.source, entrada.file_path, agoraMs);
    if (detalhe !== null) await bloquear(dir, detalhe, agoraMs);
  });
}, undefined, undefined, 'P5:config');

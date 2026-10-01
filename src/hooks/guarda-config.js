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
// A decisão (decisaoConfig em guarda/config-base.js) compara a impressão
// atual dos três campos com a fotografia que o SessionStart tirou:
// - source fora de user_settings, project_settings e local_settings: passa;
// - diferente: bloqueia com CONFIG_BLOQUEADA_TEXTO e o evento
//   'config-bloqueada' (o primeiro campo que mudou, 'ilegivel' ou
//   'sem-caminho'); igual, ou mudança só em outros campos: passa sem saída.
// Gate de sessão (como P1 a P4; a P5 nega sem ele): sessão não registrada ou
// session_id inválido passa sem saída. A fotografia só existe para as sessões
// que o SessionStart registrou; sem o gate, numa sessão que o plugin não
// guarda, toda mudança do usuário num settings com enabledPlugins seria
// comparada com o arquivo ausente e bloqueada.
// Exceção inesperada depois do gate: passa e registra 'erro' P5:config
// (fail-open visível, §4.5, falharAberto em comum.js). O bloqueio sai antes
// do evento, e o evento nunca o impede. Sem rede e sem child_process (S24).

const ORIGENS = new Set(['user_settings', 'project_settings', 'local_settings']);

rodarHook(async (entrada) => {
  if (entrada === null || !ORIGENS.has(entrada.source)) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  await falharAberto(dir, 'P5:config', agoraMs, async () => {
    const [cfg, msg] = await Promise.all([import('../guarda/config-base.js'), import('../guarda/mensagens.js')]);
    const detalhe = cfg.decisaoConfig(dir, entrada.source, entrada.file_path, agoraMs);
    if (detalhe === null) return;
    emitirJson({ decision: 'block', reason: msg.CONFIG_BLOQUEADA_TEXTO });
    try {
      (await import('../guarda/registros.js')).anexarEvento(dir, 'config-bloqueada', detalhe, agoraMs);
    } catch { /* o bloqueio já saiu */ }
  });
}, undefined, undefined, 'P5:config');

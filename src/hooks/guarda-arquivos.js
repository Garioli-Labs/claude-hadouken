import os from 'node:os';
import path from 'node:path';
import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados } from '../base.js';

// Hook PreToolUse de Write, Edit, MultiEdit e NotebookEdit, cada um com os
// seus `if` (spec v0.4.0 §4.2 P5, S13; spike S9: o `if` segue o nome da
// ferramenta, então há handlers por ferramenta). Nega sempre, disparada ou
// não, com sessão registrada ou não:
// - a pasta de dados (P5_TEXTO): as ferramentas de edição do Claude não têm
//   motivo para gravar ali, e o usuário edita o config.json no editor dele;
// - desde a Task 0 da parte 2 (arquivoProtegido em guarda/caminho.js), os
//   settings do usuário (~/.claude e CLAUDE_CONFIG_DIR) e o próprio plugin
//   (P5_PROTEGIDO_TEXTO, eventos 'P5:settings' e 'P5:plugin'): um
//   disableAllHooks ou um avaliar.js editado desligaria a guarda sem shell;
// - nos settings de projeto, só o Write, o Edit e o MultiEdit cujo texto novo
//   mexe nos hooks ou nos plugins (mexeNaGuarda, decisão do controlador;
//   P5_SETTINGS_PROJETO_TEXTO, evento 'P5:settings-projeto').
// O caminho real (caminhoReal) desfaz '..', links e o nome 8.3. O `if` não
// casa o nome 8.3, um HADOUKEN_HOME fora de ~/.claude/hadouken, um
// CLAUDE_CONFIG_DIR fora de ~/.claude nem a raiz de um plugin fora de
// ~/.claude/plugins (R1). Exceção depois de ter a pasta de dados: passa e
// registra 'erro' P5 (fail-open visível, §4.5, falharAberto em comum.js).

const FERRAMENTAS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// As que trazem o texto novo (content, new_string, edits[].new_string).
const COM_TEXTO = new Set(['Write', 'Edit', 'MultiEdit']);

// O alvo como caminho absoluto (rodada 1 da revisão da Task 16): '~', '~/'
// e '~\' viram a casa do usuário, e um caminho relativo se resolve no cwd da
// entrada, ou no do processo quando ela não traz um cwd absoluto. As
// ferramentas pedem caminho absoluto, mas a P5 não conta com isso: sem esta
// etapa, '~/.claude/hadouken/liberacao.json' e '../.claude/hadouken/x'
// passavam. '~outro/...' não é expandido (fica relativo ao cwd).
function alvoAbsoluto(bruto, cwd) {
  if (typeof bruto !== 'string' || bruto.length === 0) return null;
  if (bruto === '~' || bruto.startsWith('~/') || bruto.startsWith('~\\')) return path.join(os.homedir(), bruto.slice(1));
  if (path.isAbsolute(bruto)) return bruto;
  return path.resolve(typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : process.cwd(), bruto);
}

rodarHook(async (entrada) => {
  if (entrada === null || !FERRAMENTAS.has(entrada.tool_name)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  await falharAberto(dir, 'P5', agoraMs, async () => {
    const alvo = alvoAbsoluto(entrada.tool_input?.file_path ?? entrada.tool_input?.notebook_path, entrada.cwd);
    const caminho = await import('../guarda/caminho.js');
    let texto = 'P5_TEXTO';
    let detalhe = entrada.tool_name;
    if (!caminho.dentroDe(dir, alvo)) {
      const classe = caminho.arquivoProtegido(alvo, { casa: os.homedir(), configDir: process.env.CLAUDE_CONFIG_DIR, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT });
      if (classe === null) return;
      if (classe === 'settings-projeto') {
        if (!COM_TEXTO.has(entrada.tool_name) || !caminho.mexeNaGuarda(entrada.tool_input)) return;
        texto = 'P5_SETTINGS_PROJETO_TEXTO';
      } else {
        texto = 'P5_PROTEGIDO_TEXTO';
      }
      detalhe = `P5:${classe}`;
    }
    const [reg, msg] = await Promise.all([import('../guarda/registros.js'), import('../guarda/mensagens.js')]);
    emitirJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: msg[texto] } });
    reg.anexarEvento(dir, 'arquivo-negado', detalhe, agoraMs);
  });
}, undefined, undefined, 'P5');

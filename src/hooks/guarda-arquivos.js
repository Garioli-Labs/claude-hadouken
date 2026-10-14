import os from 'node:os';
import path from 'node:path';
import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados } from '../base.js';
// Só comum.js e base.js entram estáticos: um deles que não carrega derruba o
// processo com código 1, e o Claude Code trata essa saída como erro que não
// bloqueia (R2, SECURITY.md). arquivo.js entra por import dinâmico, só no
// ramo dos settings de projeto, e falha fechado (rodada 4 da revisão da Task
// 0): ver negar e o ramo 'settings-projeto' abaixo.

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
// - nos settings de projeto, só o Write, o Edit e o MultiEdit que mexem nos
//   hooks ou nos plugins pelo texto novo ou antigo, ou, com old_string curto
//   ou Write, pelo arquivo atual, ou cuja simulação no arquivo atual muda
//   disableAllHooks, enabledPlugins ou hooks (mexeNaGuarda, decisão do
//   controlador e rodadas 1 e 2 da revisão; P5_SETTINGS_PROJETO_TEXTO, evento
//   'P5:settings-projeto').
// O caminho real (caminhoReal) desfaz '..', links, o nome 8.3 e o
// compartilhamento administrativo da própria máquina (\\localhost\C$). O `if` não
// casa o nome 8.3, um HADOUKEN_HOME fora de ~/.claude/hadouken, um
// CLAUDE_CONFIG_DIR fora de ~/.claude nem a raiz de um plugin fora de
// ~/.claude/plugins (R1). Exceção depois de ter a pasta de dados: passa e
// registra 'erro' P5 (fail-open visível, §4.5, falharAberto em comum.js).
// A decisão do caminho (caminho.js, só módulos do node) não depende de
// arquivo.js. Se arquivo.js (ou o que ele importa) não carrega, os settings de
// projeto são negados sem conferir a mudança, com o 'erro' 'P5:arquivo.js', e
// a pasta de dados, os settings do usuário e o plugin seguem negados: o deny
// sai antes do import de registros.js, que importa arquivo.js.

const FERRAMENTAS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// As que trazem o texto novo (content, new_string, edits[].new_string).
const COM_TEXTO = new Set(['Write', 'Edit', 'MultiEdit']);
// Teto da leitura do settings de projeto atual (rodada 1 da revisão da Task
// 0): o mesmo 1 MiB do stdin. Acima dele, a leitura falha e a P5 nega.
const TETO_SETTINGS = 1_048_576;
// Stdin acima de 1 MiB (o teto comum, spec 8.1, S9; rodada 3 da revisão da
// Task 0): o JSON não é lido. Como a P4, 'settings' ou 'hadouken' em qualquer
// ponto do texto cru, sem diferenciar maiúsculas, nega (lerStdinVigiando em
// base.js; evento 'P5:grande'); senão, passa e registra o 'erro' P5 (rodarHook
// em comum.js, R2). 'hadouken' cobre o claude-hadouken do plugin e também a
// pasta de dados padrão (~/.claude/hadouken), que não tem 'claude-hadouken'.
const VIGIA_ACIMA = /settings|hadouken/i;
// O mesmo texto de P5_GRANDE_TEXTO (mensagens.js), só para quando o import
// dele falha. test/guarda-hooks.test.js confere que os dois são iguais.
const P5_GRANDE_RESERVA = 'hadouken: bloqueado: esta edição passa de 1 MiB e cita settings ou o hadouken; grande assim, o hadouken não a confere. Divida a edição em partes menores.';
// O mesmo texto de P5_PROTEGIDO_TEXTO (mensagens.js), para toda outra negação
// da P5 quando o import de mensagens.js falha (rodada 4 da revisão da Task 0:
// um util.js quebrado derruba mensagens.js e arquivo.js juntos).
// test/guarda-hooks.test.js confere que os dois são iguais.
const P5_PROTEGIDO_RESERVA = 'hadouken: bloqueado: o hadouken não deixa o Claude editar este arquivo (settings do Claude Code ou o próprio plugin). Mostre a mudança na conversa; o usuário a aplica à mão.';

// Toda negação da P5. O deny sai primeiro, com o texto fixo de mensagens.js
// (chave) ou, se ele não carrega, o de reserva; o evento vem depois e nunca o
// impede. registros.js importa arquivo.js: com arquivo.js quebrado, o deny sai
// sem evento (R2). Nunca lança.
async function negar(chave, reserva, dir, tipo, detalhe, agoraMs) {
  let razao = reserva;
  try {
    const msg = await import('../guarda/mensagens.js');
    if (typeof msg[chave] === 'string') razao = msg[chave];
  } catch { /* texto de reserva */ }
  emitirJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razao } });
  try {
    if (dir !== null) (await import('../guarda/registros.js')).anexarEvento(dir, tipo, detalhe, agoraMs);
  } catch { /* o deny já saiu */ }
}

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

rodarHook(async (entrada, leitura) => {
  if (leitura?.casou === true) {
    await negar('P5_GRANDE_TEXTO', P5_GRANDE_RESERVA, dirDados(), 'arquivo-negado', 'P5:grande', Date.now());
    return;
  }
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
        if (!COM_TEXTO.has(entrada.tool_name)) return;
        // Falha fechado: sem arquivo.js não há como ler o arquivo atual, então
        // a edição nem é conferida (rodada 4 da revisão da Task 0).
        let arquivo;
        try {
          arquivo = await import('../guarda/arquivo.js');
        } catch {
          await negar('P5_PROTEGIDO_TEXTO', P5_PROTEGIDO_RESERVA, dir, 'erro', 'P5:arquivo.js', agoraMs);
          return;
        }
        if (!caminho.mexeNaGuarda(entrada.tool_input, () => arquivo.lerTextoSemLink(alvo, TETO_SETTINGS), entrada.tool_name)) return;
        texto = 'P5_SETTINGS_PROJETO_TEXTO';
      } else {
        texto = 'P5_PROTEGIDO_TEXTO';
      }
      detalhe = `P5:${classe}`;
    }
    await negar(texto, P5_PROTEGIDO_RESERVA, dir, 'arquivo-negado', detalhe, agoraMs);
  });
}, undefined, VIGIA_ACIMA, 'P5');

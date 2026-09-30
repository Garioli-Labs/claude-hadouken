import os from 'node:os';
import path from 'node:path';
import { rodarHook, emitirJson, falharAberto } from './comum.js';
import { dirDados } from '../base.js';

// Hook PreToolUse de Write, Edit, MultiEdit e NotebookEdit, cada um com o seu
// `if` na pasta de dados (spec v0.4.0 §4.2 P5, S13; spike S9: o `if` segue o
// nome da ferramenta, então são quatro handlers). Nega sempre, disparada ou
// não: as ferramentas de edição do Claude não têm motivo para gravar ali, e o
// usuário edita o config.json no editor dele. Sem o gate de sessão ativa: a
// proteção vale em toda sessão com os hooks da v0.4.0. O caminho real
// (caminhoReal) desfaz '..', links e o nome 8.3; o `if` não casa o nome 8.3
// nem um HADOUKEN_HOME fora de ~/.claude/hadouken (R1). Exceção depois de ter
// a pasta de dados: passa e registra 'erro' P5 (fail-open visível, §4.5,
// falharAberto em comum.js).

const FERRAMENTAS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

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
    const { dentroDe } = await import('../guarda/caminho.js');
    if (!dentroDe(dir, alvo)) return;
    const [reg, msg] = await Promise.all([import('../guarda/registros.js'), import('../guarda/mensagens.js')]);
    emitirJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: msg.P5_TEXTO } });
    reg.anexarEvento(dir, 'arquivo-negado', entrada.tool_name, agoraMs);
  });
}, undefined, undefined, 'P5');

import path from 'node:path';
import { rodarHook, emitirContexto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { registrarSessao } from '../ativas.js';

// Hook SessionStart (spec 6.5, 8.2 e adendo A/B da Task 7). Roda em toda
// origem (startup, resume, clear, compact e qualquer outra), sem matcher:
// 1. registra a sessão em <dirDados>/ativas/, o que liga a barra e os alertas
//    para ela (o gate de ativação);
// 2. sincroniza os shims estáveis de <dirDados>/bin/ com a versão do plugin
//    em uso (CLAUDE_PLUGIN_ROOT);
// 3. injeta uma linha com o consumo atual, mais uma linha fixa para cada
//    passo anterior que falhou.
// session_id ausente ou inválido, ou sem diretório de dados: nenhum registro,
// nenhuma linha, nenhuma escrita.
//
// Texto injetado (spec 8.1, S1): só números validados, horários formatados e
// rótulos fixos de linha-estado.js. Nada de estado.json, do stdin, do
// ambiente ou de um motivo de erro entra como texto.

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  const registro = registrarSessao(sessionId, agoraMs);
  const [{ sincronizarShims }, { ARQ_ESTADO, lerJson, validarEstado, limitesValidos }, linhas] = await Promise.all([
    import('../shim.js'),
    import('../estado.js'),
    import('./linha-estado.js'),
  ]);
  const shims = sincronizarShims(process.env.CLAUDE_PLUGIN_ROOT);
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  const estado = lido.ok ? validarEstado(lido.valor, agoraMs) : null;
  const saida = [linhas.linhaEstado(limitesValidos(estado, agoraMs), agoraMs)];
  if (!registro.ok) saida.push(linhas.linhaSemRegistro(registro.motivo));
  if (!shims.ok) saida.push(linhas.linhaShimIndisponivel(shims.motivo));
  emitirContexto('SessionStart', saida.join('\n'));
});

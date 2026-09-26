import { join } from 'node:path';
import { rodarHook, emitirContexto } from './comum.js';
import { dirDados } from '../base.js';
import { sessaoAtiva, renovarSessao } from '../ativas.js';

// Hook UserPromptSubmit (spec 6.5, 8.2 e adendo A/C/D/E da Task 7): a cada
// prompt, compara o consumo atual com a última faixa anunciada e injeta uma
// linha só quando a faixa muda (alerta.js), ou "sem leitura" uma vez por
// sessão. Nunca bloqueia o prompt.
//
// Roda em toda sessão aberta, registrada ou não, então o caminho até o gate
// carrega o mínimo: comum.js (stdin), base.js e ativas.js. Sessão sem
// registro ativo não imprime nem grava nada. estado.js, alerta.js e a memória
// de alertas vêm por import dinâmico depois do gate (adendo E).
//
// Texto injetado (spec 8.1, S1): só as linhas de alerta.js, feitas de números
// validados, horários formatados e rótulos fixos.

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (dirDados() === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  renovarSessao(sessionId, agoraMs);
  const [
    { ARQ_ESTADO, lerJson, validarEstado, limitesValidos, gravarJsonAtomico },
    { avaliarAlertas },
    { ARQ_ALERTAS, ALERTAS_MAX_BYTES, alertasGuardados, alertasParaGravar },
  ] = await Promise.all([
    import('../estado.js'),
    import('../alerta.js'),
    import('./alertas-gravados.js'),
  ]);
  const dir = dirDados();
  if (dir === null) return;
  const lidoEstado = lerJson(join(dir, ARQ_ESTADO));
  const estado = lidoEstado.ok ? validarEstado(lidoEstado.valor, agoraMs) : null;
  const limites = limitesValidos(estado, agoraMs);
  const arqAlertas = join(dir, ARQ_ALERTAS);
  const lidoAlertas = lerJson(arqAlertas, ALERTAS_MAX_BYTES);
  const { anteriores, atMs } = alertasGuardados(lidoAlertas.ok ? lidoAlertas.valor : null, agoraMs);
  const { linhas, novos } = avaliarAlertas({ limites, anteriores, sessionId, agoraMs });
  // `at` só anda quando a memória foi conferida contra uma leitura válida
  // (decisão D): sem leitura, fica o at lido.
  gravarJsonAtomico(arqAlertas, alertasParaGravar(novos, limites ? agoraMs : atMs));
  emitirContexto('UserPromptSubmit', linhas.join('\n'));
});

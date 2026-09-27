import { join } from 'node:path';
import { rodarHook, emitirContexto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva, renovarSessao } from '../ativas.js';

// Hook UserPromptSubmit (spec 6.5, 8.2 e adendo A/C/D/E da Task 7): a cada
// prompt, compara o consumo atual com a última faixa anunciada e injeta uma
// linha só quando a faixa muda (alerta.js), ou "sem leitura" uma vez por
// sessão. Spec v0.2.0 §12 (avisos ao Claude): com a previsão de estouro do
// histórico do estado (previsao.js) e as sessões ativas, também o aviso de
// projeção. Nunca bloqueia o prompt.
//
// Roda em toda sessão aberta, registrada ou não, então o caminho até o gate
// carrega o mínimo: comum.js (stdin), base.js e ativas.js. Sessão sem
// registro ativo não imprime nem grava nada. estado.js, alerta.js, previsao.js
// e a memória de alertas vêm por import dinâmico depois do gate (adendo E).
//
// Texto injetado (spec 8.1, S1): só as linhas de alerta.js, feitas de números
// validados, horários formatados e rótulos fixos. O session_id passa por
// idValido aqui mesmo, antes de qualquer uso (M1 da revisão da Task 7), sem
// depender da checagem interna de ativas.js.
//
// alertas.json só é regravado quando a memória muda ou quando o `at` guardado
// tem 5 min ou mais (precisaGravar, M2): o prompt comum não cria arquivo nem
// renomeia nada.

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  if (dirDados() === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  renovarSessao(sessionId, agoraMs);
  const [
    { ARQ_ESTADO, lerJson, validarEstado, limitesValidos, gravarJsonAtomico, sessoesAtivas },
    { avaliarAlertas },
    { ARQ_ALERTAS, ALERTAS_MAX_BYTES, alertasGuardados, alertasParaGravar, precisaGravar },
    { preverEstouro },
  ] = await Promise.all([
    import('../estado.js'),
    import('../alerta.js'),
    import('./alertas-gravados.js'),
    import('../previsao.js'),
  ]);
  const dir = dirDados();
  if (dir === null) return;
  const lidoEstado = lerJson(join(dir, ARQ_ESTADO));
  const estado = lidoEstado.ok ? validarEstado(lidoEstado.valor, agoraMs) : null;
  const limites = limitesValidos(estado, agoraMs);
  const previsao = preverEstouro({ historico: estado?.historico, limites, agoraMs });
  const ativas = sessoesAtivas(estado, agoraMs, sessionId);
  const arqAlertas = join(dir, ARQ_ALERTAS);
  const lidoAlertas = lerJson(arqAlertas, ALERTAS_MAX_BYTES);
  const guardado = lidoAlertas.ok ? lidoAlertas.valor : null;
  const { anteriores, atMs } = alertasGuardados(guardado, agoraMs);
  const { linhas, novos } = avaliarAlertas({ limites, anteriores, sessionId, agoraMs, previsao, sessoesAtivas: ativas });
  // `at` só anda quando a memória foi conferida contra uma leitura válida
  // (decisão D): sem leitura, fica o at lido.
  const registro = alertasParaGravar(novos, limites ? agoraMs : atMs);
  if (precisaGravar(registro, guardado, agoraMs)) gravarJsonAtomico(arqAlertas, registro);
  emitirContexto('UserPromptSubmit', linhas.join('\n'));
});

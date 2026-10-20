import { join } from 'node:path';
import { rodarHook, emitirContexto, emitirJson, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva, renovarSessao } from '../ativas.js';

// Hook UserPromptSubmit (spec 6.5, 8.2 e adendo A/C/D/E da Task 7): a cada
// prompt, compara o consumo atual com a última faixa anunciada e injeta uma
// linha só quando a faixa muda (alerta.js), ou "sem leitura" uma vez por
// sessão. Spec v0.2.0 §12 (avisos ao Claude): com a previsão de estouro do
// histórico do estado (previsao.js) e as sessões ativas, também o aviso de
// projeção. Desde a v0.4.0, bloqueia o prompt digitado numa sessão Fable com
// a guarda disparada (P2, src/guarda/prompt.js).
//
// Roda em toda sessão aberta, registrada ou não, então o caminho até o gate
// carrega o mínimo: comum.js (stdin), base.js e ativas.js. Sessão sem
// registro ativo não imprime nem grava nada. estado.js, alerta.js, previsao.js
// e a memória de alertas vêm por import dinâmico depois do gate (adendo E),
// como aprendizado/arquivos.js e, só com o aprendizado ligado, registro.js.
//
// Texto injetado (spec 8.1, S1): só as linhas de alerta.js, feitas de números
// validados, horários formatados e rótulos fixos. O session_id passa por
// idValido aqui mesmo, antes de qualquer uso (M1 da revisão da Task 7), sem
// depender da checagem interna de ativas.js.
//
// alertas.json só é regravado quando a memória muda ou quando o `at` guardado
// tem 5 min ou mais (precisaGravar, M2): o prompt comum não cria arquivo nem
// renomeia nada. A memória do aviso de projeção mora em projecao.json, fora
// de alertas.json, que fica no formato exato da v0.1.0 para o hook da v0.1.0
// de uma sessão aberta antes da atualização aceitar tudo o que este grava
// (hooks/alertas-gravados.js); projecao.json só é criado ou regravado quando
// a memória de projeção muda (precisaGravarProjecao).

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  if (dirDados() === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  renovarSessao(sessionId, agoraMs);
  // Spec v0.4.0 §4.2 P2: a guarda decide antes dos alertas. Prompt
  // bloqueado não recebe linha nenhuma (o reason vai só ao usuário). Uma
  // exceção fora de decidirPrompt (o import, por exemplo) também passa e
  // registra o evento 'erro' P2 (falharAberto, §4.5).
  let p2 = { bloquear: null, linha: null };
  await falharAberto(dirDados(), 'P2', agoraMs, async () => {
    const { decidirPrompt } = await import('../guarda/prompt.js');
    p2 = decidirPrompt({ dir: dirDados(), sessionId, prompt: entrada.prompt, agoraMs });
  });
  if (p2.bloquear !== null) {
    emitirJson({ decision: 'block', reason: p2.bloquear });
    return;
  }
  const [
    { ARQ_ESTADO, lerJson, validarEstado, limitesValidos, leiturasComPiso, ultimaLeitura, gravarJsonAtomico, sessoesAtivas },
    { avaliarAlertas },
    {
      ARQ_ALERTAS, ALERTAS_MAX_BYTES, alertasGuardados, alertasParaGravar, precisaGravar,
      ARQ_PROJECAO, projecaoGuardada, projecaoParaGravar, precisaGravarProjecao,
    },
    { preverEstouro, ritmo7dPorHora },
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
  // Spec v0.4.0 §10, item 1: as faixas usam a leitura fresca ou o piso de até
  // 24 h; sem os dois, a linha diz desde quando não há leitura.
  const leituras = leiturasComPiso(estado, agoraMs);
  const ultima = ultimaLeitura(estado, agoraMs);
  const temLeitura = leituras.five_hour !== null || leituras.seven_day !== null;
  // Spec aprendizado §4.3 e R10: com o aprendizado ligado e peso > 0, a
  // previsão das linhas de alerta mistura o ritmo típico da hora. A guarda
  // (src/guarda/avaliar.js) segue com a regressão pura. Desligado, nada do
  // aprendizado é carregado além do módulo leve de nomes.
  let perfil = null;
  try {
    const { ligadoExiste } = await import('../aprendizado/arquivos.js');
    if (ligadoExiste(dir)) perfil = (await import('../aprendizado/registro.js')).perfilDaPrevisao(dir, agoraMs);
  } catch {
    perfil = null;
  }
  const previsao = preverEstouro({ historico: estado?.historico, limites, agoraMs, perfil });
  const ativas = sessoesAtivas(estado, agoraMs, sessionId);
  const arqAlertas = join(dir, ARQ_ALERTAS);
  const lidoAlertas = lerJson(arqAlertas, ALERTAS_MAX_BYTES);
  const guardado = lidoAlertas.ok ? lidoAlertas.valor : null;
  const { anteriores, atMs } = alertasGuardados(guardado, agoraMs);
  const arqProjecao = join(dir, ARQ_PROJECAO);
  const lidoProjecao = lerJson(arqProjecao, ALERTAS_MAX_BYTES);
  const projecaoLida = lidoProjecao.ok ? lidoProjecao.valor : null;
  const { linhas, novos } = avaliarAlertas({
    limites, leituras, ultima, anteriores: { ...anteriores, projecao: projecaoGuardada(projecaoLida) }, sessionId, agoraMs,
    previsao,
    ritmo7dH: ritmo7dPorHora({ historico: estado?.historico, agoraMs }),
    sessoesAtivas: ativas,
  });
  // `at` só anda quando a memória foi conferida contra uma leitura (decisão
  // D), fresca ou piso (spec v0.4.0 §10, item 1): com só o piso, a memória
  // precisa andar, senão alertasGuardados a esquece depois de 1 h e a faixa
  // volta a cada prompt. Sem leitura nenhuma, fica o at lido.
  const registro = alertasParaGravar(novos, temLeitura ? agoraMs : atMs);
  if (precisaGravar(registro, guardado, agoraMs)) gravarJsonAtomico(arqAlertas, registro);
  const registroProjecao = projecaoParaGravar(novos.projecao);
  if (precisaGravarProjecao(registroProjecao, projecaoLida)) gravarJsonAtomico(arqProjecao, registroProjecao);
  // Spec roteamento §7 e §9: uma sugestão por 30 min (fila), sem modelo.
  // Toda falha só tira a linha.
  let linhaRoteamento = null;
  try {
    const { config } = (await import('../roteamento/config.js')).lerConfigRoteamento(dir);
    const s = estado?.sessoes?.[sessionId] ?? null;
    if (typeof entrada.transcript_path === 'string' && (config.sugerirSessao || Object.values(config.otimizacoes).some(Boolean))) {
      const [{ lerTrecho }, { sugerirSessao }, { otimizacoesDaSessao }, { escolher }] = await Promise.all([
        import('../roteamento/trecho.js'), import('../roteamento/sessao.js'), import('../roteamento/otimizacoes.js'), import('../roteamento/fila.js'),
      ]);
      const respostas = await lerTrecho(entrada.transcript_path, {});
      const candidatas = [
        ...(config.sugerirSessao ? [sugerirSessao({ respostas, modelo: s?.model ?? null, effort: s?.effort ?? null })].filter(Boolean) : []),
        ...otimizacoesDaSessao({ respostas, sessaoEstado: s, faixas: undefined, otimizacoes: config.otimizacoes, agoraMs }),
      ];
      linhaRoteamento = escolher({ dir, sessionId, candidatas, agoraMs })?.linha ?? null;
    }
  } catch { /* sem sugestão neste prompt */ }
  const todas = [...linhas, p2.linha, linhaRoteamento].filter((x) => typeof x === 'string' && x.length > 0);
  emitirContexto('UserPromptSubmit', todas.join('\n'));
}, undefined, undefined, 'P2');

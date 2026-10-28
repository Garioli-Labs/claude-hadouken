import path from 'node:path';
import { ARQ_ESTADO, lerJson, validarEstado, limitesValidos, leiturasComPiso } from '../estado.js';
import { numeroFinito } from '../base.js';
import { preverEstouro } from '../previsao.js';
import { lerUso } from '../uso/ler-uso.js';
import { lerConfigGuarda, PADRAO_GUARDA } from './config.js';
import { avaliarGatilhos } from './gatilhos.js';
import { CHAVES_TRAVA, lerTravas, gravarTravas, unirTravas, limparTravas } from './travas.js';
import { lerLiberacao, coberturaAtual } from './liberacao.js';
import { despachosFableRecentes, ultimoLimiteFable, modeloDaSessao, anexarEvento } from './registros.js';

// Avaliador central da guarda (spec v0.4.0 §4.1, §4.5 e §5.3). Síncrono, só
// arquivos pequenos. Disparo coberto pela liberação ativa não é gravado: ao
// fim dela, a avaliação seguinte trava de novo se a condição ainda valer.
// guarda.json ilegível entra como a trava 'ilegivel' (fail-closed). Qualquer
// exceção dá status 'erro', e quem chama deixa passar e registra (§4.5).
// As travas saem sempre da união do arquivo com os gatilhos de agora: apagar
// guarda.json não solta a trava que a condição ainda sustenta.

export const CHAVES_MOTIVO = Object.freeze(['ilegivel', 'seven_day', 'five_hour', 'fable', 'fable-despachos']);

const vazia = (status, config = PADRAO_GUARDA) => ({
  status, ativas: [], motivos: [], cobertura: { ativa: false, solta: new Set(), fim: null }, liberacao: null,
  config, leituras: { five_hour: null, seven_day: null }, despachosFable: [], modeloSessao: null, usoFable: null,
});

// Emenda E7: a janela do Fable gravada pelo painel, com a idade da leitura.
// Avaliacao.usoFable: { pct, resetsAtMs, idadeMs } | null, de qualquer
// idade; o frescor é decidido em gatilhos.js e na barra (mensagens.js).
function fableOficial(uso, agoraMs) {
  const f = uso?.modelos?.fable;
  const lidoMs = typeof uso?.lidoEm === 'string' ? Date.parse(uso.lidoEm) : Number.NaN;
  if (!f || !numeroFinito(lidoMs)) return null;
  return { pct: f.pct, resetsAtMs: f.resetsAtMs, idadeMs: Math.max(0, agoraMs - lidoMs) };
}

// O modelo da sessão no estado.json (o display_name que a barra grava), para
// quando modelos.json não tem a sessão. Também usado pela P2 (prompt.js, M9 da
// revisão final da parte 1), que resolve o modelo antes de avaliar.
export function modeloNoEstado(estado, sessionId) {
  const sessao = estado?.sessoes?.[sessionId];
  return typeof sessao?.model === 'string' && sessao.model.length > 0 ? sessao.model : null;
}

// Emenda 5 (v0.5.4): a trava de projeção (G1, G2) cai quando a projeção
// deixa de valer, em vez de ficar até o reset da janela. Antes, um G2 que
// disparava com a semana em 37% travava por dias. Só com leitura fresca e
// com folga (a projeção ausente ou além de 1,5 × o horizonte), para a trava
// não piscar na borda. Os tetos (G3, G4) só sobem dentro da janela: ficam.
// Muda `travas` no lugar e grava; falha de gravação mantém a trava em disco,
// e a próxima avaliação tenta de novo.
const FOLGA_PROJECAO = 1.5;
function soltarProjecoes(dir, travas, disparos, leituras, previsao, config, agoraMs) {
  const soltas = [];
  for (const [k, gatilho, horizonteMs] of [
    ['five_hour', 'G1', config.horizonte5hMin * 60_000],
    ['seven_day', 'G2', config.horizonte7dH * 3_600_000],
  ]) {
    if (travas[k]?.gatilho !== gatilho || disparos[k] || leituras[k]?.fresca !== true) continue;
    const quando = previsao?.[k];
    if (numeroFinito(quando) && quando - agoraMs <= FOLGA_PROJECAO * horizonteMs) continue;
    soltas.push(k);
  }
  if (soltas.length === 0 || !limparTravas(dir, soltas, agoraMs).ok) return;
  for (const k of soltas) {
    travas[k] = null;
    anexarEvento(dir, 'projecao-solta', k, agoraMs);
  }
}

export function avaliarGuarda({ dir, agoraMs, sessionId } = {}) {
  try {
    if (typeof dir !== 'string' || !numeroFinito(agoraMs)) return vazia('erro');
    const { config } = lerConfigGuarda(dir);
    if (!config.ligada) return vazia('desligada', config);

    const lidoEstado = lerJson(path.join(dir, ARQ_ESTADO));
    const estado = lidoEstado.ok ? validarEstado(lidoEstado.valor, agoraMs) : null;
    const leituras = leiturasComPiso(estado, agoraMs);
    const previsao = preverEstouro({ historico: estado?.historico, limites: limitesValidos(estado, agoraMs), agoraMs });
    const despachosFable = despachosFableRecentes(dir, agoraMs);
    const usoFable = fableOficial(lerUso(dir, agoraMs), agoraMs);
    const disparos = avaliarGatilhos({
      leituras, previsao, config, agoraMs, despachosFable, limiteFable: ultimoLimiteFable(dir, agoraMs), usoFable,
    });

    const liberacao = lerLiberacao(dir, agoraMs);
    const cobertura = coberturaAtual(liberacao, agoraMs, leituras.seven_day?.used_percentage);
    const lidas = lerTravas(dir, agoraMs);
    let ilegivel = lidas.estado === 'ilegivel';
    if (lidas.estado === 'ok') soltarProjecoes(dir, lidas.travas, disparos, leituras, previsao, config, agoraMs);
    const desde = new Date(agoraMs).toISOString();
    const novas = {};
    for (const k of CHAVES_TRAVA) {
      const dp = disparos[k];
      if (dp && !cobertura.solta.has(k) && !lidas.travas[k]) novas[k] = { resets_at: dp.resets_at, gatilho: dp.gatilho, desde };
    }
    // Ilegível nunca é sobrescrito nem vira trava gravada (só a liberação o
    // limpa): um ilegível passageiro, como a renomeação de outra sessão no
    // meio da leitura no Windows, trava só esta avaliação. O arquivo que
    // estraga entre a nossa leitura e a de gravarTravas também trava (§4.5).
    if (Object.keys(novas).length > 0 && !ilegivel) {
      const r = gravarTravas(dir, novas, agoraMs);
      if (r.motivo === 'ilegivel') ilegivel = true;
      if (r.gravou) for (const k of Object.keys(novas)) anexarEvento(dir, 'disparo', novas[k].gatilho, agoraMs);
    }
    const travas = unirTravas(lidas.travas, novas);

    const ativas = [];
    const motivos = [];
    for (const k of CHAVES_MOTIVO) {
      if (k === 'ilegivel') {
        if (ilegivel && !cobertura.solta.has(k)) {
          ativas.push(k);
          motivos.push({ trava: k, gatilho: null, resets_at: null, dados: null, desde: null });
        }
        continue;
      }
      const t = travas[k];
      if (!t || cobertura.solta.has(k)) continue;
      // Dados só do disparo de agora com o mesmo gatilho da trava; senão null
      // e a mensagem usa o texto genérico da trava (Task 11).
      const dp = disparos[k];
      const atual = dp && dp.gatilho === t.gatilho ? dp.dados : null;
      ativas.push(k);
      motivos.push({ trava: k, gatilho: t.gatilho, resets_at: t.resets_at, dados: atual, desde: t.desde });
    }

    const semLeitura = !leituras.five_hour && !leituras.seven_day;
    let status = 'armada';
    if (ativas.length > 0) status = 'disparada';
    else if (cobertura.ativa) status = 'liberada';
    else if (semLeitura) status = 'sem-leitura';

    const modeloSessao = modeloDaSessao(dir, sessionId, agoraMs) ?? modeloNoEstado(estado, sessionId);

    return { status, ativas, motivos, cobertura, liberacao, config, leituras, despachosFable, modeloSessao, usoFable };
  } catch {
    return vazia('erro');
  }
}

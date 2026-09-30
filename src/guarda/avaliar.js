import path from 'node:path';
import { ARQ_ESTADO, lerJson, validarEstado, limitesValidos, leiturasComPiso } from '../estado.js';
import { numeroFinito } from '../base.js';
import { preverEstouro } from '../previsao.js';
import { lerConfigGuarda, PADRAO_GUARDA } from './config.js';
import { avaliarGatilhos } from './gatilhos.js';
import { CHAVES_TRAVA, lerTravas, gravarTravas, unirTravas } from './travas.js';
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
  config, leituras: { five_hour: null, seven_day: null }, despachosFable: [], modeloSessao: null,
});

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
    const disparos = avaliarGatilhos({
      leituras, previsao, config, agoraMs, despachosFable, limiteFable: ultimoLimiteFable(dir, agoraMs),
    });

    const liberacao = lerLiberacao(dir, agoraMs);
    const cobertura = coberturaAtual(liberacao, agoraMs, leituras.seven_day?.used_percentage);
    const lidas = lerTravas(dir, agoraMs);
    let ilegivel = lidas.estado === 'ilegivel';
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

    const sessao = estado?.sessoes?.[sessionId];
    const modeloSessao = modeloDaSessao(dir, sessionId, agoraMs)
      ?? (typeof sessao?.model === 'string' && sessao.model.length > 0 ? sessao.model : null);

    return { status, ativas, motivos, cobertura, liberacao, config, leituras, despachosFable, modeloSessao };
  } catch {
    return vazia('erro');
  }
}

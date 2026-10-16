import path from 'node:path';
import { gravarJsonAtomico } from '../estado.js';
import { idValido, instante, numeroFinito } from '../base.js';
import { lerSemLink } from './arquivo.js';
import { LIBERACAO_TETO_H } from './config.js';

// Liberação da guarda (spec v0.4.0 §6, D4 = opção C em 2026-09-29): sem
// código. Só o hook UserPromptExpansion de /hadouken:liberar grava este
// arquivo; o modelo não digita comandos na sessão principal, a P4 nega sessões
// claude filhas com a guarda disparada e o hook recusa -p e SDK pelo
// CLAUDE_CODE_ENTRYPOINT. A liberação é global (o limite é da conta) e acaba no
// prazo ou quando o 7d sobe tetoPontos7d acima do valor de quando foi dada.

export const ARQ_LIBERACAO = 'liberacao.json';
export const LIBERACAO_MAX_BYTES = 4096;
// Toda liberação solta as travas de janela, a de despachos Fable e o estado
// ilegível (§4.5: só a liberação limpa). `fable` (G6, pode consumir créditos
// de uso, S25) e `despacho-caro` (G5) só com o escopo dito de propósito.
const SOLTA_BASE = Object.freeze(['five_hour', 'seven_day', 'fable-despachos', 'ilegivel']);
export const SOLTA_CONHECIDAS = Object.freeze([...SOLTA_BASE, 'fable', 'despacho-caro']);
const H = 3_600_000;
const ARGS_MAX = 64;
const ID = /^[0-9a-f]{8}$/;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nenhuma = () => ({ ativa: false, solta: new Set(), fim: null });

// Argumentos de /hadouken:liberar (§6.2): até três palavras entre `Nh`
// (1 a maxH) ou `janela`, que são o prazo (um só), `fable` e `caro`, cada uma
// no máximo uma vez. Qualquer outra coisa, inclusive um invisível colado ou
// um dígito que não é ASCII, recusa o pedido inteiro: nunca se adivinha um
// escopo. Sem prazo, o padrão do config.json.
export function lerPedido(args, config) {
  try {
    if (typeof args !== 'string' || args.length > ARGS_MAX) return { ok: false };
    const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length > 3) return { ok: false };
    const p = { ok: true, horas: null, janela: false, fable: false, caro: false };
    let temPrazo = false;
    for (const t of tokens) {
      const m = /^(\d{1,2})h$/.exec(t);
      if (m) {
        const n = Number(m[1]);
        if (temPrazo || n < 1 || n > config.liberacaoMaxH) return { ok: false };
        p.horas = n;
        temPrazo = true;
      } else if (t === 'janela') {
        if (temPrazo) return { ok: false };
        p.janela = true;
        temPrazo = true;
      } else if (t === 'fable' || t === 'caro') {
        if (p[t]) return { ok: false };
        p[t] = true;
      } else {
        return { ok: false };
      }
    }
    if (!temPrazo) p.horas = config.liberacaoPadraoH;
    return p;
  } catch {
    return { ok: false };
  }
}

// Prazo de "janela": o reset mais distante entre as janelas travadas, no
// máximo maxH; sem janela travada com reset, o prazo padrão.
function prazoJanela(travas, agoraMs, config) {
  let reset = null;
  for (const k of ['five_hour', 'seven_day']) {
    const r = travas?.[k]?.resets_at;
    if (numeroFinito(r) && r * 1000 > agoraMs && (reset === null || r > reset)) reset = r;
  }
  const teto = agoraMs + config.liberacaoMaxH * H;
  return reset === null ? agoraMs + config.liberacaoPadraoH * H : Math.min(reset * 1000, teto);
}

// `pedido` vem de lerPedido; sem `ok: true` não há liberação (null), em vez
// de um prazo NaN que lançaria. `id` e `sessionId` vêm do hook. base7d sem
// leitura válida é null: aí só o prazo encerra a liberação.
export function montarLiberacao({ pedido, agoraMs, usado7d, travas, config, sessionId, id }) {
  if (pedido?.ok !== true) return null;
  const ate = pedido.janela ? prazoJanela(travas, agoraMs, config) : agoraMs + pedido.horas * H;
  const solta = [...SOLTA_BASE];
  if (pedido.fable) solta.push('fable');
  if (pedido.caro) solta.push('despacho-caro');
  return {
    v: 1, id, criadaEm: new Date(agoraMs).toISOString(), ate: new Date(ate).toISOString(), solta,
    base7d: numeroFinito(usado7d) && usado7d >= 0 && usado7d <= 100 ? usado7d : null,
    tetoPontos7d: config.liberacaoTetoPontos7d, sessao: sessionId, avisada: false,
  };
}

// Escopo e prazo de uma liberação para o evento 'liberacao-escopo' (spec
// v0.4.0 §9.4, "liberações, com escopo e prazo"; decisão 9 do plano da parte
// 2): "2h:120", "janela:95:fable" ou "3h:180:fable:caro". Só o prazo pedido
// (Nh de 1 a 24, ou janela), os minutos de criadaEm até `ate` (0 a 1440) e os
// escopos extras. Cabe na regra DETALHE de registros.js (até 40 caracteres).
// null com entrada inválida. Nunca lança.
const MINUTOS_MAX = 24 * 60;
export function detalheEscopo(lib, pedido) {
  try {
    if (!ehObjeto(lib) || !ehObjeto(pedido) || pedido.ok !== true) return null;
    const minutos = Math.round((Date.parse(lib.ate) - Date.parse(lib.criadaEm)) / 60_000);
    if (!Number.isFinite(minutos)) return null;
    let prazo = null;
    if (pedido.janela === true) prazo = 'janela';
    else if (Number.isInteger(pedido.horas) && pedido.horas >= 1 && pedido.horas <= 24) prazo = `${pedido.horas}h`;
    if (prazo === null) return null;
    const partes = [prazo, String(Math.min(MINUTOS_MAX, Math.max(0, minutos)))];
    if (pedido.fable === true) partes.push('fable');
    if (pedido.caro === true) partes.push('caro');
    return partes.join(':');
  } catch {
    return null;
  }
}

// Esquema estrito (§6.4): arquivo inválido é "sem liberação". Reconstrói só
// os campos conhecidos; `solta` só com nomes conhecidos e sem repetição; o
// teto de pontos na mesma faixa de liberacao.tetoPontos7d em config.js. O
// prazo vai no máximo LIBERACAO_TETO_H além de criadaEm (§6.2: no máximo
// 24 h), então nem um arquivo forjado solta a guarda por mais que isso.
export function liberacaoValida(valor, agoraMs) {
  try {
    if (!ehObjeto(valor) || valor.v !== 1 || !numeroFinito(agoraMs)) return null;
    if (typeof valor.id !== 'string' || !ID.test(valor.id)) return null;
    const criada = instante(valor.criadaEm, agoraMs);
    const ate = typeof valor.ate === 'string' && valor.ate.length <= 64 ? Date.parse(valor.ate) : NaN;
    if (criada === null || !numeroFinito(ate) || ate < criada) return null;
    if (ate - criada > LIBERACAO_TETO_H * H) return null;
    const s = valor.solta;
    if (!Array.isArray(s) || s.length > SOLTA_CONHECIDAS.length || new Set(s).size !== s.length) return null;
    if (!s.every((x) => SOLTA_CONHECIDAS.includes(x))) return null;
    const b = valor.base7d;
    if (b !== null && (!numeroFinito(b) || b < 0 || b > 100)) return null;
    const t = valor.tetoPontos7d;
    if (!Number.isInteger(t) || t < 1 || t > 50) return null;
    if (!idValido(valor.sessao) || typeof valor.avisada !== 'boolean') return null;
    return {
      v: 1, id: valor.id, criadaEm: new Date(criada).toISOString(), ate: new Date(ate).toISOString(), solta: [...s],
      base7d: b, tetoPontos7d: t, sessao: valor.sessao, avisada: valor.avisada,
    };
  } catch {
    return null;
  }
}

// O que a liberação cobre agora. A entrada passa de novo por liberacaoValida
// (§6.4: inválida é nenhuma liberação), então um prazo ou uma base que não se
// leem nunca deixam a liberação ativa, mesmo para quem não veio de
// lerLiberacao. `fim` diz por que uma liberação válida acabou.
export function coberturaAtual(lib, agoraMs, usado7d) {
  try {
    const v = liberacaoValida(lib, agoraMs);
    if (v === null) return nenhuma();
    if (Date.parse(v.ate) <= agoraMs) return { ativa: false, solta: new Set(), fim: 'prazo' };
    if (v.base7d !== null && numeroFinito(usado7d) && usado7d >= v.base7d + v.tetoPontos7d) {
      return { ativa: false, solta: new Set(), fim: 'pontos' };
    }
    return { ativa: true, solta: new Set(v.solta), fim: null };
  } catch {
    return nenhuma();
  }
}

// lstat antes (link, pasta, acima de 4 KiB ou presente sem abrir é inválido,
// §14); o que não passa no esquema também é nenhuma liberação. Nunca lança.
export function lerLiberacao(dir, agoraMs) {
  try {
    const lido = lerSemLink(path.join(dir, ARQ_LIBERACAO), LIBERACAO_MAX_BYTES);
    return lido.ok ? liberacaoValida(lido.valor, agoraMs) : null;
  } catch {
    return null;
  }
}

// Renomeação atômica: um link no lugar do arquivo é substituído, nunca
// seguido. Nunca lança.
export function gravarLiberacao(dir, lib) {
  try {
    return { ok: gravarJsonAtomico(path.join(dir, ARQ_LIBERACAO), lib).ok };
  } catch {
    return { ok: false };
  }
}

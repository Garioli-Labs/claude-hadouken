// Teto do parêntese de sessões ativas no aviso de projeção (spec v0.2.0 §12,
// avisos ao Claude): o de estado.sessoes, cuja casa única é estado.js; o
// outro nome o separa do MAX_SESSOES de agregacao.js. Import estático sem
// custo para o gate: todo caminho que carrega alerta.js já carrega estado.js
// (o hook de prompt e a barra no mesmo Promise.all depois do gate, o
// SessionStart, relatorio.js e hooks/alertas-gravados.js).
import { MAX_SESSOES as MAX_SESSOES_ATIVAS } from './estado.js';
import { calcularRitmo } from './ritmo.js';
import { horaLocal, quandoLocal, janelaValida, numeroFinito, TOLERANCIA_JANELA_S } from './util.js';

// A linha fixa de "sem leitura", a mesma no alerta do UserPromptSubmit e
// na linha do SessionStart (hooks/linha-estado.js a reexporta).
export const LINHA_SEM_LEITURA = 'Consumo sem leitura: rode /usage.';
// Spec v0.4.0 §10, item 1: sem leitura fresca nem piso, a linha diz desde
// quando não há leitura e o último modo conhecido; sem leitura nenhuma, esta.
export const LINHA_SEM_LEITURA_NUNCA = 'Consumo ainda sem leitura nesta máquina.';
// Rótulos dos modos de 7d nas linhas ao Claude.
const NOME_MODO = Object.freeze({ __proto__: null, normal: 'normal', economico: 'econômico', folga: 'folga', 'so-leitura': 'só leitura' });
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const DIA_MS = 24 * 3600_000;
const ORDEM_5H = ['ok', 'atencao', 'serializar', 'fechar'];
const RESTRITIVAS_5H = new Set(['atencao', 'serializar', 'fechar']);
const RESTRITIVAS_7D = new Set(['economico', 'so-leitura']);
const SUSPENSAS = 'restrições anteriores suspensas';
// Aviso de projeção (spec v0.2.0 §12, avisos ao Claude): faixas da distância
// até o estouro previsto (previsao.js), da mais rasa para a mais funda, com o
// limite de cada uma. Cada faixa dispara uma vez por janela e sessão.
const FAIXAS_PROJECAO = Object.freeze({
  five_hour: Object.freeze([['60', 60 * 60_000], ['30', 30 * 60_000]]),
  seven_day: Object.freeze([['24h', DIA_MS]]),
});
const ROTULO_PROJECAO = Object.freeze({ five_hour: '5h', seven_day: '7d' });

function mesmaJanela(guardada, resetsAt) {
  return Boolean(guardada)
    && numeroFinito(guardada.resets_at)
    && numeroFinito(resetsAt)
    && Math.abs(guardada.resets_at - resetsAt) <= TOLERANCIA_JANELA_S;
}

export const ALERTAS_VAZIO = Object.freeze({ five_hour: null, seven_day: null, sem_leitura: {}, projecao: {} });

export function faixa5h(pct) {
  if (pct >= 90) return 'fechar';
  if (pct >= 80) return 'serializar';
  if (pct >= 70) return 'atencao';
  return 'ok';
}

// A faixa de 7d é o modo de calcularRitmo (ritmo.js guarda a regra única e o
// limiar, revisão da Task 5, M-2 e N-5: inteiros exibidos, piso de usado e de
// esperado contra ±10), com uma faixa a mais: só leitura quando o uso chega a
// 90% e o reset está a mais de 24 h. O limiar de 90% é inteiro e compara o uso
// cru, o que concorda com o piso exibido. `desvio` é a distância de ritmo.js.
export function faixa7d({ usado, resetsAt, agoraMs }) {
  const { esperado, desvio, modo } = calcularRitmo({ usado7d: usado, resetsAt7d: resetsAt, agoraMs });
  const faixa = usado >= 90 && resetsAt * 1000 - agoraMs > DIA_MS ? 'so-leitura' : modo;
  return { faixa, esperado, desvio };
}

// Linha "sem leitura nova desde <quando>; trate como o último modo
// conhecido (<modo>)." (spec v0.4.0 §10, item 1). O modo é a faixa de 7d
// no instante da última leitura, se o reset daquela janela ainda não passou;
// senão, normal (decisão 3 do plano da parte 2). Só o horário de quandoLocal
// e um rótulo de NOME_MODO entram. Sem última leitura, ou entrada ilegível:
// LINHA_SEM_LEITURA_NUNCA. Nunca lança.
export function linhaSemLeitura(ultima, agoraMs) {
  try {
    if (!ehObjeto(ultima) || !numeroFinito(ultima.desdeMs) || !numeroFinito(agoraMs)) return LINHA_SEM_LEITURA_NUNCA;
    const desdeMs = ultima.desdeMs;
    const f7 = janelaValida(ultima.seven_day);
    const faixa = f7 !== null && f7.resets_at * 1000 > agoraMs
      ? faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs: desdeMs }).faixa
      : 'normal';
    const quando = quandoLocal(desdeMs / 1000, agoraMs);
    return `Consumo sem leitura nova desde ${quando}; trate como o último modo conhecido (${NOME_MODO[faixa] ?? 'normal'}).`;
  } catch {
    return LINHA_SEM_LEITURA_NUNCA;
  }
}

// Piso, nunca arredondamento: 89.6 não pode aparecer como "90%" numa linha
// que ainda está na faixa abaixo de 90.
const pct = (x) => `${Math.floor(x)}%`;
// Spec v0.4.0 §10, item 5: minutos inteiros até o reset (piso), no mínimo 1.
// Abaixo de RESET_PERTO_MIN, atenção e serializar não mudam o ritmo: o reset
// chega antes de a mudança render.
const RESET_PERTO_MIN = 15;
const minutosAte = (resetsAt, agoraMs) => Math.max(1, Math.floor((resetsAt * 1000 - agoraMs) / 60_000));
// "Se agendar a volta" (§10, item 4; decisão 7 do plano da parte 2): reset +
// 2 min, para a volta cair na janela nova e não no último minuto da velha.
const VOLTA_S = 120;
const HORA_MS = 3_600_000;
// Idade de uma leitura-piso em horas inteiras (o piso só existe com mais de 1 h).
const idade = (ms) => `${Math.max(1, Math.floor(ms / HORA_MS))} h`;

// O valor de uma janela numa linha: "74%" ou "74% (reset em 40 min)"; com
// piso (spec v0.4.0 §10, item 1), "≥ 74% (leitura de 3 h)" ou "≥ 74% (leitura
// de 3 h; reset em 40 min)". `j` vem de janelasDasFaixas (Task 6 do plano) ou
// tem só used_percentage e resets_at (sem piso). Só números validados e texto
// fixo.
function em(j, extra = null) {
  const partes = [];
  if (j.piso === true) partes.push(`leitura de ${idade(j.idadeMs)}`);
  if (extra !== null) partes.push(extra);
  const valor = j.piso === true ? `≥ ${pct(j.used_percentage)}` : pct(j.used_percentage);
  return partes.length === 0 ? valor : `${valor} (${partes.join('; ')})`;
}

function linha5h(faixa, anterior, f5, agoraMs) {
  const min = minutosAte(f5.resets_at, agoraMs);
  const reset = `reset em ${min} min`;
  const perto = min < RESET_PERTO_MIN && (faixa === 'atencao' || faixa === 'serializar');
  const subiu = anterior === null || ORDEM_5H.indexOf(faixa) > ORDEM_5H.indexOf(anterior);
  if (!subiu) {
    if (perto) return `5h voltou a ${em(f5, reset)}: sem mudança de ritmo.`;
    switch (faixa) {
      case 'atencao': return `5h voltou a ${em(f5, reset)}: faixa atenção.`;
      case 'serializar': return `5h voltou a ${em(f5, reset)}: ainda serializar — sem Workflow nem subagentes em paralelo.`;
      default: return `5h voltou a ${em(f5)}: faixa normal.`;
    }
  }
  if (perto) return `5h em ${em(f5, reset)}: sem mudança de ritmo.`;
  switch (faixa) {
    case 'atencao': return `5h em ${em(f5, reset)}: atenção ao ritmo.`;
    case 'serializar': return `5h em ${em(f5, reset)}: serializar — sem Workflow nem subagentes em paralelo.`;
    case 'fechar': return `5h em ${em(f5)}: fechar a tarefa em curso e não abrir etapa nova; reset às ${horaLocal(f5.resets_at)} (o usuário vê as opções em /rate-limit-options). Se agendar a volta, marque ${horaLocal(f5.resets_at + VOLTA_S)}.`;
    default: return null;
  }
}

function linha7d(faixa, f7, esperado, agoraMs) {
  const base = `7d ${em(f7)} vs ${pct(esperado)} esperado`;
  switch (faixa) {
    case 'economico': return `${base} → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação.`;
    case 'folga': return `${base} → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume.`;
    case 'so-leitura': return `7d em ${em(f7)} com reset ${quandoLocal(f7.resets_at, agoraMs)}: só leitura; recomendar parar.`;
    default: return `${base} → modo normal.`;
  }
}

// A faixa de projeção de uma janela para a distância `faltaMs` (> 0) até o
// estouro: a mais funda cujo limite a contém, ou null.
function faixaProjecao(janela, faltaMs) {
  let faixa = null;
  for (const [nome, limite] of FAIXAS_PROJECAO[janela]) if (faltaMs <= limite) faixa = nome;
  return faixa;
}

const profundidade = (janela, faixa) => FAIXAS_PROJECAO[janela].findIndex(([nome]) => nome === faixa);

// A linha fixa do aviso de projeção: só rótulos do código, horários
// formatados e o número de sessões ativas (spec v0.2.0 §12.7). 5h com a hora
// local; 7d com quandoLocal (spec v0.4.0 §10, item 7: nunca só o dia da
// semana). A última frase é a de §8.1, regra 2 (§10, item 2).
const FRASE_DECISAO = 'Se isso conflitar com uma decisão explícita do usuário, pergunte antes de mudar o plano.';
function linhaProjecao(janela, quandoMs, resetsAt, sessoes, agoraMs) {
  const n = Number.isInteger(sessoes) && sessoes >= 2 && sessoes <= MAX_SESSOES_ATIVAS ? ` (${sessoes} sessões ativas)` : '';
  const tempos = janela === 'five_hour'
    ? `às ${horaLocal(quandoMs / 1000)}, antes do reset das ${horaLocal(resetsAt)}`
    : `${quandoLocal(quandoMs / 1000, agoraMs)}, antes do reset ${quandoLocal(resetsAt, agoraMs)}`;
  return `hadouken: no ritmo atual${n}, ${ROTULO_PROJECAO[janela]} chega a 100% ${tempos}. Reduza o paralelismo ou serialize. ${FRASE_DECISAO}`;
}

// Aviso de projeção da sessão (spec v0.2.0 §12, avisos ao Claude).
// `guardada` é a memória da sessão ({ five_hour, seven_day }, cada uma
// { resets_at, faixa } ou null) ou null. Janela sem leitura agora fica como está; janela nova esquece a faixa
// da anterior; a linha sai só quando a faixa atual é mais funda que a
// guardada na mesma janela, então sair de faixa e voltar não repete o aviso.
// Devolve { linhas, memoria }, com memoria null quando as duas janelas ficam
// sem faixa.
function avaliarProjecao({ limites, guardada, previsao, sessoesAtivas, agoraMs }) {
  const linhas = [];
  const memoria = { five_hour: guardada?.five_hour ?? null, seven_day: guardada?.seven_day ?? null };
  const p = previsao !== null && typeof previsao === 'object' ? previsao : {};
  for (const janela of ['five_hour', 'seven_day']) {
    const f = limites[janela];
    if (!f) continue;
    const anterior = memoria[janela];
    const mesma = mesmaJanela(anterior, f.resets_at);
    const quando = p[janela];
    const antesDoReset = numeroFinito(quando) && numeroFinito(agoraMs) && quando > agoraMs && quando < f.resets_at * 1000;
    const faixa = antesDoReset ? faixaProjecao(janela, quando - agoraMs) : null;
    if (faixa !== null && (!mesma || profundidade(janela, faixa) > profundidade(janela, anterior.faixa))) {
      linhas.push(linhaProjecao(janela, quando, f.resets_at, sessoesAtivas, agoraMs));
      memoria[janela] = { resets_at: f.resets_at, faixa };
    } else if (!mesma) {
      memoria[janela] = null;
    }
  }
  return { linhas, memoria: memoria.five_hour || memoria.seven_day ? memoria : null };
}

// Spec v0.2.0 §12 (avisos ao Claude): `previsao` (preverEstouro de
// previsao.js) e `sessoesAtivas` (sessoesAtivas de estado.js) alimentam o
// aviso de projeção, guardado por sessão em `projecao` (o hook de prompt o
// guarda em projecao.json, fora de alertas.json; ver hooks/alertas-gravados.js);
// sem eles, nenhum aviso de projeção. Nunca lança (restrição global do
// plano v0.2.0): entrada ilegível (sem objeto, getter que lança, Proxy) não
// dá aviso nenhum e devolve memória vazia, o lado seguro de
// alertas-gravados.js (a faixa atual é anunciada de novo, nunca uma descida
// falsa).
export function avaliarAlertas(entrada) {
  try {
    return avaliar(entrada);
  } catch {
    return { linhas: [], novos: { five_hour: null, seven_day: null, sem_leitura: {}, projecao: {} } };
  }
}

function avaliar({ limites, anteriores, sessionId, agoraMs, previsao, sessoesAtivas }) {
  const ant = anteriores ?? ALERTAS_VAZIO;
  const novos = {
    five_hour: ant.five_hour, seven_day: ant.seven_day, sem_leitura: { ...ant.sem_leitura }, projecao: { ...ant.projecao },
  };
  const linhas = [];

  if (!limites || (!limites.five_hour && !limites.seven_day)) {
    if (!novos.sem_leitura[sessionId]) {
      linhas.push(LINHA_SEM_LEITURA);
      novos.sem_leitura[sessionId] = true;
    }
    return { linhas, novos };
  }
  delete novos.sem_leitura[sessionId];

  const f5 = limites.five_hour;
  if (f5) {
    const faixa = faixa5h(f5.used_percentage);
    const guardada = ant.five_hour;
    const mesma = mesmaJanela(guardada, f5.resets_at);
    const anterior = mesma ? guardada.faixa : null;
    if (!mesma && guardada && RESTRITIVAS_5H.has(guardada.faixa) && faixa === 'ok') {
      linhas.push(`5h: janela nova em ${em(f5)}, faixa normal — ${SUSPENSAS}.`);
    } else if (anterior !== faixa && !(anterior === null && faixa === 'ok')) {
      const l = linha5h(faixa, anterior, f5, agoraMs);
      if (l) linhas.push(l);
    }
    novos.five_hour = { resets_at: f5.resets_at, faixa };
  }

  const f7 = limites.seven_day;
  if (f7) {
    const { faixa, esperado } = faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs });
    const guardada = ant.seven_day;
    const mesma = mesmaJanela(guardada, f7.resets_at);
    const anterior = mesma ? guardada.faixa : null;
    if (!mesma && guardada && RESTRITIVAS_7D.has(guardada.faixa) && faixa === 'normal') {
      linhas.push(`7d: janela nova, ${em(f7)} vs ${pct(esperado)} esperado → modo normal — ${SUSPENSAS}.`);
    } else if (anterior !== faixa && !(anterior === null && faixa === 'normal')) {
      linhas.push(linha7d(faixa, f7, esperado, agoraMs));
    }
    novos.seven_day = { resets_at: f7.resets_at, faixa };
  }

  // O aviso de projeção por último e à parte: previsão ou memória de
  // projeção ilegível (getter que lança, Proxy) cala só esse aviso e deixa a
  // memória da sessão como estava; os avisos de faixa acima saem igual.
  try {
    const guardada = Object.hasOwn(novos.projecao, sessionId) ? novos.projecao[sessionId] : null;
    const projecao = avaliarProjecao({ limites, guardada, previsao, sessoesAtivas, agoraMs });
    // Só mexe na memória quando ela muda: a sessão alterada vai para o fim da
    // ordem, de onde projecaoParaGravar (hooks/alertas-gravados.js) corta o teto.
    if (JSON.stringify(projecao.memoria) !== JSON.stringify(guardada)) {
      delete novos.projecao[sessionId];
      if (projecao.memoria !== null) novos.projecao[sessionId] = projecao.memoria;
    }
    linhas.push(...projecao.linhas);
  } catch {
    // Nenhum aviso de projeção.
  }
  return { linhas, novos };
}

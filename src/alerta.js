// Teto do parêntese de sessões ativas no aviso de projeção (spec v0.2.0 §12,
// avisos ao Claude): o de estado.sessoes, cuja casa única é estado.js; o
// outro nome o separa do MAX_SESSOES de agregacao.js. Import estático sem
// custo para o gate: todo caminho que carrega alerta.js já carrega estado.js
// (o hook de prompt e a barra no mesmo Promise.all depois do gate, o
// SessionStart, relatorio.js e hooks/alertas-gravados.js).
import { MAX_SESSOES as MAX_SESSOES_ATIVAS } from './estado.js';
import { calcularRitmo } from './ritmo.js';
import { horaLocal, diaHora, numeroFinito, TOLERANCIA_JANELA_S } from './util.js';

// A linha fixa de "sem leitura", a mesma no alerta do UserPromptSubmit e
// na linha do SessionStart (hooks/linha-estado.js a reexporta).
export const LINHA_SEM_LEITURA = 'Consumo sem leitura: rode /usage.';

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

// Piso, nunca arredondamento: 89.6 não pode aparecer como "90%" numa linha
// que ainda está na faixa abaixo de 90.
const pct = (x) => `${Math.floor(x)}%`;

function linha5h(faixa, anterior, usado, resetsAt) {
  const subiu = anterior === null || ORDEM_5H.indexOf(faixa) > ORDEM_5H.indexOf(anterior);
  if (!subiu) {
    switch (faixa) {
      case 'atencao': return `5h voltou a ${pct(usado)}: faixa atenção (reset ${horaLocal(resetsAt)}).`;
      case 'serializar': return `5h voltou a ${pct(usado)}: ainda serializar — sem Workflow nem subagentes em paralelo.`;
      default: return `5h voltou a ${pct(usado)}: faixa normal.`;
    }
  }
  switch (faixa) {
    case 'atencao': return `5h em ${pct(usado)} (reset ${horaLocal(resetsAt)}): atenção ao ritmo.`;
    case 'serializar': return `5h em ${pct(usado)}: serializar — sem Workflow nem subagentes em paralelo.`;
    case 'fechar': return `5h em ${pct(usado)}: fechar a tarefa em curso, não abrir etapa nova, agendar a volta para depois de ${horaLocal(resetsAt)}.`;
    default: return null;
  }
}

function linha7d(faixa, usado, esperado, resetsAt) {
  const base = `7d ${pct(usado)} vs ${pct(esperado)} esperado`;
  switch (faixa) {
    case 'economico': return `${base} → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação.`;
    case 'folga': return `${base} → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume.`;
    case 'so-leitura': return `7d em ${pct(usado)} com reset em ${diaHora(resetsAt)}: só leitura; recomendar parar.`;
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
// local; 7d com dia da semana e hora, porque a previsão pode cair noutro dia.
function linhaProjecao(janela, quandoMs, resetsAt, sessoes) {
  const hora = janela === 'five_hour' ? horaLocal : diaHora;
  const n = Number.isInteger(sessoes) && sessoes >= 2 && sessoes <= MAX_SESSOES_ATIVAS ? ` (${sessoes} sessões ativas)` : '';
  return `hadouken: no ritmo atual${n}, ${ROTULO_PROJECAO[janela]} chega a 100% às ${hora(quandoMs / 1000)}, antes do reset das ${hora(resetsAt)}. Reduza o paralelismo ou serialize.`;
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
      linhas.push(linhaProjecao(janela, quando, f.resets_at, sessoesAtivas));
      memoria[janela] = { resets_at: f.resets_at, faixa };
    } else if (!mesma) {
      memoria[janela] = null;
    }
  }
  return { linhas, memoria: memoria.five_hour || memoria.seven_day ? memoria : null };
}

// Spec v0.2.0 §12 (avisos ao Claude): `previsao` (preverEstouro de
// previsao.js) e `sessoesAtivas` (sessoesAtivas de estado.js) alimentam o
// aviso de projeção, guardado por sessão em `projecao`; sem eles, nenhum aviso
// de projeção.
export function avaliarAlertas({ limites, anteriores, sessionId, agoraMs, previsao, sessoesAtivas }) {
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
      linhas.push(`5h: janela nova em ${pct(f5.used_percentage)}, faixa normal — ${SUSPENSAS}.`);
    } else if (anterior !== faixa && !(anterior === null && faixa === 'ok')) {
      const l = linha5h(faixa, anterior, f5.used_percentage, f5.resets_at);
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
      linhas.push(`7d: janela nova, ${pct(f7.used_percentage)} vs ${pct(esperado)} esperado → modo normal — ${SUSPENSAS}.`);
    } else if (anterior !== faixa && !(anterior === null && faixa === 'normal')) {
      linhas.push(linha7d(faixa, f7.used_percentage, esperado, f7.resets_at));
    }
    novos.seven_day = { resets_at: f7.resets_at, faixa };
  }

  const guardada = Object.hasOwn(novos.projecao, sessionId) ? novos.projecao[sessionId] : null;
  const projecao = avaliarProjecao({ limites, guardada, previsao, sessoesAtivas, agoraMs });
  linhas.push(...projecao.linhas);
  // Só mexe na memória quando ela muda: a sessão alterada vai para o fim da
  // ordem, de onde alertasParaGravar corta o teto.
  if (JSON.stringify(projecao.memoria) !== JSON.stringify(guardada)) {
    delete novos.projecao[sessionId];
    if (projecao.memoria !== null) novos.projecao[sessionId] = projecao.memoria;
  }
  return { linhas, novos };
}

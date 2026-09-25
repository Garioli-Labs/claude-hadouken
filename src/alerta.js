import { calcularRitmo } from './ritmo.js';
import { horaLocal, diaHora, TOLERANCIA_JANELA_S } from './util.js';

const DIA_MS = 24 * 3600_000;
const ORDEM_5H = ['ok', 'atencao', 'serializar', 'fechar'];
const RESTRITIVAS_5H = new Set(['atencao', 'serializar', 'fechar']);
const RESTRITIVAS_7D = new Set(['economico', 'so-leitura']);
const SUSPENSAS = 'restrições anteriores suspensas';

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);

function mesmaJanela(guardada, resetsAt) {
  return Boolean(guardada)
    && numeroFinito(guardada.resets_at)
    && numeroFinito(resetsAt)
    && Math.abs(guardada.resets_at - resetsAt) <= TOLERANCIA_JANELA_S;
}

export const ALERTAS_VAZIO = Object.freeze({ five_hour: null, seven_day: null, sem_leitura: {} });

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

export function avaliarAlertas({ limites, anteriores, sessionId, agoraMs }) {
  const ant = anteriores ?? ALERTAS_VAZIO;
  const novos = { five_hour: ant.five_hour, seven_day: ant.seven_day, sem_leitura: { ...ant.sem_leitura } };
  const linhas = [];

  if (!limites || (!limites.five_hour && !limites.seven_day)) {
    if (!novos.sem_leitura[sessionId]) {
      linhas.push('Consumo sem leitura: rode /usage.');
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
  return { linhas, novos };
}

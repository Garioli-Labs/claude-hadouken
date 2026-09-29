import { numeroFinito, DATA_MAX_MS } from '../base.js';

// Frase de previsão no estilo da aba Uso do claude.ai (spec, emenda E5):
// ritmo médio da janela inteira, não a regressão das últimas horas
// (previsao.js, que continua por dentro para os alertas e a guarda). Tudo em
// hora local. Nenhuma função daqui lança.

// Com menos que isto decorrido na janela, o ritmo médio ainda é ruído (E5).
export const DECORRIDO_MIN_MS = 30 * 60_000;

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
// Abaixo disto, "por volta das HH:MM"; daí em diante, o período do dia.
const PERTO_MS = 6 * HORA_MS;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const dois = (n) => String(n).padStart(2, '0');

// Instante que o Date representa (finito e dentro da faixa do ECMAScript).
const instanteValido = (ms) => numeroFinito(ms) && Math.abs(ms) <= DATA_MAX_MS;

const horaMinuto = (d) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
const diaMes = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;

// Madrugada 0–5, manhã 6–11, tarde 12–17, noite 18–23 (E5).
function periodo(h) {
  if (h < 6) return 'de madrugada';
  if (h < 12) return 'de manhã';
  if (h < 18) return 'à tarde';
  return 'à noite';
}

// Dias de calendário local de `a` até `b` (0 no mesmo dia). O arredondamento
// absorve a hora a mais ou a menos de uma troca de horário de verão.
function diasDeCalendario(a, b) {
  const inicio = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const fim = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((fim - inicio) / (24 * HORA_MS));
}

// Quando, em palavras (E5): "por volta das 20:30" a menos de 6 h; senão
// "hoje/amanhã/<dia da semana> <período>" até 6 dias de calendário e "em
// dd/mm" depois disso. Alvo no passado ou entrada não finita: null.
export function momentoFalado(alvoMs, agoraMs) {
  try {
    if (!instanteValido(alvoMs) || !instanteValido(agoraMs) || alvoMs < agoraMs) return null;
    const alvo = new Date(alvoMs);
    if (alvoMs - agoraMs < PERTO_MS) return `por volta das ${horaMinuto(alvo)}`;
    const dias = diasDeCalendario(new Date(agoraMs), alvo);
    const p = periodo(alvo.getHours());
    if (dias === 0) return `hoje ${p}`;
    if (dias === 1) return `amanhã ${p}`;
    if (dias <= 6) return `${DIAS[alvo.getDay()]} ${p}`;
    return `em ${diaMes(alvo)}`;
  } catch {
    return null;
  }
}

// "das 17:20" quando o reinício cai no mesmo dia local de agora; senão
// "de 05/10 às 22:00".
function sufixoReinicio(resetsAtMs, agoraMs) {
  const r = new Date(resetsAtMs);
  if (diasDeCalendario(new Date(agoraMs), r) === 0) return `das ${horaMinuto(r)}`;
  return `de ${diaMes(r)} às ${horaMinuto(r)}`;
}

// Frase de previsão de uma janela (E5): ritmo = usado / decorrido e esgota =
// agora + (100 − usado) / ritmo. `usado` em (0, 100], `janelaMs` > 0 e
// reinício no futuro; com menos de DECORRIDO_MIN_MS decorridos, null.
export function fraseEsgota(entrada) {
  try {
    const { usado, resetsAtMs, janelaMs, agoraMs } = entrada;
    if (!numeroFinito(usado) || usado <= 0 || usado > 100) return null;
    if (!numeroFinito(janelaMs) || janelaMs <= 0) return null;
    if (!instanteValido(resetsAtMs) || !instanteValido(agoraMs) || resetsAtMs <= agoraMs) return null;
    // Limite atingido vale mesmo nos primeiros 30 min: não é previsão.
    // "reinicia às 17:20" / "reinicia em 05/10 às 22:00".
    if (usado >= 100) {
      const r = new Date(resetsAtMs);
      const quando = diasDeCalendario(new Date(agoraMs), r) === 0 ? `às ${horaMinuto(r)}` : `em ${diaMes(r)} às ${horaMinuto(r)}`;
      return `Limite atingido; reinicia ${quando}.`;
    }
    const decorrido = janelaMs - (resetsAtMs - agoraMs);
    if (!(decorrido >= DECORRIDO_MIN_MS)) return null;
    const sufixo = sufixoReinicio(resetsAtMs, agoraMs);
    const ritmo = usado / decorrido;
    const esgotaMs = agoraMs + (100 - usado) / ritmo;
    if (esgotaMs < resetsAtMs) {
      const quando = momentoFalado(esgotaMs, agoraMs);
      if (quando === null) return null;
      return `Nesse ritmo, esgota ${quando}, antes do reinício ${sufixo}.`;
    }
    return `Nesse ritmo, não esgota antes do reinício ${sufixo}.`;
  } catch {
    return null;
  }
}

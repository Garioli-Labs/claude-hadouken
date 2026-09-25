const HORA_MS = 3600_000;
const JANELA_H = 168;
const LIMIAR_PONTOS = 10;

const arred = (x) => Math.round(x * 10) / 10;

export function calcularRitmo({ usado7d, resetsAt7d, agoraMs }) {
  const inicioMs = resetsAt7d * 1000 - JANELA_H * HORA_MS;
  const horas = (agoraMs - inicioMs) / HORA_MS;
  const esperado = arred(Math.min(100, Math.max(0, (horas / JANELA_H) * 100)));
  const desvio = arred(usado7d - esperado);
  let modo = 'normal';
  if (desvio > LIMIAR_PONTOS) modo = 'economico';
  else if (desvio < -LIMIAR_PONTOS) modo = 'folga';
  return { esperado, desvio, modo };
}

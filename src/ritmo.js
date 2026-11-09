import { minutosUteis } from './janela.js';

const HORA_MS = 3600_000;
const JANELA_H = 168;
// Pontos de distância entre usado e esperado que mudam o modo de 7d. Único
// lugar do limiar: faixa7d (alerta.js) usa o modo daqui.
export const LIMIAR_PONTOS = 10;

const arred = (x) => Math.round(x * 10) / 10;

// Ritmo linear da janela de 7 dias. `esperado` é o percentual que o ritmo
// linear daria agora (uma casa decimal). A regra do modo é uma só (revisão da
// Task 5, M-2 e N-5): sai dos inteiros que a barra e as linhas exibem, piso de
// usado menos piso de esperado; acima de +LIMIAR_PONTOS é econômico, abaixo
// de -LIMIAR_PONTOS é folga. Assim os mesmos números na tela nunca carregam
// modos diferentes e "60%/50%" nunca aparece como econômico. Os limiares são
// inteiros, então o piso só atrasa a troca em menos de 1 ponto. `desvio` é
// essa distância inteira.
//
// `trabalho` (janela.js, v0.6.0): com a janela de trabalho, esperado =
// minutos úteis desde o início da semana ÷ minutos úteis da semana inteira
// (spec Fatia 2); fora da janela o esperado congela, e com o início da semana
// fora dela (J3) vale 0. Sem `trabalho` (null), a conta de 168 h de sempre.
export function calcularRitmo({ usado7d, resetsAt7d, agoraMs, trabalho = null }) {
  const inicioMs = resetsAt7d * 1000 - JANELA_H * HORA_MS;
  const horas = (agoraMs - inicioMs) / HORA_MS;
  const util = trabalho === null ? 0 : minutosUteis(trabalho, inicioMs, resetsAt7d * 1000);
  const razao = util > 0 ? minutosUteis(trabalho, inicioMs, agoraMs) / util : horas / JANELA_H;
  const esperado = arred(Math.min(100, Math.max(0, razao * 100)));
  const desvio = Math.floor(usado7d) - Math.floor(esperado);
  let modo = 'normal';
  if (desvio > LIMIAR_PONTOS) modo = 'economico';
  else if (desvio < -LIMIAR_PONTOS) modo = 'folga';
  return { esperado, desvio, modo };
}

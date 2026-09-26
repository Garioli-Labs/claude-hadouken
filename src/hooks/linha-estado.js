import { faixa7d } from '../alerta.js';
import { horaLocal, diaHora } from '../util.js';

// Linhas que o SessionStart injeta no contexto do Claude. Spec 8.1, S1: só
// números finitos validados (com piso, como a barra e os alertas), a saída de
// horaLocal/diaHora e rótulos fixos deste arquivo. Nenhum texto lido de
// arquivo, stdin, ambiente ou do resultado de outra função entra aqui.

export const LINHA_SEM_LEITURA = 'Consumo sem leitura: rode /usage.';

const ROTULO_7D = Object.freeze({ normal: 'normal', folga: 'folga', economico: 'econômico', 'so-leitura': 'só leitura' });

// Motivos que sincronizarShims (shim.js) devolve: os próprios e os códigos de
// erro de sistema que a escrita de um arquivo pode dar. Qualquer outro valor
// vira 'erro'.
const MOTIVOS_SHIM = new Set([
  'sem_diretorio', 'raiz_invalida', 'bin_invalido', 'shim_invalido', 'tmp_invalido', 'shim',
  'EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'EEXIST', 'ENOTDIR', 'EISDIR', 'ELOOP', 'ENAMETOOLONG',
  'ENOSPC', 'EDQUOT', 'EROFS', 'EMFILE', 'ENFILE', 'EIO', 'EINVAL', 'EXDEV',
]);
// Motivos de falha de registrarSessao (ativas.js) que chegam até a linha: id,
// relógio e diretório de dados já foram conferidos pelo hook antes.
const MOTIVOS_REGISTRO = new Set(['invalido', 'pasta', 'criar', 'inesperado']);

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pct = (x) => `${Math.floor(x)}%`;
const motivoFixo = (motivo, lista) => (typeof motivo === 'string' && lista.has(motivo) ? motivo : 'erro');

// Janela exibível: percentual finito em 0–100 e reset em segundos epoch finito,
// positivo e abaixo de 1e11 (o schema de estado.js). Quem chama já passa a
// saída de limitesValidos; a checagem garante que nenhum outro chamador faça
// a linha mostrar NaN.
function janela(j) {
  if (!ehObjeto(j)) return null;
  const usado = j.used_percentage;
  const reset = j.resets_at;
  if (!numeroFinito(usado) || usado < 0 || usado > 100) return null;
  if (!numeroFinito(reset) || reset <= 0 || reset >= 1e11) return null;
  return { usado, reset };
}

// "Consumo: 5h 42% (reset 18:40) · 7d 58% vs 41% esperado, modo econômico;
// reset qui 22:00." Janela ausente aparece como "sem leitura", nunca como 0;
// sem nenhuma janela, LINHA_SEM_LEITURA. A faixa de 7d é a de faixa7d, a
// regra única dos inteiros exibidos (Task 5). Nunca lança.
export function linhaEstado(limites, agoraMs) {
  try {
    const l = ehObjeto(limites) ? limites : {};
    const f5 = janela(l.five_hour);
    const f7 = numeroFinito(agoraMs) ? janela(l.seven_day) : null;
    if (f5 === null && f7 === null) return LINHA_SEM_LEITURA;
    const partes = [f5 ? `5h ${pct(f5.usado)} (reset ${horaLocal(f5.reset)})` : '5h sem leitura'];
    if (f7) {
      const { faixa, esperado } = faixa7d({ usado: f7.usado, resetsAt: f7.reset, agoraMs });
      if (!Object.hasOwn(ROTULO_7D, faixa) || !numeroFinito(esperado)) return LINHA_SEM_LEITURA;
      partes.push(`7d ${pct(f7.usado)} vs ${pct(esperado)} esperado, modo ${ROTULO_7D[faixa]}; reset ${diaHora(f7.reset)}`);
    } else {
      partes.push('7d sem leitura');
    }
    return `Consumo: ${partes.join(' · ')}.`;
  } catch {
    return LINHA_SEM_LEITURA;
  }
}

// Linha fixa quando sincronizarShims falha (adendo B da Task 7).
export function linhaShimIndisponivel(motivo) {
  return `claude-hadouken: barra indisponível (${motivoFixo(motivo, MOTIVOS_SHIM)})`;
}

// Linha fixa quando registrarSessao falha com id válido: a sessão fica sem
// barra e sem alertas (spec 8.2), e isso aparece em vez de ficar calado.
export function linhaSemRegistro(motivo) {
  return `claude-hadouken: sessão não registrada (${motivoFixo(motivo, MOTIVOS_REGISTRO)}); barra e alertas desligados nesta sessão.`;
}

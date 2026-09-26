import { faixa7d, LINHA_SEM_LEITURA } from '../alerta.js';
import { horaLocal, diaHora, janelaValida, numeroFinito } from '../util.js';

// Linhas que o SessionStart injeta no contexto do Claude. Spec 8.1, S1: só
// números finitos validados (com piso, como a barra e os alertas), a saída de
// horaLocal/diaHora e rótulos fixos deste arquivo. Nenhum texto lido de
// arquivo, stdin, ambiente ou do resultado de outra função entra aqui.

// A linha fixa de "sem leitura" mora em alerta.js (a mesma do alerta) e
// continua exportada daqui.
export { LINHA_SEM_LEITURA };

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

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pct = (x) => `${Math.floor(x)}%`;
const motivoFixo = (motivo, lista) => (typeof motivo === 'string' && lista.has(motivo) ? motivo : 'erro');

// "Consumo: 5h 42% (reset 18:40) · 7d 58% vs 41% esperado, modo econômico;
// reset qui 22:00." Janela ausente aparece como "sem leitura", nunca como 0;
// sem nenhuma janela, LINHA_SEM_LEITURA. A faixa de 7d é a de faixa7d, a
// regra única dos inteiros exibidos (Task 5). Nunca lança.
export function linhaEstado(limites, agoraMs) {
  try {
    const l = ehObjeto(limites) ? limites : {};
    // Cada janela passa de novo por janelaValida (util.js), o schema de
    // estado.js: quem chama já passa a saída de limitesValidos, e a checagem
    // garante que nenhum outro chamador faça a linha mostrar NaN.
    const f5 = janelaValida(l.five_hour);
    const f7 = numeroFinito(agoraMs) ? janelaValida(l.seven_day) : null;
    if (f5 === null && f7 === null) return LINHA_SEM_LEITURA;
    const partes = [f5 ? `5h ${pct(f5.used_percentage)} (reset ${horaLocal(f5.resets_at)})` : '5h sem leitura'];
    if (f7) {
      const { faixa, esperado } = faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs });
      if (!Object.hasOwn(ROTULO_7D, faixa) || !numeroFinito(esperado)) return LINHA_SEM_LEITURA;
      partes.push(`7d ${pct(f7.used_percentage)} vs ${pct(esperado)} esperado, modo ${ROTULO_7D[faixa]}; reset ${diaHora(f7.resets_at)}`);
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

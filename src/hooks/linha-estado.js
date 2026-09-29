import { LINHA_SEM_LEITURA } from '../alerta.js';
import { horaLocal, diaHora, janelaValida, numeroFinito } from '../util.js';
import { fraseEsgota } from '../uso/frase.js';

// Linhas que o SessionStart injeta no contexto do Claude. Spec 8.1, S1: só
// números finitos validados (com piso, como a barra e os alertas), a saída de
// horaLocal/diaHora e rótulos fixos deste arquivo. Nenhum texto lido de
// arquivo, stdin ou ambiente entra aqui; da frase de previsão (fraseEsgota,
// emenda E5) só passa o "quando" que casa com a lista fechada de QUANDO.

// A linha fixa de "sem leitura" mora em alerta.js (a mesma do alerta) e
// continua exportada daqui.
export { LINHA_SEM_LEITURA };

const JANELA_7D_MS = 7 * 24 * 3_600_000;
// As formas de momentoFalado (frase.js): "por volta das HH:MM", "<dia>
// <período>" e "em dd/mm". Qualquer outra coisa não entra na linha.
const QUANDO = String.raw`por volta das \d\d:\d\d|(?:hoje|amanhã|domingo|segunda|terça|quarta|quinta|sexta|sábado) (?:de madrugada|de manhã|à tarde|à noite)|em \d\d/\d\d`;
const ESGOTA = new RegExp(String.raw`^Nesse ritmo, esgota (${QUANDO}), antes do reinício `, 'u');
const NAO_ESGOTA = /^Nesse ritmo, não esgota antes do reinício /u;
const LIMITE = /^Limite atingido; /u;

// Cauda curta da linha (E5), da frase da janela de 7 d: "; nesse ritmo,
// esgota amanhã à noite", "; nesse ritmo, não esgota antes do reinício" ou
// "; limite semanal atingido". A data do reinício sai (já está no reset da
// linha): o texto entra no contexto do modelo, e cada palavra custa token.
// Sem frase (menos de 30 min decorridos, uso zero) ou fora das formas
// conhecidas: nenhuma cauda.
function cauda7d(f7, agoraMs) {
  const frase = fraseEsgota({ usado: f7.used_percentage, resetsAtMs: f7.resets_at * 1000, janelaMs: JANELA_7D_MS, agoraMs });
  if (typeof frase !== 'string') return '';
  if (LIMITE.test(frase)) return '; limite semanal atingido';
  if (NAO_ESGOTA.test(frase)) return '; nesse ritmo, não esgota antes do reinício';
  const m = ESGOTA.exec(frase);
  return m === null ? '' : `; nesse ritmo, esgota ${m[1]}`;
}

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

// "Consumo: 5h 25% (reset 17:20) · 7d 41% (reset seg 22:00); nesse ritmo,
// esgota amanhã à noite." (E5: saem o "esperado" e o modo). Janela ausente
// aparece como "sem leitura", nunca como 0; sem nenhuma janela,
// LINHA_SEM_LEITURA. A cauda vem de cauda7d. Nunca lança.
export function linhaEstado(limites, agoraMs) {
  try {
    const l = ehObjeto(limites) ? limites : {};
    // Cada janela passa de novo por janelaValida (util.js), o schema de
    // estado.js: quem chama já passa a saída de limitesValidos, e a checagem
    // garante que nenhum outro chamador faça a linha mostrar NaN. Sem agora
    // válido, a janela de 7 d não tem como ter o ritmo: sem leitura.
    const f5 = janelaValida(l.five_hour);
    const f7 = numeroFinito(agoraMs) ? janelaValida(l.seven_day) : null;
    if (f5 === null && f7 === null) return LINHA_SEM_LEITURA;
    const partes = [
      f5 ? `5h ${pct(f5.used_percentage)} (reset ${horaLocal(f5.resets_at)})` : '5h sem leitura',
      f7 ? `7d ${pct(f7.used_percentage)} (reset ${diaHora(f7.resets_at)})` : '7d sem leitura',
    ];
    return `Consumo: ${partes.join(' · ')}${f7 ? cauda7d(f7, agoraMs) : ''}.`;
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

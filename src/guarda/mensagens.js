import { effortValido, horaLocal, quandoLocal } from '../util.js';
import { numeroFinito } from '../base.js';

// Textos da guarda (spec v0.4.0 §8, com D1 e D4 emendados). Modelos fixos,
// preenchidos só com números validados aqui (Math.floor de porcentagem,
// inteiros de configuração), horários de horaLocal/quandoLocal e rótulos
// deste arquivo. Nada lido de arquivo, stdin, transcript ou frontmatter vira
// texto: o perfil do despacho chega como rótulo ('fable', 'outro') e o effort
// passa de novo por effortValido (a lista única de util.js). O modelo da
// sessão que avaliar.js tira do estado.json nunca entra aqui.

const H = 3_600_000;
const ROTULO = Object.freeze({ five_hour: '5h', seven_day: '7d', fable: 'Fable', 'fable-despachos': 'Fable', ilegivel: 'ilegível' });
const ROTULO_TRAVA = Object.freeze({ five_hour: 'de 5h', seven_day: 'de 7d', fable: 'do Fable', 'fable-despachos': 'dos despachos Fable' });
const pct = (n) => (numeroFinito(n) ? String(Math.floor(n)) : '—');
const inteiro = (n) => (Number.isInteger(n) && n >= 0 ? String(n) : '—');
const segundos = (ms) => (numeroFinito(ms) ? ms / 1000 : NaN);

function teto(janela, d) {
  if (d.fresca) return `${janela} em ${pct(d.usado)}%, teto ${inteiro(d.teto)}%`;
  const horas = numeroFinito(d.idadeMs) ? Math.max(1, Math.floor(d.idadeMs / H)) : 1;
  return `${janela} ≥ ${pct(d.usado)}% (leitura de ${horas} h)`;
}

// Um motivo em texto. Sem os dados do disparo de agora (a trava veio do
// guarda.json com outro gatilho, §4.1), o texto genérico da trava.
export function textoMotivo(mo, agoraMs) {
  try {
    if (mo.trava === 'ilegivel') return 'estado da guarda ilegível';
    const d = mo.dados;
    if (d) {
      switch (mo.gatilho) {
        case 'G1': return `5h chega a 100% às ${horaLocal(segundos(d.quandoMs))}, antes do reset das ${horaLocal(mo.resets_at)}`;
        case 'G2': return `7d chega a 100% ${quandoLocal(segundos(d.quandoMs), agoraMs)}, antes do reset ${quandoLocal(mo.resets_at, agoraMs)}`;
        case 'G3': return teto('5h', d);
        case 'G4': return teto('7d', d);
        case 'G6': return `limite do Fable atingido ${quandoLocal(segundos(d.atMs), agoraMs)}`;
        case 'G7': return `${inteiro(d.n)} despachos Fable em ${inteiro(d.horas)} h, teto ${inteiro(d.max)}`;
        default: break;
      }
    }
    const desde = Date.parse(mo.desde);
    return `trava ${ROTULO_TRAVA[mo.trava] ?? 'da guarda'} desde ${quandoLocal(segundos(desde), agoraMs)}`;
  } catch {
    return 'guarda ativa';
  }
}

export const textoMotivos = (motivos, agoraMs) => motivos.map((mo) => textoMotivo(mo, agoraMs)).join('; ');

// G6 só sai com o escopo fable (§5.2): o comando sugerido já o traz.
export const sufixoLiberar = (ativas) => (ativas.includes('fable') ? ' fable' : '');

export const p1Claude = (motivos, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Despacho de subagente bloqueado. Pare e pergunte ao usuário se ele libera; só ele libera, digitando /claude-hadouken:liberar. Não mude o plano dele por conta própria, não repita o despacho e não mexa nos arquivos do hadouken.`;
export const p1Usuario = (motivos, ativas, agoraMs) => `hadouken parou o turno: ${textoMotivos(motivos, agoraMs)}. Para seguir, digite /claude-hadouken:liberar${sufixoLiberar(ativas)}.`;
export const p1Subagente = (motivos, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Novo despacho bloqueado. Termine sua tarefa sem abrir subagentes e relate o bloqueio.`;

// G5 (D1 emendado): só o rótulo 'fable' e o effort validado; nunca o nome
// do modelo pedido.
export function caroMotivo(perfil) {
  const effort = effortValido(perfil?.effort) ?? '—';
  return perfil?.modelo === 'fable' ? `despacho caro: Fable com effort ${effort}` : `despacho caro: effort ${effort}`;
}
export const caroClaude = (perfil) => `hadouken: ${caroMotivo(perfil)}. Despacho bloqueado. Pare e pergunte ao usuário se ele libera ou prefere um modelo ou effort mais barato; só ele libera, digitando /claude-hadouken:liberar caro. Não repita o despacho e não mexa nos arquivos do hadouken.`;
export const caroUsuario = (perfil) => `hadouken parou o turno: ${caroMotivo(perfil)}. Para seguir, digite /claude-hadouken:liberar caro.`;
export const caroSubagente = (perfil) => `hadouken: ${caroMotivo(perfil)}. Despacho bloqueado. Termine sua tarefa sem abrir esse subagente e relate o bloqueio.`;

export const p2Usuario = (motivos, ativas, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Esta sessão está no Fable. Troque com /model ou libere com /claude-hadouken:liberar${sufixoLiberar(ativas)}.`;
export const p3Usuario = (motivos, ativas, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Troca para o Fable bloqueada; libere com /claude-hadouken:liberar${sufixoLiberar(ativas)}.`;
export const P4_TEXTO = 'hadouken: bloqueado: sessões claude filhas ficam fechadas com a guarda ativa.';
export const P5_TEXTO = 'hadouken: bloqueado: arquivos do hadouken só o usuário edita.';

// Prazo da liberação (§6.2 e D4): a hora e, com base de 7d, o ponto de 7d
// em que ela acaba antes.
function prazo(lib, agoraMs) {
  const q = quandoLocal(segundos(Date.parse(lib.ate)), agoraMs);
  return numeroFinito(lib.base7d) ? { q, pontos: `7d ${pct(lib.base7d + lib.tetoPontos7d)}%` } : { q, pontos: null };
}
// Os escopos extras. Ao usuário, o aviso de créditos do Fable (§6.2); ao
// Claude, só o fato.
function extras(lib, comAviso) {
  const e = [];
  if (lib.solta.includes('fable')) e.push(comAviso ? 'Fable (pode consumir créditos de uso)' : 'Fable');
  if (lib.solta.includes('despacho-caro')) e.push('despacho caro');
  return e.length ? `, com ${e.join(' e ')}` : '';
}
export function liberado(lib, agoraMs) {
  const { q, pontos } = prazo(lib, agoraMs);
  return `hadouken: liberado até ${q}${pontos ? ` (ou até ${pontos})` : ''}${extras(lib, true)}.`;
}
export function posLiberacao(lib, agoraMs) {
  const { q, pontos } = prazo(lib, agoraMs);
  return `hadouken: o usuário liberou a guarda até ${q}${pontos ? ` ou até ${pontos}` : ''}${extras(lib, false)}.`;
}
export const recusadoArgs = (maxH) => `hadouken: nada liberado. Use /claude-hadouken:liberar [Nh | janela] [fable] [caro], com N de 1 a ${inteiro(maxH)}.`;
export const RECUSADO_ENTRYPOINT = 'hadouken: nada liberado. A liberação só vale digitada pelo usuário numa sessão interativa.';
export const NAO_GRAVADO = 'hadouken: nada liberado. A liberação não pôde ser gravada.';

// Segmento da barra (§8.3). Vazio com a guarda armada e sessão fora do Fable.
export function segmentoBarra(o, agoraMs) {
  try {
    if (!o.marcada) return 'sem guarda nesta sessão';
    const partes = [];
    if (o.status === 'desligada') partes.push('guarda desligada');
    else if (o.status === 'erro') partes.push('guarda com erro');
    else if (o.status === 'sem-leitura') partes.push('guarda sem leitura');
    else if (o.status === 'disparada') partes.push(`guarda: ${[...new Set(o.ativas.map((k) => ROTULO[k] ?? 'guarda'))].join(' + ')}`);
    else if (o.status === 'liberada' && o.liberacao) {
      partes.push(`liberada até ${quandoLocal(segundos(Date.parse(o.liberacao.ate)), agoraMs)}`);
      if (!o.origemConhecida) partes.push('liberação sem origem');
    }
    if (o.fableSessao) {
      const horas = o.config.fableDespachosHoras;
      const n = o.despachosFable.filter((t) => t > agoraMs - horas * H).length;
      partes.push(`Fable ${n}/${inteiro(o.config.fableDespachosMax)} em ${inteiro(horas)}h`, 'sem leitura oficial');
    }
    return partes.join(' · ');
  } catch {
    return 'guarda com erro';
  }
}

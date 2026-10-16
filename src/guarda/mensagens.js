import { effortValido, horaLocal, quandoLocal } from '../util.js';
import { numeroFinito } from '../base.js';
import { FRESCA_FABLE_MS, contarNaJanela } from './gatilhos.js';

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
        case 'G7': return numeroFinito(d.pct)
          ? `Fable em ${pct(d.pct)}% da semana: todo despacho Fable pede liberação`
          : `${inteiro(d.n)} despachos Fable em ${inteiro(d.horas)} h, teto ${inteiro(d.max)}`;
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

export const p1Claude = (motivos, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Despacho de subagente bloqueado. Pare e pergunte ao usuário se ele libera; só ele libera, digitando /hadouken:liberar. Não mude o plano dele por conta própria, não repita o despacho e não mexa nos arquivos do hadouken.`;
export const p1Usuario = (motivos, ativas, agoraMs) => `hadouken parou o turno: ${textoMotivos(motivos, agoraMs)}. Para seguir, digite /hadouken:liberar${sufixoLiberar(ativas)}.`;
export const p1Subagente = (motivos, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Novo despacho bloqueado. Termine sua tarefa sem abrir subagentes e relate o bloqueio.`;

// G5 (D1 emendado): só o rótulo 'fable' e o effort validado; nunca o nome
// do modelo pedido.
export function caroMotivo(perfil) {
  const effort = effortValido(perfil?.effort) ?? '—';
  return perfil?.modelo === 'fable' ? `despacho caro: Fable com effort ${effort}` : `despacho caro: effort ${effort}`;
}
export const caroClaude = (perfil) => `hadouken: ${caroMotivo(perfil)}. Despacho bloqueado. Pare e pergunte ao usuário se ele libera ou prefere um modelo ou effort mais barato; só ele libera, digitando /hadouken:liberar caro. Não repita o despacho e não mexa nos arquivos do hadouken.`;
export const caroUsuario = (perfil) => `hadouken parou o turno: ${caroMotivo(perfil)}. Para seguir, digite /hadouken:liberar caro.`;
export const caroSubagente = (perfil) => `hadouken: ${caroMotivo(perfil)}. Despacho bloqueado. Termine sua tarefa sem abrir esse subagente e relate o bloqueio.`;

export const p2Usuario = (motivos, ativas, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Esta sessão está no Fable. Troque com /model ou libere com /hadouken:liberar${sufixoLiberar(ativas)}.`;
export const p3Usuario = (motivos, ativas, agoraMs) => `hadouken: guarda ativa: ${textoMotivos(motivos, agoraMs)}. Troca para o Fable bloqueada; libere com /hadouken:liberar${sufixoLiberar(ativas)}.`;
export const P4_TEXTO = 'hadouken: bloqueado: sessões claude filhas ficam fechadas com a guarda ativa.';
export const P5_TEXTO = 'hadouken: bloqueado: arquivos do hadouken só o usuário edita.';
// P5 estendida (Task 0 da parte 2): os settings do usuário e o próprio
// plugin, negados sempre; nos settings de projeto, só a edição que mexe nos
// hooks ou nos plugins. O texto nunca ecoa o pedido: o Claude mostra o trecho
// na conversa por conta própria.
export const P5_PROTEGIDO_TEXTO = 'hadouken: bloqueado: o hadouken não deixa o Claude editar este arquivo (settings do Claude Code ou o próprio plugin). Mostre a mudança na conversa; o usuário a aplica à mão.';
export const P5_SETTINGS_PROJETO_TEXTO = 'hadouken: bloqueado: o hadouken não deixa o Claude mexer em hooks, disableAllHooks, enabledPlugins nem no hadouken nos settings do projeto. Mostre a mudança na conversa; o usuário a aplica à mão. O resto do arquivo segue editável.';
// Stdin da P5 acima de 1 MiB que cita settings ou hadouken (rodada 3 da
// revisão da Task 0): o JSON não é lido; a edição menor passa pela
// conferência de sempre.
export const P5_GRANDE_TEXTO = 'hadouken: bloqueado: esta edição passa de 1 MiB e cita settings ou o hadouken; grande assim, o hadouken não a confere. Divida a edição em partes menores.';
// Hook ConfigChange (Task 19b, spike S13 (a)): o reason do bloqueio da
// mudança nos campos da guarda dos settings, feita fora da P5 (sed -i pelo
// shell, ou o próprio usuário). Nunca ecoa o arquivo nem o caminho.
export const CONFIG_BLOQUEADA_TEXTO = 'hadouken: bloqueado: uma mudança em disableAllHooks, enabledPlugins ou hooks nos settings não vale nesta sessão. Se foi o usuário, ela passa a valer na próxima sessão; o Claude não deve repetir a mudança.';
// Regra fixa da P4 (decisão do controlador na revisão da Task 13): claude
// junto com o comando de liberação, negado sempre, disparada ou não. Desde a
// rodada 2 da revisão da Task 16 o texto que só cita 'hadouken:liberar' (numa
// mensagem de commit, num grep) também nega; a última frase aponta a saída.
export const P4_LIBERAR_TEXTO = 'hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /hadouken:liberar. Se o texto só cita o comando (numa mensagem de commit, por exemplo), use git commit -F <arquivo>.';
// Hook da agenda (C1 da revisão final da parte 1): CronCreate, ScheduleWakeup
// e RemoteTrigger com o pedido de liberação no texto, negados sempre. Desde a
// Task 11 do aprendizado, também o /hadouken:aprender.
export const AGENDA_LIBERAR_TEXTO = 'hadouken: bloqueado: uma tarefa agendada, um loop ou uma rotina não libera a guarda nem mexe no aprendizado. Pare e pergunte ao usuário; só ele faz isso, digitando /hadouken:liberar ou /hadouken:aprender. Se o texto só cita o comando, tire-o do prompt agendado.';

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
export const recusadoArgs = (maxH) => `hadouken: nada liberado. Use /hadouken:liberar [Nh | janela] [fable] [caro], com N de 1 a ${inteiro(maxH)}.`;
export const RECUSADO_ENTRYPOINT = 'hadouken: nada liberado. A liberação só vale digitada pelo usuário numa sessão interativa.';
// C1 da revisão final da parte 1: a expansão que não vem do comando digitado
// (command_source ou expansion_type fora da lista fechada de liberar.js).
export const RECUSADO_ORIGEM = 'hadouken: nada liberado. A liberação só vale digitada pelo usuário na conversa; tarefa agendada, /loop e ferramenta não liberam.';
export const NAO_GRAVADO = 'hadouken: nada liberado. A liberação não pôde ser gravada.';
// /hadouken:liberar off | on: a chave guarda.ligada do config.json.
export const GUARDA_DESLIGADA = 'hadouken: guarda de consumo desligada. Nada mais trava por consumo até você digitar /hadouken:liberar on.';
export const GUARDA_LIGADA = 'hadouken: guarda de consumo ligada de novo.';
export const GUARDA_NAO_ALTERADA = 'hadouken: nada mudou. O config.json do hadouken não pôde ser lido ou gravado; corrija o arquivo e tente de novo.';

// Semana do Fable na barra (§8.3 com as emendas E2 e E7): a §7 mudou, e o
// Fable tem leitura oficial (uso-oficial.json, pelo /usage). Até 15 min, o
// número; mais velha, "≥" com a idade (a semana só sobe até o reset); sem
// leitura válida, ou lida antes do reset do Fable, "sem leitura oficial".
function semanaFable(u, agoraMs) {
  const SEM = 'sem leitura oficial';
  if (u === null || typeof u !== 'object') return SEM;
  if (!numeroFinito(u.pct) || u.pct < 0 || u.pct > 100 || !numeroFinito(u.idadeMs) || u.idadeMs < 0) return SEM;
  if (u.resetsAtMs !== null && !(numeroFinito(u.resetsAtMs) && u.resetsAtMs > agoraMs)) return SEM;
  if (u.idadeMs <= FRESCA_FABLE_MS) return `semana Fable ${pct(u.pct)}%`;
  const idade = u.idadeMs < H ? `${Math.floor(u.idadeMs / 60_000)} min` : `${Math.floor(u.idadeMs / H)} h`;
  return `semana Fable ≥ ${pct(u.pct)}% (leitura de ${idade})`;
}

// Segmento da barra (§8.3). Vazio com a guarda armada e sessão fora do Fable.
// M3 da revisão final da parte 1: a liberação em vigor aparece também ao lado
// das travas que ela não cobre (a statusline só a passa com a cobertura
// ativa); a barra mostra toda liberação (§6.5, R1). M4: erroRecente (evento
// 'erro' de hook nos últimos 15 min, statusline.js) mostra "guarda com erro"
// (§4.5), uma vez só; com a guarda desligada, só "guarda desligada".
export function segmentoBarra(o, agoraMs) {
  try {
    if (!o.marcada) return 'sem guarda nesta sessão';
    const partes = [];
    const valendo = o.status !== 'desligada' && o.status !== 'erro';
    if (o.status === 'desligada') partes.push('guarda desligada');
    else if (o.status === 'erro') partes.push('guarda com erro');
    else if (o.status === 'sem-leitura') partes.push('guarda sem leitura');
    else if (o.status === 'disparada') partes.push(`guarda: ${[...new Set(o.ativas.map((k) => ROTULO[k] ?? 'guarda'))].join(' + ')}`);
    if (valendo && o.erroRecente === true) partes.push('guarda com erro');
    if (valendo && o.liberacao) {
      partes.push(`liberada até ${quandoLocal(segundos(Date.parse(o.liberacao.ate)), agoraMs)}`);
      if (!o.origemConhecida) partes.push('liberação sem origem');
    }
    if (o.fableSessao) {
      const horas = o.config.fableDespachosHoras;
      const n = contarNaJanela(o.despachosFable, horas, agoraMs).length;
      partes.push(`Fable ${n}/${inteiro(o.config.fableDespachosMax)} em ${inteiro(horas)}h`, semanaFable(o.usoFable ?? null, agoraMs));
    }
    return partes.join(' · ');
  } catch {
    return 'guarda com erro';
  }
}

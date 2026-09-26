import fs from 'node:fs';
import path from 'node:path';
import { effortValido, janelaValida, sanear, TOLERANCIA_JANELA_S } from './util.js';
import {
  apagar, codigoErro, DATA_MAX_MS, dirDados, esperar, idValido, instante, numeroFinito, RENOMEAR_ESPERA_MS,
  RENOMEAR_TENTATIVAS, renomearDeNovo, varrerTmpVelhos,
} from './base.js';

// dirDados, idValido e instante moram em base.js (o caminho curto da barra
// os usa sem carregar este arquivo) e continuam exportados daqui.
export { dirDados, idValido, instante } from './base.js';

// Camada de estado: a statusline grava `estado.json`; hooks e relatório só
// leem. É a fronteira de confiança dos dados em disco (spec 8.1, S1–S3, S9):
// nada lido do arquivo ou do stdin sai daqui sem passar pelo schema abaixo.

export const LIMITE_VELHO_MS = 3_600_000;
export const ARQ_ESTADO = 'estado.json';
// Idade máxima de uma sessão guardada em estado.sessoes (poda de 24 h). O
// registro de ativação tem vigência própria (ativas.js, ATIVA_MAX_MS).
export const SESSAO_MAX_MS = 24 * 3_600_000;

const VERSAO = 1;
const MAX_BYTES_PADRAO = 1_048_576;
const MAX_SESSOES = 50;
const MAX_MODEL = 40;
// cwd serve para exibir; nunca vira caminho de arquivo.
const MAX_CWD = 200;
const JANELAS = ['five_hour', 'seven_day'];
// Duração de cada janela em segundos: uma guardada com reset além de agora +
// duração + tolerância não pode ter vindo do servidor (relógio, arquivo mexido)
// e não segura leitura nenhuma na mescla.
const DURACAO_S = { five_hour: 5 * 3600, seven_day: 7 * 86_400 };

// O_NONBLOCK (onde existe) impede que um FIFO posto no lugar do arquivo trave
// o open (o tipo é conferido depois, pelo fstat); em arquivo regular não muda nada. No Windows a
// constante não existe e o open de um pipe nomeado não bloqueia.
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);
const PEDACO_LEITURA = 65_536;
// A política de retentativa do rename (RENOMEAR_*, renomearDeNovo), apagar e
// esperar vêm de base.js, divididos com shim.js e configuracao.js.
// Temporários `<arquivo>.<pid>.<ms>.<seq>.tmp` deixados por um processo morto
// entre a escrita e o rename: varridos depois de 1 h pela varredura limitada
// de base.js (O-1: no máximo 256 entradas lidas, 64 lstat e 20 remoções por
// gravação, em vez da pasta de dados listada inteira a cada redesenho).
const MEIO_TMP = /^\d+\.\d+\.\d+$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const noIntervalo = (n, min, max) => (numeroFinito(n) && n >= min && n <= max ? n : null);

// Lê um JSON de estado com teto de tamanho. `maxBytes` inválido usa o padrão
// (1 MB). Motivos: 'ausente' (não existe ou não dá para ler), 'invalido' (não é
// arquivo regular ou não é JSON) e 'grande' (acima do teto). Nunca lança.
export function lerJson(arquivo, maxBytes = MAX_BYTES_PADRAO) {
  const limite = numeroFinito(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : MAX_BYTES_PADRAO;
  const lido = lerLimitado(arquivo, limite);
  if (!lido.ok) return lido;
  let texto = lido.bytes.toString('utf8');
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  try { return { ok: true, valor: JSON.parse(texto) }; } catch { return { ok: false, motivo: 'invalido' }; }
}

// Abre, confere pelo fstat do mesmo descritor que é arquivo regular dentro do
// teto e lê no máximo limite + 1 bytes, para que um arquivo trocado ou
// crescendo depois do open não fure o teto. Sem stat antes do open (C3 da
// revisão da Task 7, uma chamada a menos por leitura no caminho quente): o
// fstat já decidia, porque o stat nunca protegeu contra o que fosse trocado
// entre ele e o open. O que o stat recusava antes (pasta, junção, FIFO,
// dispositivo) agora é aberto e recusado aqui sem ler um byte; o O_NONBLOCK
// impede que um FIFO trave o open.
function lerLimitado(arquivo, limite) {
  let fd;
  try {
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
  } catch (e) {
    return { ok: false, motivo: motivoSemAbrir(arquivo, limite, e) };
  }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile()) return { ok: false, motivo: 'invalido' };
    if (info.size > limite) return { ok: false, motivo: 'grande' };
    const partes = [];
    const pedaco = Buffer.allocUnsafe(PEDACO_LEITURA);
    let total = 0;
    for (;;) {
      const n = fs.readSync(fd, pedaco, 0, pedaco.length, null);
      if (n === 0) break;
      total += n;
      if (total > limite) return { ok: false, motivo: 'grande' };
      partes.push(Buffer.from(pedaco.subarray(0, n)));
    }
    return { ok: true, bytes: Buffer.concat(partes, total) };
  } catch {
    return { ok: false, motivo: 'ausente' };
  } finally {
    try { fs.closeSync(fd); } catch { /* já fechado */ }
  }
}

// O open falhou: o mesmo motivo que o stat antes do open dava. Caminho que não
// existe (ENOENT, ou ENOTDIR quando um trecho é arquivo) é 'ausente' direto,
// sem chamada nenhuma a mais. Outro erro (socket no POSIX, pasta sem permissão
// de leitura, arquivo preso por outro processo no Windows) consulta o stat, só
// neste caminho de erro, para que o que não é arquivo regular continue
// 'invalido' e um arquivo acima do teto continue 'grande'.
function motivoSemAbrir(arquivo, limite, erro) {
  if (erro?.code === 'ENOENT' || erro?.code === 'ENOTDIR') return 'ausente';
  try {
    const info = fs.statSync(arquivo);
    if (!info.isFile()) return 'invalido';
    return info.size > limite ? 'grande' : 'ausente';
  } catch {
    return 'ausente';
  }
}

let sequenciaTmp = 0;

// Grava num temporário ao lado do destino e renomeia. No POSIX o rename é
// atômico: um leitor concorrente vê o arquivo antigo inteiro ou o novo inteiro.
// No Windows é melhor esforço: o rename sobre um destino que outro processo
// mantém aberto falha com EPERM (daí as 3 tentativas com 20 ms), e um leitor no
// instante exato da troca pode não achar o arquivo e ver "sem leitura" por uma
// atualização. Em nenhum sistema sai arquivo pela metade: se o rename falha, o
// destino antigo fica intacto e o temporário é apagado. Depois de gravar, varre
// os próprios temporários abandonados. `opcoes.compacto === true` grava o JSON
// sem espaços (o índice de transcripts, que mede o próprio tamanho nesse
// formato); qualquer outro valor, ou opção ilegível, grava indentado com 2
// espaços. Nunca lança.
export function gravarJsonAtomico(arquivo, valor, opcoes) {
  let compacto = false;
  try { compacto = opcoes?.compacto === true; } catch { /* opção ilegível: indentado */ }
  let texto;
  try { texto = compacto ? JSON.stringify(valor) : JSON.stringify(valor, null, 2); } catch { return { ok: false, motivo: 'serializacao' }; }
  if (typeof texto !== 'string') return { ok: false, motivo: 'serializacao' };
  let tmp = null;
  try {
    tmp = `${arquivo}.${process.pid}.${Date.now()}.${sequenciaTmp++}.tmp`;
    escreverTmp(arquivo, tmp, texto);
  } catch (e) {
    if (tmp !== null && e?.code !== 'EEXIST') apagar(tmp);
    return { ok: false, motivo: codigoErro(e, 'escrita') };
  }
  let erro;
  for (let tentativa = 1; tentativa <= RENOMEAR_TENTATIVAS; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      varrerTmpVelhos(path.dirname(arquivo), tmpDe(arquivo));
      return { ok: true };
    } catch (e) {
      erro = e;
      if (!renomearDeNovo(e, tentativa)) break;
      esperar(RENOMEAR_ESPERA_MS);
    }
  }
  apagar(tmp);
  return { ok: false, motivo: codigoErro(erro, 'rename') };
}

// Cria o temporário com 'wx' (O_EXCL): nunca segue nem reaproveita o que já
// estiver nesse caminho. A pasta só é criada quando falta (C3 da revisão da
// Task 7): no caminho quente ela existe, e o mkdir recursivo antes de toda
// gravação era uma chamada a mais. Se o temporário não nasce por falta de
// pasta (ENOENT, ou ENOTDIR no POSIX quando um trecho é arquivo), roda o mesmo
// mkdir de antes, que falha com o mesmo motivo quando um trecho é arquivo, e
// tenta uma vez mais. Erro sobe para gravarJsonAtomico.
function escreverTmp(arquivo, tmp, texto) {
  try {
    fs.writeFileSync(tmp, texto, { flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(tmp, texto, { flag: 'wx' });
  }
}

// Reconhece exatamente o nome de temporário que gravarJsonAtomico gera para
// `arquivo`; nada de outro destino. A varredura (base.js) só remove arquivo
// regular com esse nome e mais de 1 h, e nunca lança.
function tmpDe(arquivo) {
  const prefixo = `${path.basename(arquivo)}.`;
  return (nome) => nome.startsWith(prefixo) && nome.endsWith('.tmp')
    && MEIO_TMP.test(nome.slice(prefixo.length, -'.tmp'.length));
}

function estadoVazio() {
  return { versao: VERSAO, at: null, five_hour: null, seven_day: null, sessoes: Object.create(null) };
}

// Janela guardada em estado.json (I-2 da revisão final, N-6 do ledger): a de
// `janelaValida` (util.js) mais o `at` da última leitura real DESTA janela,
// em ISO canônico.
// Cada janela envelhece pelo próprio `at` (limitesValidos) e só segura leitura
// menor enquanto ele tem até LIMITE_VELHO_MS (mantemGuardada). Antes as duas
// dividiam o `at` do topo, e a janela segurada ganhava `at` novo sempre que a
// outra entrava: um valor alto ficava até a janela virar (5 h ou 7 dias).
// Formato de antes (`at` próprio ausente ou null): a janela vale com o `at` do
// topo (`tTopo`, já validado; null a descarta), fica com at null e nunca
// segura leitura nenhuma, porque aquele `at` pode ter sido renovado pela outra
// janela. Assim o arquivo antigo nunca estende uma retenção, e a primeira
// leitura válida da janela a substitui. `at` próprio presente e inválido (não
// textual, ilegível ou mais de 5 min no futuro, como depois de o relógio
// voltar) descarta a janela. Devolve { used_percentage, resets_at, at } ou null.
function janelaGuardada(j, tTopo, agoraMs) {
  const base = janelaValida(j);
  if (base === null) return null;
  const bruto = Object.hasOwn(j, 'at') ? j.at : undefined;
  if (bruto === undefined || bruto === null) return tTopo === null ? null : { ...base, at: null };
  const t = instante(bruto, agoraMs);
  return t === null ? null : { ...base, at: new Date(t).toISOString() };
}

// Instante (ms) da leitura de uma janela guardada: o próprio `at`, ou o do
// topo para a janela do formato de antes.
const leituraDe = (j, tTopo) => (j.at === null ? tTopo : Date.parse(j.at));

// `at` do topo: a leitura mais antiga entre as janelas guardadas (null sem
// janela nenhuma). É a idade que o relatório mostra e o `at` que uma versão
// anterior do plugin, que só conhece o do topo, usa para as duas janelas: com
// a mais antiga, as duas erram para o lado de "sem leitura", nunca para um
// valor velho exibido como atual.
function atDoTopo(janelas, tTopo) {
  let menor = null;
  for (const j of janelas) {
    const t = j === null ? null : leituraDe(j, tTopo);
    if (numeroFinito(t) && (menor === null || t < menor)) menor = t;
  }
  return menor === null ? null : new Date(menor).toISOString();
}

// O mesmo validador serve à sessão nova (stdin) e às lidas do disco.
function sessaoValida(bruta, agoraMs) {
  if (!ehObjeto(bruta)) return null;
  const t = instante(bruta.at, agoraMs);
  if (t === null || agoraMs - t > SESSAO_MAX_MS) return null;
  return {
    at: new Date(t).toISOString(),
    model: sanear(bruta.model, MAX_MODEL),
    effort: effortValido(bruta.effort),
    cwd: sanear(bruta.cwd, MAX_CWD),
    context_pct: noIntervalo(bruta.context_pct, 0, 100),
    cache_hit: noIntervalo(bruta.cache_hit, 0, 1),
  };
}

function sessoesValidas(bruto, agoraMs) {
  if (!ehObjeto(bruto)) return [];
  const lista = [];
  for (const [id, s] of Object.entries(bruto)) {
    if (!idValido(id)) continue;
    const v = sessaoValida(s, agoraMs);
    if (v) lista.push([id, v]);
  }
  return lista;
}

// Até MAX_SESSOES, as mais recentes primeiro; a atual, se houver, entra sempre.
// Mapa sem protótipo: nenhuma chave alcança Object.prototype e o JSON gravado
// continua um objeto comum.
function juntarSessoes(lista, atual) {
  const outras = lista
    .filter(([id]) => atual === null || id !== atual[0])
    .map(([id, s]) => [id, s, Date.parse(s.at)])
    .sort((a, b) => b[2] - a[2]);
  const escolhidas = atual === null ? outras.slice(0, MAX_SESSOES) : [atual, ...outras.slice(0, MAX_SESSOES - 1)];
  const sessoes = Object.create(null);
  for (const [id, s] of escolhidas) sessoes[id] = s;
  return sessoes;
}

function sessaoDaEntrada(e, agoraIso, agoraMs) {
  if (!idValido(e.session_id)) return null;
  const s = sessaoValida({
    at: agoraIso,
    model: ehObjeto(e.model) ? e.model.display_name : undefined,
    effort: e.effort,
    cwd: e.cwd,
    context_pct: ehObjeto(e.context_window) ? e.context_window.used_percentage : undefined,
    cache_hit: ehObjeto(e.prompt_cache) ? e.prompt_cache.hit_ratio : undefined,
  }, agoraMs);
  return s === null ? null : [e.session_id, s];
}

// Estado lido do disco (ou de qualquer origem) reconstruído só com campos que
// passam no schema; versão desconhecida ou formato errado → null. Cada janela
// passa por janelaGuardada (o próprio `at`, ou o do topo no formato de antes;
// `at` inválido ou mais de 5 min no futuro a descarta) e o `at` do topo é
// refeito por atDoTopo, nunca copiado do arquivo; cada sessão é validada à
// parte. `sessoes` volta sem protótipo. Nunca lança.
export function validarEstado(valor, agoraMs) {
  try {
    if (!ehObjeto(valor) || valor.versao !== VERSAO || !numeroFinito(agoraMs)) return null;
    const estado = estadoVazio();
    const tTopo = instante(valor.at, agoraMs);
    estado.five_hour = janelaGuardada(valor.five_hour, tTopo, agoraMs);
    estado.seven_day = janelaGuardada(valor.seven_day, tTopo, agoraMs);
    estado.at = atDoTopo([estado.five_hour, estado.seven_day], tTopo);
    estado.sessoes = juntarSessoes(sessoesValidas(valor.sessoes, agoraMs), null);
    return estado;
  } catch {
    return null;
  }
}

// Mescla por janela (I-4, spec 7 #3/#4): a leitura nova de uma janela perde
// para a guardada quando a guardada ainda vale (reset no futuro e plausível) e
// a nova é da mesma janela com percentual menor, ou de fato de uma janela
// anterior: já vencida, ou com reset uma duração inteira (menos a tolerância)
// antes do da guardada, isto é, a janela que acabou quando a guardada começou.
// Assim a leitura antiga de uma sessão ociosa nunca baixa o snapshot nem o
// carimba como recente. Trade-off: se a janela de 5 h for de fato móvel, o
// máximo pode exagerar o uso até a janela virar (o lado seguro).
// N-1: uma leitura com reset mais cedo mas ainda no futuro e a menos de uma
// duração da guardada não é janela anterior da mesma conta (essa venceu antes
// de a guardada começar); é a janela atual de outra conta (/login em outra
// conta, ou outro CLAUDE_CONFIG_DIR) e entra: vale a leitura mais recente.
// Limite conhecido: duas sessões simultâneas em duas contas alternam o
// snapshot (a última leitura ganha) até o estado ser separado por conta.
// Só segura com a leitura própria da guardada fresca (fix round 3, por janela
// desde I-2): com o `at` DESTA janela a mais de LIMITE_VELHO_MS, ou sem `at`
// próprio (formato de antes), qualquer leitura válida dela entra. Um valor
// plantado ou de outra conta segura no máximo 1 h depois da última leitura
// real, mesmo com a outra janela entrando a cada leitura. A folga de relógio
// de instante (`at` até 5 min no futuro, que cobre a barra que tomou o agora
// antes de outra gravar) pode somar no máximo 5 min a essa hora; relógio que
// volta mais que isso descarta a janela, e a leitura nova entra.
function mantemGuardada(guardada, nova, duracaoS, agoraMs) {
  if (!ehObjeto(guardada) || !numeroFinito(guardada.resets_at) || !numeroFinito(guardada.used_percentage)) return false;
  const lidaEm = typeof guardada.at === 'string' ? instante(guardada.at, agoraMs) : null;
  if (lidaEm === null || agoraMs - lidaEm > LIMITE_VELHO_MS) return false;
  const agoraS = agoraMs / 1000;
  if (guardada.resets_at <= agoraS || guardada.resets_at > agoraS + duracaoS + TOLERANCIA_JANELA_S) return false;
  if (nova.resets_at <= agoraS) return true;
  const delta = nova.resets_at - guardada.resets_at;
  if (Math.abs(delta) <= TOLERANCIA_JANELA_S) return nova.used_percentage < guardada.used_percentage;
  return delta <= -(duracaoS - TOLERANCIA_JANELA_S);
}

// Junta a entrada da statusline ao estado gravado e regrava `estado.json`.
// Cada janela da leitura nova passa por mantemGuardada. A que entra ganha
// `at` = agora; a segurada fica com o próprio `at`, que só uma leitura real
// dela renova (I-2). Se ao menos uma entrou, a janela que não veio na leitura
// fica null: nenhum valor guardado sobrevive a uma leitura de agora sem ter
// sido comparado. Se nenhuma entrou (sem leitura válida, ou só leituras
// seguradas), o instantâneo anterior fica como está, cada janela com seu `at`.
// O `at` do topo é sempre atDoTopo das janelas gravadas. Devolve o
// estado mesmo quando a gravação falha, para a barra seguir mostrando a
// leitura atual. Sem diretório de dados (dirDados() null) não faz I/O e
// devolve motivo 'sem_diretorio'. Nunca lança.
export function atualizarEstado(entrada, agoraMs) {
  try {
    const agoraIso = numeroFinito(agoraMs) && Math.abs(agoraMs) <= DATA_MAX_MS ? new Date(agoraMs).toISOString() : null;
    if (agoraIso === null) return { ok: false, motivo: 'agora', estado: estadoVazio() };
    const dir = dirDados();
    if (dir === null) return { ok: false, motivo: 'sem_diretorio', estado: estadoVazio() };
    const arq = path.join(dir, ARQ_ESTADO);
    const lido = lerJson(arq);
    const anterior = (lido.ok && validarEstado(lido.valor, agoraMs)) || estadoVazio();
    const e = ehObjeto(entrada) ? entrada : {};
    const rl = ehObjeto(e.rate_limits) ? e.rate_limits : {};
    const estado = estadoVazio();
    const novas = {};
    let entrou = false;
    // A mescla por janela só protege a guardada com leitura própria fresca
    // (mantemGuardada, a mesma régua de limitesValidos, que já não exibe a
    // janela velha): a leitura velha de uma sessão ociosa só ganha quando
    // ninguém leu aquela janela na última hora, e aí é o melhor dado que há.
    for (const k of JANELAS) {
      const nova = janelaValida(rl[k]);
      const fica = nova !== null && mantemGuardada(anterior[k], nova, DURACAO_S[k], agoraMs);
      if (fica) novas[k] = anterior[k];
      else novas[k] = nova === null ? null : { ...nova, at: agoraIso };
      if (nova !== null && !fica) entrou = true;
    }
    // Janela ausente na leitura vira null só quando outra entrou (a leitura é
    // de agora); se nada entrou, o snapshot guardado fica inteiro, com seus at.
    if (entrou) Object.assign(estado, { at: atDoTopo([novas.five_hour, novas.seven_day], null), ...novas });
    else Object.assign(estado, { at: anterior.at, five_hour: anterior.five_hour, seven_day: anterior.seven_day });
    estado.sessoes = juntarSessoes(Object.entries(anterior.sessoes), sessaoDaEntrada(e, agoraIso, agoraMs));
    const r = gravarJsonAtomico(arq, estado);
    return r.ok ? { ok: true, estado } : { ok: false, motivo: r.motivo, estado };
  } catch {
    return { ok: false, motivo: 'inesperado', estado: estadoVazio() };
  }
}

// Limites da conta que podem ser mostrados agora: cada janela envelhece pelo
// próprio `at` (janelaGuardada; no formato de antes, o do topo), com no
// máximo LIMITE_VELHO_MS de idade (e não mais que 5 min no futuro), passa no
// schema e tem reset ainda por vir. Devolve cópias só com used_percentage e
// resets_at. Nada válido → null. Nunca devolve resets_at ausente ou não
// finito. Nunca lança.
export function limitesValidos(estado, agoraMs) {
  try {
    if (!ehObjeto(estado) || estado.versao !== VERSAO || !numeroFinito(agoraMs)) return null;
    const tTopo = instante(estado.at, agoraMs);
    const limites = {};
    for (const k of JANELAS) {
      const j = janelaGuardada(estado[k], tTopo, agoraMs);
      if (j === null || agoraMs - leituraDe(j, tTopo) > LIMITE_VELHO_MS || j.resets_at * 1000 <= agoraMs) continue;
      limites[k] = { used_percentage: j.used_percentage, resets_at: j.resets_at };
    }
    return limites.five_hour || limites.seven_day ? limites : null;
  } catch {
    return null;
  }
}

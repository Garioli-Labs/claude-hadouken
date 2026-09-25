import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { effortValido, sanear, TOLERANCIA_JANELA_S } from './util.js';

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
// Tolerância para relógio adiantado: um `at` até 5 min no futuro ainda vale.
const FUTURO_MAX_MS = 5 * 60_000;
// Um instante ISO tem 24 caracteres; texto maior que isto nem vai ao Date.parse.
const MAX_AT_CHARS = 64;
const MAX_MODEL = 40;
// cwd serve para exibir; nunca vira caminho de arquivo.
const MAX_CWD = 200;
const ID_SESSAO = /^[A-Za-z0-9_-]{1,64}$/;
const JANELAS = ['five_hour', 'seven_day'];
// Duração de cada janela em segundos: uma guardada com reset além de agora +
// duração + tolerância não pode ter vindo do servidor (relógio, arquivo mexido)
// e não segura leitura nenhuma na mescla.
const DURACAO_S = { five_hour: 5 * 3600, seven_day: 7 * 86_400 };

// O_NONBLOCK (onde existe) impede que um FIFO posto no lugar do arquivo entre o
// stat e o open trave a barra; em arquivo regular não muda nada. No Windows a
// constante não existe e o open de um pipe nomeado não bloqueia.
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);
const PEDACO_LEITURA = 65_536;
const RENOMEAR_TENTATIVAS = 3;
const RENOMEAR_ESPERA_MS = 20;
// No Windows um antivírus, indexador ou leitor concorrente pode segurar o
// destino por instantes; outros erros não melhoram tentando de novo.
const RENOMEAR_TRANSITORIOS = new Set(['EPERM', 'EACCES', 'EBUSY']);
// Temporários `<arquivo>.<pid>.<ms>.<seq>.tmp` deixados por um processo morto
// entre a escrita e o rename: varridos depois de 1 h, no máximo 20 por gravação.
const TMP_VELHO_MS = 3_600_000;
const TMP_VARRER_MAX = 20;
const MEIO_TMP = /^\d+\.\d+\.\d+$/;

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const noIntervalo = (n, min, max) => (numeroFinito(n) && n >= min && n <= max ? n : null);
const codigoErro = (e, padrao) => (typeof e?.code === 'string' ? e.code : padrao);
const apagar = (arquivo) => { try { fs.unlinkSync(arquivo); } catch { /* já não existe */ } };
const esperar = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* segue sem esperar */ }
};

// Diretório de dados, sempre absoluto: HADOUKEN_HOME (resolvido contra o cwd
// no momento da chamada, para que caminhos derivados, como shims e o comando
// da statusline, não dependam do cwd de quem os usa depois) ou
// ~/.claude/hadouken. Sem home conhecida (os.homedir() lança ou não devolve
// caminho absoluto) devolve null, nunca um diretório compartilhado: todo
// chamador trata null como "sem leitura" e não faz I/O (contrato de T6, T7 e
// T10). Nunca lança.
export function dirDados() {
  try {
    const configurado = process.env.HADOUKEN_HOME;
    if (configurado) return path.resolve(configurado);
    const home = os.homedir();
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude', 'hadouken') : null;
  } catch {
    return null;
  }
}

// Lê um JSON de estado com teto de tamanho. `maxBytes` inválido usa o padrão
// (1 MB). Motivos: 'ausente' (não existe ou não dá para ler), 'invalido' (não é
// arquivo regular ou não é JSON) e 'grande' (acima do teto). Nunca lança.
export function lerJson(arquivo, maxBytes = MAX_BYTES_PADRAO) {
  const limite = numeroFinito(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : MAX_BYTES_PADRAO;
  let info;
  try { info = fs.statSync(arquivo); } catch { return { ok: false, motivo: 'ausente' }; }
  if (!info.isFile()) return { ok: false, motivo: 'invalido' };
  if (info.size > limite) return { ok: false, motivo: 'grande' };
  const lido = lerLimitado(arquivo, limite);
  if (!lido.ok) return lido;
  let texto = lido.bytes.toString('utf8');
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  try { return { ok: true, valor: JSON.parse(texto) }; } catch { return { ok: false, motivo: 'invalido' }; }
}

// Confere o tipo e lê no máximo limite + 1 bytes pelo mesmo descritor, para que
// um arquivo trocado ou crescendo depois do stat não fure o teto.
function lerLimitado(arquivo, limite) {
  let fd;
  try { fd = fs.openSync(arquivo, ABRIR_LEITURA); } catch { return { ok: false, motivo: 'ausente' }; }
  try {
    if (!fs.fstatSync(fd).isFile()) return { ok: false, motivo: 'invalido' };
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

let sequenciaTmp = 0;

// Grava num temporário ao lado do destino e renomeia. No POSIX o rename é
// atômico: um leitor concorrente vê o arquivo antigo inteiro ou o novo inteiro.
// No Windows é melhor esforço: o rename sobre um destino que outro processo
// mantém aberto falha com EPERM (daí as 3 tentativas com 20 ms), e um leitor no
// instante exato da troca pode não achar o arquivo e ver "sem leitura" por uma
// atualização. Em nenhum sistema sai arquivo pela metade: se o rename falha, o
// destino antigo fica intacto e o temporário é apagado. Depois de gravar, varre
// os próprios temporários abandonados. Nunca lança.
export function gravarJsonAtomico(arquivo, valor) {
  let texto;
  try { texto = JSON.stringify(valor, null, 2); } catch { return { ok: false, motivo: 'serializacao' }; }
  if (typeof texto !== 'string') return { ok: false, motivo: 'serializacao' };
  let tmp = null;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    tmp = `${arquivo}.${process.pid}.${Date.now()}.${sequenciaTmp++}.tmp`;
    // 'wx' (O_EXCL): nunca segue nem reaproveita o que já estiver nesse caminho.
    fs.writeFileSync(tmp, texto, { flag: 'wx' });
  } catch (e) {
    if (tmp !== null && e?.code !== 'EEXIST') apagar(tmp);
    return { ok: false, motivo: codigoErro(e, 'escrita') };
  }
  let erro;
  for (let tentativa = 1; tentativa <= RENOMEAR_TENTATIVAS; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      varrerTmpVelhos(arquivo);
      return { ok: true };
    } catch (e) {
      erro = e;
      if (!RENOMEAR_TRANSITORIOS.has(e?.code) || tentativa === RENOMEAR_TENTATIVAS) break;
      esperar(RENOMEAR_ESPERA_MS);
    }
  }
  apagar(tmp);
  return { ok: false, motivo: codigoErro(erro, 'rename') };
}

// Remove até TMP_VARRER_MAX temporários deste destino com mais de TMP_VELHO_MS.
// Só arquivos regulares com exatamente o nome que gravarJsonAtomico gera; nada
// de outro destino, pasta ou link. Melhor esforço: nunca lança.
function varrerTmpVelhos(arquivo) {
  try {
    const pasta = path.dirname(arquivo);
    const prefixo = `${path.basename(arquivo)}.`;
    const corte = Date.now() - TMP_VELHO_MS;
    let removidos = 0;
    for (const nome of fs.readdirSync(pasta)) {
      if (removidos >= TMP_VARRER_MAX) break;
      if (!nome.startsWith(prefixo) || !nome.endsWith('.tmp')) continue;
      if (!MEIO_TMP.test(nome.slice(prefixo.length, -'.tmp'.length))) continue;
      const caminho = path.join(pasta, nome);
      try {
        const info = fs.lstatSync(caminho);
        if (!info.isFile() || info.mtimeMs >= corte) continue;
        fs.unlinkSync(caminho);
        removidos++;
      } catch { /* sumiu ou sem permissão: segue */ }
    }
  } catch { /* pasta ilegível: fica para a próxima gravação */ }
}

function estadoVazio() {
  return { versao: VERSAO, at: null, five_hour: null, seven_day: null, sessoes: Object.create(null) };
}

// Instante gravado em texto: string de até 64 caracteres que o Date.parse
// entende e que não está mais que 5 min à frente de `agoraMs`. Devolve o
// instante em ms ou null. O passado não é recusado aqui: a idade máxima é
// decisão de quem chama (LIMITE_VELHO_MS, SESSAO_MAX_MS). Nunca lança.
export function instante(valor, agoraMs) {
  if (!numeroFinito(agoraMs)) return null;
  if (typeof valor !== 'string' || valor.length > MAX_AT_CHARS) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) && t <= agoraMs + FUTURO_MAX_MS ? t : null;
}

// Janela de limite da conta: percentual finito em 0–100 e reset em segundos
// epoch finito, positivo e abaixo de 1e11. Devolve cópia só com os dois campos.
function janela(j) {
  if (!ehObjeto(j)) return null;
  const usado = noIntervalo(j.used_percentage, 0, 100);
  const reset = j.resets_at;
  if (usado === null || !numeroFinito(reset) || reset <= 0 || reset >= 1e11) return null;
  return { used_percentage: usado, resets_at: reset };
}

// Id de sessão aceitável como chave: ^[A-Za-z0-9_-]{1,64}$ e, além do padrão,
// nunca um membro de Object.prototype (__proto__, constructor, toString...),
// que casa com a regex mas, num objeto comum, faria a busca devolver o membro
// herdado. Mesmo validador para estado.json, o registro de ativação (ativas/)
// e os hooks. Nunca lança.
export const idValido = (id) => typeof id === 'string' && ID_SESSAO.test(id) && !(id in Object.prototype);

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
// passam no schema; versão desconhecida ou formato errado → null. Um `at`
// inválido ou mais de 5 min no futuro descarta os limites da conta; cada
// sessão é validada à parte. `sessoes` volta sem protótipo. Nunca lança.
export function validarEstado(valor, agoraMs) {
  try {
    if (!ehObjeto(valor) || valor.versao !== VERSAO || !numeroFinito(agoraMs)) return null;
    const estado = estadoVazio();
    const t = instante(valor.at, agoraMs);
    const f5 = t === null ? null : janela(valor.five_hour);
    const f7 = t === null ? null : janela(valor.seven_day);
    if (f5 || f7) Object.assign(estado, { at: new Date(t).toISOString(), five_hour: f5, seven_day: f7 });
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
// Só é consultada com snapshot fresco; o velho é substituído inteiro
// (atualizarEstado, fix round 3).
function mantemGuardada(guardada, nova, duracaoS, agoraMs) {
  if (!ehObjeto(guardada) || !numeroFinito(guardada.resets_at) || !numeroFinito(guardada.used_percentage)) return false;
  const agoraS = agoraMs / 1000;
  if (guardada.resets_at <= agoraS || guardada.resets_at > agoraS + duracaoS + TOLERANCIA_JANELA_S) return false;
  if (nova.resets_at <= agoraS) return true;
  const delta = nova.resets_at - guardada.resets_at;
  if (Math.abs(delta) <= TOLERANCIA_JANELA_S) return nova.used_percentage < guardada.used_percentage;
  return delta <= -(duracaoS - TOLERANCIA_JANELA_S);
}

// Junta a entrada da statusline ao estado gravado e regrava `estado.json`.
// Cada janela da leitura nova passa por mantemGuardada. Se ao menos uma entrou,
// `at` vira agora e a janela que não veio na leitura fica null: nenhum valor
// de leitura antiga ganha o `at` novo sem ter sido comparado. Se nenhuma
// entrou (sem leitura válida, ou só leituras velhas), o instantâneo anterior
// fica como está, com seu `at`. Devolve o
// estado mesmo quando a gravação falha, para a barra seguir mostrando a
// leitura atual. Sem diretório de dados (dirDados() null) não faz I/O e
// devolve motivo 'sem_diretorio'. Nunca lança.
export function atualizarEstado(entrada, agoraMs) {
  try {
    const agoraIso = numeroFinito(agoraMs) && Math.abs(agoraMs) <= 8.64e15 ? new Date(agoraMs).toISOString() : null;
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
    // A mescla por janela só protege snapshot fresco (fix round 3). Com `at`
    // a mais de LIMITE_VELHO_MS (a mesma régua de limitesValidos, que já não
    // o exibe), qualquer leitura válida substitui as duas janelas e `at` anda:
    // um valor plantado ou de outra conta segura no máximo 1 h, e a leitura
    // velha de uma sessão ociosa só ganha quando ninguém leu nada na última
    // hora, e aí é o melhor dado que há.
    const tAnterior = instante(anterior.at, agoraMs);
    const fresco = tAnterior !== null && agoraMs - tAnterior <= LIMITE_VELHO_MS;
    for (const k of JANELAS) {
      const nova = janela(rl[k]);
      const fica = fresco && nova !== null && mantemGuardada(anterior[k], nova, DURACAO_S[k], agoraMs);
      novas[k] = fica ? anterior[k] : nova;
      if (nova !== null && !fica) entrou = true;
    }
    // Janela ausente na leitura vira null só quando outra entrou (a leitura é
    // de agora); se nada entrou, o snapshot guardado fica inteiro, com seu at.
    if (entrou) Object.assign(estado, { at: agoraIso, ...novas });
    else Object.assign(estado, { at: anterior.at, five_hour: anterior.five_hour, seven_day: anterior.seven_day });
    estado.sessoes = juntarSessoes(Object.entries(anterior.sessoes), sessaoDaEntrada(e, agoraIso, agoraMs));
    const r = gravarJsonAtomico(arq, estado);
    return r.ok ? { ok: true, estado } : { ok: false, motivo: r.motivo, estado };
  } catch {
    return { ok: false, motivo: 'inesperado', estado: estadoVazio() };
  }
}

// Limites da conta que podem ser mostrados agora: leitura com no máximo
// LIMITE_VELHO_MS de idade (e não mais que 5 min no futuro), só janelas que
// passam no schema e cujo reset ainda não chegou. Nada válido → null. Nunca
// devolve resets_at ausente ou não finito. Nunca lança.
export function limitesValidos(estado, agoraMs) {
  try {
    if (!ehObjeto(estado) || estado.versao !== VERSAO || !numeroFinito(agoraMs)) return null;
    const t = instante(estado.at, agoraMs);
    if (t === null || agoraMs - t > LIMITE_VELHO_MS) return null;
    const limites = {};
    for (const k of JANELAS) {
      const j = janela(estado[k]);
      if (j !== null && j.resets_at * 1000 > agoraMs) limites[k] = j;
    }
    return limites.five_hour || limites.seven_day ? limites : null;
  } catch {
    return null;
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizarEffort, sanear } from './util.js';

// Camada de estado: a statusline grava `estado.json`; hooks e relatório só
// leem. É a fronteira de confiança dos dados em disco (spec 8.1, S1–S3, S9):
// nada lido do arquivo ou do stdin sai daqui sem passar pelo schema abaixo.

export const LIMITE_VELHO_MS = 3_600_000;
export const ARQ_ESTADO = 'estado.json';

const VERSAO = 1;
const MAX_BYTES_PADRAO = 1_048_576;
const SESSAO_MAX_MS = 24 * 3_600_000;
const MAX_SESSOES = 50;
// Tolerância para relógio adiantado: um `at` até 5 min no futuro ainda vale.
const FUTURO_MAX_MS = 5 * 60_000;
// Um instante ISO tem 24 caracteres; texto maior que isto nem vai ao Date.parse.
const MAX_AT_CHARS = 64;
const MAX_MODEL = 40;
// cwd serve para exibir; nunca vira caminho de arquivo.
const MAX_CWD = 200;
const ID_SESSAO = /^[A-Za-z0-9_-]{1,64}$/;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const JANELAS = ['five_hour', 'seven_day'];

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

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const noIntervalo = (n, min, max) => (numeroFinito(n) && n >= min && n <= max ? n : null);
const codigoErro = (e, padrao) => (typeof e?.code === 'string' ? e.code : padrao);
const apagar = (arquivo) => { try { fs.unlinkSync(arquivo); } catch { /* já não existe */ } };
const esperar = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* segue sem esperar */ }
};

export function dirDados() {
  if (process.env.HADOUKEN_HOME) return process.env.HADOUKEN_HOME;
  try {
    return path.join(os.homedir(), '.claude', 'hadouken');
  } catch {
    // os.homedir() só lança sem HOME e sem entrada do usuário no sistema; aí o
    // próprio Claude Code não tem ~/.claude. Tudo o que se lê daqui passa pelo
    // schema, então um diretório temporário não abre vetor novo.
    return path.join(os.tmpdir(), 'claude-hadouken');
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

// Grava num temporário ao lado do destino e renomeia: um leitor concorrente vê
// o arquivo antigo inteiro ou o novo inteiro, nunca pela metade. Nunca lança.
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

function estadoVazio() {
  return { versao: VERSAO, at: null, five_hour: null, seven_day: null, sessoes: Object.create(null) };
}

// Texto curto que o Date.parse entende e que não está mais que FUTURO_MAX_MS à
// frente de agora; devolve o instante em ms ou null.
function instante(valor, agoraMs) {
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

// Além do padrão, nenhum id pode coincidir com membro de Object.prototype
// (__proto__, constructor, toString...): casam com a regex, mas num objeto comum
// uma busca por eles devolveria o membro herdado.
const idValido = (id) => typeof id === 'string' && ID_SESSAO.test(id) && !(id in Object.prototype);

// O mesmo validador serve à sessão nova (stdin) e às lidas do disco.
function sessaoValida(bruta, agoraMs) {
  if (!ehObjeto(bruta)) return null;
  const t = instante(bruta.at, agoraMs);
  if (t === null || agoraMs - t > SESSAO_MAX_MS) return null;
  const effort = normalizarEffort(bruta.effort);
  return {
    at: new Date(t).toISOString(),
    model: sanear(bruta.model, MAX_MODEL),
    effort: EFFORTS.has(effort) ? effort : null,
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

// Junta a entrada da statusline ao estado gravado e regrava `estado.json`.
// Uma leitura nova da conta substitui o instantâneo inteiro (janela que não
// veio fica null): nenhum valor de leitura antiga ganha o `at` novo. Sem
// leitura válida na entrada, o instantâneo anterior fica como está. Devolve o
// estado mesmo quando a gravação falha, para a barra seguir mostrando a
// leitura atual. Nunca lança.
export function atualizarEstado(entrada, agoraMs) {
  try {
    const agoraIso = numeroFinito(agoraMs) && Math.abs(agoraMs) <= 8.64e15 ? new Date(agoraMs).toISOString() : null;
    if (agoraIso === null) return { ok: false, motivo: 'agora', estado: estadoVazio() };
    const arq = path.join(dirDados(), ARQ_ESTADO);
    const lido = lerJson(arq);
    const anterior = (lido.ok && validarEstado(lido.valor, agoraMs)) || estadoVazio();
    const e = ehObjeto(entrada) ? entrada : {};
    const rl = ehObjeto(e.rate_limits) ? e.rate_limits : {};
    const f5 = janela(rl.five_hour);
    const f7 = janela(rl.seven_day);
    const estado = estadoVazio();
    if (f5 || f7) Object.assign(estado, { at: agoraIso, five_hour: f5, seven_day: f7 });
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

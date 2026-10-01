import fs from 'node:fs';
import path from 'node:path';
import { fechar, numeroFinito } from '../base.js';
import { MODELO_VALIDO } from '../guarda/registros.js';
import { effortValido } from '../util.js';

// Leitor do telemetria.jsonl (spec aprendizado §3.1 e §5.3, a segunda
// barreira). Cada linha é um lote OTLP JSON do exportador `file` do
// Collector. Nada do lote é copiado: cada registro é montado do zero, só com
// os campos de §4.1, e nenhum atributo do recurso é lido. Um campo sensível
// que escapou do filtro do Collector (§5.1) morre aqui, junto com session.id
// (R11), prompt e argumentos de ferramenta.
// Sem rede e sem processo filho (test/aprendizado-fronteiras.test.js).
// Nunca lança.

export const ARQ_TELEMETRIA = 'telemetria.jsonl';
// Nome do arquivo que a rotação do exportador `file` deixa ao lado (Emenda
// A2). Só estes são procurados quando o arquivo atual mudou de inode.
export const ROTACIONADO = /^telemetria-[0-9A-Za-z._:-]{1,80}\.jsonl$/;
export const LINHA_MAX_BYTES = 1024 * 1024;
export const LEITURA_MAX_BYTES = 20 * 1024 * 1024;
const ROTACIONADOS_MAX = 16;
const PEDACO = 1024 * 1024;
const LISTA_MAX = 4096;
const ATRIBUTOS_MAX = 256;
const TEXTO_MAX = 200;
const PARES_MAX = 4096;
const PASSADO_MAX_MS = 40 * 86_400_000;
const FUTURO_MS = 5 * 60_000;
const TETO = Object.freeze({ custo: 1000, tokens: 1e9, ms: 3_600_000, ativoS: 86_400 });

// Nomes do OTel do Claude Code (Emenda A1). Só estes atributos são lidos.
export const NOMES = Object.freeze({
  nomeEvento: 'event.name',
  eventoPedido: 'api_request',
  eventoErro: 'api_error',
  eventoFerramenta: 'tool_result',
  metricaAtivo: 'claude_code.active_time.total',
  modelo: 'model',
  effort: 'effort',
  origem: 'query_source',
  agente: 'agent.name',
  prompt: 'prompt.id',
  custo: 'cost_usd',
  entrada: 'input_tokens',
  saida: 'output_tokens',
  cacheLeitura: 'cache_read_tokens',
  cacheEscrita: 'cache_creation_tokens',
  duracao: 'duration_ms',
  ttft: 'ttft_ms',
  sucesso: 'success',
});
// query_source da sessão principal (Emenda A1).
export const ORIGENS_PRINCIPAIS = Object.freeze(['repl_main_thread', 'main']);
export const AGENTE_VALIDO = /^[A-Za-z0-9._-]{1,40}$/;
const CHAVES_LOG = new Set([
  NOMES.nomeEvento, NOMES.modelo, NOMES.effort, NOMES.origem, NOMES.agente, NOMES.prompt, NOMES.custo, NOMES.entrada,
  NOMES.saida, NOMES.cacheLeitura, NOMES.cacheEscrita, NOMES.duracao, NOMES.ttft, NOMES.sucesso,
]);
const EVENTOS = new Set([NOMES.eventoPedido, NOMES.eventoErro, NOMES.eventoFerramenta]);
const PREFIXO_EVENTO = 'claude_code.';

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lista = (v) => (Array.isArray(v) ? v.slice(0, LISTA_MAX) : []);

// Valor de um atributo OTLP JSON. intValue vem como texto (int64 no JSON).
function valorDe(v) {
  if (!ehObjeto(v)) return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue.length <= TEXTO_MAX ? v.stringValue : undefined;
  if (typeof v.intValue === 'string' || typeof v.intValue === 'number') return v.intValue;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (typeof v.boolValue === 'boolean') return v.boolValue;
  return undefined;
}

// Só as chaves pedidas, a primeira ocorrência de cada; o resto nem é lido.
function atributos(bruto, chaves) {
  const r = Object.create(null);
  for (const a of lista(bruto).slice(0, ATRIBUTOS_MAX)) {
    if (!ehObjeto(a) || typeof a.key !== 'string' || !chaves.has(a.key) || a.key in r) continue;
    const v = valorDe(a.value);
    if (v !== undefined) r[a.key] = v;
  }
  return r;
}

// Número finito de 0 até `max`; texto só com dígitos e ponto. Senão null.
function numero(v, max) {
  const n = typeof v === 'string' && /^\d{1,15}(?:\.\d{1,12})?$/.test(v) ? Number(v) : v;
  return numeroFinito(n) && n >= 0 && n <= max ? n : null;
}

// timeUnixNano (texto de dígitos ou número) em ms, de 40 dias para trás até
// 5 min para a frente (Foco de revisão 4).
function instanteNano(t, agoraMs) {
  let ms = null;
  if (typeof t === 'string' && /^\d{1,20}$/.test(t)) ms = Number(BigInt(t) / 1_000_000n);
  else if (numeroFinito(t) && t >= 0) ms = Math.floor(t / 1e6);
  return ms !== null && ms >= agoraMs - PASSADO_MAX_MS && ms <= agoraMs + FUTURO_MS ? ms : null;
}

function origemDe(a) {
  const agente = a[NOMES.agente];
  if (typeof agente === 'string' && AGENTE_VALIDO.test(agente)) return `sub:${agente}`;
  const q = a[NOMES.origem];
  if (typeof q === 'string' && ORIGENS_PRINCIPAIS.includes(q)) return 'principal';
  return agente === undefined ? 'outro' : 'sub';
}

function nomeEvento(n, body) {
  const bruto = typeof n === 'string' ? n : ehObjeto(body) && typeof body.stringValue === 'string' ? body.stringValue : null;
  if (bruto === null) return null;
  const curto = bruto.startsWith(PREFIXO_EVENTO) ? bruto.slice(PREFIXO_EVENTO.length) : bruto;
  return EVENTOS.has(curto) ? curto : null;
}

// Ruling M2 (spike A1, Emenda 2026-10-01): o tool_result chega sem `model`,
// mas com o mesmo prompt.id do api_request que o originou. `pares` guarda,
// só durante uma leitura, modelo, effort e origem do último api_request de
// cada prompt.id; o tool_result sem modelo herda deles e, sem par, é
// descartado. O prompt.id serve só de chave e nunca sai do leitor.
function lembrarPar(pares, promptId, par) {
  pares.delete(promptId);
  pares.set(promptId, par);
  if (pares.size > PARES_MAX) pares.delete(pares.keys().next().value);
}

function registroDeLog(l, agoraMs, pares) {
  if (!ehObjeto(l)) return null;
  const a = atributos(l.attributes, CHAVES_LOG);
  const nome = nomeEvento(a[NOMES.nomeEvento], l.body);
  if (nome === null) return null;
  const em = instanteNano(l.timeUnixNano ?? l.observedTimeUnixNano, agoraMs);
  if (em === null) return null;
  const promptId = typeof a[NOMES.prompt] === 'string' && a[NOMES.prompt].length > 0 ? a[NOMES.prompt] : null;
  const modelo = typeof a[NOMES.modelo] === 'string' && MODELO_VALIDO.test(a[NOMES.modelo]) ? a[NOMES.modelo] : null;
  let par;
  if (modelo !== null) par = { modelo, effort: effortValido(a[NOMES.effort]) ?? '-', origem: origemDe(a) };
  else if (nome === NOMES.eventoFerramenta && promptId !== null && pares.has(promptId)) par = pares.get(promptId);
  else return null;
  const base = { em, modelo: par.modelo, effort: par.effort, origem: par.origem };
  if (nome === NOMES.eventoPedido) {
    if (promptId !== null) lembrarPar(pares, promptId, par);
    return {
      t: 'req', ...base,
      custo: numero(a[NOMES.custo], TETO.custo) ?? 0,
      entrada: numero(a[NOMES.entrada], TETO.tokens) ?? 0,
      saida: numero(a[NOMES.saida], TETO.tokens) ?? 0,
      cacheLeitura: numero(a[NOMES.cacheLeitura], TETO.tokens) ?? 0,
      cacheEscrita: numero(a[NOMES.cacheEscrita], TETO.tokens) ?? 0,
      duracaoMs: numero(a[NOMES.duracao], TETO.ms),
      ttftMs: numero(a[NOMES.ttft], TETO.ms),
    };
  }
  if (nome === NOMES.eventoErro) return { t: 'erro', ...base };
  const s = a[NOMES.sucesso];
  const ok = s === true || s === 'true' ? true : s === false || s === 'false' ? false : null;
  return ok === null ? null : { t: 'ferramenta', ...base, ok };
}

// Só a métrica de tempo ativo, só em delta: uma cumulativa somaria o mesmo
// tempo a cada exportação (R11).
function registrosDeMetrica(m, agoraMs, saida) {
  if (!ehObjeto(m) || m.name !== NOMES.metricaAtivo || !ehObjeto(m.sum)) return;
  const temp = m.sum.aggregationTemporality;
  if (temp !== 1 && temp !== 'AGGREGATION_TEMPORALITY_DELTA') return;
  for (const dp of lista(m.sum.dataPoints)) {
    if (!ehObjeto(dp)) continue;
    const em = instanteNano(dp.timeUnixNano, agoraMs);
    const v = numero(dp.asDouble ?? dp.asInt, TETO.ativoS);
    if (em !== null && v !== null && v > 0) saida.push({ t: 'ativo', em, segundos: v });
  }
}

// `pares` (opcional) é o mapa de prompt.id da leitura em curso (Ruling M2);
// sem ele, a linha só vê os pares que ela mesma traz.
export function registrosDaLinha(texto, agoraMs, pares = new Map()) {
  let o;
  try { o = JSON.parse(texto); } catch { return null; }
  if (!ehObjeto(o)) return null;
  const saida = [];
  try {
    const mapa = pares instanceof Map ? pares : new Map();
    for (const r of lista(o.resourceLogs)) {
      for (const s of lista(r?.scopeLogs)) {
        for (const l of lista(s?.logRecords)) {
          const x = registroDeLog(l, agoraMs, mapa);
          if (x !== null) saida.push(x);
        }
      }
    }
    for (const r of lista(o.resourceMetrics)) {
      for (const s of lista(r?.scopeMetrics)) {
        for (const m of lista(s?.metrics)) registrosDeMetrica(m, agoraMs, saida);
      }
    }
  } catch {
    return null;
  }
  return saida;
}

function processarLinha(buf, agoraMs, saida, pares) {
  const texto = buf.toString('utf8').trim();
  if (texto.length === 0) return true;
  const r = registrosDaLinha(texto, agoraMs, pares);
  if (r === null) return false;
  for (const x of r) saida.push(x);
  return true;
}

// Lê [desde, ate) do arquivo cujo inode é `ino`, linha a linha. Só linhas
// terminadas em \n contam, a não ser em `final` (arquivo rotacionado, que não
// cresce mais). Devolve a posição logo depois da última linha consumida.
function lerSegmento(arquivo, ino, desde, ate, final, agoraMs, saida, pares) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
  } catch {
    return { pos: desde, corrompido: true };
  }
  try {
    const info = fs.fstatSync(fd, { bigint: true });
    if (!info.isFile() || info.ino !== ino) return { pos: desde, corrompido: true };
    const pedaco = Buffer.allocUnsafe(PEDACO);
    let pos = desde;
    let lido = desde;
    let resto = Buffer.alloc(0);
    let descartando = false;
    let corrompido = false;
    while (lido < ate) {
      const n = fs.readSync(fd, pedaco, 0, Math.min(PEDACO, ate - lido), lido);
      if (n === 0) break;
      let ini = 0;
      for (;;) {
        const nl = pedaco.indexOf(10, ini);
        if (nl === -1 || nl >= n) break;
        if (!descartando) {
          const linha = resto.length > 0 ? Buffer.concat([resto, pedaco.subarray(ini, nl)]) : pedaco.subarray(ini, nl);
          if (linha.length > LINHA_MAX_BYTES || !processarLinha(linha, agoraMs, saida, pares)) corrompido = true;
        }
        resto = Buffer.alloc(0);
        descartando = false;
        pos = lido + nl + 1;
        ini = nl + 1;
      }
      if (!descartando) {
        const cauda = pedaco.subarray(ini, n);
        if (resto.length + cauda.length > LINHA_MAX_BYTES) {
          descartando = true;
          corrompido = true;
          resto = Buffer.alloc(0);
        } else {
          resto = Buffer.concat([resto, cauda]);
        }
      }
      lido += n;
    }
    if (final && pos < lido) {
      if (!descartando && resto.length > 0 && !processarLinha(resto, agoraMs, saida, pares)) corrompido = true;
      pos = lido;
    }
    return { pos, corrompido };
  } catch {
    return { pos: desde, corrompido: true };
  } finally {
    fechar(fd);
  }
}

function cursorValido(c) {
  return ehObjeto(c) && typeof c.ino === 'string' && /^\d{1,40}$/.test(c.ino) && Number.isSafeInteger(c.pos) && c.pos >= 0
    ? { ino: c.ino, pos: c.pos }
    : null;
}

// Emenda A2: no Windows, com o Collector vivo, a listagem da pasta mostra o
// telemetria.jsonl com 0 bytes até ele ser fechado, mas o conteúdo se lê. O
// tamanho vem então do arquivo aberto (fstat pelo descritor), não da
// listagem; se não abrir ou o inode mudou no meio, fica o da listagem.
function tamanhoAberto(arquivo, ino) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const info = fs.fstatSync(fd, { bigint: true });
    return info.isFile() && info.ino === ino ? Number(info.size) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fechar(fd);
  }
}

// O arquivo rotacionado que ainda tem o inode do cursor (a rotação renomeia,
// então o inode fica). Só nomes de ROTACIONADO, no máximo 16, sem link.
function acharRotacionado(pasta, ino) {
  try {
    const nomes = fs.readdirSync(pasta).filter((n) => ROTACIONADO.test(n)).slice(0, ROTACIONADOS_MAX);
    for (const n of nomes) {
      const arquivo = path.join(pasta, n);
      const info = fs.lstatSync(arquivo, { bigint: true, throwIfNoEntry: false });
      if (info && info.isFile() && String(info.ino) === ino) return { arquivo, info };
    }
  } catch { /* sem rotacionado legível */ }
  return null;
}

export function lerNovos(opcoes) {
  const { pasta, cursor, agoraMs, maxBytes = LEITURA_MAX_BYTES } = opcoes ?? {};
  const semNada = { registros: [], cursor: cursor ?? null, corrompido: false };
  try {
    if (typeof pasta !== 'string' || !numeroFinito(agoraMs)) return semNada;
    const arquivo = path.join(pasta, ARQ_TELEMETRIA);
    const atual = fs.lstatSync(arquivo, { bigint: true, throwIfNoEntry: false });
    if (!atual) return semNada;
    if (!atual.isFile()) return { ...semNada, corrompido: true };
    const tamanho = tamanhoAberto(arquivo, atual.ino) ?? Number(atual.size);
    const ino = String(atual.ino);
    const cur = cursorValido(cursor);
    const segmentos = [];
    if (cur !== null && cur.ino === ino) {
      segmentos.push({ arquivo, ino: atual.ino, desde: cur.pos <= tamanho ? cur.pos : 0, ate: tamanho, final: false });
    } else {
      const rot = cur === null ? null : acharRotacionado(pasta, cur.ino);
      if (rot !== null && cur.pos <= Number(rot.info.size)) {
        segmentos.push({ arquivo: rot.arquivo, ino: rot.info.ino, desde: cur.pos, ate: Number(rot.info.size), final: true });
      }
      segmentos.push({ arquivo, ino: atual.ino, desde: 0, ate: tamanho, final: false });
    }
    const registros = [];
    const pares = new Map();
    let corrompido = false;
    let orcamento = maxBytes;
    let novoCursor = { ino, pos: segmentos[segmentos.length - 1].desde };
    for (const s of segmentos) {
      const n = s.ate - s.desde;
      const ehAtual = s.arquivo === arquivo;
      if (n > orcamento) {
        corrompido = true;
        if (ehAtual) novoCursor = { ino, pos: s.ate };
        continue;
      }
      orcamento -= n;
      const r = lerSegmento(s.arquivo, s.ino, s.desde, s.ate, s.final, agoraMs, registros, pares);
      if (r.corrompido) corrompido = true;
      if (ehAtual) novoCursor = { ino, pos: r.pos };
    }
    return { registros, cursor: novoCursor, corrompido };
  } catch {
    return { ...semNada, corrompido: true };
  }
}

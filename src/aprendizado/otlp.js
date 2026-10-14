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
// Cada chave tem um índice: a posição dela em CHAVES_LOG e no
// construtor de AtributosLidos.
const CHAVES_LOG = Object.freeze([
  NOMES.nomeEvento, NOMES.modelo, NOMES.effort, NOMES.origem, NOMES.agente, NOMES.prompt, NOMES.custo, NOMES.entrada,
  NOMES.saida, NOMES.cacheLeitura, NOMES.cacheEscrita, NOMES.duracao, NOMES.ttft, NOMES.sucesso,
]);
const INDICE_CHAVE_LOG = new Map(CHAVES_LOG.map((k, i) => [k, i]));
const EVENTOS = new Set([NOMES.eventoPedido, NOMES.eventoErro, NOMES.eventoFerramenta]);
const PREFIXO_EVENTO = 'claude_code.';

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Quantos itens de uma lista são lidos (os `max` primeiros); não lista, 0.
const tamanho = (v, max) => (Array.isArray(v) ? Math.min(v.length, max) : 0);

// Valor de um atributo OTLP JSON pelos quatro campos do valor. intValue vem
// como texto (int64 no JSON).
function valorDosCampos(s, i, d, b) {
  if (typeof s === 'string') return s.length <= TEXTO_MAX ? s : undefined;
  if (typeof i === 'string' || typeof i === 'number') return i;
  if (typeof d === 'number') return d;
  if (typeof b === 'boolean') return b;
  return undefined;
}
const valorDe = (v) => (ehObjeto(v) ? valorDosCampos(v.stringValue, v.intValue, v.doubleValue, v.boolValue) : undefined);

// O resultado de atributos(): cada chave de CHAVES_LOG com o valor de
// `v[índice]` (undefined sem valor válido). Os campos vão um a um, na ordem
// de CHAVES_LOG, para todo objeto ter a mesma forma. A leitura rápida
// já entrega os atributos de um registro assim (o JSON.parse nunca cria
// esta classe).
class AtributosLidos {
  constructor(v) {
    this[NOMES.nomeEvento] = v[0];
    this[NOMES.modelo] = v[1];
    this[NOMES.effort] = v[2];
    this[NOMES.origem] = v[3];
    this[NOMES.agente] = v[4];
    this[NOMES.prompt] = v[5];
    this[NOMES.custo] = v[6];
    this[NOMES.entrada] = v[7];
    this[NOMES.saida] = v[8];
    this[NOMES.cacheLeitura] = v[9];
    this[NOMES.cacheEscrita] = v[10];
    this[NOMES.duracao] = v[11];
    this[NOMES.ttft] = v[12];
    this[NOMES.sucesso] = v[13];
  }
}
const valoresVazios = () => new Array(CHAVES_LOG.length).fill(undefined);

// Só as chaves de CHAVES_LOG, a primeira ocorrência válida de cada, entre os
// ATRIBUTOS_MAX primeiros; o resto nem é lido.
function atributos(bruto) {
  if (bruto instanceof AtributosLidos) return bruto;
  const vs = valoresVazios();
  const n = tamanho(bruto, ATRIBUTOS_MAX);
  for (let i = 0; i < n; i++) {
    const a = bruto[i];
    if (!ehObjeto(a)) continue;
    const k = a.key;
    const x = typeof k === 'string' ? INDICE_CHAVE_LOG.get(k) : undefined;
    if (x === undefined || vs[x] !== undefined) continue;
    const v = valorDe(a.value);
    if (v !== undefined) vs[x] = v;
  }
  return new AtributosLidos(vs);
}

const ehDigitoTexto = (t, i) => {
  const c = t.charCodeAt(i);
  return c >= 0x30 && c <= 0x39;
};
// Quantos dígitos ASCII seguidos há em t a partir de i.
function digitosDesde(t, i) {
  let j = i;
  while (j < t.length && ehDigitoTexto(t, j)) j++;
  return j - i;
}
// O mesmo teste de /^\d{1,15}(?:\.\d{1,12})?$/ (o \d do JS é só 0-9),
// sem a regex, que pesava na leitura de 20 MB.
function textoDecimal(t) {
  const a = digitosDesde(t, 0);
  if (a < 1 || a > 15) return false;
  if (a === t.length) return true;
  if (t.charCodeAt(a) !== 0x2e) return false;
  const b = digitosDesde(t, a + 1);
  return b >= 1 && b <= 12 && a + 1 + b === t.length;
}

// Número finito de 0 até `max`; texto só com dígitos e ponto. Senão null.
function numero(v, max) {
  const n = typeof v === 'string' && textoDecimal(v) ? Number(v) : v;
  return numeroFinito(n) && n >= 0 && n <= max ? n : null;
}

// timeUnixNano (texto de dígitos ou número) em ms, de 40 dias para trás até
// 5 min para a frente (Foco de revisão 4). No texto, os ms são os dígitos
// sem os 6 últimos: o mesmo valor da divisão inteira por 10^6 em BigInt.
function instanteNano(t, agoraMs) {
  let ms = null;
  if (typeof t === 'string' && t.length >= 1 && t.length <= 20 && digitosDesde(t, 0) === t.length) ms = t.length > 6 ? Number(t.slice(0, -6)) : 0;
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
// Sai o mais antigo: o primeiro na ordem do Map. Um iterador guardado por
// mapa o entrega sem varrer a tabela (no V8, keys().next() de um iterador
// novo percorre todos os buracos que as remoções deixaram no começo, o que
// custava 30 ms na leitura de 20 MB). É o mesmo valor: pela especificação, o
// iterador pula o que foi removido e vê o que entrou depois; tudo antes dele
// é o que ele já entregou (e saiu), então o próximo é o primeiro vivo.
const ITERADOR_PARES = new WeakMap();
function lembrarPar(pares, promptId, par) {
  pares.delete(promptId);
  pares.set(promptId, par);
  if (pares.size > PARES_MAX) {
    let it = ITERADOR_PARES.get(pares);
    if (it === undefined) {
      it = pares.keys();
      ITERADOR_PARES.set(pares, it);
    }
    pares.delete(it.next().value);
  }
}

function registroDeLog(l, agoraMs, pares) {
  if (!ehObjeto(l)) return null;
  const a = atributos(l.attributes);
  const nome = nomeEvento(a[NOMES.nomeEvento], l.body);
  if (nome === null) return null;
  const em = instanteNano(l.timeUnixNano ?? l.observedTimeUnixNano, agoraMs);
  if (em === null) return null;
  const p = a[NOMES.prompt];
  const promptId = typeof p === 'string' && p.length > 0 ? p : null;
  const m = a[NOMES.modelo];
  const modelo = typeof m === 'string' && MODELO_VALIDO.test(m) ? m : null;
  let par;
  if (modelo !== null) par = { modelo, effort: effortValido(a[NOMES.effort]) ?? '-', origem: origemDe(a) };
  else if (nome === NOMES.eventoFerramenta && promptId !== null && pares.has(promptId)) par = pares.get(promptId);
  else return null;
  if (nome === NOMES.eventoPedido) {
    if (promptId !== null) lembrarPar(pares, promptId, par);
    return {
      t: 'req', em, modelo: par.modelo, effort: par.effort, origem: par.origem,
      custo: numero(a[NOMES.custo], TETO.custo) ?? 0,
      entrada: numero(a[NOMES.entrada], TETO.tokens) ?? 0,
      saida: numero(a[NOMES.saida], TETO.tokens) ?? 0,
      cacheLeitura: numero(a[NOMES.cacheLeitura], TETO.tokens) ?? 0,
      cacheEscrita: numero(a[NOMES.cacheEscrita], TETO.tokens) ?? 0,
      duracaoMs: numero(a[NOMES.duracao], TETO.ms),
      ttftMs: numero(a[NOMES.ttft], TETO.ms),
    };
  }
  if (nome === NOMES.eventoErro) return { t: 'erro', em, modelo: par.modelo, effort: par.effort, origem: par.origem };
  const s = a[NOMES.sucesso];
  const ok = s === true || s === 'true' ? true : s === false || s === 'false' ? false : null;
  return ok === null ? null : { t: 'ferramenta', em, modelo: par.modelo, effort: par.effort, origem: par.origem, ok };
}

// Só a métrica de tempo ativo, só em delta: uma cumulativa somaria o mesmo
// tempo a cada exportação (R11).
function registrosDeMetrica(m, agoraMs, saida) {
  if (!ehObjeto(m) || m.name !== NOMES.metricaAtivo || !ehObjeto(m.sum)) return;
  const temp = m.sum.aggregationTemporality;
  if (temp !== 1 && temp !== 'AGGREGATION_TEMPORALITY_DELTA') return;
  const dps = m.sum.dataPoints;
  for (let i = 0, n = tamanho(dps, LISTA_MAX); i < n; i++) {
    const dp = dps[i];
    if (!ehObjeto(dp)) continue;
    const em = instanteNano(dp.timeUnixNano, agoraMs);
    const v = numero(dp.asDouble ?? dp.asInt, TETO.ativoS);
    if (em !== null && v !== null && v > 0) saida.push({ t: 'ativo', em, segundos: v });
  }
}

// Os registros de um lote já lido (pelo JSON.parse ou pela leitura rápida).
function registrosDoLote(o, agoraMs, pares) {
  const saida = [];
  try {
    const mapa = pares instanceof Map ? pares : new Map();
    const rls = o.resourceLogs;
    for (let i = 0, ni = tamanho(rls, LISTA_MAX); i < ni; i++) {
      const sls = rls[i]?.scopeLogs;
      for (let j = 0, nj = tamanho(sls, LISTA_MAX); j < nj; j++) {
        const lrs = sls[j]?.logRecords;
        for (let k = 0, nk = tamanho(lrs, LISTA_MAX); k < nk; k++) {
          const x = registroDeLog(lrs[k], agoraMs, mapa);
          if (x !== null) saida.push(x);
        }
      }
    }
    const rms = o.resourceMetrics;
    for (let i = 0, ni = tamanho(rms, LISTA_MAX); i < ni; i++) {
      const sms = rms[i]?.scopeMetrics;
      for (let j = 0, nj = tamanho(sms, LISTA_MAX); j < nj; j++) {
        const ms = sms[j]?.metrics;
        for (let k = 0, nk = tamanho(ms, LISTA_MAX); k < nk; k++) registrosDeMetrica(ms[k], agoraMs, saida);
      }
    }
  } catch {
    return null;
  }
  return saida;
}

// `pares` (opcional) é o mapa de prompt.id da leitura em curso (Ruling M2);
// sem ele, a linha só vê os pares que ela mesma traz.
export function registrosDaLinha(texto, agoraMs, pares = new Map()) {
  let o;
  try { o = JSON.parse(texto); } catch { return null; }
  if (!ehObjeto(o)) return null;
  return registrosDoLote(o, agoraMs, pares);
}

// Leitura rápida da linha (revisão da Task 12, desempenho: o JSON.parse de
// 20 MB passava sozinho de 200 ms). Um analisador iterativo, com pilha
// própria, percorre os bytes da linha e confere a gramática JSON inteira,
// mas só monta os caminhos que o leitor usa (ESQUEMA); o resto é conferido e
// pulado. O lote podado dá a registrosDoLote exatamente o que o JSON.parse
// daria nesses caminhos:
// - lista lida guarda só os primeiros `max` itens (o que o leitor lê);
// - objeto ou lista no lugar errado vira null (o leitor trata igual: não é
//   objeto, não é lista); num campo folha (instante, valor), vira o objeto
//   congelado CONTEINER, que, como o original, não é nulo (o ?? não pula);
// - chave repetida: vale a última, como no JSON.parse;
// - texto sem escape vem do toString do trecho (um byte ASCII como a aspa
//   nunca faz parte de uma sequência UTF-8, então o trecho decodifica igual
//   à linha inteira); com escape, do JSON.parse do literal;
// - os atributos de um registro saem já como atributos() os daria
//   (AtributosLidos): os ATRIBUTOS_MAX primeiros itens, só os objetos, a
//   chave (a última, se repetida) só se está em CHAVES_LOG, o valor (o
//   último) por valorDosCampos, e vale a primeira ocorrência válida.
// Qualquer coisa fora do comum (o primeiro byte depois dos espaços JSON não
// é {, byte não ASCII fora de texto, gramática inválida, lixo no fim)
// desiste (null), e a linha segue pelo caminho original: toString, trim e
// JSON.parse. Por isso o BOM, os espaços Unicode que o trim tira e toda
// linha hostil continuam com o resultado de antes
// (test/aprendizado-otlp-rapido.test.js compara com o leitor original).
const LINHA_VAZIA = Object.freeze([]);
const CONTEINER = Object.freeze({});
const K_FOLHA = 1;
const K_ATRIBUTOS = 2;
const K_OBJETO = 3;
const K_LISTA = 4;
const T_RAIZ = 0;
const T_RL = 1;
const T_SL = 2;
const T_LR = 3;
const T_VALOR = 4;
const T_RM = 5;
const T_SM = 6;
const T_METRICA = 7;
const T_SOMA = 8;
const T_PONTO = 9;
const campo = (nome, kind, tipo = -1, max = 0) => Object.freeze({ nome, bytes: Buffer.from(nome, 'latin1'), kind, tipo, max });
const ESQUEMA = Object.freeze([
  [campo('resourceLogs', K_LISTA, T_RL, LISTA_MAX), campo('resourceMetrics', K_LISTA, T_RM, LISTA_MAX)],
  [campo('scopeLogs', K_LISTA, T_SL, LISTA_MAX)],
  [campo('logRecords', K_LISTA, T_LR, LISTA_MAX)],
  [
    campo('attributes', K_ATRIBUTOS), campo('body', K_OBJETO, T_VALOR), campo('timeUnixNano', K_FOLHA),
    campo('observedTimeUnixNano', K_FOLHA),
  ],
  [campo('stringValue', K_FOLHA), campo('intValue', K_FOLHA), campo('doubleValue', K_FOLHA), campo('boolValue', K_FOLHA)],
  [campo('scopeMetrics', K_LISTA, T_SM, LISTA_MAX)],
  [campo('metrics', K_LISTA, T_METRICA, LISTA_MAX)],
  [campo('name', K_FOLHA), campo('sum', K_OBJETO, T_SOMA)],
  [campo('aggregationTemporality', K_FOLHA), campo('dataPoints', K_LISTA, T_PONTO, LISTA_MAX)],
  [campo('timeUnixNano', K_FOLHA), campo('asDouble', K_FOLHA), campo('asInt', K_FOLHA)],
].map((cs) => Object.freeze(cs)));
const CHAVES_LOG_BYTES = Object.freeze(CHAVES_LOG.map((k, indice) => Object.freeze({ nome: k, bytes: Buffer.from(k, 'latin1'), indice })));
// Os nomes pelo tamanho em bytes: a chave lida só é comparada com os nomes
// do mesmo tamanho.
function porTamanho(cs) {
  const t = new Array(1 + Math.max(...cs.map((c) => c.bytes.length))).fill(null);
  for (const c of cs) t[c.bytes.length] = Object.freeze([...(t[c.bytes.length] ?? []), c]);
  return Object.freeze(t);
}
const CAMPOS_POR_TAMANHO = Object.freeze(ESQUEMA.map(porTamanho));
const CHAVES_LOG_POR_TAMANHO = porTamanho(CHAVES_LOG_BYTES);

const ehEspaco = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
const ehDigito = (c) => c >= 0x30 && c <= 0x39;
const ehHex = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46);

function pularEspaco(buf, i, n) {
  while (i < n && ehEspaco(buf[i])) i++;
  return i;
}

// Classe de cada byte dentro de um texto: 0 comum (inclusive os não
// ASCII), 1 aspa, 2 barra invertida, 3 controle (inválido no JSON).
const CLASSE_TEXTO = (() => {
  const t = new Uint8Array(256);
  for (let c = 0; c < 0x20; c++) t[c] = 3;
  t[0x22] = 1;
  t[0x5c] = 2;
  return t;
})();

let escapou = false;
// Índice da aspa que fecha o texto aberto em i; -1 se o texto não é JSON
// válido. `escapou` diz se houve escape.
function fimTexto(buf, i, n) {
  escapou = false;
  let j = i + 1;
  for (;;) {
    let k = 3;
    while (j < n && (k = CLASSE_TEXTO[buf[j]]) === 0) j++;
    if (j >= n || k === 3) return -1;
    if (k === 1) return j;
    escapou = true;
    const e = j + 1 < n ? buf[j + 1] : 0;
    if (e === 0x75) {
      if (j + 5 >= n || !ehHex(buf[j + 2]) || !ehHex(buf[j + 3]) || !ehHex(buf[j + 4]) || !ehHex(buf[j + 5])) return -1;
      j += 6;
    } else if (e === 0x22 || e === 0x5c || e === 0x2f || e === 0x62 || e === 0x66 || e === 0x6e || e === 0x72 || e === 0x74) {
      j += 2;
    } else {
      return -1;
    }
  }
}

// Texto sem escape do trecho [s, e). Cada toString é uma chamada nativa cara
// perto do resto da leitura, e os valores se repetem muito (nomes de
// evento, modelos, effort, origens, números): um cache de mapeamento
// direto, conferido byte a byte, devolve o mesmo texto que o toString daria
// para os mesmos bytes.
const CACHE_TEXTOS = 4096;
const CACHE_TEXTO_MAX = 48;
const cacheBytes = new Uint8Array(CACHE_TEXTOS * CACHE_TEXTO_MAX);
const cacheTamanhos = new Int16Array(CACHE_TEXTOS).fill(-1);
const cacheTextos = new Array(CACHE_TEXTOS).fill('');
function textoDe(buf, s, e) {
  const n = e - s;
  if (n > CACHE_TEXTO_MAX) return buf.toString('utf8', s, e);
  let h = n;
  for (let k = s; k < e; k++) h = (Math.imul(h, 31) + buf[k]) | 0;
  const vaga = (h ^ (h >>> 13)) & (CACHE_TEXTOS - 1);
  const base = vaga * CACHE_TEXTO_MAX;
  if (cacheTamanhos[vaga] === n) {
    let k = 0;
    while (k < n && cacheBytes[base + k] === buf[s + k]) k++;
    if (k === n) return cacheTextos[vaga];
  }
  const t = buf.toString('utf8', s, e);
  for (let k = 0; k < n; k++) cacheBytes[base + k] = buf[s + k];
  cacheTamanhos[vaga] = n;
  cacheTextos[vaga] = t;
  return t;
}

// Fim do número JSON que começa em i; -1 se a gramática não fecha.
function fimNumero(buf, i, n) {
  let j = i;
  if (buf[j] === 0x2d) j++;
  if (j < n && buf[j] === 0x30) {
    j++;
  } else if (j < n && buf[j] >= 0x31 && buf[j] <= 0x39) {
    j++;
    while (j < n && ehDigito(buf[j])) j++;
  } else {
    return -1;
  }
  if (j < n && buf[j] === 0x2e) {
    j++;
    if (!(j < n && ehDigito(buf[j]))) return -1;
    while (j < n && ehDigito(buf[j])) j++;
  }
  if (j < n && (buf[j] === 0x65 || buf[j] === 0x45)) {
    j++;
    if (j < n && (buf[j] === 0x2b || buf[j] === 0x2d)) j++;
    if (!(j < n && ehDigito(buf[j]))) return -1;
    while (j < n && ehDigito(buf[j])) j++;
  }
  return j;
}

function bytesIguais(buf, s, e, bytes) {
  if (e - s !== bytes.length) return false;
  for (let k = 0; k < bytes.length; k++) if (buf[s + k] !== bytes[k]) return false;
  return true;
}

const textoEscapado = (buf, aspa, fim) => JSON.parse(buf.toString('utf8', aspa, fim + 1));

// O nome de `tabela` (por tamanho) igual ao texto [s, e); null se nenhum.
function acharNome(tabela, buf, s, e) {
  const n = e - s;
  const cs = n < tabela.length ? tabela[n] : null;
  if (cs === null) return null;
  for (let x = 0; x < cs.length; x++) if (bytesIguais(buf, s, e, cs[x].bytes)) return cs[x];
  return null;
}

// O campo do ESQUEMA de `tipo` com o nome do texto [s, e); null se nenhum.
function acharCampo(tipo, buf, s, e, comEscape) {
  if (comEscape) {
    const nome = textoEscapado(buf, s - 1, e);
    for (const c of ESQUEMA[tipo]) if (c.nome === nome) return c;
    return null;
  }
  return acharNome(CAMPOS_POR_TAMANHO[tipo], buf, s, e);
}

// O índice da chave de atributo [s, e) em CHAVES_LOG; -1 se não é
// uma delas.
function chaveDeAtributo(buf, s, e, comEscape) {
  if (comEscape) return INDICE_CHAVE_LOG.get(textoEscapado(buf, s - 1, e)) ?? -1;
  const c = acharNome(CHAVES_LOG_POR_TAMANHO, buf, s, e);
  return c === null ? -1 : c.indice;
}

const TRUE = Buffer.from('true');
const FALSE = Buffer.from('false');
const NULL = Buffer.from('null');
// Desistência da leitura rápida: a linha segue pelo caminho original.
const DESISTE = Object.freeze({ desiste: true });

// Objeto podado de cada tipo, já com todos os campos do ESQUEMA (vazio
// vale o mesmo que ausente para o leitor), para cada tipo ter uma forma só.
function novoObjeto(tipo) {
  switch (tipo) {
    case T_RAIZ: return { resourceLogs: undefined, resourceMetrics: undefined };
    case T_RL: return { scopeLogs: undefined };
    case T_SL: return { logRecords: undefined };
    case T_LR: return { attributes: undefined, body: undefined, timeUnixNano: undefined, observedTimeUnixNano: undefined };
    case T_VALOR: return { stringValue: undefined, intValue: undefined, doubleValue: undefined, boolValue: undefined };
    case T_RM: return { scopeMetrics: undefined };
    case T_SM: return { metrics: undefined };
    case T_METRICA: return { name: undefined, sum: undefined };
    case T_SOMA: return { aggregationTemporality: undefined, dataPoints: undefined };
    default: return { timeUnixNano: undefined, asDouble: undefined, asInt: undefined };
  }
}

// Posição da leitura rápida na linha em curso.
let pos = 0;

function esperar(buf, byte) {
  if (buf[pos] !== byte) throw DESISTE;
  pos++;
}

// Pula, conferindo a gramática, o valor JSON em pos (sem espaço antes).
// Iterativo, com pilha própria: um aninhamento fundo não estoura nada.
const pilhaPular = [];
function pularValor(buf, n) {
  let i = pos;
  let d = 0;
  for (;;) {
    // Um valor em i.
    const c = buf[i];
    if (c === 0x22) {
      const f = fimTexto(buf, i, n);
      if (f < 0) throw DESISTE;
      i = f + 1;
    } else if (c === 0x7b || c === 0x5b) {
      const fecha = c === 0x7b ? 0x7d : 0x5d;
      i = pularEspaco(buf, i + 1, n);
      if (buf[i] === fecha) {
        i++;
      } else {
        pilhaPular[d++] = fecha;
        if (fecha === 0x7d) i = pularChave(buf, i, n);
        continue;
      }
    } else if (c === 0x2d || ehDigito(c)) {
      i = fimNumero(buf, i, n);
      if (i < 0) throw DESISTE;
    } else if (c === 0x74 && bytesIguais(buf, i, Math.min(i + 4, n), TRUE)) {
      i += 4;
    } else if (c === 0x66 && bytesIguais(buf, i, Math.min(i + 5, n), FALSE)) {
      i += 5;
    } else if (c === 0x6e && bytesIguais(buf, i, Math.min(i + 4, n), NULL)) {
      i += 4;
    } else {
      throw DESISTE;
    }
    // Depois de um valor: o próximo item ou o fim dos contêineres.
    for (;;) {
      if (d === 0) {
        pos = i;
        return;
      }
      i = pularEspaco(buf, i, n);
      const x = buf[i];
      const fecha = pilhaPular[d - 1];
      if (x === 0x2c) {
        i = pularEspaco(buf, i + 1, n);
        if (fecha === 0x7d) i = pularChave(buf, i, n);
        break;
      }
      if (x !== fecha) throw DESISTE;
      i++;
      d--;
    }
  }
}

// A chave em i, os espaços e os dois-pontos; devolve o início do valor.
function pularChave(buf, i, n) {
  if (buf[i] !== 0x22) throw DESISTE;
  const f = fimTexto(buf, i, n);
  if (f < 0) throw DESISTE;
  const j = pularEspaco(buf, f + 1, n);
  if (buf[j] !== 0x3a) throw DESISTE;
  return pularEspaco(buf, j + 1, n);
}

// Valor de um campo folha: texto, número, true, false ou null como no
// JSON.parse; um contêiner é conferido, pulado e vira CONTEINER.
function lerFolha(buf, n) {
  const c = buf[pos];
  if (c === 0x22) {
    const f = fimTexto(buf, pos, n);
    if (f < 0) throw DESISTE;
    const v = escapou ? textoEscapado(buf, pos, f) : textoDe(buf, pos + 1, f);
    pos = f + 1;
    return v;
  }
  if (c === 0x2d || ehDigito(c)) {
    const f = fimNumero(buf, pos, n);
    if (f < 0) throw DESISTE;
    const v = Number(textoDe(buf, pos, f));
    pos = f;
    return v;
  }
  if (c === 0x7b || c === 0x5b) {
    pularValor(buf, n);
    return CONTEINER;
  }
  if (c === 0x74 && bytesIguais(buf, pos, Math.min(pos + 4, n), TRUE)) {
    pos += 4;
    return true;
  }
  if (c === 0x66 && bytesIguais(buf, pos, Math.min(pos + 5, n), FALSE)) {
    pos += 5;
    return false;
  }
  if (c === 0x6e && bytesIguais(buf, pos, Math.min(pos + 4, n), NULL)) {
    pos += 4;
    return null;
  }
  throw DESISTE;
}

// O valor do campo `c` em pos, podado.
function lerCampo(buf, n, c) {
  const x = buf[pos];
  switch (c.kind) {
    case K_OBJETO:
      if (x === 0x7b) return lerObjeto(buf, n, c.tipo);
      break;
    case K_LISTA:
      if (x === 0x5b) return lerLista(buf, n, c.tipo, c.max);
      break;
    case K_FOLHA:
      return lerFolha(buf, n);
    default:
      if (x === 0x5b) return lerAtributos(buf, n);
  }
  // Tipo errado no lugar: conferido, pulado, null (o leitor não o usa).
  pularValor(buf, n);
  return null;
}

// Qual campo de um atributo ({key, value}) ou de um valor ({stringValue,
// intValue, doubleValue, boolValue}) é a chave [s, e): o índice em `nomes`
// ou -1.
const NOMES_ATRIBUTO = Object.freeze(['key', 'value'].map((x) => Buffer.from(x)));
const NOMES_VALOR = Object.freeze(['stringValue', 'intValue', 'doubleValue', 'boolValue'].map((x) => Buffer.from(x)));
function indiceDoNome(nomes, buf, s, e, comEscape) {
  if (comEscape) {
    const nome = textoEscapado(buf, s - 1, e);
    for (let x = 0; x < nomes.length; x++) if (nomes[x].toString('latin1') === nome) return x;
    return -1;
  }
  for (let x = 0; x < nomes.length; x++) if (bytesIguais(buf, s, e, nomes[x])) return x;
  return -1;
}

// A chave do membro em pos, os espaços e os dois-pontos: devolve o índice
// dela em `nomes` (ou -1) e deixa pos no valor. O caminho curto compara os
// bytes de cada nome e a aspa que fecha direto na linha: um nome não tem
// aspa, barra nem controle, então dá o mesmo que fimTexto + indiceDoNome.
function chaveDoMembro(buf, n, nomes) {
  if (buf[pos] !== 0x22) throw DESISTE;
  const c = buf[pos + 1];
  let x = -1;
  for (let t = 0; t < nomes.length && x < 0; t++) {
    const b = nomes[t];
    const f = pos + 1 + b.length;
    if (b[0] !== c || f >= n || buf[f] !== 0x22) continue;
    let k = 1;
    while (k < b.length && buf[pos + 1 + k] === b[k]) k++;
    if (k === b.length) {
      x = t;
      pos = f + 1;
    }
  }
  if (x < 0) {
    const f = fimTexto(buf, pos, n);
    if (f < 0) throw DESISTE;
    x = indiceDoNome(nomes, buf, pos + 1, f, escapou);
    pos = f + 1;
  }
  pos = pularEspaco(buf, pos, n);
  esperar(buf, 0x3a);
  pos = pularEspaco(buf, pos, n);
  return x;
}

// Depois do valor de um membro: true com pos na próxima chave, false com
// pos depois do } que fecha o objeto.
function haMaisMembros(buf, n) {
  pos = pularEspaco(buf, pos, n);
  const c = buf[pos];
  if (c === 0x2c) {
    pos = pularEspaco(buf, pos + 1, n);
    return true;
  }
  if (c === 0x7d) {
    pos++;
    return false;
  }
  throw DESISTE;
}

// O valor em pos ({stringValue, intValue, doubleValue, boolValue}, vale o
// último de cada) por valorDosCampos.
function lerValorDeAtributo(buf, n) {
  let s;
  let i;
  let d;
  let b;
  pos = pularEspaco(buf, pos + 1, n);
  if (buf[pos] === 0x7d) {
    pos++;
    return undefined;
  }
  do {
    const x = chaveDoMembro(buf, n, NOMES_VALOR);
    if (x < 0) pularValor(buf, n);
    else if (x === 0) s = lerFolha(buf, n);
    else if (x === 1) i = lerFolha(buf, n);
    else if (x === 2) d = lerFolha(buf, n);
    else b = lerFolha(buf, n);
  } while (haMaisMembros(buf, n));
  return valorDosCampos(s, i, d, b);
}

// O atributo em pos ({key, value}): o índice da chave (-1 se não é texto
// de CHAVES_LOG) em aChave e o valor (undefined se não é objeto ou não tem
// valor válido) em aValor, o último de cada.
let aChave;
let aValor;
function lerAtributo(buf, n) {
  aChave = -1;
  aValor = undefined;
  pos = pularEspaco(buf, pos + 1, n);
  if (buf[pos] === 0x7d) {
    pos++;
    return;
  }
  do {
    const x = chaveDoMembro(buf, n, NOMES_ATRIBUTO);
    if (x === 0 && buf[pos] === 0x22) {
      const f = fimTexto(buf, pos, n);
      if (f < 0) throw DESISTE;
      aChave = chaveDeAtributo(buf, pos + 1, f, escapou);
      pos = f + 1;
    } else if (x === 1 && buf[pos] === 0x7b) {
      aValor = lerValorDeAtributo(buf, n);
    } else {
      pularValor(buf, n);
      if (x === 0) aChave = -1;
      else if (x === 1) aValor = undefined;
    }
  } while (haMaisMembros(buf, n));
}

// A lista de atributos em pos, já como atributos() a daria. Os valores
// passam por `lidos`, de uso só aqui (lerAtributos não se chama de novo
// por dentro).
const lidos = valoresVazios();
function lerAtributos(buf, n) {
  lidos.fill(undefined);
  pos = pularEspaco(buf, pos + 1, n);
  if (buf[pos] === 0x5d) {
    pos++;
    return new AtributosLidos(lidos);
  }
  let vistos = 0;
  for (;;) {
    if (vistos < ATRIBUTOS_MAX && buf[pos] === 0x7b) {
      lerAtributo(buf, n);
      if (aChave >= 0 && lidos[aChave] === undefined && aValor !== undefined) lidos[aChave] = aValor;
    } else {
      pularValor(buf, n);
    }
    vistos++;
    pos = pularEspaco(buf, pos, n);
    const x = buf[pos];
    if (x === 0x2c) {
      pos = pularEspaco(buf, pos + 1, n);
    } else if (x === 0x5d) {
      pos++;
      return new AtributosLidos(lidos);
    } else {
      throw DESISTE;
    }
  }
}

// O objeto em pos, do `tipo` do ESQUEMA. A profundidade desta recursão é a
// do ESQUEMA (no máximo 10); o que fica fora dele vai para pularValor.
function lerObjeto(buf, n, tipo) {
  const o = novoObjeto(tipo);
  pos = pularEspaco(buf, pos + 1, n);
  if (buf[pos] === 0x7d) {
    pos++;
    return o;
  }
  for (;;) {
    if (buf[pos] !== 0x22) throw DESISTE;
    const f = fimTexto(buf, pos, n);
    if (f < 0) throw DESISTE;
    const c = acharCampo(tipo, buf, pos + 1, f, escapou);
    pos = pularEspaco(buf, f + 1, n);
    esperar(buf, 0x3a);
    pos = pularEspaco(buf, pos, n);
    if (c === null) pularValor(buf, n);
    else o[c.nome] = lerCampo(buf, n, c);
    pos = pularEspaco(buf, pos, n);
    const x = buf[pos];
    if (x === 0x2c) {
      pos = pularEspaco(buf, pos + 1, n);
    } else if (x === 0x7d) {
      pos++;
      return o;
    } else {
      throw DESISTE;
    }
  }
}

// A lista em pos, com os `max` primeiros itens; item que não é objeto vira
// null no lugar (o leitor o pula).
function lerLista(buf, n, tipo, max) {
  const lista = [];
  pos = pularEspaco(buf, pos + 1, n);
  if (buf[pos] === 0x5d) {
    pos++;
    return lista;
  }
  let vistos = 0;
  for (;;) {
    if (vistos < max && buf[pos] === 0x7b) {
      lista.push(lerObjeto(buf, n, tipo));
    } else {
      pularValor(buf, n);
      if (vistos < max) lista.push(null);
    }
    vistos++;
    pos = pularEspaco(buf, pos, n);
    const x = buf[pos];
    if (x === 0x2c) {
      pos = pularEspaco(buf, pos + 1, n);
    } else if (x === 0x5d) {
      pos++;
      return lista;
    } else {
      throw DESISTE;
    }
  }
}

// O lote podado da linha; LINHA_VAZIA para linha só com espaços JSON; null
// para desistir (caminho original).
function podarLinha(buf) {
  try {
    const n = buf.length;
    pos = pularEspaco(buf, 0, n);
    if (pos === n) return LINHA_VAZIA;
    if (buf[pos] !== 0x7b) return null;
    const raiz = lerObjeto(buf, n, T_RAIZ);
    return pularEspaco(buf, pos, n) === n ? raiz : null;
  } catch {
    return null;
  }
}

// Uma linha do arquivo: os registros (null para linha corrompida) e se ela
// saiu pela leitura rápida. Exportada só para o teste diferencial.
export function _lerLinha(buf, agoraMs, pares) {
  const o = podarLinha(buf);
  if (o === LINHA_VAZIA) return { registros: [], rapida: true };
  if (o !== null) return { registros: registrosDoLote(o, agoraMs, pares), rapida: true };
  const texto = buf.toString('utf8').trim();
  return { registros: texto.length === 0 ? [] : registrosDaLinha(texto, agoraMs, pares), rapida: false };
}

function processarLinha(buf, agoraMs, saida, pares) {
  const r = _lerLinha(buf, agoraMs, pares).registros;
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
    const aberto = tamanhoAberto(arquivo, atual.ino);
    const tamanho = aberto ?? Number(atual.size);
    const ino = String(atual.ino);
    const cur = cursorValido(cursor);
    // Tamanho da listagem menor que o cursor não é truncamento: no Windows,
    // com o Collector vivo, ela mostra 0. Só o descritor prova que o arquivo
    // encolheu; sem ele, o cursor fica e o próximo passo tenta de novo
    // (portão v0.4.0, I-2).
    if (aberto === null && cur !== null && cur.ino === ino && cur.pos > tamanho) return { ...semNada, cursor };
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

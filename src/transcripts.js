import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_MAX_MS } from './base.js';
import { dirDados, gravarJsonAtomico, idValido, lerJson } from './estado.js';
import { effortValido, EFFORTS_VALIDOS, sanear } from './util.js';

// Parser dos transcripts do Claude Code (spec 6.6; casos de borda 7 #7–#9;
// segurança 8.1 S2/S9; performance 9). Transcripts são entrada não confiável:
// qualquer skill, saída de ferramenta ou texto colado vai parar neles, e uma
// skill maliciosa escreve linhas inteiras. Daqui só saem números e ids
// validados; os dois rótulos de texto (modelo e projeto) passam por `sanear`.
//
// Formas lidas, e nenhuma outra: <raiz>/<projeto>/*.jsonl e
// <raiz>/<projeto>/<sessão>/subagents/agent-*.jsonl, sempre por lstat (link,
// junção, FIFO e pasta no lugar de arquivo são ignorados).
//
// Índice incremental em <dirDados>/indice-transcripts.json, por caminho
// relativo à raiz: offset (byte depois do último \n completo), size, mtimeMs,
// âncora (hash dos 4 KiB antes do offset), linhas inválidas, tabelas de
// sessões/modelos/projetos e, por resposta, o requestId e 13 números em
// `numeros` (ts, índice da sessão, subagente 0/1, índice do projeto, índice do
// modelo, índice do effort em EFFORTS_VALIDOS, input, output, thinking,
// cacheRead, cacheCreate, cacheCreate1h, cacheCreate5m; -1 = null). Nenhum
// texto de transcript é guardado; o índice lido passa pelos mesmos validadores
// das linhas, então nunca produz nada que um transcript não produziria. O
// índice gravado cabe sempre no teto que o leitor aceita: passou dele, saem as
// entradas maiores (indiceNoTeto). Um índice de outra versão (a 1 guardava 11
// números por resposta, sem o detalhe do cache criado) é descartado e
// reconstruído, nunca lido com o layout errado.
//
// O índice não cresce com o número de sessões: cada resposta guarda só o
// índice da sua sessão numa tabela por arquivo, que tem no máximo uma entrada
// por resposta (tabelaValida), e o índice inteiro fica no teto de 16 MiB. A
// soma por sessão é feita depois, na agregação (agregacao.js).
//
// Uma linha só vira registro quando o seu \n chega. A última linha sem \n
// (sendo escrita agora, ou plantada) nunca é decodificada: fica depois do
// offset e só é relida quando o arquivo mudar. Assim cada byte é decodificado
// uma vez só, e uma cauda hostil não custa um JSON.parse a cada chamada.

export const ARQ_INDICE = 'indice-transcripts.json';
// Linha acima disto (bytes, sem o \n) é pulada sem ser guardada inteira.
export const LINHA_MAX_BYTES = 5 * 1024 * 1024;
// Teto de arquivos candidatos por chamada; passou disso, a caminhada para e o
// resultado sai com truncado: true.
export const ARQUIVOS_MAX = 20_000;
// Teto de entradas de diretório examinadas: 10 por arquivo permitido, para que
// uma pasta com milhões de nomes não prenda a caminhada.
const ENTRADAS_POR_ARQUIVO = 10;
const INDICE_MAX_BYTES = 16 * 1024 * 1024;
// 2: mais cacheCreate1h e cacheCreate5m por resposta (PASSO de 11 para 13).
export const VERSAO_INDICE = 2;
// Tolerância para relógio adiantado: um timestamp até 1 dia à frente ainda vale.
const FUTURO_MAX_MS = 86_400_000;
const TS_MIN_MS = -DATA_MAX_MS;
const TS_MAX_CHARS = 64;
const USO_MAX = 1e9;
const MODEL_MAX = 40;
const PROJETO_MAX = 64;
// cwd só serve para achar o nome da pasta; o caminho inteiro nunca sai daqui.
const CWD_MAX = 32_767;
// Cache por arquivo de cwd → projeto e modelo → rótulo: só textos curtos e só
// até 256 entradas, para um arquivo hostil não inflar a memória.
const CACHE_ROTULOS_MAX = 256;
const CACHE_TEXTO_MAX = 1024;
const PEDACO = 1024 * 1024;
const ANCORA_BYTES = 4096;
const ANCORA_MAX = 2 ** 48 - 1;
const ID_REQUISICAO = /^[A-Za-z0-9_-]{1,128}$/;
const PASSO = 13;
const USOS = ['input', 'output', 'thinking', 'cacheRead', 'cacheCreate'];
// Detalhe do cache criado por duração (usage.cache_creation): número ou null,
// sempre os dois juntos. Guardados depois dos USOS, com -1 = null no índice.
const DETALHE_CACHE = ['cacheCreate1h', 'cacheCreate5m'];
// Filtro barato: só linhas com a chave "usage" são decodificadas. Dentro de um
// texto JSON as aspas vêm escapadas (\"usage\"), então isto só casa com uma
// chave ou um valor "usage" de verdade.
const AGULHA = Buffer.from('"usage"');
// O_NOFOLLOW recusa link no último componente; O_NONBLOCK impede que um FIFO
// posto no lugar do arquivo entre o lstat e o open trave a leitura. No Windows
// as duas constantes não existem; lá a troca é pega pelo dev/ino (abrirConferido).
const ABRIR = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const CHAVES_INDICE = ['arquivos', 'raiz', 'versao'];
const CHAVES_ENTRADA = ['ancora', 'ids', 'linhasInvalidas', 'modelos', 'mtimeMs', 'numeros', 'offset', 'projetos', 'sessoes', 'size'];
// Chamado sempre por fsp.<método>, nunca desestruturado.
const fsp = fs.promises;
const INVALIDA = Symbol('invalida');

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const proprio = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const inteiroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const sumiu = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
const hash48 = (dados) => crypto.createHash('sha256').update(dados).digest().readUIntBE(0, 6);
// mtime em ms com precisão de µs, derivado sempre do mesmo jeito (lstat e
// fstat), para a comparação com o índice ser exata.
const mtimeDe = (st) => Number(st.mtimeNs / 1000n) / 1000;
const leituraIlegivel = () => ({ registros: [], linhasInvalidas: 0, ilegivel: true });
const resultadoNeutro = () => ({ registros: [], linhasInvalidas: 0, arquivos: 0, ilegiveis: 1, truncado: false });
const fechar = async (fh) => { try { await fh.close(); } catch { /* já fechado */ } };

// requestId (ou message.id) aceito como chave: padrão fixo e nunca um membro de
// Object.prototype, para que um consumidor que indexe por ele num objeto comum
// não alcance o protótipo.
const idRequisicaoValido = (id) => typeof id === 'string' && ID_REQUISICAO.test(id) && !(id in Object.prototype);

// Número de uso: inteiro finito de 0 a 1e9, ou null (ausente ou inválido). -0 vira 0.
const numeroUso = (n) => (inteiroEntre(n, 0, USO_MAX) ? n + 0 : null);

// Detalhe do cache criado: { h1, m5 } com os dois números de uso válidos em
// usage.cache_creation (ephemeral_1h_input_tokens e ephemeral_5m_input_tokens),
// ou { h1: null, m5: null }. Um só válido também dá null nos dois: o outro
// nunca é deduzido do total. A conferência com cache_creation_input_tokens é
// da agregação, depois da deduplicação.
function detalheCache(u) {
  const cc = proprio(u, 'cache_creation');
  if (!ehObjeto(cc)) return { h1: null, m5: null };
  const h1 = numeroUso(proprio(cc, 'ephemeral_1h_input_tokens'));
  const m5 = numeroUso(proprio(cc, 'ephemeral_5m_input_tokens'));
  return h1 === null || m5 === null ? { h1: null, m5: null } : { h1, m5 };
}

function instanteLinha(valor, agoraMs) {
  if (typeof valor !== 'string' || valor.length > TS_MAX_CHARS) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) && t <= agoraMs + FUTURO_MAX_MS ? t : null;
}

// Último segmento de um caminho com / ou \ (o cwd pode vir de outro sistema),
// ignorando separadores no fim. Sem regex: nada de backtracking em texto hostil.
function ultimoSegmento(texto) {
  let fim = texto.length;
  while (fim > 0 && (texto[fim - 1] === '/' || texto[fim - 1] === '\\')) fim--;
  if (fim === 0) return '';
  const ini = Math.max(texto.lastIndexOf('/', fim - 1), texto.lastIndexOf('\\', fim - 1)) + 1;
  return texto.slice(ini, fim);
}

// Nome de pasta exibível: o caminho inteiro é saneado antes (uma sequência OSC
// pode trazer / na URL), depois fica só o último segmento, saneado a 64. Nunca
// contém / nem \. Não-string ou vazio → null.
function rotuloProjeto(bruto) {
  if (typeof bruto !== 'string') return null;
  const limpo = sanear(bruto, CWD_MAX);
  return limpo === null ? null : sanear(ultimoSegmento(limpo), PROJETO_MAX);
}

const rotuloModelo = (bruto) => sanear(bruto, MODEL_MAX);

function comCache(cache, bruto, calcular) {
  if (typeof bruto !== 'string' || bruto.length > CACHE_TEXTO_MAX) return calcular(bruto);
  const guardado = cache.get(bruto);
  if (guardado !== undefined) return guardado;
  const valor = calcular(bruto);
  if (cache.size < CACHE_ROTULOS_MAX) cache.set(bruto, valor);
  return valor;
}

function novoContexto(subagente, projetoPadrao, agoraMs) {
  return {
    subagente, projetoPadrao, agoraMs,
    mapa: new Map(), invalidas: 0,
    projetos: new Map(), modelos: new Map(),
  };
}

// Registro de uma linha já decodificada: o Registro, INVALIDA (a linha conta em
// linhasInvalidas) ou null (não é registro de resposta: sem message.usage, ou
// nenhum número de uso válido). Só lê chaves próprias.
function registroDe(d, ctx) {
  if (!ehObjeto(d)) return INVALIDA;
  const m = proprio(d, 'message');
  if (!ehObjeto(m)) return null;
  const u = proprio(m, 'usage');
  if (!ehObjeto(u)) return null;
  const detalhes = proprio(u, 'output_tokens_details');
  const input = numeroUso(proprio(u, 'input_tokens'));
  const output = numeroUso(proprio(u, 'output_tokens'));
  const thinking = ehObjeto(detalhes) ? numeroUso(proprio(detalhes, 'thinking_tokens')) : null;
  const cacheRead = numeroUso(proprio(u, 'cache_read_input_tokens'));
  const cacheCreate = numeroUso(proprio(u, 'cache_creation_input_tokens'));
  if (input === null && output === null && thinking === null && cacheRead === null && cacheCreate === null) return null;
  // requestId presente precisa ser válido; só a falta dele (undefined ou null)
  // cai para message.id.
  const req = proprio(d, 'requestId');
  const chave = req === undefined || req === null ? proprio(m, 'id') : req;
  if (!idRequisicaoValido(chave)) return INVALIDA;
  const ts = instanteLinha(proprio(d, 'timestamp'), ctx.agoraMs);
  if (ts === null) return INVALIDA;
  const sessao = proprio(d, 'sessionId');
  const detalhe = detalheCache(u);
  return {
    requestId: chave,
    ts,
    sessionId: idValido(sessao) ? sessao : null,
    subagente: ctx.subagente || proprio(d, 'isSidechain') === true,
    projeto: comCache(ctx.projetos, proprio(d, 'cwd'), rotuloProjeto) ?? ctx.projetoPadrao,
    model: comCache(ctx.modelos, proprio(m, 'model'), rotuloModelo),
    effort: effortValido(proprio(d, 'effort')),
    input: input ?? 0,
    output: output ?? 0,
    thinking: thinking ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheCreate: cacheCreate ?? 0,
    cacheCreate1h: detalhe.h1,
    cacheCreate5m: detalhe.m5,
  };
}

// Uma resposta por requestId: cada campo de uso fica com o máximo entre as
// linhas (uma por apiBlockIndex, e o uso pode crescer entre elas); no detalhe
// do cache, null é ausência e perde para qualquer número (como cada linha traz
// os dois ou nenhum, o resultado também traz os dois ou nenhum); subagente
// vale se qualquer ocorrência for de subagente; o resto vem da primeira.
// `copiar` protege o registro de origem (índice guardado) de ser alterado.
function juntar(mapa, r, copiar) {
  const a = mapa.get(r.requestId);
  if (a === undefined) {
    mapa.set(r.requestId, copiar ? { ...r } : r);
    return;
  }
  for (const k of USOS) if (r[k] > a[k]) a[k] = r[k];
  for (const k of DETALHE_CACHE) if (r[k] !== null && (a[k] === null || r[k] > a[k])) a[k] = r[k];
  if (r.subagente) a.subagente = true;
}

// Linha sem "usage" só conta como inválida se não estiver em branco nem
// começar com { (decodificar toda linha custaria o dobro; 477 MB/semana
// medidos em 2026-09-25).
function vaziaOuObjeto(b) {
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0x20 || c === 0x09 || c === 0x0d) continue;
    return c === 0x7b;
  }
  return true;
}

// Um JSON.parse que falha custa 10 a 25 µs (a exceção e a mensagem), contra
// 1 a 2 µs de um que passa: um arquivo de linhas curtas inválidas levaria 22 s
// a cada 10 MB (medido em 2026-09-25). Duas checagens sem exceção vêm antes,
// e nenhuma recusa um texto que JSON.parse aceitaria: toda linha precisa
// começar com { e terminar com } (sem contar espaços), e a linha curta, onde
// o custo da exceção pesaria por byte, passa inteira pelo validador abaixo.
const VALIDAR_ATE = 1024;
const ehEspaco = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

function pareceObjeto(b) {
  let i = 0;
  let f = b.length - 1;
  while (i <= f && ehEspaco(b[i])) i++;
  while (f >= i && ehEspaco(b[f])) f--;
  return f > i && b[i] === 0x7b && b[f] === 0x7d;
}

const ehDigito = (c) => c >= 0x30 && c <= 0x39;
const ehHex = (c) => ehDigito(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const pularEspacos = (b, i) => {
  while (i < b.length && ehEspaco(b[i])) i++;
  return i;
};

// Índice logo depois da string que abre em b[i] (aspas), ou -1. Byte >= 0x80
// vale dentro da string (UTF-8 inválido vira U+FFFD, que JSON.parse aceita).
function fimDaString(b, i) {
  i++;
  while (i < b.length) {
    const c = b[i];
    if (c === 0x22) return i + 1;
    if (c < 0x20) return -1;
    if (c !== 0x5c) {
      i++;
      continue;
    }
    const e = b[i + 1];
    if (e === 0x75) {
      if (!(ehHex(b[i + 2]) && ehHex(b[i + 3]) && ehHex(b[i + 4]) && ehHex(b[i + 5]))) return -1;
      i += 6;
    } else if (e === 0x22 || e === 0x5c || e === 0x2f || e === 0x62 || e === 0x66 || e === 0x6e || e === 0x72 || e === 0x74) {
      i += 2;
    } else {
      return -1;
    }
  }
  return -1;
}

// -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?  →  índice depois, ou -1.
function fimDoNumero(b, i) {
  if (b[i] === 0x2d) i++;
  if (b[i] === 0x30) i++;
  else if (b[i] >= 0x31 && b[i] <= 0x39) while (ehDigito(b[i])) i++;
  else return -1;
  if (b[i] === 0x2e) {
    i++;
    if (!ehDigito(b[i])) return -1;
    while (ehDigito(b[i])) i++;
  }
  if (b[i] === 0x65 || b[i] === 0x45) {
    i++;
    if (b[i] === 0x2b || b[i] === 0x2d) i++;
    if (!ehDigito(b[i])) return -1;
    while (ehDigito(b[i])) i++;
  }
  return i;
}

const LITERAIS = [Buffer.from('true'), Buffer.from('false'), Buffer.from('null')];
function fimDoLiteral(b, i) {
  for (const l of LITERAIS) {
    if (b[i] === l[0] && b.length - i >= l.length && b.compare(l, 0, l.length, i, i + l.length) === 0) return i + l.length;
  }
  return -1;
}

// true se os bytes formam um texto JSON (RFC 8259) que JSON.parse aceitaria
// depois de decodificar o UTF-8. Iterativo, sem exceção, O(n).
function jsonValido(b) {
  const pilha = [];
  let i = pularEspacos(b, 0);
  let estado = 0; // 0 = espera valor, 1 = espera chave, 2 = depois de um valor
  for (;;) {
    if (estado === 0) {
      const c = b[i];
      if (c === 0x7b || c === 0x5b) {
        i = pularEspacos(b, i + 1);
        if (b[i] === (c === 0x7b ? 0x7d : 0x5d)) {
          i++;
          estado = 2;
        } else {
          pilha.push(c);
          estado = c === 0x7b ? 1 : 0;
        }
        continue;
      }
      if (c === 0x22) i = fimDaString(b, i);
      else if (c === 0x2d || ehDigito(c)) i = fimDoNumero(b, i);
      else i = fimDoLiteral(b, i);
      if (i < 0) return false;
      estado = 2;
    } else if (estado === 1) {
      if (b[i] !== 0x22) return false;
      i = pularEspacos(b, fimDaString(b, i));
      if (i < 0 || b[i] !== 0x3a) return false;
      i = pularEspacos(b, i + 1);
      estado = 0;
    } else {
      i = pularEspacos(b, i);
      if (pilha.length === 0) return i === b.length;
      const topo = pilha[pilha.length - 1];
      const c = b[i];
      if (c === 0x2c) {
        i = pularEspacos(b, i + 1);
        estado = topo === 0x7b ? 1 : 0;
      } else if (c === (topo === 0x7b ? 0x7d : 0x5d)) {
        pilha.pop();
        i++;
      } else {
        return false;
      }
    }
  }
}

// Uma linha terminada por \n (sem o \n). Só linhas completas chegam aqui.
function tratarLinha(linha, ctx) {
  const fim = linha.length > 0 && linha[linha.length - 1] === 0x0d ? linha.length - 1 : linha.length;
  const corpo = fim === linha.length ? linha : linha.subarray(0, fim);
  if (corpo.indexOf(AGULHA) === -1) {
    if (!vaziaOuObjeto(corpo)) ctx.invalidas++;
    return;
  }
  if (!pareceObjeto(corpo) || (corpo.length < VALIDAR_ATE && !jsonValido(corpo))) {
    ctx.invalidas++;
    return;
  }
  let d;
  try {
    d = JSON.parse(corpo.toString('utf8'));
  } catch {
    ctx.invalidas++;
    return;
  }
  const r = registroDe(d, ctx);
  if (r === INVALIDA) ctx.invalidas++;
  else if (r !== null) juntar(ctx.mapa, r, false);
}

// Lê os bytes [inicio, fim) em pedaços de até 1 MiB e separa em \n. Uma linha
// que passa de LINHA_MAX_BYTES deixa de ser acumulada na hora (os bytes seguem
// sendo descartados até o próximo \n) e conta uma vez como inválida. O que
// sobra depois do último \n (a cauda sem \n) é largado sem ser decodificado.
// Devolve o byte seguinte ao último \n lido (o offset que o índice pode
// guardar) e os até 4 KiB antes dele, tirados dos mesmos bytes que viraram
// registros: a âncora nunca descreve um conteúdo diferente do que foi lido.
// `antes` são os até 4 KiB antes de `inicio`, já conferidos contra a âncora
// guardada.
async function lerFaixa(fh, inicio, fim, ctx, antes) {
  const buf = Buffer.allocUnsafe(Math.max(1, Math.min(PEDACO, fim - inicio)));
  let pos = inicio;
  let partes = [];
  let tam = 0;
  let descartando = false;
  let consumido = inicio;
  let primeira = inicio === 0;
  let janela = antes;
  let ancorados = antes;
  while (pos < fim) {
    const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, fim - pos), pos);
    if (bytesRead === 0) break;
    const vista = buf.subarray(0, bytesRead);
    const consumidoAntes = consumido;
    let i = 0;
    if (primeira) {
      primeira = false;
      if (bytesRead >= 3 && vista[0] === 0xef && vista[1] === 0xbb && vista[2] === 0xbf) i = 3;
    }
    while (i < bytesRead) {
      const nl = vista.indexOf(0x0a, i);
      const ate = nl === -1 ? bytesRead : nl;
      if (!descartando) {
        const total = tam + (ate - i);
        if (total > LINHA_MAX_BYTES) {
          descartando = true;
          partes = [];
          tam = 0;
        } else if (nl === -1) {
          partes.push(Buffer.from(vista.subarray(i, ate)));
          tam = total;
        } else {
          const linha = tam === 0 ? vista.subarray(i, ate) : Buffer.concat([...partes, vista.subarray(i, ate)], total);
          partes = [];
          tam = 0;
          tratarLinha(linha, ctx);
        }
      }
      if (nl === -1) break;
      if (descartando) {
        ctx.invalidas++;
        descartando = false;
      }
      consumido = pos + nl + 1;
      i = nl + 1;
    }
    if (consumido !== consumidoAntes) ancorados = ultimosBytes(janela, vista.subarray(0, consumido - pos));
    janela = ultimosBytes(janela, vista);
    pos += bytesRead;
  }
  return { consumido, ancora: hash48(ancorados) };
}

// Cópia dos últimos ANCORA_BYTES de a + b (b pode ser uma vista do buffer
// reaproveitado, por isso sempre copia).
function ultimosBytes(a, b) {
  if (b.length >= ANCORA_BYTES) return Buffer.from(b.subarray(b.length - ANCORA_BYTES));
  const falta = ANCORA_BYTES - b.length;
  return Buffer.concat([a.length > falta ? a.subarray(a.length - falta) : a, b]);
}

// Os até 4 KiB antes de `offset`, lidos do arquivo, para conferir a âncora de
// um arquivo que cresceu. null se não deu para ler tudo (encolheu no meio).
async function bytesAntes(fh, offset) {
  const n = Math.min(offset, ANCORA_BYTES);
  const b = Buffer.alloc(n);
  let lidos = 0;
  while (lidos < n) {
    const { bytesRead } = await fh.read(b, lidos, n - lidos, offset - n + lidos);
    if (bytesRead === 0) return null;
    lidos += bytesRead;
  }
  return b;
}

// Abre sem seguir link nem travar em FIFO e confere, pelo mesmo descritor, que
// é o arquivo regular visto no lstat (mesmo dev e ino, em bigint para não
// perder bits do id de arquivo do NTFS).
async function abrirConferido(abs, visto) {
  let fh;
  try {
    fh = await fsp.open(abs, ABRIR);
  } catch (e) {
    return { erro: e };
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (st.isFile() && st.dev === visto.dev && st.ino === visto.ino) return { fh, st };
  } catch { /* cai no fechamento */ }
  await fechar(fh);
  return { erro: { code: 'ETROCADO' } };
}

// Lê um arquivo inteiro ou, com a entrada anterior do índice, só o que falta.
// Relê do zero quando o arquivo encolheu, quando o mtime voltou atrás, quando
// tem o mesmo tamanho e outro mtime, ou quando a âncora não confere. A entrada
// devolvida leva sempre o size e o mtime lidos agora, mesmo sem \n novo: um
// arquivo que cresceu só na cauda e depois parou cai na via rápida da próxima
// chamada, em vez de ser reaberto a cada uma.
async function lerArquivo(item, ant, agoraMs) {
  const aberto = await abrirConferido(item.abs, item.st);
  if (aberto.erro) return aberto;
  const { fh, st } = aberto;
  try {
    const tam = Number(st.size);
    const mt = mtimeDe(st);
    const ctx = novoContexto(item.subagente, item.projetoPadrao, agoraMs);
    let inicio = 0;
    let antes = Buffer.alloc(0);
    const continua = ant !== undefined && ((tam === ant.size && mt === ant.mtimeMs) || (tam > ant.size && mt >= ant.mtimeMs));
    const conferido = continua ? await bytesAntes(fh, ant.offset) : null;
    const continuou = conferido !== null && hash48(conferido) === ant.ancora;
    if (continuou) {
      inicio = ant.offset;
      antes = conferido;
      ctx.invalidas = ant.linhasInvalidas;
      for (const r of ant.registros) ctx.mapa.set(r.requestId, { ...r });
    }
    const { consumido, ancora } = await lerFaixa(fh, inicio, tam, ctx, antes);
    return {
      entrada: {
        offset: consumido, size: tam, mtimeMs: mt, ancora, linhasInvalidas: ctx.invalidas,
        registros: [...ctx.mapa.values()], disco: null,
      },
    };
  } catch (e) {
    return { erro: e ?? {} };
  } finally {
    await fechar(fh);
  }
}

// Subagente pelo formato do caminho (…/subagents/agent-*.jsonl) e o nome da
// pasta do projeto, para quando a linha não traz cwd.
const ehNomeSubagente = (nome) => nome.length > 12 && nome.startsWith('agent-') && nome.endsWith('.jsonl');
const ehNomeTranscript = (nome) => nome.length > 6 && nome.endsWith('.jsonl');

function formaDoArquivo(abs) {
  const pai = path.dirname(abs);
  const subagente = path.basename(pai) === 'subagents' && ehNomeSubagente(path.basename(abs));
  const dirProjeto = subagente ? path.dirname(path.dirname(pai)) : pai;
  return { subagente, projetoPadrao: rotuloProjeto(path.basename(dirProjeto)) };
}

// Registro (uma resposta): { requestId, ts (ms), sessionId (ou null),
// subagente, projeto, model, effort (ou null), input, output, thinking,
// cacheRead, cacheCreate (inteiros de 0 a 1e9; ausente vale 0), cacheCreate1h,
// cacheCreate5m (inteiros de 0 a 1e9, ou null nos dois quando a linha não
// traz o detalhe do cache criado) }.
//
// Lê um transcript avulso. Devolve { registros, linhasInvalidas, ilegivel };
// caminho que não é arquivo regular (inexistente, pasta, link, FIFO) ou que
// não pôde ser lido → { registros: [], linhasInvalidas: 0, ilegivel: true }.
// Uma última linha sem \n ainda não é registro nem conta como inválida: pode
// estar sendo escrita agora, e só é decodificada quando o \n chegar.
// Nunca rejeita.
export async function lerTranscript(arquivo) {
  try {
    if (typeof arquivo !== 'string' || arquivo === '') return leituraIlegivel();
    const abs = path.resolve(arquivo);
    let st;
    try {
      st = await fsp.lstat(abs, { bigint: true });
    } catch {
      return leituraIlegivel();
    }
    if (!st.isFile()) return leituraIlegivel();
    const r = await lerArquivo({ abs, st, ...formaDoArquivo(abs) }, undefined, Date.now());
    if (r.erro) return leituraIlegivel();
    return { registros: r.entrada.registros, linhasInvalidas: r.entrada.linhasInvalidas, ilegivel: false };
  } catch {
    return leituraIlegivel();
  }
}

// --- caminhada -------------------------------------------------------------

async function lstatOuNada(abs, saida) {
  try {
    return await fsp.lstat(abs, { bigint: true });
  } catch (e) {
    if (!sumiu(e)) saida.ilegiveis++;
    return null;
  }
}

// Nomes de um diretório em ordem, gastando o orçamento de entradas. Esgotado o
// orçamento, marca truncado (quem chama para). Ilegível → null e contado.
async function listarNomes(dir, orc, saida) {
  let d;
  try {
    d = await fsp.opendir(dir);
  } catch (e) {
    if (!sumiu(e)) saida.ilegiveis++;
    return null;
  }
  const nomes = [];
  try {
    for await (const ent of d) {
      if (orc.entradas <= 0) {
        saida.truncado = true;
        break;
      }
      orc.entradas--;
      nomes.push(ent.name);
    }
  } catch (e) {
    if (!sumiu(e)) saida.ilegiveis++;
    return null;
  }
  return nomes.sort();
}

function adicionar(saida, orc, item) {
  if (orc.arquivos <= 0) {
    saida.truncado = true;
    return;
  }
  orc.arquivos--;
  saida.itens.push(item);
}

async function listarSubagentes(dirSessao, relSessao, padrao, orc, saida) {
  const dirS = path.join(dirSessao, 'subagents');
  const s = await lstatOuNada(dirS, saida);
  if (s === null || !s.isDirectory()) return;
  const nomes = await listarNomes(dirS, orc, saida);
  if (nomes === null) return;
  for (const nome of nomes) {
    if (saida.truncado) return;
    if (!ehNomeSubagente(nome)) continue;
    const abs = path.join(dirS, nome);
    const st = await lstatOuNada(abs, saida);
    if (st !== null && st.isFile()) adicionar(saida, orc, { rel: `${relSessao}/subagents/${nome}`, abs, st, subagente: true, projetoPadrao: padrao });
  }
}

// As duas formas aceitas, em ordem de nome, só por lstat. A raiz também
// precisa ser pasta de verdade (nem link, nem junção); se não for, raizOk
// fica false e ela conta como ilegível.
//
// Resíduo aceito (spec 8.1, "Limite honesto"): pasta não tem a trava que o
// arquivo tem (O_NOFOLLOW mais dev/ino no descritor aberto). Uma pasta trocada
// por junção ou link entre o lstat e o opendir (aqui e em listarSubagentes)
// seria listada fora da raiz. O Node não tem opendir que recuse link nem como
// conferir o caminho de um descritor, e um segundo lstat só estreitaria a
// janela. O dano fica limitado: os arquivos de lá passam pelas mesmas
// checagens de arquivo e são lidos como não confiáveis, então só rendem
// números de tokens e rótulos saneados, que o mesmo usuário já poderia ler.
async function listarTranscripts(base, teto) {
  const saida = { itens: [], ilegiveis: 0, truncado: false, raizOk: false };
  const orc = { arquivos: teto, entradas: teto * ENTRADAS_POR_ARQUIVO };
  let st;
  try {
    st = await fsp.lstat(base, { bigint: true });
  } catch {
    return saida;
  }
  if (!st.isDirectory()) return saida;
  const projetos = await listarNomes(base, orc, saida);
  if (projetos === null) return saida;
  saida.raizOk = true;
  for (const p of projetos) {
    if (saida.truncado) break;
    const dirP = path.join(base, p);
    const sp = await lstatOuNada(dirP, saida);
    if (sp === null || !sp.isDirectory()) continue;
    const padrao = rotuloProjeto(p);
    const nomes = await listarNomes(dirP, orc, saida);
    if (nomes === null) continue;
    for (const nome of nomes) {
      if (saida.truncado) break;
      const abs = path.join(dirP, nome);
      const s = await lstatOuNada(abs, saida);
      if (s === null) continue;
      if (s.isFile()) {
        if (ehNomeTranscript(nome)) adicionar(saida, orc, { rel: `${p}/${nome}`, abs, st: s, subagente: false, projetoPadrao: padrao });
      } else if (s.isDirectory()) {
        await listarSubagentes(abs, `${p}/${nome}`, padrao, orc, saida);
      }
    }
  }
  return saida;
}

// --- índice ----------------------------------------------------------------

// Forma de uma chave do índice: 1 = <projeto>/<x>.jsonl, 2 =
// <projeto>/<sessão>/subagents/agent-<x>.jsonl, 0 = recusada. A chave só serve
// de busca num Map (o arquivo é sempre aberto pelo caminho da caminhada), mas
// uma chave que a caminhada não geraria invalida o índice.
function formaDaChave(rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) return 0;
  const partes = rel.split('/');
  if (!partes.every((s) => s.length > 0 && s !== '.' && s !== '..')) return 0;
  if (partes.length === 2) return ehNomeTranscript(partes[1]) ? 1 : 0;
  if (partes.length === 4) return partes[2] === 'subagents' && ehNomeSubagente(partes[3]) ? 2 : 0;
  return 0;
}

const chavesExatas = (o, esperadas) => {
  const k = Object.keys(o);
  return k.length === esperadas.length && esperadas.every((c) => Object.hasOwn(o, c));
};
// Um rótulo guardado só vale se o validador o devolver igual (ponto fixo).
const modeloFixo = (s) => typeof s === 'string' && rotuloModelo(s) === s;
const projetoFixo = (s) => typeof s === 'string' && rotuloProjeto(s) === s;
const tabelaValida = (t, max, valida) => Array.isArray(t) && t.length <= max && t.every(valida);
const indiceEm = (i, tabela) => inteiroEntre(i, -1, tabela.length - 1);

// Entrada do índice lida do disco → entrada em memória, ou null se qualquer
// campo sair do schema.
function entradaDoDisco(e, ehSubagente, agoraMs) {
  if (!ehObjeto(e) || !chavesExatas(e, CHAVES_ENTRADA)) return null;
  const { offset, size, mtimeMs, ancora, linhasInvalidas, sessoes, modelos, projetos, ids, numeros } = e;
  if (!inteiroEntre(size, 0, Number.MAX_SAFE_INTEGER) || !inteiroEntre(offset, 0, size)) return null;
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return null;
  if (!inteiroEntre(ancora, 0, ANCORA_MAX) || !inteiroEntre(linhasInvalidas, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!Array.isArray(ids) || !Array.isArray(numeros) || numeros.length !== ids.length * PASSO) return null;
  if (!tabelaValida(sessoes, ids.length, idValido) || !tabelaValida(modelos, ids.length, modeloFixo) || !tabelaValida(projetos, ids.length, projetoFixo)) return null;
  const registros = [];
  const vistos = new Set();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!idRequisicaoValido(id) || vistos.has(id)) return null;
    vistos.add(id);
    const k = i * PASSO;
    const ts = numeros[k];
    const iSessao = numeros[k + 1];
    const sub = numeros[k + 2];
    const iProjeto = numeros[k + 3];
    const iModelo = numeros[k + 4];
    const iEffort = numeros[k + 5];
    if (!inteiroEntre(ts, TS_MIN_MS, agoraMs + FUTURO_MAX_MS)) return null;
    if (!indiceEm(iSessao, sessoes) || !indiceEm(iProjeto, projetos) || !indiceEm(iModelo, modelos) || !indiceEm(iEffort, EFFORTS_VALIDOS)) return null;
    if (sub !== 0 && sub !== 1) return null;
    if (ehSubagente && sub !== 1) return null;
    const r = {
      requestId: id,
      ts: ts + 0,
      sessionId: iSessao < 0 ? null : sessoes[iSessao],
      subagente: sub === 1,
      projeto: iProjeto < 0 ? null : projetos[iProjeto],
      model: iModelo < 0 ? null : modelos[iModelo],
      effort: iEffort < 0 ? null : EFFORTS_VALIDOS[iEffort],
    };
    for (let j = 0; j < USOS.length; j++) {
      const v = numeroUso(numeros[k + 6 + j]);
      if (v === null) return null;
      r[USOS[j]] = v;
    }
    // Detalhe do cache: -1 (null) ou número de uso, e os dois juntos, como o
    // parser grava; qualquer outra combinação invalida o índice.
    for (let j = 0; j < DETALHE_CACHE.length; j++) {
      const n = numeros[k + 6 + USOS.length + j];
      const v = n === -1 ? null : numeroUso(n);
      if (v === null && n !== -1) return null;
      r[DETALHE_CACHE[j]] = v;
    }
    if ((r.cacheCreate1h === null) !== (r.cacheCreate5m === null)) return null;
    registros.push(r);
  }
  return { offset, size, mtimeMs, ancora, linhasInvalidas, registros, disco: e };
}

// Índice guardado → Map(chave relativa → entrada), ou null: ausente, grande
// demais, fora do schema, de outra versão ou de outra raiz. null = reconstruir.
function carregarIndice(arq, chaveRaiz, agoraMs) {
  const lido = lerJson(arq, INDICE_MAX_BYTES);
  if (!lido.ok) return null;
  try {
    const v = lido.valor;
    if (!ehObjeto(v) || !chavesExatas(v, CHAVES_INDICE)) return null;
    if (v.versao !== VERSAO_INDICE || v.raiz !== chaveRaiz || !ehObjeto(v.arquivos)) return null;
    const mapa = new Map();
    for (const rel of Object.keys(v.arquivos)) {
      const forma = formaDaChave(rel);
      if (forma === 0) return null;
      const e = entradaDoDisco(v.arquivos[rel], forma === 2, agoraMs);
      if (e === null) return null;
      mapa.set(rel, e);
    }
    return mapa;
  } catch {
    return null;
  }
}

function entradaParaDisco(e) {
  if (e.disco !== null) return e.disco;
  const tabelas = { sessoes: new Map(), modelos: new Map(), projetos: new Map() };
  const indice = (mapa, valor) => {
    if (valor === null) return -1;
    let i = mapa.get(valor);
    if (i === undefined) {
      i = mapa.size;
      mapa.set(valor, i);
    }
    return i;
  };
  const ids = [];
  const numeros = [];
  for (const r of e.registros) {
    ids.push(r.requestId);
    numeros.push(
      r.ts, indice(tabelas.sessoes, r.sessionId), r.subagente ? 1 : 0, indice(tabelas.projetos, r.projeto),
      indice(tabelas.modelos, r.model), EFFORTS_VALIDOS.indexOf(r.effort),
      r.input, r.output, r.thinking, r.cacheRead, r.cacheCreate,
      r.cacheCreate1h ?? -1, r.cacheCreate5m ?? -1,
    );
  }
  return {
    offset: e.offset, size: e.size, mtimeMs: e.mtimeMs, ancora: e.ancora, linhasInvalidas: e.linhasInvalidas,
    sessoes: [...tabelas.sessoes.keys()], modelos: [...tabelas.modelos.keys()], projetos: [...tabelas.projetos.keys()],
    ids, numeros,
  };
}

// Índice a gravar, dentro do teto que carregarIndice aceita (INDICE_MAX_BYTES),
// medido em bytes UTF-8 do JSON compacto que gravarJsonAtomico grava com
// { compacto: true }. Passou do teto: saem primeiro as entradas maiores (esses
// arquivos só são relidos do zero na próxima chamada), em vez de gravar um
// índice que o leitor recusaria inteiro e deixaria toda chamada fria. Nenhum
// registro é podado por ts: uma chamada com janela menor envenenaria uma
// chamada seguinte com janela maior. Devolve o valor a gravar e as entradas
// que ficaram nele.
function indiceNoTeto(entradas, chaveRaiz) {
  const medidas = [];
  let soma = 0;
  for (const [rel, e] of entradas) {
    const disco = entradaParaDisco(e);
    // "rel":{...}; as vírgulas entre entradas entram em `total`.
    const bytes = Buffer.byteLength(JSON.stringify(rel)) + 1 + Buffer.byteLength(JSON.stringify(disco));
    medidas.push({ rel, e, disco, bytes });
    soma += bytes;
  }
  // {"versao":V,"raiz":N,"arquivos":{}}: as entradas vão entre as últimas chaves.
  const envelope = Buffer.byteLength(JSON.stringify({ versao: VERSAO_INDICE, raiz: chaveRaiz, arquivos: {} }));
  const total = (n, s) => envelope + s + Math.max(0, n - 1);
  const fora = new Set();
  let n = medidas.length;
  if (total(n, soma) > INDICE_MAX_BYTES) {
    const maioresPrimeiro = [...medidas].sort((a, b) => b.bytes - a.bytes || (a.rel < b.rel ? -1 : 1));
    for (const m of maioresPrimeiro) {
      if (total(n, soma) <= INDICE_MAX_BYTES) break;
      fora.add(m.rel);
      soma -= m.bytes;
      n--;
    }
  }
  const arquivos = Object.create(null);
  const mantidas = new Map();
  for (const m of medidas) {
    if (fora.has(m.rel)) continue;
    arquivos[m.rel] = m.disco;
    mantidas.set(m.rel, m.e);
  }
  return { valor: { versao: VERSAO_INDICE, raiz: chaveRaiz, arquivos }, mantidas };
}

// true se `entradas` não é exatamente o índice carregado: mesmas chaves e os
// mesmos objetos (só a via rápida reaproveita o objeto carregado do disco).
function difere(entradas, antigo) {
  if (antigo === null || entradas.size !== antigo.size) return true;
  for (const [rel, e] of entradas) if (antigo.get(rel) !== e) return true;
  return false;
}

// Indexa os transcripts sob `raiz` modificados desde `desdeMs` e devolve as
// respostas com ts >= desdeMs, deduplicadas por requestId também entre
// arquivos: { registros, linhasInvalidas, arquivos, ilegiveis, truncado }.
// `maxArquivos` (opcional, 1..ARQUIVOS_MAX) só baixa o teto. desdeMs inválido
// vale 0. Raiz inválida, ausente ou que não é pasta de verdade → vazio com
// ilegiveis: 1, sem tocar no índice. Sem diretório de dados (dirDados() null)
// lê tudo e não grava nada. Nunca rejeita.
export async function indexarTranscripts(opcoes) {
  try {
    if (!ehObjeto(opcoes)) return resultadoNeutro();
    const { raiz, desdeMs, maxArquivos } = opcoes;
    if (typeof raiz !== 'string' || raiz === '') return resultadoNeutro();
    const corte = typeof desdeMs === 'number' && Number.isFinite(desdeMs) ? desdeMs : 0;
    const teto = inteiroEntre(maxArquivos, 1, ARQUIVOS_MAX) ? maxArquivos : ARQUIVOS_MAX;
    const base = path.resolve(raiz);
    const agoraMs = Date.now();
    const lista = await listarTranscripts(base, teto);
    if (!lista.raizOk) return resultadoNeutro();
    const dir = dirDados();
    const arqIndice = dir === null ? null : path.join(dir, ARQ_INDICE);
    const chaveRaiz = hash48(base);
    const antigo = arqIndice === null ? null : carregarIndice(arqIndice, chaveRaiz, agoraMs);
    const novo = new Map();
    let ilegiveis = lista.ilegiveis;
    for (const item of lista.itens) {
      const tam = Number(item.st.size);
      const mt = mtimeDe(item.st);
      if (mt < corte) continue;
      const ant = antigo === null ? undefined : antigo.get(item.rel);
      // Mesmo tamanho e mtime: nem abre o arquivo. Uma cauda sem \n depois do
      // offset continua byte a byte a mesma e ainda não é registro; quando o
      // \n chegar, o arquivo terá mudado e será lido a partir do offset.
      if (ant !== undefined && ant.size === tam && ant.mtimeMs === mt) {
        novo.set(item.rel, ant);
        continue;
      }
      const r = await lerArquivo(item, ant, agoraMs);
      if (r.erro) {
        if (!sumiu(r.erro)) ilegiveis++;
        continue;
      }
      novo.set(item.rel, r.entrada);
    }
    // Só grava quando o índice mudaria: nada mudou, ou só mudaram entradas que
    // a poda tiraria de novo, deixa o arquivo como está. O terceiro argumento
    // pede JSON compacto (o mesmo formato medido em indiceNoTeto).
    if (arqIndice !== null && difere(novo, antigo)) {
      const { valor, mantidas } = indiceNoTeto(novo, chaveRaiz);
      if (difere(mantidas, antigo)) gravarJsonAtomico(arqIndice, valor, { compacto: true });
    }
    const mapa = new Map();
    let linhasInvalidas = 0;
    for (const e of novo.values()) {
      linhasInvalidas += e.linhasInvalidas;
      for (const r of e.registros) juntar(mapa, r, true);
    }
    const registros = [];
    for (const r of mapa.values()) if (r.ts >= corte) registros.push(r);
    return { registros, linhasInvalidas, arquivos: novo.size, ilegiveis, truncado: lista.truncado };
  } catch {
    return resultadoNeutro();
  }
}

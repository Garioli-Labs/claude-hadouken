import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
// sessões/modelos/projetos e, por resposta, o requestId e 11 números em
// `numeros` (ts, índice da sessão, subagente 0/1, índice do projeto, índice do
// modelo, índice do effort em EFFORTS_VALIDOS, input, output, thinking,
// cacheRead, cacheCreate; -1 = null). Nenhum texto de transcript é guardado; o
// índice lido passa pelos mesmos validadores das linhas, então nunca produz
// nada que um transcript não produziria.

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
const VERSAO_INDICE = 1;
// Tolerância para relógio adiantado: um timestamp até 1 dia à frente ainda vale.
const FUTURO_MAX_MS = 86_400_000;
const TS_MIN_MS = -8.64e15;
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
const PASSO = 11;
const USOS = ['input', 'output', 'thinking', 'cacheRead', 'cacheCreate'];
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
    mapa: new Map(), cauda: new Map(), invalidas: 0,
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
  };
}

// Uma resposta por requestId: cada campo de uso fica com o máximo entre as
// linhas (uma por apiBlockIndex, e o uso pode crescer entre elas); subagente
// vale se qualquer ocorrência for de subagente; o resto vem da primeira.
// `copiar` protege o registro de origem (índice guardado) de ser alterado.
function juntar(mapa, r, copiar) {
  const a = mapa.get(r.requestId);
  if (a === undefined) {
    mapa.set(r.requestId, copiar ? { ...r } : r);
    return;
  }
  for (const k of USOS) if (r[k] > a[k]) a[k] = r[k];
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

// `completa` = terminada por \n. A última linha sem \n pode estar sendo
// escrita agora: se já for JSON válido, seus registros entram só na saída
// desta leitura (ctx.cauda, nunca no índice); se não, é ignorada sem contar.
function tratarLinha(linha, ctx, completa) {
  const fim = linha.length > 0 && linha[linha.length - 1] === 0x0d ? linha.length - 1 : linha.length;
  const corpo = fim === linha.length ? linha : linha.subarray(0, fim);
  if (corpo.indexOf(AGULHA) === -1) {
    if (completa && !vaziaOuObjeto(corpo)) ctx.invalidas++;
    return;
  }
  let d;
  try {
    d = JSON.parse(corpo.toString('utf8'));
  } catch {
    if (completa) ctx.invalidas++;
    return;
  }
  const r = registroDe(d, ctx);
  if (r === INVALIDA) {
    if (completa) ctx.invalidas++;
  } else if (r !== null) {
    juntar(completa ? ctx.mapa : ctx.cauda, r, false);
  }
}

// Lê os bytes [inicio, fim) em pedaços de até 1 MiB e separa em \n. Uma linha
// que passa de LINHA_MAX_BYTES deixa de ser acumulada na hora (os bytes seguem
// sendo descartados até o próximo \n) e conta uma vez como inválida. Devolve o
// byte seguinte ao último \n lido (o offset que o índice pode guardar) e os até
// 4 KiB antes dele, tirados dos mesmos bytes que viraram registros: a âncora
// nunca descreve um conteúdo diferente do que foi lido. `antes` são os até
// 4 KiB antes de `inicio`, já conferidos contra a âncora guardada.
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
          tratarLinha(linha, ctx, true);
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
  if (!descartando && tam > 0) tratarLinha(Buffer.concat(partes, tam), ctx, false);
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
// tem o mesmo tamanho e outro mtime, ou quando a âncora não confere.
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
    // Nada novo além da cauda pendente: a entrada guardada continua exata e o
    // índice não precisa ser regravado por causa deste arquivo.
    const inalterado = continuou && consumido === ant.offset && tam === ant.size && mt === ant.mtimeMs;
    return {
      entrada: {
        offset: consumido, size: tam, mtimeMs: mt, ancora, linhasInvalidas: ctx.invalidas,
        registros: [...ctx.mapa.values()], cauda: [...ctx.cauda.values()], disco: inalterado ? ant.disco : null,
      },
      inalterado,
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

// Lê um transcript avulso. Devolve { registros, linhasInvalidas, ilegivel };
// caminho que não é arquivo regular (inexistente, pasta, link, FIFO) ou que
// não pôde ser lido → { registros: [], linhasInvalidas: 0, ilegivel: true }.
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
    const saida = new Map();
    for (const x of r.entrada.registros) saida.set(x.requestId, x);
    for (const x of r.entrada.cauda) juntar(saida, x, false);
    return { registros: [...saida.values()], linhasInvalidas: r.entrada.linhasInvalidas, ilegivel: false };
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
    registros.push(r);
  }
  return { offset, size, mtimeMs, ancora, linhasInvalidas, registros, cauda: [], disco: e };
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
    );
  }
  return {
    offset: e.offset, size: e.size, mtimeMs: e.mtimeMs, ancora: e.ancora, linhasInvalidas: e.linhasInvalidas,
    sessoes: [...tabelas.sessoes.keys()], modelos: [...tabelas.modelos.keys()], projetos: [...tabelas.projetos.keys()],
    ids, numeros,
  };
}

function serializar(entradas, chaveRaiz) {
  const arquivos = Object.create(null);
  for (const [rel, e] of entradas) arquivos[rel] = entradaParaDisco(e);
  return { versao: VERSAO_INDICE, raiz: chaveRaiz, arquivos };
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
    let reaproveitados = 0;
    for (const item of lista.itens) {
      const tam = Number(item.st.size);
      const mt = mtimeDe(item.st);
      if (mt < corte) continue;
      const ant = antigo === null ? undefined : antigo.get(item.rel);
      // Mesmo tamanho e mtime, sem cauda pendente: nem abre o arquivo.
      if (ant !== undefined && ant.size === tam && ant.mtimeMs === mt && ant.offset === ant.size) {
        novo.set(item.rel, ant);
        reaproveitados++;
        continue;
      }
      const r = await lerArquivo(item, ant, agoraMs);
      if (r.erro) {
        if (!sumiu(r.erro)) ilegiveis++;
        continue;
      }
      novo.set(item.rel, r.entrada);
      if (r.inalterado) reaproveitados++;
    }
    const mudou = antigo === null || reaproveitados !== novo.size || novo.size !== antigo.size;
    if (arqIndice !== null && mudou) gravarJsonAtomico(arqIndice, serializar(novo, chaveRaiz));
    const mapa = new Map();
    let linhasInvalidas = 0;
    for (const e of novo.values()) {
      linhasInvalidas += e.linhasInvalidas;
      for (const r of e.registros) juntar(mapa, r, true);
      for (const r of e.cauda) juntar(mapa, r, true);
    }
    const registros = [];
    for (const r of mapa.values()) if (r.ts >= corte) registros.push(r);
    return { registros, linhasInvalidas, arquivos: novo.size, ilegiveis, truncado: lista.truncado };
  } catch {
    return resultadoNeutro();
  }
}

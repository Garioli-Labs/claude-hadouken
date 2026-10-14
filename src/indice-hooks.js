import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { numeroFinito } from './base.js';
import { dirDados, gravarJsonAtomico } from './estado.js';
import { ITEM_VALIDO, registroDeLinha } from './custo-hooks.js';
import { lerSemLink } from './guarda/arquivo.js';
import { dirConfigClaude } from './guarda/despacho.js';
import {
  ARQUIVOS_MAX, abrirConferido, bytesAntes, fechar, formaDaChave, hash48, lerFaixa, listarTranscripts, mtimeDe, sumiu,
} from './transcripts.js';

// Índice do custo dos hooks (spec v0.4.0 §9.4; decisão 13 do plano da parte
// 2): as linhas de hook e de compactação dos transcripts, lidas com a mesma
// leitura segura de transcripts.js (lstat, O_NOFOLLOW, dev/ino, teto de
// linha, âncora), viram itens [ts, u, h, ev, ms, chars, tipo] de
// custo-hooks.js. indice-hooks.json guarda só esses itens: nem o stdout, nem
// o comando (só o hash). Incremental por arquivo, como o de transcripts.
// Ilegível, grande demais (8 MiB) ou fora do schema: reconstrói. Gravado até
// 6 MiB: passou, saem os itens mais velhos e `cortadoAte` guarda até onde
// (7 dias de uso real já davam 4,3 MB; a Task 17 mediu).

export const ARQ_INDICE_HOOKS = 'indice-hooks.json';
const VERSAO = 1;
const INDICE_MAX_BYTES = 8 * 1024 * 1024;
export const INDICE_CORTE_BYTES = 6 * 1024 * 1024;
const ITENS_POR_ARQUIVO = 2000;
const PODA_MS = 8 * 86_400_000;
const INSTALADOS_MAX_BYTES = 1024 * 1024;
const HOOKS_MAX_BYTES = 256 * 1024;
const MANIFESTO_MAX_BYTES = 256 * 1024;
// Entradas lidas da lista do campo `hooks` do plugin.json.
const FONTES_MAX = 16;
const PADRAO_HOOKS = './hooks/hooks.json';
const MANIFESTO = './.claude-plugin/plugin.json';
const CAMINHO_MAX = 4096;
const AGULHA_HOOK = Buffer.from('"hook_');
const AGULHA_COMPACTA = Buffer.from('"compact_boundary"');
const CHAVES_INDICE = ['arquivos', 'cortadoAte', 'raiz', 'versao'];
const CHAVES_ENTRADA = ['ancora', 'itens', 'mtimeMs', 'offset', 'size'];

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inteiroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const chavesExatas = (o, esperadas) => {
  const k = Object.keys(o);
  return k.length === esperadas.length && esperadas.every((c) => Object.hasOwn(o, c));
};
const vazio = () => ({ itens: [], arquivos: 0, ilegiveis: 1, truncado: false });

// Tratamento de uma linha (ctx.tratar de lerFaixa): só decodifica as que
// trazem uma das agulhas; o resto nem vira texto.
function tratarLinhaHook(linha, ctx) {
  if (linha.indexOf(AGULHA_HOOK) === -1 && linha.indexOf(AGULHA_COMPACTA) === -1) return;
  let d;
  try {
    d = JSON.parse(linha.toString('utf8'));
  } catch {
    ctx.invalidas++;
    return;
  }
  const r = registroDeLinha(d, ctx.subagente);
  if (r !== null) ctx.itens.push(r);
}

function entradaDoDisco(e) {
  if (!ehObjeto(e) || !chavesExatas(e, CHAVES_ENTRADA)) return null;
  const { offset, size, mtimeMs, ancora, itens } = e;
  if (!inteiroEntre(size, 0, Number.MAX_SAFE_INTEGER) || !inteiroEntre(offset, 0, size)) return null;
  if (!numeroFinito(mtimeMs) || !inteiroEntre(ancora, 0, 2 ** 48 - 1)) return null;
  if (!Array.isArray(itens) || itens.length > ITENS_POR_ARQUIVO || !itens.every(ITEM_VALIDO)) return null;
  return { offset, size, mtimeMs, ancora, itens };
}

// lerSemLink (lstat antes, link = inválido): o lerJson de estado.js abre sem
// O_NOFOLLOW e seguiria um índice trocado por link (Foco de revisão 5).
function carregar(arq, chaveRaiz) {
  const lido = lerSemLink(arq, INDICE_MAX_BYTES);
  if (!lido.ok) return null;
  try {
    const v = lido.valor;
    if (!ehObjeto(v) || !chavesExatas(v, CHAVES_INDICE) || v.versao !== VERSAO || v.raiz !== chaveRaiz || !ehObjeto(v.arquivos)) return null;
    if (v.cortadoAte !== null && !numeroFinito(v.cortadoAte)) return null;
    const mapa = new Map();
    for (const rel of Object.keys(v.arquivos)) {
      if (formaDaChave(rel) === 0) return null;
      const e = entradaDoDisco(v.arquivos[rel]);
      if (e === null) return null;
      mapa.set(rel, e);
    }
    return { mapa, cortadoAte: v.cortadoAte };
  } catch {
    return null;
  }
}

// Índice a gravar dentro de `limite` bytes, medido no JSON compacto que
// gravarJsonAtomico grava. Passou: saem os itens mais velhos (por ts) de
// todos os arquivos até caber, e cortadoAte passa a ser o ts do mais novo que
// saiu (até ele pode faltar item; a janela que começa depois está completa).
// O teto de gravação (6 MiB) fica abaixo do de leitura (8 MiB): o índice
// gravado é sempre relido, em vez de recusado e refeito do zero a cada
// chamada. null se nem sem item nenhum couber.
function indiceNoTeto(arquivos, chaveRaiz, cortadoAte, limite) {
  const fora = new Set();
  const montar = (ate) => {
    const a = Object.create(null);
    for (const rel of Object.keys(arquivos)) {
      a[rel] = fora.size === 0 ? arquivos[rel] : { ...arquivos[rel], itens: arquivos[rel].itens.filter((it) => !fora.has(it)) };
    }
    return { versao: VERSAO, raiz: chaveRaiz, cortadoAte: ate, arquivos: a };
  };
  const excesso = (v) => Buffer.byteLength(JSON.stringify(v)) - limite;
  let valor = montar(cortadoAte);
  let falta = excesso(valor);
  if (falta <= 0) return valor;
  const velhosPrimeiro = Object.values(arquivos).flatMap((e) => e.itens).sort((a, b) => a[0] - b[0]);
  let ate = cortadoAte;
  let i = 0;
  while (falta > 0 && i < velhosPrimeiro.length) {
    // Cada item que sai leva pelo menos o próprio JSON: sai o bastante para
    // cobrir o excesso e o índice é medido de novo (a vírgula e o cortadoAte
    // mudam a conta em poucos bytes).
    for (let tirado = 0; tirado < falta && i < velhosPrimeiro.length; i++) {
      const it = velhosPrimeiro[i];
      fora.add(it);
      tirado += Buffer.byteLength(JSON.stringify(it));
      if (ate === null || it[0] > ate) ate = it[0];
    }
    valor = montar(ate);
    falta = excesso(valor);
  }
  return falta <= 0 ? valor : null;
}

async function lerArquivoHooks(item, ant) {
  const aberto = await abrirConferido(item.abs, item.st);
  if (aberto.erro) return aberto;
  const { fh, st } = aberto;
  try {
    const tam = Number(st.size);
    const mt = mtimeDe(st);
    const ctx = { invalidas: 0, itens: [], subagente: item.subagente, tratar: tratarLinhaHook };
    let inicio = 0;
    let antes = Buffer.alloc(0);
    const continua = ant !== undefined && ((tam === ant.size && mt === ant.mtimeMs) || (tam > ant.size && mt >= ant.mtimeMs));
    const conferido = continua ? await bytesAntes(fh, ant.offset) : null;
    if (conferido !== null && hash48(conferido) === ant.ancora) {
      inicio = ant.offset;
      antes = conferido;
      ctx.itens.push(...ant.itens);
    }
    const { consumido, ancora } = await lerFaixa(fh, inicio, tam, ctx, antes);
    return { entrada: { offset: consumido, size: tam, mtimeMs: mt, ancora, itens: ctx.itens.slice(-ITENS_POR_ARQUIVO) } };
  } catch (e) {
    return { erro: e ?? {} };
  } finally {
    await fechar(fh);
  }
}

// Itens de hook e compactação dos transcripts sob `raiz` modificados desde
// `desdeMs` (no mínimo agoraMs − 8 dias, a poda do índice). `agoraMs`
// (padrão Date.now()) decide a poda: itens mais velhos que 8 dias saem ao
// gravar. O índice é gravado até INDICE_CORTE_BYTES (`maxBytesIndice`,
// opcional, de 1 até ele, só baixa o teto): passou, saem os itens mais velhos
// (indiceNoTeto), também do resultado desta chamada, para ela e a próxima
// darem o mesmo. `truncado` vale quando a lista de arquivos parou no teto ou
// quando um corte do índice alcança a janela pedida. Sem diretório de dados,
// lê tudo e não grava. Nunca rejeita.
export async function indexarHooks(opcoes) {
  try {
    if (!ehObjeto(opcoes)) return vazio();
    const { raiz, maxArquivos, maxBytesIndice } = opcoes;
    if (typeof raiz !== 'string' || raiz === '') return vazio();
    const agoraMs = numeroFinito(opcoes.agoraMs) ? opcoes.agoraMs : Date.now();
    const poda = agoraMs - PODA_MS;
    const corte = Math.max(poda, numeroFinito(opcoes.desdeMs) ? opcoes.desdeMs : 0);
    const teto = inteiroEntre(maxArquivos, 1, ARQUIVOS_MAX) ? maxArquivos : ARQUIVOS_MAX;
    const limiteBytes = inteiroEntre(maxBytesIndice, 1, INDICE_CORTE_BYTES) ? maxBytesIndice : INDICE_CORTE_BYTES;
    const base = path.resolve(raiz);
    const lista = await listarTranscripts(base, teto);
    if (!lista.raizOk) return vazio();
    const dir = dirDados();
    const arqIndice = dir === null ? null : path.join(dir, ARQ_INDICE_HOOKS);
    const chaveRaiz = hash48(base);
    const carregado = arqIndice === null ? null : carregar(arqIndice, chaveRaiz);
    const antigo = carregado === null ? null : carregado.mapa;
    // Um corte mais velho que a poda não tira mais nada da janela.
    let cortadoAte = carregado === null || carregado.cortadoAte === null || carregado.cortadoAte < poda ? null : carregado.cortadoAte;
    const novo = new Map();
    let ilegiveis = lista.ilegiveis;
    let mudou = antigo === null;
    for (const item of lista.itens) {
      const tam = Number(item.st.size);
      const mt = mtimeDe(item.st);
      if (mt < corte) continue;
      const ant = antigo?.get(item.rel);
      if (ant !== undefined && ant.size === tam && ant.mtimeMs === mt) {
        novo.set(item.rel, ant);
        continue;
      }
      const r = await lerArquivoHooks(item, ant);
      if (r.erro) {
        if (!sumiu(r.erro)) ilegiveis++;
        continue;
      }
      novo.set(item.rel, r.entrada);
      mudou = true;
    }
    if (antigo !== null && antigo.size !== novo.size) mudou = true;
    if (arqIndice !== null && mudou) {
      const arquivos = Object.create(null);
      for (const [rel, e] of novo) arquivos[rel] = { ...e, itens: e.itens.filter((it) => it[0] >= poda) };
      const valor = indiceNoTeto(arquivos, chaveRaiz, cortadoAte, limiteBytes);
      if (valor !== null) {
        gravarJsonAtomico(arqIndice, valor, { compacto: true });
        cortadoAte = valor.cortadoAte;
        for (const rel of Object.keys(valor.arquivos)) novo.set(rel, valor.arquivos[rel]);
      }
    }
    const itens = [];
    for (const e of novo.values()) for (const it of e.itens) if (it[0] >= corte) itens.push(it);
    return { itens, arquivos: novo.size, ilegiveis, truncado: lista.truncado || (cortadoAte !== null && cortadoAte >= corte) };
  } catch {
    return vazio();
  }
}

const caminhoAbsoluto = (p) => typeof p === 'string' && p !== '' && p.length <= CAMINHO_MAX && !p.includes('\0') && path.isAbsolute(p);

// installed_plugins.json da pasta de configuração do Claude Code
// (<dirConfig>/plugins/), sem seguir link, até 1 MiB. dirConfig ausente vale
// dirConfigClaude(process.env, os.homedir()). null quando não dá para ler.
export function lerInstalados(dirConfig = dirConfigClaude(process.env, os.homedir())) {
  try {
    if (!caminhoAbsoluto(dirConfig)) return null;
    const lido = lerSemLink(path.join(dirConfig, 'plugins', 'installed_plugins.json'), INSTALADOS_MAX_BYTES);
    return lido.ok && ehObjeto(lido.valor) ? lido.valor : null;
  } catch {
    return null;
  }
}

// Caminho de componente no formato de plugin do Claude Code (relativo à raiz
// do plugin, começando com ./) → caminho absoluto dentro de `raiz`, ou null.
// Recusa `..` em qualquer segmento, o que resolve fora da raiz ou nela mesma,
// e pasta no meio do caminho que não é pasta de verdade (link, junção): cada
// uma passa por lstat. O arquivo final é lido por lerSemLink, que recusa link.
// A troca entre o lstat e o open é o limite honesto de SECURITY.md (processo
// do mesmo usuário).
function dentroDoPlugin(raiz, rel) {
  if (typeof rel !== 'string' || !rel.startsWith('./') || rel.length > CAMINHO_MAX || rel.includes('\0')) return null;
  if (rel.split(/[\\/]/).includes('..')) return null;
  const alvo = path.resolve(raiz, rel);
  const relativo = path.relative(raiz, alvo);
  if (relativo === '' || relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)) return null;
  let atual = raiz;
  for (const parte of relativo.split(path.sep).slice(0, -1)) {
    atual = path.join(atual, parte);
    const st = fs.lstatSync(atual, { throwIfNoEntry: false });
    if (st === undefined || !st.isDirectory()) return null;
  }
  return alvo;
}

// JSON (objeto) de um arquivo do plugin, pelo caminho relativo: { alvo, valor }
// ou null.
function lerJsonDoPlugin(raiz, rel, maxBytes) {
  try {
    const alvo = dentroDoPlugin(raiz, rel);
    if (alvo === null) return null;
    const lido = lerSemLink(alvo, maxBytes);
    return lido.ok && ehObjeto(lido.valor) ? { alvo, valor: lido.valor } : null;
  } catch {
    return null;
  }
}

// O campo `hooks` do .claude-plugin/plugin.json: caminho de um .json de hooks,
// objeto inline (a forma do `hooks` do settings.json, que aqui ganha o
// envelope { hooks } do hooks.json) ou lista de ambos, até FONTES_MAX
// entradas. Entrada estranha, fora da raiz ou ilegível é ignorada; o mesmo
// arquivo não entra duas vezes (`lidos` já traz o hooks/hooks.json).
function fontesDoManifesto(raiz, lidos) {
  const manifesto = lerJsonDoPlugin(raiz, MANIFESTO, MANIFESTO_MAX_BYTES);
  if (manifesto === null || !Object.hasOwn(manifesto.valor, 'hooks')) return [];
  const campo = manifesto.valor.hooks;
  const fontes = [];
  for (const entrada of Array.isArray(campo) ? campo.slice(0, FONTES_MAX) : [campo]) {
    if (ehObjeto(entrada)) {
      fontes.push({ hooks: entrada });
    } else if (typeof entrada === 'string') {
      const f = lerJsonDoPlugin(raiz, entrada, HOOKS_MAX_BYTES);
      if (f === null || lidos.has(f.alvo)) continue;
      lidos.add(f.alvo);
      fontes.push(f.valor);
    }
  }
  return fontes;
}

// Junta os eventos das fontes em ordem (o hooks/hooks.json primeiro, como o
// Claude Code): os grupos de um evento repetido se somam. Map e
// Object.fromEntries: um evento chamado __proto__ vira chave própria, nunca o
// protótipo.
function juntarHooks(fontes) {
  const eventos = new Map();
  for (const f of fontes) {
    const evs = ehObjeto(f) && ehObjeto(f.hooks) ? f.hooks : null;
    if (evs === null) continue;
    for (const ev of Object.keys(evs)) {
      const grupos = evs[ev];
      if (Array.isArray(grupos)) eventos.set(ev, (eventos.get(ev) ?? []).concat(grupos));
    }
  }
  return { hooks: Object.fromEntries(eventos) };
}

// Os hooks de um plugin instalado: <installPath>/hooks/hooks.json mais o que
// o campo `hooks` do .claude-plugin/plugin.json declara (formato de plugin do
// Claude Code; o data-agent-kit-starter-pack declara
// ./.claude-plugin/hooks.json, e sem isto as execuções dele caíam em
// "(outros)"). Tudo dentro do installPath, sem seguir link, cada arquivo até
// 256 KiB. Sem campo, ou com o campo quebrado, devolve o hooks/hooks.json
// como está; com fontes declaradas, a junção { hooks }. Hooks dos settings do
// usuário não são de plugin e caem em "(outros)" (decisão 11). null quando
// não há nada legível. Nunca lança.
export function lerHooksDoPlugin(installPath) {
  try {
    if (!caminhoAbsoluto(installPath)) return null;
    const raiz = path.resolve(installPath);
    const padrao = lerJsonDoPlugin(raiz, PADRAO_HOOKS, HOOKS_MAX_BYTES)?.valor ?? null;
    const declaradas = fontesDoManifesto(raiz, new Set([path.resolve(raiz, PADRAO_HOOKS)]));
    if (declaradas.length === 0) return padrao;
    return juntarHooks(padrao === null ? declaradas : [padrao, ...declaradas]);
  } catch {
    return null;
  }
}

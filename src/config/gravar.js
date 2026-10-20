import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { soltarAperto } from '../aprendizado/ajustar.js';
import { ligadoExiste } from '../aprendizado/arquivos.js';
import { gravarAjustes, lerAjustes, pegarTrava } from '../aprendizado/registro.js';
import { ARQ_CONFIG } from '../guarda/config.js';
import { anexarEvento } from '../guarda/registros.js';
import { lerConfiguracao, validar } from './ler.js';
import { ITEM, ITENS } from './tabela.js';

// Gravar a configuração (spec v0.5.3 VS Code §2.1). A validação que vale é
// a de quem grava. Confere a versão lida (sha256 do arquivo), para não
// passar por cima de outra janela ou de uma edição à mão; guarda um backup
// (os 3 mais novos); grava atômico; e, para cada teto da guarda afrouxado,
// solta o aperto do aprendizado (foco 3). Um config.json que existe mas
// não abre (quebrado, pasta, link) nunca é sobrescrito: o senhor conserta à
// mão. Token de desfazer: os valores de antes (null = ausente, para
// sobreviver a JSON), vale 15 min e só na versão gravada. Nunca lança.

const CONFIG_MAX_BYTES = 64 * 1024;
const BACKUPS = 3;
const BACKUP = /^config\.json\.bak-\d{8}T\d{9}$/;
const DESFAZER_MS = 15 * 60_000;
// id da configuração → item do aprendizado com aperto.
const APERTO = Object.freeze({ 'guarda.teto7d': 'guarda.teto7d', 'guarda.fable.tetoPct': 'guarda.fableTetoPct' });

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function proprio(o, k) {
  if (typeof k === 'number') return Array.isArray(o) && k < o.length ? o[k] : undefined;
  return ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined;
}
const conhecido = (id) => typeof id === 'string' && id !== '__proto__' && Object.hasOwn(ITEM, id);

// O JSON atual: {} se ausente; null se existe e não é um objeto legível.
function lerBruto(arquivo) {
  let st = null;
  try {
    st = fs.lstatSync(arquivo);
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return { json: {}, existe: false };
    return null;
  }
  if (!st.isFile()) return null;
  const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
  return lido.ok && ehObjeto(lido.valor) ? { json: lido.valor, existe: true } : null;
}

function obter(o, caminho) {
  let v = o;
  for (const parte of caminho) v = proprio(v, parte);
  return v;
}

function definir(o, caminho, v) {
  let atual = o;
  for (const parte of caminho.slice(0, -1)) {
    if (!ehObjeto(proprio(atual, parte))) atual[parte] = {};
    atual = atual[parte];
  }
  atual[caminho.at(-1)] = v;
}

// Remove a chave e, subindo, os objetos que ficaram vazios por isso.
function remover(o, caminho) {
  const [k, ...resto] = caminho;
  if (!ehObjeto(o) || !Object.hasOwn(o, k)) return;
  if (resto.length === 0) {
    delete o[k];
    return;
  }
  const filho = o[k];
  if (!ehObjeto(filho)) return;
  remover(filho, resto);
  if (Object.keys(filho).length === 0) delete o[k];
}

// ops = { id: valor | null (remover) }. Itens que moram numa lista
// (alertas.projecao5hMin) gravam a lista inteira; o que falta vira o padrão,
// e a lista sai quando nenhum índice fica.
function aplicar(json, ops) {
  const novo = JSON.parse(JSON.stringify(json));
  const listas = new Map();
  for (const [id, v] of Object.entries(ops)) {
    const { caminho } = ITEM[id];
    if (typeof caminho.at(-1) === 'number') {
      const pai = caminho.slice(0, -1);
      const chave = pai.join('.');
      if (!listas.has(chave)) listas.set(chave, { pai, ops: new Map() });
      listas.get(chave).ops.set(caminho.at(-1), v);
    } else if (v === null) remover(novo, caminho);
    else definir(novo, caminho, v);
  }
  for (const { pai, ops: porIndice } of listas.values()) {
    const chave = pai.join('.');
    const itens = ITENS.filter((i) => i.caminho.length === pai.length + 1 && i.caminho.slice(0, -1).join('.') === chave)
      .sort((a, b) => a.caminho.at(-1) - b.caminho.at(-1));
    const atual = obter(novo, pai);
    const lista = Array.isArray(atual) ? atual : [];
    const final = itens.map((i) => {
      const k = i.caminho.at(-1);
      if (porIndice.has(k)) return porIndice.get(k) === null ? { presente: false } : { presente: true, valor: porIndice.get(k) };
      return k < lista.length && lista[k] !== null && lista[k] !== undefined ? { presente: true, valor: lista[k] } : { presente: false };
    });
    if (final.every((e) => !e.presente)) remover(novo, pai);
    else definir(novo, pai, final.map((e, i) => (e.presente ? e.valor : itens[i].padrao)));
  }
  return novo;
}

const carimbo = (ms) => new Date(ms).toISOString().replace(/[-:.Z]/g, '');

function guardarBackup(dir, arquivo, agoraMs) {
  for (let i = 0; i < 1000; i++) {
    try {
      fs.copyFileSync(arquivo, path.join(dir, `${ARQ_CONFIG}.bak-${carimbo(agoraMs + i)}`), fs.constants.COPYFILE_EXCL);
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
  }
  const nomes = fs.readdirSync(dir).filter((n) => BACKUP.test(n) && fs.lstatSync(path.join(dir, n)).isFile()).sort();
  for (const n of nomes.slice(0, -BACKUPS)) fs.rmSync(path.join(dir, n), { force: true });
}

function soltarApertos(dir, ids, agoraMs) {
  const itens = ids.filter((id) => Object.hasOwn(APERTO, id)).map((id) => APERTO[id]);
  if (itens.length === 0 || !ligadoExiste(dir)) return;
  const t = pegarTrava(dir);
  if (!t.ok) {
    anexarEvento(dir, 'erro', 'limites:aperto', agoraMs);
    return;
  }
  try {
    const aj = lerAjustes(dir, agoraMs);
    for (const item of itens) soltarAperto(aj, item, agoraMs);
    if (!gravarAjustes(dir, aj).ok) anexarEvento(dir, 'erro', 'limites:aperto', agoraMs);
  } catch {
    anexarEvento(dir, 'erro', 'limites:aperto', agoraMs);
  } finally {
    t.soltar();
  }
}

// O núcleo: confere a versão, aplica, faz o backup e grava.
function gravarOps(dir, ops, versao, agoraMs, afrouxou) {
  const arquivo = path.join(dir, ARQ_CONFIG);
  const bruto = lerBruto(arquivo);
  if (bruto === null) return { ok: false, motivo: 'erro' };
  if (lerConfiguracao(dir).versao !== versao) return { ok: false, motivo: 'mudou' };
  const antes = {};
  for (const id of Object.keys(ops)) {
    const v = obter(bruto.json, ITEM[id].caminho);
    antes[id] = v === undefined ? null : v;
  }
  const novo = aplicar(bruto.json, ops);
  if (bruto.existe) guardarBackup(dir, arquivo, agoraMs);
  if (!gravarJsonAtomico(arquivo, novo).ok) return { ok: false, motivo: 'erro' };
  soltarApertos(dir, afrouxou, agoraMs);
  const versaoDepois = lerConfiguracao(dir).versao;
  return { ok: true, versao: versaoDepois, desfazer: { antes, versaoDepois, ate: agoraMs + DESFAZER_MS }, afrouxou };
}

function opcoesValidas(dir, opcoes) {
  return typeof dir === 'string' && ehObjeto(opcoes) && Number.isFinite(opcoes.agoraMs);
}

export function gravarConfiguracao(dir, mudancas, opcoes) {
  try {
    if (!opcoesValidas(dir, opcoes) || !ehObjeto(mudancas)) return { ok: false, motivo: 'erro' };
    const v = validar(mudancas, lerConfiguracao(dir));
    if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };
    const ops = Object.fromEntries(Object.keys(mudancas).filter(conhecido).map((id) => [id, mudancas[id]]));
    return gravarOps(dir, ops, opcoes.versao, opcoes.agoraMs, v.afrouxa);
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

export function voltarAoPadrao(dir, ids, opcoes) {
  try {
    if (!opcoesValidas(dir, opcoes) || !Array.isArray(ids)) return { ok: false, motivo: 'erro' };
    if (!ids.every(conhecido)) return { ok: false, motivo: 'invalido', erros: [{ id: null, texto: 'item desconhecido' }] };
    const v = validar(Object.fromEntries(ids.map((id) => [id, ITEM[id].padrao])), lerConfiguracao(dir));
    if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };
    return gravarOps(dir, Object.fromEntries(ids.map((id) => [id, null])), opcoes.versao, opcoes.agoraMs, v.afrouxa);
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

// Volta os valores do token. Usado, vencido ou com o arquivo mudado: 'mudou'.
// O aperto solto não volta: o aprendizado reaperta depois do bloqueio.
export function desfazer(dir, token, opcoes) {
  try {
    if (!opcoesValidas(dir, opcoes) || !ehObjeto(token) || !ehObjeto(token.antes)) return { ok: false, motivo: 'erro' };
    if (typeof token.versaoDepois !== 'string' || !Number.isFinite(token.ate) || opcoes.agoraMs > token.ate) return { ok: false, motivo: 'mudou' };
    if (!Object.keys(token.antes).every(conhecido)) return { ok: false, motivo: 'erro' };
    return gravarOps(dir, { ...token.antes }, token.versaoDepois, opcoes.agoraMs, []);
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

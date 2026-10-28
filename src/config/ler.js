import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { lerJson } from '../estado.js';
import { lerAperto } from '../guarda/aperto.js';
import { ARQ_CONFIG, CAMPOS, guardaDaConfig } from '../guarda/config.js';
import { roteamentoDaConfig } from '../roteamento/config.js';
import { ITEM, ITENS, PARES } from './tabela.js';

// Leitura e validação da configuração inteira (spec v0.5.3 VS Code §2.1).
// A guarda e o roteamento seguem lidos pelos donos de hoje (guardaDaConfig,
// roteamentoDaConfig), para a janela mostrar o mesmo valor que eles usam; os
// itens novos (barra, alertas, painel, aprendizado) são lidos aqui, com a
// mesma regra: o que não passa usa o padrão e gera aviso de texto fixo.
// Nunca lança.

const CONFIG_MAX_BYTES = 64 * 1024;
const HORA_MS = 3_600_000;
const MIN_MS = 60_000;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Só propriedade própria; numa lista, só índice dentro dela.
function proprio(o, k) {
  if (typeof k === 'number') return Array.isArray(o) && k < o.length ? o[k] : undefined;
  return ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined;
}
const doItem = (id) => (typeof id === 'string' && Object.hasOwn(ITEM, id) ? ITEM[id] : null);

// id da guarda → chave em ConfigGuarda.
const CHAVE_GUARDA = Object.freeze({
  'guarda.ligada': 'ligada',
  ...Object.fromEntries(CAMPOS.map(([chave, , rotulo]) => [`guarda.${rotulo}`, chave])),
});
const CHAVE_APERTO = Object.freeze({ 'guarda.teto7d': 'teto7d', 'guarda.fable.tetoPct': 'fableTetoPct' });

function valido(item, v) {
  if (item.tipo === 'booleano') return typeof v === 'boolean';
  return Number.isInteger(v) && v >= item.min && v <= item.max;
}

const formatar = (item, v) => (item.tipo === 'booleano' ? (v ? 'ligado' : 'desligado') : String(v));

// { id: valor } de todos os itens, a partir do JSON já lido (ou null).
function valoresDe(json) {
  const valores = {};
  const avisos = [];
  const guarda = guardaDaConfig(json);
  const roteamento = roteamentoDaConfig(json);
  avisos.push(...guarda.avisos, ...roteamento.avisos);
  for (const item of ITENS) {
    if (item.grupo === 'guarda') valores[item.id] = guarda.config[CHAVE_GUARDA[item.id]];
    else if (item.grupo === 'roteamento') valores[item.id] = item.caminho.slice(1).reduce((v, parte) => v[parte], roteamento.config);
    else {
      let v = json;
      for (const parte of item.caminho) v = proprio(v, parte);
      if (v === undefined) valores[item.id] = item.padrao;
      else if (valido(item, v)) valores[item.id] = v;
      else {
        valores[item.id] = item.padrao;
        avisos.push(`config.json: ${item.id} inválido, usando ${formatar(item, item.padrao)}`);
      }
    }
  }
  // Par incoerente no arquivo: o par inteiro volta ao padrão. A guarda já
  // resolve o dela (padraoH limitado ao maxH), como sempre fez.
  for (const [menor, maior, estrito] of PARES) {
    if (ITEM[menor].grupo === 'guarda') continue;
    const a = valores[menor];
    const b = valores[maior];
    if (estrito ? a < b : a <= b) continue;
    valores[menor] = ITEM[menor].padrao;
    valores[maior] = ITEM[maior].padrao;
    avisos.push(`config.json: ${ITEM[maior].rotulo} precisa ser maior que ${ITEM[menor].rotulo}, usando os padrões`);
  }
  return { valores, avisos };
}

// O JSON do config.json e a versão (sha256 dos bytes, 16 hex). Ausente:
// null e 'ausente'; ilegível: null, 'ilegivel' e um aviso.
function lerArquivo(dir) {
  if (typeof dir !== 'string') return { json: null, versao: 'ausente', avisos: [] };
  const arquivo = path.join(dir, ARQ_CONFIG);
  const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
  if (!lido.ok) {
    let existe = true;
    try { fs.lstatSync(arquivo); } catch (e) { existe = !(e?.code === 'ENOENT' || e?.code === 'ENOTDIR'); }
    return existe
      ? { json: null, versao: 'ilegivel', avisos: ['config.json ilegível: usando os padrões'] }
      : { json: null, versao: 'ausente', avisos: [] };
  }
  let versao = 'ilegivel';
  try { versao = crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex').slice(0, 16); } catch { /* fica ilegivel */ }
  return { json: lido.valor, versao, avisos: [] };
}

export function lerConfiguracao(dir) {
  try {
    const a = lerArquivo(dir);
    const { valores, avisos } = valoresDe(a.json);
    const aperto = lerAperto(dir);
    const itens = ITENS.map((i) => ({
      id: i.id, grupo: i.grupo, rotulo: i.rotulo, unidade: i.unidade, tipo: i.tipo,
      min: i.min ?? null, max: i.max ?? null, padrao: i.padrao, valor: valores[i.id], frouxo: i.frouxo ?? null,
      aperto: Object.hasOwn(CHAVE_APERTO, i.id) && Number.isInteger(aperto[CHAVE_APERTO[i.id]]) ? aperto[CHAVE_APERTO[i.id]] : null,
    }));
    return { itens, versao: a.versao, avisos: [...a.avisos, ...avisos] };
  } catch {
    const itens = ITENS.map((i) => ({
      id: i.id, grupo: i.grupo, rotulo: i.rotulo, unidade: i.unidade, tipo: i.tipo,
      min: i.min ?? null, max: i.max ?? null, padrao: i.padrao, valor: i.padrao, frouxo: i.frouxo ?? null, aperto: null,
    }));
    return { itens, versao: 'ilegivel', avisos: ['config.json ilegível: usando os padrões'] };
  }
}

// O valor que vale hoje: com o aperto do aprendizado, só o mínimo.
const efetivo = (l) => (l.aperto !== null && l.aperto < l.valor ? l.aperto : l.valor);

function afrouxa(item, antes, depois) {
  if (item.frouxo === 'maior') return depois > antes;
  if (item.frouxo === 'menor') return depois < antes;
  if (item.frouxo === 'desligar') return antes === true && depois === false;
  return false;
}

// mudancas = { [id]: valor }; lido = lerConfiguracao. __proto__ é ignorado.
export function validar(mudancas, lido) {
  const erros = [];
  const lista = [];
  try {
    if (!ehObjeto(mudancas)) return { ok: false, erros: [{ id: null, texto: 'mudanças inválidas' }], afrouxa: [] };
    const atual = new Map(lido.itens.map((l) => [l.id, l]));
    const novos = Object.fromEntries(lido.itens.map((l) => [l.id, l.valor]));
    for (const id of Object.keys(mudancas)) {
      if (id === '__proto__') continue;
      const item = doItem(id);
      if (item === null) {
        erros.push({ id: null, texto: 'item desconhecido' });
        continue;
      }
      const v = mudancas[id];
      if (!valido(item, v)) {
        erros.push({ id, texto: item.tipo === 'booleano' ? `${item.rotulo} precisa ser ligado ou desligado` : `${item.rotulo} fora da faixa ${item.min}–${item.max}` });
        continue;
      }
      novos[id] = v;
      if (afrouxa(item, efetivo(atual.get(id)), v)) lista.push(id);
    }
    for (const [menor, maior, estrito] of PARES) {
      if (!Object.hasOwn(mudancas, menor) && !Object.hasOwn(mudancas, maior)) continue;
      const a = novos[menor];
      const b = novos[maior];
      if (estrito ? a < b : a <= b) continue;
      erros.push({ id: maior, texto: estrito ? `${ITEM[maior].rotulo} precisa ser maior que ${ITEM[menor].rotulo}` : `${ITEM[maior].rotulo} precisa ser maior ou igual a ${ITEM[menor].rotulo}` });
    }
  } catch {
    return { ok: false, erros: [{ id: null, texto: 'mudanças inválidas' }], afrouxa: [] };
  }
  return { ok: erros.length === 0, erros, afrouxa: lista };
}

// Para a barra e os alertas: só os valores, sem versão e sem aperto.
function valoresDoDir(dir) {
  try {
    return valoresDe(lerArquivo(dir).json).valores;
  } catch {
    return Object.fromEntries(ITENS.map((i) => [i.id, i.padrao]));
  }
}

export function faixasBarra(dir) {
  const v = valoresDoDir(dir);
  return {
    ctx: { amarelo: v['barra.ctx.amarelo'], vermelho: v['barra.ctx.vermelho'] },
    cache: { amarelo: v['barra.cache.amarelo'], verde: v['barra.cache.verde'] },
  };
}

// No formato de FAIXAS_PROJECAO (alerta.js). O nome de cada faixa sai do
// valor desta tabela ('60', '30', '24h' nos padrões, como sempre), nunca do
// arquivo: é a chave de "já avisou" em projecao.json.
export function limiaresAlertas(dir) {
  const v = valoresDoDir(dir);
  const m0 = v['alertas.projecao5hMin.0'];
  const m1 = v['alertas.projecao5hMin.1'];
  const h = v['alertas.projecao7dH'];
  return {
    five_hour: [[String(m0), m0 * MIN_MS], [String(m1), m1 * MIN_MS]],
    seven_day: [[`${h}h`, h * HORA_MS]],
  };
}

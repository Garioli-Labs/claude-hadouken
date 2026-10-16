import fs from 'node:fs';
import path from 'node:path';
import { lerJson, gravarJsonAtomico } from '../estado.js';
import { lerAperto, aplicarAperto } from './aperto.js';

// Tetos da guarda (spec v0.4.0 §5.4, D1 emendado em 2026-09-29): a chave
// `guarda` do mesmo config.json dos repos. reposValidos (v0.1 e v0.2) ignora
// chaves que não conhece, então a chave nova não muda nada para eles (§14).
// Cada campo é inteiro numa faixa fixa; o que não passa usa o padrão e gera
// um aviso de texto fixo (o nome do campo vem desta tabela, nunca do arquivo).
// Arquivo ilegível: todos os padrões; a guarda nunca desliga por erro.

export const ARQ_CONFIG = 'config.json';
const CONFIG_MAX_BYTES = 64 * 1024;

// Teto absoluto de uma liberação, em horas (spec §6.2 e D4: no máximo 24 h):
// o máximo da faixa de liberacao.padraoH e liberacao.maxH, e o padrão do
// maxH. liberacao.js recusa na leitura uma liberação mais longa que isso,
// então nem um liberacao.json forjado solta a guarda por mais de um dia.
export const LIBERACAO_TETO_H = 24;

// ConfigGuarda: os campos abaixo. fableTetoPct (guarda.fable.tetoPct, emenda
// E7) é a porcentagem oficial da semana do Fable a partir da qual todo
// despacho Fable pede liberação (G7 com teto 0); padrão 90, confirmado pelo
// usuário em 2026-09-30.
export const PADRAO_GUARDA = Object.freeze({
  ligada: true, teto5h: 90, horizonte5hMin: 90, margemReset5hMin: 15, teto7d: 85, horizonte7dH: 24,
  fableDespachosMax: 4, fableDespachosHoras: 5, liberacaoPadraoH: 2, liberacaoMaxH: LIBERACAO_TETO_H, liberacaoTetoPontos7d: 10,
  fableTetoPct: 90,
});

// [chave em ConfigGuarda, caminho no JSON, rótulo do aviso, mínimo, máximo]
const CAMPOS = Object.freeze([
  ['teto5h', ['teto5h'], 'teto5h', 50, 100],
  ['horizonte5hMin', ['horizonte5hMin'], 'horizonte5hMin', 10, 300],
  ['margemReset5hMin', ['margemReset5hMin'], 'margemReset5hMin', 0, 60],
  ['teto7d', ['teto7d'], 'teto7d', 50, 100],
  ['horizonte7dH', ['horizonte7dH'], 'horizonte7dH', 1, 72],
  ['fableDespachosMax', ['fableDespachos', 'max'], 'fableDespachos.max', 0, 50],
  ['fableDespachosHoras', ['fableDespachos', 'horas'], 'fableDespachos.horas', 1, 24],
  ['liberacaoPadraoH', ['liberacao', 'padraoH'], 'liberacao.padraoH', 1, LIBERACAO_TETO_H],
  ['liberacaoMaxH', ['liberacao', 'maxH'], 'liberacao.maxH', 1, LIBERACAO_TETO_H],
  ['liberacaoTetoPontos7d', ['liberacao', 'tetoPontos7d'], 'liberacao.tetoPontos7d', 1, 50],
  ['fableTetoPct', ['fable', 'tetoPct'], 'fable.tetoPct', 50, 100],
]);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Só propriedade própria: __proto__ e herdados nunca contam.
const proprio = (o, k) => (ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined);

export function guardaDaConfig(valor) {
  const config = { ...PADRAO_GUARDA };
  const avisos = [];
  try {
    const g = proprio(valor, 'guarda');
    if (g === undefined) return { config, avisos };
    if (!ehObjeto(g)) return { config, avisos: ['config.json: guarda inválida, usando os padrões'] };
    const ligada = proprio(g, 'ligada');
    if (ligada !== undefined) {
      if (typeof ligada === 'boolean') config.ligada = ligada;
      else avisos.push('config.json: guarda.ligada inválido, usando true');
    }
    for (const [chave, caminho, rotulo, min, max] of CAMPOS) {
      let v = g;
      for (const parte of caminho) v = proprio(v, parte);
      if (v === undefined) continue;
      if (Number.isInteger(v) && v >= min && v <= max) config[chave] = v;
      else avisos.push(`config.json: guarda.${rotulo} inválido, usando ${PADRAO_GUARDA[chave]}`);
    }
    if (config.liberacaoPadraoH > config.liberacaoMaxH) config.liberacaoPadraoH = config.liberacaoMaxH;
    return { config, avisos };
  } catch {
    return { config: { ...PADRAO_GUARDA }, avisos: ['config.json: guarda inválida, usando os padrões'] };
  }
}

// O arquivo existe no disco, mesmo que não abra. lerJson devolve 'ausente'
// também quando o open falha num arquivo presente (preso por outro processo,
// sem permissão); só ENOENT/ENOTDIR no lstat é ausência de fato (a mesma
// regra de faltaArquivo em consumo.js, que não se importa daqui).
function existe(arquivo) {
  try {
    fs.lstatSync(arquivo);
    return true;
  } catch (e) {
    return !(e?.code === 'ENOENT' || e?.code === 'ENOTDIR');
  }
}

// Lê <dir>/config.json. `dir` null ou arquivo ausente: padrões sem aviso.
// Arquivo presente mas ilegível (JSON quebrado, acima de 64 KiB, pasta, preso
// ou sem permissão): padrões com um aviso (fail-closed: um "ligada: false"
// que não se lê nunca desliga a guarda). Nunca lança.
// Não confundir com lerConfigBase (config-base.js, a foto dos settings do
// Claude Code no ConfigChange): aqui é o config.json do hadouken, sem o aperto.
export function lerConfigGuardaBase(dir) {
  try {
    if (typeof dir !== 'string') return { config: { ...PADRAO_GUARDA }, avisos: [] };
    const arquivo = path.join(dir, ARQ_CONFIG);
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    if (!lido.ok) {
      return lido.motivo === 'ausente' && !existe(arquivo)
        ? { config: { ...PADRAO_GUARDA }, avisos: [] }
        : { config: { ...PADRAO_GUARDA }, avisos: ['config.json ilegível: guarda com os padrões'] };
    }
    return guardaDaConfig(lido.valor);
  } catch {
    return { config: { ...PADRAO_GUARDA }, avisos: ['config.json ilegível: guarda com os padrões'] };
  }
}

// /hadouken:liberar off | on: grava guarda.ligada no <dir>/config.json e
// preserva o resto (repos, tetos). Arquivo ausente: cria. Presente mas
// ilegível ou fora do formato: não grava nada ({ ok: false }), para não
// apagar o que o usuário escreveu. Nunca lança.
export function gravarGuardaLigada(dir, ligada) {
  try {
    if (typeof dir !== 'string' || typeof ligada !== 'boolean') return { ok: false };
    const arquivo = path.join(dir, ARQ_CONFIG);
    let valor = {};
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    if (lido.ok) valor = lido.valor;
    else if (lido.motivo !== 'ausente' || existe(arquivo)) return { ok: false };
    if (!ehObjeto(valor)) return { ok: false };
    const g = proprio(valor, 'guarda');
    if (g !== undefined && !ehObjeto(g)) return { ok: false };
    return gravarJsonAtomico(arquivo, { ...valor, guarda: { ...(g ?? {}), ligada } });
  } catch {
    return { ok: false };
  }
}

// O que a guarda usa (spec aprendizado §4.4): o config.json com o aperto
// aprendido por cima, só pelo mínimo. lerConfigGuardaBase é o config.json
// puro, para o aprendizado calcular apertos e aprovações sem se somar.
export function lerConfigGuarda(dir) {
  const base = lerConfigGuardaBase(dir);
  try {
    return { config: aplicarAperto(base.config, lerAperto(dir)), avisos: base.avisos };
  } catch {
    return base;
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { numeroFinito } from '../base.js';

// Nomes, tetos e itens do aprendizado (spec aprendizado §4.3, §4.4, §11 e
// R8). Módulo leve: a guarda (src/guarda/aperto.js), o painel e o
// UserPromptSubmit importam só este para saber se o aprendizado está ligado,
// sem carregar o resto. Sem rede e sem processo filho.

export const DIR_OTEL = 'otel';
export const ARQ = Object.freeze({
  aprendizado: 'aprendizado.json', ajustes: 'ajustes.json', sugestoes: 'sugestoes.json',
  cursor: 'aprendizado-cursor.json', eventos: 'aprendizado-eventos.json', trava: 'aprendizado.lock',
});
export const ARQ_OTEL = Object.freeze({
  bin: 'bin', ligado: 'ligado.json', pid: 'coletor.pid', log: 'coletor.log', config: 'config.yaml', subindo: 'subindo.lock', instalado: 'instalado.json',
});
export const TETO = Object.freeze({
  aprendizado: 256 * 1024, ajustes: 64 * 1024, sugestoes: 16 * 1024, cursor: 4 * 1024, eventos: 16 * 1024,
  ligado: 4 * 1024, instalado: 4 * 1024, pid: 1024,
});

// Itens ajustáveis (§4.3 e §4.4, R3 e R9). `padrao` null = o valor do
// config.json (itens da guarda). `decimal`: anda de 0,1 em 0,1; os outros são
// inteiros.
export const ITENS = Object.freeze({
  'painel.intervaloS': Object.freeze({ padrao: 30, min: 30, max: 300, tipo: 'conforto' }),
  'painel.amarelo': Object.freeze({ padrao: 75, min: 60, max: 85, tipo: 'conforto' }),
  'painel.vermelho': Object.freeze({ padrao: 90, min: 85, max: 95, tipo: 'conforto' }),
  'previsao.pesoPerfil': Object.freeze({ padrao: 0, min: 0, max: 0.5, tipo: 'conforto', decimal: true }),
  'guarda.fableTetoPct': Object.freeze({ padrao: null, min: 70, max: 100, tipo: 'guarda', campo: 'fableTetoPct', janela: 'fable' }),
  'guarda.teto7d': Object.freeze({ padrao: null, min: 70, max: 100, tipo: 'guarda', campo: 'teto7d', janela: 'd7' }),
});

export function caminhos(dir) {
  const otel = path.join(dir, DIR_OTEL);
  const bin = path.join(otel, ARQ_OTEL.bin);
  return {
    otel,
    bin,
    ligado: path.join(otel, ARQ_OTEL.ligado),
    pid: path.join(otel, ARQ_OTEL.pid),
    log: path.join(otel, ARQ_OTEL.log),
    config: path.join(otel, ARQ_OTEL.config),
    subindo: path.join(otel, ARQ_OTEL.subindo),
    instalado: path.join(bin, ARQ_OTEL.instalado),
    aprendizado: path.join(dir, ARQ.aprendizado),
    ajustes: path.join(dir, ARQ.ajustes),
    sugestoes: path.join(dir, ARQ.sugestoes),
    cursor: path.join(dir, ARQ.cursor),
    eventos: path.join(dir, ARQ.eventos),
    trava: path.join(dir, ARQ.trava),
  };
}

// O valor, se vale para o item; undefined se não vale. null só nos itens da
// guarda (= o config.json).
export function valorDoItem(item, v) {
  if (typeof item !== 'string' || !Object.hasOwn(ITENS, item)) return undefined;
  const d = ITENS[item];
  if (v === null) return d.padrao === null ? null : undefined;
  if (!numeroFinito(v) || v < d.min || v > d.max) return undefined;
  if (d.decimal) return Math.abs(Math.round(v * 10) - v * 10) < 1e-9 ? v : undefined;
  return Number.isInteger(v) ? v : undefined;
}

export function chaveSugestao(s) {
  if (s.tipo === 'afrouxar') return `afrouxar:${s.item}`;
  return `modelo:${s.origem}|${s.de.modelo}|${s.de.effort}|${s.para.modelo}|${s.para.effort}`;
}

// Ligado = otel/ligado.json é arquivo regular (lstat, link não conta) de até
// 4 KiB. Desligado, que é o padrão, nada do aprendizado é lido (§11).
export function ligadoExiste(dir) {
  try {
    if (typeof dir !== 'string') return false;
    const info = fs.lstatSync(path.join(dir, DIR_OTEL, ARQ_OTEL.ligado), { throwIfNoEntry: false });
    return Boolean(info) && info.isFile() && info.size <= TETO.ligado;
  } catch {
    return false;
  }
}

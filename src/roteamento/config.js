import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { ARQ_CONFIG } from '../guarda/config.js';

// Chave `roteamento` do config.json (spec roteamento §6.3 e §9), no mesmo
// jeito de guardaDaConfig: só propriedade própria, só booleano; o que não
// passa usa o padrão (true) e gera aviso de texto fixo com o nome vindo
// desta tabela. Nunca lança.
const CONFIG_MAX_BYTES = 64 * 1024;
export const PADRAO_ROTEAMENTO = Object.freeze({
  negarN1: true, negarN2: true, avisos: true, sugerirSessao: true,
  otimizacoes: Object.freeze({ leiturasRepetidas: true, saidaGrande: true, mcpOciosos: true, contextoFixo: true, compactar: true }),
});
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const proprio = (o, k) => (ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const copia = () => ({ ...PADRAO_ROTEAMENTO, otimizacoes: { ...PADRAO_ROTEAMENTO.otimizacoes } });

export function roteamentoDaConfig(valor) {
  const config = copia();
  const avisos = [];
  try {
    const r = proprio(valor, 'roteamento');
    if (r === undefined) return { config, avisos };
    if (!ehObjeto(r)) return { config, avisos: ['config.json: roteamento inválido, usando os padrões'] };
    for (const k of ['negarN1', 'negarN2', 'avisos', 'sugerirSessao']) {
      const v = proprio(r, k);
      if (v === undefined) continue;
      if (typeof v === 'boolean') config[k] = v;
      else avisos.push(`config.json: roteamento.${k} inválido, usando true`);
    }
    const o = proprio(r, 'otimizacoes');
    if (o !== undefined && !ehObjeto(o)) avisos.push('config.json: roteamento.otimizacoes inválido, usando os padrões');
    else if (o !== undefined) {
      for (const k of Object.keys(PADRAO_ROTEAMENTO.otimizacoes)) {
        const v = proprio(o, k);
        if (v === undefined) continue;
        if (typeof v === 'boolean') config.otimizacoes[k] = v;
        else avisos.push(`config.json: roteamento.otimizacoes.${k} inválido, usando true`);
      }
    }
    return { config, avisos };
  } catch {
    return { config: copia(), avisos: ['config.json: roteamento inválido, usando os padrões'] };
  }
}

// Aprovar "subir agente" (spec roteamento §8) grava roteamento.subir[agente]
// no config.json, no molde de gravarGuardaLigada: preserva o resto e não
// sobrescreve um arquivo que existe mas não abre.
export function gravarSubida(dir, agente, familia) {
  try {
    if (typeof dir !== 'string' || typeof agente !== 'string' || typeof familia !== 'string') return { ok: false };
    const arquivo = path.join(dir, ARQ_CONFIG);
    let valor = {};
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    if (lido.ok) valor = lido.valor;
    else if (lido.motivo !== 'ausente' || fs.existsSync(arquivo)) return { ok: false };
    if (!ehObjeto(valor)) return { ok: false };
    const r = proprio(valor, 'roteamento');
    if (r !== undefined && !ehObjeto(r)) return { ok: false };
    const s = proprio(r, 'subir');
    if (s !== undefined && !ehObjeto(s)) return { ok: false };
    return gravarJsonAtomico(arquivo, { ...valor, roteamento: { ...(r ?? {}), subir: { ...(s ?? {}), [agente]: familia } } });
  } catch {
    return { ok: false };
  }
}

export function lerConfigRoteamento(dir) {
  try {
    if (typeof dir !== 'string') return { config: copia(), avisos: [] };
    const lido = lerJson(path.join(dir, ARQ_CONFIG), CONFIG_MAX_BYTES);
    if (!lido.ok) return lido.motivo === 'ausente' ? { config: copia(), avisos: [] } : { config: copia(), avisos: ['config.json ilegível: roteamento com os padrões'] };
    return roteamentoDaConfig(lido.valor);
  } catch {
    return { config: copia(), avisos: [] };
  }
}

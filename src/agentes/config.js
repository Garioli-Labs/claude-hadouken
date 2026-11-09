import fs from 'node:fs';
import path from 'node:path';
import { lerJson } from '../estado.js';
import { ARQ_CONFIG } from '../guarda/config.js';
import { PALETA } from './paleta.js';

// Chave `agentes` do config.json (spec v0.6.0 §4 Fatia 4):
//   { "<nome>": { "model": "haiku|sonnet|opus|fable", "effort": "low|...|max", "ativo": true|false } }
// <nome> é um agente da PALETA, sem o prefixo do plugin. Campo fora do enum ou
// com tipo errado é descartado e vira um aviso de texto fixo; nome e valor do
// usuário nunca entram no aviso, salvo um nome que já cabe na regex abaixo.
// Nunca lança.
const CONFIG_MAX_BYTES = 64 * 1024;
const MODELS = new Set(['haiku', 'sonnet', 'opus', 'fable']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const NOMES = new Set(PALETA.map((p) => p.nome));
const NOME_NO_AVISO = /^[A-Za-z0-9_-]{1,64}$/;
const AVISO_LEITURA = 'não consegui ler agentes em config.json';
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const CAMPOS = Object.freeze([
  ['model', (v) => typeof v === 'string' && MODELS.has(v)],
  ['effort', (v) => typeof v === 'string' && EFFORTS.has(v)],
  ['ativo', (v) => typeof v === 'boolean'],
]);

export function validarAgentes(valor) {
  const agentes = {};
  const avisos = [];
  try {
    if (valor === undefined) return { agentes, avisos };
    if (!ehObjeto(valor)) return { agentes, avisos: ['agentes inválido; ignorado'] };
    for (const nome of Object.keys(valor)) {
      if (!NOMES.has(nome)) {
        avisos.push(NOME_NO_AVISO.test(nome) ? `agentes.${nome} inválido; ignorado` : 'agentes: nome inválido; ignorado');
        continue;
      }
      const entrada = valor[nome];
      if (!ehObjeto(entrada)) {
        avisos.push(`agentes.${nome} inválido; ignorado`);
        continue;
      }
      const limpa = {};
      for (const [campo, valido] of CAMPOS) {
        if (!Object.hasOwn(entrada, campo)) continue;
        if (valido(entrada[campo])) limpa[campo] = entrada[campo];
        else avisos.push(`agentes.${nome}.${campo} inválido; ignorado`);
      }
      if (Object.keys(limpa).length > 0) agentes[nome] = limpa;
    }
    return { agentes, avisos };
  } catch {
    return { agentes: {}, avisos: ['agentes inválido; ignorado'] };
  }
}

// Lê a chave `agentes` de <dir>/config.json a cada chamada. Arquivo ausente ou
// sem a chave: sem agentes e sem aviso. Arquivo presente mas ilegível (JSON
// quebrado, acima de 64 KiB, pasta, fora do formato): sem agentes e o aviso de
// leitura (A8); o despacho segue sem override.
export function lerAgentes(dir) {
  try {
    if (typeof dir !== 'string') return { agentes: {}, avisos: [] };
    const arquivo = path.join(dir, ARQ_CONFIG);
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    if (!lido.ok) {
      const ausente = lido.motivo === 'ausente' && !fs.existsSync(arquivo);
      return { agentes: {}, avisos: ausente ? [] : [AVISO_LEITURA] };
    }
    if (!ehObjeto(lido.valor)) return { agentes: {}, avisos: [AVISO_LEITURA] };
    if (!Object.hasOwn(lido.valor, 'agentes')) return { agentes: {}, avisos: [] };
    return validarAgentes(lido.valor.agentes);
  } catch {
    return { agentes: {}, avisos: [AVISO_LEITURA] };
  }
}

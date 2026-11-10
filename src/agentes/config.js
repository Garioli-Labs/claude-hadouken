import fs from 'node:fs';
import path from 'node:path';
import { lerJson, gravarJsonAtomico } from '../estado.js';
import { ARQ_CONFIG } from '../guarda/config.js';
import { PALETA } from './paleta.js';

// Chave `agentes` do config.json (spec v0.6.0 §4 Fatia 4):
//   { "<nome>": { "model": "haiku|sonnet|opus|fable", "effort": "low|...|max", "ativo": true|false } }
// <nome> é um agente da PALETA, sem o prefixo do plugin. Campo fora do enum ou
// com tipo errado é descartado e vira um aviso de texto fixo; nome e valor do
// usuário nunca entram no aviso, salvo um nome que já cabe na regex abaixo.
// Nunca lança.
const CONFIG_MAX_BYTES = 64 * 1024;
export const MODELS = new Set(['haiku', 'sonnet', 'opus', 'fable']);
export const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
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

// --- Comando /hadouken:agentes (spec v0.6.0 §4 Fatia 4, Tarefa 7) ---

const ARGS_MAX = 128;
const NOME_NO_ERRO = /^[a-z0-9_-]{1,32}$/;
const USO = 'Uso: /hadouken:agentes [<agente> <modelo> [effort] | <agente> off | <agente> on | <agente> padrao]';
const erro = (msg) => ({ acao: 'erro', msg });
const lista = (conjunto) => [...conjunto].join(', ');

// O texto digitado depois de /hadouken:agentes. Vazio → mostrar; `<nome> padrao`
// → remover; `<nome> on|off` → gravar {ativo}; `<nome> <model> [effort]` →
// gravar {model, effort?}. Modelo e effort vêm de validarAgentes (a mesma
// lista da leitura). O nome digitado só volta na mensagem se couber em
// NOME_NO_ERRO; o resto do texto nunca volta. Nunca lança.
export function lerArgsAgentes(texto) {
  try {
    if (texto === undefined || texto === null || texto === '') return { acao: 'mostrar' };
    if (typeof texto !== 'string' || texto.length > ARGS_MAX) return erro(USO);
    // NFC antes de comparar: "padrão" decomposto (a + til combinante) não
    // casaria com o literal.
    const t = texto.normalize('NFC').trim().toLowerCase();
    if (t === '') return { acao: 'mostrar' };
    const [nome, a, b, ...resto] = t.split(/\s+/);
    if (!NOMES.has(nome)) {
      return erro(`agente desconhecido${NOME_NO_ERRO.test(nome) ? `: ${nome}` : ''}. Agentes: ${[...NOMES].join(', ')}.`);
    }
    if (a === undefined || resto.length > 0) return erro(USO);
    if (a === 'on' || a === 'off' || a === 'padrao' || a === 'padrão') {
      if (b !== undefined) return erro(USO);
      if (a === 'padrao' || a === 'padrão') return { acao: 'remover', nome };
      return { acao: 'gravar', nome, valor: { ativo: a === 'on' } };
    }
    if (!MODELS.has(a)) return erro(`modelo inválido. Use: ${lista(MODELS)}.`);
    if (b === undefined) return { acao: 'gravar', nome, valor: { model: a } };
    if (!EFFORTS.has(b)) return erro(`effort inválido. Use: ${lista(EFFORTS)}.`);
    return { acao: 'gravar', nome, valor: { model: a, effort: b } };
  } catch {
    return erro(USO);
  }
}

// A entrada nova de agentes.<nome> a partir da atual e do pedido de
// lerArgsAgentes. Com model, troca o par model·effort (sem effort, o effort
// volta ao padrão do agente) e mantém `ativo`; sem model, troca só `ativo`.
// Pura.
export function combinarAgente(atual, valor) {
  const base = ehObjeto(atual) ? atual : {};
  if (!Object.hasOwn(valor, 'model')) return { ...base, ...valor };
  const nova = { model: valor.model };
  if (Object.hasOwn(valor, 'effort')) nova.effort = valor.effort;
  if (base.ativo === false) nova.ativo = false;
  return nova;
}

// Troca só agentes.<nome> do config.json de <dir>, preservando as outras
// chaves (guarda, janela) e os outros agentes, por gravarJsonAtomico. `valor`
// é validado por validarAgentes; `ativo: true` é o padrão e não é gravado, e
// uma entrada que fica vazia sai, como `valor` null; `agentes` sai quando
// esvazia. Sem config.json, remover não cria nada. Arquivo presente mas
// ilegível ou fora do formato (config ou `agentes` que não é objeto): não
// grava ({ ok: false }), para não apagar o que o usuário escreveu. Nunca lança.
export function gravarAgente(dir, nome, valor) {
  try {
    if (typeof dir !== 'string' || dir === '') return { ok: false, motivo: 'dir' };
    if (typeof nome !== 'string' || !NOMES.has(nome)) return { ok: false, motivo: 'nome' };
    let entrada = null;
    if (valor !== null) {
      const v = validarAgentes({ [nome]: valor });
      if (v.avisos.length > 0 || !Object.hasOwn(v.agentes, nome)) return { ok: false, motivo: 'valor' };
      const { ativo, ...resto } = v.agentes[nome];
      entrada = ativo === false ? { ...resto, ativo } : resto;
      if (Object.keys(entrada).length === 0) entrada = null;
    }
    const arquivo = path.join(dir, ARQ_CONFIG);
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    let config = {};
    if (lido.ok) config = lido.valor;
    else if (lido.motivo !== 'ausente' || fs.existsSync(arquivo)) return { ok: false, motivo: 'ilegivel' };
    if (!ehObjeto(config)) return { ok: false, motivo: 'formato' };
    const tem = Object.hasOwn(config, 'agentes');
    if (tem && !ehObjeto(config.agentes)) return { ok: false, motivo: 'formato' };
    const agentes = tem ? config.agentes : {};
    if (entrada === null) {
      if (!Object.hasOwn(agentes, nome)) return { ok: true };
      const { [nome]: _removido, ...sobra } = agentes;
      const { agentes: _antigos, ...semAgentes } = config;
      return gravarJsonAtomico(arquivo, Object.keys(sobra).length === 0 ? semAgentes : { ...config, agentes: sobra });
    }
    return gravarJsonAtomico(arquivo, { ...config, agentes: { ...agentes, [nome]: entrada } });
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { OUTROS, ROTULO_PLUGIN } from '../custo-hooks.js';
import { chaveDe, conferirCompat, textoAviso } from './compat.js';

// O aviso de compatibilidade e de conflitos no SessionStart (spec v0.5.5 §6.G
// e §6.H). Leve: só lê JSON pequenos (package.json e plugin.json do plugin,
// painel/instalado.json, conflitos.json que o coletor grava) e avisa uma vez
// por combinação (compat-avisados.json). Nada vai ao contexto do Claude.

export const ARQ_CONFLITOS = 'conflitos.json';
export const ARQ_COMPAT_AVISADOS = 'compat-avisados.json';
const USO_MS = 7 * 86_400_000;
const DIA_MS = 86_400_000;
const CHAVES_MAX = 50;
const TIPOS = new Set(['statusLine', 'permissao', 'lento']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v) => (typeof v === 'string' && v.length <= 64 ? v : null);

function itemValido(i) {
  if (!ehObjeto(i) || !TIPOS.has(i.tipo)) return false;
  if (i.tipo === 'statusLine') return i.plugin === null;
  if (typeof i.plugin !== 'string' || (i.plugin !== OUTROS && !ROTULO_PLUGIN.test(i.plugin))) return false;
  return i.tipo === 'permissao' || (Number.isInteger(i.p95) && i.p95 > 0 && i.p95 < 1e7);
}

// conflitos.json inteiro, validado, ou null.
export function lerArquivoConflitos(dir) {
  const r = lerJson(path.join(dir, ARQ_CONFLITOS), 16 * 1024);
  const v = r.ok ? r.valor : null;
  if (!ehObjeto(v) || v.v !== 1 || !Number.isFinite(v.em) || !Array.isArray(v.itens) || v.itens.length > 10) return null;
  return v.itens.every(itemValido) ? v : null;
}

// Os itens gravados pelo coletor, se o arquivo é de no máximo 7 dias atrás e
// não do futuro; [] em qualquer outro caso. Nunca lança.
export function lerConflitos(dir, agoraMs = Date.now()) {
  try {
    const v = lerArquivoConflitos(dir);
    return v !== null && v.em <= agoraMs + 60_000 && agoraMs - v.em <= USO_MS ? v.itens : [];
  } catch {
    return [];
  }
}

// As versões a conferir. A extensão do VS Code só entra quando o
// instalador já teve um dia para alcançar o plugin (plugin.json com mais de
// 24 h) e não há falha de instalação pendente, que já tem a linha dela.
function versoes({ dir, agoraMs, raizPlugin, versaoNode, versaoClaude, painelPendente }) {
  const v = { node: versaoNode, claudeCode: texto(versaoClaude), extensao: null, plugin: null };
  if (raizPlugin === null) return { v, compat: null };
  const pkg = lerJson(path.join(raizPlugin, 'package.json'), 64 * 1024);
  const compat = pkg.ok && ehObjeto(pkg.valor) && ehObjeto(pkg.valor.compat) ? pkg.valor.compat : null;
  const arqPlugin = path.join(raizPlugin, '.claude-plugin', 'plugin.json');
  const plugin = lerJson(arqPlugin, 64 * 1024);
  v.plugin = plugin.ok && ehObjeto(plugin.valor) ? texto(plugin.valor.version) : null;
  if (!painelPendente && process.env.HADOUKEN_SEM_PAINEL !== '1') {
    const mtime = fs.statSync(arqPlugin, { throwIfNoEntry: false })?.mtimeMs;
    const inst = lerJson(path.join(dir, 'painel', 'instalado.json'), 4096);
    if (Number.isFinite(mtime) && agoraMs - mtime > DIA_MS && inst.ok && ehObjeto(inst.valor)) v.extensao = texto(inst.valor.versao);
  }
  return { v, compat };
}

// opções: dir, agoraMs, raizPlugin (absoluto ou null), versaoNode,
// versaoClaude (o que o Claude Code mandar; ausente, fica de fora), config
// ({ ligado, compat, conflitos } de configSaude), painelPendente. Devolve o texto do
// aviso ao usuário, só na primeira vez de cada combinação, ou null. Nunca
// lança.
export function avisoCompat(opcoes) {
  try {
    const { dir, agoraMs = Date.now(), config } = opcoes;
    // saude.ligado false: igual à 0.5.4.
    if (!ehObjeto(config) || config.ligado === false || (!config.compat && !config.conflitos)) return null;
    let compat = [];
    if (config.compat) {
      const raizPlugin = typeof opcoes.raizPlugin === 'string' && path.isAbsolute(opcoes.raizPlugin) ? opcoes.raizPlugin : null;
      const { v, compat: minimos } = versoes({
        dir, agoraMs, raizPlugin, versaoNode: opcoes.versaoNode ?? process.version,
        versaoClaude: opcoes.versaoClaude, painelPendente: opcoes.painelPendente === true,
      });
      compat = conferirCompat(v, minimos);
    }
    const conflitos = config.conflitos ? lerConflitos(dir, agoraMs) : [];
    const itens = [...compat, ...conflitos];
    if (itens.length === 0) return null;
    const chave = chaveDe(itens);
    const arq = path.join(dir, ARQ_COMPAT_AVISADOS);
    const r = lerJson(arq, 8 * 1024);
    const antes = r.ok && ehObjeto(r.valor) && Array.isArray(r.valor.chaves) ? r.valor.chaves.filter((c) => typeof c === 'string' && /^[0-9a-f]{8}$/.test(c)) : [];
    if (antes.includes(chave)) return null;
    // Não gravou: não avisa (senão avisaria em toda sessão).
    if (!gravarJsonAtomico(arq, { v: 1, chaves: [...antes, chave].slice(-CHAVES_MAX) }).ok) return null;
    return textoAviso(compat, conflitos);
  } catch {
    return null;
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerJson } from './estado.js';

// v0.5.7: o hadouken igual em qualquer PC (Windows, Linux, macOS). O plugin,
// a extensão do VS Code e os atalhos de <dirDados>/bin seguem cada um o seu
// caminho de atualização; a versão que vale é a que o Claude Code registrou em
// plugins/installed_plugins.json. Uma sessão aberta antes da atualização roda
// a versão velha até fechar e, sem isto, o SessionStart dela (retomada,
// compactação) puxava os atalhos e a extensão para trás. Só lê arquivos
// locais; o registro entra só como caminho e versão conferidos, nunca como
// texto para o Claude. Nunca lança.

const VERSAO = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const REGISTRO_MAX = 1024 * 1024;
const PEQUENO_MAX = 64 * 1024;
const SHIM_MAX = 4096;
const SHIMS = ['statusline.mjs', 'cli.mjs', 'painel.mjs'];
const COMANDO_PAINEL = 'node ~/.claude/hadouken/bin/cli.mjs painel instalar';
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const VAZIO = Object.freeze({ sessao: null, registrada: null, extensao: null, atalhos: [], restos: [] });

// A pasta do Claude Code, com a regra de guarda/despacho.js (dirConfigClaude),
// repetida para este módulo seguir leve no SessionStart.
function dirConfigPadrao() {
  try {
    const c = process.env.CLAUDE_CONFIG_DIR;
    if (typeof c === 'string' && path.isAbsolute(c)) return c;
    const home = os.homedir();
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude') : null;
  } catch {
    return null;
  }
}

// Comparação de caminhos: no Windows sem caixa nem barra de cada lado.
const chave = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

export const versaoDe = (raiz) => {
  const r = lerJson(path.join(raiz, '.claude-plugin', 'plugin.json'), PEQUENO_MAX);
  const v = r.ok && ehObjeto(r.valor) ? r.valor.version : null;
  return typeof v === 'string' && VERSAO.test(v) ? v : null;
};

const raizValida = (p) => typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0')
  && fs.lstatSync(path.join(p, 'src', 'statusline.js'), { throwIfNoEntry: false })?.isFile() === true;

// A entrada do registro na mesma pasta de cache da raiz da sessão
// (<cache>/<loja>/<plugin>/<versão>): a de escopo de usuário antes da de
// projeto. Devolve { nome, raiz } ou null.
function registrada(raiz, dirConfig) {
  if (typeof dirConfig !== 'string' || !path.isAbsolute(dirConfig)) return null;
  const reg = lerJson(path.join(dirConfig, 'plugins', 'installed_plugins.json'), REGISTRO_MAX);
  if (!reg.ok || !ehObjeto(reg.valor) || !ehObjeto(reg.valor.plugins)) return null;
  const pasta = chave(path.dirname(raiz));
  let achada = null;
  for (const [nome, lista] of Object.entries(reg.valor.plugins)) {
    if (!Array.isArray(lista)) continue;
    for (const e of lista) {
      if (!ehObjeto(e) || typeof e.installPath !== 'string' || !path.isAbsolute(e.installPath)) continue;
      if (chave(path.dirname(e.installPath)) !== pasta) continue;
      if (achada === null || (e.scope === 'user' && achada.scope !== 'user')) achada = { nome, raiz: e.installPath, scope: e.scope };
    }
  }
  return achada;
}

// A raiz do plugin que os atalhos e a extensão devem seguir: a registrada,
// quando existe e está na mesma pasta de cache da raiz da sessão; senão a da
// sessão (repo de desenvolvimento, registro ilegível, versão já apagada).
// Rebaixar de propósito também vale: o registro manda, não o número maior.
export function raizEmUso(raiz, { dirConfig = dirConfigPadrao() } = {}) {
  try {
    if (typeof raiz !== 'string' || !path.isAbsolute(raiz)) return raiz;
    const r = registrada(raiz, dirConfig);
    return r !== null && raizValida(r.raiz) ? r.raiz : raiz;
  } catch {
    return raiz;
  }
}

// A versão para onde um atalho de bin/ aponta: a raiz é o que vem antes de
// /src/ na URL de arquivo dele. Raiz sem plugin.json: 'ausente'. Sem atalho
// ou atalho estranho: null.
function versaoDoAtalho(arquivo) {
  const lido = fs.readFileSync(arquivo, 'utf8').slice(0, SHIM_MAX);
  const url = /"(file:[^"]+)"/.exec(lido)?.[1];
  if (url === undefined) return null;
  const alvo = fileURLToPath(url);
  const partes = alvo.split(path.sep);
  const i = partes.lastIndexOf('src');
  if (i <= 0) return null;
  return versaoDe(partes.slice(0, i).join(path.sep) || path.sep) ?? 'ausente';
}

// { sessao, registrada, extensao, atalhos (versões distintas, em ordem), restos
// (nomes antigos do plugin, de `renames` do marketplace.json, ainda
// instalados) }. Nunca lança.
export function conferirInstalacao({ dir, raiz, dirConfig = dirConfigPadrao() } = {}) {
  try {
    if (typeof raiz !== 'string' || !path.isAbsolute(raiz)) return { ...VAZIO, atalhos: [], restos: [] };
    const sessao = versaoDe(raiz);
    const reg = registrada(raiz, dirConfig);
    const emUso = reg !== null && raizValida(reg.raiz) ? reg.raiz : null;
    const out = { sessao, registrada: emUso === null ? null : versaoDe(emUso), extensao: null, atalhos: [], restos: [] };
    if (typeof dir === 'string' && path.isAbsolute(dir)) {
      const inst = lerJson(path.join(dir, 'painel', 'instalado.json'), SHIM_MAX);
      const v = inst.ok && ehObjeto(inst.valor) ? inst.valor.versao : null;
      out.extensao = typeof v === 'string' && VERSAO.test(v) ? v : null;
      const vistos = new Set();
      for (const nome of SHIMS) {
        try {
          const v2 = versaoDoAtalho(path.join(dir, 'bin', nome));
          if (v2 !== null) vistos.add(v2);
        } catch { /* sem esse atalho */ }
      }
      out.atalhos = [...vistos].sort();
    }
    const loja = lerJson(path.join(emUso ?? raiz, '.claude-plugin', 'marketplace.json'), PEQUENO_MAX);
    const reg2 = typeof dirConfig === 'string' && path.isAbsolute(dirConfig) ? lerJson(path.join(dirConfig, 'plugins', 'installed_plugins.json'), REGISTRO_MAX) : { ok: false };
    if (loja.ok && ehObjeto(loja.valor) && typeof loja.valor.name === 'string' && ehObjeto(loja.valor.renames)
      && reg2.ok && ehObjeto(reg2.valor) && ehObjeto(reg2.valor.plugins)) {
      for (const antigo of Object.keys(loja.valor.renames)) {
        const id = `${antigo}@${loja.valor.name}`;
        if (/^[a-z0-9-]{1,64}@[a-z0-9-]{1,64}$/.test(id) && Object.hasOwn(reg2.valor.plugins, id)) out.restos.push(id);
      }
    }
    return out;
  } catch {
    return { ...VAZIO, atalhos: [], restos: [] };
  }
}

// O texto da seção "Instal." do /hadouken:saude: "em dia (...)" ou o que
// difere, cada item com o conserto. Nunca lança.
export function textoInstalacao(c) {
  try {
    if (!ehObjeto(c)) return 'não deu para conferir agora';
    const alvo = c.registrada ?? c.sessao;
    if (alvo === null) return 'não deu para conferir agora';
    const itens = [];
    if (c.registrada !== null && c.sessao !== null && c.sessao !== c.registrada) {
      itens.push(`esta sessão abriu com a ${c.sessao} e a instalada é a ${c.registrada}: feche com /exit e volte com claude -c`);
    }
    if (c.extensao === null) itens.push(`extensão do VS Code não instalada: rode ${COMANDO_PAINEL}`);
    else if (c.extensao !== alvo) itens.push(`extensão do VS Code na ${c.extensao}: rode ${COMANDO_PAINEL}`);
    if (c.atalhos.some((v) => v !== alvo)) itens.push(`atalhos em ${c.atalhos.join(', ')}: a próxima sessão acerta`);
    for (const r of c.restos) itens.push(`plugin antigo instalado: remova com claude plugin uninstall ${r}`);
    return itens.length > 0 ? itens.join('; ') : `em dia (plugin, extensão do VS Code e atalhos na ${alvo})`;
  } catch {
    return 'não deu para conferir agora';
  }
}

// A linha do SessionStart para o Claude repassar: só as duas versões
// conferidas e texto fixo. null quando não há o que dizer.
export function linhaSessaoAntiga(sessao, registradaV) {
  if (typeof sessao !== 'string' || typeof registradaV !== 'string' || !VERSAO.test(sessao) || !VERSAO.test(registradaV) || sessao === registradaV) return null;
  return `hadouken: esta sessão abriu com o plugin ${sessao} e o instalado é o ${registradaV}. Para usar o novo: /exit e claude -c.`;
}

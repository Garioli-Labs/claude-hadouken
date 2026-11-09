import path from 'node:path';
import { lerJson } from '../estado.js';

// Dedup das dependências de terceiros do kit (spec v0.6.0, Fatia 1). Uma
// dependência D (id nome@marketplace) está satisfeita por outra cópia quando
// existe plugin ligado, no escopo do usuário, de marketplace diferente, com o
// mesmo nome ou o mesmo repo de origem. A avaliação é pura sobre o que o
// `claude plugin list --json` e os registros de marketplace dizem; lerRepos
// é a única parte que toca o disco. Nada aqui lança.

export const TERCEIROS_KIT = Object.freeze([
  'superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken', 'poka-yoke@claude-hadouken',
  'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken',
]);

const TETO_JSON = 4 * 1024 * 1024;
const DONO_REPO = /^[^/\s]+\/[^/\s]+$/;
const URL_GITHUB = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const minusculo = (r) => (typeof r === 'string' && DONO_REPO.test(r) ? r.toLowerCase() : null);

// O repo de origem de um plugin, como `dono/repo` em minúsculas: source
// relativo → o repo do marketplace; github → repo; url ou git-subdir de
// github.com → dono/repo sem `.git`; o resto → null (só o nome vale).
export function repoDeOrigem(source, repoMarketplace = null) {
  if (typeof source === 'string') return source === '.' || source.startsWith('./') ? minusculo(repoMarketplace) : null;
  if (!ehObjeto(source)) return null;
  if (source.source === 'github') return minusculo(source.repo);
  if ((source.source === 'url' || source.source === 'git-subdir') && typeof source.url === 'string') {
    const m = URL_GITHUB.exec(source.url);
    return m === null ? null : minusculo(`${m[1]}/${m[2]}`);
  }
  return null;
}

// id → repo de origem, de <pasta>/known_marketplaces.json e do
// .claude-plugin/marketplace.json de cada installLocation. Marketplace
// ilegível é pulado; registro ilegível dá Map vazio.
export function lerRepos(pastaPlugins) {
  const repos = new Map();
  try {
    if (typeof pastaPlugins !== 'string') return repos;
    const conhecidos = lerJson(path.join(pastaPlugins, 'known_marketplaces.json'), TETO_JSON);
    if (!conhecidos.ok || !ehObjeto(conhecidos.valor)) return repos;
    for (const [marketplace, entrada] of Object.entries(conhecidos.valor)) {
      try {
        if (!ehObjeto(entrada) || typeof entrada.installLocation !== 'string') continue;
        const catalogo = lerJson(path.join(entrada.installLocation, '.claude-plugin', 'marketplace.json'), TETO_JSON);
        if (!catalogo.ok || !ehObjeto(catalogo.valor) || !Array.isArray(catalogo.valor.plugins)) continue;
        const repoDoMarketplace = repoDeOrigem(entrada.source);
        const achados = [];
        for (const plugin of catalogo.valor.plugins) {
          if (ehObjeto(plugin) && typeof plugin.name === 'string') achados.push([`${plugin.name}@${marketplace}`, repoDeOrigem(plugin.source, repoDoMarketplace)]);
        }
        for (const [id, repo] of achados) repos.set(id, repo);
      } catch { /* este marketplace é pulado */ }
    }
    return repos;
  } catch {
    return new Map();
  }
}

const nomeDe = (id) => id.split('@')[0];
const marketplaceDe = (id) => id.slice(id.indexOf('@') + 1);

// plugins: Map<id, {version, enabled, scope}>; repos: Map<id, string|null>;
// testado: Record<id, string>. Uma avaliação por dependência, na ordem de deps:
//   propria     a cópia do kit está ligada e nenhuma outra a substitui
//   equivalente outra cópia ligada satisfaz; a do kit está ausente ou desligada
//   duplicada   a do kit e a equivalente estão ligadas
//   ausente     nenhuma cópia ligada (a do kit pode estar instalada e desligada)
export function avaliarDependencias({ deps, plugins, repos, testado } = {}) {
  const mapa = plugins instanceof Map ? plugins : new Map();
  const reposDe = repos instanceof Map ? repos : new Map();
  const versoesTestadas = ehObjeto(testado) ? testado : {};
  const doUsuario = [...mapa].filter(([, p]) => ehObjeto(p) && p.scope === 'user');
  return (Array.isArray(deps) ? deps : []).map((id) => {
    const nome = nomeDe(id);
    const repo = reposDe.get(id) ?? null;
    const propria = doUsuario.find(([k]) => k === id)?.[1];
    const equivalente = doUsuario
      .filter(([k, p]) => p.enabled === true && marketplaceDe(k) !== marketplaceDe(id) && (nomeDe(k) === nome || (repo !== null && reposDe.get(k) === repo)))
      .map(([k]) => k)
      .sort()[0] ?? null;
    const ligada = propria?.enabled === true;
    const estado = equivalente === null ? (ligada ? 'propria' : 'ausente') : (ligada ? 'duplicada' : 'equivalente');
    const testada = versoesTestadas[id];
    const versaoDele = equivalente === null ? null : mapa.get(equivalente).version;
    const difere = typeof versaoDele === 'string' && typeof testada === 'string' && versaoDele !== testada;
    return { id, nome, estado, instalada: propria !== undefined, equivalente, versao: difere ? { equivalente: versaoDele, testada } : null };
  });
}

// lerTestado do instalador: a pasta do kit instalado → versões do testado.json.
export function lerTestadoDoKit(installPath) {
  try {
    if (typeof installPath !== 'string' || installPath === '') return {};
    const r = lerJson(path.join(installPath, 'testado.json'), TETO_JSON);
    return r.ok && ehObjeto(r.valor) && ehObjeto(r.valor.dependencias) ? r.valor.dependencias : {};
  } catch {
    return {};
  }
}

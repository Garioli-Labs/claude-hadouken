// Avaliação das dependências de terceiros do kit no SessionStart (spec v0.6.0,
// Fatia 1). O cache do kit não tem src/: este arquivo é a cópia autocontida de
// src/instalar/dedup.js (TERCEIROS_KIT, repoDeOrigem, lerRepos,
// avaliarDependencias), e test/kit-dependencias.test.js garante o mesmo
// resultado das duas cópias para as mesmas fixtures. Só importa node:. Nada
// aqui escreve em disco nem lança: leitura falhou → null → sem aviso falso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TERCEIROS_KIT = Object.freeze([
  'superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken', 'poka-yoke@claude-hadouken',
  'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken',
]);

const TETO_JSON = 4 * 1024 * 1024;
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);
const DONO_REPO = /^[^/\s]+\/[^/\s]+$/;
const URL_GITHUB = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const minusculo = (r) => (typeof r === 'string' && DONO_REPO.test(r) ? r.toLowerCase() : null);

// Arquivo regular até o teto, lido pelo mesmo descritor que o fstat conferiu.
function lerJson(arquivo) {
  let fd;
  try {
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > TETO_JSON) return { ok: false };
    let texto = fs.readFileSync(fd, 'utf8');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    return { ok: true, valor: JSON.parse(texto) };
  } catch {
    return { ok: false };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* já fechado */ } }
  }
}

// A origem de um plugin, como `dono/repo[/subpasta]` em minúsculas, sem `./`
// e sem `/` no fim (spec v0.6.0, D4 e D11): source relativo `./<sub>` → o repo
// do marketplace e <sub> (`.` e `./` → só o repo); github → repo; url de
// github.com → dono/repo sem `.git`; git-subdir de github.com → o repo e o
// `path`; o resto → null (só o nome vale).
const subpasta = (p) => p.toLowerCase().replace(/^(?:\.\/)+/, '').replace(/^\.$/, '').replace(/\/+$/, '');
const comSubpasta = (repo, sub) => (repo === null || sub === '' ? repo : `${repo}/${sub}`);

export function repoDeOrigem(source, repoMarketplace = null) {
  if (typeof source === 'string') return source === '.' || source.startsWith('./') ? comSubpasta(minusculo(repoMarketplace), subpasta(source)) : null;
  if (!ehObjeto(source)) return null;
  if (source.source === 'github') return minusculo(source.repo);
  if ((source.source === 'url' || source.source === 'git-subdir') && typeof source.url === 'string') {
    const m = URL_GITHUB.exec(source.url);
    const repo = m === null ? null : minusculo(`${m[1]}/${m[2]}`);
    if (source.source === 'url') return repo;
    return typeof source.path === 'string' ? comSubpasta(repo, subpasta(source.path)) : null;
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
    const conhecidos = lerJson(path.join(pastaPlugins, 'known_marketplaces.json'));
    if (!conhecidos.ok || !ehObjeto(conhecidos.valor)) return repos;
    for (const [marketplace, entrada] of Object.entries(conhecidos.valor)) {
      try {
        if (!ehObjeto(entrada) || typeof entrada.installLocation !== 'string') continue;
        const catalogo = lerJson(path.join(entrada.installLocation, '.claude-plugin', 'marketplace.json'));
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
// `desligada`: outra cópia (mesmo nome ou origem) instalada e desligada, ou null.
export function avaliarDependencias({ deps, plugins, repos, testado } = {}) {
  const mapa = plugins instanceof Map ? plugins : new Map();
  const reposDe = repos instanceof Map ? repos : new Map();
  const versoesTestadas = ehObjeto(testado) ? testado : {};
  const doUsuario = [...mapa].filter(([, p]) => ehObjeto(p) && p.scope === 'user');
  return (Array.isArray(deps) ? deps : []).map((id) => {
    const nome = nomeDe(id);
    const repo = reposDe.get(id) ?? null;
    const propria = doUsuario.find(([k]) => k === id)?.[1];
    const outraCopia = ([k]) => marketplaceDe(k) !== marketplaceDe(id) && (nomeDe(k) === nome || (repo !== null && reposDe.get(k) === repo));
    const primeiro = (lista) => lista.map(([k]) => k).sort()[0] ?? null;
    const equivalente = primeiro(doUsuario.filter((e) => e[1].enabled === true && outraCopia(e)));
    const desligada = primeiro(doUsuario.filter((e) => e[1].enabled !== true && outraCopia(e)));
    const ligada = propria?.enabled === true;
    const estado = equivalente === null ? (ligada ? 'propria' : 'ausente') : (ligada ? 'duplicada' : 'equivalente');
    const testada = versoesTestadas[id];
    const versaoDele = equivalente === null ? null : mapa.get(equivalente).version;
    const difere = typeof versaoDele === 'string' && typeof testada === 'string' && versaoDele !== testada;
    return { id, nome, estado, instalada: propria !== undefined, equivalente, desligada, versao: difere ? { equivalente: versaoDele, testada } : null };
  });
}

// <pastaConfig>/plugins/installed_plugins.json (só entradas scope "user")
// cruzado com enabledPlugins de <pastaConfig>/settings.json: enabled só quando
// o valor é exatamente true; id sem chave conta como desligado. Qualquer
// leitura que falhe, ou arquivo de forma errada → null (silêncio): inclui
// `plugins[id]` que não é lista (formato v1) e registro sem o hadouken-kit no
// escopo do usuário (D12).
const ID_KIT = 'hadouken-kit@claude-hadouken';

export function lerRegistro(pastaConfig) {
  try {
    if (typeof pastaConfig !== 'string' || pastaConfig === '') return null;
    const instalados = lerJson(path.join(pastaConfig, 'plugins', 'installed_plugins.json'));
    if (!instalados.ok || !ehObjeto(instalados.valor) || !ehObjeto(instalados.valor.plugins)) return null;
    const settings = lerJson(path.join(pastaConfig, 'settings.json'));
    if (!settings.ok || !ehObjeto(settings.valor)) return null;
    const habilitados = settings.valor.enabledPlugins ?? {};
    if (!ehObjeto(habilitados)) return null;
    const plugins = new Map();
    for (const [id, entradas] of Object.entries(instalados.valor.plugins)) {
      if (!Array.isArray(entradas)) return null;
      const doUsuario = entradas.find((e) => ehObjeto(e) && e.scope === 'user');
      if (doUsuario === undefined) continue;
      plugins.set(id, { version: typeof doUsuario.version === 'string' ? doUsuario.version : null, enabled: habilitados[id] === true, scope: 'user' });
    }
    if (!plugins.has(ID_KIT)) return null;
    return { plugins, repos: lerRepos(path.join(pastaConfig, 'plugins')) };
  } catch {
    return null;
  }
}

// Uma linha por problema, na ordem da avaliação; propria e equivalente não
// geram linha.
export function linhasAviso(avaliacao) {
  const linhas = [];
  for (const a of Array.isArray(avaliacao) ? avaliacao : []) {
    if (!ehObjeto(a) || typeof a.id !== 'string') continue;
    if (a.estado === 'duplicada') {
      linhas.push(`hadouken-kit: ${a.nome} em dobro (${a.equivalente} e ${a.id}). Desligue a cópia do kit: claude plugin disable ${a.id}`);
    } else if (a.estado === 'ausente' && a.instalada === false) {
      linhas.push(`hadouken-kit: falta ${a.nome}. Instale: claude plugin install ${a.id}`);
    } else if (a.estado === 'ausente') {
      linhas.push(`hadouken-kit: ${a.id} está desligado e não há outra cópia. Religue: claude plugin enable ${a.id}`);
    }
  }
  return linhas;
}

// CLAUDE_CONFIG_DIR quando absoluto; senão ~/.claude.
export function pastaConfig(env = process.env, casa = os.homedir()) {
  const c = env?.CLAUDE_CONFIG_DIR;
  return typeof c === 'string' && path.isAbsolute(c) ? c : path.join(casa, '.claude');
}

// O texto do systemMessage do SessionStart: as linhas de aviso unidas por \n,
// ou null quando não há problema ou a leitura falhou. Nunca lança.
export function avisoDaSessao(env = process.env) {
  try {
    const registro = lerRegistro(pastaConfig(env));
    if (registro === null) return null;
    const avaliacao = avaliarDependencias({ deps: TERCEIROS_KIT, plugins: registro.plugins, repos: registro.repos });
    const linhas = linhasAviso(avaliacao);
    return linhas.length === 0 ? null : linhas.join('\n');
  } catch {
    return null;
  }
}

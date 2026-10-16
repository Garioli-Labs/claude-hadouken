// Robô semanal do hadouken-kit (spec v0.5.2, "Atualização automática", peça
// 3). Roda só no GitHub Actions: a rede fica aqui, nunca no plugin. Para cada
// terceiro do marketplace, lê o commit do branch padrão e a versão do
// plugin.json naquele commit; para o rea-agents, a latest do npm. Só versão
// maior que a testada entra (menor ou principal: as duas passam pela suíte);
// commit novo com a mesma versão não chegaria ao usuário. As funções
// aplicar* são puras; o main grava os arquivos e as saídas do job, e o
// workflow testa o ramo antes de publicar. Do texto de fora, só x.y.z e sha
// de 40 hex chegam aos arquivos, ao título e às saídas.
//
// Revisão final, Important 4 (decisão do Sr. Garioli: trava + recusa): no sha
// novo, o terceiro que ganhar hooks, servidor MCP/LSP ou bin é recusado (fica
// no sha testado e abre issue), porque o kit só aceita skills; o que passa tem
// o retrato das skills regerado em test/dados/<nome>.json, e a suíte do ramo
// confere o fluxo contra ele. rea-agents com outro engines também é recusado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES_REA } from '../../rea/lancar.mjs';

export const TERCEIROS = Object.freeze({
  'mattpocock-skills': { repo: 'mattpocock/skills', manifesto: '.claude-plugin/plugin.json' },
  'poka-yoke': { repo: 'rainmanjam/poka-yoke', manifesto: 'plugins/poka-yoke/.claude-plugin/plugin.json' },
  'fullstack-dev-skills': { repo: 'jeffallan/claude-skills', manifesto: '.claude-plugin/plugin.json' },
  'ui-ux-pro-max': { repo: 'nextlevelbuilder/ui-ux-pro-max-skill', manifesto: '.claude-plugin/plugin.json' },
});
const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;
const PRE = /^\d+\.\d+\.\d+-/;
const MAIOR = new Set(['menor', 'principal']);

export function xyz(v) {
  return SEMVER.exec(typeof v === 'string' ? v : '')?.[0] ?? null;
}

// Pré-release publicada não é versão nova; a final entra quando sair.
export function compararVersoes(testada, publicada) {
  const a = SEMVER.exec(testada ?? '');
  const b = SEMVER.exec(publicada ?? '');
  if (!a || !b) return 'invalida';
  if (PRE.test(publicada)) return 'pre-release';
  for (const i of [1, 2, 3]) {
    if (Number(b[i]) === Number(a[i])) continue;
    if (Number(b[i]) < Number(a[i])) return 'anterior';
    return i === 1 ? 'principal' : 'menor';
  }
  return 'igual';
}

// lidos: { terceiros: { <nome>: { sha, versao } | null }, rea: string | null,
// reaEngines: string | null }
export function decidir(testado, lidos) {
  const terceiros = [];
  for (const nome of Object.keys(TERCEIROS)) {
    const l = lidos.terceiros?.[nome];
    const de = testado.dependencias[`${nome}@claude-hadouken`];
    if (!l || typeof l.sha !== 'string' || !SHA.test(l.sha)) continue;
    const tipo = compararVersoes(de, l.versao);
    if (MAIOR.has(tipo)) terceiros.push({ nome, de, para: xyz(l.versao), sha: l.sha, tipo });
  }
  const deRea = testado.npm['rea-agents'];
  const tipoRea = compararVersoes(deRea, lidos.rea);
  let rea = MAIOR.has(tipoRea) ? { de: deRea, para: xyz(lidos.rea), tipo: tipoRea } : null;
  const recusas = [];
  if (rea && lidos.reaEngines !== ENGINES_REA) {
    const engines = typeof lidos.reaEngines === 'string' && /^[0-9<>=^~|. ]{1,80}$/.test(lidos.reaEngines) ? lidos.reaEngines : '?';
    recusas.push(`rea-agents ${rea.para} (engines ${engines})`);
    rea = null;
  }
  return { terceiros, rea, recusas };
}

export function tituloRecusa(recusas) {
  return `robô: recusado ${recusas.join('; ')}`;
}

// A trava: o que, na raiz do plugin do terceiro, roda código fora de uma
// skill. arvore: os caminhos do repositório no sha novo.
export function proibidos({ arvore, raiz, manifesto }) {
  if (manifesto === null || typeof manifesto !== 'object') return ['sem plugin.json'];
  const base = raiz ? `${raiz}/` : '';
  const motivos = [];
  for (const [nome, pasta] of [['hooks/', true], ['bin/', true], ['.mcp.json', false], ['.lsp.json', false]]) {
    const alvo = base + nome;
    if (arvore.some((c) => (pasta ? c === alvo.slice(0, -1) || c.startsWith(alvo) : c === alvo))) motivos.push(nome);
  }
  for (const chave of ['hooks', 'mcpServers', 'lspServers']) if (Object.hasOwn(manifesto, chave)) motivos.push(`plugin.json ${chave}`);
  return motivos.sort();
}

// As pastas de skill do terceiro, como o Claude Code acha: skills/<x>/ e,
// somado a isso, o campo skills do plugin.json (texto ou lista), em que cada
// caminho é a pasta de uma skill (tem SKILL.md) ou uma pasta de skills
// (<caminho>/<x>/SKILL.md). Caminho com .. fica de fora.
export function pastasDeSkills({ arvore, raiz, manifesto }) {
  const base = raiz ? `${raiz}/` : '';
  const tem = new Set(arvore);
  const campo = typeof manifesto?.skills === 'string' ? [manifesto.skills] : Array.isArray(manifesto?.skills) ? manifesto.skills : [];
  const lugares = ['skills', ...campo.filter((p) => typeof p === 'string' && !p.split('/').includes('..')).map((p) => p.replace(/^\.\//, '').replace(/\/+$/, ''))];
  const pastas = new Set();
  for (const l of lugares.map((x) => base + x)) {
    if (tem.has(`${l}/SKILL.md`)) pastas.add(l);
    for (const c of arvore) {
      const resto = c.startsWith(`${l}/`) ? c.slice(l.length + 1) : null;
      if (resto !== null && /^[^/]+\/SKILL\.md$/.test(resto)) pastas.add(c.slice(0, -'/SKILL.md'.length));
    }
  }
  return [...pastas].sort();
}

export function lerSkill(texto, pasta) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? '';
  const nome = /^name:\s*([a-z0-9-]+)\s*$/m.exec(fm)?.[1] ?? pasta.split('/').pop();
  return { nome, soUsuario: /^disable-model-invocation:\s*true\s*$/m.test(fm) };
}

export function montarRetrato({ repo, commit, versao, skills }) {
  const lista = skills.map(({ nome, soUsuario }) => ({ nome, soUsuario })).sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
  return { fonte: `github.com/${repo}`, commit, versao, skills: lista };
}

// A versão do rea-agents citada nos textos (README, SECURITY, plugin.json,
// comentário do lançador): rea-agents@x e "rea-agents x".
export function aplicarVersaoRea(texto, de, para) {
  const v = de.replaceAll('.', '\\.');
  return texto.replace(new RegExp(`rea-agents([@ ])${v}(?![0-9])`, 'g'), `rea-agents$1${para}`);
}

export function subirPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`versão inválida: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

const json = (valor) => `${JSON.stringify(valor, null, 2)}\n`;

function entrada(m, nome) {
  const p = Array.isArray(m.plugins) ? m.plugins.find((x) => x?.name === nome) : null;
  if (!p) throw new Error(`entrada ausente no marketplace: ${nome}`);
  return p;
}

export function aplicarMarketplace(texto, { terceiros, rea }, versoes) {
  const m = JSON.parse(texto);
  for (const t of terceiros) {
    const p = entrada(m, t.nome);
    if (typeof p.source !== 'object' || p.source === null) throw new Error(`entrada sem fonte remota: ${t.nome}`);
    p.source.sha = t.sha;
  }
  entrada(m, 'hadouken-kit').version = versoes.kit;
  if (rea) entrada(m, 'hadouken-rea').version = versoes.rea;
  return json(m);
}

export function aplicarTestado(texto, { terceiros, rea }) {
  const t = JSON.parse(texto);
  for (const x of terceiros) t.dependencias[`${x.nome}@claude-hadouken`] = x.para;
  if (rea) t.npm['rea-agents'] = rea.para;
  return json(t);
}

export function aplicarLancar(texto, versao) {
  const re = /export const VERSAO_REA = '\d+\.\d+\.\d+';/g;
  const achados = texto.match(re) ?? [];
  if (achados.length !== 1) throw new Error(`VERSAO_REA aparece ${achados.length} vezes em rea/lancar.mjs`);
  return texto.replace(re, `export const VERSAO_REA = '${versao}';`);
}

export function aplicarPluginJson(texto, versao) {
  const p = JSON.parse(texto);
  p.version = versao;
  return json(p);
}

export function tituloIssue({ terceiros, rea }) {
  const partes = terceiros.map((t) => `${t.nome} ${t.de} → ${t.para}`);
  if (rea) partes.push(`rea-agents ${rea.de} → ${rea.para}`);
  return `robô: ${partes.join(', ')}`;
}

// O graphify empacotado depende do graphifyy do pip: versão nova só avisa.
export function avisoPip(testado, publicada) {
  const de = testado.pip?.graphifyy;
  return MAIOR.has(compararVersoes(de, publicada)) ? `robô: graphifyy ${xyz(publicada)} no pip (o kit testa ${de})` : null;
}

async function pedir(url, aceitar) {
  const cabecalhos = { 'User-Agent': 'claude-hadouken-robo', Accept: aceitar };
  if (url.startsWith('https://api.github.com/') && process.env.GH_TOKEN) cabecalhos.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const r = await fetch(url, { headers: cabecalhos, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function lerTerceiro({ repo, manifesto }) {
  const sha = (await pedir(`https://api.github.com/repos/${repo}/commits/HEAD`, 'application/vnd.github.sha')).trim();
  if (!SHA.test(sha)) return null;
  const m = JSON.parse(await pedir(`https://raw.githubusercontent.com/${repo}/${sha}/${manifesto}`, 'application/json'));
  return { sha, versao: typeof m.version === 'string' ? m.version : null, manifesto: m };
}

// No sha novo: a árvore inteira, a trava e, passando, o retrato das skills.
export async function conferirTerceiro(nome, { sha, manifesto }, ler = pedir) {
  const { repo, manifesto: rel } = TERCEIROS[nome];
  const raiz = rel.split('/').slice(0, -2).join('/');
  const a = JSON.parse(await ler(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`, 'application/vnd.github+json'));
  if (a.truncated === true || !Array.isArray(a.tree)) return { motivos: ['árvore truncada'] };
  const arvore = a.tree.map((e) => e?.path).filter((c) => typeof c === 'string');
  const motivos = proibidos({ arvore, raiz, manifesto });
  if (motivos.length > 0) return { motivos };
  const skills = [];
  for (const pasta of pastasDeSkills({ arvore, raiz, manifesto })) {
    skills.push(lerSkill(await ler(`https://raw.githubusercontent.com/${repo}/${sha}/${pasta}/SKILL.md`, 'text/plain'), pasta));
  }
  return { motivos: [], retrato: montarRetrato({ repo, commit: sha, versao: xyz(manifesto.version), skills }) };
}

// Grava no repositório (raiz) o que a decisão muda: lançador, plugin.json e
// textos do REA, retratos, marketplace, testado.json e plugin.json do kit.
// Devolve as versões novas do kit e do REA.
export function gravarDecisao(raiz, decisao, retratos) {
  const arq = (rel) => path.join(raiz, rel);
  const lerArq = (rel) => fs.readFileSync(arq(rel), 'utf8');
  const versoes = { kit: subirPatch(JSON.parse(lerArq('kit/.claude-plugin/plugin.json')).version), rea: null };
  if (decisao.rea) {
    versoes.rea = subirPatch(JSON.parse(lerArq('rea/.claude-plugin/plugin.json')).version);
    fs.writeFileSync(arq('rea/lancar.mjs'), aplicarLancar(lerArq('rea/lancar.mjs'), decisao.rea.para));
    fs.writeFileSync(arq('rea/.claude-plugin/plugin.json'), aplicarPluginJson(lerArq('rea/.claude-plugin/plugin.json'), versoes.rea));
    for (const rel of ['README.md', 'README.en.md', 'SECURITY.md', 'rea/.claude-plugin/plugin.json', 'rea/lancar.mjs']) {
      fs.writeFileSync(arq(rel), aplicarVersaoRea(lerArq(rel), decisao.rea.de, decisao.rea.para));
    }
  }
  for (const [nome, r] of Object.entries(retratos)) fs.writeFileSync(arq(`test/dados/${nome}.json`), json(r));
  fs.writeFileSync(arq('.claude-plugin/marketplace.json'), aplicarMarketplace(lerArq('.claude-plugin/marketplace.json'), decisao, versoes));
  fs.writeFileSync(arq('kit/testado.json'), aplicarTestado(lerArq('kit/testado.json'), decisao));
  fs.writeFileSync(arq('kit/.claude-plugin/plugin.json'), aplicarPluginJson(lerArq('kit/.claude-plugin/plugin.json'), versoes.kit));
  return versoes;
}

async function main() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const arq = (rel) => path.join(raiz, rel);
  const lerArq = (rel) => fs.readFileSync(arq(rel), 'utf8');
  const testado = JSON.parse(lerArq('kit/testado.json'));
  const lidos = { terceiros: {}, rea: null };
  const notas = [];
  for (const [nome, t] of Object.entries(TERCEIROS)) {
    lidos.terceiros[nome] = await lerTerceiro(t).catch((e) => { notas.push(`${nome}: ${e.message}`); return null; });
  }
  const npm = await pedir('https://registry.npmjs.org/rea-agents/latest', 'application/json').then((t) => JSON.parse(t), () => null);
  lidos.rea = typeof npm?.version === 'string' ? npm.version : null;
  lidos.reaEngines = typeof npm?.engines?.node === 'string' ? npm.engines.node : null;
  const pip = await pedir('https://pypi.org/pypi/graphifyy/json', 'application/json').then((t) => JSON.parse(t).info?.version, () => null);
  const decisao = decidir(testado, lidos);
  const retratos = {};
  for (const t of [...decisao.terceiros]) {
    const c = await conferirTerceiro(t.nome, lidos.terceiros[t.nome]).catch((e) => { notas.push(`${t.nome} no sha novo: ${e.message}`); return null; });
    if (c === null || c.motivos.length > 0) {
      decisao.terceiros = decisao.terceiros.filter((x) => x !== t);
      if (c) decisao.recusas.push(`${t.nome} ${t.para} (${c.motivos.join(', ')})`);
    } else {
      retratos[t.nome] = c.retrato;
    }
  }
  const saidas = { mudou: 'nao', titulo: '', versao_kit: '', ramo: '', aviso: avisoPip(testado, pip) ?? '', recusa: decisao.recusas.length > 0 ? tituloRecusa(decisao.recusas) : '' };
  if (decisao.terceiros.length > 0 || decisao.rea) {
    const versoes = gravarDecisao(raiz, decisao, retratos);
    Object.assign(saidas, { mudou: 'sim', titulo: tituloIssue(decisao), versao_kit: versoes.kit, ramo: `robo/kit-${new Date().toISOString().slice(0, 10)}` });
  }
  const resumo = [`## kit-atualizar`, '', saidas.mudou === 'sim' ? saidas.titulo : 'nada novo', saidas.recusa, ...notas.map((n) => `- não li ${n}`)].filter((l, i) => i < 3 || l !== '').join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resumo}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(saidas).map(([k, v]) => `${k}=${v}\n`).join(''));
  console.log(resumo);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

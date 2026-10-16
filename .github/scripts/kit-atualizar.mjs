// Robô semanal do hadouken-kit (spec v0.5.2, "Atualização automática", peça
// 3). Roda só no GitHub Actions: a rede fica aqui, nunca no plugin. Para cada
// terceiro do marketplace, lê o commit do branch padrão e a versão do
// plugin.json naquele commit; para o rea-agents, a latest do npm. Só versão
// maior que a testada entra (menor ou principal: as duas passam pela suíte);
// commit novo com a mesma versão não chegaria ao usuário. As funções
// aplicar* são puras; o main grava os arquivos e as saídas do job, e o
// workflow testa o ramo antes de publicar. Do texto de fora, só x.y.z e sha
// de 40 hex chegam aos arquivos, ao título e às saídas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// lidos: { terceiros: { <nome>: { sha, versao } | null }, rea: string | null }
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
  const rea = MAIOR.has(tipoRea) ? { de: deRea, para: xyz(lidos.rea), tipo: tipoRea } : null;
  return { terceiros, rea };
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
  return { sha, versao: typeof m.version === 'string' ? m.version : null };
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
  lidos.rea = await pedir('https://registry.npmjs.org/rea-agents/latest', 'application/json').then((t) => JSON.parse(t).version, () => null);
  const pip = await pedir('https://pypi.org/pypi/graphifyy/json', 'application/json').then((t) => JSON.parse(t).info?.version, () => null);
  const decisao = decidir(testado, lidos);
  const saidas = { mudou: 'nao', titulo: '', versao_kit: '', ramo: '', aviso: avisoPip(testado, pip) ?? '' };
  if (decisao.terceiros.length > 0 || decisao.rea) {
    const kit = JSON.parse(lerArq('kit/.claude-plugin/plugin.json'));
    const versoes = { kit: subirPatch(kit.version), rea: null };
    if (decisao.rea) {
      versoes.rea = subirPatch(JSON.parse(lerArq('rea/.claude-plugin/plugin.json')).version);
      fs.writeFileSync(arq('rea/lancar.mjs'), aplicarLancar(lerArq('rea/lancar.mjs'), decisao.rea.para));
      fs.writeFileSync(arq('rea/.claude-plugin/plugin.json'), aplicarPluginJson(lerArq('rea/.claude-plugin/plugin.json'), versoes.rea));
    }
    fs.writeFileSync(arq('.claude-plugin/marketplace.json'), aplicarMarketplace(lerArq('.claude-plugin/marketplace.json'), decisao, versoes));
    fs.writeFileSync(arq('kit/testado.json'), aplicarTestado(lerArq('kit/testado.json'), decisao));
    fs.writeFileSync(arq('kit/.claude-plugin/plugin.json'), aplicarPluginJson(lerArq('kit/.claude-plugin/plugin.json'), versoes.kit));
    Object.assign(saidas, { mudou: 'sim', titulo: tituloIssue(decisao), versao_kit: versoes.kit, ramo: `robo/kit-${new Date().toISOString().slice(0, 10)}` });
  }
  const resumo = [`## kit-atualizar`, '', saidas.mudou === 'sim' ? saidas.titulo : 'nada novo', ...notas.map((n) => `- não li ${n}`)].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resumo}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(saidas).map(([k, v]) => `${k}=${v}\n`).join(''));
  console.log(resumo);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

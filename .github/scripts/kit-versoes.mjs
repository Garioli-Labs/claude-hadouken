// Aviso semanal do hadouken-kit (spec §3). Roda só no GitHub Actions: a rede
// fica aqui, nunca no plugin. Compara a versão publicada de cada dependência
// com a de kit/testado.json; versão principal nova vira issue (pelo workflow),
// o resto só aparece no resumo do job.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// De onde ler cada versão publicada. Conferido em 2026-10-14 nos
// marketplace.json de ~/.claude/plugins/marketplaces. O superpowers aponta
// para obra/superpowers por url+sha no marketplace oficial; o Claude Code
// instala o sha fixado, não o HEAD (v0.5.1: HEAD 7.0.0, sha fixado 6.4.1).
// `pelaFonte`: lê a entrada, depois esse arquivo no repo e sha dela.
export const fontes = {
  'claude-hadouken@claude-hadouken': { repo: 'Garioli-Labs/claude-hadouken', arquivo: '.claude-plugin/plugin.json' },
  'superpowers@claude-plugins-official': { repo: 'anthropics/claude-plugins-official', arquivo: '.claude-plugin/marketplace.json', entrada: 'superpowers', pelaFonte: '.claude-plugin/plugin.json' },
  'mattpocock-skills@mattpocock': { repo: 'mattpocock/skills', arquivo: '.claude-plugin/plugin.json' },
  'poka-yoke@poka-yoke': { repo: 'rainmanjam/poka-yoke', arquivo: 'plugins/poka-yoke/.claude-plugin/plugin.json' },
  // O plugin.json dele virou link simbólico no upstream (2026-10-14): a
  // versão vem da entrada do marketplace.json, a que o Claude Code usa. Saiu
  // do kit (o link quebra a instalação no Windows) e do testado.json; a fonte
  // fica para quando voltar.
  'clean-architecture@clean-architecture-skills': { repo: 'nathankim0/clean-architecture-skills', arquivo: '.claude-plugin/marketplace.json', entrada: 'clean-architecture' },
  'fullstack-dev-skills@fullstack-dev-skills': { repo: 'jeffallan/claude-skills', arquivo: '.claude-plugin/plugin.json' },
  'ui-ux-pro-max@ui-ux-pro-max-skill': { repo: 'nextlevelbuilder/ui-ux-pro-max-skill', arquivo: '.claude-plugin/plugin.json' },
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;

// Só o x.y.z do começo; o resto do texto (de repositório de terceiro) não
// chega à issue nem ao resumo.
export function xyz(v) {
  return SEMVER.exec(typeof v === 'string' ? v : '')?.[0] ?? null;
}

// Pré-release publicada (7.0.0-beta.1) não é versão nova: fica no resumo,
// sem issue, para a do 7.0.0 final abrir quando sair.
const PRE = /^\d+\.\d+\.\d+-/;

export function compararVersoes(testada, publicada) {
  const a = SEMVER.exec(testada ?? ''); const b = SEMVER.exec(publicada ?? '');
  if (!a || !b) return 'invalida';
  if (PRE.test(publicada)) return 'pre-release';
  for (const i of [1, 2, 3]) {
    if (Number(b[i]) === Number(a[i])) continue;
    if (Number(b[i]) < Number(a[i])) return 'anterior';
    return i === 1 ? 'principal' : 'menor';
  }
  return 'igual';
}

export function relatorio(testado, publicadas) {
  const linhas = ['| Dependência | Testada | Publicada | |', '|---|---|---|---|'];
  const principais = [];
  const pares = [
    ...Object.entries(testado.dependencias).map(([k, v]) => [k, v]),
    ...Object.entries(testado.npm ?? {}).map(([k, v]) => [`npm:${k}`, v]),
  ];
  for (const [chave, testada] of pares) {
    const bruta = typeof publicadas[chave] === 'string' ? publicadas[chave] : null;
    const publicada = xyz(bruta);
    const c = compararVersoes(testada, bruta);
    if (c === 'principal') principais.push({ chave, testada, publicada });
    const nota = { invalida: 'não consegui ler', 'pre-release': 'pré-release' }[c] ?? c;
    linhas.push(`| ${chave} | ${testada} | ${publicada ?? '—'} | ${nota} |`);
  }
  return { principais, resumo: linhas.join('\n') };
}

// A versão de um plugin.json, ou da entrada `fonte.entrada` de um
// marketplace.json. null quando não há.
export function versaoDe(json, fonte) {
  if (!json || typeof json !== 'object') return null;
  if (fonte.entrada) {
    const p = Array.isArray(json.plugins) ? json.plugins.find((x) => x?.name === fonte.entrada) : null;
    return typeof p?.version === 'string' ? p.version : null;
  }
  return typeof json.version === 'string' ? json.version : null;
}

// O endereço do `fonte.pelaFonte` no repositório e sha que a entrada
// `fonte.entrada` fixa (source url do GitHub + sha de 40 hex). null quando
// a entrada não tem essa forma.
export function urlDaFonte(json, fonte) {
  const p = Array.isArray(json?.plugins) ? json.plugins.find((x) => x?.name === fonte.entrada) : null;
  const s = p?.source;
  const repo = /^https:\/\/github\.com\/([\w-]+\/[\w-][\w.-]*?)(?:\.git)?$/.exec(typeof s?.url === 'string' ? s.url : '')?.[1];
  if (!repo || repo.includes('..') || !/^[0-9a-f]{40}$/.test(s?.sha ?? '')) return null;
  return `https://raw.githubusercontent.com/${repo}/${s.sha}/${fonte.pelaFonte}`;
}

async function lerPublicada(chave) {
  if (chave === 'npm:rea-agents') {
    const r = await fetch('https://registry.npmjs.org/rea-agents/latest');
    return r.ok ? (await r.json()).version : null;
  }
  const f = fontes[chave];
  const r = await fetch(`https://raw.githubusercontent.com/${f.repo}/HEAD/${f.arquivo}`);
  if (!r.ok) return null;
  if (!f.pelaFonte) return versaoDe(await r.json(), f);
  const url = urlDaFonte(await r.json(), f);
  const r2 = url ? await fetch(url) : null;
  return r2?.ok ? versaoDe(await r2.json(), {}) : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const testado = JSON.parse(fs.readFileSync(path.join(raiz, 'kit', 'testado.json'), 'utf8'));
  const chaves = [...Object.keys(testado.dependencias), ...Object.keys(testado.npm ?? {}).map((k) => `npm:${k}`)];
  const publicadas = {};
  for (const k of chaves) publicadas[k] = await lerPublicada(k).catch(() => null);
  const r = relatorio(testado, publicadas);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## hadouken-kit: versões\n\n${r.resumo}\n`);
  fs.writeFileSync('principais.json', JSON.stringify(r.principais));
  console.log(r.resumo);
}

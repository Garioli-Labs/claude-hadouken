// Aviso semanal do hadouken-kit (spec §3). Roda só no GitHub Actions: a rede
// fica aqui, nunca no plugin. Compara a versão publicada de cada dependência
// com a de kit/testado.json; versão principal nova vira issue (pelo workflow),
// o resto só aparece no resumo do job.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// De onde ler cada versão publicada. Conferido em 2026-10-14 nos
// marketplace.json de ~/.claude/plugins/marketplaces. O superpowers aponta
// para obra/superpowers por url+sha no marketplace oficial; lemos o
// plugin.json do repositório do autor.
export const fontes = {
  'claude-hadouken@claude-hadouken': { repo: 'Garioli-Labs/claude-hadouken', arquivo: '.claude-plugin/plugin.json' },
  'superpowers@claude-plugins-official': { repo: 'obra/superpowers', arquivo: '.claude-plugin/plugin.json' },
  'mattpocock-skills@mattpocock': { repo: 'mattpocock/skills', arquivo: '.claude-plugin/plugin.json' },
  'poka-yoke@poka-yoke': { repo: 'rainmanjam/poka-yoke', arquivo: 'plugins/poka-yoke/.claude-plugin/plugin.json' },
  // O plugin.json dele virou link simbólico no upstream (2026-10-14): a
  // versão vem da entrada do marketplace.json, a que o Claude Code usa.
  'clean-architecture@clean-architecture-skills': { repo: 'nathankim0/clean-architecture-skills', arquivo: '.claude-plugin/marketplace.json', entrada: 'clean-architecture' },
  'fullstack-dev-skills@fullstack-dev-skills': { repo: 'jeffallan/claude-skills', arquivo: '.claude-plugin/plugin.json' },
  'ui-ux-pro-max@ui-ux-pro-max-skill': { repo: 'nextlevelbuilder/ui-ux-pro-max-skill', arquivo: '.claude-plugin/plugin.json' },
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;

export function compararVersoes(testada, publicada) {
  const a = SEMVER.exec(testada ?? ''); const b = SEMVER.exec(publicada ?? '');
  if (!a || !b) return 'invalida';
  if (a[0] === b[0]) return 'igual';
  return Number(b[1]) > Number(a[1]) ? 'principal' : 'menor';
}

export function relatorio(testado, publicadas) {
  const linhas = ['| Dependência | Testada | Publicada | |', '|---|---|---|---|'];
  const principais = [];
  const pares = [
    ...Object.entries(testado.dependencias).map(([k, v]) => [k, v]),
    ...Object.entries(testado.npm ?? {}).map(([k, v]) => [`npm:${k}`, v]),
  ];
  for (const [chave, testada] of pares) {
    const publicada = publicadas[chave];
    const c = compararVersoes(testada, publicada);
    if (c === 'principal') principais.push({ chave, testada, publicada });
    const nota = c === 'invalida' ? 'não consegui ler' : c;
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

async function lerPublicada(chave) {
  if (chave === 'npm:rea-agents') {
    const r = await fetch('https://registry.npmjs.org/rea-agents/latest');
    return r.ok ? (await r.json()).version : null;
  }
  const f = fontes[chave];
  const r = await fetch(`https://raw.githubusercontent.com/${f.repo}/HEAD/${f.arquivo}`);
  return r.ok ? versaoDe(await r.json(), f) : null;
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

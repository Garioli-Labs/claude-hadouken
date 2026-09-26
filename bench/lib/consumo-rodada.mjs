// Uma execução do /consumo para bench/consumo.mjs, num processo próprio, como
// o CLI (src/comandos.js): gerarRelatorio com o prazo de 10 s do GitHub e o
// texto em Markdown. Diferenças do CLI, todas para isolar a medição: o gh é
// sempre um executor falso (gh-falso.mjs com o repo sintético, ou um que
// responde 'gh ausente'), nunca um processo nem a rede; a raiz dos
// transcripts vem em raizTranscripts; o cwd do origin e o agoraMs vêm na
// linha de comando. Uso (só bench/consumo.mjs chama):
//
//   node bench/lib/consumo-rodada.mjs <com-repo|sem-repo> <raiz> <cwd> <agoraMs>
//
// HADOUKEN_HOME vem do ambiente. Imprime uma linha JSON com o que o bench
// confere (ok, transcripts lidos, repos, chamadas ao gh, tamanho do texto e o
// sha256 do relatório); o texto em si não é impresso. Como o CLI, sai com
// process.exit() depois do callback da escrita.
import { createHash } from 'node:crypto';
import { gerarRelatorio } from '../../src/consumo.js';
import { formatarMarkdown } from '../../src/relatorio.js';
import { criarGhFalso, REPO_FALSO } from './gh-falso.mjs';

const PRAZO_GITHUB_MS = 10_000;
const [cenario, raiz, cwd, agoraTexto] = process.argv.slice(2);
const agoraMs = Number(agoraTexto);
if (!['com-repo', 'sem-repo'].includes(cenario) || !raiz || !cwd || !Number.isSafeInteger(agoraMs) || process.argv.length !== 6) {
  console.error('uso: node bench/lib/consumo-rodada.mjs <com-repo|sem-repo> <raiz> <cwd> <agoraMs>');
  process.exit(2);
}

let executor;
if (cenario === 'com-repo') {
  executor = criarGhFalso(agoraMs);
} else {
  let n = 0;
  executor = { gh: async () => { n++; return { ok: false, motivo: 'gh ausente' }; }, chamadas: () => n };
}

const r = await gerarRelatorio({ agoraMs, gh: executor.gh, raizTranscripts: raiz, cwd, prazoGithubMs: PRAZO_GITHUB_MS });
const rel = r.ok ? r.relatorio : null;
const texto = rel === null ? '' : formatarMarkdown(rel);
const repo = rel?.github?.[REPO_FALSO];
process.stdout.write(`${JSON.stringify({
  ok: r.ok,
  motivo: r.ok ? null : r.motivo,
  arquivos: rel?.claude?.arquivos ?? null,
  respostasSemana: rel?.claude?.semana?.total?.respostas ?? null,
  semanaOrigem: rel?.claude?.semana_origem ?? null,
  limites: rel !== null && rel.limites !== null,
  repos: rel === null ? [] : Object.keys(rel.github),
  runs30: repo?.runs30?.total ?? null,
  minutosPonderados: repo?.minutos30?.ponderado ?? null,
  bytesCache: repo?.cache?.bytes ?? null,
  chamadasGh: executor.chamadas(),
  bytesTexto: Buffer.byteLength(texto),
  sha256: rel === null ? null : createHash('sha256').update(JSON.stringify(rel)).digest('hex'),
})}\n`, () => process.exit(0));

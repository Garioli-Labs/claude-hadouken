// Tempo de parede do /consumo inteiro, frio e quente, sobre transcripts
// sintéticos. Sem dependências. Uso:
//
//   node bench/consumo.mjs [MB] [frios] [quentes] [--projetos=N] [--json]
//
// Padrão: 500 MB sintéticos na árvore de 216 transcripts (o mesmo volume e o
// mesmo gerador de bench/transcripts.mjs, para os números se compararem), 5
// rodadas frias e 20 quentes por cenário. --projetos=N (1 a 6, padrão 6)
// gera só N das 6 pastas de projeto: existe para o teste rápido do formato
// (test/bench-consumo.test.js); bench/rodar-todos.mjs usa o padrão. --json
// imprime um único objeto JSON (volume gerado, fixture e uma linha por
// medida, com `id` estável) no lugar do relatório em texto;
// bench/rodar-todos.mjs lê esse objeto.
//
// Metas da spec §9: /consumo quente <= 2 s, frio <= 15 s. Este script mede e
// confere as saídas; não trata as metas como falha.
//
// Cada rodada é um processo (bench/lib/consumo-rodada.mjs), medido do spawn à
// saída, como o Claude Code roda o CLI: carga dos módulos, estado.json,
// config.json, índice de transcripts e GitHub em paralelo, e o texto em
// Markdown. Frio = HADOUKEN_HOME novo a cada rodada (sem índice nem cache do
// GitHub: a primeira execução). Quente = a mesma pasta depois da primeira
// execução, com os dados sem mudança (índice pronto, cache do GitHub dentro
// do TTL; nada é regravado, então a segunda execução vale como qualquer
// outra quente). Uma rodada fria por cenário aquece e prepara a pasta
// quente, e é descartada; depois frias e quentes dos dois cenários rodam
// intercaladas, numa ordem aleatória única (Fisher-Yates), para que a
// deriva da máquina se espalhe por todas as linhas.
//
// Cenários:
// - com-repo (as linhas com meta no rodar-todos): config.json com 1 repo e o
//   executor falso do gh (bench/lib/gh-falso.mjs: 30 execuções, 3 jobs cada);
// - sem-repo: sem config.json; o origin é procurado com o git num cwd sem
//   repositório, então o GitHub não entra.
//
// Isolamento: tudo numa pasta temporária removida no fim. HADOUKEN_HOME de
// cada rodada aponta para dentro dela; a raiz dos transcripts vai em
// raizTranscripts; CLAUDE_CONFIG_DIR aponta para uma pasta inexistente dentro
// dela e as variáveis GIT_* de quem chama não passam, com
// GIT_CEILING_DIRECTORIES na pasta temporária (o git nunca sobe para um
// repositório de fora). O gh nunca é um processo e a rede nunca é usada. Os
// dados reais (~/.claude/hadouken, ~/.claude/projects) não são lidos nem
// gravados; cada rodada confere que leu todos os transcripts sintéticos.
//
// Conferências de cada rodada (qualquer falha encerra o bench com código 1):
// relatório ok; todos os transcripts sintéticos lidos; limites do estado.json
// presentes; com-repo: o repo com as 30 execuções e o uso de cache, e o gh
// chamado na fria e nunca na quente; sem-repo: nenhum repo e nenhuma chamada
// ao gh; o mesmo relatório (sha256) em todas as rodadas de um cenário, frias
// e quentes: o índice e o cache dão o mesmo resultado da leitura completa.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarGerador, ARQUIVOS_POR_PROJETO, MB, PROJETOS } from './lib/transcripts-sinteticos.mjs';
import { BYTES_CACHE_FALSO, CHAMADAS_FRIO, JOBS_POR_RUN, REPO_FALSO, RUNS_FALSOS } from './lib/gh-falso.mjs';

const USO = 'usage: node bench/consumo.mjs [MB] [cold runs] [warm runs] [--projetos=N] [--json]';
const OPCAO_PROJETOS = '--projetos=';
const argumentos = process.argv.slice(2);
const SAIDA_JSON = argumentos.includes('--json');
const opcoesProjetos = argumentos.filter((a) => a.startsWith(OPCAO_PROJETOS));
const posicionais = argumentos.filter((a) => a !== '--json' && !a.startsWith(OPCAO_PROJETOS));
const inteiroPositivo = (t, padrao) => (t === undefined ? padrao : /^[1-9]\d{0,3}$/.test(t) ? Number(t) : Number.NaN);
const alvoMB = posicionais[0] === undefined ? 500 : Number(posicionais[0]);
const N_FRIO = inteiroPositivo(posicionais[1], 5);
const N_QUENTE = inteiroPositivo(posicionais[2], 20);
const N_PROJETOS = opcoesProjetos.length > 1 ? Number.NaN : inteiroPositivo(opcoesProjetos[0]?.slice(OPCAO_PROJETOS.length), PROJETOS);
if (!Number.isFinite(alvoMB) || alvoMB <= 0 || !Number.isInteger(N_FRIO) || !Number.isInteger(N_QUENTE)
  || !Number.isInteger(N_PROJETOS) || N_PROJETOS > PROJETOS || posicionais.length > 3) {
  console.error(USO);
  process.exit(2);
}

const ALVO_QUENTE_MS = 2_000;
const ALVO_FRIO_MS = 15_000;
const PRAZO_RODADA_MS = 120_000;
const SESSOES_ESTADO = 50;
const ARQUIVOS = N_PROJETOS * ARQUIVOS_POR_PROJETO;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rodada = path.join(repo, 'bench', 'lib', 'consumo-rodada.mjs');
const importar = (arq) => import(pathToFileURL(path.join(repo, 'src', arq)).href);
const { atualizarEstado, ARQ_ESTADO, HISTORICO_MAX, HISTORICO_PASSO_MS } = await importar('estado.js');
const { ARQ_INDICE } = await importar('transcripts.js');
const { ARQ_CONFIG } = await importar('consumo.js');
const ARQ_CACHE_GITHUB = 'github-cache.json';

const log = SAIDA_JSON ? () => {} : (linha) => console.log(linha);
const ms = (t0) => Math.round(performance.now() - t0);
const mb = (n) => (n / MB).toFixed(1);

// Fisher-Yates numa cópia.
function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const quantil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)];
function resumo(lista) {
  const o = [...lista].sort((a, b) => a - b);
  const media = o.reduce((soma, x) => soma + x, 0) / o.length;
  return { n: o.length, min: o[0], p50: quantil(o, 0.5), media, p95: quantil(o, 0.95), max: o[o.length - 1] };
}

const agora = Date.now();
// realpath: o caminho longo no Windows (sem 8.3), o mesmo que o git vê como
// cwd, para que GIT_CEILING_DIRECTORIES case com ele.
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench consumo ')));
let resultado = null;
try {
  const raiz = path.join(tmp, 'projects');
  const cwdSemOrigin = path.join(tmp, 'cwd sem origin');
  fs.mkdirSync(cwdSemOrigin);

  const t0 = performance.now();
  const { arquivos, bytes } = criarGerador(agora).gerarArvore(raiz, alvoMB * MB, N_PROJETOS);
  const msGeracao = ms(t0);
  if (arquivos !== ARQUIVOS) throw new Error(`gerador: ${arquivos} transcripts, esperado ${ARQUIVOS}`);
  log(`node ${process.version} ${process.platform}; generated ${arquivos} transcripts, ${mb(bytes)} MB in ${msGeracao} ms`);

  // estado.json do pior caso (50 sessões, o teto) com as duas janelas; a de
  // 7 dias reinicia em 1 h, então a semana começa há 6 dias e 23 h e cobre
  // todas as linhas sintéticas, como a janela de 7 dias do bench de
  // transcripts.
  const modelo = path.join(tmp, 'modelo');
  const s = Math.floor(agora / 1000);
  const entrada = (i) => ({
    session_id: `${i.toString(16).padStart(8, '0')}-1111-2222-3333-444455556666`,
    cwd: 'C:/projetos/proj x',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    effort: { level: 'high' },
    context_window: { used_percentage: 31, total_input_tokens: 62000, total_output_tokens: 9000, context_window_size: 200000 },
    prompt_cache: { hit_ratio: 0.9749 },
    rate_limits: { five_hour: { used_percentage: 42, resets_at: s + 3600 }, seven_day: { used_percentage: 61, resets_at: s + 3600 } },
  });
  const homeAntes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = modelo;
  try {
    for (let i = SESSOES_ESTADO - 1; i >= 0; i--) {
      const r = atualizarEstado(entrada(i), agora - i * 1000);
      if (!r.ok) throw new Error(`fixture: estado.json não gravado (${r.motivo})`);
    }
  } finally {
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
  const estadoModelo = path.join(modelo, ARQ_ESTADO);
  // Histórico cheio (spec v0.2.0 §12.8), como no bench da barra: 90 pontos a
  // 2 min um do outro, o mais novo há 30 s. O /consumo lê o estado.json
  // inteiro, então o pior caso dele também leva o histórico. A seção de
  // sessões abertas (§12.6) é mais uma passada linear sobre o mesmo índice,
  // medida aqui com qualquer número de sessões na última hora.
  const cheio = JSON.parse(fs.readFileSync(estadoModelo, 'utf8'));
  cheio.historico = Array.from({ length: HISTORICO_MAX }, (_, k) => {
    const i = HISTORICO_MAX - 1 - k;
    return { at: new Date(agora - 30_000 - i * HISTORICO_PASSO_MS).toISOString(), h5: 42 - i * 0.25, d7: 61 - i * 0.07 };
  });
  fs.writeFileSync(estadoModelo, JSON.stringify(cheio, null, 2));
  const bytesEstado = fs.statSync(estadoModelo).size;

  // Ambiente das rodadas: o de quem chama, sem GIT_*, CLAUDE_CONFIG_DIR e
  // HADOUKEN_HOME (a chave comparada em maiúsculas: o Windows não distingue).
  const claudeInexistente = path.join(tmp, 'claude-config-inexistente');
  const ambienteBase = {};
  for (const [k, v] of Object.entries(process.env)) {
    const K = k.toUpperCase();
    if (K.startsWith('GIT_') || K === 'CLAUDE_CONFIG_DIR' || K === 'HADOUKEN_HOME') continue;
    ambienteBase[k] = v;
  }
  ambienteBase.CLAUDE_CONFIG_DIR = claudeInexistente;
  ambienteBase.GIT_CEILING_DIRECTORIES = tmp;

  const cenarios = [
    { id: 'com-repo', config: true },
    { id: 'sem-repo', config: false },
  ].map((c) => ({ ...c, homeQuente: path.join(tmp, `quente ${c.id}`), sha256: null, tempos: { frio: [], quente: [] } }));

  function prepararHome(home, c) {
    fs.mkdirSync(home);
    fs.copyFileSync(estadoModelo, path.join(home, ARQ_ESTADO));
    if (c.config) fs.writeFileSync(path.join(home, ARQ_CONFIG), `${JSON.stringify({ repos: [REPO_FALSO] })}\n`);
  }

  function conferir(c, fase, home, v) {
    const falha = (m) => { throw new Error(`${c.id} ${fase}: ${m}`); };
    if (v === null || typeof v !== 'object') falha('saída sem JSON');
    if (v.ok !== true) falha(`relatório falhou (${v.motivo})`);
    if (v.arquivos !== ARQUIVOS) falha(`${v.arquivos} transcripts lidos, esperado ${ARQUIVOS}`);
    if (!(v.respostasSemana > 0) || v.semanaOrigem !== 'janela_7d' || v.limites !== true) falha('semana ou limites fora do esperado');
    if (!(v.bytesTexto > 0)) falha('texto em Markdown vazio');
    if (c.config) {
      if (v.repos.length !== 1 || v.repos[0] !== REPO_FALSO) falha(`repos ${JSON.stringify(v.repos)}`);
      if (v.runs30 !== RUNS_FALSOS || v.bytesCache !== BYTES_CACHE_FALSO || !(v.minutosPonderados > 0)) falha('resumo do GitHub fora do esperado');
      const esperadas = fase === 'frio' ? CHAMADAS_FRIO : 0;
      if (v.chamadasGh !== esperadas) falha(`${v.chamadasGh} chamadas ao gh, esperado ${esperadas}`);
      if (!fs.existsSync(path.join(home, ARQ_CACHE_GITHUB))) falha('cache do GitHub não gravado');
    } else if (v.repos.length !== 0 || v.chamadasGh !== 0) {
      falha(`GitHub consultado sem repo (${v.repos.length} repos, ${v.chamadasGh} chamadas)`);
    }
    if (!fs.existsSync(path.join(home, ARQ_INDICE))) falha('índice não gravado');
    if (c.sha256 === null) c.sha256 = v.sha256;
    else if (v.sha256 !== c.sha256) falha('relatório diferente das outras rodadas do cenário');
  }

  function rodar(c, fase, home) {
    const t = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [rodada, c.id, raiz, cwdSemOrigin, String(agora)], {
      cwd: cwdSemOrigin, env: { ...ambienteBase, HADOUKEN_HOME: home }, encoding: 'utf8', timeout: PRAZO_RODADA_MS, windowsHide: true,
    });
    const tempo = Number(process.hrtime.bigint() - t) / 1e6;
    if (r.error) throw new Error(`${c.id} ${fase}: ${r.error.code ?? r.error.message}`);
    if (r.status !== 0 || r.stderr !== '') throw new Error(`${c.id} ${fase}: status ${r.status}, stderr ${JSON.stringify(r.stderr.slice(0, 2000))}`);
    let v = null;
    try { v = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* conferir acusa */ }
    conferir(c, fase, home, v);
    return tempo;
  }

  // Aquecimento: a primeira execução (fria) na pasta quente de cada
  // cenário, descartada; ela deixa o índice e o cache do GitHub prontos.
  for (const c of cenarios) {
    prepararHome(c.homeQuente, c);
    rodar(c, 'frio', c.homeQuente);
  }
  const tarefas = [];
  for (const c of cenarios) {
    for (let i = 0; i < N_FRIO; i++) tarefas.push({ c, fase: 'frio' });
    for (let i = 0; i < N_QUENTE; i++) tarefas.push({ c, fase: 'quente' });
  }
  let seqFrio = 0;
  for (const { c, fase } of embaralhar(tarefas)) {
    if (fase === 'quente') {
      c.tempos.quente.push(rodar(c, fase, c.homeQuente));
      continue;
    }
    const home = path.join(tmp, `frio ${seqFrio++}`);
    prepararHome(home, c);
    c.tempos.frio.push(rodar(c, fase, home));
    fs.rmSync(home, { recursive: true, force: true });
  }

  const [comRepo, semRepo] = cenarios;
  const linhas = [
    { id: 'frio', cenario: comRepo, fase: 'frio', nome: 'cold (fresh HADOUKEN_HOME), repo + fake gh' },
    { id: 'quente', cenario: comRepo, fase: 'quente', nome: 'warm (unchanged data), repo + fake gh' },
    { id: 'frio-sem-repo', cenario: semRepo, fase: 'frio', nome: 'cold, no repo (git in a cwd without origin)' },
    { id: 'quente-sem-repo', cenario: semRepo, fase: 'quente', nome: 'warm, no repo (git in a cwd without origin)' },
  ].map((l) => ({ id: l.id, cenario: l.cenario.id, nome: l.nome, alvoMs: l.fase === 'frio' ? ALVO_FRIO_MS : ALVO_QUENTE_MS, ...resumo(l.cenario.tempos[l.fase]) }));

  const fmt = (x) => x.toFixed(1).padStart(8);
  log(`fixture: estado.json with ${SESSOES_ESTADO} sessions and ${HISTORICO_MAX} history points (${bytesEstado} B); fake gh: ${RUNS_FALSOS} runs x ${JOBS_POR_RUN} jobs, ${CHAMADAS_FRIO} calls when cold`);
  log(`runs: ${N_FRIO} cold and ${N_QUENTE} warm per scenario, interleaved in random order after 1 discarded cold warm-up run per scenario; spawn to exit`);
  for (const l of linhas) {
    const veredito = l.p95 <= l.alvoMs ? 'within target' : 'OVER target';
    log(`${l.nome.padEnd(45)} n=${String(l.n).padStart(2)}  min=${fmt(l.min)}  p50=${fmt(l.p50)}  mean=${fmt(l.media)}  p95=${fmt(l.p95)}  max=${fmt(l.max)} ms  target p95 <= ${l.alvoMs} ms: ${veredito}`);
  }
  log('targets (spec 9): /consumo warm <= 2 s, cold <= 15 s; reported, not asserted');
  resultado = {
    alvoQuenteMs: ALVO_QUENTE_MS,
    alvoFrioMs: ALVO_FRIO_MS,
    rodadasFrio: N_FRIO,
    rodadasQuente: N_QUENTE,
    aquecimento: 1,
    projetos: N_PROJETOS,
    arquivos,
    bytesGerados: bytes,
    msGeracao,
    fixture: { sessoes: SESSOES_ESTADO, historico: HISTORICO_MAX, bytesEstado },
    github: { repo: REPO_FALSO, runs: RUNS_FALSOS, jobsPorRun: JOBS_POR_RUN, chamadasFrio: CHAMADAS_FRIO },
    linhas,
  };
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  const removido = !fs.existsSync(tmp);
  log(`temp dir removed: ${removido}`);
  // Só depois de uma execução completa: uma falha deixa a exceção no stderr e nenhum JSON.
  if (SAIDA_JSON && resultado !== null) {
    console.log(JSON.stringify({ bench: 'consumo', plataforma: process.platform, node: process.version, ...resultado, tmpRemovido: removido }));
  }
}

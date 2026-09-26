import { execFile } from 'node:child_process';
import path from 'node:path';
import { dirDados, gravarJsonAtomico, instante, lerJson } from './estado.js';

// Leitor do consumo de GitHub Actions para o /consumo (spec 6.7; 8.1 S2, S5,
// S9; addendum de segurança da Task 9). O plugin existe para economizar
// GitHub, então este módulo é parcimonioso: no máximo 3 repos e 2 páginas de
// execuções por chamada, jobs só de execução nova (os de execução concluída
// ficam em cache), orçamento de 60 chamadas de jobs, prazo total (o gh que
// passa dele é morto) e cache de 15 min em que nenhuma chamada é feita.
//
// Tudo o que vem do GitHub é não confiável: cada resposta passa por
// JSON.parse protegido e por um schema; só saem números validados e rótulos
// de listas fixas. Nome de execução, branch, mensagem de commit, ator e o
// texto do stderr do gh nunca são lidos para a saída nem para o cache. O
// token é do gh: este módulo nunca o lê, registra ou guarda.

const MIN_MS = 60_000;
const DIA_MS = 86_400_000;
const JANELA7_MS = 7 * DIA_MS;
const JANELA30_MS = 30 * DIA_MS;
const TTL_MS = 15 * MIN_MS;
// Tolerância para relógio adiantado, a mesma de estado.instante.
const FUTURO_MAX_MS = 5 * MIN_MS;
// Entrada do cache sem atualização há mais que isto sai do arquivo.
const VISTO_MAX_MS = 31 * DIA_MS;
const LIMITE_CACHE = 10_737_418_240;

const ARQ_CACHE = 'github-cache.json';
// Versão 2: pesos por preço, rótulos arm/Intel classificados e o balde
// naoClassificado. Um arquivo da versão 1 é descartado inteiro, porque as
// execuções guardadas nele foram classificadas pelos rótulos antigos.
const VERSAO_CACHE = 2;
const CACHE_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_MAX_REPOS = 20;

// Da lista de repos só as 20 primeiras entradas são examinadas, e só 3 repos
// distintos são consultados por chamada.
const MAX_ENTRADAS = 20;
const MAX_REPOS = 3;
const POR_PAGINA = 100;
const MAX_PAGINAS = 2;
const MAX_RUNS = MAX_PAGINAS * POR_PAGINA;
// Chamadas de jobs por coleta, divididas entre os repos que precisam de
// atualização; o que sobra fica `pendentes` para a próxima coleta.
const ORCAMENTO_JOBS = 60;
// 10 s: a Task 10 roda esta coleta em paralelo com o índice de transcripts e
// o /consumo frio tem meta de 15 s (spec 9). O que não couber fica em
// `pendentes`/`truncado` e o cache de jobs completa nas coletas seguintes.
const PRAZO_PADRAO_MS = 10_000;
const PRAZO_MAX_MS = 600_000;

// Um job do GitHub dura no máximo 6 h; uma resposta de jobs traz até 100.
const MAX_JOB_MIN = 360;
const MAX_JOBS_RUN = POR_PAGINA;
const MAX_MIN_RUN = MAX_JOBS_RUN * MAX_JOB_MIN;
const MAX_MIN_REPO = MAX_RUNS * MAX_MIN_RUN;
const MAX_JOBS_REPO = MAX_RUNS * MAX_JOBS_RUN;
const MAX_TENTATIVA = 1_000_000;
const MAX_LABELS = 64;
const MAX_LABEL = 64;
// Um instante ISO tem 20 a 24 caracteres; texto maior nem vai ao Date.parse.
const MAX_TS = 64;

// "Agora" plausível: de 2018 (antes do GitHub Actions existir não há o que
// ler) até o fim do ano 9999, para que toda data derivada tenha 4 dígitos.
const AGORA_MIN = Date.UTC(2018, 0, 1);
const AGORA_MAX = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

const TIMEOUT_PADRAO_MS = 15_000;
const TIMEOUT_MAX_MS = 600_000;
const SAIDA_MAX = 8 * 1024 * 1024;
const SAIDA_MAX_TETO = 64 * 1024 * 1024;
const STDERR_EXAMINADO = 65_536;

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const ID_RUN = /^[1-9]\d{0,15}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HTTP = /^HTTP [1-5]\d\d$/;

const EVENTOS = Object.freeze(['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_run', 'merge_group', 'release', 'repository_dispatch', 'dynamic']);
const CONCLUSOES = Object.freeze(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure']);
const CHAVES_EVENTO = Object.freeze([...EVENTOS, 'outro']);
const CHAVES_CONCLUSAO = Object.freeze([...CONCLUSOES, 'em_andamento', 'outro']);

// Rótulos dos runners hospedados padrão, uma regex ancorada por família, da
// tabela oficial (docs.github.com/en/actions/reference/runners/github-hosted-runners,
// lida em 2026-09-25):
// - Linux: ubuntu-latest, ubuntu-NN.NN (x64) e ubuntu-NN.NN-arm (arm64);
// - Windows: windows-latest, windows-NNNN, windows-2025-vs2026 (x64) e
//   windows-11-arm, windows-11-vs2026-arm (arm64);
// - macOS: macos-latest, macos-NN (M1), macos-NN-intel e xcode-NN (M1).
// Fora da estimativa (balde naoClassificado, peso 0, contado à parte):
// self-hosted, ubuntu-slim (1 núcleo, preço próprio), runners maiores e
// qualquer rótulo próprio ou desconhecido.
const ROTULOS = Object.freeze([
  ['linux', /^ubuntu-(?:latest|\d{2}\.\d{2}(?:-arm)?)$/],
  ['windows', /^windows-(?:latest|\d{4}(?:-vs\d{4})?|11(?:-vs\d{4})?-arm)$/],
  ['macos', /^(?:macos-(?:latest|\d{2}(?:-intel)?)|xcode-\d{2})$/],
]);

// Motivos que o executor pode devolver; qualquer outro texto vira 'gh falhou'.
const MOTIVOS_EXECUTOR = new Set(['gh ausente', 'gh sem login', 'tempo esgotado', 'limite da API', 'resposta grande', 'resposta inválida', 'gh falhou']);
// Depois de um destes nenhuma chamada nova é feita nesta coleta: insistir não
// adianta (sem gh, sem login, rede travada) ou piora (limite da API).
const FATAIS = new Set(['gh ausente', 'gh sem login', 'tempo esgotado', 'limite da API']);

// Variáveis que mudariam a saída ou o comportamento do gh (cor, TTY forçado,
// depuração no stderr, prompts, aviso de versão, que faz uma requisição a
// mais). Removidas sem diferenciar maiúsculas: no Windows o ambiente não
// diferencia, e duas grafias da mesma chave deixariam a escolha ao acaso.
const AMBIENTE_REMOVIDO = new Set(['gh_force_tty', 'clicolor_force', 'gh_debug', 'msys_no_pathconv', 'gh_no_update_notifier', 'gh_prompt_disabled', 'no_color']);
const AMBIENTE_FIXO = Object.freeze({ MSYS_NO_PATHCONV: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' });

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const proprio = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const inteiroEntre = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const daLista = (v, lista) => (typeof v === 'string' && lista.includes(v) ? v : null);
const falha = (motivo) => ({ ok: false, motivo });
const iso = (ms) => new Date(ms).toISOString();

// Peso por sistema = preço por minuto do runner padrão sobre o do Linux
// 2-core x64, com 2 casas. A documentação atual não tem mais tabela de
// multiplicadores: remete os "minute multipliers" à tabela de custo por
// minuto (https://docs.github.com/en/actions/concepts/billing-and-usage).
// Preços: https://docs.github.com/en/billing/reference/actions-runner-pricing
// (lidos em 2026-09-25):
//   Linux 2-core x64   $0.006  -> 1
//   Linux 2-core arm64 $0.005  -> 1 (pesado como x64: superestima 20 %, o
//                                    lado seguro para um alerta de consumo)
//   Windows 2-core x64 e arm64 $0.010 -> 1,67
//   macOS 3/4-core (M1 ou Intel) $0.062 -> 10,33
// Em centésimos, para que o ponderado seja somado em inteiros e saia com no
// máximo 2 casas, sem resíduo de ponto flutuante. Switch, não tabela: nenhum
// nome herdado de Object.prototype vira peso.
function pesoCentesimos(sistema) {
  switch (sistema) {
    case 'linux': return 100;
    case 'windows': return 167;
    case 'macos': return 1033;
    default: return 0;
  }
}

// Peso do sistema (1, 1.67 ou 10.33); 0 para qualquer outra coisa.
export function pesoSistema(sistema) {
  return pesoCentesimos(sistema) / 100;
}

// Sistema do job pelos rótulos: 'self-hosted' se algum rótulo for
// self-hosted; senão o mais caro entre os rótulos hospedados conhecidos (um
// job com windows-latest e macos-14 vai para macOS); senão 'self-hosted'
// (addendum B: rótulo desconhecido vira 'self-hosted', peso 0; no resumo o
// balde se chama naoClassificado). Examina só os 64 primeiros rótulos, cada
// um com até 64 caracteres, em minúsculas. Entrada que não é lista, ou que
// lança, vira 'self-hosted'.
export function sistemaDoJob(labels) {
  try {
    if (!Array.isArray(labels)) return 'self-hosted';
    let melhor = null;
    const n = Math.min(labels.length, MAX_LABELS);
    for (let i = 0; i < n; i++) {
      const rotulo = labels[i];
      if (typeof rotulo !== 'string' || rotulo.length > MAX_LABEL) continue;
      const r = rotulo.toLowerCase();
      if (r === 'self-hosted') return 'self-hosted';
      for (const [sistema, padrao] of ROTULOS) {
        if (padrao.test(r) && (melhor === null || pesoCentesimos(sistema) > pesoCentesimos(melhor))) melhor = sistema;
      }
    }
    return melhor ?? 'self-hosted';
  } catch {
    return 'self-hosted';
  }
}

const tempo = (v) => (typeof v === 'string' && v.length <= MAX_TS ? Date.parse(v) : Number.NaN);

// Minutos de um job: arredonda para cima, com teto de 6 h (o limite do
// GitHub para um job). 0 se faltar um instante, se algum não for texto de
// data, se o fim não vier depois do início ou se a entrada não for objeto.
export function minutosJob(job) {
  try {
    if (job === null || typeof job !== 'object') return 0;
    const inicio = tempo(job.started_at);
    const fim = tempo(job.completed_at);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) return 0;
    return Math.min(Math.ceil((fim - inicio) / MIN_MS), MAX_JOB_MIN);
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------ executor

function ambienteGh() {
  const env = Object.create(null);
  for (const [k, v] of Object.entries(process.env)) {
    if (!AMBIENTE_REMOVIDO.has(k.toLowerCase())) env[k] = v;
  }
  return Object.assign(env, AMBIENTE_FIXO);
}

// Erro do execFile para um motivo fixo. O stderr só é examinado por padrões;
// o texto dele nunca sai daqui.
function motivoDoErro(erro, stderr) {
  const codigo = erro?.code;
  if (codigo === 'ENOENT') return 'gh ausente';
  if (codigo === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'resposta grande';
  // Abort pelo prazo da coleta; `killed` cobre o timeout do próprio executor.
  if (codigo === 'ABORT_ERR') return 'tempo esgotado';
  if (erro?.killed === true) return 'tempo esgotado';
  // Código 4 é o do gh para "precisa de login".
  if (codigo === 4) return 'gh sem login';
  const texto = typeof stderr === 'string' ? stderr.slice(0, STDERR_EXAMINADO) : '';
  if (/rate limit/i.test(texto)) return 'limite da API';
  const http = /\(HTTP (\d{3})\)/.exec(texto);
  if (http !== null) {
    if (http[1] === '401') return 'gh sem login';
    if (http[1] === '429') return 'limite da API';
    if (HTTP.test(`HTTP ${http[1]}`)) return `HTTP ${http[1]}`;
  }
  return 'gh falhou';
}

const textoSeguro = (v) => typeof v === 'string' && v.length > 0 && !v.includes('\0');

function opcoesExecutor(opcoes) {
  const o = { executavel: 'gh', timeoutMs: TIMEOUT_PADRAO_MS, maxBuffer: SAIDA_MAX, cwd: undefined };
  try {
    if (opcoes === null || typeof opcoes !== 'object') return o;
    const { executavel, timeoutMs, maxBuffer, cwd } = opcoes;
    if (textoSeguro(executavel)) o.executavel = executavel;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= TIMEOUT_MAX_MS) o.timeoutMs = timeoutMs;
    if (inteiroEntre(maxBuffer, 1, SAIDA_MAX_TETO)) o.maxBuffer = maxBuffer;
    if (textoSeguro(cwd)) o.cwd = cwd;
    return o;
  } catch {
    return { executavel: 'gh', timeoutMs: TIMEOUT_PADRAO_MS, maxBuffer: SAIDA_MAX, cwd: undefined };
  }
}

// Só um AbortSignal de verdade chega ao execFile; qualquer outra coisa é
// ignorada (o execFile lançaria com um objeto que só parece um sinal).
function sinalValido(sinal) {
  try {
    return sinal instanceof AbortSignal ? sinal : undefined;
  } catch {
    return undefined;
  }
}

// Executor do gh: `execFile`, nunca um shell; argumentos passados como lista,
// literais. Timeout de 15 s, saída de até 8 MB, janela oculta no Windows,
// stdin fechado, ambiente com MSYS_NO_PATHCONV=1 e sem variáveis que mudem a
// saída. Recebe (args, sinal): abortar o sinal (o prazo da coleta) mata o gh
// com SIGKILL, e a promessa só resolve depois que o processo saiu, para que
// nenhum gh sobreviva à coleta; sinal já abortado nem inicia o processo.
// Devolve { ok: true, stdout } ou { ok: false, motivo } com motivo de uma
// lista fixa. Nunca rejeita. As opções existem para os testes, que usam o
// próprio node (ou um nome inexistente) no lugar do gh e um diretório
// temporário como cwd.
export function criarExecutorGh(opcoes) {
  const { executavel, timeoutMs, maxBuffer, cwd } = opcoesExecutor(opcoes);
  return (args, sinal) => new Promise((resolve) => {
    try {
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
        resolve(falha('gh falhou'));
        return;
      }
      const signal = sinalValido(sinal);
      if (signal?.aborted) {
        resolve(falha('tempo esgotado'));
        return;
      }
      // O gh só lê; SIGKILL garante que ele morra no timeout ou no abort,
      // mesmo que ignore SIGTERM (no Windows todo sinal é TerminateProcess).
      const filho = execFile(executavel, [...args], {
        env: ambienteGh(), timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: 'utf8', shell: false,
        killSignal: 'SIGKILL', signal, ...(cwd === undefined ? {} : { cwd }),
      }, (erro, stdout, stderr) => {
        if (!erro) {
          resolve(typeof stdout === 'string' ? { ok: true, stdout } : falha('gh falhou'));
          return;
        }
        const r = falha(motivoDoErro(erro, stderr));
        // No abort o execFile chama de volta assim que manda o sinal, antes de
        // o processo sair; espera a saída para não deixar um gh vivo.
        if (erro.code === 'ABORT_ERR' && filho.exitCode === null && filho.signalCode === null) filho.once('exit', () => resolve(r));
        else resolve(r);
      });
      filho.stdin?.on('error', () => { /* o filho pode já ter saído */ });
      filho.stdin?.end();
    } catch {
      resolve(falha('gh falhou'));
    }
  });
}

const ghPadrao = criarExecutorGh();

// ------------------------------------------------------------- chamadas à API

// Resposta de um executor (injetado ou não) para { ok: true, valor } com o
// JSON já lido, ou { ok: false, motivo } com motivo fixo. Um executor que
// devolve lixo, ou um motivo fora da lista, vira 'gh falhou'.
function normalizar(res) {
  try {
    if (res === null || typeof res !== 'object') return falha('gh falhou');
    const ok = res.ok;
    if (ok === true) {
      const stdout = res.stdout;
      if (typeof stdout !== 'string') return falha('resposta inválida');
      if (stdout.length > SAIDA_MAX || Buffer.byteLength(stdout, 'utf8') > SAIDA_MAX) return falha('resposta grande');
      try { return { ok: true, valor: JSON.parse(stdout) }; } catch { return falha('resposta inválida'); }
    }
    if (ok !== false) return falha('gh falhou');
    const motivo = res.motivo;
    if (motivo === 'HTTP 401') return falha('gh sem login');
    if (motivo === 'HTTP 429') return falha('limite da API');
    if (typeof motivo === 'string' && (MOTIVOS_EXECUTOR.has(motivo) || HTTP.test(motivo))) return falha(motivo);
    return falha('gh falhou');
  } catch {
    return falha('gh falhou');
  }
}

const PRAZO = Symbol('prazo');

// Chama o executor dentro de uma função async: um throw síncrono vira
// rejeição, que o race abaixo captura.
const invocar = async (gh, endpoint, sinal) => gh(['api', endpoint], sinal);

// Uma chamada: sempre ['api', endpoint], endpoint relativo montado só com o
// repo validado, segmentos fixos e números. Depois de um motivo fatal ou do
// prazo, não chama mais nada. Cada chamada leva o próprio AbortSignal; a que
// passa do prazo é abandonada e o sinal é abortado, o que faz o executor
// padrão matar o gh. Assim a coleta nunca dura mais que o prazo e nenhum gh
// fica vivo depois dela. Um executor injetado pode ignorar o sinal.
async function chamar(ctx, endpoint) {
  if (ctx.fatal !== null) return falha(ctx.fatal);
  const resta = ctx.fim - performance.now();
  if (resta <= 0) {
    ctx.fatal = 'tempo esgotado';
    return falha(ctx.fatal);
  }
  ctx.chamou = true;
  const abortador = new AbortController();
  let relogio;
  const prazo = new Promise((resolve) => { relogio = setTimeout(resolve, resta, PRAZO); });
  let r;
  try {
    const res = await Promise.race([invocar(ctx.gh, endpoint, abortador.signal), prazo]);
    if (res === PRAZO) {
      abortador.abort();
      r = falha('tempo esgotado');
    } else {
      r = normalizar(res);
    }
  } catch {
    r = falha('gh falhou');
  } finally {
    clearTimeout(relogio);
  }
  if (!r.ok && FATAIS.has(r.motivo)) ctx.fatal = r.motivo;
  return r;
}

// `desde` não é literal fixo, mas é derivado: sai só de um agoraMs validado
// (agoraValido) e é conferido por DATA (^\d{4}-\d{2}-\d{2}$) antes de uso, o
// que cabe no "números e literais fixos" do addendum A (revisão da Task 9,
// item 9).
const epRuns = (repo, pagina, desde) => `repos/${repo}/actions/runs?per_page=${POR_PAGINA}&page=${pagina}&exclude_pull_requests=true&created=%3E%3D${desde}`;
const epJobs = (repo, id) => `repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=${POR_PAGINA}`;
const epUso = (repo) => `repos/${repo}/actions/cache/usage`;
const epRepo = (repo) => `repos/${repo}`;

// --------------------------------------------------------- leitura das respostas

function lerPagina(v) {
  if (!ehObjeto(v)) return null;
  const total = proprio(v, 'total_count');
  const runs = proprio(v, 'workflow_runs');
  if (!inteiroEntre(total, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(runs) || runs.length > POR_PAGINA) return null;
  return { total, runs };
}

// Só id, created_at, event, status, conclusion, run_attempt e
// repository.private; o resto da execução nunca é lido.
function lerRun(r, agoraMs, desde30) {
  if (!ehObjeto(r)) return null;
  const id = proprio(r, 'id');
  if (!inteiroEntre(id, 1, Number.MAX_SAFE_INTEGER)) return null;
  const t = instante(proprio(r, 'created_at'), agoraMs);
  if (t === null || t < desde30) return null;
  const status = proprio(r, 'status');
  const conclusao = proprio(r, 'conclusion');
  const tentativa = proprio(r, 'run_attempt');
  const repo = proprio(r, 'repository');
  const privado = ehObjeto(repo) ? proprio(repo, 'private') : undefined;
  return {
    id,
    t,
    evento: daLista(proprio(r, 'event'), EVENTOS) ?? 'outro',
    concluido: status === 'completed',
    conclusao: daLista(conclusao, CONCLUSOES) ?? (conclusao === null && status !== 'completed' ? 'em_andamento' : 'outro'),
    a: inteiroEntre(tentativa, 1, MAX_TENTATIVA) ? tentativa : 1,
    privado: typeof privado === 'boolean' ? privado : null,
  };
}

// Minutos de uma execução por sistema (l, w, m), jobs e minutos fora da
// estimativa (s, sm) e x = 1 quando a execução tem mais jobs que a resposta.
function lerJobs(v) {
  if (!ehObjeto(v)) return null;
  const total = proprio(v, 'total_count');
  const jobs = proprio(v, 'jobs');
  if (!inteiroEntre(total, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(jobs) || jobs.length > MAX_JOBS_RUN) return null;
  const e = { l: 0, w: 0, m: 0, s: 0, sm: 0, x: total > jobs.length ? 1 : 0 };
  for (const job of jobs) {
    if (!ehObjeto(job)) continue;
    const minutos = minutosJob(job);
    const sistema = sistemaDoJob(proprio(job, 'labels'));
    if (sistema === 'linux') e.l += minutos;
    else if (sistema === 'windows') e.w += minutos;
    else if (sistema === 'macos') e.m += minutos;
    else { e.s++; e.sm += minutos; }
  }
  return e;
}

function lerPublico(v) {
  if (!ehObjeto(v)) return null;
  const privado = proprio(v, 'private');
  if (typeof privado === 'boolean') return !privado;
  const visibilidade = proprio(v, 'visibility');
  if (visibilidade === 'public') return true;
  if (visibilidade === 'private' || visibilidade === 'internal') return false;
  return null;
}

function lerBytes(v) {
  if (!ehObjeto(v)) return null;
  const bytes = proprio(v, 'active_caches_size_in_bytes');
  return inteiroEntre(bytes, 0, Number.MAX_SAFE_INTEGER) ? bytes : null;
}

// ------------------------------------------------------------------ resumo

// Contagens por chave de lista fixa, em objeto comum: nenhuma chave vem do
// GitHub, só de EVENTOS/CONCLUSOES ou dos rótulos 'outro' e 'em_andamento'.
function contar(mapa, chave) {
  mapa[chave] = (mapa[chave] ?? 0) + 1;
}

function montar({ publico, runs7, runs30, conclusoes30, minutos, bytes, totalApi30, truncado, pendentes }) {
  return {
    publico,
    runs7,
    runs30,
    minutos30: minutos === null
      ? { linux: null, windows: null, macos: null, ponderado: null }
      : { linux: minutos.l, windows: minutos.w, macos: minutos.m, ponderado: ponderar(minutos.l, minutos.w, minutos.m) },
    cache: { bytes, limiteBytes: LIMITE_CACHE },
    conclusoes30,
    naoClassificado: minutos === null ? { jobs: null, minutos: null } : { jobs: minutos.s, minutos: minutos.sm },
    totalApi30,
    truncado,
    pendentes,
  };
}

// Minutos ponderados, somados em centésimos inteiros (exatos: o teto de
// minutos por repo vezes 1033 fica muito abaixo de 2^53) e divididos uma vez,
// para sair com no máximo 2 casas.
const ponderar = (l, w, m) => (l * pesoCentesimos('linux') + w * pesoCentesimos('windows') + m * pesoCentesimos('macos')) / 100;

// Atualiza um repo. Ordem: execuções (página 1, e a 2 só se o total passar
// de 100), visibilidade (só se nenhuma execução a trouxer), uso de cache e
// jobs das execuções sem cache válido, das mais novas para as mais velhas,
// até o orçamento. Sem diretório de dados: só a página 1, sem cache.
async function atualizarRepo(ctx, nome, anterior, orcamento) {
  const { agoraMs, comCache } = ctx;
  const p1 = await chamar(ctx, epRuns(nome, 1, ctx.desde));
  if (!p1.ok) return { saida: { indisponivel: p1.motivo }, entrada: null, gastos: 0 };
  const pagina1 = lerPagina(p1.valor);
  if (pagina1 === null) return { saida: { indisponivel: 'resposta inválida' }, entrada: null, gastos: 0 };

  let completo = true;
  let truncado = false;
  const brutos = [...pagina1.runs];
  const totalApi30 = pagina1.total;
  if (totalApi30 > POR_PAGINA && pagina1.runs.length === POR_PAGINA) {
    const p2 = comCache ? await chamar(ctx, epRuns(nome, 2, ctx.desde)) : null;
    const pagina2 = p2?.ok ? lerPagina(p2.valor) : null;
    if (pagina2 === null) {
      truncado = true;
      if (comCache) completo = false;
    } else {
      brutos.push(...pagina2.runs);
      if (totalApi30 > MAX_RUNS) truncado = true;
    }
  }

  const desde30 = agoraMs - JANELA30_MS;
  const desde7 = agoraMs - JANELA7_MS;
  const runs = [];
  const ids = new Set();
  let publico = null;
  for (const bruto of brutos) {
    const run = lerRun(bruto, agoraMs, desde30);
    if (run === null || ids.has(run.id)) continue;
    ids.add(run.id);
    runs.push(run);
    if (publico === null && run.privado !== null) publico = !run.privado;
  }
  const runs7 = { total: 0, porEvento: {} };
  const runs30 = { total: 0, porEvento: {} };
  const conclusoes30 = {};
  for (const run of runs) {
    runs30.total++;
    contar(runs30.porEvento, run.evento);
    if (run.t >= desde7) {
      runs7.total++;
      contar(runs7.porEvento, run.evento);
    }
    contar(conclusoes30, run.conclusao);
  }
  const base = { publico, runs7, runs30, conclusoes30, totalApi30 };
  // Sem diretório de dados os minutos não são lidos: o resumo é parcial.
  if (!comCache) return { saida: montar({ ...base, truncado: truncado || runs.length > 0, minutos: null, bytes: null, pendentes: runs.length }), entrada: null, gastos: 0 };

  if (publico === null) {
    const v = await chamar(ctx, epRepo(nome));
    publico = v.ok ? lerPublico(v.valor) : null;
    if (publico === null) completo = false;
  }
  const u = await chamar(ctx, epUso(nome));
  const bytes = u.ok ? lerBytes(u.valor) : null;
  if (bytes === null) completo = false;

  const cacheRuns = new Map(anterior?.runs ?? []);
  const minutos = { l: 0, w: 0, m: 0, s: 0, sm: 0 };
  let pendentes = 0;
  let gastos = 0;
  for (const run of [...runs].sort((a, b) => b.t - a.t)) {
    let e = run.concluido ? cacheRuns.get(run.id) : undefined;
    if (e !== undefined && e.a !== run.a) e = undefined;
    if (e === undefined) {
      if (gastos >= orcamento) { pendentes++; continue; }
      gastos++;
      const j = await chamar(ctx, epJobs(nome, run.id));
      const lido = j.ok ? lerJobs(j.valor) : null;
      if (lido === null) { pendentes++; continue; }
      e = { t: run.t, a: run.a, ...lido };
      if (run.concluido) cacheRuns.set(run.id, e);
    }
    minutos.l += e.l;
    minutos.w += e.w;
    minutos.m += e.m;
    minutos.s += e.s;
    minutos.sm += e.sm;
    if (e.x === 1) truncado = true;
  }

  // Resumo parcial (chamada que falhou, prazo, jobs além do orçamento) sai e
  // vai para o cache marcado `truncado`, com TTL como qualquer outro: um repo
  // mais movimentado que o orçamento não é recoletado a cada /consumo. Depois
  // do TTL a coleta segue de onde parou, pelo cache de jobs.
  const parcial = truncado || !completo || pendentes > 0;
  const resumo = montar({ ...base, publico, truncado: parcial, minutos, bytes, pendentes });
  const entrada = { visto: agoraMs, at: agoraMs, resumo, runs: cacheRuns };
  return { saida: resumo, entrada, gastos };
}

// ------------------------------------------------------------------ cache

// Mapa de chaves de lista fixa com inteiros positivos que somam `total`;
// chaves fora da lista são ignoradas, valor fora da regra invalida tudo.
function lerMapa(o, chaves, total) {
  if (!ehObjeto(o)) return null;
  const mapa = {};
  let soma = 0;
  for (const k of chaves) {
    if (!Object.hasOwn(o, k)) continue;
    const v = o[k];
    if (!inteiroEntre(v, 1, MAX_RUNS)) return null;
    mapa[k] = v;
    soma += v;
  }
  return soma === total ? mapa : null;
}

function lerContagem(c) {
  if (!ehObjeto(c)) return null;
  const total = proprio(c, 'total');
  if (!inteiroEntre(total, 0, MAX_RUNS)) return null;
  const porEvento = lerMapa(proprio(c, 'porEvento'), CHAVES_EVENTO, total);
  return porEvento === null ? null : { total, porEvento };
}

// Resumo guardado, reconstruído campo a campo a partir das chaves conhecidas;
// qualquer campo fora da regra invalida o TTL. `pendentes` vai de 0 a
// runs30.total, e resumo com pendentes precisa estar marcado `truncado`.
function lerResumo(r) {
  if (!ehObjeto(r)) return null;
  const publico = proprio(r, 'publico');
  if (publico !== null && typeof publico !== 'boolean') return null;
  const runs7 = lerContagem(proprio(r, 'runs7'));
  const runs30 = lerContagem(proprio(r, 'runs30'));
  if (runs7 === null || runs30 === null || runs7.total > runs30.total) return null;
  const conclusoes30 = lerMapa(proprio(r, 'conclusoes30'), CHAVES_CONCLUSAO, runs30.total);
  const m = proprio(r, 'minutos30');
  const c = proprio(r, 'cache');
  const nc = proprio(r, 'naoClassificado');
  if (conclusoes30 === null || !ehObjeto(m) || !ehObjeto(c) || !ehObjeto(nc)) return null;
  const minutos = { l: proprio(m, 'linux'), w: proprio(m, 'windows'), m: proprio(m, 'macos'), s: proprio(nc, 'jobs'), sm: proprio(nc, 'minutos') };
  if (![minutos.l, minutos.w, minutos.m, minutos.sm].every((n) => inteiroEntre(n, 0, MAX_MIN_REPO))) return null;
  if (!inteiroEntre(minutos.s, 0, MAX_JOBS_REPO)) return null;
  if (proprio(m, 'ponderado') !== ponderar(minutos.l, minutos.w, minutos.m)) return null;
  const bytes = proprio(c, 'bytes');
  if (bytes !== null && !inteiroEntre(bytes, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (proprio(c, 'limiteBytes') !== LIMITE_CACHE) return null;
  const totalApi30 = proprio(r, 'totalApi30');
  const truncado = proprio(r, 'truncado');
  if (!inteiroEntre(totalApi30, 0, Number.MAX_SAFE_INTEGER) || typeof truncado !== 'boolean') return null;
  const pendentes = proprio(r, 'pendentes');
  if (!inteiroEntre(pendentes, 0, runs30.total) || (pendentes > 0 && !truncado)) return null;
  return montar({ publico, runs7, runs30, conclusoes30, minutos, bytes, totalApi30, truncado, pendentes });
}

function lerRunCache(e, desde30, agoraMs) {
  if (!ehObjeto(e)) return null;
  const v = { t: proprio(e, 't'), a: proprio(e, 'a'), l: proprio(e, 'l'), w: proprio(e, 'w'), m: proprio(e, 'm'), s: proprio(e, 's'), sm: proprio(e, 'sm'), x: proprio(e, 'x') };
  if (!inteiroEntre(v.t, desde30, agoraMs + FUTURO_MAX_MS)) return null;
  if (!inteiroEntre(v.a, 1, MAX_TENTATIVA)) return null;
  if (![v.l, v.w, v.m, v.sm].every((n) => inteiroEntre(n, 0, MAX_MIN_RUN))) return null;
  if (!inteiroEntre(v.s, 0, MAX_JOBS_RUN) || (v.x !== 0 && v.x !== 1)) return null;
  return v;
}

// Execuções da janela de 30 dias, as 200 mais novas.
function podarRuns(mapa, agoraMs) {
  const desde30 = agoraMs - JANELA30_MS;
  return new Map([...mapa].filter(([, e]) => e.t >= desde30).sort((a, b) => b[1].t - a[1].t).slice(0, MAX_RUNS));
}

function lerRunsCache(runs, agoraMs) {
  const mapa = new Map();
  if (!ehObjeto(runs)) return mapa;
  const desde30 = agoraMs - JANELA30_MS;
  for (const k of Object.keys(runs)) {
    if (!ID_RUN.test(k)) continue;
    const id = Number(k);
    if (!Number.isSafeInteger(id)) continue;
    const e = lerRunCache(runs[k], desde30, agoraMs);
    if (e !== null) mapa.set(id, e);
  }
  return podarRuns(mapa, agoraMs);
}

function lerEntrada(e, agoraMs) {
  if (!ehObjeto(e)) return null;
  const visto = instante(proprio(e, 'visto'), agoraMs);
  if (visto === null || agoraMs - visto > VISTO_MAX_MS) return null;
  let at = instante(proprio(e, 'at'), agoraMs);
  const resumo = at === null ? null : lerResumo(proprio(e, 'resumo'));
  if (resumo === null) at = null;
  return { visto, at, resumo, runs: lerRunsCache(proprio(e, 'runs'), agoraMs) };
}

// Cache inteiro, validado: só chaves próprias, repo revalidado pela regex e em
// minúsculas, instantes via estado.instante, números dentro das faixas.
// Qualquer coisa fora do schema some; arquivo ilegível vale cache vazio.
function lerCache(arquivo, agoraMs) {
  const repos = new Map();
  const lido = lerJson(arquivo, CACHE_MAX_BYTES);
  if (!lido.ok) return repos;
  const v = lido.valor;
  if (!ehObjeto(v) || proprio(v, 'versao') !== VERSAO_CACHE) return repos;
  const lista = proprio(v, 'repos');
  if (!ehObjeto(lista)) return repos;
  for (const chave of Object.keys(lista)) {
    if (!repoValido(chave) || chave !== chave.toLowerCase()) continue;
    const e = lerEntrada(lista[chave], agoraMs);
    if (e !== null) repos.set(chave, e);
  }
  return repos;
}

// Grava os 20 repos vistos mais recentemente. A poda de 31 dias já foi feita
// na leitura (lerEntrada); os repos atualizados agora têm visto = agoraMs.
function gravarCache(arquivo, repos, agoraMs) {
  const saida = {};
  const entradas = [...repos].sort((a, b) => b[1].visto - a[1].visto).slice(0, CACHE_MAX_REPOS);
  for (const [chave, e] of entradas) {
    const runs = {};
    for (const [id, r] of podarRuns(e.runs, agoraMs)) runs[String(id)] = { t: r.t, a: r.a, l: r.l, w: r.w, m: r.m, s: r.s, sm: r.sm, x: r.x };
    saida[chave] = { visto: iso(e.visto), at: e.at === null ? null : iso(e.at), resumo: e.at === null ? null : e.resumo, runs };
  }
  // Falha ao gravar só custa chamadas na próxima coleta; o resultado vale.
  gravarJsonAtomico(arquivo, { versao: VERSAO_CACHE, repos: saida });
}

// ------------------------------------------------------------------ coleta

// owner/repo do GitHub: regex da spec, sem '..' e sem parte começando com
// '.' ou '-'. Só um repo que passa aqui chega a um endpoint.
// Recusar owner/.github (repo legítimo) é limitação deliberada da v0.1.
function repoValido(r) {
  if (typeof r !== 'string' || !REPO.test(r) || r.includes('..')) return false;
  const [dono, nome] = r.split('/');
  return !/^[.-]/.test(dono) && !/^[.-]/.test(nome);
}

const agoraValido = (a) => typeof a === 'number' && Number.isFinite(a) && a >= AGORA_MIN && a <= AGORA_MAX;
const prazoValido = (p) => (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= PRAZO_MAX_MS ? p : PRAZO_PADRAO_MS);

async function coletar(opcoes, inicio) {
  if (opcoes === null || typeof opcoes !== 'object') return {};
  const { repos, agoraMs, gh, prazoMs } = opcoes;
  if (!Array.isArray(repos)) return {};
  const quantos = repos.length;
  const lista = [];
  for (let i = 0; i < Math.min(quantos, MAX_ENTRADAS); i++) lista.push(repos[i]);

  // Chaves da saída na ordem da lista: repo válido pelo próprio nome (a
  // primeira grafia, sem repetir o mesmo repo em outra caixa); entrada
  // inválida por `repos[i]`, para que o texto recusado nunca vire chave.
  const saida = {};
  const aceitos = [];
  const chaves = new Set();
  for (let i = 0; i < lista.length; i++) {
    const r = lista[i];
    if (!repoValido(r)) {
      saida[`repos[${i}]`] = { indisponivel: 'invalido' };
      continue;
    }
    const chave = r.toLowerCase();
    if (chaves.has(chave)) continue;
    chaves.add(chave);
    if (aceitos.length >= MAX_REPOS) {
      saida[r] = { indisponivel: 'truncado' };
      continue;
    }
    saida[r] = null;
    aceitos.push({ nome: r, chave });
  }
  if (quantos > MAX_ENTRADAS) saida[`repos[${MAX_ENTRADAS}+]`] = { indisponivel: 'truncado' };
  if (aceitos.length === 0) return saida;

  const desde = agoraValido(agoraMs) ? iso(agoraMs - JANELA30_MS).slice(0, 10) : null;
  if (desde === null || !DATA.test(desde)) {
    for (const a of aceitos) saida[a.nome] = { indisponivel: 'agora inválido' };
    return saida;
  }

  const dir = dirDados();
  const arquivo = dir === null ? null : path.join(dir, ARQ_CACHE);
  const cache = arquivo === null ? new Map() : lerCache(arquivo, agoraMs);
  const ctx = {
    gh: gh === undefined ? ghPadrao : gh,
    fim: inicio + prazoValido(prazoMs),
    fatal: null,
    chamou: false,
    agoraMs,
    desde,
    comCache: arquivo !== null,
  };

  const acertos = new Map();
  for (const a of aceitos) {
    const e = cache.get(a.chave);
    if (e !== undefined && e.at !== null && agoraMs >= e.at && agoraMs - e.at < TTL_MS) acertos.set(a.chave, e.resumo);
  }
  let faltam = aceitos.length - acertos.size;
  let restante = ORCAMENTO_JOBS;
  for (const a of aceitos) {
    const acerto = acertos.get(a.chave);
    if (acerto !== undefined) {
      saida[a.nome] = acerto;
      continue;
    }
    const orcamento = Math.floor(restante / faltam);
    faltam--;
    try {
      const r = await atualizarRepo(ctx, a.nome, cache.get(a.chave), orcamento);
      restante -= r.gastos;
      saida[a.nome] = r.saida;
      if (r.entrada !== null) cache.set(a.chave, r.entrada);
    } catch {
      saida[a.nome] = { indisponivel: 'resposta inválida' };
    }
  }
  if (arquivo !== null && ctx.chamou) gravarCache(arquivo, cache, agoraMs);
  return saida;
}

// Resumo de GitHub Actions por repo: { [repo]: ResumoRepo | { indisponivel } }.
// ResumoRepo = { publico, runs7, runs30, minutos30, cache } do brief, mais
// conclusoes30, naoClassificado (jobs e minutos fora da estimativa:
// self-hosted, runner maior ou próprio, rótulo desconhecido; peso 0),
// totalApi30 (total_count da API), truncado (o resumo não cobre tudo: mais
// de 200 execuções ou de 100 jobs numa execução, chamada que falhou, prazo
// ou jobs pendentes) e pendentes (execuções da janela sem jobs lidos).
// minutos30.ponderado usa os pesos de pesoSistema e tem até 2 casas. Sem
// diretório de dados: minutos, naoClassificado e cache.bytes são null.
// Motivos de indisponível vêm de uma lista fixa (ver MOTIVOS_EXECUTOR,
// 'invalido', 'truncado', 'agora inválido' e 'HTTP nnn'). Entrada que não é
// objeto com `repos` em lista devolve {}. Prazo padrão de 10 s (`prazoMs`);
// o executor (`gh`) recebe (args, sinal) e o sinal é abortado quando a
// chamada passa do prazo. Nunca lança nem rejeita.
export async function coletarGithub(opcoes) {
  try {
    return await coletar(opcoes, performance.now());
  } catch {
    return {};
  }
}

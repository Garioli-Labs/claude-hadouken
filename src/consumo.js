import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agregar } from './agregacao.js';
import { ARQ_ESTADO, dirDados, lerJson, limitesValidos, validarEstado } from './estado.js';
import { coletarGithub, repoValido } from './github.js';
import {
  AVISO_CONFIG, CLAUDE_ILEGIVEIS, CLAUDE_RAIZ_RECUSADA, CLAUDE_SEM_HOME, CLAUDE_SEM_RECENTES,
  CLAUDE_SEM_TRANSCRIPTS, montarRelatorio,
} from './relatorio.js';
import { indexarTranscripts } from './transcripts.js';

// Coleta do /consumo (spec 6.8; addendum da Task 10, B e D): lê estado.json,
// config.json (ou o origin do git no cwd), indexa os transcripts e consulta o
// GitHub, estes dois em paralelo, e monta o relatório (relatorio.js). Nada
// aqui lança: erro vira { ok: false, motivo } com motivo de uma lista fixa.

export const ARQ_CONFIG = 'config.json';
const CONFIG_MAX_BYTES = 64 * 1024;
const CONFIG_MAX_REPOS = 20;
const PRAZO_GITHUB_MS = 10_000;
const PRAZO_GITHUB_MAX_MS = 600_000;
const SEMANA_MS = 7 * 86_400_000;
const ORIGIN_MAX = 512;
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 64 * 1024;
// Só as três formas do github.com, sem credencial, porta, barra final nem
// espaço; o dono/repo capturado ainda passa pela regex da Task 9.
const ORIGIN = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/;

// Códigos de erro que o CLI pode imprimir (addendum A): errno de sistema de
// arquivos e processo e o do import que falta. Qualquer outro é
// 'desconhecido'; mensagem, stack e caminho nunca saem.
const CODIGOS = new Set([
  'EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EBUSY', 'EMFILE', 'ENFILE', 'ENOMEM', 'ENOSPC', 'EIO',
  'ELOOP', 'ENAMETOOLONG', 'EROFS', 'ETIMEDOUT', 'EPIPE', 'EAGAIN', 'EEXIST', 'EINVAL', 'ENOTEMPTY', 'EXDEV',
  'ECONNRESET', 'ERR_MODULE_NOT_FOUND', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END',
]);

const finito = (n) => typeof n === 'number' && Number.isFinite(n);

// Código do erro, só se estiver na lista; senão 'desconhecido'. Nunca lança.
export function codigoErro(e) {
  try {
    const c = e !== null && typeof e === 'object' ? e.code : undefined;
    return typeof c === 'string' && CODIGOS.has(c) ? c : 'desconhecido';
  } catch {
    return 'desconhecido';
  }
}

// ------------------------------------------------------------------ repos

function faltaArquivo(arquivo) {
  try {
    fs.lstatSync(arquivo);
    return false;
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
  }
}

// Só { repos: [até 20 textos que passam na regex da Task 9] }; outras chaves
// são ignoradas (a spec reserva o arquivo também para limiares).
function reposValidos(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || !Object.hasOwn(v, 'repos')) return null;
  const r = v.repos;
  if (!Array.isArray(r) || r.length > CONFIG_MAX_REPOS) return null;
  for (let i = 0; i < r.length; i++) if (!repoValido(r[i])) return null;
  return r.slice();
}

// Repos do config.json: { repos, avisos }. Arquivo ausente → repos null sem
// aviso (o origin decide). Qualquer outra coisa fora do formato (JSON
// inválido, acima de 64 KiB, pasta, sem `repos`, mais de 20, um item que não
// passa na regex) ignora o arquivo inteiro, com o aviso fixo. Nunca lança.
export function reposDaConfig(arquivo) {
  try {
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    if (!lido.ok) return lido.motivo === 'ausente' && faltaArquivo(arquivo) ? { repos: null, avisos: [] } : { repos: null, avisos: [AVISO_CONFIG] };
    const repos = reposValidos(lido.valor);
    return repos === null ? { repos: null, avisos: [AVISO_CONFIG] } : { repos, avisos: [] };
  } catch {
    return { repos: null, avisos: [AVISO_CONFIG] };
  }
}

// dono/repo de uma URL de origin do GitHub, ou null. Nunca lança.
export function repoDoOrigin(url) {
  try {
    if (typeof url !== 'string' || url.length > ORIGIN_MAX) return null;
    const m = ORIGIN.exec(url);
    return m !== null && repoValido(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

// Ambiente do git: o do processo, sem prompt de terminal (a chave é removida
// em qualquer grafia antes de ser posta, como em github.js).
function ambienteGit() {
  const env = Object.create(null);
  for (const [k, v] of Object.entries(process.env)) if (k.toLowerCase() !== 'git_terminal_prompt') env[k] = v;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

// Repo do origin do git em `cwd` (ou no cwd do processo): [dono/repo] ou [].
// execFile sem shell, com fsmonitor desligado (um repo hostil não roda hook),
// sem locks opcionais, janela oculta, 5 s e 64 KiB. Nunca rejeita.
export function lerOrigin(cwd) {
  return new Promise((resolve) => {
    try {
      const dir = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
      execFile('git', ['-c', 'core.fsmonitor=', '--no-optional-locks', 'remote', 'get-url', 'origin'], {
        cwd: dir, env: ambienteGit(), timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true,
        shell: false, encoding: 'utf8', killSignal: 'SIGKILL',
      }, (erro, stdout) => {
        if (erro || typeof stdout !== 'string') {
          resolve([]);
          return;
        }
        const repo = repoDoOrigin(stdout.replace(/\r?\n$/, ''));
        resolve(repo === null ? [] : [repo]);
      });
    } catch {
      resolve([]);
    }
  });
}

// ------------------------------------------------------------------ Claude

// Raiz dos transcripts: <CLAUDE_CONFIG_DIR>/projects quando a variável é um
// caminho absoluto (o Claude Code guarda os dados lá); senão
// ~/.claude/projects. Sem home conhecida, null.
function raizPadrao() {
  try {
    const config = process.env.CLAUDE_CONFIG_DIR;
    if (typeof config === 'string' && path.isAbsolute(config)) return path.join(config, 'projects');
    const home = os.homedir();
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude', 'projects') : null;
  } catch {
    return null;
  }
}

// Meia-noite local de hoje, em ms (só a exibição e o corte de "hoje" usam o
// fuso local; o resto é epoch).
function meiaNoiteLocal(agoraMs) {
  const d = new Date(agoraMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Início da semana: o da janela de 7d quando há leitura válida (reset menos
// 7 dias); senão os últimos 7 dias.
function inicioSemana(estado, agoraMs) {
  const e = validarEstado(estado, agoraMs);
  const lim = e === null ? null : limitesValidos(e, agoraMs);
  if (lim?.seven_day) {
    const desdeMs = lim.seven_day.resets_at * 1000 - SEMANA_MS;
    if (Number.isFinite(desdeMs) && desdeMs <= agoraMs) return { desdeMs, origem: 'janela_7d' };
  }
  return { desdeMs: agoraMs - SEMANA_MS, origem: 'ultimos_7_dias' };
}

// Nenhum transcript no período: o motivo certo. O indexador devolve o mesmo
// resultado neutro para raiz ausente e raiz ligada, então o lstat daqui separa
// os dois (junção no Windows também é link).
function motivoSemArquivos(raiz, idx) {
  let st;
  try {
    st = fs.lstatSync(raiz);
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? CLAUDE_SEM_TRANSCRIPTS : CLAUDE_ILEGIVEIS;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return CLAUDE_RAIZ_RECUSADA;
  return idx.ilegiveis > 0 ? CLAUDE_ILEGIVEIS : CLAUDE_SEM_RECENTES;
}

async function coletarClaude(raiz, hojeMs, semana) {
  if (raiz === null) return { indisponivel: CLAUDE_SEM_HOME };
  const idx = await indexarTranscripts({ raiz, desdeMs: Math.min(hojeMs, semana.desdeMs) });
  if (idx.arquivos === 0) return { indisponivel: motivoSemArquivos(raiz, idx) };
  return {
    hoje: agregar(idx.registros, hojeMs),
    semana: agregar(idx.registros, semana.desdeMs),
    hoje_desde: hojeMs,
    semana_desde: semana.desdeMs,
    semana_origem: semana.origem,
    linhasInvalidas: idx.linhasInvalidas,
    arquivos: idx.arquivos,
    ilegiveis: idx.ilegiveis,
    truncado: idx.truncado,
  };
}

// ------------------------------------------------------------------ GitHub

async function coletarRepos(dir, { gh, cwd, prazoMs }, agoraMs) {
  const cfg = dir === null ? { repos: null, avisos: [] } : reposDaConfig(path.join(dir, ARQ_CONFIG));
  const repos = cfg.repos ?? await lerOrigin(cwd);
  const github = repos.length === 0 ? {} : await coletarGithub({ repos, agoraMs, gh, prazoMs });
  return { github, avisos: cfg.avisos };
}

// ------------------------------------------------------------------ geral

// Relatório do /consumo: { ok: true, relatorio } (JSON de montarRelatorio) ou
// { ok: false, motivo }. Opções (todas opcionais, para os testes e para a
// medição): agoraMs, gh (executor; padrão o gh do PATH), raizTranscripts
// (padrão <CLAUDE_CONFIG_DIR>/projects ou ~/.claude/projects), cwd (onde
// procurar o origin) e prazoGithubMs (padrão 10 s, passado explicitamente ao
// coletor). Transcripts e GitHub rodam em paralelo. Nunca rejeita.
export async function gerarRelatorio(opcoes) {
  try {
    const o = opcoes !== null && typeof opcoes === 'object' ? opcoes : {};
    const agoraMs = finito(o.agoraMs) ? o.agoraMs : Date.now();
    const prazoMs = finito(o.prazoGithubMs) && o.prazoGithubMs >= 0 && o.prazoGithubMs <= PRAZO_GITHUB_MAX_MS ? o.prazoGithubMs : PRAZO_GITHUB_MS;
    const dir = dirDados();
    let estado = null;
    if (dir !== null) {
      const lido = lerJson(path.join(dir, ARQ_ESTADO));
      if (lido.ok) estado = lido.valor;
    }
    const raiz = typeof o.raizTranscripts === 'string' && o.raizTranscripts !== '' ? o.raizTranscripts : raizPadrao();
    const semana = inicioSemana(estado, agoraMs);
    const [claude, gh] = await Promise.all([
      coletarClaude(raiz, meiaNoiteLocal(agoraMs), semana),
      coletarRepos(dir, { gh: o.gh, cwd: o.cwd, prazoMs }, agoraMs),
    ]);
    return { ok: true, relatorio: montarRelatorio({ estado, agoraMs, claude, github: gh.github, avisos: gh.avisos }) };
  } catch (e) {
    return { ok: false, motivo: codigoErro(e) };
  }
}

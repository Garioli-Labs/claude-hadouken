import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agregar } from './agregacao.js';
import { ARQ_ESTADO, dirDados, lerJson, limitesValidos, validarEstado } from './estado.js';
import { resolverExecutavel } from './executavel.js';
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
const GIT_ESPERA_KILL_MS = 1000;
const GIT_MAX_BUFFER = 64 * 1024;
const ARGS_ORIGIN = Object.freeze(['-c', 'core.fsmonitor=', '--no-optional-locks', 'remote', 'get-url', 'origin']);
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

const INVALIDO = Symbol('invalido');

// Repos de um config.json já lido, com três saídas:
// - raiz que não é objeto (ou é lista) → INVALIDO: arquivo quebrado;
// - objeto sem `repos` próprio → null: config sem repos (a spec reserva o
//   arquivo também para limiares), o origin decide. O `__proto__` que o
//   JSON.parse cria é chave própria comum e nunca é lida;
// - `repos` próprio → a cópia da lista, se tiver até 20 textos que passam na
//   regex da Task 9; senão INVALIDO.
// Outras chaves são ignoradas.
function reposValidos(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return INVALIDO;
  if (!Object.hasOwn(v, 'repos')) return null;
  const r = v.repos;
  if (!Array.isArray(r) || r.length > CONFIG_MAX_REPOS) return INVALIDO;
  for (let i = 0; i < r.length; i++) if (!repoValido(r[i])) return INVALIDO;
  return r.slice();
}

// Repos do config.json: { repos, avisos }. Arquivo ausente, ou objeto sem
// `repos` próprio → repos null sem aviso (o origin decide). Arquivo quebrado
// (JSON inválido, acima de 64 KiB, pasta, raiz que não é objeto) ou `repos`
// fora do formato (não lista, mais de 20, um item que não passa na regex)
// ignora o arquivo inteiro, com o aviso fixo. Nunca lança.
export function reposDaConfig(arquivo) {
  try {
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    if (!lido.ok) return lido.motivo === 'ausente' && faltaArquivo(arquivo) ? { repos: null, avisos: [] } : { repos: null, avisos: [AVISO_CONFIG] };
    const repos = reposValidos(lido.valor);
    return repos === INVALIDO ? { repos: null, avisos: [AVISO_CONFIG] } : { repos, avisos: [] };
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
// O git é o do PATH, por caminho absoluto, nunca um plantado no cwd
// (executavel.js); sem git fora do cwd, []. spawn sem shell, com fsmonitor
// desligado (um repo hostil não roda hook), sem locks opcionais, janela
// oculta, stdin no dispositivo nulo (nenhum git fica esperando entrada) e
// stderr descartado (um git falador não apaga o origin). É spawn, e não
// execFile, porque o execFile não repassa `stdio` ao spawn (Node 20 e 24) e
// sempre acumula o stderr. Prazo de 5 s e stdout de até 64 KiB: passou de
// um deles, SIGKILL, e a promessa só resolve depois que o git saiu, ou 1 s
// depois do SIGKILL se ele não sair (processo preso em E/S do kernel não
// morre; o CLI sai com process.exit() assim mesmo). Nunca rejeita.
export function lerOrigin(cwd) {
  return new Promise((resolve) => {
    let feito = false;
    let relogio = null;
    const fim = (repos) => {
      if (feito) return;
      feito = true;
      if (relogio !== null) clearTimeout(relogio);
      resolve(repos);
    };
    try {
      const git = resolverExecutavel('git');
      if (git === null) {
        fim([]);
        return;
      }
      const dir = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
      const filho = spawn(git, ARGS_ORIGIN, {
        cwd: dir, env: ambienteGit(), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      });
      let saiu = false;
      let abortado = false;
      let total = 0;
      const partes = [];
      const abortar = () => {
        if (abortado) return;
        abortado = true;
        if (saiu) {
          fim([]);
          return;
        }
        filho.once('exit', () => fim([]));
        clearTimeout(relogio);
        relogio = setTimeout(() => fim([]), GIT_ESPERA_KILL_MS);
        try { filho.kill('SIGKILL'); } catch { fim([]); }
      };
      relogio = setTimeout(abortar, GIT_TIMEOUT_MS);
      filho.on('exit', () => { saiu = true; });
      filho.on('error', () => fim([]));
      filho.stdout.on('error', () => { /* o close ou o prazo decidem */ });
      filho.stdout.on('data', (pedaco) => {
        if (total > GIT_MAX_BUFFER) return;
        total += pedaco.length;
        if (total > GIT_MAX_BUFFER) abortar();
        else partes.push(pedaco);
      });
      filho.on('close', (codigo) => {
        if (codigo !== 0 || total > GIT_MAX_BUFFER) {
          fim([]);
          return;
        }
        const repo = repoDoOrigin(Buffer.concat(partes).toString('utf8').replace(/\r?\n$/, ''));
        fim(repo === null ? [] : [repo]);
      });
    } catch {
      fim([]);
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
// fuso local; o resto é epoch). Num dia de mudança de horário a meia-noite
// continua a do calendário local (o Date resolve o deslocamento do dia).
function meiaNoiteLocal(agoraMs) {
  const d = new Date(agoraMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Início dos três períodos do relatório, em ms; cada período vale de
// `desde` (inclusive) em diante:
// - hojeMs: a meia-noite local de hoje;
// - seteDiasMs: agora menos 7 × 24 h, sem fuso nem calendário;
// - semana: a janela de 7d quando há leitura válida (reset menos 7 dias,
//   origem 'janela_7d'); senão os mesmos últimos 7 dias (origem
//   'ultimos_7_dias').
// `agoraMs` precisa ser finito (gerarRelatorio garante). Nunca lança.
export function periodos(estado, agoraMs) {
  const seteDiasMs = agoraMs - SEMANA_MS;
  let semana = { desdeMs: seteDiasMs, origem: 'ultimos_7_dias' };
  try {
    const e = validarEstado(estado, agoraMs);
    const lim = e === null ? null : limitesValidos(e, agoraMs);
    if (lim?.seven_day) {
      const desdeMs = lim.seven_day.resets_at * 1000 - SEMANA_MS;
      if (Number.isFinite(desdeMs) && desdeMs <= agoraMs) semana = { desdeMs, origem: 'janela_7d' };
    }
  } catch {
    // estado ilegível: fica a semana dos últimos 7 dias
  }
  return { hojeMs: meiaNoiteLocal(agoraMs), seteDiasMs, semana };
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

async function coletarClaude(raiz, { hojeMs, seteDiasMs, semana }) {
  if (raiz === null) return { indisponivel: CLAUDE_SEM_HOME };
  const idx = await indexarTranscripts({ raiz, desdeMs: Math.min(hojeMs, seteDiasMs, semana.desdeMs) });
  if (idx.arquivos === 0) return { indisponivel: motivoSemArquivos(raiz, idx) };
  return {
    hoje: agregar(idx.registros, hojeMs),
    sete_dias: agregar(idx.registros, seteDiasMs),
    semana: agregar(idx.registros, semana.desdeMs),
    hoje_desde: hojeMs,
    sete_dias_desde: seteDiasMs,
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
// medição): agoraMs, gh (executor; padrão o gh do PATH, por caminho
// absoluto, nunca o do cwd), raizTranscripts
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
    const [claude, gh] = await Promise.all([
      coletarClaude(raiz, periodos(estado, agoraMs)),
      coletarRepos(dir, { gh: o.gh, cwd: o.cwd, prazoMs }, agoraMs),
    ]);
    return { ok: true, relatorio: montarRelatorio({ estado, agoraMs, claude, github: gh.github, avisos: gh.avisos }) };
  } catch (e) {
    return { ok: false, motivo: codigoErro(e) };
  }
}

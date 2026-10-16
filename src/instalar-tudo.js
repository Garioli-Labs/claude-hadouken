import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ReadStream as TtyReadStream } from 'node:tty';
import { fileURLToPath } from 'node:url';
import { dirDados } from './base.js';
import { aplicarStatusline, arquivoSettings } from './configuracao.js';
import { lerJson } from './estado.js';
import { instalarPainel, versaoDoPlugin } from './painel/instalar-painel.js';
import { sincronizarShims } from './shim.js';
import { ligarAtualizacao, marketplaceConhecido } from './instalar/atualizacao-auto.js';
import { criarClaude, ID_KIT, passoKit, passoRea } from './instalar/claude-cli.js';
import { codigoDeSaida, formatarResumo, item } from './instalar/itens.js';

// Instalador de um comando, passos 6 e 7 (spec v0.5.2). O install.sh ou o
// install.ps1 já conferiram o PC, instalaram o claude-hadouken e chamam
// `node <plugin>/src/instalar-tudo.js [opções]` com HADOUKEN_CLAUDE = o
// caminho do claude. Daqui: kit e REA, atualização automática, arquivos da
// barra, barra, item do VS Code, aprendizado e extras (graphify e yu-ux),
// cada um independente (uma exceção vira ✗ daquele item e o resto segue), e
// o resumo de rótulos fixos (itens.js). Perguntas só da barra (outra barra) e
// do aprendizado; sem tty, a resposta é "não". Rodar de novo atualiza e pula
// o que já está certo.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GRAPHIFY = 'graphifyy==0.9.25';
const DE_NOVO = 'rode o comando de instalação de novo';
const CONSERTO_PAINEL = 'rode node ~/.claude/hadouken/bin/cli.mjs painel instalar';
const CONSERTO_BARRA = 'rode /claude-hadouken:instalar numa sessão';
const CONSERTO_APRENDER = 'rode /claude-hadouken:aprender ligar numa sessão';
const SEM_VSCODE = "VS Code não encontrado; no VS Code, rode Shell Command: Install 'code' command in PATH e instale de novo";
const OPCOES = Object.freeze({ '--sim': 'sim', '--substituir-barra': 'substituirBarra', '--sem-extras': 'semExtras', '--com-aprendizado': 'comAprendizado' });
export const CUSTO_APRENDIZADO = [
  'Aprendizado local (OpenTelemetry): o Hadouken aprende o seu ritmo com a telemetria do próprio Claude Code.',
  'Custo: o Collector otelcol-contrib, ~367 MiB em disco e ~108 MiB de memória, um processo por sessão. Nada sai da máquina.',
  '',
].join('\n');

export function lerOpcoes(argv) {
  const o = { sim: false, substituirBarra: false, semExtras: false, comAprendizado: false, desconhecidas: [] };
  for (const a of argv) {
    if (Object.hasOwn(OPCOES, a)) o[OPCOES[a]] = true;
    else o.desconhecidas.push(a);
  }
  return o;
}

// "s", "sim", "y", "yes" (sem caixa) são sim; vazio é o padrão; null (sem
// tty) e qualquer outra coisa são não.
export function respostaSim(texto, padrao) {
  if (typeof texto !== 'string') return false;
  const t = texto.trim().toLowerCase();
  if (t === '') return padrao;
  return ['s', 'sim', 'y', 'yes'].includes(t);
}

// Pergunta no terminal. No POSIX lê do /dev/tty (no `curl | bash` a entrada
// é o script) por um tty.ReadStream: um fs.ReadStream deixaria uma leitura
// pendente que segura o processo e engole a resposta seguinte. No Windows,
// da entrada do console, que nunca é destruída (a pergunta seguinte lê dela).
// O prompt vai para o stderr: no install.ps1 o stdout do node passa pelo
// Out-Host, que só mostra linha inteira. Sem tty: false.
export function criarPerguntar({ plataforma = process.platform, stdin = process.stdin, saida = process.stderr } = {}) {
  return async (texto, padrao) => {
    let tty = null;
    try {
      let entrada;
      if (plataforma === 'win32') {
        if (!stdin.isTTY) return false;
        entrada = stdin;
      } else {
        tty = new TtyReadStream(fs.openSync('/dev/tty', 'r'));
        entrada = tty;
      }
      const rl = readline.createInterface({ input: entrada, output: saida, terminal: false });
      try {
        return respostaSim(await rl.question(texto), padrao);
      } finally {
        rl.close();
        if (tty === null) entrada.pause();
      }
    } catch {
      return false;
    } finally {
      try { tty?.destroy(); } catch { /* já fechada */ }
    }
  };
}

function pastaConfig(ambiente) {
  const c = ambiente.CLAUDE_CONFIG_DIR;
  if (typeof c === 'string') return path.isAbsolute(c) ? c : null;
  try {
    return path.join(os.homedir(), '.claude');
  } catch {
    return null;
  }
}

async function passo(itens, nome, f) {
  try {
    itens.push(await f());
  } catch {
    itens.push(item.falhou(nome, 'erro-interno', DE_NOVO));
  }
}

// As cópias antigas dos terceiros só são desligadas quando a nova está
// pronta (prontas: ids instalados e ligados, da lista do passo do kit); a
// que fica ligada por falta da nova faz o item sair com ✗.
function passoAtualizacao({ settings, configDir, agoraMs, ligar, prontas }) {
  const nome = 'atualização automática';
  const outra = item.pulado(nome, 'marketplace claude-hadouken de outra fonte');
  if (!settings.ok) return item.falhou(nome, settings.motivo, DE_NOVO);
  if (configDir !== null && marketplaceConhecido(path.join(configDir, 'plugins', 'known_marketplaces.json')) === 'outra') return outra;
  const r = ligar({ arquivo: settings.arquivo, agoraMs, prontas });
  if (r.ok) {
    const mantidas = r.mantidas ?? [];
    if (r.acao === 'ja-estava' && mantidas.length === 0) return item.igual(nome);
    const feito = r.desligadas.length > 0 ? `ligada; ${r.desligadas.length} cópia(s) antiga(s) desligada(s)` : 'ligada';
    if (mantidas.length === 0) return item.ok(nome, feito);
    const nomes = mantidas.map((k) => k.split('@')[0]).join(', ');
    const resto = mantidas.length === 1 ? 'antigo continua ligado: falta o novo' : 'antigos continuam ligados: faltam os novos';
    return item.falhou(nome, `${feito}; ${nomes} ${resto}`, `rode claude plugin install ${ID_KIT}`);
  }
  return r.motivo === 'outra-fonte' ? outra : item.falhou(nome, r.motivo, DE_NOVO);
}

function passoShims({ raizPlugin, sincronizar }) {
  const nome = 'arquivos da barra';
  const r = sincronizar(raizPlugin);
  if (!r.ok) return item.falhou(nome, r.motivo, DE_NOVO);
  return r.alterados.length === 0 ? item.igual(nome) : item.ok(nome, 'em dia');
}

async function passoBarra({ settings, opcoes, perguntar, agoraMs, aplicar }) {
  const nome = 'barra';
  if (!settings.ok) return item.falhou(nome, settings.motivo, CONSERTO_BARRA);
  const feito = (r) => {
    if (r.acao === 'ja-instalado') return item.igual(nome);
    return item.ok(nome, r.acao === 'substituir' ? 'instalada no lugar da outra (com backup)' : 'instalada');
  };
  const r = aplicar({ arquivo: settings.arquivo, agoraMs, substituir: opcoes.substituirBarra });
  if (r.ok) return feito(r);
  if (r.motivo !== 'conflito') return item.falhou(nome, r.motivo, CONSERTO_BARRA);
  const trocar = !opcoes.sim && (await perguntar('Já existe outra barra (statusLine). Trocar pela barra do claude-hadouken? [s/N] ', false));
  if (!trocar) return item.pulado(nome, 'outra barra; rode de novo com --substituir-barra');
  const r2 = aplicar({ arquivo: settings.arquivo, agoraMs, substituir: true });
  return r2.ok ? feito(r2) : item.falhou(nome, r2.motivo, CONSERTO_BARRA);
}

async function passoPainel({ dir, raizPlugin, agoraMs, ambiente, instalar }) {
  const nome = 'item do VS Code';
  if (ambiente.HADOUKEN_SEM_PAINEL === '1') return item.pulado(nome, 'HADOUKEN_SEM_PAINEL=1');
  if (dir === null) return item.falhou(nome, 'sem-pasta', DE_NOVO);
  const versao = versaoDoPlugin(raizPlugin);
  const instalado = lerJson(path.join(dir, 'painel', 'instalado.json'), 4096);
  if (versao !== null && instalado.ok && instalado.valor?.versao === versao) return item.igual(nome);
  const r = await instalar({ dir, raizPlugin, agoraMs });
  if (r.ok) return item.ok(nome, 'instalado; recarregue a janela do VS Code');
  if (r.motivo === 'sem-vscode') return item.pulado(nome, SEM_VSCODE);
  return item.falhou(nome, r.motivo, CONSERTO_PAINEL);
}

async function passoAprendizado({ dir, settings, opcoes, perguntar, escrever, agoraMs, ambiente, aprendizado }) {
  const nome = 'aprendizado';
  const apr = aprendizado ?? { ...(await import('./aprendizado/arquivos.js')), ...(await import('./aprendizado/ligar.js')) };
  if (dir !== null && apr.ligadoExiste(dir)) return item.igual(nome);
  let quer = opcoes.comAprendizado;
  if (!quer && !opcoes.sim) {
    escrever(CUSTO_APRENDIZADO);
    quer = await perguntar('Ligar o aprendizado? [s/N] ', false);
  }
  if (!quer) return item.pulado(nome, 'desligado; para ligar depois, /claude-hadouken:aprender ligar');
  if (dir === null || !settings.ok) return item.falhou(nome, dir === null ? 'sem-pasta' : settings.motivo, CONSERTO_APRENDER);
  const base = { dir, arquivo: settings.arquivo, ambiente };
  const p = apr.previa(base);
  if (!p.ok) return item.falhou(nome, p.motivo, CONSERTO_APRENDER);
  const r = await apr.ligar({ ...base, codigo: p.codigo, agoraMs });
  return r.ok ? item.ok(nome, 'ligado') : item.falhou(nome, r.motivo, CONSERTO_APRENDER);
}

// O python e o bash dos extras rodam com o cwd na casa do usuário, nunca na
// pasta de onde se rodou o instalador: o Python põe o cwd no sys.path, e uma
// pasta pip/ plantada ali rodaria no lugar do pip (revisão final, Important 6).
const casaPadrao = () => {
  try {
    return os.homedir();
  } catch {
    return undefined;
  }
};

function rodarSimples(executar, exe, args, prazoMs, cwd) {
  return new Promise((resolve) => {
    try {
      executar(exe, args, { windowsHide: true, timeout: prazoMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', cwd }, (erro, stdout) => {
        resolve({ ok: !erro, motivo: !erro ? 'ok' : erro.killed === true ? 'tempo' : 'erro', saida: typeof stdout === 'string' ? stdout : '' });
      });
    } catch {
      resolve({ ok: false, motivo: 'erro', saida: '' });
    }
  });
}

function rodarVisivel(spawnar, exe, args, prazoMs, cwd) {
  return new Promise((resolve) => {
    try {
      const filho = spawnar(exe, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, cwd });
      const prazo = setTimeout(() => {
        try { filho.kill(); } catch { /* já saiu */ }
        resolve('tempo');
      }, prazoMs);
      filho.on('error', () => { clearTimeout(prazo); resolve('erro'); });
      filho.on('exit', (codigo) => { clearTimeout(prazo); resolve(codigo === 0 ? 'ok' : 'erro'); });
    } catch {
      resolve('erro');
    }
  });
}

// Python 3: o que o script achou (HADOUKEN_PYTHON, absoluto) ou python3 /
// python do PATH; vale o primeiro cujo --version diz "Python 3.x".
async function acharPython({ ambiente, plataforma, executar, cwd }) {
  const candidatos = [];
  if (typeof ambiente.HADOUKEN_PYTHON === 'string' && path.isAbsolute(ambiente.HADOUKEN_PYTHON)) candidatos.push(ambiente.HADOUKEN_PYTHON);
  candidatos.push(...(plataforma === 'win32' ? ['python'] : ['python3', 'python']));
  for (const c of candidatos) {
    const r = await rodarSimples(executar, c, ['--version'], 30_000, cwd);
    if (r.ok && /^Python 3\.\d+/.test(r.saida.trim())) return c;
  }
  return null;
}

// bash para o setup.sh da yu-ux: /bin/bash fora do Windows; no Windows, só o
// do Git (nunca o bash.exe do WSL no System32).
function acharBash({ ambiente, plataforma, existe }) {
  if (plataforma !== 'win32') return existe('/bin/bash') ? '/bin/bash' : null;
  const pf = ambiente.ProgramFiles ?? ambiente.PROGRAMFILES;
  const local = ambiente.LOCALAPPDATA;
  const lista = [
    ambiente.CLAUDE_CODE_GIT_BASH_PATH,
    typeof pf === 'string' ? path.win32.join(pf, 'Git', 'bin', 'bash.exe') : null,
    typeof local === 'string' ? path.win32.join(local, 'Programs', 'Git', 'bin', 'bash.exe') : null,
  ];
  return lista.find((p) => typeof p === 'string' && path.win32.isAbsolute(p) && existe(p)) ?? null;
}

// graphify num venv próprio, <pasta de dados>/venv (revisão final,
// Important 5): o pip --user falha nos Python marcados como gerenciados pelo
// sistema (PEP 668) e mistura versões com o resto do usuário. A skill do kit
// procura esse venv primeiro. Python < 3.10 e Python sem o módulo venv
// (Debian/Ubuntu sem python3-venv) são pulados, com o conserto.
async function passoGraphify({ python, executar, dir, plataforma, cwd }) {
  const nome = 'graphify';
  if (python === null) return item.pulado(nome, 'sem Python 3');
  if (dir === null) return item.falhou(nome, 'sem-pasta', DE_NOVO);
  const caminhos = plataforma === 'win32' ? path.win32 : path.posix;
  const venv = caminhos.join(dir, 'venv');
  const vpy = plataforma === 'win32' ? caminhos.join(venv, 'Scripts', 'python.exe') : caminhos.join(venv, 'bin', 'python');
  const mostra = await rodarSimples(executar, vpy, ['-m', 'pip', 'show', 'graphifyy'], 60_000, cwd);
  if (mostra.ok && /^Version: 0\.9\.25$/m.test(mostra.saida)) return item.igual(nome);
  if (!mostra.ok) {
    const v = /^Python 3\.(\d+)/.exec((await rodarSimples(executar, python, ['--version'], 30_000, cwd)).saida.trim());
    if (v === null || Number(v[1]) < 10) return item.pulado(nome, 'precisa de Python 3.10+');
    if (!(await rodarSimples(executar, python, ['-c', 'import venv, ensurepip'], 30_000, cwd)).ok) return item.pulado(nome, 'falta o python3-venv: sudo apt install python3-venv');
    const criado = await rodarSimples(executar, python, ['-m', 'venv', venv], 300_000, cwd);
    if (!criado.ok) return item.falhou(nome, criado.motivo, `rode ${python} -m venv "${venv}"`);
  }
  const r = await rodarSimples(executar, vpy, ['-m', 'pip', 'install', GRAPHIFY], 900_000, cwd);
  return r.ok ? item.ok(nome, 'instalado (graphifyy 0.9.25)') : item.falhou(nome, r.motivo, `rode "${vpy}" -m pip install ${GRAPHIFY}`);
}

async function passoYuUx({ bash, kitPath, spawnar, plataforma, cwd }) {
  const nome = 'ferramentas da yu-ux';
  if (bash === null) return item.pulado(nome, plataforma === 'win32' ? 'sem o bash do Git' : 'sem bash');
  if (typeof kitPath !== 'string') return item.pulado(nome, 'hadouken-kit não instalado');
  const setup = path.join(kitPath, 'skills', 'yu-ux-web-expert', 'scripts', 'setup.sh');
  if (!fs.existsSync(setup)) return item.falhou(nome, 'sem setup.sh', DE_NOVO);
  // O setup.sh usa dirname no próprio caminho: no Git Bash, só com barras normais.
  const alvo = plataforma === 'win32' ? setup.replaceAll('\\', '/') : setup;
  const r = await rodarVisivel(spawnar, bash, [alvo], 1_800_000, cwd);
  return r === 'ok' ? item.ok(nome, 'conferidas') : item.falhou(nome, r, `rode bash "${alvo}"`);
}

export async function instalarTudo(o) {
  const {
    opcoes, rodar, versaoNode = process.versions.node, agoraMs = Date.now(), raizPlugin = RAIZ, ambiente = process.env,
    perguntar = criarPerguntar(), plataforma = process.platform, escrever = (t) => process.stdout.write(t), deps = {},
  } = o;
  const {
    instalar = instalarPainel, sincronizar = sincronizarShims, aplicar = aplicarStatusline, ligarAuto = ligarAtualizacao,
    aprendizado = null, executar = execFile, spawnar = spawn, existe = (p) => fs.existsSync(p), casa = casaPadrao(),
  } = deps;
  const itens = [];
  const dir = dirDados();
  const settings = arquivoSettings();
  // O superpowers, dependência do kit, vem do marketplace oficial. Já
  // registrado é falha esperada: a lista depois do install é a verdade.
  await rodar(['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official']);
  let kitPath = null;
  let prontas = [];
  await passo(itens, 'hadouken-kit', async () => {
    const p = await passoKit(rodar);
    kitPath = p.entrada?.installPath ?? null;
    prontas = p.lista ? [...p.lista].filter(([, e]) => e.enabled).map(([id]) => id) : [];
    return p.item;
  });
  await passo(itens, 'hadouken-rea', () => passoRea(rodar, versaoNode));
  await passo(itens, 'atualização automática', () => passoAtualizacao({ settings, configDir: pastaConfig(ambiente), agoraMs, ligar: ligarAuto, prontas }));
  await passo(itens, 'arquivos da barra', () => passoShims({ raizPlugin, sincronizar }));
  await passo(itens, 'barra', () => passoBarra({ settings, opcoes, perguntar, agoraMs: agoraMs + 1, aplicar }));
  await passo(itens, 'item do VS Code', () => passoPainel({ dir, raizPlugin, agoraMs, ambiente, instalar }));
  await passo(itens, 'aprendizado', () => passoAprendizado({ dir, settings, opcoes, perguntar, escrever, agoraMs: agoraMs + 2, ambiente, aprendizado }));
  if (!opcoes.semExtras) {
    const python = deps.python !== undefined ? deps.python : await acharPython({ ambiente, plataforma, executar, cwd: casa });
    await passo(itens, 'graphify', () => passoGraphify({ python, executar, dir, plataforma, cwd: casa }));
    const bash = deps.bash !== undefined ? deps.bash : acharBash({ ambiente, plataforma, existe });
    await passo(itens, 'ferramentas da yu-ux', () => passoYuUx({ bash, kitPath, spawnar, plataforma, cwd: casa }));
  }
  return itens;
}

export async function main(argv = process.argv.slice(2), ambiente = process.env) {
  const opcoes = lerOpcoes(argv);
  if (opcoes.desconhecidas.length > 0) {
    process.stderr.write(`instalar-tudo: opção desconhecida; as opções são ${Object.keys(OPCOES).join(', ')}\n`);
    return 2;
  }
  const exe = ambiente.HADOUKEN_CLAUDE;
  if (typeof exe !== 'string' || !path.isAbsolute(exe)) {
    process.stderr.write('instalar-tudo: rode pelo install.sh ou pelo install.ps1 (falta HADOUKEN_CLAUDE com o caminho do claude)\n');
    return 2;
  }
  const itens = await instalarTudo({ opcoes, rodar: criarClaude({ exe }), ambiente });
  process.stdout.write(`\n${formatarResumo(itens)}\n`);
  return codigoDeSaida(itens);
}

let principal = false;
try {
  principal = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* importado pelos testes */ }
if (principal) {
  main().then((codigo) => { process.exitCode = codigo; }, () => { process.exitCode = 1; });
}

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { nodeServe } from '../../rea/lancar.mjs';
import { caminhoCmd, caminhoSeguro } from '../painel/instalar-painel.js';
import { avaliarDependencias, dependenciasDoManifesto, TERCEIROS_KIT } from './dedup.js';
import { item } from './itens.js';

// O `claude` do instalador (spec v0.5.2 §4 e §6). criarClaude devolve um
// `rodar(args)` que nunca rejeita. O caminho do claude vem do script
// (HADOUKEN_CLAUDE) e passa no caminhoSeguro; cada argumento é constante
// deste projeto e casa com ARG. No Windows, o claude.cmd do npm só roda por
// um shell: cmd.exe /d /s /c do System32 com a linha entre aspas e
// windowsVerbatimArguments, como o painel (instalar-painel.js). O cwd é a
// casa do usuário, nunca o projeto aberto. A verdade de cada passo é o
// `claude plugin list --json` depois dele, nunca o texto da saída.

export const ID_PRINCIPAL = 'hadouken@claude-hadouken';
export const ID_KIT = 'hadouken-kit@claude-hadouken';
export const ID_REA = 'hadouken-rea@claude-hadouken';
// As dependências do kit/.claude-plugin/plugin.json, como ids da lista. O que
// o instalador garante por conta própria são as de terceiros (TERCEIROS_KIT).
export const DEPENDENCIAS_KIT = Object.freeze([
  'hadouken@claude-hadouken', 'superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken',
  'poka-yoke@claude-hadouken', 'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken',
]);
export const PRAZO_CLAUDE_MS = 600_000;
const PRAZO_LISTA_MS = 60_000;
const ARG = /^[A-Za-z0-9@._:/=-]+$/;
const VERSAO = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const versao = (v) => (typeof v === 'string' && VERSAO.test(v) ? v : '?');
const casaPadrao = () => {
  try {
    return os.homedir();
  } catch {
    return undefined;
  }
};

export function criarClaude({ exe, plataforma = process.platform, executar = execFile, systemRoot = process.env.SystemRoot, ambiente = process.env, cwd = casaPadrao() } = {}) {
  const win = plataforma === 'win32';
  const caminhos = win ? path.win32 : path.posix;
  const valido = typeof exe === 'string' && caminhos.isAbsolute(exe) && caminhoSeguro(exe, plataforma);
  const viaCmd = valido && win && /\.(cmd|bat)$/i.test(exe);
  return (args, prazoMs = PRAZO_CLAUDE_MS) => new Promise((resolve) => {
    if (!valido) return resolve({ ok: false, motivo: 'claude-invalido', saida: '' });
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && ARG.test(a))) return resolve({ ok: false, motivo: 'argumentos', saida: '' });
    const opcoes = { windowsHide: true, timeout: prazoMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env: ambiente, cwd };
    const [arquivo, lista] = viaCmd ? [caminhoCmd(systemRoot), ['/d', '/s', '/c', `""${exe}" ${args.join(' ')}"`]] : [exe, args];
    if (viaCmd) opcoes.windowsVerbatimArguments = true;
    try {
      executar(arquivo, lista, opcoes, (erro, stdout) => {
        const saida = typeof stdout === 'string' ? stdout : String(stdout ?? '');
        if (!erro) resolve({ ok: true, motivo: 'ok', saida });
        else resolve({ ok: false, motivo: erro.killed === true || typeof erro.signal === 'string' ? 'tempo' : 'erro', saida });
      });
    } catch {
      resolve({ ok: false, motivo: 'erro', saida: '' });
    }
  });
}

// `claude plugin list --json`: id → { version, enabled, installPath }, só
// escopo user (ou sem escopo). Saída que não é uma lista JSON: null.
export async function listarPlugins(rodar) {
  const r = await rodar(['plugin', 'list', '--json'], PRAZO_LISTA_MS);
  if (!r.ok) return null;
  let lista;
  try {
    lista = JSON.parse(r.saida);
  } catch {
    return null;
  }
  if (!Array.isArray(lista)) return null;
  const mapa = new Map();
  for (const p of lista) {
    if (!ehObjeto(p) || typeof p.id !== 'string' || (p.scope !== undefined && p.scope !== 'user')) continue;
    mapa.set(p.id, {
      version: typeof p.version === 'string' ? p.version : null,
      enabled: p.enabled === true,
      installPath: typeof p.installPath === 'string' ? p.installPath : null,
    });
  }
  return mapa;
}

// Instala (ausente) ou atualiza (presente) e confere pela lista.
export async function passoPlugin(rodar, id, nome) {
  const antes = await listarPlugins(rodar);
  if (antes === null) return { item: item.falhou(nome, 'claude plugin list falhou', 'rode claude plugin list'), entrada: null };
  const tinha = antes.get(id);
  await rodar(['plugin', tinha ? 'update' : 'install', id]);
  const lista = await listarPlugins(rodar);
  const e = lista?.get(id) ?? null;
  if (e === null) return { item: item.falhou(nome, 'não instalou', `rode claude plugin install ${id}`), entrada: null, lista };
  if (!tinha) return { item: item.ok(nome, `instalado (${versao(e.version)})`), entrada: e, lista };
  if (tinha.version === e.version) return { item: item.igual(nome), entrada: e, lista };
  return { item: item.ok(nome, `atualizado (${versao(tinha.version)} → ${versao(e.version)})`), entrada: e, lista };
}

const MINIMO_DEDUP = [1, 2, 0];
// O kit 1.2.0 declara só o hadouken no manifesto: só com ele instalado
// desligar a cópia do kit de uma dependência não derruba o kit (spec v0.6.0,
// caso D2).
function kitSemDependencias(v) {
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(v) : null;
  if (m === null) return false;
  const atual = [Number(m[1]), Number(m[2]), Number(m[3])];
  const i = atual.findIndex((n, k) => n !== MINIMO_DEDUP[k]);
  return i === -1 || atual[i] > MINIMO_DEDUP[i];
}
// O disable do dedup é sempre no escopo do usuário (spec v0.6.0, G2): sem
// --scope o claude detecta o escopo e pode escrever em outro arquivo.
const comando = (verbo, id) => `claude plugin ${verbo} ${id}${verbo === 'disable' ? ' --scope user' : ''}`;
const listaE = (nomes) => (nomes.length < 2 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`);
const dependem = (nomes) => `${listaE(nomes)} ${nomes.length === 1 ? 'depende' : 'dependem'} dela`;
// Leitor que lança conta como plugin sem dependências.
function dependenciasDe(ler, e, id) {
  try {
    const r = ler(e.installPath, id);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// O kit e as dependências de terceiros dele (spec v0.6.0, Fatia 1). Cada
// dependência é avaliada contra o que o usuário já tem (dedup.js):
// `ausente` e não instalada → `plugin install`; `duplicada` (a do kit e a
// equivalente ligadas) → `plugin disable <D> --scope user` da do kit, só com o
// kit ≥ 1.2.0, só se o registro marca a do kit como instalada como dependência
// (`autos`: o que o usuário instalou ele mesmo só ganha aviso) e só sem outro
// plugin ligado que dependa dela (G1 e G3);
// `equivalente` → nada; `ausente` e instalada desligada → não religa e avisa;
// `propria` com a cópia do usuário desligada → só informa qual vale. Nunca
// desinstala. A verdade é a lista depois dos comandos (nula → ✗). Os avisos
// vão no detalhe do item do kit; `lista` é a final e `dedup` a avaliação feita
// antes dos comandos.
export async function passoKit(rodar, { repos = new Map(), lerTestado = () => ({}), autos = new Set(), lerDependencias = dependenciasDoManifesto } = {}) {
  const nome = 'hadouken-kit';
  const p = await passoPlugin(rodar, ID_KIT, nome);
  if (p.entrada === null) return { ...p, dedup: [] };
  let testado = {};
  try {
    testado = lerTestado(p.entrada.installPath);
  } catch { /* sem versão testada: só não avisa a versão */ }
  const instaladosPeloKit = autos instanceof Set ? autos : new Set();
  const plugins = new Map([...p.lista].map(([id, e]) => [id, { ...e, scope: 'user', auto: instaladosPeloKit.has(id), dependencias: e.enabled === true ? dependenciasDe(lerDependencias, e, id) : [] }]));
  const dedup = avaliarDependencias({ deps: TERCEIROS_KIT, plugins, repos, testado });
  const instalar = dedup.filter((a) => a.estado === 'ausente' && !a.instalada);
  const podeDesligar = kitSemDependencias(p.entrada.version);
  const desligar = podeDesligar ? dedup.filter((a) => a.estado === 'duplicada' && a.auto && a.dependentes.length === 0) : [];
  for (const a of instalar) await rodar(['plugin', 'install', a.id]);
  for (const a of desligar) await rodar(['plugin', 'disable', a.id, '--scope', 'user']);
  const lista = instalar.length + desligar.length > 0 ? await listarPlugins(rodar) : p.lista;
  const base = p.item.estado === 'igual' ? [] : [p.item.detalhe];
  // Sem a lista de depois dos comandos não há o que conferir: a velha não vale.
  if (lista === null) return { item: item.falhou(nome, [...base, 'não consegui conferir a lista de plugins'].join('; '), 'rode claude plugin list'), entrada: p.entrada, lista, dedup };
  const faltam = instalar.filter((a) => !lista.has(a.id));
  const ligadas = desligar.filter((a) => lista.get(a.id)?.enabled === true);
  const partes = [...base];
  const consertos = [];
  const instaladas = instalar.filter((a) => lista.has(a.id));
  if (instaladas.length > 0) partes.push(`dependências instaladas: ${instaladas.map((a) => a.nome).join(', ')}`);
  for (const a of dedup) {
    if (a.estado === 'duplicada' && !a.auto) {
      partes.push(a.dependentes.length > 0
        ? `${a.nome} em dobro com ${a.equivalente}; as duas fazem o mesmo, e ${a.id} fica ligada porque ${dependem(a.dependentes)}`
        : `${a.nome} em dobro com ${a.equivalente}; as duas fazem o mesmo. Para ficar com uma: ${comando('disable', a.id)}`);
    } else if (a.estado === 'duplicada' && !podeDesligar) partes.push(`${a.nome} em dobro com ${a.equivalente}; atualize o hadouken-kit para desligar a cópia em dobro`);
    else if (a.estado === 'duplicada' && a.dependentes.length > 0) partes.push(`${a.nome} em dobro com ${a.equivalente}; a cópia do kit fica ligada porque ${dependem(a.dependentes)}`);
    else if (a.estado === 'duplicada' && !ligadas.includes(a)) partes.push(`${a.nome} já instalado via ${a.equivalente}; cópia do kit desligada`);
    else if (a.estado === 'ausente' && a.instalada) partes.push(`${a.id} está desligado e não há outra cópia. Religue: ${comando('enable', a.id)}`);
    else if (a.estado === 'propria' && a.desligada !== null) partes.push(`${a.desligada} está desligado; vale a cópia do kit ${a.id}`);
    if (a.versao !== null) partes.push(`${a.equivalente} na ${a.versao.equivalente}, testada ${a.versao.testada}`);
  }
  if (faltam.length > 0) {
    partes.push(`faltam dependências: ${faltam.map((a) => a.nome).join(', ')}`);
    consertos.push(...faltam.map((a) => comando('install', a.id)));
  }
  if (ligadas.length > 0) {
    partes.push(`não desligou a cópia do kit: ${ligadas.map((a) => a.nome).join(', ')}`);
    consertos.push(...ligadas.map((a) => comando('disable', a.id)));
  }
  if (consertos.length > 0) return { item: item.falhou(nome, partes.join('; '), consertos.map((c) => `rode ${c}`).join('; ')), entrada: p.entrada, lista, dedup };
  if (partes.length === base.length) return { ...p, lista, dedup };
  return { item: item.ok(nome, partes.join('; ')), entrada: p.entrada, lista, dedup };
}

// O REA: instala ou atualiza; liga com Node aceito pelo rea-agents
// (nodeServe) só na primeira instalação; já instalado e desligado, foi o
// usuário quem desligou, e fica desligado (revisão final, Important 9). Com
// Node fora da faixa, desliga e marca pulado.
export async function passoRea(rodar, versaoNode) {
  const nome = 'hadouken-rea';
  const p = await passoPlugin(rodar, ID_REA, nome);
  if (p.entrada === null) return p.item;
  const quer = nodeServe(versaoNode);
  const pulado = item.pulado(nome, `Node ${versao(versaoNode)}; o REA pede 22.19+, 24.11+ ou 26+`);
  if (p.entrada.enabled === quer) return quer ? p.item : pulado;
  if (quer && p.item.estado === 'igual') return { ...item.igual(nome), detalhe: 'desligado por você' };
  if (quer && !p.item.detalhe.startsWith('instalado')) return item.ok(nome, `${p.item.detalhe}; continua desligado por você`);
  await rodar(['plugin', quer ? 'enable' : 'disable', ID_REA]);
  const e = (await listarPlugins(rodar))?.get(ID_REA);
  if (!e || e.enabled !== quer) return item.falhou(nome, quer ? 'não ligou' : 'não desligou', `rode claude plugin ${quer ? 'enable' : 'disable'} ${ID_REA}`);
  if (!quer) return pulado;
  return p.item.estado === 'igual' ? item.ok(nome, 'ligado') : item.ok(nome, `${p.item.detalhe}, ligado`);
}

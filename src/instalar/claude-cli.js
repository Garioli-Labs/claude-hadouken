import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { nodeServe } from '../../rea/lancar.mjs';
import { caminhoCmd, caminhoSeguro } from '../painel/instalar-painel.js';
import { item } from './itens.js';

// O `claude` do instalador (spec v0.5.2 §4 e §6). criarClaude devolve um
// `rodar(args)` que nunca rejeita. O caminho do claude vem do script
// (HADOUKEN_CLAUDE) e passa no caminhoSeguro; cada argumento é constante
// deste projeto e casa com ARG. No Windows, o claude.cmd do npm só roda por
// um shell: cmd.exe /d /s /c do System32 com a linha entre aspas e
// windowsVerbatimArguments, como o painel (instalar-painel.js). O cwd é a
// casa do usuário, nunca o projeto aberto. A verdade de cada passo é o
// `claude plugin list --json` depois dele, nunca o texto da saída.

export const ID_PRINCIPAL = 'claude-hadouken@claude-hadouken';
export const ID_KIT = 'hadouken-kit@claude-hadouken';
export const ID_REA = 'hadouken-rea@claude-hadouken';
// As dependências do kit/.claude-plugin/plugin.json, como ids da lista.
export const DEPENDENCIAS_KIT = Object.freeze([
  'claude-hadouken@claude-hadouken', 'superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken',
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

// O kit e as dependências dele. O `plugin update` só troca a versão do kit e
// não instala uma dependência nova (revisão final da v0.5.2, Critical 2): se
// falta alguma, roda o `plugin install` do kit, que as traz, e confere de
// novo. Devolve também a lista final, que diz quais cópias novas estão
// prontas para a atualização automática.
export async function passoKit(rodar) {
  const nome = 'hadouken-kit';
  const p = await passoPlugin(rodar, ID_KIT, nome);
  if (p.entrada === null) return p;
  const faltam = (l) => DEPENDENCIAS_KIT.filter((d) => !l?.has(d));
  let lista = p.lista;
  if (faltam(lista).length > 0) {
    await rodar(['plugin', 'install', ID_KIT]);
    lista = await listarPlugins(rodar);
  }
  const ainda = faltam(lista);
  if (ainda.length === 0) return { ...p, lista };
  return { item: item.falhou(nome, `faltam dependências: ${ainda.map((d) => d.split('@')[0]).join(', ')}`, `rode claude plugin install ${ID_KIT}`), entrada: p.entrada, lista };
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

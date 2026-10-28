import fs from 'node:fs';
import path from 'node:path';
import { apagar, fechar } from '../base.js';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { lerConfiguracao } from '../config/ler.js';

// Aviso de versão nova (spec v0.5.3 VS Code §2.4). Uma consulta à última
// release do GitHub a cada 6 h no máximo (forcar pula as 6 h, nunca a
// trava), uma por vez entre as janelas: trava versao-nova.lock criada com
// 'wx', vencida em 30 s, como ARQ_TRAVA em uso/painel.js. Só uma tag
// vMAJ.MIN.PAT de release publicada (sem draft nem prerelease) grava; o
// resto deixa o arquivo como estava. A resposta tem teto de 256 KiB, medido
// antes do JSON.parse. Nunca lança.

export const URL_RELEASE = 'https://api.github.com/repos/Garioli-Labs/claude-hadouken/releases/latest';
export const ARQ_VERSAO = 'versao-nova.json';
export const ARQ_TRAVA_VERSAO = 'versao-nova.lock';
export const INTERVALO_VERSAO_MS = 6 * 3_600_000;
const TRAVA_VENCIDA_MS = 30_000;
const RESPOSTA_MAX_BYTES = 256 * 1024;
const TAG = /^v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const VERSAO = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const buscarPadrao = (url, opcoes) => fetch(url, opcoes);

export function compararVersoes(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function versaoInstalada(raizPlugin) {
  try {
    if (typeof raizPlugin !== 'string' || raizPlugin === '') return null;
    const l = lerJson(path.join(raizPlugin, '.claude-plugin', 'plugin.json'), 16 * 1024);
    const v = l.ok && ehObjeto(l.valor) ? l.valor.version : null;
    return typeof v === 'string' && VERSAO.test(v) ? v : null;
  } catch {
    return null;
  }
}

function lerGuardada(dir) {
  try {
    const l = lerJson(path.join(dir, ARQ_VERSAO), 1024);
    const v = l.ok && ehObjeto(l.valor) ? l.valor : null;
    if (v === null || typeof v.versao !== 'string' || !VERSAO.test(v.versao) || !Number.isFinite(v.consultadaEm)) return null;
    return { versao: v.versao, consultadaEm: v.consultadaEm };
  } catch {
    return null;
  }
}

export function estadoVersao({ dir, raizPlugin } = {}) {
  const instalada = versaoInstalada(raizPlugin);
  const guardada = typeof dir === 'string' ? lerGuardada(dir) : null;
  const nova = instalada !== null && guardada !== null && compararVersoes(guardada.versao, instalada) > 0 ? guardada.versao : null;
  return { nova, instalada };
}

function avisoLigado(dir) {
  try {
    return lerConfiguracao(dir).itens.find((i) => i.id === 'painel.avisarVersaoNova')?.valor !== false;
  } catch {
    return true;
  }
}

function travaVencida(arquivo, agoraMs) {
  try {
    const info = fs.lstatSync(arquivo);
    const idade = agoraMs - info.mtimeMs;
    return info.isFile() && (idade > TRAVA_VENCIDA_MS || idade < -5 * 60_000);
  } catch (e) {
    return e?.code === 'ENOENT';
  }
}

function pegarTrava(dir, agoraMs) {
  const arquivo = path.join(dir, ARQ_TRAVA_VERSAO);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let fd;
    try {
      fd = fs.openSync(arquivo, 'wx');
    } catch (e) {
      if (e?.code !== 'EEXIST' || tentativa > 0 || !travaVencida(arquivo, agoraMs)) return null;
      apagar(arquivo);
      continue;
    }
    fechar(fd);
    return arquivo;
  }
  return null;
}

// A tag da release, já como versão, ou null.
async function consultar(buscar) {
  const r = await buscar(URL_RELEASE, {
    headers: { 'User-Agent': 'claude-hadouken', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!r || r.ok !== true) return { falhou: true };
  const texto = await r.text();
  if (typeof texto !== 'string' || Buffer.byteLength(texto, 'utf8') > RESPOSTA_MAX_BYTES) return { falhou: true };
  const v = JSON.parse(texto);
  if (!ehObjeto(v)) return { falhou: true };
  if (v.draft !== false || v.prerelease !== false || typeof v.tag_name !== 'string') return { versao: null };
  const m = TAG.exec(v.tag_name);
  return { versao: m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null };
}

export async function talvezConsultarVersao({ forcar = false, agoraMs = Date.now(), buscar = buscarPadrao, dir, raizPlugin } = {}) {
  let trava = null;
  try {
    if (typeof dir !== 'string' || dir === '' || !Number.isFinite(agoraMs)) return { motivo: 'falhou' };
    if (!avisoLigado(dir)) return { motivo: 'desligado' };
    const guardada = lerGuardada(dir);
    if (forcar !== true && guardada !== null && agoraMs - guardada.consultadaEm >= 0 && agoraMs - guardada.consultadaEm < INTERVALO_VERSAO_MS) {
      return { motivo: 'recente' };
    }
    trava = pegarTrava(dir, agoraMs);
    if (trava === null) return { motivo: 'travado' };
    const r = await consultar(buscar);
    if (r.falhou) return { motivo: 'falhou' };
    if (r.versao === null) return { motivo: 'consultou' };
    return gravarJsonAtomico(path.join(dir, ARQ_VERSAO), { versao: r.versao, consultadaEm: agoraMs }).ok
      ? { motivo: 'consultou' }
      : { motivo: 'falhou' };
  } catch {
    return { motivo: 'falhou' };
  } finally {
    if (trava !== null) apagar(trava);
  }
}

const RAIZ_INSTALADOR = 'https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main';
export function comandoAtualizar(plataforma) {
  return plataforma === 'win32'
    ? { shell: 'powershell', texto: `irm ${RAIZ_INSTALADOR}/install.ps1 | iex` }
    : { shell: 'posix', texto: `curl -fsSL ${RAIZ_INSTALADOR}/install.sh | bash` };
}

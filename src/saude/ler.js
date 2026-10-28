import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerJson } from '../estado.js';
import { configSaude } from '../config/ler.js';
import { lerTravaPid } from './trava-pid.js';
import { sanearNome } from './faixas.js';

// O lado dos hooks da saúde (spec v0.5.5 §6.A). Eles só leem saude.json e,
// quando ele está velho, disparam o coletor desanexado (coletor-main.js):
// nunca coletam nem esperam. A trava saude.lock, criada pelo coletor, impede
// dois disparos seguidos; uma trava de mais de 30 s é de coletor morto.

export const ARQ_SAUDE = 'saude.json';
export const ARQ_TRAVA_SAUDE = 'saude.lock';
export const INTERVALO_COLETA_MS = 60_000;
export const LEITURA_VALE_MS = 5 * 60_000;
export const TRAVA_SAUDE_VENCE_MS = 30_000;
const SAUDE_MAX_BYTES = 256 * 1024;
const PROCESSOS_MAX = 80;
const CLASSES = new Set(['sistema', 'claude', 'hadouken', 'vscode', 'navegador', 'node-dev', 'outro']);
const FONTES = ['processos', 'cpuCarga', 'cpuTemp', 'gpu', 'bateria', 'disco'];

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const naFaixa = (v, min, max) => (Number.isFinite(v) && v >= min && v <= max ? v : null);
const bytes = (v) => naFaixa(v, 0, Number.MAX_SAFE_INTEGER);
const fonte = (v) => (v === 'ok' || v === 'prazo' ? v : 'na');

function processoValido(p) {
  if (!ehObjeto(p) || !Number.isInteger(p.pid) || p.pid < 0 || typeof p.nome !== 'string') return null;
  const item = {
    pid: p.pid,
    ppid: Number.isInteger(p.ppid) && p.ppid >= 0 ? p.ppid : 0,
    nome: sanearNome(p.nome),
    rssBytes: bytes(p.rssBytes) ?? 0,
    cpuPct: naFaixa(p.cpuPct, 0, 100_000) ?? 0,
    classe: CLASSES.has(p.classe) ? p.classe : 'outro',
  };
  if (item.classe === 'hadouken') item.script = typeof p.script === 'string' && /^[a-z0-9-]{1,40}$/.test(p.script) ? p.script : null;
  return item;
}

// saude.json é escrito pelo próprio hadouken, mas pode ser trocado: cada campo
// é conferido e o que não confere vira null (ou sai, no caso dos processos).
function validarLeitura(j) {
  if (!ehObjeto(j) || j.versao !== 1 || !Number.isFinite(j.em)) return null;
  const ram = ehObjeto(j.ram) ? j.ram : {};
  const cpu = ehObjeto(j.cpu) ? j.cpu : {};
  const gpu = ehObjeto(j.gpu) ? j.gpu : {};
  const disco = ehObjeto(j.disco) ? j.disco : {};
  const fontes = ehObjeto(j.fontes) ? j.fontes : {};
  const bat = ehObjeto(j.bateria) ? j.bateria : null;
  return {
    versao: 1,
    em: j.em,
    ram: { totalBytes: bytes(ram.totalBytes), livreBytes: bytes(ram.livreBytes), usadaPct: naFaixa(ram.usadaPct, 0, 100) },
    cpu: { cargaPct: naFaixa(cpu.cargaPct, 0, 100), tempC: naFaixa(cpu.tempC, -50, 150) },
    gpu: {
      nome: typeof gpu.nome === 'string' ? sanearNome(gpu.nome) || null : null,
      tempC: naFaixa(gpu.tempC, -50, 150),
      usoPct: naFaixa(gpu.usoPct, 0, 100),
    },
    bateria: bat === null ? null : { pct: naFaixa(bat.pct, 0, 100), naTomada: typeof bat.naTomada === 'boolean' ? bat.naTomada : null },
    disco: { dadosLivreBytes: bytes(disco.dadosLivreBytes), projetoLivreBytes: bytes(disco.projetoLivreBytes) },
    processos: (Array.isArray(j.processos) ? j.processos.slice(0, PROCESSOS_MAX) : []).map(processoValido).filter(Boolean),
    fontes: Object.fromEntries(FONTES.map((k) => [k, fonte(fontes[k])])),
  };
}

// { leitura, idadeMs }: leitura null quando falta, não vale, é do futuro ou
// tem mais de 5 min (idadeMs diz quão velha, quando dá para saber). Nunca lança.
export function lerSaude(dir, agoraMs) {
  try {
    const r = lerJson(path.join(dir, ARQ_SAUDE), SAUDE_MAX_BYTES);
    if (!r.ok) return { leitura: null, idadeMs: null };
    const leitura = validarLeitura(r.valor);
    if (leitura === null) return { leitura: null, idadeMs: null };
    const idadeMs = agoraMs - leitura.em;
    if (idadeMs < 0) return { leitura: null, idadeMs: null };
    return { leitura: idadeMs > LEITURA_VALE_MS ? null : leitura, idadeMs };
  } catch {
    return { leitura: null, idadeMs: null };
  }
}

function mtimeMs(arq) {
  try { return fs.statSync(arq).mtimeMs; } catch { return null; }
}

// A trava ilegível (antiga, gravada pela metade) conta pela data do arquivo.
export function travaViva(dir, agoraMs) {
  const arq = path.join(dir, ARQ_TRAVA_SAUDE);
  const inicio = lerTravaPid(arq)?.inicioMs ?? mtimeMs(arq);
  return inicio !== null && agoraMs - inicio < TRAVA_SAUDE_VENCE_MS;
}

// Dispara o coletor quando saude.json tem mais de 1 min (ou é do futuro) e
// não há coletor vivo. true = disparou. Nunca lança nem espera.
export function talvezColetar(dir, agoraMs, { disparar = dispararColetor, ligado, dirProjeto } = {}) {
  try {
    if (typeof dir !== 'string' || !Number.isFinite(agoraMs)) return false;
    if (!(ligado ?? configSaude(dir).ligado)) return false;
    const m = mtimeMs(path.join(dir, ARQ_SAUDE));
    if (m !== null && m <= agoraMs && agoraMs - m < INTERVALO_COLETA_MS) return false;
    if (travaViva(dir, agoraMs)) return false;
    const p = disparar(dirProjeto === undefined ? {} : { dirProjeto });
    if (typeof p?.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

const COLETOR_MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'coletor-main.js');

// O adaptador real: o mesmo jeito de dispararPainel (session-start.js), sem
// janela nem saída, solto do hook. child_process só carrega aqui, uma vez por
// minuto no máximo, e não em cada hook.
export async function dispararColetor({ dirProjeto } = {}) {
  const { spawn } = await import('node:child_process');
  const args = [COLETOR_MAIN];
  if (typeof dirProjeto === 'string' && dirProjeto !== '') args.push(dirProjeto);
  const filho = spawn(process.execPath, args, { cwd: path.dirname(COLETOR_MAIN), detached: true, stdio: 'ignore', windowsHide: true });
  filho.on('error', () => {});
  filho.unref();
}

export const MARCA_DISPARO = 'saude-disparo.marca';

// O disparo dos hooks e da barra. Nenhum coletor de verdade sobe dos testes:
// com HADOUKEN_SAUDE_DISPARAR=0 o disparo vira um marcador na pasta de dados
// (o teste confere); sob node --test (NODE_TEST_CONTEXT, herdado pelos hooks
// que os testes rodam), nada. HADOUKEN_SAUDE_DISPARAR=1 força o real.
export async function dispararDoHook(dir, pedido) {
  try {
    const v = process.env.HADOUKEN_SAUDE_DISPARAR;
    if (v === '0') fs.writeFileSync(path.join(dir, MARCA_DISPARO), String(Date.now()));
    else if (v === '1' || process.env.NODE_TEST_CONTEXT === undefined) await dispararColetor(pedido);
  } catch { /* sem coleta agora; o próximo hook tenta */ }
}

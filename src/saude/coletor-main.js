import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirDados } from '../base.js';
import { gravarJsonAtomico } from '../estado.js';
import { configSaude } from '../config/ler.js';
import { lerTextoSemLink } from '../guarda/arquivo.js';
import { anexarEvento } from '../guarda/registros.js';
import { caminhos } from '../aprendizado/arquivos.js';
import { coletar as coletarReal, leituraSoRam } from './coletor.js';
import { executar } from './executar.js';
import { encerraveis } from './processos.js';
import { repararDados } from './reparo.js';
import { limparDados } from './limpeza.js';
import { atualizarConflitos } from './conflitos.js';
import { ARQ_SAUDE, ARQ_TRAVA_SAUDE, travaViva } from './ler.js';
import { conteudoTrava, lerTravaPid, tokenDaTrava } from './trava-pid.js';

// O coletor desanexado (spec v0.5.5 §6.A e §6.C), disparado por talvezColetar
// (ler.js). Uma passada: pega saude.lock, coleta com prazo (estourou: só a
// RAM), encerra processo do próprio hadouken pendurado (com
// saude.liberarProprios), repara os JSON de estado, limpa a pasta de dados,
// grava saude.json e solta a trava. Prioridade baixa; tudo em 8 s.

const PRAZO_TOTAL_MS = 8000;
const PRAZO_COLETA_MS = 7000;

function pegarTravaSaude(dir, agoraMs, token) {
  const arq = path.join(dir, ARQ_TRAVA_SAUDE);
  let antiga = null;
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(arq, conteudoTrava({ token, prazoMs: PRAZO_TOTAL_MS, agoraMs, script: 'coletor-main' }), { flag: 'wx' });
      return { ok: true, antiga };
    } catch (e) {
      if (e?.code !== 'EEXIST' || travaViva(dir, agoraMs)) return { ok: false };
      // Trava de coletor morto ou pendurado: guarda quem era, para encerraveis.
      antiga = lerTravaPid(arq);
      try { fs.unlinkSync(arq); } catch { return { ok: false }; }
    }
  }
  return { ok: false };
}

function soltarTravaSaude(dir, token) {
  const arq = path.join(dir, ARQ_TRAVA_SAUDE);
  try {
    const l = lerTextoSemLink(arq, 1024);
    if (l.ok && tokenDaTrava(l.texto) === token) fs.unlinkSync(arq);
  } catch {
    /* vence sozinha em 30 s */
  }
}

// Sem saude.json novo (disco cheio, arquivo impossível de gravar), o mtime
// velho faria cada hook e cada redesenho da barra subir outro coletor. Só a
// data anda: a leitura velha continua velha pelo `em` de dentro (lerSaude).
// Sem saude.json nenhum, um vazio faz o mesmo papel (lerSaude o lê como
// "sem leitura").
function adiarProxima(dir, agoraMs) {
  const arq = path.join(dir, ARQ_SAUDE);
  const t = new Date(agoraMs);
  try {
    fs.utimesSync(arq, t, t);
  } catch {
    try {
      fs.writeFileSync(arq, '', { flag: 'wx' });
      fs.utimesSync(arq, t, t);
    } catch { /* nada a fazer; o próximo hook tenta */ }
  }
}

async function coletarComPrazo(coletar, prazoMs, agoraMs) {
  let timer;
  const estouro = new Promise((ok) => { timer = setTimeout(() => ok(null), prazoMs); });
  try {
    const l = await Promise.race([Promise.resolve().then(coletar), estouro]);
    return l ?? leituraSoRam(agoraMs, os);
  } catch {
    return leituraSoRam(agoraMs, os);
  } finally {
    clearTimeout(timer);
  }
}

function liberarPendurados(dir, leitura, antiga, agoraMs, matar, pidProprio) {
  const travas = [antiga, lerTravaPid(caminhos(dir).trava)].filter((t) => t !== null && t.pid !== pidProprio);
  const encerrados = [];
  for (const pid of encerraveis(leitura.processos, travas, agoraMs)) {
    if (pid === pidProprio) continue;
    try {
      matar(pid);
    } catch {
      continue;
    }
    encerrados.push(pid);
    const script = travas.find((t) => t.pid === pid).script;
    anexarEvento(dir, 'reparo', `encerrado:${script}`, agoraMs);
  }
  return encerrados;
}

// deps: dir, agoraMs, coletar (async, sem argumentos), matar(pid), config
// (de configSaude), prazoColetaMs, pidProprio, conflitos ({ dir, agoraMs } →
// { lido }). Nunca lança.
export async function rodarColetor({
  dir, agoraMs = Date.now(), coletar, matar = (pid) => process.kill(pid),
  config, prazoColetaMs = PRAZO_COLETA_MS, pidProprio = process.pid, conflitos = atualizarConflitos,
}) {
  const token = crypto.randomBytes(16).toString('hex');
  const trava = pegarTravaSaude(dir, agoraMs, token);
  if (!trava.ok) return { ok: false, motivo: 'ocupado' };
  try {
    const cfg = config ?? configSaude(dir);
    const leitura = await coletarComPrazo(coletar, prazoColetaMs, agoraMs);
    const encerrados = cfg.liberarProprios ? liberarPendurados(dir, leitura, trava.antiga, agoraMs, matar, pidProprio) : [];
    const reparos = repararDados(dir, agoraMs);
    const cortes = cfg.limpeza?.ligada ? limparDados(dir, { tetoMb: cfg.limpeza.mb, agoraMs }).cortes : [];
    const g = gravarJsonAtomico(path.join(dir, ARQ_SAUDE), leitura, { compacto: true });
    // Depois do saude.json: a barra não espera pelos conflitos (uma vez em 24 h).
    const c = cfg.conflitos ? conflitos({ dir, agoraMs }) : { lido: false };
    if (!g.ok) adiarProxima(dir, agoraMs);
    return { ok: g.ok, encerrados, reparos, cortes, conflitosLidos: c.lido };
  } catch {
    adiarProxima(dir, agoraMs);
    return { ok: false, motivo: 'erro' };
  } finally {
    soltarTravaSaude(dir, token);
  }
}

async function main() {
  // Rede de segurança: nada deste processo passa de 8 s.
  setTimeout(() => process.exit(0), PRAZO_TOTAL_MS + 500).unref();
  try { os.setPriority(19); } catch { /* sem permissão: segue normal */ }
  const dir = dirDados();
  if (dir === null) return;
  fs.mkdirSync(dir, { recursive: true });
  const dirProjeto = typeof process.argv[2] === 'string' ? process.argv[2] : null;
  const agoraMs = Date.now();
  await rodarColetor({
    dir,
    agoraMs,
    coletar: () => coletarReal({ agoraMs, plataforma: process.platform, executar, fs, os, dirDados: dir, dirProjeto }),
  });
}

const ehEntrada = (() => {
  try {
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (ehEntrada) main().catch(() => {}).finally(() => process.exit(0));

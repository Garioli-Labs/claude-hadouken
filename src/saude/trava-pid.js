import path from 'node:path';
import { lerTextoSemLink } from '../guarda/arquivo.js';

// Conteúdo das travas do hadouken que podem ficar penduradas (spec v0.5.5
// §9.1 item 6): o token do dono e mais pid, script, início e prazo, para a
// confirmação dupla de encerraveis (processos.js). A trava antiga, só com o
// token, continua valendo para soltar; ela só não serve para encerrar.

const TRAVA_MAX_BYTES = 1024;
const SCRIPT = /^[a-z0-9-]{1,40}$/;

// O script em execução, como encerraveis o vê na linha de comando.
export function scriptAtual(argv1 = process.argv[1]) {
  if (typeof argv1 !== 'string') return null;
  const nome = path.basename(argv1.replaceAll('\\', '/')).replace(/\.[cm]?js$/i, '').toLowerCase();
  return SCRIPT.test(nome) ? nome : null;
}

export function conteudoTrava({ token, prazoMs, agoraMs = Date.now(), pid = process.pid, script = scriptAtual() }) {
  return JSON.stringify({ token, pid, script, inicioMs: agoraMs, prazoMs });
}

function comoObjeto(texto) {
  try {
    const j = JSON.parse(texto);
    return j !== null && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

// O token do dono: o campo token da trava nova ou o texto inteiro da antiga.
export function tokenDaTrava(texto) {
  if (typeof texto !== 'string') return null;
  const j = comoObjeto(texto);
  return j === null ? texto : typeof j.token === 'string' ? j.token : null;
}

// { pid, script, inicioMs, prazoMs } ou null (ausente, link, antiga, lixo).
export function lerTravaPid(arquivo) {
  try {
    const l = lerTextoSemLink(arquivo, TRAVA_MAX_BYTES);
    if (!l.ok) return null;
    const j = comoObjeto(l.texto);
    if (j === null) return null;
    const { pid, script, inicioMs, prazoMs } = j;
    if (!Number.isInteger(pid) || pid <= 0 || typeof script !== 'string' || !SCRIPT.test(script)) return null;
    if (!Number.isFinite(inicioMs) || !Number.isFinite(prazoMs) || prazoMs <= 0) return null;
    return { pid, script, inicioMs, prazoMs };
  } catch {
    return null;
  }
}

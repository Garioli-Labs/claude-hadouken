import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';

// O estado que os hooks guardam da saúde (spec v0.5.5 §6.C): o modo leve
// (saude-modo.json), que acaba sozinho em 4 h, e o registro dos episódios de
// aviso (saude-avisos.json), que decidirAvisos (avisos.js) valida. Nunca lança.

export const ARQ_MODO = 'saude-modo.json';
export const ARQ_AVISOS = 'saude-avisos.json';
export const MODO_LEVE_MS = 4 * 3_600_000;
const FOLGA_RELOGIO_MS = 5 * 60_000;
const AVISOS_MAX_BYTES = 64 * 1024;
const NORMAL = Object.freeze({ leve: false, ateMs: null });

// Um prazo além de 4 h (e a folga do relógio) é arquivo forjado ou relógio
// que voltou: vale como normal.
export function lerModo(dir, agoraMs) {
  try {
    const r = lerJson(path.join(dir, ARQ_MODO), 4096);
    const v = r.ok ? r.valor : null;
    if (v === null || typeof v !== 'object' || v.leve !== true || !Number.isFinite(v.ateMs)) return { ...NORMAL };
    if (v.ateMs <= agoraMs || v.ateMs > agoraMs + MODO_LEVE_MS + FOLGA_RELOGIO_MS) return { ...NORMAL };
    return { leve: true, ateMs: v.ateMs };
  } catch {
    return { ...NORMAL };
  }
}

export function gravarModo(dir, leve, agoraMs) {
  try {
    const ateMs = leve ? agoraMs + MODO_LEVE_MS : null;
    const r = gravarJsonAtomico(path.join(dir, ARQ_MODO), { v: 1, leve: leve === true, ateMs });
    return r.ok ? { ok: true, ateMs } : { ok: false, ateMs: null };
  } catch {
    return { ok: false, ateMs: null };
  }
}

// O valor cru (decidirAvisos valida) ou undefined quando falta ou não é JSON.
export function lerRegistroAvisos(dir) {
  try {
    const r = lerJson(path.join(dir, ARQ_AVISOS), AVISOS_MAX_BYTES);
    return r.ok ? r.valor : undefined;
  } catch {
    return undefined;
  }
}

export function gravarRegistroAvisos(dir, registro) {
  try {
    return gravarJsonAtomico(path.join(dir, ARQ_AVISOS), registro, { compacto: true });
  } catch {
    return { ok: false };
  }
}

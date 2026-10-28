import path from 'node:path';
import { lerJson, gravarJsonAtomico } from '../estado.js';

// O último "hadouken" a animar na barra do VS Code (spec vscode §2.1). Sem
// trava: gravação pequena e atômica; o último vence. Nunca lança.
export const ARQ_EVENTO = 'ultimo-evento.json';
const TIPOS = new Set(['leitura', 'guarda', 'alerta', 'aprendizado']);
const URGENCIAS = new Set(['calma', 'atencao', 'urgente']);

export function registrarEvento(dir, tipo, urgencia, agoraMs) {
  try {
    if (typeof dir !== 'string' || !TIPOS.has(tipo) || !URGENCIAS.has(urgencia) || !Number.isSafeInteger(agoraMs)) return false;
    return gravarJsonAtomico(path.join(dir, ARQ_EVENTO), { tipo, urgencia, em: agoraMs }).ok === true;
  } catch {
    return false;
  }
}

export function ultimoEvento(dir) {
  try {
    if (typeof dir !== 'string') return null;
    const l = lerJson(path.join(dir, ARQ_EVENTO), 1024);
    const v = l.ok ? l.valor : null;
    return v && TIPOS.has(v.tipo) && URGENCIAS.has(v.urgencia) && Number.isSafeInteger(v.em) ? { tipo: v.tipo, urgencia: v.urgencia, em: v.em } : null;
  } catch {
    return null;
  }
}

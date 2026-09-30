import fs from 'node:fs';
import { lerJson } from '../estado.js';

// Leitura dos arquivos novos da guarda (spec v0.4.0 §14): lstat antes, então
// um link simbólico no lugar do arquivo é 'invalido' e nunca é seguido, e o
// teto de bytes é conferido antes de abrir. lerJson confere de novo pelo
// fstat do descritor. A troca entre o lstat e o open é o limite honesto de
// SECURITY.md (processo do mesmo usuário). Nunca lança.
// 'ausente' só quando o lstat não acha nada. lerJson também devolve 'ausente'
// quando o open falha num arquivo presente (sem permissão de leitura, preso
// por outro processo no Windows, apagado entre o lstat e o open); aqui isso
// vira 'invalido', porque o arquivo existe (spec §4.5: trava existente mas
// ilegível conta como disparada, e um chmod não pode soltar a guarda).
export function lerSemLink(arquivo, maxBytes) {
  try {
    const info = fs.lstatSync(arquivo, { throwIfNoEntry: false });
    if (!info) return { ok: false, motivo: 'ausente' };
    if (!info.isFile()) return { ok: false, motivo: 'invalido' };
    if (info.size > maxBytes) return { ok: false, motivo: 'grande' };
    const lido = lerJson(arquivo, maxBytes);
    return !lido.ok && lido.motivo === 'ausente' ? { ok: false, motivo: 'invalido' } : lido;
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
}

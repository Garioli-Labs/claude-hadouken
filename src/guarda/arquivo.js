import fs from 'node:fs';
import { lerJson, lerLimitado } from '../estado.js';

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

// O texto cru, com as mesmas regras do lerSemLink (lstat antes, link é
// 'invalido', teto antes de abrir e de novo pelo fstat do lerLimitado), para
// o arquivo que não é JSON da guarda: os settings de projeto que a P5 confere
// (rodada 1 da revisão da Task 0 da parte 2). Não faz o JSON.parse, então um
// settings com BOM ou fora do JSON estrito ainda é lido. Devolve
// { ok: true, texto } (UTF-8) ou { ok: false, motivo }. Nunca lança.
export function lerTextoSemLink(arquivo, maxBytes) {
  try {
    const info = fs.lstatSync(arquivo, { throwIfNoEntry: false });
    if (!info) return { ok: false, motivo: 'ausente' };
    if (!info.isFile()) return { ok: false, motivo: 'invalido' };
    if (info.size > maxBytes) return { ok: false, motivo: 'grande' };
    const lido = lerLimitado(arquivo, maxBytes);
    if (!lido.ok) return { ok: false, motivo: lido.motivo === 'grande' ? 'grande' : 'invalido' };
    return { ok: true, texto: lido.bytes.toString('utf8') };
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
}

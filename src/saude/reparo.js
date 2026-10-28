import fs from 'node:fs';
import path from 'node:path';
import { lerJson } from '../estado.js';
import { anexarEvento } from '../guarda/registros.js';

// Autorreparo dos JSON de estado (spec v0.5.5 §6.C). Arquivo regular que não
// é JSON vai para quarentena, `<nome>.corrompido-<AAAA-MM-DD-HHmm>`, com no
// máximo 3 cópias por arquivo. Nada é recriado: o ausente já é o padrão
// seguro de cada leitor. Cada reparo vira o evento 'reparo' da guarda.
//
// guarda.json fica de fora de propósito: ilegível ele vale como trava
// disparada (fail-closed, guarda/travas.js), e tirá-lo do lugar soltaria a
// guarda. Só a liberação o reescreve. Nunca lança.

export const ARQUIVOS_ESTADO = Object.freeze([
  'estado.json', 'liberacao.json', 'guarda-eventos.json', 'alertas.json', 'projecao.json',
  'uso-oficial.json', 'config.json', 'saude-avisos.json', 'tetos.json', 'saude-modo.json',
]);
const COPIAS_MAX = 3;
export const MARCA_QUARENTENA = '.corrompido-';

const doisDig = (n) => String(n).padStart(2, '0');
function carimbo(agoraMs) {
  const d = new Date(agoraMs);
  return `${d.getUTCFullYear()}-${doisDig(d.getUTCMonth() + 1)}-${doisDig(d.getUTCDate())}-${doisDig(d.getUTCHours())}${doisDig(d.getUTCMinutes())}`;
}

function ehArquivoRegular(arq) {
  try { return fs.lstatSync(arq).isFile(); } catch { return false; }
}

function nomeLivre(dir, base) {
  if (!fs.existsSync(path.join(dir, base))) return base;
  for (let i = 2; i < 100; i++) if (!fs.existsSync(path.join(dir, `${base}-${i}`))) return `${base}-${i}`;
  return null;
}

// Do mais novo para o mais velho, pelo nome (o carimbo ordena), e apaga o resto.
function podarCopias(dir, nome) {
  const prefixo = nome + MARCA_QUARENTENA;
  const copias = fs.readdirSync(dir)
    .filter((n) => n.startsWith(prefixo) && ehArquivoRegular(path.join(dir, n)))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const velha of copias.slice(COPIAS_MAX)) {
    try { fs.unlinkSync(path.join(dir, velha)); } catch { /* fica para a próxima */ }
  }
}

export function repararDados(dir, agoraMs) {
  const reparos = [];
  try {
    if (typeof dir !== 'string' || !Number.isFinite(agoraMs)) return reparos;
    for (const nome of ARQUIVOS_ESTADO) {
      const arq = path.join(dir, nome);
      if (lerJson(arq).motivo !== 'invalido' || !ehArquivoRegular(arq)) continue;
      const copia = nomeLivre(dir, nome + MARCA_QUARENTENA + carimbo(agoraMs));
      if (copia === null) continue;
      try {
        fs.renameSync(arq, path.join(dir, copia));
      } catch {
        continue;
      }
      reparos.push({ arquivo: nome, copia });
      try { podarCopias(dir, nome); } catch { /* poda é melhor esforço */ }
    }
    // Depois de mover tudo: guarda-eventos.json pode ter sido um dos reparados.
    for (const r of reparos) anexarEvento(dir, 'reparo', r.arquivo, agoraMs);
  } catch {
    // o que já foi movido fica na lista
  }
  return reparos;
}

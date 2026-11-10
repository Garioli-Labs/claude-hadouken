import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { regexOu } from '../util.js';

// Perfis do VS Code (v0.5.9, issue #7). O `code --install-extension` sem
// `--profile` instala só no perfil Default; quem abre as janelas noutro
// perfil não via a barra. O instalador passa a instalar também em cada perfil
// de userDataProfiles, no storage.json global do VS Code. Só os nomes saem do
// arquivo, e só os que passam pela lista de caracteres abaixo: o nome vai
// para a linha do cmd.exe no Windows, e aspas, %, ^, &, | e ! ficam fora.

// Sem ICU, uma propriedade Unicode numa regex literal quebra o módulo: a
// reserva aceita só ASCII e Latin-1.
const NOME = regexOu(String.raw`^[\p{L}\p{N} ._-]{1,60}$`, 'u', /^[A-Za-z0-9À-ÿ ._-]{1,60}$/u);
const TETO_PERFIS = 20;
const TETO_BYTES = 4 * 1024 * 1024;

// O storage.json do VS Code estável em cada sistema, ou null.
export function arquivoStorageVscode({ plataforma = process.platform, casa = os.homedir(), appData = process.env.APPDATA } = {}) {
  try {
    const p = plataforma === 'win32' ? path.win32 : path.posix;
    if (plataforma === 'win32') {
      return typeof appData === 'string' && p.isAbsolute(appData) ? p.join(appData, 'Code', 'User', 'globalStorage', 'storage.json') : null;
    }
    if (typeof casa !== 'string' || !p.isAbsolute(casa)) return null;
    if (plataforma === 'darwin') return p.join(casa, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'storage.json');
    return p.join(casa, '.config', 'Code', 'User', 'globalStorage', 'storage.json');
  } catch {
    return null;
  }
}

// Os nomes de userDataProfiles que passam pela lista, sem repetidos, até 20.
export function perfisDoVscode(texto) {
  try {
    const j = JSON.parse(texto);
    const lista = j !== null && typeof j === 'object' && Array.isArray(j.userDataProfiles) ? j.userDataProfiles : [];
    const nomes = [];
    for (const p of lista) {
      const n = p !== null && typeof p === 'object' ? p.name : null;
      if (typeof n === 'string' && NOME.test(n) && !nomes.includes(n)) nomes.push(n);
      if (nomes.length >= TETO_PERFIS) break;
    }
    return nomes;
  } catch {
    return [];
  }
}

// Lê os perfis desta máquina. Sem arquivo, grande demais ou inválido: [].
export function perfisInstalados(o = {}) {
  try {
    const arq = arquivoStorageVscode(o);
    if (arq === null) return [];
    const st = fs.statSync(arq);
    if (!st.isFile() || st.size > TETO_BYTES) return [];
    return perfisDoVscode(fs.readFileSync(arq, 'utf8'));
  } catch {
    return [];
  }
}

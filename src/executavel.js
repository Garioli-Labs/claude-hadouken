import fs from 'node:fs';
import path from 'node:path';

// Caminho absoluto de um executável pelo PATH, nunca pelo cwd (fix round 1
// da Task 10, Critical 1). Um nome solto no execFile/spawn é procurado pelo
// libuv: no Windows o do Node 20 olha o cwd do filho antes do PATH (e tenta
// .com e .exe), o do Node 24 ainda segue uma entrada "." do PATH, e no POSIX
// uma entrada vazia ou "." faz o mesmo. O cwd do /consumo é o repo do
// usuário, que pode ser hostil: um git.exe ou gh.exe plantado nele rodaria,
// sem shell nenhum. Por isso git e gh só rodam pelo caminho que sai daqui:
// - só entradas absolutas do PATH; no Windows, só com letra de unidade
//   (C:\...) ou UNC (\\servidor\...): "C:rel" e "\raiz" dependem do
//   diretório corrente e ficam de fora, como vazia, "." e relativas. Um par
//   de aspas em volta da entrada é tirado no Windows, como o próprio Windows
//   faz;
// - a entrada que é o cwd do processo é pulada: comparada resolvida (sem
//   diferença de caixa no Windows) e, se tiver o executável, também pelo
//   realpath (link, junção, nome curto 8.3);
// - no Windows só <nome>.exe (.cmd e .bat exigiriam um shell); no POSIX,
//   <nome> com bit de execução;
// - tem de ser arquivo regular (statSync segue link).
// Devolve o caminho absoluto ou null. Nunca lança. O resultado fica guardado
// no processo pela chave nome + valor do PATH + cwd.
// Módulo à parte de base.js de propósito: nada disto entra no caminho quente
// da statusline e dos hooks.

const WIN = process.platform === 'win32';
// Nome simples: começa por letra ou dígito, sem separador de pasta nem ":".
const NOME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMPLETO_WIN = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/;
const CACHE_MAX = 32;
const cache = new Map();

// Valor do PATH do processo, pela chave que existe (no Windows pode ser
// Path), ou null.
function valorDoPath() {
  const env = process.env;
  if (!WIN) return typeof env.PATH === 'string' ? env.PATH : null;
  const chave = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const v = chave === undefined ? undefined : env[chave];
  return typeof v === 'string' ? v : null;
}

// Entradas do PATH que são caminho completo, na ordem.
function entradas(valor) {
  const lista = [];
  for (const cru of valor.split(path.delimiter)) {
    let e = cru;
    if (WIN && e.length >= 2 && e.startsWith('"') && e.endsWith('"')) e = e.slice(1, -1);
    if (e === '' || e.includes('\0')) continue;
    if (WIN ? !COMPLETO_WIN.test(e) : !e.startsWith('/')) continue;
    lista.push(e);
  }
  return lista;
}

const chaveDir = (d) => (WIN ? path.resolve(d).toLowerCase() : path.resolve(d));

function realOuNull(d) {
  try {
    return chaveDir(fs.realpathSync.native(d));
  } catch {
    return null;
  }
}

function executavelEm(arq) {
  try {
    const st = fs.statSync(arq);
    if (!st.isFile()) return false;
    if (WIN) return true;
    if ((st.mode & 0o111) === 0) return false;
    fs.accessSync(arq, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function procurar(nome, valor, cwd) {
  const arquivo = WIN ? `${nome}.exe` : nome;
  const cwdChave = cwd === null ? null : chaveDir(cwd);
  let cwdReal;
  for (const dir of entradas(valor)) {
    if (cwdChave !== null && chaveDir(dir) === cwdChave) continue;
    const candidato = path.join(dir, arquivo);
    if (!executavelEm(candidato)) continue;
    if (cwd !== null) {
      if (cwdReal === undefined) cwdReal = realOuNull(cwd);
      if (cwdReal !== null && realOuNull(dir) === cwdReal) continue;
    }
    return path.resolve(candidato);
  }
  return null;
}

export function resolverExecutavel(nome) {
  try {
    if (typeof nome !== 'string' || !NOME.test(nome)) return null;
    const valor = valorDoPath();
    if (valor === null) return null;
    let cwd = null;
    try {
      cwd = process.cwd();
    } catch {
      // cwd apagado: não há pasta a pular (e nada pode ter sido plantado nela)
    }
    const chave = `${nome}\0${valor}\0${cwd ?? ''}`;
    if (cache.has(chave)) return cache.get(chave);
    const achado = procurar(nome, valor, cwd);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(chave, achado);
    return achado;
  } catch {
    return null;
  }
}

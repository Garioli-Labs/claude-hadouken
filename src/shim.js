import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirDados } from './estado.js';

// Shims estáveis (spec 8.1, S6). O settings.json do usuário aponta a
// statusLine (e o CLI) para <dirDados>/bin/<shim>, um caminho que não muda
// quando o plugin é atualizado. O SessionStart chama sincronizarShims a cada
// sessão: o shim aponta para a versão do plugin em uso e qualquer adulteração
// é desfeita. Cada shim é uma linha só, `await import("<file URL do alvo>");`:
// o caminho entra apenas como URL de arquivo (que escapa espaço, aspas, #, %,
// quebra de linha e todo não-ASCII) e passa por JSON.stringify; nada lido de
// outro lugar entra no conteúdo.

export const DIR_BIN = 'bin';
const ALVOS = Object.freeze({ 'statusline.mjs': 'statusline.js', 'cli.mjs': 'cli.js' });
// A raiz só é aceita se este arquivo existir nela como arquivo regular.
const ALVO_OBRIGATORIO = 'statusline.js';
// A mesma regra do loader de ESM do Node: URL de arquivo com / ou \ codificado
// é recusada no import (ERR_INVALID_MODULE_SPECIFIER). No POSIX um \ no nome de
// uma pasta vira %5C; o shim falharia a cada execução, então a raiz é recusada.
const SEPARADOR_CODIFICADO = /%2f|%5c/i;

// O_NOFOLLOW e O_NONBLOCK (onde existem): um link ou FIFO posto no lugar do
// shim entre o lstat e o open nunca é seguido nem trava a leitura. No Windows
// as constantes não existem; lá o lstat antes já barra links e junções.
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const RENOMEAR_TENTATIVAS = 3;
const RENOMEAR_ESPERA_MS = 20;
// No Windows um antivírus ou indexador pode segurar um .mjs recém-escrito por
// instantes; outros erros não melhoram tentando de novo.
const RENOMEAR_TRANSITORIOS = new Set(['EPERM', 'EACCES', 'EBUSY']);

const codigoErro = (e, padrao) => (typeof e?.code === 'string' ? e.code : padrao);
const apagar = (arquivo) => { try { fs.unlinkSync(arquivo); } catch { /* já não existe */ } };
const esperar = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* segue sem esperar */ }
};

let sequenciaTmp = 0;

// Raiz do plugin aceitável: string absoluta não vazia, sem NUL, que o loader
// de ESM consegue importar (SEPARADOR_CODIFICADO) e em que src/statusline.js é
// arquivo regular pelo lstat (nem link, nem pasta). Devolve a raiz resolvida
// (sem barra no fim nem `..`) ou null. Nunca lança.
function raizValida(raiz) {
  try {
    if (typeof raiz !== 'string' || raiz.length === 0 || raiz.includes('\0') || !path.isAbsolute(raiz)) return null;
    const resolvida = path.resolve(raiz);
    if (SEPARADOR_CODIFICADO.test(pathToFileURL(resolvida).pathname)) return null;
    const info = fs.lstatSync(path.join(resolvida, 'src', ALVO_OBRIGATORIO), { throwIfNoEntry: false });
    return info && info.isFile() ? resolvida : null;
  } catch {
    return null;
  }
}

// A pasta bin/ tem de ser pasta de verdade: se não existe, é criada; se é
// link, junção ou arquivo, nada é criado nem escrito através dela.
function pastaBin(dir) {
  const bin = path.join(dir, DIR_BIN);
  let info = fs.lstatSync(bin, { throwIfNoEntry: false });
  if (!info) {
    fs.mkdirSync(bin, { recursive: true });
    info = fs.lstatSync(bin, { throwIfNoEntry: false });
  }
  return info && info.isDirectory() ? bin : null;
}

// O shim já tem exatamente `esperado`? Abre sem seguir link, confere pelo
// descritor que é arquivo regular do tamanho certo e só então lê (no máximo
// esperado.length + 1 bytes). Qualquer dúvida é "diferente": regravar é seguro.
function mesmoConteudo(arquivo, esperado) {
  let fd;
  try {
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size !== esperado.length) return false;
    const lido = Buffer.alloc(esperado.length + 1);
    let total = 0;
    while (total < lido.length) {
      const n = fs.readSync(fd, lido, total, lido.length - total, null);
      if (n === 0) break;
      total += n;
    }
    return total === esperado.length && lido.subarray(0, total).equals(esperado);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* já fechado */ }
  }
}

// Grava num temporário da mesma pasta ('wx': nunca segue nem reaproveita o que
// estiver nesse nome) e renomeia por cima do shim. O rename troca a entrada,
// nunca escreve através dela. Falhou: o temporário é apagado e o erro sobe.
function gravarAtomico(arquivo, conteudo) {
  const tmp = path.join(path.dirname(arquivo), `.${path.basename(arquivo)}.${process.pid}.${Date.now()}.${sequenciaTmp++}.tmp`);
  try {
    fs.writeFileSync(tmp, conteudo, { flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') apagar(tmp);
    throw e;
  }
  for (let tentativa = 1; ; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      return;
    } catch (e) {
      if (!RENOMEAR_TRANSITORIOS.has(e?.code) || tentativa === RENOMEAR_TENTATIVAS) {
        apagar(tmp);
        throw e;
      }
      esperar(RENOMEAR_ESPERA_MS);
    }
  }
}

// Deixa um shim com `conteudo`. lstat primeiro: pasta → 'shim_invalido' (não
// se apaga pasta de ninguém); link, junção, FIFO ou socket → sai só a entrada
// (unlink nunca segue link nem mexe no alvo) e o shim é escrito do zero;
// arquivo regular igual → nada; diferente → substituído. Devolve 'igual',
// 'gravado' ou o motivo da falha. Nunca lança.
function sincronizarUm(bin, nome, conteudo) {
  try {
    const arquivo = path.join(bin, nome);
    const info = fs.lstatSync(arquivo, { throwIfNoEntry: false });
    if (info) {
      if (info.isDirectory()) return 'shim_invalido';
      if (!info.isFile()) fs.unlinkSync(arquivo);
      else if (mesmoConteudo(arquivo, conteudo)) return 'igual';
    }
    gravarAtomico(arquivo, conteudo);
    return 'gravado';
  } catch (e) {
    return codigoErro(e, 'shim');
  }
}

// Cria ou corrige <dirDados>/bin/statusline.mjs e cli.mjs para importar
// <raizPlugin>/src/statusline.js e cli.js. Só escreve o que mudou. Cada shim é
// tratado à parte, então um shim com problema não impede a correção do outro;
// a primeira falha vira o motivo. Motivos: 'sem_diretorio' (sem home; nenhum
// I/O), 'raiz_invalida', 'bin_invalido' (bin/ é link, junção ou arquivo; nada
// escrito), 'shim_invalido' (pasta no lugar de um shim) ou o código do erro de
// sistema. Nunca lança.
export function sincronizarShims(raizPlugin) {
  try {
    const dir = dirDados();
    if (dir === null) return { ok: false, motivo: 'sem_diretorio' };
    const raiz = raizValida(raizPlugin);
    if (raiz === null) return { ok: false, motivo: 'raiz_invalida' };
    const bin = pastaBin(dir);
    if (bin === null) return { ok: false, motivo: 'bin_invalido' };
    const alterados = [];
    let motivo = null;
    for (const [nome, alvo] of Object.entries(ALVOS)) {
      const url = pathToFileURL(path.join(raiz, 'src', alvo)).href;
      const r = sincronizarUm(bin, nome, Buffer.from(`await import(${JSON.stringify(url)});\n`, 'utf8'));
      if (r === 'gravado') alterados.push(nome);
      else if (r !== 'igual' && motivo === null) motivo = r;
    }
    return motivo === null ? { ok: true, alterados } : { ok: false, motivo };
  } catch (e) {
    return { ok: false, motivo: codigoErro(e, 'shim') };
  }
}

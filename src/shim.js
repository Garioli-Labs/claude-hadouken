import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirDados } from './base.js';

// Shims estáveis (spec 8.1, S6). O settings.json do usuário aponta a
// statusLine (e o CLI) para <dirDados>/bin/<shim>, um caminho que não muda
// quando o plugin é atualizado. O SessionStart chama sincronizarShims a cada
// sessão: o shim aponta para a versão do plugin em uso e qualquer adulteração
// é desfeita. Cada shim é uma linha só, `await import("<file URL do alvo>")`
// seguido de um .catch fixo: o caminho entra apenas como URL de arquivo (que
// escapa espaço, aspas, #, %, quebra de linha e todo não-ASCII) e passa por
// JSON.stringify; nada lido de outro lugar entra no conteúdo.
//
// crypto.randomBytes é chamado pelo objeto padrão de node:crypto (os testes o
// trocam ali para plantar um link no nome sorteado do temporário).

export const DIR_BIN = 'bin';
// O .catch cobre o alvo sumido: o plugin foi atualizado e a versão velha
// apagada antes do próximo SessionStart. A barra sai 0 sem imprimir nada
// (spec 6.4: nunca código 1 nem stack trace); o CLI avisa numa linha ASCII e
// sai 1. O JSON.stringify da linha escreve \n como os dois caracteres \ e n,
// então o shim continua uma linha só.
const LINHA_SEM_ARQUIVOS = 'claude-hadouken: plugin files not found - open a new session';
const SHIMS = Object.freeze({
  'statusline.mjs': { alvo: 'statusline.js', modelo: (url) => `await import(${url}).catch(() => {});\n` },
  'cli.mjs': {
    alvo: 'cli.js',
    modelo: (url) => `await import(${url}).catch(() => { process.stderr.write(${JSON.stringify(`${LINHA_SEM_ARQUIVOS}\n`)}); process.exitCode = 1; });\n`,
  },
});
// A raiz só é aceita se este arquivo existir nela como arquivo regular.
const ALVO_OBRIGATORIO = 'statusline.js';
// A mesma regra do loader de ESM do Node: URL de arquivo com / ou \ codificado
// é recusada no import (ERR_INVALID_MODULE_SPECIFIER). No POSIX um \ no nome de
// uma pasta vira %5C; o shim falharia a cada execução, então a raiz é recusada.
const SEPARADOR_CODIFICADO = /%2f|%5c/i;
// Namespace de dispositivo do Windows (\\?\ e \\.\, também com /): \\.\ vira
// file://./C:/... e o import falha; \\?\ desliga a normalização de caminhos.
// Raiz de plugin não vem daí. UNC comum (\\servidor\compartilhamento) segue
// aceito. No POSIX o path.resolve reduz // a /, então nada casa.
const DISPOSITIVO = /^[\\/]{2}[?.][\\/]/;

// O_NOFOLLOW e O_NONBLOCK (onde existem): um link ou FIFO posto no lugar do
// shim entre o lstat e o open nunca é seguido nem trava a leitura. No Windows
// as constantes não existem; lá o lstat antes já barra links e junções.
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const RENOMEAR_TENTATIVAS = 3;
const RENOMEAR_ESPERA_MS = 20;
// No Windows um antivírus ou indexador pode segurar um .mjs recém-escrito por
// instantes; outros erros não melhoram tentando de novo.
const RENOMEAR_TRANSITORIOS = new Set(['EPERM', 'EACCES', 'EBUSY']);
// Temporário da escrita atômica: .<shim>.<12 hex sorteados>.tmp. O sorteio
// impede plantar um link no nome antes da escrita (m-2).
const TMP_BYTES = 6;
const NOME_TMP = /^\.(?:statusline|cli)\.mjs\.[0-9a-f]{12}\.tmp$/;
// Temporários deixados por um processo morto entre a escrita e o rename:
// varridos depois de 1 h, no máximo 20 por sincronização.
const TMP_VELHO_MS = 3_600_000;
const TMP_VARRER_MAX = 20;

const codigoErro = (e, padrao) => (typeof e?.code === 'string' ? e.code : padrao);
const erroComCodigo = (code) => Object.assign(new Error(code), { code });
const apagar = (arquivo) => { try { fs.unlinkSync(arquivo); } catch { /* já não existe */ } };
const fechar = (fd) => { try { fs.closeSync(fd); } catch { /* já fechado */ } };
const esperar = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* segue sem esperar */ }
};

// Raiz do plugin aceitável: string absoluta não vazia, sem NUL, fora do
// namespace de dispositivo do Windows, que o loader de ESM consegue importar
// (SEPARADOR_CODIFICADO) e em que src/statusline.js é arquivo regular pelo
// lstat (nem link, nem pasta). Devolve a raiz resolvida (sem barra no fim nem
// `..`) ou null. Nunca lança.
function raizValida(raiz) {
  try {
    if (typeof raiz !== 'string' || raiz.length === 0 || raiz.includes('\0') || !path.isAbsolute(raiz)) return null;
    const resolvida = path.resolve(raiz);
    if (DISPOSITIVO.test(resolvida)) return null;
    if (SEPARADOR_CODIFICADO.test(pathToFileURL(resolvida).pathname)) return null;
    const info = fs.lstatSync(path.join(resolvida, 'src', ALVO_OBRIGATORIO), { throwIfNoEntry: false });
    return info && info.isFile() ? resolvida : null;
  } catch {
    return null;
  }
}

// A pasta bin/ tem de ser pasta de verdade: se não existe, é criada; se é
// link, junção ou arquivo, nada é criado nem escrito através dela. No POSIX,
// bin/ sem rwx para o dono (um chmod 555 de quem adulterou o shim) faria a
// criação do temporário falhar com EACCES a cada sessão: volta a 0o700, melhor
// esforço. No Windows o modo da pasta não barra criar arquivo (e o Node nem
// reporta o bit x), então nada muda lá.
function pastaBin(dir) {
  const bin = path.join(dir, DIR_BIN);
  let info = fs.lstatSync(bin, { throwIfNoEntry: false });
  if (!info) {
    fs.mkdirSync(bin, { recursive: true });
    info = fs.lstatSync(bin, { throwIfNoEntry: false });
  }
  if (!info || !info.isDirectory()) return null;
  if (process.platform !== 'win32' && (info.mode & 0o700) !== 0o700) {
    try { fs.chmodSync(bin, 0o700); } catch { /* a escrita dirá o motivo */ }
  }
  return bin;
}

// Remove até TMP_VARRER_MAX temporários de bin/ com mais de TMP_VELHO_MS. Só
// arquivo regular com exatamente o nome que gravarTmp gera; nada de pasta,
// link ou nome alheio, e unlink nunca segue link. Roda a cada sincronização:
// os shims só são regravados quando o plugin muda, então varrer só depois de
// gravar quase nunca rodaria. Melhor esforço: nunca lança.
function varrerTmpVelhos(bin) {
  try {
    const corte = Date.now() - TMP_VELHO_MS;
    let removidos = 0;
    for (const nome of fs.readdirSync(bin)) {
      if (removidos >= TMP_VARRER_MAX) break;
      if (!NOME_TMP.test(nome)) continue;
      const caminho = path.join(bin, nome);
      try {
        const info = fs.lstatSync(caminho);
        if (!info.isFile() || info.mtimeMs >= corte) continue;
        fs.unlinkSync(caminho);
        removidos++;
      } catch { /* sumiu ou sem permissão: segue */ }
    }
  } catch { /* pasta ilegível: fica para a próxima sincronização */ }
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
    if (fd !== undefined) fechar(fd);
  }
}

// Escreve `conteudo` num temporário novo de `pasta` com nome sorteado. lstat
// antes do 'wx': no Windows o CREATE_NEW atravessa uma junção pendente e
// criaria o alvo dela, fora de bin/; com o nome sorteado nada deveria existir
// ali, então qualquer entrada é plantada e a escrita falha com EEXIST sem
// tocá-la. Depois do 'wx' (O_CREAT|O_EXCL: nunca trunca nem reaproveita), o
// fstat confere que o aberto é arquivo regular, como em ativas.js. Um link
// plantado entre o lstat e o open continua possível (a mesma fronteira de
// confiança do usuário, N-2) e termina em erro, nunca em sucesso falso.
// Devolve o caminho do temporário; erro sobe para quem chama.
function gravarTmp(pasta, nome, conteudo) {
  const tmp = path.join(pasta, `.${nome}.${crypto.randomBytes(TMP_BYTES).toString('hex')}.tmp`);
  if (fs.lstatSync(tmp, { throwIfNoEntry: false })) throw erroComCodigo('EEXIST');
  const fd = fs.openSync(tmp, 'wx');
  let criado = false;
  try {
    if (!fs.fstatSync(fd).isFile()) throw erroComCodigo('tmp_invalido');
    criado = true;
    fs.writeFileSync(fd, conteudo);
  } catch (e) {
    fechar(fd);
    if (criado) apagar(tmp);
    throw e;
  }
  fechar(fd);
  return tmp;
}

// Shim somente leitura (attrib +R, chmod 444): no Windows o rename por cima
// dá EPERM enquanto a marca existir, e a adulteração ficaria. Tira a marca:
// lstat (arquivo regular sem escrita para o dono, nunca link), depois abre
// sem seguir link onde O_NOFOLLOW existe, confere de novo pelo fstat e só
// então fchmod 0o644 pelo descritor. Devolve true se mudou algo. Nunca lança.
function liberarEscrita(arquivo) {
  let fd;
  try {
    const info = fs.lstatSync(arquivo, { throwIfNoEntry: false });
    if (!info || !info.isFile() || (info.mode & 0o200) !== 0) return false;
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
    const aberto = fs.fstatSync(fd);
    if (!aberto.isFile() || (aberto.mode & 0o200) !== 0) return false;
    fs.fchmodSync(fd, 0o644);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fechar(fd);
  }
}

// Grava num temporário da mesma pasta e renomeia por cima do shim. O rename
// troca a entrada, nunca escreve através dela. EPERM/EACCES de um shim
// somente leitura: tira a marca e tenta de novo. Falhou: o temporário é
// apagado e o erro sobe.
function gravarAtomico(arquivo, conteudo) {
  const tmp = gravarTmp(path.dirname(arquivo), path.basename(arquivo), conteudo);
  for (let tentativa = 1; ; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      return;
    } catch (e) {
      if (!RENOMEAR_TRANSITORIOS.has(e?.code) || tentativa === RENOMEAR_TENTATIVAS) {
        apagar(tmp);
        throw e;
      }
      if (e.code === 'EBUSY' || !liberarEscrita(arquivo)) esperar(RENOMEAR_ESPERA_MS);
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
// <raizPlugin>/src/statusline.js e cli.js, e varre temporários velhos de bin/.
// Só escreve o que mudou. Cada shim é tratado à parte, então um shim com
// problema não impede a correção do outro; a primeira falha vira o motivo.
// Motivos: 'sem_diretorio' (sem home; nenhum I/O), 'raiz_invalida',
// 'bin_invalido' (bin/ é link, junção ou arquivo; nada escrito),
// 'shim_invalido' (pasta no lugar de um shim), 'tmp_invalido' (o temporário
// aberto não é arquivo regular), 'shim' (erro sem código) ou o código do erro
// de sistema. Nunca lança.
export function sincronizarShims(raizPlugin) {
  try {
    const dir = dirDados();
    if (dir === null) return { ok: false, motivo: 'sem_diretorio' };
    const raiz = raizValida(raizPlugin);
    if (raiz === null) return { ok: false, motivo: 'raiz_invalida' };
    const bin = pastaBin(dir);
    if (bin === null) return { ok: false, motivo: 'bin_invalido' };
    varrerTmpVelhos(bin);
    const alterados = [];
    let motivo = null;
    for (const [nome, { alvo, modelo }] of Object.entries(SHIMS)) {
      const url = JSON.stringify(pathToFileURL(path.join(raiz, 'src', alvo)).href);
      const r = sincronizarUm(bin, nome, Buffer.from(modelo(url), 'utf8'));
      if (r === 'gravado') alterados.push(nome);
      else if (r !== 'igual' && motivo === null) motivo = r;
    }
    return motivo === null ? { ok: true, alterados } : { ok: false, motivo };
  } catch (e) {
    return { ok: false, motivo: codigoErro(e, 'shim') };
  }
}

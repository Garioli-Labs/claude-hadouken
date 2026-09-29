import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  apagar, codigoErro, dirDados, erroComCodigo, esperar, fechar, RENOMEAR_ESPERA_MS, renomearDeNovo, varrerTmpVelhos,
} from './base.js';

// Shims estáveis (spec 8.1, S6). O settings.json do usuário aponta a
// statusLine (e o CLI) para <dirDados>/bin/<shim>, um caminho que não muda
// quando o plugin é atualizado; a extensão do VS Code carrega o painel.mjs
// (emenda E4). O SessionStart chama sincronizarShims a cada
// sessão: o shim aponta para a versão do plugin em uso e qualquer adulteração
// é desfeita. Cada shim é uma linha só, `await import("<file URL do alvo>")`
// seguido de um .catch fixo (o do painel, `export * from "<file URL>"`): o
// caminho entra apenas como URL de arquivo (que
// escapa espaço, aspas, #, %, quebra de linha e todo não-ASCII) e passa por
// JSON.stringify; nada lido de outro lugar entra no conteúdo.
//
// crypto.randomBytes é chamado pelo objeto padrão de node:crypto (os testes o
// trocam ali para plantar um link no nome sorteado do temporário).

export const DIR_BIN = 'bin';
// O .catch da barra engole tudo: sai 0 sem imprimir nada (spec 6.4: nunca
// código 1 nem stack trace), seja o alvo sumido (plugin atualizado e versão
// velha apagada antes do próximo SessionStart), seja erro dentro dele.
//
// O do CLI sai 1 sempre, com uma linha ASCII e sem stack:
// - "plugin files not found - open a new session" só quando o módulo que falta
//   é o próprio alvo. O ERR_MODULE_NOT_FOUND traz caminhos na mensagem, nunca a
//   URL, e um import que falta dentro do alvo também cita o caminho do alvo (no
//   "imported from"); por isso vale e.url === u (Node >= 20.10) e, sem e.url
//   (Node 20.0 a 20.9), a mensagem começar por "Cannot find module '<caminho
//   do alvo>'", que é o formato daquelas versões.
// - qualquer outro erro: "internal error (<code, senão name>)", só letras,
//   dígitos e _, no máximo 40 caracteres; sem nada aproveitável, "unknown".
// O handler nunca lança (um Proxy hostil cai no try) e põe exitCode antes de
// escrever. String.raw: o \n fica como os dois caracteres \ e n, e o shim
// continua uma linha só, toda ASCII.
const CATCH_CLI = String.raw`(e) => { let m = "internal error (unknown)"; try { const s = (v) => (typeof v === "string" ? v.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) : ""); if (e?.code === "ERR_MODULE_NOT_FOUND" && (e.url === u || (e.url === undefined && typeof e.message === "string" && e.message.startsWith("Cannot find module '" + fileURLToPath(u) + "'")))) m = "plugin files not found - open a new session"; else m = "internal error (" + (s(e?.code) || s(e?.name) || "unknown") + ")"; } catch {} process.exitCode = 1; try { process.stderr.write("claude-hadouken: " + m + "\n"); } catch {} }`;
// O do painel (emenda E4) só reexporta a lógica de src/uso/painel.js: a
// extensão do VS Code o carrega por import() dinâmico e trata a rejeição
// (alvo sumido) ela mesma. O alvo em subpasta entra pelo path.join de
// sincronizarShims, como os outros.
const SHIMS = Object.freeze({
  'statusline.mjs': { alvo: 'statusline.js', modelo: (url) => `await import(${url}).catch(() => {});\n` },
  'cli.mjs': {
    alvo: 'cli.js',
    modelo: (url) => `import { fileURLToPath } from "node:url"; const u = ${url}; await import(u).catch(${CATCH_CLI});\n`,
  },
  'painel.mjs': { alvo: 'uso/painel.js', modelo: (url) => `export * from ${url};\n` },
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
// A URL gravada no shim tem de voltar ao mesmo caminho. \\localhost\C$\... é
// lido pelo sistema, mas pathToFileURL descarta o host localhost e dá
// file:///C$/..., que não importa. A URL põe o host em minúsculas, e no
// Windows caminho não diferencia maiúsculas: lá a comparação também não.
const IGNORA_CAIXA = process.platform === 'win32';

// O_NOFOLLOW e O_NONBLOCK (onde existem): um link ou FIFO posto no lugar do
// shim entre o lstat e o open nunca é seguido nem trava a leitura. No Windows
// as constantes não existem; lá o lstat antes já barra links e junções.
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
// bin/ aberta para o fchmod (O-2, só POSIX): só pasta e nunca por link.
const ABRIR_PASTA = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
// A política de retentativa do rename (RENOMEAR_ESPERA_MS, renomearDeNovo),
// apagar, fechar, esperar e erroComCodigo vêm de base.js, divididos com
// estado.js e configuracao.js.
// Temporário da escrita atômica: .<shim>.<12 hex sorteados>.tmp. O sorteio
// impede plantar um link no nome antes da escrita (m-2).
const TMP_BYTES = 6;
const NOME_TMP = /^\.(?:statusline|cli|painel)\.mjs\.[0-9a-f]{12}\.tmp$/;
const ehTmpDeShim = (nome) => NOME_TMP.test(nome);
// Resultado de liberarEscrita.
const LIBERADO = 'liberado';
const INALTERADO = 'inalterado';
const RECUSADO = 'recusado';

// Raiz do plugin aceitável: string absoluta não vazia, sem NUL, fora do
// namespace de dispositivo do Windows, cuja URL de arquivo volta ao mesmo
// caminho (IGNORA_CAIXA), que o loader de ESM consegue importar
// (SEPARADOR_CODIFICADO) e em que src/statusline.js é arquivo regular pelo
// lstat (nem link, nem pasta). Devolve a raiz resolvida (sem barra no fim nem
// `..`) ou null. Nunca lança (fileURLToPath lança em URL sem volta: null).
// Resíduo aceito (m-3): UNC de qualquer host (\\servidor\compartilhamento)
// passa, e o lstat abre SMB até ele. Uma home em compartilhamento de rede é
// legítima, e a raiz vem do CLAUDE_PLUGIN_ROOT do próprio Claude Code, não
// de entrada não confiável.
function raizValida(raiz) {
  try {
    if (typeof raiz !== 'string' || raiz.length === 0 || raiz.includes('\0') || !path.isAbsolute(raiz)) return null;
    const resolvida = path.resolve(raiz);
    if (DISPOSITIVO.test(resolvida)) return null;
    const url = pathToFileURL(resolvida);
    const volta = path.resolve(fileURLToPath(url));
    if (IGNORA_CAIXA ? volta.toLowerCase() !== resolvida.toLowerCase() : volta !== resolvida) return null;
    if (SEPARADOR_CODIFICADO.test(url.pathname)) return null;
    const info = fs.lstatSync(path.join(resolvida, 'src', ALVO_OBRIGATORIO), { throwIfNoEntry: false });
    return info && info.isFile() ? resolvida : null;
  } catch {
    return null;
  }
}

// A pasta bin/ tem de ser pasta de verdade: se não existe, é criada; se é
// link, junção ou arquivo, nada é criado nem escrito através dela. No POSIX,
// bin/ sem rwx para o dono (um chmod 555 de quem adulterou o shim) faria a
// criação do temporário falhar com EACCES a cada sessão: volta a 0o700
// (modoBin). No Windows o modo da pasta não barra criar arquivo (e o Node nem
// reporta o bit x), então nada muda lá.
function pastaBin(dir) {
  const bin = path.join(dir, DIR_BIN);
  let info = fs.lstatSync(bin, { throwIfNoEntry: false });
  if (!info) {
    fs.mkdirSync(bin, { recursive: true });
    info = fs.lstatSync(bin, { throwIfNoEntry: false });
  }
  if (!info || !info.isDirectory()) return null;
  if (process.platform !== 'win32' && (info.mode & 0o700) !== 0o700 && !modoBin(bin, info)) return null;
  return bin;
}

// Põe bin/ em 0o700 pelo descritor (O-2): um chmod pelo caminho seguiria um
// symlink posto no lugar de bin/ depois do lstat. Abre só pasta e sem seguir
// link (ABRIR_PASTA), confere pelo fstat que é pasta do próprio usuário e só
// então fchmod. Link ou arquivo no lugar de bin/ (ELOOP, ENOTDIR): devolve
// false e nada é escrito ('bin_invalido', como se o lstat o tivesse visto).
// Dono sem leitura em bin/ (chmod 100 ou 300: a pasta não abre para leitura,
// EACCES): o chmod é pelo caminho, com a janela desde o lstat (resíduo
// registrado), para que um chmod 100 não segure um shim adulterado de pé.
// Outras falhas: segue, e a escrita dirá o motivo. Só POSIX. Devolve true
// para seguir.
function modoBin(bin, info) {
  const uid = process.getuid();
  let fd;
  try {
    fd = fs.openSync(bin, ABRIR_PASTA);
  } catch (e) {
    if (e?.code === 'ELOOP' || e?.code === 'ENOTDIR') return false;
    if (e?.code === 'EACCES' && info.uid === uid) {
      try { fs.chmodSync(bin, 0o700); } catch { /* a escrita dirá o motivo */ }
    }
    return true;
  }
  try {
    const aberta = fs.fstatSync(fd);
    if (aberta.isDirectory() && aberta.uid === uid) fs.fchmodSync(fd, 0o700);
  } catch {
    /* a escrita dirá o motivo */
  } finally {
    fechar(fd);
  }
  return true;
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

// Arquivo regular sem escrita para o dono (attrib +R no Windows, chmod 444).
// Aceita Stats e BigIntStats (liberarEscrita pede bigint).
const somenteLeitura = (info) => info.isFile() && (Number(info.mode) & 0o200) === 0;

// Shim somente leitura: no Windows o rename por cima dá EPERM enquanto a marca
// existir, e a adulteração ficaria. Tira a marca: lstat (somente leitura,
// nunca link), depois abre sem seguir link onde O_NOFOLLOW existe, confere de
// novo pelo fstat e só então fchmod pelo descritor, somando só a escrita do
// dono (grupo e outros não ganham nada). As duas checagens exigem nlink 1
// (N-1): num hard link o fchmod mudaria também o arquivo do outro nome, fora
// de bin/, e O_NOFOLLOW não barra hard link. E o aberto tem de ser o arquivo
// que o lstat viu, mesmo dev e ino (N-3): sem isso, quem troca a entrada por
// um hard link entre o lstat e o open e apaga o nome de bin/ antes do fstat
// leva o fchmod a um arquivo de fora com nlink 1. Stats em bigint: o id de
// arquivo do NTFS tem 64 bits e um Number perderia os bits baixos. Nlink
// diferente de 1 ou outro arquivo: nada é tocado e a resposta é RECUSADO.
// Devolve LIBERADO, INALTERADO ou RECUSADO. Nunca lança.
function liberarEscrita(arquivo) {
  let fd;
  try {
    const info = fs.lstatSync(arquivo, { throwIfNoEntry: false, bigint: true });
    if (!info || !somenteLeitura(info)) return INALTERADO;
    if (info.nlink !== 1n) return RECUSADO;
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
    const aberto = fs.fstatSync(fd, { bigint: true });
    if (!somenteLeitura(aberto)) return INALTERADO;
    if (aberto.nlink !== 1n) return RECUSADO;
    if (aberto.ino !== info.ino || aberto.dev !== info.dev) return RECUSADO;
    fs.fchmodSync(fd, (Number(aberto.mode) & 0o777) | 0o200);
    return LIBERADO;
  } catch {
    return INALTERADO;
  } finally {
    if (fd !== undefined) fechar(fd);
  }
}

// Grava num temporário da mesma pasta e renomeia por cima do shim. O rename
// troca a entrada, nunca escreve através dela. EPERM/EACCES de um shim
// somente leitura: tira a marca e tenta de novo. Shim somente leitura com mais
// de um nome (hard link), ou trocado por outro arquivo entre o lstat e o fstat
// (N-3): nada é tocado e o erro é 'shim_invalido', a mesma falha visível de
// uma pasta no lugar do shim. Falhou: o temporário é apagado e o erro sobe.
function gravarAtomico(arquivo, conteudo) {
  const tmp = gravarTmp(path.dirname(arquivo), path.basename(arquivo), conteudo);
  for (let tentativa = 1; ; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      return;
    } catch (e) {
      if (!renomearDeNovo(e, tentativa)) {
        apagar(tmp);
        throw e;
      }
      const liberacao = e.code === 'EBUSY' ? INALTERADO : liberarEscrita(arquivo);
      if (liberacao === RECUSADO) {
        apagar(tmp);
        throw erroComCodigo('shim_invalido');
      }
      if (liberacao !== LIBERADO) esperar(RENOMEAR_ESPERA_MS);
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

// Cria ou corrige <dirDados>/bin/statusline.mjs, cli.mjs e painel.mjs para
// importar <raizPlugin>/src/statusline.js, cli.js e uso/painel.js, e varre
// temporários velhos de bin/.
// Só escreve o que mudou. Cada shim é tratado à parte, então um shim com
// problema não impede a correção do outro; a primeira falha vira o motivo.
// Motivos: 'sem_diretorio' (sem home; nenhum I/O), 'raiz_invalida',
// 'bin_invalido' (bin/ é link, junção ou arquivo, também quando trocada assim
// antes do fchmod do POSIX; nada escrito), 'shim_invalido' (pasta no lugar de
// um shim, ou shim somente leitura com mais de um nome ou trocado durante a
// liberação, que fica como está), 'tmp_invalido' (o temporário
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
    // Varre a cada sincronização, não só depois de gravar: os shims só são
    // regravados quando o plugin muda, e aí a varredura quase nunca rodaria.
    // Custo limitado (N-2) e nunca lança: ver varrerTmpVelhos em base.js.
    varrerTmpVelhos(bin, ehTmpDeShim);
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

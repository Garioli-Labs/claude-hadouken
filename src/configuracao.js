import { isUtf8 } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apagar, dirDados, erroComCodigo, esperar, fechar, RENOMEAR_ESPERA_MS, RENOMEAR_TENTATIVAS, renomearDeNovo,
  varrerTmpVelhos,
} from './base.js';
import { DIR_BIN } from './shim.js';

// Instalador da barra (spec 8.1 S7 e 8.2; task-11-security.md). Grava só a
// chave `statusLine` do settings.json do usuário, que também guarda
// permissões, hooks e às vezes segredos em `env`: a gravação mais sensível do
// plugin. Regras:
// - Leitura com teto de 4 MiB, sem seguir link. JSON inválido, bytes que não
//   são UTF-8, topo que não é objeto, arquivo grande demais, link (symlink,
//   junção ou hard link) ou somente leitura: recusa com motivo fixo e o
//   arquivo não é tocado. Só chaves próprias contam (Object.hasOwn).
// - Backup dos bytes lidos (nunca uma segunda leitura), criado com 'wx' e modo
//   0600 em <settings>.bak-hadouken-<agoraMs>; no máximo MAX_BACKUPS nossos.
// - Escrita num temporário ao lado, com o modo do original (POSIX), e rename.
//   Logo antes de cada rename o arquivo é conferido de novo pelo lstat: se o
//   tamanho, a data ou o ino mudaram desde a leitura (o Claude Code grava esse
//   arquivo quando quer), nada é gravado ('settings-mudou'). Resíduo aceito:
//   uma gravação no intervalo entre esse lstat e o rename (microssegundos) se
//   perde; não há rename condicional portátil.
// - Saída: JSON bonito com a indentação do original (tab ou N espaços; senão
//   2), a quebra de linha do original (LF ou CRLF), o BOM se havia, e \n final.
//   Toda outra chave fica com o valor e a ordem de antes, inclusive
//   __proto__ e constructor, que o JSON.parse cria como chaves próprias e o
//   espalhamento copia como dado. Limite do JSON do JavaScript, o mesmo que o
//   Claude Code vê ao ler: chaves que são índices inteiros vêm primeiro,
//   chave repetida fica com o último valor, e números saem na forma canônica
//   (1.0 vira 1, 1E3 vira 1000, mesmo valor).
// - Números que o JSON.parse + JSON.stringify não devolvem com o mesmo valor
//   perdem fidelidade: inteiros acima de 2^53 perdem algarismos
//   (12345678901234567890 sairia 12345678901234567000), decimais com mais
//   algarismos do que um double guarda são arredondados
//   (3.14159265358979323846 sairia 3.141592653589793), -0 sai 0, 1e400
//   sairia null e 1e-400 sairia 0. Esses arquivos não são regravados:
//   numeroImpreciso compara o valor decimal exato de cada número do texto
//   com o que o JSON.stringify escreveria e, havendo diferença, recusa com
//   'settings-numero-impreciso'. A conferência cobre o texto inteiro, também
//   a statusLine que sai: recusa a mais, nunca a menos.
// - O comando da barra só é montado com um caminho feito de caracteres de
//   uma lista fixa (caminhoAceito); qualquer outro: 'caminho-inseguro'.
//
// Sem ICU: nenhuma regex daqui usa escape de propriedade (\p), que um
// Node compilado sem ICU acusa como erro já na carga do módulo, e o UTF-8 é
// conferido por isUtf8, não pelo TextDecoder. O teste "sem ICU" carrega o
// módulo nessas condições.
//
// fs, os e crypto são usados pelos objetos padrão (nunca desestruturados): os
// testes trocam fs.openSync, fs.renameSync e os.homedir nesses objetos.
//
// Nenhuma função exportada lança: erro vira { ok: false, motivo } (com
// `codigo` de sistema quando há um).

export const MAX_SETTINGS_BYTES = 4 * 1024 * 1024;
export const MAX_BACKUPS = 5;

const CHAVE = 'statusLine';
const SHIM_BARRA = 'statusline.mjs';
const SUFIXO_BACKUP = '.bak-hadouken-';
// Exatamente o que String(agoraMs) gera para um inteiro seguro não negativo.
const MS_BACKUP = /^(?:0|[1-9]\d{0,15})$/;
const BACKUP_LISTAR_MAX = 4096;
const TMP_BYTES = 6;
const TMP_RESTO = /^[0-9a-f]{12}\.tmp$/;
const MODO_NOVO = 0o600;
const MODO_BACKUP = 0o600;
const PEDACO_LEITURA = 65_536;
// A política de retentativa do rename (RENOMEAR_*, renomearDeNovo), apagar,
// fechar, esperar e erroComCodigo vêm de base.js, divididos com estado.js e
// shim.js. O temporário, o backup e o laço de rename continuam aqui: nenhum
// gravador comum dá as garantias do settings.json (bytes e formato exatos,
// modo do original, fsync, backup, conferência pelo lstat a cada tentativa).
const POSIX = process.platform !== 'win32';
// O_NOFOLLOW e O_NONBLOCK onde existem: um link posto no lugar entre o lstat e
// o open não é seguido (ELOOP) e um FIFO não trava. No Windows o lstat antes
// já recusou link e junção, e a checagem de dev/ino pega a troca.
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const BOM = String.fromCodePoint(0xfeff);
const FORMATO_NOVO = Object.freeze({ bom: false, eol: '\n', indent: 2 });
// Um número do JSON: sinal, parte inteira, fração e expoente. NUMERO (fixo na
// posição) lê o literal no texto; NUMERO_TODO confere o que o stringify dá.
const NUMERO = /(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?/y;
const NUMERO_TODO = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const ASPAS = 0x22;
const BARRA_INVERTIDA = 0x5c;
const MENOS = 0x2d;
const ZERO = 0x30;
const NOVE = 0x39;

// Caminho que pode entrar no comando da barra: uma lista do que PODE, não do
// que não pode. O Claude Code roda o comando por um sh no POSIX e, no
// Windows, pelo Git Bash ou, quando o Git Bash não está instalado, pelo
// PowerShell, e uma lista de proibidos sempre esquece algum caractere que um
// desses shells lê de outro jeito (a primeira esqueceu as aspas tipográficas:
// o PowerShell trata U+2018 a U+201B como aspas simples e U+201C a U+201E
// como duplas, e uma delas fechava a string do comando). Depois da troca de
// separador por /, só passam:
// - letras e algarismos ASCII, espaço e / : . _ - ( ) + , @ ~;
// - letras latinas de U+00C0 a U+024F, fora U+00D7 (vezes) e U+00F7
//   (dividido), para pastas pessoais como "José" ou "Çağrı".
// Todo o resto recusa: aspas de qualquer tipo, $ ` \ % ! & ' ; # ^ e o resto
// da pontuação ASCII, controles, invisíveis, travessões, formas de largura
// total, marcas combinantes (um acento em NFD), letras de outros alfabetos
// (cirílico, CJK...) e tudo fora do BMP. Os outros alfabetos ficam de fora de
// propósito: a lista fica pequena o bastante para conferir, um a um, que
// nenhum desses shells lê algum dos caracteres de outro jeito entre aspas
// duplas. Quem tem uma pasta pessoal assim instala à mão (statusLineManual).
// A comparação é por unidade UTF-16, sem regex de propriedade: um surrogate
// (U+D800 a U+DFFF) cai fora das faixas.
const PONTUACAO_ACEITA = new Set(Array.from(' /:._-()+,@~', (ch) => ch.charCodeAt(0)));
const MINUSCULA_A = 0x61;
const MINUSCULA_Z = 0x7a;
const MAIUSCULA_A = 0x41;
const MAIUSCULA_Z = 0x5a;
const LATINA_INICIO = 0xc0;
const LATINA_FIM = 0x24f;
const VEZES = 0xd7;
const DIVIDIDO = 0xf7;

const caractereAceito = (c) => (c >= MINUSCULA_A && c <= MINUSCULA_Z)
  || (c >= MAIUSCULA_A && c <= MAIUSCULA_Z)
  || (c >= ZERO && c <= NOVE)
  || PONTUACAO_ACEITA.has(c)
  || (c >= LATINA_INICIO && c <= LATINA_FIM && c !== VEZES && c !== DIVIDIDO);

function caminhoAceito(caminho) {
  if (caminho.length === 0) return false;
  for (let i = 0; i < caminho.length; i++) {
    if (!caractereAceito(caminho.charCodeAt(i))) return false;
  }
  return true;
}

// Marcador da pasta de dados na chave para instalar à mão (statusLineManual).
export const MARCADOR_PASTA = '<pasta de dados>';
const comandoPara = (alvo) => `node "${alvo}"`;
const valorStatusLine = (comando) => ({ type: 'command', command: comando, padding: 0 });

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (motivo, codigo = null) => (codigo === null ? { ok: false, motivo } : { ok: false, motivo, codigo });
// Só códigos de sistema no formato errno (EPERM, EACCES...); nada de texto livre.
const codigoDe = (e) => (typeof e?.code === 'string' && /^E[A-Z0-9]{1,20}$/.test(e.code) ? e.code : null);
const somenteLeitura = (info) => (Number(info.mode) & 0o200) === 0;

// Caminho do settings.json que o Claude Code lê, nesta ordem:
// 1. HADOUKEN_SETTINGS (testes), resolvido contra o cwd;
// 2. <CLAUDE_CONFIG_DIR>/settings.json quando essa variável está definida e é
//    um caminho absoluto: com ela o Claude Code guarda ali settings, sessões e
//    plugins. Definida mas relativa, vazia ou só espaços (nada disso é
//    absoluto): 'config-dir-invalido', porque gravar em ~/.claude mudaria um
//    arquivo que esse Claude Code não lê, e a documentação não diz como ele
//    trata um valor relativo. O valor não é aparado nem tem ~ expandido (o
//    shell já expandiu ao exportar). NUL não chega aqui: o ambiente do sistema
//    corta o valor no NUL, e arquivoDe recusa NUL de qualquer forma;
// 3. <home>/.claude/settings.json; sem home absoluta, 'sem-diretorio'.
// Devolve { ok: true, arquivo } ou { ok: false, motivo }. Nunca lança.
// Ressalva: com CLAUDE_CODE_SUBPROCESS_ENV_SCRUB o Claude Code tira
// CLAUDE_CONFIG_DIR do ambiente dos comandos que roda, e este processo cai no
// item 3; por isso a skill mostra o `arquivo` na pergunta antes de gravar.
// dirDados() não segue CLAUDE_CONFIG_DIR: shims e comando ficam em
// ~/.claude/hadouken (ou HADOUKEN_HOME).
export function arquivoSettings() {
  try {
    const configurado = process.env.HADOUKEN_SETTINGS;
    if (configurado) return { ok: true, arquivo: path.resolve(configurado) };
    const pastaConfig = process.env.CLAUDE_CONFIG_DIR;
    if (pastaConfig !== undefined) {
      return path.isAbsolute(pastaConfig) ? { ok: true, arquivo: path.join(pastaConfig, 'settings.json') } : falha('config-dir-invalido');
    }
    const home = os.homedir();
    return typeof home === 'string' && path.isAbsolute(home) ? { ok: true, arquivo: path.join(home, '.claude', 'settings.json') } : falha('sem-diretorio');
  } catch {
    return falha('sem-diretorio');
  }
}

// Comando da barra: node "<dirDados>/bin/statusline.mjs" com barras normais.
// Motivos: 'sem-diretorio' (sem home) e 'caminho-inseguro' (algum caractere
// fora da lista de caminhoAceito, conferida depois da troca de separador: no
// POSIX um \ num nome de pasta continua \ e recusa). O comando só é montado
// depois da conferência.
export function comandoStatusline() {
  try {
    const dir = dirDados();
    if (dir === null) return falha('sem-diretorio');
    const alvo = path.join(dir, DIR_BIN, SHIM_BARRA).split(path.sep).join('/');
    if (!caminhoAceito(alvo)) return falha('caminho-inseguro');
    return { ok: true, comando: comandoPara(alvo) };
  } catch {
    return falha('sem-diretorio');
  }
}

// O valor da chave statusLine que o instalador grava (objeto novo a cada chamada).
export function statusLineProposta() {
  const c = comandoStatusline();
  return c.ok ? { ok: true, valor: valorStatusLine(c.comando) } : c;
}

// A chave statusLine para o usuário acrescentar à mão quando o caminho é
// recusado ('caminho-inseguro'): o mesmo valor de statusLineProposta, com
// MARCADOR_PASTA no lugar da pasta de dados. O caminho recusado nunca entra
// nela: ele é justamente o que o shell poderia ler de outro jeito.
export function statusLineManual() {
  return valorStatusLine(comandoPara(`${MARCADOR_PASTA}/${DIR_BIN}/${SHIM_BARRA}`));
}

// A nossa é a de comando exatamente igual (tipo 'command'); o resto da
// statusLine do usuário (padding etc.) não conta. O comando de outra cópia do
// plugin, ou o mesmo caminho escrito de outro jeito, é outra barra.
function ehNossa(atual, comando) {
  return ehObjeto(atual)
    && Object.hasOwn(atual, 'type') && atual.type === 'command'
    && Object.hasOwn(atual, 'command') && atual.command === comando;
}

function plano(settings, proposto) {
  const existe = Object.hasOwn(settings, CHAVE) && settings[CHAVE] !== undefined;
  const atual = existe ? settings[CHAVE] : null;
  if (!existe) return { acao: 'instalar', atual, proposto };
  return { acao: ehNossa(atual, proposto.command) ? 'ja-instalado' : 'conflito', atual, proposto };
}

// Plano para um settings já lido (null ou undefined = arquivo ausente):
// 'instalar' (sem statusLine própria), 'ja-instalado' (a nossa, comando
// exato) ou 'conflito' (qualquer outra, inclusive null ou texto). Topo que não
// é objeto: 'settings-invalido'. Nunca lança.
export function planejarStatusline(settings) {
  try {
    if (settings !== null && settings !== undefined && !ehObjeto(settings)) return falha('settings-invalido');
    const p = statusLineProposta();
    if (!p.ok) return p;
    return { ok: true, ...plano(settings ?? {}, p.valor) };
  } catch {
    return falha('settings-invalido');
  }
}

// ---------------------------------------------------------------- leitura

// Mesmo arquivo e sem mudança: arquivo regular com um nome só, mesmo dev e
// ino (bigint: o id do NTFS tem 64 bits), mesmo tamanho e mesma data.
function mesmoArquivo(a, b) {
  return Boolean(a && b) && b.isFile() && b.nlink === 1n
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}

// Nada mudou desde a leitura: continua ausente, ou continua o mesmo arquivo.
const inalterado = (antes, agora) => (antes === null ? !agora : mesmoArquivo(antes, agora));

// Lê os bytes pelo descritor, conferindo pelo fstat que é o arquivo que o
// lstat viu, no máximo MAX_SETTINGS_BYTES + 1 bytes.
function lerBytes(arquivo, info) {
  let fd;
  try {
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
  } catch (e) {
    if (e?.code === 'ELOOP') return falha('settings-link');
    if (e?.code === 'ENOENT') return falha('settings-mudou');
    return falha('settings-ilegivel', codigoDe(e));
  }
  try {
    if (!mesmoArquivo(info, fs.fstatSync(fd, { bigint: true }))) return falha('settings-mudou');
    const partes = [];
    const pedaco = Buffer.allocUnsafe(PEDACO_LEITURA);
    let total = 0;
    for (;;) {
      const n = fs.readSync(fd, pedaco, 0, pedaco.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_SETTINGS_BYTES) return falha('settings-grande');
      partes.push(Buffer.from(pedaco.subarray(0, n)));
    }
    if (BigInt(total) !== info.size) return falha('settings-mudou');
    return { ok: true, bytes: Buffer.concat(partes, total) };
  } catch (e) {
    return falha('settings-ilegivel', codigoDe(e));
  } finally {
    fechar(fd);
  }
}

// Indentação da primeira linha indentada (tab, ou 1 a 10 espaços), quebra de
// linha (CRLF se houver alguma) e BOM do original.
function formatoDe(texto, bom) {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const m = /\n([ \t]+)\S/.exec(texto);
  let indent = 2;
  if (m && m[1][0] === '\t') indent = '\t';
  else if (m && /^ {1,10}$/.test(m[1])) indent = m[1].length;
  return { bom, eol, indent };
}

// { ok: true, existe: false, info: null } para arquivo ausente, ou
// { ok: true, existe: true, settings, bytes, info, formato }. lstat primeiro:
// link, junção ou hard link → 'settings-link'; pasta, FIFO, socket →
// 'settings-invalido'; acima do teto → 'settings-grande', sem abrir.
function lerSettings(arquivo) {
  let info;
  try {
    info = fs.lstatSync(arquivo, { bigint: true, throwIfNoEntry: false });
  } catch (e) {
    return falha('settings-ilegivel', codigoDe(e));
  }
  if (!info) return { ok: true, existe: false, info: null };
  // Hard link: o rename trocaria só este nome e o outro ficaria com o antigo.
  if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1n)) return falha('settings-link');
  if (!info.isFile()) return falha('settings-invalido');
  if (info.size > BigInt(MAX_SETTINGS_BYTES)) return falha('settings-grande');
  const lido = lerBytes(arquivo, info);
  if (!lido.ok) return lido;
  // isUtf8 é estrito (sem surrogate codificado, forma longa ou sequência
  // cortada) e não depende de ICU, ao contrário do TextDecoder com fatal.
  if (!isUtf8(lido.bytes)) return falha('settings-invalido');
  let texto = lido.bytes.toString('utf8');
  const bom = texto.startsWith(BOM);
  if (bom) texto = texto.slice(BOM.length);
  let settings;
  try {
    settings = JSON.parse(texto);
  } catch {
    return falha('settings-invalido');
  }
  if (!ehObjeto(settings)) return falha('settings-invalido');
  return { ok: true, existe: true, settings, bytes: lido.bytes, texto, info, formato: formatoDe(texto, bom) };
}

// O valor decimal exato de um número casado por NUMERO ou NUMERO_TODO, numa
// forma única: sinal, algarismos sem zeros nas pontas e expoente ("-0" fica
// "-0"; 1.50 e 15e-1 dão o mesmo). Os zeros saem por laço, não por regex: um
// literal de milhões de algarismos não vira tempo quadrático.
function decimalExato([, sinal, inteira, fracao = '', expoente = '0']) {
  const algarismos = inteira + fracao;
  let ini = 0;
  while (ini < algarismos.length && algarismos.charCodeAt(ini) === ZERO) ini++;
  let fim = algarismos.length;
  while (fim > ini && algarismos.charCodeAt(fim - 1) === ZERO) fim--;
  if (ini === fim) return `${sinal}0`;
  return `${sinal}${algarismos.slice(ini, fim)}e${Number(expoente) - fracao.length + (algarismos.length - fim)}`;
}

// Algum número do texto (JSON já validado pelo JSON.parse) sai do
// JSON.stringify com outro valor decimal? Texto entre aspas é pulado inteiro
// (com os escapes), então "-0" ou "1e400" dentro de uma string ou chave não
// contam. Fora de strings, em JSON válido, só números começam com - ou
// algarismo. Qualquer surpresa conta como impreciso: recusa, nunca grava.
function numeroImpreciso(texto) {
  try {
    let i = 0;
    while (i < texto.length) {
      const c = texto.charCodeAt(i);
      if (c === ASPAS) {
        for (i++; i < texto.length; i++) {
          const d = texto.charCodeAt(i);
          if (d === BARRA_INVERTIDA) i++;
          else if (d === ASPAS) break;
        }
        i++;
      } else if (c === MENOS || (c >= ZERO && c <= NOVE)) {
        NUMERO.lastIndex = i;
        const lido = NUMERO.exec(texto);
        if (lido === null) return true;
        const regravado = NUMERO_TODO.exec(JSON.stringify(Number(lido[0])));
        if (regravado === null || decimalExato(regravado) !== decimalExato(lido)) return true;
        i = NUMERO.lastIndex;
      } else {
        i++;
      }
    }
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- escrita

function serializar(valor, { bom, eol, indent }) {
  let texto;
  try {
    texto = JSON.stringify(valor, null, indent);
  } catch {
    return null;
  }
  if (typeof texto !== 'string') return null;
  texto += '\n';
  if (eol !== '\n') texto = texto.replace(/\n/g, eol);
  return Buffer.from(bom ? `${BOM}${texto}` : texto, 'utf8');
}

// Backup com os bytes lidos. lstat antes do 'wx': no Windows o CREATE_NEW
// atravessa uma junção pendente e criaria o alvo dela; qualquer entrada com o
// nome já é 'backup-existe' e fica intocada. Modo 0600 (fchmod no POSIX, que o
// umask não alarga). Devolve { ok: true, caminho } ou a falha.
function criarBackup(arquivo, bytes, agoraMs) {
  const caminho = `${arquivo}${SUFIXO_BACKUP}${agoraMs}`;
  try {
    if (fs.lstatSync(caminho, { throwIfNoEntry: false })) return falha('backup-existe');
  } catch (e) {
    return falha('backup', codigoDe(e));
  }
  let fd;
  try {
    fd = fs.openSync(caminho, 'wx', MODO_BACKUP);
  } catch (e) {
    return e?.code === 'EEXIST' ? falha('backup-existe') : falha('backup', codigoDe(e));
  }
  let criado = false;
  try {
    if (!fs.fstatSync(fd).isFile()) throw erroComCodigo('EEXIST');
    criado = true;
    if (POSIX) fs.fchmodSync(fd, MODO_BACKUP);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (e) {
    fechar(fd);
    if (criado) apagar(caminho);
    return e?.code === 'EEXIST' ? falha('backup-existe') : falha('backup', codigoDe(e));
  }
  try {
    fs.closeSync(fd);
  } catch (e) {
    apagar(caminho);
    return falha('backup', codigoDe(e));
  }
  return { ok: true, caminho };
}

// Temporário <settings>.hadouken-<12 hex sorteados>.tmp na mesma pasta, com o
// mesmo cuidado do backup (lstat, 'wx', fstat) e o modo pedido. Devolve o
// caminho; erro sobe.
function gravarTmp(arquivo, bytes, modo) {
  const tmp = `${arquivo}.hadouken-${crypto.randomBytes(TMP_BYTES).toString('hex')}.tmp`;
  if (fs.lstatSync(tmp, { throwIfNoEntry: false })) throw erroComCodigo('EEXIST');
  const fd = fs.openSync(tmp, 'wx', modo);
  let criado = false;
  try {
    if (!fs.fstatSync(fd).isFile()) throw erroComCodigo('EEXIST');
    criado = true;
    if (POSIX) fs.fchmodSync(fd, modo);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (e) {
    fechar(fd);
    if (criado) apagar(tmp);
    throw e;
  }
  return tmp;
}

// Confere pelo lstat que nada mudou desde a leitura e renomeia, a cada
// tentativa: a janela entre a conferência e a troca fica mínima, também
// quando um EPERM passageiro obriga a esperar.
function trocar(tmp, arquivo, infoLido) {
  let erro = null;
  for (let tentativa = 1; tentativa <= RENOMEAR_TENTATIVAS; tentativa++) {
    let agora;
    try {
      agora = fs.lstatSync(arquivo, { bigint: true, throwIfNoEntry: false });
    } catch {
      return falha('settings-mudou');
    }
    if (!inalterado(infoLido, agora)) return falha('settings-mudou');
    try {
      fs.renameSync(tmp, arquivo);
      return { ok: true };
    } catch (e) {
      erro = e;
      if (!renomearDeNovo(e, tentativa)) break;
      esperar(RENOMEAR_ESPERA_MS);
    }
  }
  return falha('escrita', codigoDe(erro));
}

// Guarda no máximo MAX_BACKUPS backups nossos: o recém-criado sempre fica
// (mesmo com o relógio atrasado) e, dos outros, os de agoraMs maior. Só conta
// e só apaga arquivo regular com um nome só (nada de link, junção, pasta ou
// hard link) cujo nome é exatamente <settings>.bak-hadouken-<inteiro>.
// Melhor esforço: nunca lança.
function podarBackups(arquivo, novo) {
  const pasta = path.dirname(arquivo);
  const prefixo = `${path.basename(arquivo)}${SUFIXO_BACKUP}`;
  const nomeNovo = path.basename(novo);
  let d;
  try {
    d = fs.opendirSync(pasta);
    const nossos = [];
    for (let lidos = 0; lidos < BACKUP_LISTAR_MAX; lidos++) {
      const e = d.readSync();
      if (e === null) break;
      if (e.name === nomeNovo || !e.name.startsWith(prefixo)) continue;
      const ms = e.name.slice(prefixo.length);
      if (MS_BACKUP.test(ms)) nossos.push({ nome: e.name, ms: Number(ms) });
    }
    nossos.sort((a, b) => b.ms - a.ms);
    let mantidos = 1;
    for (const { nome } of nossos) {
      const caminho = path.join(pasta, nome);
      try {
        const info = fs.lstatSync(caminho);
        if (!info.isFile() || info.nlink !== 1) continue;
        if (mantidos < MAX_BACKUPS) {
          mantidos++;
          continue;
        }
        fs.unlinkSync(caminho);
      } catch { /* sumiu ou sem permissão: segue */ }
    }
  } catch {
    /* pasta ilegível: fica para a próxima */
  } finally {
    if (d !== undefined) {
      try { d.closeSync(); } catch { /* já fechada */ }
    }
  }
}

// Temporário nosso abandonado (processo morto entre a escrita e o rename).
function ehTmpDe(arquivo) {
  const prefixo = `${path.basename(arquivo)}.hadouken-`;
  return (nome) => nome.startsWith(prefixo) && TMP_RESTO.test(nome.slice(prefixo.length));
}

// Grava `valor` no lugar do settings lido: serializa, faz o backup (se o
// arquivo existia) ou cria a pasta (se não), escreve o temporário e troca.
// Qualquer falha apaga o temporário e o backup recém-criados; o settings.json
// fica como estava.
function gravar(arquivo, lido, valor, agoraMs) {
  const bytes = serializar(valor, lido.existe ? lido.formato : FORMATO_NOVO);
  if (bytes === null) return falha('serializacao');
  let backup = null;
  if (lido.existe) {
    const b = criarBackup(arquivo, lido.bytes, agoraMs);
    if (!b.ok) return b;
    backup = b.caminho;
  } else {
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    } catch (e) {
      return falha('escrita', codigoDe(e));
    }
  }
  const modo = lido.existe ? Number(lido.info.mode) & 0o777 : MODO_NOVO;
  let tmp;
  try {
    tmp = gravarTmp(arquivo, bytes, modo);
  } catch (e) {
    if (backup !== null) apagar(backup);
    return falha('escrita', codigoDe(e));
  }
  const r = trocar(tmp, arquivo, lido.info);
  if (!r.ok) {
    apagar(tmp);
    if (backup !== null) apagar(backup);
    return r;
  }
  if (backup !== null) podarBackups(arquivo, backup);
  varrerTmpVelhos(path.dirname(arquivo), ehTmpDe(arquivo));
  return { ok: true, backup };
}

// ---------------------------------------------------------------- API

// Caminho absoluto, não vazio, sem NUL; senão null.
function arquivoDe(opcoes) {
  const a = ehObjeto(opcoes) ? opcoes.arquivo : undefined;
  return typeof a === 'string' && a.length > 0 && !a.includes('\0') && path.isAbsolute(a) ? a : null;
}

// agoraMs vira parte do nome do backup: inteiro seguro não negativo.
function agoraDe(opcoes) {
  const ms = ehObjeto(opcoes) ? opcoes.agoraMs : undefined;
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
}

// Leitura comum a consultar, aplicar e remover: argumentos, comando e arquivo.
function preparar(opcoes, comAgora) {
  const arquivo = arquivoDe(opcoes);
  const agoraMs = comAgora ? agoraDe(opcoes) : 0;
  if (arquivo === null || agoraMs === null) return falha('argumentos');
  const p = statusLineProposta();
  if (!p.ok) return p;
  const lido = lerSettings(arquivo);
  if (!lido.ok) return lido;
  const settings = lido.existe ? lido.settings : {};
  return { ok: true, arquivo, agoraMs, lido, settings, proposto: p.valor, ...plano(settings, p.valor) };
}

// O que impede regravar um settings.json que existe: somente leitura, ou um
// número que não sairia com o mesmo valor. null quando nada impede. Só é
// chamado quando haveria o que gravar.
function bloqueioDeEscrita(lido) {
  if (!lido.existe) return null;
  if (somenteLeitura(lido.info)) return falha('settings-somente-leitura');
  if (numeroImpreciso(lido.texto)) return falha('settings-numero-impreciso');
  return null;
}

// O plano para o arquivo, sem gravar nada (o "mostrar antes de gravar" da
// skill): { ok: true, acao, atual, proposto } ou a falha que o aplicar daria
// ('settings-somente-leitura' e 'settings-numero-impreciso' só quando haveria
// o que gravar).
export function consultarStatusline(opcoes) {
  try {
    const c = preparar(opcoes, false);
    if (!c.ok) return c;
    const bloqueio = c.acao === 'ja-instalado' ? null : bloqueioDeEscrita(c.lido);
    if (bloqueio !== null) return bloqueio;
    return { ok: true, acao: c.acao, atual: c.atual, proposto: c.proposto };
  } catch {
    return falha('erro-interno');
  }
}

// Instala a nossa statusLine. Conflito só é trocado com substituir === true
// (spec 8.2: trocar a barra de outra ferramenta apaga a barra das sessões
// abertas). Devolve { ok: true, acao: 'instalar' | 'substituir' |
// 'ja-instalado', backup: caminho | null } ou { ok: false, motivo[, codigo] }.
export function aplicarStatusline(opcoes) {
  try {
    const c = preparar(opcoes, true);
    if (!c.ok) return c;
    if (c.acao === 'ja-instalado') return { ok: true, acao: 'ja-instalado', backup: null };
    if (c.acao === 'conflito' && opcoes.substituir !== true) return falha('conflito');
    const bloqueio = bloqueioDeEscrita(c.lido);
    if (bloqueio !== null) return bloqueio;
    const g = gravar(c.arquivo, c.lido, { ...c.settings, [CHAVE]: c.proposto }, c.agoraMs);
    if (!g.ok) return g;
    return { ok: true, acao: c.acao === 'conflito' ? 'substituir' : 'instalar', backup: g.backup };
  } catch {
    return falha('erro-interno');
  }
}

// Desinstala: tira a statusLine só se for exatamente a nossa, com backup.
// Outra barra: 'outra-barra', nada tocado. Sem statusLine ou sem arquivo:
// { ok: true, acao: 'nao-instalado', backup: null }.
export function removerStatusline(opcoes) {
  try {
    const c = preparar(opcoes, true);
    if (!c.ok) return c;
    if (c.acao === 'instalar') return { ok: true, acao: 'nao-instalado', backup: null };
    if (c.acao === 'conflito') return falha('outra-barra');
    const bloqueio = bloqueioDeEscrita(c.lido);
    if (bloqueio !== null) return bloqueio;
    const { [CHAVE]: _removida, ...resto } = c.settings;
    const g = gravar(c.arquivo, c.lido, resto, c.agoraMs);
    return g.ok ? { ok: true, acao: 'remover', backup: g.backup } : g;
  } catch {
    return falha('erro-interno');
  }
}

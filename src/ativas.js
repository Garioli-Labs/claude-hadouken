import fs from 'node:fs';
import path from 'node:path';
import { dirDados, idValido } from './base.js';

// Registro de ativação (spec 8.2). O Claude Code recarrega a `statusLine` em
// sessões já abertas, então instalar o plugin mudaria a barra delas; só as
// sessões que passaram pelo SessionStart do plugin (registrarSessao) ganham
// barra e hooks, e todas as outras ficam como estavam.
//
// Formato: um arquivo vazio por sessão em <dirDados>/ativas/<hex(session_id)>,
// e a data de modificação é o único dado. Um arquivo por sessão não tem
// ler-mexer-gravar, então dois SessionStart simultâneos nunca perdem registro.
// O nome em hex porque o NTFS não diferencia maiúsculas (s1 e S1 cairiam no
// mesmo arquivo) e porque ids como CON ou NUL virariam nomes reservados do
// Windows; hex dá 2 a 128 caracteres [0-9a-f], nenhum deles reservado.

export const DIR_ATIVAS = 'ativas';
// Uma sessão parada há mais que isto deixa de ser ativa e é podada no próximo
// registro. A barra e os hooks renovam a data enquanto a sessão está em uso.
export const ATIVA_MAX_MS = 30 * 24 * 3_600_000;
// A barra redesenha a cada 300 ms; renovar a data em cada redesenho gravaria
// metadados sem parar (e acordaria o antivírus no Windows). Com este intervalo
// a data fica no máximo 1 h atrás, irrelevante para 30 dias.
export const RENOVAR_APOS_MS = 3_600_000;

// Faixa em que new Date(ms) é válido.
const DATA_MAX_MS = 8.64e15;
// Poda limitada para caber no orçamento do SessionStart (spec 6.5). Medido
// nesta máquina: listar 2 000 nomes ~6 ms, um lstat ~23 µs, um unlink ~0,2 ms.
// Lê até PODA_LISTAR_MAX entradas da pasta (toda entrada conta, case ou não
// com o nome de registro, então uma pasta inundada de nomes alheios não é lida
// inteira), começa as checagens num ponto sorteado entre os nomes de registro
// lidos e faz no máximo PODA_CHECAR_MAX lstat e PODA_APAGAR_MAX unlink por
// chamada. O sorteio só gira dentro das entradas lidas: o NTFS lista em ordem
// de nome, então com mais de PODA_LISTAR_MAX entradas as últimas nunca são
// checadas. Fora de escopo: mais de 5 000 registros vivos em 30 dias (um por
// sessão iniciada); abaixo disso toda entrada é lida e o sorteio alcança
// qualquer registro.
const PODA_LISTAR_MAX = 5000;
const PODA_CHECAR_MAX = 1000;
const PODA_APAGAR_MAX = 50;
const NOME_ATIVA = /^(?:[0-9a-f]{2}){1,64}$/;

const agoraValido = (ms) => typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= DATA_MAX_MS;
const nomeDe = (id) => Buffer.from(id, 'utf8').toString('hex');
// A precisão da data varia por sistema de arquivos; o registro grava ms
// inteiros, então a comparação também usa ms inteiros.
const idadeDe = (info, agoraMs) => agoraMs - Math.round(info.mtimeMs);

function pasta() {
  const dir = dirDados();
  return dir === null ? null : path.join(dir, DIR_ATIVAS);
}

// lstat do arquivo da sessão (nunca stat: um link não é seguido). Arquivo
// regular → Stats; qualquer outra coisa, ausência ou entrada inválida → null.
function infoDaSessao(sessionId, agoraMs) {
  if (!idValido(sessionId) || !agoraValido(agoraMs)) return null;
  const dir = pasta();
  if (dir === null) return null;
  const arq = path.join(dir, nomeDe(sessionId));
  const info = fs.lstatSync(arq, { throwIfNoEntry: false });
  return info && info.isFile() ? { arq, info } : null;
}

// Uma tentativa de gravar a data `s` (segundos) no registro `arq`. lstat
// primeiro: arquivo regular → lutimes (não segue link); diretório, link,
// junção ou FIFO → 'invalido', intocado; ausente → cria com 'wx' e confere com
// fstat que o aberto é arquivo regular antes de datar. Devolve 'ok',
// 'invalido', 'criar' ou 'corrida' (o registro sumiu ou apareceu entre o lstat
// e a escrita). Erro inesperado sobe para quem chama.
//
// O lstat antes do open é o que barra a junção pendente: no Windows o 'wx'
// (CREATE_NEW) atravessa um reparse point e criaria o alvo, uma pasta fora de
// ativas/ (N-2). Um link plantado entre o lstat e o open continua possível
// (TOCTOU): no POSIX o 'wx' falha com EEXIST e a nova tentativa vê o link; no
// Windows o alvo já nasceu quando o fstat recusa. Só o próprio usuário escreve
// em ativas/ (a mesma fronteira de confiança do estado.json), e o resultado
// continua 'invalido', nunca um sucesso falso; por isso o resto fica aceito.
function gravarRegistro(arq, s) {
  const info = fs.lstatSync(arq, { throwIfNoEntry: false });
  if (info) {
    if (!info.isFile()) return 'invalido';
    try {
      fs.lutimesSync(arq, s, s);
    } catch (e) {
      if (e?.code === 'ENOENT') return 'corrida';
      throw e;
    }
    return 'ok';
  }
  let fd;
  try {
    fd = fs.openSync(arq, 'wx');
  } catch (e) {
    return e?.code === 'EEXIST' ? 'corrida' : 'criar';
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return 'invalido';
    fs.futimesSync(fd, s, s);
    return 'ok';
  } finally {
    fs.closeSync(fd);
  }
}

// Grava (ou renova) o registro da sessão. Chamado pelo hook SessionStart em
// toda origem (startup, resume, clear, compact). Cria o arquivo com 'wx'
// (O_CREAT|O_EXCL: nunca trunca nada) e data igual a agora; se já existe,
// renova a data só se for arquivo regular (gravarRegistro). Se o registro
// some ou aparece no meio (poda ou SessionStart de outro processo), tenta uma
// vez mais (N-4). Depois poda registros parados há mais de 30 dias. Motivos de
// falha: 'id_invalido', 'agora', 'sem_diretorio', 'invalido', 'pasta',
// 'criar' ou 'inesperado'. Nunca lança.
//
// Casos aceitos (N-4), os dois silenciosos (sem barra até o próximo
// SessionStart, nunca dado errado): (a) a poda de outro processo lê a data
// velha de um registro com mais de 30 dias, este registro renova a data e a
// poda apaga em seguida; devolve ok e o arquivo sumiu. (b) Um SessionStart com
// o relógio mais de 30 dias adiantado poda até PODA_APAGAR_MAX registros
// vivos; com esse relógio o gate já os trataria como vencidos.
export function registrarSessao(sessionId, agoraMs) {
  try {
    if (!idValido(sessionId)) return { ok: false, motivo: 'id_invalido' };
    if (!agoraValido(agoraMs)) return { ok: false, motivo: 'agora' };
    const dir = pasta();
    if (dir === null) return { ok: false, motivo: 'sem_diretorio' };
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return { ok: false, motivo: 'pasta' };
    }
    // Pasta que é link (ou junção) para outro lugar: nada é criado através dela.
    const infoPasta = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!infoPasta || !infoPasta.isDirectory()) return { ok: false, motivo: 'invalido' };
    const arq = path.join(dir, nomeDe(sessionId));
    let r = gravarRegistro(arq, agoraMs / 1000);
    if (r === 'corrida') r = gravarRegistro(arq, agoraMs / 1000);
    if (r === 'corrida') r = 'criar';
    if (r !== 'ok') return { ok: false, motivo: r };
    podar(dir, agoraMs);
    return { ok: true };
  } catch {
    return { ok: false, motivo: 'inesperado' };
  }
}

// Remove registros parados há mais de ATIVA_MAX_MS, com os limites descritos
// no topo. Só arquivo regular cujo nome é o hex de um id válido (o nome que
// registrarSessao geraria); nada de pasta, link ou nome alheio. Melhor esforço:
// nunca lança.
function podar(dir, agoraMs) {
  let d = null;
  try {
    const nomes = [];
    d = fs.opendirSync(dir);
    for (let lidas = 0; lidas < PODA_LISTAR_MAX; lidas++) {
      const e = d.readSync();
      if (e === null) break;
      if (NOME_ATIVA.test(e.name)) nomes.push(e.name);
    }
    const inicio = Math.floor(Math.random() * nomes.length);
    const checar = Math.min(nomes.length, PODA_CHECAR_MAX);
    let apagados = 0;
    for (let i = 0; i < checar && apagados < PODA_APAGAR_MAX; i++) {
      const nome = nomes[(inicio + i) % nomes.length];
      const id = Buffer.from(nome, 'hex').toString('utf8');
      if (!idValido(id) || nomeDe(id) !== nome) continue;
      const caminho = path.join(dir, nome);
      try {
        const info = fs.lstatSync(caminho);
        if (!info.isFile() || idadeDe(info, agoraMs) <= ATIVA_MAX_MS) continue;
        fs.unlinkSync(caminho);
        apagados++;
      } catch { /* sumiu ou sem permissão: segue */ }
    }
  } catch { /* pasta ilegível: fica para o próximo registro */ } finally {
    try { d?.closeSync(); } catch { /* já fechada */ }
  }
}

// Há quanto tempo (ms) o registro da sessão foi criado ou renovado; null se a
// sessão não tem registro de arquivo regular. Negativo se a data está no
// futuro (relógio que voltou). Leitura pura: um lstat, nunca cria a pasta nem
// o home. Nunca lança.
export function idadeSessao(sessionId, agoraMs) {
  try {
    const r = infoDaSessao(sessionId, agoraMs);
    return r === null ? null : idadeDe(r.info, agoraMs);
  } catch {
    return null;
  }
}

// O gate da barra e dos hooks: a sessão tem registro de no máximo 30 dias?
// Sem limite inferior: um relógio que voltou não cala sessões registradas, e
// uma data no futuro só pode vir do próprio usuário. Leitura pura (um lstat).
// Nunca lança.
export function sessaoAtiva(sessionId, agoraMs) {
  const idade = idadeSessao(sessionId, agoraMs);
  return idade !== null && idade <= ATIVA_MAX_MS;
}

// Renova a data do registro de uma sessão ativa (a barra e os hooks chamam
// depois do gate). Refaz o próprio lstat em vez de confiar em quem chama:
// nunca revive registro vencido, nunca cria arquivo, nunca segue link
// (lutimes) e não escreve se a data tem menos de RENOVAR_APOS_MS. Devolve true
// só se renovou. Melhor esforço: nunca lança.
export function renovarSessao(sessionId, agoraMs) {
  try {
    const r = infoDaSessao(sessionId, agoraMs);
    if (r === null) return false;
    const idade = idadeDe(r.info, agoraMs);
    if (idade > ATIVA_MAX_MS || idade < RENOVAR_APOS_MS) return false;
    fs.lutimesSync(r.arq, agoraMs / 1000, agoraMs / 1000);
    return true;
  } catch {
    return false;
  }
}

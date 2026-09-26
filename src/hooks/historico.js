import fs from 'node:fs';
import path from 'node:path';
import { validarEstado } from '../estado.js';
import { idValido } from '../base.js';
import { effortValido, sanear } from '../util.js';

// Histórico de sessões do hook SessionEnd (spec 6.5): <dirDados>/historico.jsonl,
// uma linha JSON por sessão encerrada, lida depois pelo relatório. Spec 8.1,
// S1–S3 e adendo C da Task 7: cada campo é validado ou saneado aqui, e o
// arquivo só é anexado se for arquivo regular de um nome só.
//
// fs é usado pelo objeto padrão de node:fs, nunca desestruturado: os testes
// trocam lstatSync e renameSync nesse objeto para simular corridas.
//
// Resíduos aceitos (o mesmo usuário, nunca um terceiro):
// - um link posto entre o lstat e o open no Windows (sem O_NOFOLLOW lá): o
//   fstat depois do open recusa pasta e hard link, mas um symlink de arquivo
//   trocado nesse intervalo seria seguido;
// - dois SessionEnd que giram juntos quando o outro já anexou ao arquivo novo:
//   o segundo rename leva o arquivo novo (pequeno) para historico.1.jsonl e o
//   girado de 5 MiB se perde. Pede dois encerramentos no mesmo milissegundo
//   exatamente na virada de 5 MiB;
// - giro que falha (antivírus segurando o arquivo no Windows) perde a linha
//   daquela sessão; o próximo SessionEnd tenta girar de novo;
// - sistema de arquivos que não informa a contagem de links (nlink 0 em
//   algumas montagens FUSE ou de rede): regularUnico recusa todo arquivo, e o
//   histórico fica desligado ('invalido') nessa home. É o lado seguro, e
//   NTFS, ReFS, ext4, APFS e SMB do Windows informam nlink (M6 da revisão da
//   Task 7).

export const ARQ_HISTORICO = 'historico.jsonl';
export const ARQ_HISTORICO_VELHO = 'historico.1.jsonl';
// Acima disto o histórico gira para historico.1.jsonl (só uma geração velha):
// o disco usado pelo histórico fica em torno de 10 MiB para sempre.
export const HISTORICO_MAX_BYTES = 5 * 1024 * 1024;

// Motivos de SessionEnd documentados pelo Claude Code; qualquer outro valor
// vira 'outro'.
const MOTIVOS = new Set(['clear', 'resume', 'logout', 'prompt_input_exit', 'other']);
// Os separadores da barra (formato.js) não entram no nome do modelo gravado:
// o relatório monta linhas com eles.
const GLIFOS_BARRA = /[│↻·]/gu;
const MAX_MODEL = 40;
const MAX_CWD = 200;
const DATA_MAX_MS = 8.64e15;
// O_NOFOLLOW e O_NONBLOCK onde existem: um symlink no lugar do histórico não
// é seguido (ELOOP) e um FIFO sem leitor não trava o hook (ENXIO). No Windows
// as constantes não existem; lá o lstat antes barra links e junções.
const ABRIR_ANEXAR = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
  | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const codigoErro = (e, padrao) => (typeof e?.code === 'string' ? e.code : padrao);

// Valor de fn(), ou null se fn lançar (getter hostil numa entrada).
function seguro(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

const proprio = (o, k) => (ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined);

function modeloLimpo(model) {
  const saneado = sanear(model, MAX_MODEL);
  if (saneado === null) return null;
  return sanear(saneado.replace(GLIFOS_BARRA, ' ').replace(/\s+/gu, ' '), MAX_MODEL);
}

// Registro de uma sessão encerrada, com as chaves nesta ordem:
// at (agora), session_id, cwd (do stdin do SessionEnd, saneado, 200 pontos de
// código), model e effort (da sessão em estado.json, achada por Object.hasOwn
// no estado validado), five_hour e seven_day (as janelas validadas do
// instantâneo, cada uma com o `at` da própria leitura, ou at null quando
// estado.json está no formato antigo, de um `at` só), leitura_at (o `at`
// desse instantâneo, o da leitura mais antiga entre as janelas, para o
// relatório saber a idade da leitura) e reason (da lista, senão 'outro').
// Campo que não passa vira null. Nunca lança.
export function registroHistorico({ entrada, estadoBruto, sessionId, agoraMs } = {}) {
  const registro = {
    at: numeroFinito(agoraMs) && Math.abs(agoraMs) <= DATA_MAX_MS ? new Date(agoraMs).toISOString() : null,
    session_id: seguro(() => (idValido(sessionId) ? sessionId : null)),
    cwd: seguro(() => sanear(proprio(entrada, 'cwd'), MAX_CWD)),
    model: null,
    effort: null,
    five_hour: null,
    seven_day: null,
    leitura_at: null,
    reason: seguro(() => {
      const r = proprio(entrada, 'reason');
      return typeof r === 'string' && MOTIVOS.has(r) ? r : null;
    }) ?? 'outro',
  };
  const estado = seguro(() => validarEstado(estadoBruto, agoraMs));
  if (estado === null) return registro;
  registro.five_hour = estado.five_hour;
  registro.seven_day = estado.seven_day;
  registro.leitura_at = estado.at;
  if (registro.session_id !== null && Object.hasOwn(estado.sessoes, registro.session_id)) {
    const s = estado.sessoes[registro.session_id];
    registro.model = seguro(() => modeloLimpo(s.model));
    registro.effort = seguro(() => effortValido(s.effort));
  }
  return registro;
}

// Arquivo regular com um nome só: nem pasta, nem link, nem junção, nem hard
// link (anexar a um hard link escreveria no arquivo de fora).
const regularUnico = (info) => info.isFile() && info.nlink === 1;

// Gira o histórico para historico.1.jsonl. Recusa ('invalido') se o destino
// existe e não é arquivo regular. ENOENT no rename quer dizer que outro
// SessionEnd girou primeiro: segue, e a linha vai para um histórico novo.
function girar(arq, velho) {
  const info = fs.lstatSync(velho, { throwIfNoEntry: false });
  if (info && !info.isFile()) return 'invalido';
  try {
    fs.renameSync(arq, velho);
  } catch (e) {
    if (codigoErro(e, '') !== 'ENOENT') return codigoErro(e, 'giro');
  }
  return 'ok';
}

// Abre para anexar (criando com 0o600), confere pelo fstat que é arquivo
// regular de um nome só e escreve a linha inteira.
function anexar(arq, texto) {
  const fd = fs.openSync(arq, ABRIR_ANEXAR, 0o600);
  try {
    if (!regularUnico(fs.fstatSync(fd))) return 'invalido';
    const bytes = Buffer.from(texto, 'utf8');
    let escritos = 0;
    while (escritos < bytes.length) escritos += fs.writeSync(fd, bytes, escritos, bytes.length - escritos);
    return 'ok';
  } finally {
    fs.closeSync(fd);
  }
}

// Anexa `registro` como uma linha JSON a <dir>/historico.jsonl. `dir` tem de
// ser absoluto e existir (nunca é criado). Antes de abrir, o lstat recusa
// pasta, link, junção e hard link; acima de HISTORICO_MAX_BYTES gira, e se o
// giro falha nada é anexado (o teto de tamanho vale). Devolve { ok: true } ou
// { ok: false, motivo }: 'diretorio', 'serializacao', 'invalido', o código do
// erro de sistema ou 'historico'. Nunca lança.
export function anexarHistorico(dir, registro) {
  try {
    if (typeof dir !== 'string' || dir.length === 0 || !path.isAbsolute(dir)) return { ok: false, motivo: 'diretorio' };
    let linha;
    try {
      linha = JSON.stringify(registro);
    } catch {
      return { ok: false, motivo: 'serializacao' };
    }
    if (typeof linha !== 'string') return { ok: false, motivo: 'serializacao' };
    const arq = path.join(dir, ARQ_HISTORICO);
    const info = fs.lstatSync(arq, { throwIfNoEntry: false });
    if (info) {
      if (!regularUnico(info)) return { ok: false, motivo: 'invalido' };
      if (info.size > HISTORICO_MAX_BYTES) {
        const giro = girar(arq, path.join(dir, ARQ_HISTORICO_VELHO));
        if (giro !== 'ok') return { ok: false, motivo: giro };
      }
    }
    const r = anexar(arq, `${linha}\n`);
    return r === 'ok' ? { ok: true } : { ok: false, motivo: r };
  } catch (e) {
    return { ok: false, motivo: codigoErro(e, 'historico') };
  }
}

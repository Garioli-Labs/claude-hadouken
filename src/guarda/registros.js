import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico } from '../estado.js';
import { fechar, idValido, instante, numeroFinito } from '../base.js';
import { lerSemLink } from './arquivo.js';

// Registros locais da guarda (spec v0.4.0 §4.3, §5.2, §6.5 e §14). Cada um
// num arquivo novo, com teto de bytes, lstat e reconstrução só dos campos
// conhecidos. Ilegível é fail-open (lista vazia): são sinais e contagens, não
// a trava; a trava é guarda.json. Apagar despachos-fable.json zera a contagem
// do G7 (declarado em R1). Nada daqui volta como texto ao Claude sem passar
// por mensagens.js (só rótulos fixos e números).

export const ARQ_EVENTOS = 'guarda-eventos.json';
export const ARQ_DESPACHOS = 'despachos-fable.json';
export const ARQ_LIMITES = 'limites-atingidos.json';
export const ARQ_MODELOS = 'modelos.json';
export const DIR_MARCAS = 'guarda-sessoes';
const EVENTOS_MAX_BYTES = 64 * 1024;
const PEQUENO_MAX_BYTES = 16 * 1024;
const EVENTOS_MAX = 200;
const DESPACHOS_MAX = 200;
const MODELOS_MAX = 50;
const H = 3_600_000;
const DESPACHOS_IDADE_MS = 24 * H;
const LIMITE_IDADE_MS = 7 * 24 * H;
const FUTURO_MS = 5 * 60_000;
export const TIPOS_EVENTO = Object.freeze([
  'disparo', 'negado', 'prompt-bloqueado', 'troca-bloqueada', 'liberacao', 'liberacao-recusada',
  'filha-negada', 'arquivo-negado', 'desconhecido', 'erro',
]);
const DETALHE_MAX = 40;
const DETALHE = new RegExp(`^[A-Za-z0-9:._-]{0,${DETALHE_MAX}}$`);
// M2 da revisão final da parte 1: a junção das travas ativas que P1, P2 e P3
// registram passa de 40 caracteres com as quatro chaves (41; 50 com
// 'ilegivel'). Cortar antes de validar guarda o começo em vez de perder o
// detalhe inteiro; o corte nunca torna válido o que tem caractere de fora.
const detalheValido = (d) => {
  if (typeof d !== 'string') return null;
  const c = d.slice(0, DETALHE_MAX);
  return DETALHE.test(c) ? c : null;
};
export const MODELO_VALIDO = /^[A-Za-z0-9._:[\]-]{1,80}$/;

// Nome de modelo vindo de hook (SessionStart `model`, PostModelSwitch
// `to_model`): o nome, se casa MODELO_VALIDO; senão só o rótulo 'fable' ou
// 'outro', para uma troca para nome estranho nunca deixar o modelo antigo
// gravado (a P2 decidiria pelo nome velho). Nunca repete o texto.
export function normalizarModelo(bruto) {
  if (typeof bruto !== 'string' || bruto.length === 0) return null;
  if (MODELO_VALIDO.test(bruto)) return bruto;
  return /fable/i.test(bruto.slice(0, 200)) ? 'fable' : 'outro';
}
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nomeMarca = (id) => Buffer.from(id, 'utf8').toString('hex');

function ler(dir, arq, max) {
  const lido = lerSemLink(path.join(dir, arq), max);
  return lido.ok && ehObjeto(lido.valor) && lido.valor.v === 1 ? lido.valor : null;
}
const gravar = (dir, arq, valor) => ({ ok: gravarJsonAtomico(path.join(dir, arq), { v: 1, ...valor }).ok });

export function lerEventos(dir, agoraMs) {
  try {
    const v = ler(dir, ARQ_EVENTOS, EVENTOS_MAX_BYTES);
    if (!v || !Array.isArray(v.eventos)) return [];
    const r = [];
    for (const e of v.eventos.slice(-EVENTOS_MAX)) {
      if (!ehObjeto(e) || !TIPOS_EVENTO.includes(e.tipo)) continue;
      const t = instante(e.at, agoraMs);
      if (t === null) continue;
      const detalhe = typeof e.detalhe === 'string' && DETALHE.test(e.detalhe) ? e.detalhe : null;
      r.push({ at: new Date(t).toISOString(), tipo: e.tipo, detalhe });
    }
    return r;
  } catch {
    return [];
  }
}

export function anexarEvento(dir, tipo, detalhe, agoraMs) {
  try {
    if (!TIPOS_EVENTO.includes(tipo) || !numeroFinito(agoraMs)) return { ok: false };
    const d = detalheValido(detalhe);
    const eventos = [...lerEventos(dir, agoraMs), { at: new Date(agoraMs).toISOString(), tipo, detalhe: d }];
    return gravar(dir, ARQ_EVENTOS, { eventos: eventos.slice(-EVENTOS_MAX) });
  } catch {
    return { ok: false };
  }
}

// Sinal de R1: uma liberação ativa sem o evento dela aparece na barra como
// "liberação sem origem". Os dois arquivos podem ser forjados; é sinal, não prova.
export function temEventoLiberacao(dir, id, agoraMs) {
  return lerEventos(dir, agoraMs).some((e) => e.tipo === 'liberacao' && e.detalhe === id);
}

// Os dois sinais da barra numa leitura só (M3 e M4 da revisão final da parte
// 1): a origem da liberação em vigor (idLiberacao null = nenhuma, conta como
// conhecida) e um evento 'erro' de hook nos últimos ERRO_RECENTE_MS, que a
// barra mostra como "guarda com erro" (spec v0.4.0 §4.5).
export const ERRO_RECENTE_MS = 15 * 60_000;
export function sinaisDaBarra(dir, idLiberacao, agoraMs) {
  const eventos = lerEventos(dir, agoraMs);
  return {
    origemConhecida: idLiberacao === null || eventos.some((e) => e.tipo === 'liberacao' && e.detalhe === idLiberacao),
    erroRecente: eventos.some((e) => e.tipo === 'erro' && agoraMs - Date.parse(e.at) <= ERRO_RECENTE_MS),
  };
}

export function despachosFableRecentes(dir, agoraMs) {
  try {
    const v = ler(dir, ARQ_DESPACHOS, PEQUENO_MAX_BYTES);
    if (!v || !Array.isArray(v.at) || !numeroFinito(agoraMs)) return [];
    return v.at
      .filter((t) => numeroFinito(t) && t > agoraMs - DESPACHOS_IDADE_MS && t <= agoraMs + FUTURO_MS)
      .sort((a, b) => a - b)
      .slice(-DESPACHOS_MAX);
  } catch {
    return [];
  }
}

export function registrarDespachoFable(dir, agoraMs) {
  try {
    if (!numeroFinito(agoraMs)) return { ok: false };
    const at = [...despachosFableRecentes(dir, agoraMs), agoraMs].sort((a, b) => a - b).slice(-DESPACHOS_MAX);
    return gravar(dir, ARQ_DESPACHOS, { at });
  } catch {
    return { ok: false };
  }
}

// O StopFailure não traz o horário do reset de forma estruturada; resets_at
// fica null e o G6 cai no reset de 7d (gatilhos.js).
export function ultimoLimiteFable(dir, agoraMs) {
  try {
    const v = ler(dir, ARQ_LIMITES, PEQUENO_MAX_BYTES);
    const t = v?.fable;
    if (!numeroFinito(t) || !numeroFinito(agoraMs) || t > agoraMs + FUTURO_MS || agoraMs - t > LIMITE_IDADE_MS) return null;
    return { atMs: t, resets_at: null };
  } catch {
    return null;
  }
}

export function registrarLimite(dir, tipo, agoraMs) {
  try {
    if ((tipo !== 'fable' && tipo !== 'geral') || !numeroFinito(agoraMs)) return { ok: false };
    const v = ler(dir, ARQ_LIMITES, PEQUENO_MAX_BYTES);
    const atual = { fable: numeroFinito(v?.fable) ? v.fable : null, geral: numeroFinito(v?.geral) ? v.geral : null };
    atual[tipo] = agoraMs;
    return gravar(dir, ARQ_LIMITES, atual);
  } catch {
    return { ok: false };
  }
}

function modelosValidos(v, agoraMs) {
  const r = [];
  if (!ehObjeto(v?.sessoes)) return r;
  for (const [id, s] of Object.entries(v.sessoes)) {
    if (!idValido(id) || !ehObjeto(s) || typeof s.modelo !== 'string' || !MODELO_VALIDO.test(s.modelo)) continue;
    const t = instante(s.at, agoraMs);
    if (t !== null) r.push([id, { modelo: s.modelo, at: new Date(t).toISOString() }]);
  }
  return r;
}

export function modeloDaSessao(dir, sessionId, agoraMs) {
  try {
    if (!idValido(sessionId)) return null;
    const achado = modelosValidos(ler(dir, ARQ_MODELOS, PEQUENO_MAX_BYTES), agoraMs).find(([id]) => id === sessionId);
    return achado ? achado[1].modelo : null;
  } catch {
    return null;
  }
}

export function gravarModeloSessao(dir, sessionId, modelo, agoraMs) {
  try {
    if (!idValido(sessionId) || typeof modelo !== 'string' || !MODELO_VALIDO.test(modelo) || !numeroFinito(agoraMs)) return { ok: false };
    const lista = modelosValidos(ler(dir, ARQ_MODELOS, PEQUENO_MAX_BYTES), agoraMs).filter(([id]) => id !== sessionId);
    lista.push([sessionId, { modelo, at: new Date(agoraMs).toISOString() }]);
    lista.sort((a, b) => Date.parse(a[1].at) - Date.parse(b[1].at));
    const sessoes = Object.create(null);
    for (const [id, s] of lista.slice(-MODELOS_MAX)) sessoes[id] = s;
    return gravar(dir, ARQ_MODELOS, { sessoes });
  } catch {
    return { ok: false };
  }
}

// Marca "esta sessão roda os hooks da v0.4.0" (spec §4.1 e §11): a barra diz
// "sem guarda nesta sessão" quando a marca falta. Um arquivo vazio por sessão,
// nome em hex como em ativas/ (o NTFS não diferencia maiúsculas). Como em
// ativas.js: a pasta precisa ser pasta de verdade (um link ou junção para
// outro lugar não é atravessado), e a marca é lida por lstat e criada com
// 'wx' (O_CREAT|O_EXCL), que nunca segue nem trunca um link plantado no
// lugar dela. Link ou pasta no lugar da marca = não marcada.
function pastaMarcas(dir, criar) {
  const pasta = path.join(dir, DIR_MARCAS);
  if (criar) fs.mkdirSync(pasta, { recursive: true });
  return fs.lstatSync(pasta, { throwIfNoEntry: false })?.isDirectory() === true ? pasta : null;
}

const ehArquivo = (arq) => fs.lstatSync(arq, { throwIfNoEntry: false })?.isFile() === true;

export function marcarSessao(dir, sessionId) {
  try {
    if (!idValido(sessionId)) return { ok: false };
    const pasta = pastaMarcas(dir, true);
    if (pasta === null) return { ok: false };
    const arq = path.join(pasta, nomeMarca(sessionId));
    const info = fs.lstatSync(arq, { throwIfNoEntry: false });
    if (info) return { ok: info.isFile() };
    let fd;
    try {
      fd = fs.openSync(arq, 'wx');
    } catch (e) {
      // Outra sessão (ou outro hook desta) criou a marca entre o lstat e o open.
      return { ok: e?.code === 'EEXIST' && ehArquivo(arq) };
    }
    try {
      return { ok: fs.fstatSync(fd).isFile() };
    } finally {
      fechar(fd);
    }
  } catch {
    return { ok: false };
  }
}

export function sessaoMarcada(dir, sessionId) {
  try {
    if (!idValido(sessionId)) return false;
    const pasta = pastaMarcas(dir, false);
    return pasta !== null && ehArquivo(path.join(pasta, nomeMarca(sessionId)));
  } catch {
    return false;
  }
}

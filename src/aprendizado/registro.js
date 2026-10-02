import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico } from '../estado.js';
import { lerSemLink, lerTextoSemLink } from '../guarda/arquivo.js';
import { MODELO_VALIDO } from '../guarda/registros.js';
import { TOLERANCIA_JANELA_S } from '../util.js';
import { apagar, esperar, fechar, instante, numeroFinito, varrerTmpVelhos } from '../base.js';
import { ITENS, TETO, caminhos, ligadoExiste, valorDoItem } from './arquivos.js';
import {
  aprendizadoVazio, CAMPOS_MODELO, CHAVE_MODELO, DURACAO_JANELA_MS, inicioSemana, JANELAS_MAX, LIMIARES, MODELOS_SEMANA_MAX, SEMANAS_MAX,
} from './agregar.js';

// Leitura e gravação dos arquivos do aprendizado (spec aprendizado §3.1,
// §4.7, §6 e R8): gravação atômica, lstat antes de ler (link é inválido),
// teto de bytes e reconstrução só dos campos conhecidos. Arquivo inválido
// volta vazio (§6). Nenhuma função lança.

const DIA_MS = 86_400_000;
const FUTURO_MS = 5 * 60_000;
const TOLERANCIA_MS = TOLERANCIA_JANELA_S * 1000;
// Bloqueio (desfazer, recusar) de até 8 dias; mais que isso é inválido e
// sai, então um relógio adiantado ou um arquivo forjado nunca trava um item
// para sempre (Foco de revisão 4).
export const BLOQUEIO_MAX_MS = 8 * DIA_MS;
const REGISTROS_MAX = 200;
const BLOQUEIOS_MAX = 50;
const SUGESTOES_MAX = 30;
const EVENTOS_MAX = 50;
const TRAVA_VENCIDA_MS = 120_000;
const TRAVA_TENTATIVAS = 5;
const TRAVA_ESPERA_MS = 50;
// 'comando-recusado': o /claude-hadouken:aprender recusado por vir de -p/SDK
// ou de uma origem que não é o comando digitado (Task 11, ruling I1), só com
// o aprendizado ligado.
export const TIPOS_EVENTO_APR = Object.freeze([
  'porta-ocupada', 'pouca-ram', 'coletor-hash', 'coletor-falhou', 'coletor-ausente', 'ajuste-fora', 'erro', 'sem-otel', 'orfao', 'telemetria-corrompida',
  'comando-recusado',
]);
export const MOTIVOS = Object.freeze([
  'fora-do-horario', 'horario-mudou', 'faixa-historico', 'perfil-por-hora', 'perfil-insuficiente', 'esgotou-2-de-3', 'sobra-4-semanas', 'desfazer',
]);
export const ORIGENS_REGISTRO = Object.freeze(['auto', 'aprovado', 'desfeito']);
export const ORIGEM_VALIDA = /^(?:principal|outro|sub|sub:[A-Za-z0-9._-]{1,40})$/;
export const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const EFFORT_OU_TRACO = new Set(['low', 'medium', 'high', 'xhigh', 'max', '-']);
const ID_AJUSTE = /^a\d{1,6}$/;
const ID_SUGESTAO = /^s\d{1,6}$/;
const CHAVE_BLOQUEIO = /^(?:(?:painel|previsao|guarda)\.[A-Za-z0-9]{1,30}|(?:afrouxar|modelo):[A-Za-z0-9._:|[\]-]{1,300})$/;
const CHAVE_ENV = /^(?:CLAUDE_CODE_ENABLE_TELEMETRY|OTEL_[A-Z_]{1,60})$/;
const VALOR_ENV = /^[A-Za-z0-9:/._-]{1,100}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lista = (v) => (Array.isArray(v) ? v : []);
const inteiroEntre = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const msValido = (n, agoraMs) => numeroFinito(n) && n >= 0 && n <= agoraMs + FUTURO_MS;
const diaLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { diaLocal };

function lerV1(arquivo, teto) {
  const l = lerSemLink(arquivo, teto);
  return l.ok && ehObjeto(l.valor) && l.valor.v === 1 ? l.valor : null;
}

// ------------------------------------------------------------ aprendizado.json

// (Não se chama janelaValida: esse nome é de util.js, test/casa-unica.test.js.)
// A regra de agregar.js (atualizarJanela, marcarNaJanela): um instante conta
// para a janela de reset R se R − duração < instante ≤ R; a tolerância só
// localiza a janela pelo reset. O cruzou e o esgotou fora disso saem. O
// reset vale até a duração mais a tolerância à frente de agora, a mesma
// conta do podar.
function resumoDeJanela(j, tipo, agoraMs) {
  const dur = DURACAO_JANELA_MS[tipo];
  if (!ehObjeto(j) || !numeroFinito(j.reset) || j.reset <= 0 || j.reset > agoraMs + dur + TOLERANCIA_MS) return null;
  if (!numeroFinito(j.max) || j.max < 0 || j.max > 100) return null;
  const naJanela = (t) => msValido(t, agoraMs) && t > j.reset - dur && t <= j.reset;
  const cruzou = {};
  if (ehObjeto(j.cruzou)) {
    for (const T of LIMIARES) {
      const k = String(T);
      if (Object.hasOwn(j.cruzou, k) && naJanela(j.cruzou[k])) cruzou[k] = j.cruzou[k];
    }
  }
  const esgotou = naJanela(j.esgotou) ? j.esgotou : null;
  return { reset: j.reset, max: j.max, cruzou, esgotou, disparou: j.disparou === true };
}

// Em ordem de reset, como o atualizarJanela as deixa; de duas com reset
// dentro da tolerância (a mesma janela), vale a primeira.
function janelasDe(bruto, tipo, agoraMs) {
  const validas = lista(bruto).map((j) => resumoDeJanela(j, tipo, agoraMs)).filter(Boolean).sort((a, b) => a.reset - b.reset);
  const r = [];
  for (const j of validas) if (r.length === 0 || j.reset - r.at(-1).reset > TOLERANCIA_MS) r.push(j);
  return r.slice(-JANELAS_MAX[tipo]);
}

// O início de uma semana: AAAA-MM-DD de uma data que existe, numa
// segunda-feira (inicioSemana da própria data devolve o mesmo texto; um
// 2026-02-30 vira 2026-03-02 e não casa) e não depois da semana de agora.
function inicioDeSemanaValido(inicio, semanaAtual) {
  if (typeof inicio !== 'string' || !DIA_ISO.test(inicio) || inicio > semanaAtual) return false;
  const [a, m, d] = inicio.split('-').map(Number);
  return inicioSemana(new Date(a, m - 1, d).getTime()) === inicio;
}

export function validarAprendizado(v, agoraMs) {
  try {
    if (!ehObjeto(v) || v.v !== 1 || !msValido(v.desde, agoraMs)) return null;
    const ap = aprendizadoVazio(v.desde);
    ap.sessoes = inteiroEntre(v.sessoes, 0, 1_000_000) ? v.sessoes : 0;
    // Filtro antes do corte em SEMANAS_MAX (revisão I1): uma semana forjada
    // não toma a vaga de uma real nem a ponta que o perfilDe lê.
    const semanaAtual = inicioSemana(agoraMs);
    for (const s of lista(v.semanas)) {
      if (!ehObjeto(s) || !inicioDeSemanaValido(s.inicio, semanaAtual) || !ehObjeto(s.modelos)) continue;
      if (!Array.isArray(s.ativo) || s.ativo.length !== 168 || ap.semanas.some((x) => x.inicio === s.inicio)) continue;
      const modelos = {};
      for (const [k, arr] of Object.entries(s.modelos).slice(0, MODELOS_SEMANA_MAX)) {
        if (!CHAVE_MODELO.test(k) || !Array.isArray(arr) || arr.length !== CAMPOS_MODELO.length) continue;
        if (arr.every((n) => numeroFinito(n) && n >= 0)) modelos[k] = [...arr];
      }
      ap.semanas.push({ inicio: s.inicio, modelos, ativo: s.ativo.map((m) => (numeroFinito(m) && m >= 0 && m <= 60 ? m : 0)) });
    }
    ap.semanas.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
    ap.semanas = ap.semanas.slice(-SEMANAS_MAX);
    for (const col of ['h5', 'd7']) {
      const r = ehObjeto(v.ritmo) ? v.ritmo[col] : undefined;
      if (Array.isArray(r) && r.length === 24 && r.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => numeroFinito(n) && n >= 0))) {
        ap.ritmo[col] = r.map((p) => [p[0], p[1]]);
      }
    }
    for (const tipo of Object.keys(JANELAS_MAX)) {
      ap.janelas[tipo] = janelasDe(ehObjeto(v.janelas) ? v.janelas[tipo] : undefined, tipo, agoraMs);
    }
    return ap;
  } catch {
    return null;
  }
}

export function lerAprendizado(dir, agoraMs) {
  return validarAprendizado(lerV1(caminhos(dir).aprendizado, TETO.aprendizado), agoraMs) ?? aprendizadoVazio(agoraMs);
}

// JSON compacto (os agregados são listas longas de números); acima do teto,
// as semanas mais antigas saem primeiro.
export function gravarAprendizado(dir, ap) {
  try {
    const copia = { ...ap, v: 1, semanas: [...ap.semanas] };
    while (Buffer.byteLength(JSON.stringify(copia)) > TETO.aprendizado && copia.semanas.length > 0) copia.semanas.shift();
    return { ok: gravarJsonAtomico(caminhos(dir).aprendizado, copia, { compacto: true }).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ ajustes.json

const vigentesPadrao = () => Object.fromEntries(Object.entries(ITENS).map(([k, d]) => [k, d.padrao]));
const perfilVazio = () => ({ horasAtivas: [0, 0, 0, 0, 0, 0, 0], ritmoHora: { h5: new Array(24).fill(null), d7: new Array(24).fill(null) } });

export function ajustesVazios() {
  return { v: 1, seq: 0, vigentes: vigentesPadrao(), registros: [], bloqueios: {}, perfil: perfilVazio() };
}

function registroValido(r, agoraMs) {
  if (!ehObjeto(r) || typeof r.id !== 'string' || !ID_AJUSTE.test(r.id) || typeof r.item !== 'string' || !Object.hasOwn(ITENS, r.item)) return null;
  const antes = valorDoItem(r.item, r.antes);
  const depois = valorDoItem(r.item, r.depois);
  if (antes === undefined || depois === undefined || !MOTIVOS.includes(r.motivo) || !ORIGENS_REGISTRO.includes(r.origem)) return null;
  const em = instante(r.em, agoraMs);
  return em === null ? null : { id: r.id, item: r.item, antes, depois, motivo: r.motivo, em: new Date(em).toISOString(), origem: r.origem };
}

function perfilValido(p) {
  const r = perfilVazio();
  if (!ehObjeto(p)) return r;
  if (Array.isArray(p.horasAtivas) && p.horasAtivas.length === 7 && p.horasAtivas.every((m) => inteiroEntre(m, 0, 0xffffff))) {
    r.horasAtivas = [...p.horasAtivas];
  }
  for (const col of ['h5', 'd7']) {
    const a = ehObjeto(p.ritmoHora) ? p.ritmoHora[col] : undefined;
    if (Array.isArray(a) && a.length === 24) r.ritmoHora[col] = a.map((x) => (numeroFinito(x) && x >= 0 && x <= 100 ? x : null));
  }
  return r;
}

export function validarAjustes(v, agoraMs) {
  try {
    if (!ehObjeto(v) || v.v !== 1) return null;
    const aj = ajustesVazios();
    aj.seq = inteiroEntre(v.seq, 0, 999_999) ? v.seq : 0;
    if (ehObjeto(v.vigentes)) {
      for (const item of Object.keys(ITENS)) {
        if (!Object.hasOwn(v.vigentes, item)) continue;
        const x = valorDoItem(item, v.vigentes[item]);
        if (x !== undefined) aj.vigentes[item] = x;
      }
    }
    if (aj.vigentes['painel.amarelo'] >= aj.vigentes['painel.vermelho']) {
      aj.vigentes['painel.amarelo'] = ITENS['painel.amarelo'].padrao;
      aj.vigentes['painel.vermelho'] = ITENS['painel.vermelho'].padrao;
    }
    for (const r of lista(v.registros).slice(-REGISTROS_MAX)) {
      const x = registroValido(r, agoraMs);
      if (x !== null) aj.registros.push(x);
    }
    if (ehObjeto(v.bloqueios)) {
      for (const [k, ate] of Object.entries(v.bloqueios).slice(0, BLOQUEIOS_MAX)) {
        if (CHAVE_BLOQUEIO.test(k) && numeroFinito(ate) && ate > agoraMs && ate <= agoraMs + BLOQUEIO_MAX_MS) aj.bloqueios[k] = ate;
      }
    }
    aj.perfil = perfilValido(v.perfil);
    // Um id novo nunca repete um antigo.
    for (const r of aj.registros) aj.seq = Math.max(aj.seq, Number(r.id.slice(1)));
    return aj;
  } catch {
    return null;
  }
}

export function lerAjustes(dir, agoraMs) {
  return validarAjustes(lerV1(caminhos(dir).ajustes, TETO.ajustes), agoraMs) ?? ajustesVazios();
}

// Teto de 64 KiB (§4.7): os registros mais antigos saem primeiro.
export function gravarAjustes(dir, aj) {
  try {
    const bloqueios = Object.fromEntries(Object.entries(aj.bloqueios).slice(-BLOQUEIOS_MAX));
    const copia = { ...aj, v: 1, bloqueios, registros: aj.registros.slice(-REGISTROS_MAX) };
    const grande = () => Buffer.byteLength(JSON.stringify(copia, null, 2)) > TETO.ajustes;
    while (grande() && copia.registros.length > 0) copia.registros.shift();
    // Sem registros e ainda grande: só os bloqueios podem ser; saem todos.
    if (grande()) copia.bloqueios = {};
    return { ok: gravarJsonAtomico(caminhos(dir).ajustes, copia).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ sugestoes.json

export function sugestoesVazias() {
  return { v: 1, seq: 0, lista: [] };
}

const modeloEffortValido = (x) => ehObjeto(x) && typeof x.modelo === 'string' && MODELO_VALIDO.test(x.modelo) && EFFORT_OU_TRACO.has(x.effort);

function sugestaoValida(s, agoraMs) {
  if (!ehObjeto(s) || typeof s.id !== 'string' || !ID_SUGESTAO.test(s.id) || !['pendente', 'aprovada'].includes(s.estado)) return null;
  const em = instante(s.em, agoraMs);
  if (em === null) return null;
  const base = { id: s.id, estado: s.estado, em: new Date(em).toISOString() };
  if (s.tipo === 'afrouxar') {
    if (typeof s.item !== 'string' || !Object.hasOwn(ITENS, s.item) || ITENS[s.item].tipo !== 'guarda') return null;
    const de = valorDoItem(s.item, s.de);
    const para = valorDoItem(s.item, s.para);
    if (!Number.isInteger(de) || !Number.isInteger(para) || para <= de) return null;
    return { ...base, tipo: 'afrouxar', item: s.item, de, para };
  }
  if (s.tipo === 'modelo') {
    if (typeof s.origem !== 'string' || !ORIGEM_VALIDA.test(s.origem) || !modeloEffortValido(s.de) || !modeloEffortValido(s.para)) return null;
    if (!numeroFinito(s.razao) || s.razao < 2 || s.razao > 1000) return null;
    if (![s.erroDe, s.erroPara].every((x) => numeroFinito(x) && x >= 0 && x <= 100)) return null;
    return {
      ...base, tipo: 'modelo', origem: s.origem,
      de: { modelo: s.de.modelo, effort: s.de.effort }, para: { modelo: s.para.modelo, effort: s.para.effort },
      razao: s.razao, erroDe: s.erroDe, erroPara: s.erroPara,
    };
  }
  return null;
}

export function lerSugestoes(dir, agoraMs) {
  try {
    const v = lerV1(caminhos(dir).sugestoes, TETO.sugestoes);
    if (v === null) return sugestoesVazias();
    const sug = { v: 1, seq: inteiroEntre(v.seq, 0, 999_999) ? v.seq : 0, lista: [] };
    for (const s of lista(v.lista).slice(-SUGESTOES_MAX)) {
      const x = sugestaoValida(s, agoraMs);
      if (x !== null && !sug.lista.some((y) => y.id === x.id)) sug.lista.push(x);
    }
    for (const s of sug.lista) sug.seq = Math.max(sug.seq, Number(s.id.slice(1)));
    return sug;
  } catch {
    return sugestoesVazias();
  }
}

// Acima do teto: saem primeiro as aprovadas mais antigas, depois as pendentes.
export function gravarSugestoes(dir, sug) {
  try {
    const copia = { v: 1, seq: sug.seq, lista: [...sug.lista] };
    const grande = () => copia.lista.length > SUGESTOES_MAX || Buffer.byteLength(JSON.stringify(copia, null, 2)) > TETO.sugestoes;
    while (grande() && copia.lista.length > 0) {
      const i = copia.lista.findIndex((s) => s.estado === 'aprovada');
      copia.lista.splice(i === -1 ? 0 : i, 1);
    }
    return { ok: gravarJsonAtomico(caminhos(dir).sugestoes, copia).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ cursor

export function cursorVazio() {
  return { v: 1, arquivo: null, historicoAte: 0, anuncio: { dia: null, ajustes: 0, sugestoes: 0 }, avisos: {} };
}

export function lerCursor(dir, agoraMs) {
  const c = cursorVazio();
  try {
    const v = lerV1(caminhos(dir).cursor, TETO.cursor);
    if (v === null) return c;
    const a = v.arquivo;
    if (ehObjeto(a) && typeof a.ino === 'string' && /^\d{1,40}$/.test(a.ino) && Number.isSafeInteger(a.pos) && a.pos >= 0) c.arquivo = { ino: a.ino, pos: a.pos };
    if (msValido(v.historicoAte, agoraMs)) c.historicoAte = v.historicoAte;
    if (ehObjeto(v.anuncio)) {
      if (typeof v.anuncio.dia === 'string' && DIA_ISO.test(v.anuncio.dia)) c.anuncio.dia = v.anuncio.dia;
      for (const k of ['ajustes', 'sugestoes']) if (inteiroEntre(v.anuncio[k], 0, 999_999)) c.anuncio[k] = v.anuncio[k];
    }
    if (ehObjeto(v.avisos)) {
      for (const t of TIPOS_EVENTO_APR) {
        if (Object.hasOwn(v.avisos, t) && typeof v.avisos[t] === 'string' && DIA_ISO.test(v.avisos[t])) c.avisos[t] = v.avisos[t];
      }
    }
    return c;
  } catch {
    return cursorVazio();
  }
}

export function gravarCursor(dir, c) {
  try {
    return { ok: gravarJsonAtomico(caminhos(dir).cursor, { ...c, v: 1 }).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ eventos

export function lerEventosApr(dir, agoraMs) {
  try {
    const v = lerV1(caminhos(dir).eventos, TETO.eventos);
    const r = [];
    for (const e of lista(v?.eventos).slice(-EVENTOS_MAX)) {
      if (!ehObjeto(e) || !TIPOS_EVENTO_APR.includes(e.tipo)) continue;
      const t = instante(e.at, agoraMs);
      if (t !== null) r.push({ at: new Date(t).toISOString(), tipo: e.tipo });
    }
    return r;
  } catch {
    return [];
  }
}

export function anexarEventoApr(dir, tipo, agoraMs) {
  try {
    if (typeof dir !== 'string' || !TIPOS_EVENTO_APR.includes(tipo) || !numeroFinito(agoraMs)) return { ok: false };
    const eventos = [...lerEventosApr(dir, agoraMs), { at: new Date(agoraMs).toISOString(), tipo }].slice(-EVENTOS_MAX);
    return { ok: gravarJsonAtomico(caminhos(dir).eventos, { v: 1, eventos }).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ ligado.json (R8)

export function lerLigado(dir) {
  try {
    const v = lerV1(caminhos(dir).ligado, TETO.ligado);
    if (v === null || !ehObjeto(v.chaves) || typeof v.criouEnv !== 'boolean') return null;
    const chaves = {};
    for (const [k, x] of Object.entries(v.chaves).slice(0, 20)) {
      if (CHAVE_ENV.test(k) && typeof x === 'string' && VALOR_ENV.test(x)) chaves[k] = x;
    }
    return { chaves, criouEnv: v.criouEnv };
  } catch {
    return null;
  }
}

export function gravarLigado(dir, { chaves, criouEnv }, agoraMs) {
  try {
    fs.mkdirSync(caminhos(dir).otel, { recursive: true });
    return { ok: gravarJsonAtomico(caminhos(dir).ligado, { v: 1, chaves, criouEnv, em: new Date(agoraMs).toISOString() }).ok };
  } catch {
    return { ok: false };
  }
}

export function apagarLigado(dir) {
  apagar(caminhos(dir).ligado);
}

// ------------------------------------------------------------ trava

const novoToken = () => crypto.randomBytes(16).toString('hex');
const travaVencida = (info) => info.isFile() && Date.now() - info.mtimeMs >= TRAVA_VENCIDA_MS;
// Sobra de uma retomada interrompida entre o rename e o unlink.
const ehTravaVelha = (nome) => /^aprendizado\.lock\.[0-9a-f]{32}\.velha$/.test(nome);

// Retoma a trava vencida (revisão I3): renomeia para um nome único e só
// então confere, já no nome novo, que ainda é uma trava vencida. Dois passos
// que viram a mesma trava vencida: o primeiro leva no rename; o segundo
// perde o rename (ENOENT) e não apaga nada, ou chega depois de o primeiro já
// ter criado a trava nova e a leva no rename. Nesse caso a trava levada não
// está vencida: volta para o lugar por link, que nunca sobrescreve, e o
// nome único sai. Devolve true só quando apagou uma trava vencida. Exportada
// com _ só para o teste dos dois passos intercalados. Nunca lança.
export function _retomarTravaVencida(arq) {
  const velha = `${arq}.${novoToken()}.velha`;
  try {
    fs.renameSync(arq, velha);
  } catch {
    return false;
  }
  try {
    const info = fs.lstatSync(velha);
    if (travaVencida(info)) {
      apagar(velha);
      varrerTmpVelhos(path.dirname(arq), ehTravaVelha);
      return true;
    }
    if (!info.isFile()) {
      fs.renameSync(velha, arq);
      return false;
    }
    try {
      fs.linkSync(velha, arq);
    } catch (e) {
      // Sem link no sistema de arquivos: volta pelo rename, se o nome ainda
      // estiver livre. Com EEXIST, um terceiro passo já criou a dele.
      if (e?.code !== 'EEXIST' && !fs.existsSync(arq)) fs.renameSync(velha, arq);
    }
    apagar(velha);
  } catch {
    /* melhor esforço */
  }
  return false;
}

// Solta só a trava que tem o token deste dono, lida sem seguir link
// (revisão I2): um passo lento cuja trava venceu e foi retomada por outro não
// solta a do outro, em qualquer sistema de arquivos.
function soltarTrava(arq, token) {
  try {
    const l = lerTextoSemLink(arq, 1024);
    if (l.ok && l.texto === token) apagar(arq);
  } catch {
    /* fica para a retomada */
  }
}

// Um passo por vez (Foco de revisão 3): arquivo criado com 'wx', com um token
// aleatório do dono no conteúdo. Trava com mais de 2 min pelo mtime é de um
// processo morto e é retomada (_retomarTravaVencida). Até 5 tentativas com
// 50 ms entre elas; depois, 'ocupada'.
export function pegarTrava(dir) {
  let arq;
  try {
    arq = caminhos(dir).trava;
  } catch {
    return { ok: false, motivo: 'erro' };
  }
  const token = novoToken();
  for (let i = 0; i < TRAVA_TENTATIVAS; i++) {
    let fd;
    try {
      fd = fs.openSync(arq, 'wx');
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, motivo: 'erro' };
      let info;
      try {
        info = fs.lstatSync(arq);
      } catch {
        continue;
      }
      if (travaVencida(info)) {
        _retomarTravaVencida(arq);
        continue;
      }
      if (i < TRAVA_TENTATIVAS - 1) esperar(TRAVA_ESPERA_MS);
      continue;
    }
    try {
      fs.writeSync(fd, token);
    } catch {
      fechar(fd);
      apagar(arq);
      return { ok: false, motivo: 'erro' };
    }
    fechar(fd);
    return { ok: true, soltar: () => soltarTrava(arq, token) };
  }
  return { ok: false, motivo: 'ocupada' };
}

// ------------------------------------------------------------ consumidores

// Os vigentes e o perfil para o painel e a previsão, ou null quando o
// aprendizado está desligado ou o ajustes.json não vale: o consumidor usa os
// valores de hoje (§11).
export function ajustesParaConsumo(dir, agoraMs) {
  try {
    if (!ligadoExiste(dir)) return null;
    const aj = validarAjustes(lerV1(caminhos(dir).ajustes, TETO.ajustes), agoraMs);
    return aj === null ? null : { vigentes: aj.vigentes, perfil: aj.perfil };
  } catch {
    return null;
  }
}

export function horaAtiva(perfil, ms) {
  const d = new Date(ms);
  return ((perfil.horasAtivas[(d.getDay() + 6) % 7] >>> d.getHours()) & 1) === 1;
}

// O intervalo aprendido fora das horas ativas (R9), em ms; null = o de hoje.
export function intervaloDoPainelMs(dir, agoraMs) {
  const a = ajustesParaConsumo(dir, agoraMs);
  if (a === null) return null;
  const s = a.vigentes['painel.intervaloS'];
  if (s === ITENS['painel.intervaloS'].padrao || horaAtiva(a.perfil, agoraMs)) return null;
  return s * 1000;
}

export function faixasDoPainel(dir, agoraMs) {
  const a = ajustesParaConsumo(dir, agoraMs);
  return a === null
    ? { amarelo: ITENS['painel.amarelo'].padrao, vermelho: ITENS['painel.vermelho'].padrao }
    : { amarelo: a.vigentes['painel.amarelo'], vermelho: a.vigentes['painel.vermelho'] };
}

export function perfilDaPrevisao(dir, agoraMs) {
  const a = ajustesParaConsumo(dir, agoraMs);
  if (a === null || !(a.vigentes['previsao.pesoPerfil'] > 0)) return null;
  return { peso: a.vigentes['previsao.pesoPerfil'], h5: a.perfil.ritmoHora.h5, d7: a.perfil.ritmoHora.d7 };
}

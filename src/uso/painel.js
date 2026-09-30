import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apagar, DATA_MAX_MS, dirDados, fechar, instante, numeroFinito } from '../base.js';
import { ARQ_ESTADO, gravarJsonAtomico, lerJson, LIMITE_VELHO_MS, limitesValidos, sessoesAtivas, validarEstado } from '../estado.js';
import { diaHora, horaLocal } from '../util.js';
import { acharClaude, ambienteUso, rodarUso } from './oficial.js';
import { fraseEsgota } from './frase.js';

// Lógica do painel do VS Code (spec, emenda E3, E4 e E8/S28). A extensão é
// fina: carrega este módulo pelo shim estável <dirDados>/bin/painel.mjs e só
// chama talvezAtualizar (a cada 30 s e no comando manual) e estadoPainel
// (para desenhar o item da barra de status). A leitura oficial vem de
// `claude -p /usage` (oficial.js), sem modelo e sem tokens, e fica em
// <dirDados>/uso-oficial.json. Nenhuma função daqui lança, e talvezAtualizar
// nunca rejeita.
//
// fs e os são usados pelo objeto padrão (fs.openSync, os.freemem), nunca
// desestruturados, como no resto do plugin.

export const ARQ_USO = 'uso-oficial.json';
export const ARQ_TRAVA = 'uso-oficial.lock';
// Pasta vazia onde o `claude` roda, para o índice de arquivos não varrer
// nada (E3).
export const DIR_CWD = 'uso-cwd';
export const INTERVALO_MS = 30_000;
// Trava mais velha que isto é de um processo morto: a leitura dura no
// máximo 30 s (PRAZO_USO_MS), então 90 s é folga de sobra (E3, Foco 3).
export const TRAVA_VENCIDA_MS = 90_000;
// Abaixo disto de memória livre, nenhuma leitura é disparada (E3, Foco 4):
// o `claude` enxuto chega a 270 MB de pico.
export const RAM_MIN_BYTES = 1.5 * 1024 ** 3;
// Trava de custo (E2): o /usage passou a chamar o modelo; 24 h sem ler.
export const BLOQUEIO_CUSTO_MS = 24 * 3_600_000;

const VERSAO = 1;
// Teto do uso-oficial.json (o arquivo real tem uns 500 bytes).
const MAX_USO_BYTES = 16 * 1024;
// Uma leitura com menos de 25 s dispensa a próxima (E3); o comando manual
// (forcar) só respeita um piso de 5 s.
const RECENTE_MS = INTERVALO_MS - 5_000;
const PISO_FORCADO_MS = 5_000;
// Depois de uma leitura que estourou o prazo ou o teto de saída, que veio
// num formato inesperado ou que falhou, a próxima espera 15 min (portão Fable
// da v0.3.0, item 1, e revisão da correção): um /usage normal leva uns 6 s,
// e uma falha que se repete rodaria outro `claude` de 270 MB a cada tique. O
// 5h e a semana seguem vindo da statusline nesse meio-tempo. O comando manual
// (forcar) segue com o piso de 5 s.
export const ESPERA_FALHA_MS = 15 * 60_000;
const MOTIVOS_ESPERA = new Set(['tempo', 'saida', 'formato', 'erro']);
// Folga de relógio para o `ate` do bloqueio, a mesma de instante (base.js).
const FOLGA_RELOGIO_MS = 5 * 60_000;
const MAX_ISO = 64;
const JANELA_5H_MS = 5 * 3_600_000;
const JANELA_7D_MS = 7 * 24 * 3_600_000;
const MIN_MS = 60_000;

// Motivos gravados em estado.motivo: o sucesso e as falhas de rodarUso.
const MOTIVOS_RODAR = new Set(['sem-claude', 'tempo', 'saida', 'custo', 'formato', 'erro']);
const MOTIVOS_GRAVADOS = new Set(['ok', ...MOTIVOS_RODAR]);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const naFaixaDoDate = (ms) => numeroFinito(ms) && Math.abs(ms) <= DATA_MAX_MS;
const naoFeito = (motivo) => ({ feito: false, motivo });
const SEM_LEITURA = Object.freeze({ texto: 'Hadouken: sem leitura', nivel: 'sem-leitura', dica: '' });

// Janela gravada (S28): { pct em [0, 100], resetsAtMs finito e positivo, ou
// null }. Qualquer outra forma é "sem leitura" (null), nunca 0. Devolve uma
// cópia só com os dois campos, cada um lido uma vez.
function janelaGravada(j) {
  if (!ehObjeto(j) || !Object.hasOwn(j, 'resetsAtMs')) return null;
  const pct = j.pct;
  const resetsAtMs = j.resetsAtMs;
  if (!numeroFinito(pct) || pct < 0 || pct > 100) return null;
  if (resetsAtMs !== null && !(naFaixaDoDate(resetsAtMs) && resetsAtMs > 0)) return null;
  return { pct, resetsAtMs };
}

// estado: { motivo de lista fechada, em legível por instante }, senão null.
function estadoGravado(e, agoraMs) {
  if (!ehObjeto(e)) return null;
  const motivo = e.motivo;
  const em = instante(e.em, agoraMs);
  if (!MOTIVOS_GRAVADOS.has(motivo) || em === null) return null;
  return { motivo, em: new Date(em).toISOString() };
}

// bloqueado: { motivo 'custo', ate legível }. O `ate` fica no futuro, então
// não passa por instante (que recusa mais de 5 min à frente); o teto é o
// próprio bloqueio mais a folga de relógio, para um arquivo mexido não travar
// a leitura por meses. Vencido continua legível: quem chama decide.
function bloqueioGravado(b, agoraMs) {
  if (!ehObjeto(b) || b.motivo !== 'custo' || typeof b.ate !== 'string' || b.ate.length > MAX_ISO) return null;
  const ate = Date.parse(b.ate);
  if (!naFaixaDoDate(ate) || ate > agoraMs + BLOQUEIO_CUSTO_MS + FOLGA_RELOGIO_MS) return null;
  return { motivo: 'custo', ate: new Date(ate).toISOString() };
}

// uso-oficial.json validado (E4, S28): versão 1, lido com teto de 16 KiB, e
// reconstruído só com campos no schema. Sem `lidoEm` legível as janelas não
// têm data e saem; `estado` e `bloqueado` ficam, cada um validado à parte.
// `modelos` só guarda o fable. Arquivo ausente, ilegível ou de outra versão:
// null. Nunca lança.
export function lerUso(dir, agoraMs) {
  try {
    if (typeof dir !== 'string' || dir === '' || !naFaixaDoDate(agoraMs)) return null;
    const lido = lerJson(path.join(dir, ARQ_USO), MAX_USO_BYTES);
    if (!lido.ok || !ehObjeto(lido.valor) || lido.valor.versao !== VERSAO) return null;
    const v = lido.valor;
    const lidoMs = instante(v.lidoEm, agoraMs);
    const comLeitura = lidoMs !== null;
    const modelos = {};
    const fable = comLeitura && ehObjeto(v.modelos) ? janelaGravada(v.modelos.fable) : null;
    if (fable !== null) modelos.fable = fable;
    return {
      versao: VERSAO,
      lidoEm: comLeitura ? new Date(lidoMs).toISOString() : null,
      sessao: comLeitura ? janelaGravada(v.sessao) : null,
      semana: comLeitura ? janelaGravada(v.semana) : null,
      modelos,
      estado: estadoGravado(v.estado, agoraMs),
      bloqueado: bloqueioGravado(v.bloqueado, agoraMs),
    };
  } catch {
    return null;
  }
}

const msDe = (iso) => (typeof iso === 'string' ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
const bloqueioEmVigor = (uso, agoraMs) => uso !== null && uso.bloqueado !== null && msDe(uso.bloqueado.ate) > agoraMs;

// Passos 2 e 3 de talvezAtualizar: bloqueio em vigor (mesmo com forcar) e
// leitura recente, pela mais nova entre lidoEm e estado.em. Devolve o motivo
// para não ler, ou null.
function barreira(uso, agoraMs, forcado) {
  if (uso === null) return null;
  if (bloqueioEmVigor(uso, agoraMs)) return 'bloqueado';
  const ultimo = Math.max(msDe(uso.lidoEm), msDe(uso.estado?.em));
  const espera = MOTIVOS_ESPERA.has(uso.estado?.motivo) && msDe(uso.estado.em) === ultimo ? ESPERA_FALHA_MS : RECENTE_MS;
  if (numeroFinito(ultimo) && agoraMs - ultimo < (forcado ? PISO_FORCADO_MS : espera)) return 'recente';
  return null;
}

// Tentativa cuja gravação falhou, por pasta (portão Fable da v0.3.0, item
// 6): sem o arquivo novo, a barreira não a vê, e cada janela rodaria outro
// `claude` a cada 30 s. Vale só neste processo, só para o intervalo normal.
const falhasDeGravacao = new Map();

function gravacaoFalhouHaPouco(dir, agoraMs, forcado) {
  const ms = falhasDeGravacao.get(dir);
  return !forcado && numeroFinito(ms) && agoraMs - ms >= 0 && agoraMs - ms < RECENTE_MS;
}

// Padrão de estadoAtivo: alguma sessão com `at` de até 5 min em estado.json
// (E3: a leitura só acontece quando serve).
function temSessaoAtiva(dir, agoraMs) {
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  return lido.ok && sessoesAtivas(validarEstado(lido.valor, agoraMs), agoraMs) > 0;
}

function memoriaLivre(memLivre) {
  try {
    return memLivre();
  } catch {
    return Number.NaN;
  }
}

// Trava mais velha que TRAVA_VENCIDA_MS pelo mtime (de um processo morto)?
// Só arquivo regular: pasta, link ou outra coisa no lugar nunca é apagada.
// Trava que sumiu entre o open e o lstat: vale tentar de novo.
function travaVencida(arquivo, agoraMs) {
  try {
    const info = fs.lstatSync(arquivo);
    // mtime no futuro (relógio que voltou, arquivo forjado) também vence:
    // senão a leitura ficaria parada até o relógio alcançá-lo.
    const idade = agoraMs - info.mtimeMs;
    return info.isFile() && (idade > TRAVA_VENCIDA_MS || idade < -5 * 60_000);
  } catch (e) {
    return e?.code === 'ENOENT';
  }
}

// Uma leitura por vez em todas as janelas (E3, Foco 3): cria a trava com
// 'wx' (O_CREAT|O_EXCL), gravando pid e instante. Existente e vencida: apaga
// e tenta uma vez mais. Devolve o caminho da trava, 'travado' ou 'erro'.
// Resíduo aceito: duas janelas que achem a mesma trava vencida no mesmo
// instante podem, uma vez, fazer duas leituras.
function pegarTrava(dir, agoraMs) {
  const arquivo = path.join(dir, ARQ_TRAVA);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let fd;
    try {
      fd = fs.openSync(arquivo, 'wx');
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, motivo: 'erro' };
      if (tentativa > 0 || !travaVencida(arquivo, agoraMs)) return { ok: false, motivo: 'travado' };
      apagar(arquivo);
      continue;
    }
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, em: agoraMs }));
    } catch {
      /* a existência da trava é o que vale */
    } finally {
      fechar(fd);
    }
    return { ok: true, arquivo };
  }
  return { ok: false, motivo: 'travado' };
}

function homeOuNull() {
  try {
    return os.homedir();
  } catch {
    return null;
  }
}

// Resultado de `rodar` reduzido ao contrato: ok com as janelas que passam no
// schema (nenhuma válida é 'formato'), ou um motivo da lista fechada (fora
// dela, 'erro'). Nada da resposta entra no arquivo sem passar por aqui.
function normalizar(r) {
  if (!ehObjeto(r)) return { ok: false, motivo: 'erro' };
  if (r.ok === true) {
    const u = ehObjeto(r.uso) ? r.uso : {};
    const sessao = janelaGravada(u.sessao);
    const semana = janelaGravada(u.semana);
    const fable = ehObjeto(u.modelos) ? janelaGravada(u.modelos.fable) : null;
    if (sessao === null && semana === null && fable === null) return { ok: false, motivo: 'formato' };
    return { ok: true, sessao, semana, fable };
  }
  return { ok: false, motivo: MOTIVOS_RODAR.has(r.motivo) ? r.motivo : 'erro' };
}

// Grava o resultado (E4): sucesso troca as janelas, lidoEm e estado; falha
// preserva as últimas janelas boas e atualiza só o estado; custo grava o
// bloqueio de 24 h. Relido aqui, com a trava na mão, para não perder o que
// outra janela gravou.
function gravarResultado(dir, agoraMs, res) {
  const em = new Date(agoraMs).toISOString();
  let novo;
  if (res.ok) {
    novo = {
      versao: VERSAO,
      lidoEm: em,
      sessao: res.sessao,
      semana: res.semana,
      modelos: res.fable === null ? {} : { fable: res.fable },
      estado: { motivo: 'ok', em },
      bloqueado: null,
    };
  } else {
    const anterior = lerUso(dir, agoraMs);
    novo = {
      versao: VERSAO,
      lidoEm: anterior?.lidoEm ?? null,
      sessao: anterior?.sessao ?? null,
      semana: anterior?.semana ?? null,
      modelos: anterior?.modelos ?? {},
      estado: { motivo: res.motivo, em },
      bloqueado: res.motivo === 'custo' ? { motivo: 'custo', ate: new Date(agoraMs + BLOQUEIO_CUSTO_MS).toISOString() } : null,
    };
  }
  return gravarJsonAtomico(path.join(dir, ARQ_USO), novo).ok === true;
}

// Pede uma leitura oficial, se couber (E3). A ordem:
// 0. HADOUKEN_SEM_PAINEL=1 no ambiente: 'desligado';
// 1. sem pasta de dados: 'sem-pasta';
// 2. bloqueio por custo em vigor: 'bloqueado', mesmo com forcar;
// 3. leitura (ou tentativa) de menos de 25 s, ou de menos de 15 min depois
//    de 'tempo' ou 'saida', ou gravação que falhou há menos de 25 s neste
//    processo: 'recente' (com forcar, só o piso de 5 s);
// 4. sem forcar e sem sessão ativa: 'sem-sessao';
// 5. memória livre abaixo de RAM_MIN_BYTES (ou ilegível): 'pouca-ram',
//    mesmo com forcar (Foco 4);
// 6. trava de outra janela viva: 'travado'. Com a trava na mão, 2 e 3 são
//    conferidos de novo: outra janela pode ter acabado de ler;
// 7. roda o `claude` enxuto na pasta vazia uso-cwd;
// 8. grava, com o instante do fim da leitura, e devolve { feito: true,
//    motivo: 'ok' ou a falha };
// 9. solta a trava. Qualquer exceção vira { feito: false, motivo: 'erro' }.
// Sem nenhum `await` antes da trava quando forcar: duas chamadas seguidas
// nunca passam as duas por ela.
export async function talvezAtualizar(opcoes) {
  let trava = null;
  try {
    const {
      dir = dirDados(),
      agoraMs = Date.now(),
      forcar = false,
      rodar = rodarUso,
      memLivre = os.freemem,
      achar = acharClaude,
      estadoAtivo,
      env = process.env,
    } = opcoes ?? {};
    // Opt-out (E4): com HADOUKEN_SEM_PAINEL=1 no ambiente do VS Code, a
    // extensão instalada também para de ler (portão Fable, item 3).
    if (env?.HADOUKEN_SEM_PAINEL === '1') return naoFeito('desligado');
    if (typeof dir !== 'string' || dir === '') return naoFeito('sem-pasta');
    if (!naFaixaDoDate(agoraMs)) return naoFeito('erro');
    const forcado = forcar === true;
    if (gravacaoFalhouHaPouco(dir, agoraMs, forcado)) return naoFeito('recente');
    const antes = barreira(lerUso(dir, agoraMs), agoraMs, forcado);
    if (antes !== null) return naoFeito(antes);
    if (!forcado) {
      const ativo = typeof estadoAtivo === 'function' ? await estadoAtivo() : temSessaoAtiva(dir, agoraMs);
      if (ativo !== true) return naoFeito('sem-sessao');
    }
    const livre = memoriaLivre(memLivre);
    if (!numeroFinito(livre) || livre < RAM_MIN_BYTES) return naoFeito('pouca-ram');
    const pega = pegarTrava(dir, agoraMs);
    if (!pega.ok) return naoFeito(pega.motivo);
    trava = pega.arquivo;
    const depois = barreira(lerUso(dir, agoraMs), agoraMs, forcado);
    if (depois !== null) return naoFeito(depois);
    const cwd = path.join(dir, DIR_CWD);
    fs.mkdirSync(cwd, { recursive: true });
    const exe = achar({ home: homeOuNull(), pathEnv: process.env.PATH, plataforma: process.platform });
    const inicio = Date.now();
    let r;
    try {
      r = await rodar({ exe, cwd, env: ambienteUso(env), agoraMs });
    } catch {
      r = null;
    }
    const res = normalizar(r);
    // O instante gravado é o do fim da leitura (portão Fable, item 1): com o
    // do começo, uma leitura de 30 s já nasceria velha e a seguinte sairia no
    // próximo tique. Em segundos inteiros, para uma leitura instantânea gravar
    // o próprio agoraMs.
    const decorrido = Date.now() - inicio;
    const fimMs = agoraMs + (numeroFinito(decorrido) && decorrido > 0 ? Math.floor(decorrido / 1000) * 1000 : 0);
    // Gravação que falha (disco cheio, permissão) não marca a leitura como
    // recente no arquivo; fica marcada na memória deste processo.
    if (!gravarResultado(dir, fimMs, res)) {
      falhasDeGravacao.set(dir, fimMs);
      return { feito: true, motivo: 'erro' };
    }
    falhasDeGravacao.delete(dir);
    return { feito: true, motivo: res.ok ? 'ok' : res.motivo };
  } catch {
    return naoFeito('erro');
  } finally {
    if (trava !== null) apagar(trava);
  }
}

// --- estadoPainel ----------------------------------------------------------------

// Janela da statusline (estado.json) que ainda pode ser mostrada, com o
// instante da leitura: o `at` da própria janela, ou o do topo.
function daStatusline(estado, limites, k, agoraMs) {
  const j = limites?.[k];
  if (!j) return null;
  const propria = estado?.[k]?.at;
  const t = typeof propria === 'string' ? Date.parse(propria) : instante(estado?.at, agoraMs);
  return { pct: j.used_percentage, resetsAtMs: j.resets_at * 1000, t: numeroFinito(t) ? t : Number.NEGATIVE_INFINITY };
}

// Janela do /usage que ainda pode ser mostrada: leitura de até
// LIMITE_VELHO_MS (a mesma régua da statusline) e reinício ainda por vir.
function doUso(j, lidoMs, agoraMs) {
  if (j === null || j === undefined || lidoMs === null || agoraMs - lidoMs > LIMITE_VELHO_MS) return null;
  if (j.resetsAtMs !== null && j.resetsAtMs <= agoraMs) return null;
  return { pct: j.pct, resetsAtMs: j.resetsAtMs, t: lidoMs };
}

// E4: o percentual da fonte mais nova; o reinício da statusline (epoch
// exato) quando ela existe.
function mesclar(barra, uso) {
  if (barra === null) return uso;
  if (uso === null) return barra;
  return { pct: uso.t > barra.t ? uso.pct : barra.pct, resetsAtMs: barra.resetsAtMs };
}

const pctTexto = (j) => (j === null ? '—' : `${Math.floor(j.pct)}%`);

function mesmoDia(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

// "17:20" no mesmo dia; "seg 22:00" em outro (horaLocal e diaHora de util.js).
const quandoReinicia = (ms, agoraMs) => (mesmoDia(ms, agoraMs) ? horaLocal(ms / 1000) : diaHora(ms / 1000));

// Linha de uma janela na dica: só o rótulo fixo, números e a frase de
// previsão (E5), que é feita de números e palavras fixas de frase.js.
function linhaJanela(rotulo, j, janelaMs, agoraMs) {
  if (j === null) return `${rotulo} sem leitura`;
  const partes = [pctTexto(j)];
  if (j.resetsAtMs !== null) {
    partes.push(`reinicia ${quandoReinicia(j.resetsAtMs, agoraMs)}`);
    const frase = fraseEsgota({ usado: j.pct, resetsAtMs: j.resetsAtMs, janelaMs, agoraMs });
    if (typeof frase === 'string') partes.push(frase);
  }
  return `${rotulo} ${partes.join(' · ')}`;
}

function linhaIdade(lidoMs, agoraMs) {
  if (lidoMs === null) return 'Sem leitura oficial ainda';
  const idade = Math.max(0, agoraMs - lidoMs);
  return idade < MIN_MS ? `Leitura oficial: há ${Math.floor(idade / 1000)} s` : `Leitura oficial: há ${Math.floor(idade / MIN_MS)} min`;
}

// Motivos que não são falha: nenhuma linha. 'travado' é outra janela lendo.
const NEUTROS = new Set(['ok', 'recente', 'sem-sessao', 'travado']);
const LINHA_BLOQUEIO = 'Leitura bloqueada por 24 h: o /usage passou a ter custo.';
const LINHA_MOTIVO = Object.freeze({
  __proto__: null,
  'pouca-ram': 'Leitura pausada: pouca RAM livre.',
  bloqueado: LINHA_BLOQUEIO,
  custo: LINHA_BLOQUEIO,
  'sem-claude': 'claude não encontrado em ~/.local/bin nem no PATH.',
  desligado: 'Leitura desligada (HADOUKEN_SEM_PAINEL=1).',
  tempo: 'Última leitura passou de 30 s; a próxima em 15 min.',
  saida: 'Última leitura passou do teto de saída; a próxima em 15 min.',
});
const FALHAS = new Set(['tempo', 'saida', 'formato', 'erro', 'sem-pasta']);

// Linha fixa do estado da leitura (E4): o que a extensão acabou de ver
// (ultimoMotivo), depois o bloqueio em vigor, depois o motivo gravado. O
// 'custo' gravado só vale com o bloqueio em vigor. Motivo desconhecido vira
// "erro": nada de fora entra no texto.
function linhaMotivo(ultimoMotivo, uso, agoraMs) {
  const candidatos = [];
  if (typeof ultimoMotivo === 'string') candidatos.push(ultimoMotivo);
  if (bloqueioEmVigor(uso, agoraMs)) candidatos.push('bloqueado');
  const gravado = uso?.estado?.motivo;
  if (typeof gravado === 'string' && gravado !== 'custo') candidatos.push(gravado);
  const m = candidatos.find((c) => !NEUTROS.has(c));
  if (m === undefined) return null;
  if (LINHA_MOTIVO[m] !== undefined) return LINHA_MOTIVO[m];
  return `Última leitura falhou (${FALHAS.has(m) ? m : 'erro'}).`;
}

// O que o item da barra de status do VS Code mostra (E4):
// - texto: "5h 25% · sem 41% · Fable 57%", com — na janela sem leitura e o
//   piso inteiro de cada percentual; sem janela nenhuma, "Hadouken: sem
//   leitura";
// - nivel: pela pior janela, 'erro' a partir de 90%, 'aviso' a partir de
//   75%, senão 'ok'; sem janela nenhuma, 'sem-leitura';
// - dica: Markdown só com rótulos fixos e números, um parágrafo por linha.
// 5h e semana juntam a statusline e o /usage (mesclar); o Fable vem só do
// /usage. Nunca lança: em erro, sem leitura e dica vazia.
export function estadoPainel(opcoes) {
  try {
    const { dir = dirDados(), agoraMs = Date.now(), ultimoMotivo } = opcoes ?? {};
    if (typeof dir !== 'string' || dir === '' || !naFaixaDoDate(agoraMs)) return { ...SEM_LEITURA };
    const lido = lerJson(path.join(dir, ARQ_ESTADO));
    const estado = lido.ok ? validarEstado(lido.valor, agoraMs) : null;
    const limites = limitesValidos(estado, agoraMs);
    const uso = lerUso(dir, agoraMs);
    const lidoMs = uso?.lidoEm ? Date.parse(uso.lidoEm) : null;
    const sessao = mesclar(daStatusline(estado, limites, 'five_hour', agoraMs), doUso(uso?.sessao, lidoMs, agoraMs));
    const semana = mesclar(daStatusline(estado, limites, 'seven_day', agoraMs), doUso(uso?.semana, lidoMs, agoraMs));
    const fable = doUso(uso?.modelos?.fable, lidoMs, agoraMs);
    const janelas = [sessao, semana, fable].filter((j) => j !== null);
    let texto = 'Hadouken: sem leitura';
    let nivel = 'sem-leitura';
    if (janelas.length > 0) {
      texto = `5h ${pctTexto(sessao)} · sem ${pctTexto(semana)} · Fable ${pctTexto(fable)}`;
      const pior = Math.max(...janelas.map((j) => Math.floor(j.pct)));
      nivel = pior >= 90 ? 'erro' : pior >= 75 ? 'aviso' : 'ok';
    }
    const linhas = [
      linhaJanela('**Sessão (5h):**', sessao, JANELA_5H_MS, agoraMs),
      linhaJanela('**Semana (todos os modelos):**', semana, JANELA_7D_MS, agoraMs),
      linhaJanela('**Semana (Fable):**', fable, JANELA_7D_MS, agoraMs),
      `Sessões ativas: ${sessoesAtivas(estado, agoraMs)}`,
      linhaIdade(lidoMs, agoraMs),
    ];
    const motivo = linhaMotivo(ultimoMotivo, uso, agoraMs);
    if (motivo !== null) linhas.push(motivo);
    linhas.push('Fonte: statusline do Claude Code e claude /usage, sem tokens.');
    return { texto, nivel, dica: linhas.join('\n\n') };
  } catch {
    return { ...SEM_LEITURA };
  }
}

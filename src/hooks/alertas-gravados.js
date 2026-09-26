import { ALERTAS_VAZIO } from '../alerta.js';
import { idValido, instante } from '../base.js';
import { LIMITE_VELHO_MS } from '../estado.js';

// Memória de alertas do hook UserPromptSubmit: <dirDados>/alertas.json, a
// última faixa anunciada de cada janela e as sessões que já ouviram "sem
// leitura". É entrada de avaliarAlertas (alerta.js), que só anuncia mudança
// de faixa. Spec 8.1, S1/S9: o arquivo é lido com teto de 1 MiB e só passa se
// tiver exatamente o formato abaixo; fora dele, a memória é ALERTAS_VAZIO (o
// lado seguro: a faixa atual é anunciada de novo, nunca uma descida falsa).
//
//   { "at": "<ISO>" | null,
//     "five_hour": { "resets_at": <s>, "faixa": "ok|atencao|serializar|fechar" } | null,
//     "seven_day": { "resets_at": <s>, "faixa": "normal|folga|economico|so-leitura" } | null,
//     "sem_leitura": { "<session_id>": true, ... } }
//
// `at` é quando a memória foi conferida pela última vez contra uma leitura
// válida. Decisão D do adendo da Task 7 (nota 2 da re-revisão 2 da Task 5):
// memória com `at` ausente, inválido ou de mais de LIMITE_VELHO_MS é recomeço.
// As faixas guardadas são esquecidas, então a faixa restritiva atual é
// anunciada de novo e nenhuma linha de descida ("5h voltou a") nem de "janela
// nova ... suspensas" sai no primeiro prompt depois do silêncio. Sem esse
// corte, a leitura antiga de uma sessão ociosa, que depois de 1 h sem leitura
// fresca vira o snapshot (estado.js), faria o próximo prompt anunciar uma
// descida que não aconteceu. `sem_leitura` continua valendo (uma linha por
// sessão).
//
// A lista de faixas espelha alerta.js (que as mantém privadas); o teste
// "aceita toda faixa que alerta.js produz" prende as duas juntas.

export const ARQ_ALERTAS = 'alertas.json';
export const ALERTAS_MAX_BYTES = 1_048_576;
// Sessões lembradas em sem_leitura; as mais antigas saem primeiro. Mantém o
// arquivo pequeno para sempre (uma entrada por sessão sem leitura).
export const SEM_LEITURA_MAX = 256;

const FAIXAS = Object.freeze({
  five_hour: new Set(['ok', 'atencao', 'serializar', 'fechar']),
  seven_day: new Set(['normal', 'folga', 'economico', 'so-leitura']),
});
const CHAVES = new Set(['at', 'five_hour', 'seven_day', 'sem_leitura']);
// Faixa em que new Date(ms) é válido.
const DATA_MAX_MS = 8.64e15;
const INVALIDO = Symbol('invalido');

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const proprio = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const vazia = () => ({ anteriores: ALERTAS_VAZIO, atMs: null });

// Janela guardada: ausente/null → null; objeto com exatamente resets_at
// (segundos epoch finitos em (0, 1e11)) e faixa da lista → cópia; o resto →
// INVALIDO.
function janelaGuardada(v, faixas) {
  if (v === undefined || v === null) return null;
  if (!ehObjeto(v)) return INVALIDO;
  const chaves = Object.keys(v);
  if (chaves.length !== 2 || !Object.hasOwn(v, 'resets_at') || !Object.hasOwn(v, 'faixa')) return INVALIDO;
  const r = v.resets_at;
  const faixa = v.faixa;
  if (!numeroFinito(r) || r <= 0 || r >= 1e11) return INVALIDO;
  if (typeof faixa !== 'string' || !faixas.has(faixa)) return INVALIDO;
  return { resets_at: r, faixa };
}

// sem_leitura guardado: ausente/null → {}; objeto em que toda chave própria é
// id de sessão válido (idValido recusa __proto__, constructor e afins) e todo
// valor é true → cópia; o resto → INVALIDO.
function semLeituraGuardada(v) {
  if (v === undefined || v === null) return {};
  if (!ehObjeto(v)) return INVALIDO;
  const copia = {};
  for (const [id, marca] of Object.entries(v)) {
    if (!idValido(id) || marca !== true) return INVALIDO;
    copia[id] = true;
  }
  return copia;
}

// Memória lida do disco (o valor que lerJson devolveu, ou qualquer coisa) →
// { anteriores, atMs }. `anteriores` vai direto para avaliarAlertas: a
// memória validada, a memória com as faixas esquecidas (recomeço) ou
// ALERTAS_VAZIO (fora do formato). `atMs` é o `at` guardado em ms, se válido
// (mesmo que velho), para quem regrava sem leitura nova. Nunca lança.
export function alertasGuardados(valor, agoraMs) {
  try {
    if (!ehObjeto(valor)) return vazia();
    for (const k of Object.keys(valor)) if (!CHAVES.has(k)) return vazia();
    const at = proprio(valor, 'at');
    if (at !== undefined && at !== null && typeof at !== 'string') return vazia();
    const f5 = janelaGuardada(proprio(valor, 'five_hour'), FAIXAS.five_hour);
    const f7 = janelaGuardada(proprio(valor, 'seven_day'), FAIXAS.seven_day);
    const semLeitura = semLeituraGuardada(proprio(valor, 'sem_leitura'));
    if (f5 === INVALIDO || f7 === INVALIDO || semLeitura === INVALIDO) return vazia();
    const atMs = typeof at === 'string' ? instante(at, agoraMs) : null;
    const recente = atMs !== null && agoraMs - atMs <= LIMITE_VELHO_MS;
    return {
      anteriores: { five_hour: recente ? f5 : null, seven_day: recente ? f7 : null, sem_leitura: semLeitura },
      atMs,
    };
  } catch {
    return vazia();
  }
}

// O que gravar em alertas.json depois de avaliarAlertas: só os campos fixos,
// cada janela conferida de novo (fora do formato vira null), sem_leitura só
// com ids válidos e no máximo SEM_LEITURA_MAX (as mais recentes, que
// avaliarAlertas acrescenta no fim) e `at` = atMs em ISO (null se inválido).
// Quem chama passa agora quando houve leitura válida e o atMs lido quando não
// houve: memória que não foi conferida contra leitura nenhuma não fica mais
// nova. Nunca lança.
export function alertasParaGravar(novos, atMs) {
  const at = numeroFinito(atMs) && Math.abs(atMs) <= DATA_MAX_MS ? new Date(atMs).toISOString() : null;
  const resultado = { at, five_hour: null, seven_day: null, sem_leitura: {} };
  try {
    if (!ehObjeto(novos)) return resultado;
    for (const k of ['five_hour', 'seven_day']) {
      const j = janelaGuardada(proprio(novos, k), FAIXAS[k]);
      resultado[k] = j === INVALIDO ? null : j;
    }
    const bruto = proprio(novos, 'sem_leitura');
    if (ehObjeto(bruto)) {
      const ids = Object.keys(bruto).filter((id) => idValido(id) && bruto[id] === true);
      for (const id of ids.slice(-SEM_LEITURA_MAX)) resultado.sem_leitura[id] = true;
    }
    return resultado;
  } catch {
    return { at, five_hour: null, seven_day: null, sem_leitura: {} };
  }
}

import { ALERTAS_VAZIO } from '../alerta.js';
import { DATA_MAX_MS, idValido, instante, numeroFinito } from '../base.js';
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
// Regravação (M2 da revisão da Task 7, decisão do controlador): o prompt só
// regrava alertas.json quando a memória muda ou quando o `at` guardado tem
// AT_RENOVAR_MS (5 min) ou mais (precisaGravar). Assim o `at` fica até 5 min
// atrás da última conferência, e a decisão D passa a valer depois de 55 a
// 60 min de silêncio em vez de 60 exatos: com relógio estável, sempre mais cedo,
// nunca mais tarde, e o pior caso é uma faixa restritiva anunciada de novo.
// Um relógio que volta para trás já podia atrasar a decisão D antes desta
// regra; a folga de até 5 min desloca essa janela sem alargá-la. Folga aceita
// pelo controlador.
//
// Memória do aviso de projeção (spec v0.2.0 §12, avisos ao Claude):
// <dirDados>/projecao.json, por sessão, a faixa de projeção já anunciada em
// cada janela. Fica num arquivo só dela para que alertas.json mantenha o
// formato exato da v0.1.0 (decisão do controlador na rodada de correção da
// Task 7): o hook da v0.1.0, ainda carregado numa sessão aberta antes da
// atualização, lê alertas.json com o formato estrito acima e, achando uma
// chave a mais, zeraria a memória e regravaria o arquivo, e as duas versões
// repetiriam avisos uma à outra; o plugin nunca interfere nas sessões já
// abertas (ordem do Sr. Garioli). A v0.1.0 não conhece projecao.json.
// Mesmas regras de alertas.json: teto de leitura de ALERTAS_MAX_BYTES,
// formato exato ou memória vazia sem erro, gravação atômica só quando muda.
//
//   { "<session_id>": {
//       "five_hour": { "resets_at": <s>, "faixa": "60|30" } | null,
//       "seven_day": { "resets_at": <s>, "faixa": "24h" } | null }, ... }
//
// A memória vazia de uma sessão é a ausência da chave: uma sessão com as duas
// janelas null está fora do formato. Sem `at` nem decisão D: cada faixa de
// projeção dispara uma vez por janela e sessão, a janela guardada já diz a
// que reset pertence, e a previsão nunca anuncia descida. Sem memória nenhuma
// o arquivo não é criado.
//
// As listas de faixas espelham alerta.js (que as mantém privadas); os testes
// "aceita toda faixa que alerta.js produz" e "aceita toda faixa de projeção
// que alerta.js produz" prendem as duas juntas.

export const ARQ_ALERTAS = 'alertas.json';
// Teto de leitura dos dois arquivos de memória, alertas.json e projecao.json.
export const ALERTAS_MAX_BYTES = 1_048_576;
// No máximo SEM_LEITURA_MAX ids em sem_leitura, o que mantém o arquivo pequeno
// para sempre (uma entrada por sessão sem leitura). Acima do teto sai o começo
// da ordem de enumeração do objeto, que é a de inserção (a mais antiga
// primeiro), exceto ids só de dígitos, que o JavaScript enumera antes de todos
// e por isso saem primeiro. Ids reais são UUIDs, então na prática sai a mais
// antiga (M3 da revisão da Task 7).
export const SEM_LEITURA_MAX = 256;
// Idade do `at` guardado a partir da qual a memória é regravada mesmo sem
// mudança, para o `at` andar (precisaGravar).
export const AT_RENOVAR_MS = 5 * 60_000;
export const ARQ_PROJECAO = 'projecao.json';
// No máximo PROJECAO_MAX sessões em projecao.json, pelo mesmo motivo de
// SEM_LEITURA_MAX; avaliarAlertas põe no fim a sessão cuja memória mudou, e o
// corte tira o começo.
export const PROJECAO_MAX = 256;

const FAIXAS = Object.freeze({
  five_hour: new Set(['ok', 'atencao', 'serializar', 'fechar']),
  seven_day: new Set(['normal', 'folga', 'economico', 'so-leitura']),
});
const FAIXAS_PROJECAO = Object.freeze({
  five_hour: new Set(['60', '30']),
  seven_day: new Set(['24h']),
});
const CHAVES = new Set(['at', 'five_hour', 'seven_day', 'sem_leitura']);
const INVALIDO = Symbol('invalido');

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

// O registro guardado, validado e sem esquecer nada: { at, f5, f7, semLeitura }
// com `at` o texto guardado (ausente vira null), ou null se está fora do
// formato. Pode lançar (getter hostil); quem chama captura.
function validado(valor) {
  if (!ehObjeto(valor)) return null;
  for (const k of Object.keys(valor)) if (!CHAVES.has(k)) return null;
  const at = proprio(valor, 'at') ?? null;
  if (at !== null && typeof at !== 'string') return null;
  const f5 = janelaGuardada(proprio(valor, 'five_hour'), FAIXAS.five_hour);
  const f7 = janelaGuardada(proprio(valor, 'seven_day'), FAIXAS.seven_day);
  const semLeitura = semLeituraGuardada(proprio(valor, 'sem_leitura'));
  if (f5 === INVALIDO || f7 === INVALIDO || semLeitura === INVALIDO) return null;
  return { at, f5, f7, semLeitura };
}

// Memória lida do disco (o valor que lerJson devolveu, ou qualquer coisa) →
// { anteriores, atMs }. `anteriores` vai direto para avaliarAlertas: a
// memória validada, a memória com as faixas esquecidas (recomeço) ou
// ALERTAS_VAZIO (fora do formato). `anteriores.projecao` é sempre vazia, como
// em ALERTAS_VAZIO: a memória de projeção vem de projecao.json
// (projecaoGuardada), e o hook a põe no lugar. `atMs` é o `at` guardado em ms,
// se válido (mesmo que velho), para quem regrava sem leitura nova. Nunca lança.
export function alertasGuardados(valor, agoraMs) {
  try {
    const g = validado(valor);
    if (g === null) return vazia();
    const atMs = g.at === null ? null : instante(g.at, agoraMs);
    const recente = atMs !== null && agoraMs - atMs <= LIMITE_VELHO_MS;
    return {
      anteriores: {
        five_hour: recente ? g.f5 : null, seven_day: recente ? g.f7 : null, sem_leitura: g.semLeitura, projecao: {},
      },
      atMs,
    };
  } catch {
    return vazia();
  }
}

// O prompt precisa regravar alertas.json? `registro` é o que
// alertasParaGravar devolveu; `valor`, o que lerJson leu (ou null). Não
// regrava (false) só quando as duas faixas e sem_leitura (com a ordem) são
// iguais às guardadas e o `at` não precisa andar: é o mesmo texto guardado (sem
// leitura válida o `at` não anda, decisão D) ou o guardado é um instante
// válido de menos de AT_RENOVAR_MS atrás, nunca no futuro. Guardado ausente,
// fora do formato ou ilegível, `at` guardado velho, no futuro ou inválido, ou
// qualquer erro: regrava (true). Nunca lança.
export function precisaGravar(registro, valor, agoraMs) {
  try {
    if (!ehObjeto(registro)) return true;
    const g = validado(valor);
    if (g === null) return true;
    const novo = JSON.stringify([registro.five_hour, registro.seven_day, registro.sem_leitura]);
    if (novo !== JSON.stringify([g.f5, g.f7, g.semLeitura])) return true;
    if (registro.at === g.at) return false;
    const atMs = g.at === null ? null : instante(g.at, agoraMs);
    const idade = atMs === null ? Number.NaN : agoraMs - atMs;
    return !(idade >= 0 && idade < AT_RENOVAR_MS);
  } catch {
    return true;
  }
}

// O que gravar em alertas.json depois de avaliarAlertas: só os campos fixos,
// cada janela conferida de novo (fora do formato vira null), sem_leitura só
// com ids válidos e no máximo SEM_LEITURA_MAX (o fim da ordem de enumeração,
// onde avaliarAlertas acrescenta; ver SEM_LEITURA_MAX) e `at` = atMs em ISO
// (null se inválido). `novos.projecao` não entra: vai para projecao.json
// (projecaoParaGravar).
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

// Memória de projeção de uma sessão: objeto com exatamente five_hour e
// seven_day, cada um janela guardada com faixa de projeção ou null, e ao
// menos um não null → cópia; o resto → INVALIDO.
function projecaoDaSessao(v) {
  if (!ehObjeto(v)) return INVALIDO;
  const chaves = Object.keys(v);
  if (chaves.length !== 2 || !Object.hasOwn(v, 'five_hour') || !Object.hasOwn(v, 'seven_day')) return INVALIDO;
  const f5 = janelaGuardada(v.five_hour, FAIXAS_PROJECAO.five_hour);
  const f7 = janelaGuardada(v.seven_day, FAIXAS_PROJECAO.seven_day);
  if (f5 === INVALIDO || f7 === INVALIDO || (f5 === null && f7 === null)) return INVALIDO;
  return { five_hour: f5, seven_day: f7 };
}

// projecao.json validado: ausente/null → {}; objeto em que toda chave própria
// é id de sessão válido e todo valor passa em projecaoDaSessao → cópia; o
// resto → INVALIDO. Pode lançar (getter hostil); quem chama captura.
function projecaoValidada(v) {
  if (v === undefined || v === null) return {};
  if (!ehObjeto(v)) return INVALIDO;
  const copia = {};
  for (const [id, sessao] of Object.entries(v)) {
    if (!idValido(id)) return INVALIDO;
    const p = projecaoDaSessao(sessao);
    if (p === INVALIDO) return INVALIDO;
    copia[id] = p;
  }
  return copia;
}

// Memória de projeção lida do disco (o valor que lerJson devolveu, null quando
// o arquivo falta ou não se lê, ou qualquer coisa) → o mapa validado, que o
// hook põe em anteriores.projecao de avaliarAlertas. Fora do formato → {} (a
// memória inteira: o lado seguro é a faixa de projeção atual anunciada de
// novo). Nunca lança.
export function projecaoGuardada(valor) {
  try {
    const g = projecaoValidada(valor);
    return g === INVALIDO ? {} : g;
  } catch {
    return {};
  }
}

// O que gravar em projecao.json depois de avaliarAlertas (novos.projecao): só
// as sessões com id válido e memória no formato, no máximo PROJECAO_MAX (o fim
// da ordem de enumeração, onde avaliarAlertas põe a sessão que mudou; ver
// SEM_LEITURA_MAX). Nunca lança; erro → {}.
export function projecaoParaGravar(projecao) {
  try {
    const resultado = {};
    if (!ehObjeto(projecao)) return resultado;
    const sessoes = [];
    for (const [id, sessao] of Object.entries(projecao)) {
      const p = idValido(id) ? projecaoDaSessao(sessao) : INVALIDO;
      if (p !== INVALIDO) sessoes.push([id, p]);
    }
    for (const [id, p] of sessoes.slice(-PROJECAO_MAX)) resultado[id] = p;
    return resultado;
  } catch {
    return {};
  }
}

// O prompt precisa regravar projecao.json? `registro` é o que
// projecaoParaGravar devolveu; `valor`, o que lerJson leu, ou null quando o
// arquivo falta ou não se lê. Arquivo ausente ou ilegível conta como memória
// vazia, então registro vazio não grava: o prompt sem projeção nunca cria o
// arquivo. Guardado fora do formato regrava (o arquivo sai limpo); no
// formato, regrava só quando difere do registro (com a ordem). Qualquer erro:
// regrava (true). Nunca lança.
export function precisaGravarProjecao(registro, valor) {
  try {
    if (!ehObjeto(registro)) return true;
    const g = projecaoValidada(valor);
    if (g === INVALIDO) return true;
    return JSON.stringify(registro) !== JSON.stringify(g);
  } catch {
    return true;
  }
}

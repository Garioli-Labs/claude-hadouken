import fs from 'node:fs';
import path from 'node:path';
import { numeroFinito } from './base.js';
import { lerJson, gravarJsonAtomico } from './estado.js';

// Janela de trabalho (spec v0.6.0 §4, Fatia 2): a chave `janela` do
// config.json do hadouken, `{ "dias": ["seg", ...], "inicio": "09:00", "fim":
// "21:00" }`. O % esperado do limite de 7 dias e as projeções de 7 dias contam
// só os minutos de dentro dela (ritmo.js, uso/frase.js, previsao.js). Sem a
// chave, ou com ela inválida, `janela` é null e o cálculo é o de 168 horas.
// Puro, fora a leitura do arquivo; hora local da máquina. Nunca lança.

// Domingo é 0, como Date#getDay.
export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const AVISO_JANELA = 'janela inválida; usando 168 h';

// Mesmo nome e teto de guarda/config.js; repetidos aqui para os hooks que só
// precisam da janela não carregarem a guarda (e o aperto) junto.
const ARQ_CONFIG = 'config.json';
const CONFIG_MAX_BYTES = 64 * 1024;
const MINUTO_MS = 60_000;
// Teto de dias que avancarUteis percorre: com ao menos um dia por semana na
// janela, 400 dias cobrem qualquer pedido que ainda caiba antes de um reset.
const DIAS_MAX = 400;
// Teto de dias que minutosUteis soma (10 anos): as chamadas reais medem 7 dias.
const DIAS_MAX_SOMA = 3660;

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INVALIDA = Object.freeze({ janela: null, aviso: AVISO_JANELA });
const SEM_JANELA = Object.freeze({ janela: null, aviso: null });

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// "09:00" → 540; qualquer outra forma → null.
function minutoDoDia(texto) {
  const m = typeof texto === 'string' ? HORA.exec(texto) : null;
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
}

// Nome do dia → número (0 = dom). Aceita `sáb` e maiúsculas.
function numeroDoDia(nome) {
  if (typeof nome !== 'string') return null;
  const n = nome.trim().toLowerCase().replace('á', 'a');
  const i = DIAS.indexOf(n);
  return i === -1 ? null : i;
}

// Janela = { dias: number[] (0 = dom, crescente, sem repetição), inicioMin,
// fimMin } (minutos desde 00:00 local). `undefined` é "sem janela" (sem aviso);
// qualquer valor presente que não seja uma janela inteira (dias vazio ou com
// nome desconhecido, hora fora de HH:MM, inicio >= fim, J5: a janela que cruza
// a meia-noite) dá o aviso e nenhuma janela. Nunca lança.
export function validarJanela(valor) {
  try {
    if (valor === undefined) return SEM_JANELA;
    if (!ehObjeto(valor) || !Array.isArray(valor.dias) || valor.dias.length === 0) return INVALIDA;
    const dias = new Set();
    for (const nome of valor.dias) {
      const n = numeroDoDia(nome);
      if (n === null) return INVALIDA;
      dias.add(n);
    }
    const inicioMin = minutoDoDia(valor.inicio);
    const fimMin = minutoDoDia(valor.fim);
    if (inicioMin === null || fimMin === null || inicioMin >= fimMin) return INVALIDA;
    return { janela: { dias: [...dias].sort((a, b) => a - b), inicioMin, fimMin }, aviso: null };
  } catch {
    return INVALIDA;
  }
}

// A janela da chave `janela` de <dir>/config.json. `dir` que não é texto,
// arquivo ausente, ilegível ou sem a chave: sem janela e sem aviso (o config
// quebrado já é avisado pela guarda, e aqui a conta cai nas 168 h). Chave
// presente e inválida: o aviso. Nunca lança.
export function lerJanela(dir) {
  try {
    if (typeof dir !== 'string' || dir === '') return SEM_JANELA;
    const lido = lerJson(path.join(dir, ARQ_CONFIG), CONFIG_MAX_BYTES);
    if (!lido.ok || !ehObjeto(lido.valor)) return SEM_JANELA;
    return validarJanela(Object.hasOwn(lido.valor, 'janela') ? lido.valor.janela : undefined);
  } catch {
    return SEM_JANELA;
  }
}

// Janela inteira do dia local `d` (Date de meia-noite local) como [início,
// fim] em ms absolutos, ou null se o dia não está na janela. Em ms absolutos
// porque o dia de troca de horário tem 23 ou 25 h (J4): construir o intervalo
// pela hora local do dia e subtrair em ms trata isso sem caso especial.
function intervaloDoDia(janela, ano, mes, dia) {
  const dow = new Date(ano, mes, dia).getDay();
  if (!janela.dias.includes(dow)) return null;
  const ini = new Date(ano, mes, dia, Math.floor(janela.inicioMin / 60), janela.inicioMin % 60).getTime();
  const fim = new Date(ano, mes, dia, Math.floor(janela.fimMin / 60), janela.fimMin % 60).getTime();
  return [ini, fim];
}

// Minutos de [t1Ms, t2Ms] dentro da janela, dia a dia em hora local (J4: a
// troca de horário de verão sai sozinha, porque cada dia é uma interseção em
// ms absolutos). Sem janela: os minutos corridos. Intervalo vazio ou
// invertido: 0. Entrada que não é número finito: 0. Nunca lança.
export function minutosUteis(janela, t1Ms, t2Ms) {
  try {
    if (!numeroFinito(t1Ms) || !numeroFinito(t2Ms) || t2Ms <= t1Ms) return 0;
    if (janela === null || janela === undefined) return (t2Ms - t1Ms) / MINUTO_MS;
    const primeiro = new Date(t1Ms);
    let total = 0;
    for (let k = 0; k < DIAS_MAX_SOMA; k++) {
      const dia = new Date(primeiro.getFullYear(), primeiro.getMonth(), primeiro.getDate() + k);
      const iv = intervaloDoDia(janela, dia.getFullYear(), dia.getMonth(), dia.getDate());
      if (iv !== null) {
        const ini = Math.max(iv[0], t1Ms);
        const fim = Math.min(iv[1], t2Ms);
        if (fim > ini) total += (fim - ini) / MINUTO_MS;
      }
      if (new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1).getTime() > t2Ms) break;
    }
    return total;
  } catch {
    return 0;
  }
}

// O instante de relógio (ms) depois de `minutos` úteis a partir de t0Ms: o
// tempo avança só dentro da janela, e o que cai fora dela (a noite, o fim de
// semana, J1: um t0 fora da janela) pula para o próximo início. Sem janela:
// t0Ms + minutos. `minutos` ≤ 0 devolve t0Ms. Entrada que não é número finito,
// ou pedido que não cabe em DIAS_MAX dias: NaN / Infinity (quem chama já
// trata o que não é finito). Nunca lança.
export function avancarUteis(janela, t0Ms, minutos) {
  try {
    if (!numeroFinito(t0Ms) || !numeroFinito(minutos)) return Number.NaN;
    if (minutos <= 0) return t0Ms;
    if (janela === null || janela === undefined) return t0Ms + minutos * MINUTO_MS;
    let faltaMs = minutos * MINUTO_MS;
    const primeiro = new Date(t0Ms);
    for (let k = 0; k < DIAS_MAX; k++) {
      const dia = new Date(primeiro.getFullYear(), primeiro.getMonth(), primeiro.getDate() + k);
      const iv = intervaloDoDia(janela, dia.getFullYear(), dia.getMonth(), dia.getDate());
      if (iv === null) continue;
      const ini = Math.max(iv[0], t0Ms);
      const cabe = iv[1] - ini;
      if (cabe <= 0) continue;
      if (faltaMs <= cabe) return ini + faltaMs;
      faltaMs -= cabe;
    }
    return Number.POSITIVE_INFINITY;
  } catch {
    return Number.NaN;
  }
}

// --- Comando /hadouken:janela (spec v0.6.0 §4, Tarefa 4) ---

const ERRO_ARGS = 'janela inválida. Uso: /hadouken:janela [seg-sex 9-21 | seg,qua,sex 08:30-18:00 | off]';
const ERRO = Object.freeze({ acao: 'erro', msg: ERRO_ARGS });
const ARGS_MAX = 128;
const HORA_ARG = /^(\d{1,2})(?::(\d{2}))?$/;
const par = (n) => String(n).padStart(2, '0');

// "9", "09", "9:30" → "09:00", "09:30"; qualquer outra forma → null. O
// intervalo (0–23 h, 0–59 min) é conferido depois, por validarJanela.
function normalizarHora(texto) {
  const m = HORA_ARG.exec(texto);
  return m === null ? null : `${par(Number(m[1]))}:${m[2] ?? '00'}`;
}

// "seg-sex", "seg,qua,sex" ou uma mistura ("seg-qua,sex") → números dos dias em
// ordem de DIAS, sem repetição; null se algum item é desconhecido ou se um
// intervalo a-b tem a depois de b na ordem de DIAS (sex-seg não dá a volta).
function lerDiasArg(texto) {
  const dias = new Set();
  for (const item of texto.split(',')) {
    const [de, ate, resto] = item.split('-');
    const a = numeroDoDia(de);
    const b = ate === undefined ? a : numeroDoDia(ate);
    if (resto !== undefined || a === null || b === null || a > b) return null;
    for (let d = a; d <= b; d++) dias.add(d);
  }
  return [...dias].sort((x, y) => x - y).map((d) => DIAS[d]);
}

// O texto digitado depois de /hadouken:janela. Vazio → mostrar; `off` →
// remover; `<dias> <início>-<fim>` → gravar o valor já normalizado (dias por
// nome, HH:MM) e conferido por validarJanela; o resto → erro com o uso. O
// texto digitado nunca volta na mensagem. Nunca lança.
export function lerArgsJanela(texto) {
  try {
    if (texto === undefined || texto === null || texto === '') return { acao: 'mostrar' };
    if (typeof texto !== 'string' || texto.length > ARGS_MAX) return ERRO;
    const t = texto.trim().toLowerCase();
    if (t === '') return { acao: 'mostrar' };
    if (t === 'off') return { acao: 'remover' };
    const partes = t.split(/\s+/);
    if (partes.length !== 2) return ERRO;
    const dias = lerDiasArg(partes[0]);
    const horas = partes[1].split('-');
    if (dias === null || horas.length !== 2) return ERRO;
    const valor = { dias, inicio: normalizarHora(horas[0]), fim: normalizarHora(horas[1]) };
    return validarJanela(valor).janela === null ? ERRO : { acao: 'gravar', valor };
  } catch {
    return ERRO;
  }
}

// Janela validada (validarJanela: dias numéricos, inicioMin, fimMin) → texto:
// 'seg–sex 09:00–21:00'. Três ou mais dias seguidos viram `a–b`; o resto, a
// lista separada por vírgula. Nunca lança (entrada que não é janela: '').
export function descreverJanela(janela) {
  try {
    const partes = [];
    for (let i = 0; i < janela.dias.length;) {
      let j = i;
      while (j + 1 < janela.dias.length && janela.dias[j + 1] === janela.dias[j] + 1) j++;
      if (j - i >= 2) partes.push(`${DIAS[janela.dias[i]]}–${DIAS[janela.dias[j]]}`);
      else for (let k = i; k <= j; k++) partes.push(DIAS[janela.dias[k]]);
      i = j + 1;
    }
    const hora = (min) => `${par(Math.floor(min / 60))}:${par(min % 60)}`;
    return `${partes.join(',')} ${hora(janela.inicioMin)}–${hora(janela.fimMin)}`;
  } catch {
    return '';
  }
}

// Troca só a chave `janela` do config.json de <dir>, preservando as outras
// (guarda, agentes), por gravarJsonAtomico. `valor` null remove a chave (sem
// config.json, não há nada a remover e nada é criado). Arquivo presente mas
// ilegível, ou que não é objeto: não grava ({ ok: false }), para não apagar o
// que o usuário escreveu. `valor` que validarJanela recusa: { ok: false }.
// Nunca lança.
export function gravarJanela(dir, valor) {
  try {
    if (typeof dir !== 'string' || dir === '') return { ok: false, motivo: 'dir' };
    if (valor !== null && validarJanela(valor).janela === null) return { ok: false, motivo: 'valor' };
    const arquivo = path.join(dir, ARQ_CONFIG);
    const lido = lerJson(arquivo, CONFIG_MAX_BYTES);
    let config = {};
    if (lido.ok) config = lido.valor;
    else if (lido.motivo !== 'ausente' || fs.existsSync(arquivo)) return { ok: false, motivo: 'ilegivel' };
    if (!ehObjeto(config)) return { ok: false, motivo: 'formato' };
    if (valor === null) {
      if (!Object.hasOwn(config, 'janela')) return { ok: true };
      const { janela: _removida, ...resto } = config;
      return gravarJsonAtomico(arquivo, resto);
    }
    return gravarJsonAtomico(arquivo, { ...config, janela: valor });
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

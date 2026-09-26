import { numeroFinito } from './base.js';

// numeroFinito mora em base.js e sai também daqui: formato.js, alerta.js e
// hooks/linha-estado.js já importam este arquivo, e cada import novo custa
// uma resolução a mais (stat e realpath) em todo processo da barra e dos
// hooks, mesmo com o módulo já carregado.
export { numeroFinito };

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SEM_VALOR = '—';
const doisDigitos = (n) => String(n).padStart(2, '0');

export function normalizarEffort(e) {
  if (typeof e === 'string' && e.length > 0) return e;
  if (e && typeof e === 'object' && typeof e.level === 'string') return e.level;
  return null;
}

// Duas leituras de limite são da mesma janela se os resets_at diferem no máximo
// isto (o servidor devolve o reset com alguns segundos de variação). Uma só
// constante para alerta.js (transição de faixa) e estado.js (mescla por janela).
export const TOLERANCIA_JANELA_S = 600;

// Janela de limite da conta (spec 6.2): percentual finito em 0–100 e reset
// em segundos epoch finito, positivo e abaixo de 1e11. Devolve uma cópia só
// com os dois campos, ou null. O schema único de estado.js (gravação e
// leitura), da barra (formato.js) e da linha do SessionStart
// (hooks/linha-estado.js). Cada campo é lido uma vez só: um getter não troca
// o valor entre a checagem e o uso (a cópia da barra devolvia o próprio
// objeto e o relia). Só lança se um getter lançar (quem chama trata).
export function janelaValida(j) {
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return null;
  const usado = j.used_percentage;
  const reset = j.resets_at;
  if (!numeroFinito(usado) || usado < 0 || usado > 100) return null;
  if (!numeroFinito(reset) || reset <= 0 || reset >= 1e11) return null;
  return { used_percentage: usado, resets_at: reset };
}

// Lista única dos níveis de effort aceitos (spec 8.1, S2): o estado.json e a
// barra consultam a mesma lista, então nunca divergem sobre o que é válido.
export const EFFORTS_VALIDOS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const EFFORTS = new Set(EFFORTS_VALIDOS);

// O nível de effort se for um dos cinco, em string ou em { level }; senão null.
// Nunca lança, nem com um getter hostil.
export function effortValido(e) {
  try {
    const nivel = normalizarEffort(e);
    return EFFORTS.has(nivel) ? nivel : null;
  } catch {
    return null;
  }
}

const STDIN_MAX_BYTES = 1_048_576;
// Fica no stdin depois da leitura: um erro tardio (pipe quebrado depois do
// 'end' ou do prazo) sem ouvinte viraria exceção e mataria o processo, que
// precisa sair com código 0. Uma única instância, então nunca se acumula.
const ignorarErroTardio = () => {};

// Lê todo o stdin como UTF-8. Nunca bloqueia: com TTY devolve '' na hora; se o
// 'end' não chegar em prazoMs, devolve o que já leu e solta o stdin. Acima de
// maxBytes (1 MiB por padrão; spec 8.1, S9) para de acumular na hora e devolve
// '', que quem chama trata como entrada inválida. Nunca rejeita.
export function lerStdin(prazoMs = 1000, maxBytes = STDIN_MAX_BYTES) {
  return new Promise((resolve) => {
    const entrada = process.stdin;
    if (entrada.isTTY) {
      resolve('');
      return;
    }
    const teto = Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : STDIN_MAX_BYTES;
    const partes = [];
    let total = 0;
    let terminado = false;
    const terminar = (excedeu = false) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(prazo);
      entrada.off('data', aoLer);
      entrada.off('end', aoTerminar);
      entrada.off('error', aoTerminar);
      entrada.off('error', ignorarErroTardio);
      entrada.on('error', ignorarErroTardio);
      entrada.pause();
      let texto = '';
      if (excedeu) {
        // Parado de dentro do 'data', o pipe volta a ler um tick depois do
        // pause (o stream repõe o buffer) e segura o processo aberto enquanto
        // o outro lado escrever: acima do teto o stdin é fechado de vez.
        try { entrada.destroy(); } catch { /* já fechado */ }
      } else {
        try { texto = Buffer.concat(partes, total).toString('utf8'); } catch { texto = ''; }
      }
      partes.length = 0;
      resolve(texto);
    };
    const aoTerminar = () => terminar(false);
    // Bytes, não caracteres: o teto vale para o que chega pelo pipe.
    const aoLer = (c) => {
      const pedaco = typeof c === 'string' ? Buffer.from(c, 'utf8') : c;
      total += pedaco.length;
      if (total > teto) {
        terminar(true);
        return;
      }
      partes.push(pedaco);
    };
    const prazo = setTimeout(aoTerminar, prazoMs);
    entrada.on('data', aoLer);
    entrada.on('end', aoTerminar);
    entrada.on('error', aoTerminar);
  });
}

export function horaLocal(epochS) {
  if (!numeroFinito(epochS)) return SEM_VALOR;
  const d = new Date(epochS * 1000);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

export function diaHora(epochS) {
  if (!numeroFinito(epochS)) return SEM_VALOR;
  const d = new Date(epochS * 1000);
  return `${DIAS[d.getDay()]} ${horaLocal(epochS)}`;
}

export function formatarTokens(n) {
  if (!numeroFinito(n)) return SEM_VALOR;
  // A partir de 999 500 o arredondamento em k daria "1000k": vira M.
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// Glifos que a própria barra usa (separador, reset, effort; formato.js). Um
// nome com eles forjaria segmentos ("Opus │ 5h 3% ↻09:00") ou um effort, e
// o · da chave modelo·effort do relatório é só o que ele põe: a barra, o
// histórico e o relatório os tiram antes de exibir ou gravar. Regex global
// e compartilhada: só com replace, que começa do zero e deixa o lastIndex
// em 0 (test e exec andariam com ele de uma chamada para outra).
export const GLIFOS_BARRA = /[│↻·]/gu;

// Compila `fonte` com `flags` ou, se o Node recusar a expressão, devolve
// `reserva`, uma regex já compilada. Um Node compilado sem ICU (tabela de
// https://nodejs.org/api/intl.html, coluna none) recusa todo escape de
// propriedade \p{...}: numa regex literal isso é erro antecipado e o módulo
// inteiro deixaria de carregar (a barra e os hooks sairiam com código 1).
// Por isso toda expressão com \p do plugin passa por aqui, com a fonte num
// String.raw e uma reserva literal sem \p, sempre mais restrita que a
// principal, nunca mais frouxa. Roda uma vez por expressão, na carga do
// módulo (a de jsonSeguro, no primeiro uso). Nunca lança.
export function regexOu(fonte, flags, reserva) {
  try {
    return new RegExp(fonte, flags);
  } catch {
    return reserva;
  }
}

// Sequências de escape de terminal (ECMA-48), nas formas de 7 e de 8 bits, em
// ordem de tentativa: CSI com parâmetros e byte final; cadeias OSC, DCS, SOS,
// PM e APC até BEL ou ST; e, por fim, qualquer outro ESC mais um caractere
// (pega também CSI/OSC sem terminador). As classes negadas mantêm a busca
// linear mesmo em texto hostil com milhares de ESC.
const ESCAPES = new RegExp([
  '\\x1b\\[[0-?]*[ -/]*[@-~]',
  '\\u009b[0-?]*[ -/]*[@-~]',
  '\\x1b[\\]PX^_][^\\x07\\x1b\\u009c]*(?:\\x07|\\x1b\\\\|\\u009c)',
  '[\\u0090\\u0098\\u009d\\u009e\\u009f][^\\x07\\x1b\\u009c]*(?:\\x07|\\x1b\\\\|\\u009c)',
  '\\x1b[\\s\\S]?',
].join('|'), 'gu');

// O que sobra depois das sequências: toda a categoria C do Unicode (\p{C} =
// controles Cc, inclusive quebras de linha e tab; formato Cf, que traz os
// controles bidi, largura zero, ZWJ, soft hyphen, BOM e os caracteres de tag
// U+E0000–U+E007F capazes de esconder uma frase inteira; surrogates soltos Cs;
// uso privado Co; não atribuídos Cn), os separadores de linha e de parágrafo
// (Zl, Zp) e os caracteres | e crase (\x60 na fonte: num String.raw a crase
// escapada guardaria a barra, escape inválido com a flag u). Trade-offs, só
// de exibição: sequências de emoji unidas por ZWJ viram seus componentes, e
// um caractere atribuído depois da versão do Unicode do Node em uso conta
// como Cn e sai.
//
// Sem ICU (regexOu), a reserva é uma lista do que fica: espaço e ASCII
// visível (U+0020–U+007E) menos | e crase, e o latim de U+00A0 a U+024F
// menos o soft hyphen (U+00AD, Cf). Todo o resto sai: nomes em outros
// alfabetos (grego, cirílico, CJK), emoji e marcas combinantes somem da
// barra, mas nada invisível passa.
const INVISIVEIS_FONTE = String.raw`[\p{C}\p{Zl}\p{Zp}|\x60]`;
const INVISIVEIS_RESERVA = /[^\u{20}-\u{7E}\u{A0}-\u{AC}\u{AE}-\u{24F}]|[|`]/gu;
const INVISIVEIS = regexOu(INVISIVEIS_FONTE, 'gu', INVISIVEIS_RESERVA);
// Uma enxurrada de marcas combinantes (\p{M}) empilha num glifo só e vaza
// para as linhas vizinhas em alguns terminais. Duas seguidas bastam para o
// texto real (vietnamita, NFD, keycap de emoji); o resto sai. Roda depois de
// INVISIVEIS, então marcas separadas por invisíveis também contam juntas.
// Sem ICU, a reserva de INVISIVEIS já tirou toda marca combinante (nenhuma
// fica entre U+00A0 e U+024F): esta reserva nunca casa ((?!) falha em toda
// posição), e o grupo vazio mantém o '$1' do replace com o mesmo sentido.
const MARCAS_FONTE = String.raw`(\p{M}{2})\p{M}+`;
const MARCAS_RESERVA = /(?!)()/gu;
const MARCAS_EXCESSO = regexOu(MARCAS_FONTE, 'gu', MARCAS_RESERVA);
const SANEAR_MAX_PADRAO = 64;
// Teto da entrada (unidades UTF-16) antes das expressões. O resultado é no
// máximo `max` pontos de código do começo, e um corte no meio de uma sequência
// só deixa texto comum, porque a segunda passada remove o controle que sobrar.
const SANEAR_MAX_ENTRADA = 1_048_576;

// Texto externo pronto para exibir numa linha (spec 8.1, S2/S3): sem
// sequências de terminal, sem controles nem caracteres invisíveis, sem | nem
// crase, aparado e cortado em `max` pontos de código sem partir par surrogate.
// Não-string, `max` inválido (usa 64), resultado vazio (vira null) e qualquer
// falha interna (vira null) nunca lançam.
export function sanear(valor, max = SANEAR_MAX_PADRAO) {
  if (typeof valor !== 'string') return null;
  try {
    const limite = Number.isInteger(max) && max > 0 ? max : SANEAR_MAX_PADRAO;
    const bruto = valor.length > SANEAR_MAX_ENTRADA ? valor.slice(0, SANEAR_MAX_ENTRADA) : valor;
    const limpo = bruto.replace(ESCAPES, '').replace(INVISIVEIS, '').replace(MARCAS_EXCESSO, '$1').trim();
    // 2 unidades por ponto de código bastam para `limite` pontos inteiros e
    // poupam o Array.from de percorrer um texto enorme.
    const cortado = Array.from(limpo.slice(0, limite * 2)).slice(0, limite).join('').trimEnd();
    return cortado.length > 0 ? cortado : null;
  } catch {
    return null;
  }
}

// Escapa no JSON o que um terminal ou o modelo leriam como controle: DEL e
// C1, formato (bidi, largura zero, tags), uso privado, não atribuídos,
// surrogates soltos e separadores de linha e de parágrafo. O JSON.stringify
// já escapa C0 e os surrogates soltos; estes ficam em \uXXXX (acima de FFFF,
// o par de surrogates: a flag u casa um ponto de código inteiro, então um
// emoji chega ao replacer como par e sai como dois \u). Uma regra só para o
// /consumo --json (comandos.js) e para o instalar (instalar-cli.js): das
// duas cópias de antes, fica a mais restrita, a do instalar, que também
// escapava Cs (redundante depois do JSON.stringify, e nunca mais frouxa).
// Os nomes já chegam saneados; isto é a última barreira. Pode lançar só se
// o valor não for serializável (o chamador trata).
//
// Sem ICU (regexOu), a reserva escapa tudo o que não for quebra de linha,
// ASCII visível ou o latim de U+00A0 a U+024F (menos o soft hyphen,
// U+00AD): nomes em outros alfabetos e emoji saem em \u. Fora das strings o
// JSON é só ASCII e a quebra de linha da indentação, que a reserva deixa
// como estão; dentro delas o escape \u mantém o JSON válido e o valor igual.
//
// Compilada no primeiro uso, não na carga: a barra e os hooks carregam este
// arquivo e nunca escrevem JSON, e montar a classe com \p{Cn} custa perto de
// 0,5 ms.
const JSON_SEGURO_FONTE = String.raw`[\u{7F}-\u{9F}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]`;
const JSON_SEGURO_RESERVA = /[^\n\u{20}-\u{7E}\u{A0}-\u{AC}\u{AE}-\u{24F}]/gu;
let escaparJson = null;
const hex4 = (u) => `\\u${u.toString(16).padStart(4, '0')}`;
export function jsonSeguro(valor) {
  escaparJson ??= regexOu(JSON_SEGURO_FONTE, 'gu', JSON_SEGURO_RESERVA);
  return JSON.stringify(valor, null, 2).replace(escaparJson, (c) => {
    const cp = c.codePointAt(0);
    if (cp <= 0xffff) return hex4(cp);
    const v = cp - 0x10000;
    return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
  });
}

// Só para os testes (test/sem-icu.test.js, pelos _reservas de comandos.js
// e de instalar-cli.js): fonte, flags e reserva da regra de jsonSeguro.
// Nada do plugin lê isto.
export const REGRA_JSON_SEGURO = Object.freeze({ fonte: JSON_SEGURO_FONTE, flags: 'gu', reserva: JSON_SEGURO_RESERVA });

// Só para os testes (test/sem-icu.test.js): fonte, flags e reserva de
// INVISIVEIS e MARCAS_EXCESSO, para provar que a fonte compila num Node com
// ICU e que a reserva tira tudo o que a principal tira (a de jsonSeguro
// está em REGRA_JSON_SEGURO, acima). Nada do plugin lê isto.
export const _reservas = Object.freeze({
  INVISIVEIS: Object.freeze({ fonte: INVISIVEIS_FONTE, flags: 'gu', reserva: INVISIVEIS_RESERVA }),
  MARCAS_EXCESSO: Object.freeze({ fonte: MARCAS_FONTE, flags: 'gu', reserva: MARCAS_RESERVA }),
});

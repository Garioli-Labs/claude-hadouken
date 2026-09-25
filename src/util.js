const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SEM_VALOR = '—';
const doisDigitos = (n) => String(n).padStart(2, '0');
const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);

export function normalizarEffort(e) {
  if (typeof e === 'string' && e.length > 0) return e;
  if (e && typeof e === 'object' && typeof e.level === 'string') return e.level;
  return null;
}

// Lê todo o stdin. Nunca bloqueia: com TTY devolve '' na hora; se o 'end'
// não chegar em prazoMs, devolve o que já leu e solta o stdin.
export function lerStdin(prazoMs = 1000) {
  return new Promise((resolve) => {
    const entrada = process.stdin;
    if (entrada.isTTY) {
      resolve('');
      return;
    }
    let dados = '';
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(prazo);
      entrada.off('data', aoLer);
      entrada.off('end', terminar);
      entrada.off('error', terminar);
      entrada.pause();
      resolve(dados);
    };
    const aoLer = (c) => { dados += c; };
    const prazo = setTimeout(terminar, prazoMs);
    entrada.setEncoding('utf8');
    entrada.on('data', aoLer);
    entrada.on('end', terminar);
    entrada.on('error', terminar);
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
// (Zl, Zp) e os caracteres | e crase. Trade-offs, só de exibição: sequências
// de emoji unidas por ZWJ viram seus componentes, e um caractere atribuído
// depois da versão do Unicode do Node em uso conta como Cn e sai.
const INVISIVEIS = /[\p{C}\p{Zl}\p{Zp}|`]/gu;
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
    const limpo = bruto.replace(ESCAPES, '').replace(INVISIVEIS, '').trim();
    // 2 unidades por ponto de código bastam para `limite` pontos inteiros e
    // poupam o Array.from de percorrer um texto enorme.
    const cortado = Array.from(limpo.slice(0, limite * 2)).slice(0, limite).join('').trimEnd();
    return cortado.length > 0 ? cortado : null;
  } catch {
    return null;
  }
}

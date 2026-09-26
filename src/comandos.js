import { fileURLToPath } from 'node:url';
import { codigoErro, gerarRelatorio } from './consumo.js';
import { formatarMarkdown } from './relatorio.js';
import { regexOu } from './util.js';

// Comandos do CLI (addendum da Task 10, A, B, D e F). cli.js roda ao ser
// importado pelo shim (<dirDados>/bin/cli.mjs), então a lógica mora aqui,
// testável em processo:
// - tabela fixa de comandos, consultada com Object.hasOwn; o argv nunca é
//   ecoado (comando desconhecido imprime a linha de uso fixa, código 1);
// - `consumo` aceita só `--json` (literal exato); o resto é ignorado;
// - `instalar` carrega instalar-cli.js (Task 11) sob demanda e repassa só as
//   flags conhecidas; sem o módulo, "ainda não disponível" com código 0;
// - erro interno imprime só `erro interno (<código da lista>)`, código 1;
// - escreve, espera o callback da escrita, põe process.exitCode e só então
//   chama process.exit() sem argumento (o exitCode que instalar-cli.js pôs
//   vale como está).

export const USO = 'uso: cli.js consumo [--json] | instalar [--aplicar] [--substituir] [--remover]';
export const NAO_DISPONIVEL = 'instalar: ainda não disponível';
const FLAGS_INSTALAR = new Set(['--aplicar', '--substituir', '--remover']);
const URL_INSTALAR = new URL('./instalar-cli.js', import.meta.url).href;
// Prazo da coleta do GitHub, passado explicitamente (addendum D).
const PRAZO_GITHUB_MS = 10_000;
// Teto de espera pelo callback da escrita: stdout travado não segura o CLI.
const ESCRITA_MAX_MS = 10_000;

// Escapa no JSON o que um terminal ou o modelo leriam como controle:
// formato (bidi, largura zero, tags), uso privado, não atribuídos,
// separadores de linha e parágrafo, DEL e C1. O JSON.stringify já escapa C0
// e surrogates soltos; estes ficam em \uXXXX (par de surrogates acima de
// FFFF). Os nomes já chegam saneados; isto é a última barreira. Pode lançar
// só se o valor não for serializável (o chamador trata).
//
// Sem ICU (regexOu, em util.js), a reserva escapa tudo o que não for quebra
// de linha, ASCII visível ou o latim de U+00A0 a U+024F (menos o soft
// hyphen, U+00AD): nomes em outros alfabetos e emoji saem em \u. Fora das
// strings o JSON é só ASCII e a quebra de linha da indentação, que a reserva
// deixa como estão; dentro delas o escape \u mantém o JSON válido e o valor
// igual. A flag u casa um ponto de código inteiro, então um emoji chega ao
// replacer como par e sai como dois \u.
const ESCAPAR_FONTE = String.raw`[\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u{7F}-\u{9F}]`;
const ESCAPAR_RESERVA = /[^\n\u{20}-\u{7E}\u{A0}-\u{AC}\u{AE}-\u{24F}]/gu;
const ESCAPAR = regexOu(ESCAPAR_FONTE, 'gu', ESCAPAR_RESERVA);
const hex4 = (u) => `\\u${u.toString(16).padStart(4, '0')}`;
export function jsonSeguro(valor) {
  return JSON.stringify(valor, null, 2).replace(ESCAPAR, (c) => {
    const cp = c.codePointAt(0);
    if (cp <= 0xffff) return hex4(cp);
    const v = cp - 0x10000;
    return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
  });
}

// Só para os testes (test/sem-icu.test.js): fonte, flags e reserva de
// ESCAPAR. Nada do plugin lê isto.
export const _reservas = Object.freeze({
  ESCAPAR: Object.freeze({ fonte: ESCAPAR_FONTE, flags: 'gu', reserva: ESCAPAR_RESERVA }),
});

// HADOUKEN_TESTE_GH=ausente (o valor exato, documentado no relatório da
// Task 10): o coletor recebe um executor que responde 'gh ausente' sem criar
// processo nenhum, e a seção GitHub do relatório sai indisponível. Os testes
// do CLI em processo filho o usam (e provam, com uma sentinela no PATH, que o
// gh de verdade não roda), mas nada o restringe a eles: vale sempre que está
// no ambiente da sessão, que é confiável (SECURITY.md). Qualquer outro valor,
// inclusive um caminho de programa, absoluto ou não, é ignorado: o gh segue
// resolvido pelo PATH (executavel.js), e o valor nunca vira programa.
function ghDeTeste() {
  return process.env.HADOUKEN_TESTE_GH === 'ausente' ? async () => ({ ok: false, motivo: 'gh ausente' }) : undefined;
}

async function consumo(args) {
  const json = args.includes('--json');
  const r = await gerarRelatorio({ gh: ghDeTeste(), prazoGithubMs: PRAZO_GITHUB_MS });
  if (!r.ok) return { texto: `erro interno (${codigoErro({ code: r.motivo })})\n`, codigo: 1 };
  return { texto: `${json ? jsonSeguro(r.relatorio) : formatarMarkdown(r.relatorio)}\n`, codigo: 0 };
}

// O import que falhou é o do próprio alvo (módulo da Task 11 ainda não
// instalado), e não um import que falta dentro dele: e.url === alvo (Node
// >= 20.10) ou, sem e.url, a mensagem começar por "Cannot find module
// '<caminho do alvo>'" (Node 20.0 a 20.9), o mesmo critério do shim.
function faltaOAlvo(e, url) {
  try {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') return false;
    if (typeof e.url === 'string') return e.url === url;
    return typeof e.message === 'string' && e.message.startsWith(`Cannot find module '${fileURLToPath(url)}'`);
  } catch {
    return false;
  }
}

// `instalar` da Task 11: instalar-cli.js exporta async instalar(args), que
// escreve no stdout e põe process.exitCode (1 nas recusas). Só --aplicar,
// --substituir e --remover passam, na ordem em que vieram, sem repetir.
// Devolve { texto: '', codigo: null }: null diz a rodarCli que o exitCode
// posto pelo módulo é o código de saída. `opcoes.url` existe para os testes.
export async function instalar(args, opcoes) {
  const url = typeof opcoes?.url === 'string' ? opcoes.url : URL_INSTALAR;
  const flags = [];
  for (const a of Array.isArray(args) ? args : []) if (FLAGS_INSTALAR.has(a) && !flags.includes(a)) flags.push(a);
  let m;
  try {
    m = await import(url);
  } catch (e) {
    if (faltaOAlvo(e, url)) return { texto: `${NAO_DISPONIVEL}\n`, codigo: 0 };
    throw e;
  }
  if (typeof m.instalar !== 'function') throw new TypeError('instalar ausente');
  await m.instalar(flags);
  return { texto: '', codigo: null };
}

const COMANDOS = Object.freeze({ __proto__: null, consumo, instalar: (args) => instalar(args) });

// Escreve no stdout e resolve no callback da escrita (ou num erro do stdout,
// ou no teto de 10 s). Nunca rejeita.
function escreverPadrao(texto) {
  return new Promise((resolve) => {
    let feito = false;
    let timer = null;
    const fim = () => {
      if (feito) return;
      feito = true;
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(fim, ESCRITA_MAX_MS);
    try {
      process.stdout.once('error', fim);
      process.stdout.write(texto, fim);
    } catch {
      fim();
    }
  });
}

// Põe o código em process.exitCode e sai com process.exit() sem argumento.
const sairPadrao = (codigo) => {
  process.exitCode = codigo;
  process.exit();
};

// Código já posto em process.exitCode (por instalar-cli.js), ou 0.
function codigoDoProcesso() {
  const c = process.exitCode;
  return Number.isInteger(c) && c >= 0 && c <= 255 ? c : 0;
}

// Roda o comando de argv[0] com o resto do argv, escreve a saída, espera a
// escrita e chama sair(código): o do comando, ou, quando ele devolve null
// (instalar), o que já está em process.exitCode. `opcoes` (escrever, sair,
// comandos) existe para os testes. Nunca rejeita.
export async function rodarCli(argv, opcoes) {
  let escrever = escreverPadrao;
  let sair = sairPadrao;
  let comandos = COMANDOS;
  try {
    if (opcoes !== null && typeof opcoes === 'object') {
      if (typeof opcoes.escrever === 'function') escrever = opcoes.escrever;
      if (typeof opcoes.sair === 'function') sair = opcoes.sair;
      if (opcoes.comandos !== null && typeof opcoes.comandos === 'object') comandos = opcoes.comandos;
    }
  } catch {
    // opções ilegíveis: os padrões
  }
  let texto = `${USO}\n`;
  let codigo = 1;
  try {
    const lista = Array.isArray(argv) ? argv : [];
    const nome = lista[0];
    if (typeof nome === 'string' && Object.hasOwn(comandos, nome) && typeof comandos[nome] === 'function') {
      const resto = lista.slice(1).filter((a) => typeof a === 'string');
      const r = await comandos[nome](resto);
      texto = typeof r?.texto === 'string' ? r.texto : '';
      codigo = r?.codigo === null ? null : Number.isInteger(r?.codigo) ? r.codigo : 1;
    }
  } catch (e) {
    texto = `erro interno (${codigoErro(e)})\n`;
    codigo = 1;
  }
  try {
    await escrever(texto);
  } catch {
    // stdout fechado (EPIPE): sai assim mesmo
  }
  sair(codigo === null ? codigoDoProcesso() : codigo);
}

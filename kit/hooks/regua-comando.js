// /hadouken-kit:regua (spec v0.6.0, Fatia 7, bloco "Comando"): hook
// UserPromptExpansion do kit. Sem argumento mostra a régua ativa e a origem;
// `editar` deixa o prompt seguir para a skill (que monta o rascunho com o
// usuário), com o caminho do rascunho em additionalContext; `aplicar [--projeto]`
// valida o rascunho de <tmp do SO>/hadouken-<uid>/regua-rascunho.json (pasta 0700
// do usuário) e o grava por inteiro; `padrao [--projeto]` remove a régua
// do nível. O cache do kit não tem src/: este arquivo só importa node: e
// ./regua.js, ./dependencias.js, e o portão é a cópia do de src/hooks/comum.js
// (só o usuário digitando, fora de -p e SDK). A resposta sai de textos fixos,
// contagens e da régua já saneada: o argumento e o texto cru do rascunho nunca
// voltam. Nunca lança: qualquer exceção → "nada mudado".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogo, dirHadouken as dirHadoukenDe, lerJson, nomesDesconhecidos, raizProjeto, reguaEfetiva, textoRegua, validarRegua,
} from './regua.js';
import { pastaConfig as pastaConfigDe } from './dependencias.js';

const COMANDO = 'hadouken-kit:regua';
const ARQUIVO_PADRAO = fileURLToPath(new URL('../regua-padrao.json', import.meta.url));
const NADA = 'hadouken-kit: nada mudado.';
const RECUSADO_ENTRYPOINT = `${NADA} /hadouken-kit:regua só vale digitado numa sessão normal, não em -p nem no SDK.`;
const RECUSADO_ORIGEM = `${NADA} /hadouken-kit:regua só vale digitado pelo usuário.`;
const USO = `${NADA} Uso: /hadouken-kit:regua [editar | aplicar [--projeto] | padrao [--projeto]].`;
const SEM_RASCUNHO = `${NADA} sem rascunho; rode /hadouken-kit:regua editar`;
const RASCUNHO_ILEGIVEL = `${NADA} rascunho ilegível (JSON inválido ou grande demais); ele foi mantido: rode /hadouken-kit:regua editar para refazer.`;
const SEM_PASTA = `${NADA} a pasta de dados do hadouken não pôde ser determinada (HADOUKEN_HOME precisa ser um caminho absoluto).`;
const NAO_GRAVADO = `${NADA} a régua não pôde ser gravada (sem permissão de escrita ou arquivo em uso); o rascunho foi mantido.`;
const ERRO_INTERNO = `${NADA} Erro interno ao tratar /hadouken-kit:regua.`;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// O dono do processo; sem uid (Windows) o tmp do SO já é do usuário.
const uidAtual = () => (typeof process.getuid === 'function' ? process.getuid() : null);

// <tmp do SO>/hadouken-<uid>/regua-rascunho.json (POSIX, o /tmp é de todos) ou
// <tmp do SO>/hadouken/regua-rascunho.json (sem uid), absoluto: o `editar`
// informa este caminho à skill e o `aplicar` lê dele.
export const caminhoRascunho = (tmpDir, uid = null) => path.resolve(tmpDir, typeof uid === 'number' ? `hadouken-${uid}` : 'hadouken', 'regua-rascunho.json');

// A pasta do rascunho é pasta de verdade (lstat: link não vale), do uid e sem
// escrita de grupo nem de outros (R13). Sem uid só confere que é pasta real.
export function pastaRascunhoSegura(pasta, uid = null) {
  try {
    const info = fs.lstatSync(pasta);
    if (!info.isDirectory()) return false;
    return typeof uid !== 'number' || (info.uid === uid && (info.mode & 0o022) === 0);
  } catch {
    return false;
  }
}

const inseguro = (pasta) => `hadouken-kit: rascunho inseguro em ${pasta}; apague a pasta e rode /hadouken-kit:regua editar.`;

// Cópia mínima de gravarJsonAtomico (src/estado.js): tmp exclusivo na mesma
// pasta + renameSync; a pasta nasce se faltar. Nunca lança.
let sequencia = 0;
export function gravarJson(arquivo, valor) {
  let texto;
  try { texto = JSON.stringify(valor, null, 2); } catch { return { ok: false, motivo: 'serializacao' }; }
  if (typeof texto !== 'string') return { ok: false, motivo: 'serializacao' };
  const tmp = `${arquivo}.${process.pid}.${Date.now()}.${sequencia++}.tmp`;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(tmp, `${texto}\n`, { flag: 'wx' });
    fs.renameSync(tmp, arquivo);
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* sem tmp a apagar */ }
    return { ok: false, motivo: typeof e?.code === 'string' ? e.code : 'escrita' };
  }
}

// Gramática fechada: o argumento nunca vira texto da resposta.
function lerArgs(texto) {
  const t = typeof texto === 'string' ? texto.trim().split(/\s+/).filter(Boolean) : [];
  if (t.length === 0) return { acao: 'mostrar' };
  const [acao, ...resto] = t;
  if (acao === 'editar' && resto.length === 0) return { acao };
  if ((acao === 'aplicar' || acao === 'padrao') && (resto.length === 0 || (resto.length === 1 && resto[0] === '--projeto'))) {
    return { acao, projeto: resto.length === 1 };
  }
  return { acao: 'erro' };
}

// O que a régua gravada guarda: só o que existe (sem listas vazias nem agente null).
function paraArquivo(regua) {
  return {
    fases: regua.fases.map((f) => {
      const fase = { fase: f.fase };
      if (f.usar.length > 0) fase.usar = f.usar;
      if (f.alternativas.length > 0) fase.alternativas = f.alternativas;
      if (f.agente !== null) fase.agente = f.agente;
      return fase;
    }),
    transversais: regua.transversais,
  };
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function mostrar({ dirHadouken, env, cwd }) {
  const padrao = lerJson(ARQUIVO_PADRAO);
  if (!padrao.ok) return `${NADA} a régua padrão do kit (regua-padrao.json) não pôde ser lida.`;
  const { raiz } = raizProjeto({ env, cwd });
  const cat = catalogo({ pastaConfig: pastaConfigDe(env), raiz });
  // A mesma escolha do SessionStart (reguaEfetiva), sem o corte de 2 000 caracteres.
  // Régua sem nome conhecido cai para o nível seguinte e a lista do que não
  // existe continua: é o que o usuário precisa para corrigir a dele.
  const efetiva = reguaEfetiva({ raiz, dirHadouken, padrao: padrao.valor, catalogo: cat, limite: Infinity });
  const { nomes } = efetiva;
  const linhas = [`hadouken-kit: ${efetiva.texto}`, ...efetiva.avisos];
  if (nomes.skills.length > 0) linhas.push(`Skills desconhecidas (não instaladas ou desligadas): ${nomes.skills.join(', ')}.`);
  if (nomes.agentes.length > 0) linhas.push(`Agentes desconhecidos: ${nomes.agentes.join(', ')}.`);
  return linhas.join('\n');
}

// Raiz do `--projeto` e o arquivo de config do repo.
function destinoProjeto({ env, cwd }) {
  const { raiz, comGit } = raizProjeto({ env, cwd });
  return { arquivo: path.join(raiz, '.claude', 'hadouken.json'), comGit };
}

// hadouken.json do repo: ausente → {}; ilegível ou que não é objeto → null
// (nunca sobrescreve o que não consegue ler).
function lerConfigRepo(arquivo) {
  const lido = lerJson(arquivo);
  if (lido.ausente) return {};
  return lido.ok && ehObjeto(lido.valor) ? lido.valor : null;
}

function aplicar(pedido, ctx) {
  const { dirHadouken, tmpDir, env, uid } = ctx;
  const arquivoRascunho = caminhoRascunho(tmpDir, uid);
  const pasta = path.dirname(arquivoRascunho);
  try { fs.lstatSync(pasta); } catch (e) { if (e?.code === 'ENOENT') return SEM_RASCUNHO; }
  if (!pastaRascunhoSegura(pasta, uid)) return inseguro(pasta);
  const rascunho = lerJson(arquivoRascunho, { donoUid: uid, semLink: true });
  if (rascunho.ausente) return SEM_RASCUNHO;
  if (rascunho.inseguro) return inseguro(pasta);
  if (!rascunho.ok) return RASCUNHO_ILEGIVEL;
  const v = validarRegua(rascunho.valor);
  if (v.regua === null) return `${NADA} o rascunho não tem fase válida; ele foi mantido: rode /hadouken-kit:regua editar para corrigir.`;
  const nova = paraArquivo(v.regua);

  let arquivo;
  let comGit = true;
  if (pedido.projeto) {
    ({ arquivo, comGit } = destinoProjeto(ctx));
    const config = lerConfigRepo(arquivo);
    if (config === null) return `${NADA} o .claude/hadouken.json do repositório está ilegível; corrija ou apague o arquivo e rode de novo. O rascunho foi mantido.`;
    if (!gravarJson(arquivo, { ...config, regua: nova }).ok) return NAO_GRAVADO;
  } else {
    if (dirHadouken === null) return SEM_PASTA;
    arquivo = path.join(dirHadouken, 'regua.json');
    if (!gravarJson(arquivo, nova).ok) return NAO_GRAVADO;
  }
  try { fs.rmSync(arquivoRascunho, { force: true }); } catch { /* rascunho fica; o próximo editar o sobrescreve */ }

  const cat = catalogo({ pastaConfig: pastaConfigDe(env), raiz: raizProjeto(ctx).raiz });
  const nomes = nomesDesconhecidos({ regua: v.regua, catalogo: cat });
  const resumo = [plural(v.regua.fases.length, 'fase', 'fases'), plural(v.regua.transversais.length, 'transversal', 'transversais')].join(' e ');
  const avisos = [];
  if (v.descartes > 0) avisos.push(`${plural(v.descartes, 'item descartado', 'itens descartados')} pelo saneamento`);
  if (nomes.skills.length > 0) avisos.push(plural(nomes.skills.length, 'skill desconhecida', 'skills desconhecidas'));
  if (nomes.agentes.length > 0) avisos.push(plural(nomes.agentes.length, 'agente desconhecido', 'agentes desconhecidos'));
  const linhas = [`hadouken-kit: régua aplicada em ${pedido.projeto ? 'repo' : 'global'} (${arquivo}): ${resumo}. Vale a partir da próxima sessão.`];
  // O texto que o SessionStart vai injetar, sem corte: nomes que o catálogo não conhece ficam de fora dele.
  const injetado = textoRegua({ regua: v.regua, origem: pedido.projeto ? 'repo' : 'global', catalogo: cat, validar: cat.lido, limite: Infinity }).texto;
  if (injetado !== '') linhas.push(injetado);
  if (avisos.length > 0) linhas.push(`${avisos.join('; ')}; /hadouken-kit:regua mostra a régua ativa e os nomes.`);
  if (!comGit) linhas.push('sem repositório git: a régua foi gravada na pasta atual; defina CLAUDE_PROJECT_DIR ou rode a partir da raiz do repositório.');
  return linhas.join('\n');
}

function remover(pedido, ctx) {
  if (pedido.projeto) {
    const { arquivo } = destinoProjeto(ctx);
    const config = lerConfigRepo(arquivo);
    if (config === null) return `${NADA} o .claude/hadouken.json do repositório está ilegível.`;
    if (!Object.hasOwn(config, 'regua')) return 'hadouken-kit: nada a remover: o repositório não tem régua.';
    const { regua: _fora, ...resto } = config;
    return gravarJson(arquivo, resto).ok ? 'hadouken-kit: régua do repositório removida; vale a global, se houver, senão a padrão.' : NAO_GRAVADO;
  }
  if (ctx.dirHadouken === null) return SEM_PASTA;
  const arquivo = path.join(ctx.dirHadouken, 'regua.json');
  if (!fs.existsSync(arquivo)) return 'hadouken-kit: nada a remover: não há régua global.';
  try {
    fs.rmSync(arquivo);
  } catch {
    return NAO_GRAVADO;
  }
  return 'hadouken-kit: régua global removida; vale a padrão (ou a do repositório, se houver).';
}

// `editar` não bloqueia: o prompt segue para a skill e o hook acrescenta o
// caminho do rascunho (additionalContext de UserPromptExpansion, sem `decision`).
// A pasta do rascunho nasce aqui, 0700 e do usuário; uma que já existe só vale se
// passar na mesma checagem do `aplicar` (R13).
function editar({ tmpDir, uid }) {
  const caminho = caminhoRascunho(tmpDir, uid);
  const pasta = path.dirname(caminho);
  try {
    fs.mkdirSync(pasta, { mode: 0o700 });
  } catch (e) {
    if (e?.code !== 'EEXIST') return { decision: 'block', reason: inseguro(pasta) };
  }
  if (!pastaRascunhoSegura(pasta, uid)) return { decision: 'block', reason: inseguro(pasta) };
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptExpansion',
      additionalContext: `hadouken-kit: grave o rascunho da régua exatamente em ${caminho} (ferramenta Write); em nenhum outro lugar.`,
    },
  };
}

// A saída do hook: {decision:'block', reason} ou, no `editar`, só o additionalContext.
export function decidirRegua(entrada, { dirHadouken = null, tmpDir = os.tmpdir(), env = process.env, cwd = process.cwd(), uid = uidAtual() } = {}) {
  const bloqueio = (reason) => ({ decision: 'block', reason });
  try {
    const ep = env?.CLAUDE_CODE_ENTRYPOINT;
    if (typeof ep === 'string' && /^sdk/i.test(ep)) return bloqueio(RECUSADO_ENTRYPOINT);
    if (entrada?.command_source !== 'plugin' || entrada?.expansion_type !== 'slash_command') return bloqueio(RECUSADO_ORIGEM);
    const pedido = lerArgs(entrada.command_args);
    const ctx = { dirHadouken, tmpDir, env, cwd, uid };
    if (pedido.acao === 'editar') return editar(ctx);
    if (pedido.acao === 'erro') return bloqueio(USO);
    if (pedido.acao === 'mostrar') return bloqueio(mostrar(ctx));
    return bloqueio(pedido.acao === 'aplicar' ? aplicar(pedido, ctx) : remover(pedido, ctx));
  } catch {
    return bloqueio(ERRO_INTERNO);
  }
}

// ------------------------------------------------------------ hook

const TETO_STDIN = 1024 * 1024;

function lerStdin() {
  try { return fs.readFileSync(0, 'utf8').slice(0, TETO_STDIN); } catch { return ''; }
}

function principal() {
  process.stdout.on('error', () => {});
  let saida = null;
  try {
    const entrada = JSON.parse(lerStdin());
    if (ehObjeto(entrada) && entrada.command_name === COMANDO) {
      saida = decidirRegua(entrada, { dirHadouken: dirHadoukenDe(process.env), tmpDir: os.tmpdir(), env: process.env, cwd: process.cwd() });
    }
  } catch { /* stdin ilegível: o prompt segue */ }
  if (saida !== null) process.stdout.write(JSON.stringify(saida));
}

// Só roda como hook; importado pelos testes, não lê o stdin.
function ehEntrada() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (ehEntrada()) principal();

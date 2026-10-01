import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico, lerLimitado } from '../estado.js';
import { caminhoDoAmbiente, instante, numeroFinito } from '../base.js';
import { lerSemLink } from './arquivo.js';
import { caminhoComparavel } from './caminho.js';

// Fotografia dos campos da guarda nos settings (Task 19b, spike S13 (a) da
// Task 2 da parte 2; decisão do Sr. Garioli em 2026-10-01). Fecha, para a
// sessão em curso, o furo do R1 (SECURITY.md) que a P5 não pega: o sed -i (ou
// qualquer escrita pelo shell, ou do próprio usuário) num settings que liga
// disableAllHooks, desliga o plugin em enabledPlugins ou mexe em hooks.
// - O SessionStart grava em <dirDados>/config-base.json a impressão dos três
//   campos de cada settings da sessão (settingsDaSessao), sob a chave do
//   caminho normalizado (caminhoComparavel: caminho real, 8.3 e caixa no
//   win32, a mesma regra da P5).
// - O hook ConfigChange (hooks/guarda-config.js) compara a impressão atual do
//   arquivo com a da fotografia (decisaoConfig) e bloqueia o que mudou. Sem
//   fotografia do caminho, compara com a do arquivo ausente.
// Fatos medidos no S13 (Claude Code 2.1.287, Windows): o ConfigChange não
// traz conteúdo velho nem novo, só o file_path absoluto; o
// {"decision":"block"} segura a mudança nesta sessão, e o arquivo no disco
// fica mudado (a próxima sessão o lê, e a fotografia dela o aceita).
// Só fs, path e crypto do node: nada de rede nem child_process
// (test/guarda-ameacas.test.js, S24). Nada do arquivo vira texto: só hashes e
// rótulos fixos.

export const ARQ_CONFIG_BASE = 'config-base.json';
export const CAMPOS_GUARDA = Object.freeze(['disableAllHooks', 'enabledPlugins', 'hooks']);
export const ILEGIVEL = 'ilegivel';
// No máximo 200 caminhos (saem os de `at` mais velho) e 256 KiB na leitura;
// a gravação poda até caber no teto, para nunca deixar um arquivo que a
// próxima leitura recusaria.
export const CONFIG_BASE_MAX = 200;
export const CONFIG_BASE_MAX_BYTES = 256 * 1024;
// Teto do settings lido: 1 MiB (o mesmo da leitura da P5). Acima dele, o
// arquivo é ilegível.
export const SETTINGS_MAX_BYTES = 1_048_576;
// As origens do ConfigChange com arquivo de settings que a sessão lê. A doc
// lista também policy_settings (gerenciado, fora do alcance do Claude) e
// skills; essas passam.
const ORIGENS = Object.freeze(['user_settings', 'project_settings', 'local_settings']);
// Sem file_path, só os settings de projeto e locais bloqueiam (falha
// fechada: o furo que se quer fechar é justamente esse arquivo).
const ORIGENS_SEM_CAMINHO = Object.freeze(['project_settings', 'local_settings']);
const CAMINHO_MAX = 4096;
const HEX64 = /^[0-9a-f]{64}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const absoluto = (p) => typeof p === 'string' && p.length > 0 && p.length <= CAMINHO_MAX && path.isAbsolute(p);
// Só propriedade própria; ausente vale null, como o null explícito.
const campoDe = (v, k) => (ehObjeto(v) && Object.hasOwn(v, k) ? v[k] : null);
const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

// JSON canônico: as chaves de todo objeto em ordem (a do sort padrão, por
// unidade UTF-16), as listas na ordem delas, sem espaços. Sem recursão: o
// JSON.parse aceita centenas de milhares de níveis, e uma serialização
// recursiva estouraria a pilha (a exceção cairia no fail-open do hook). Só
// recebe valores do JSON.parse; um undefined (que o JSON não tem) vira null.
class Literal {
  constructor(texto) { this.texto = texto; }
}
const VIRGULA = new Literal(',');
const FECHA_LISTA = new Literal(']');
const FECHA_OBJETO = new Literal('}');
export function jsonCanonico(valor) {
  const partes = [];
  const pilha = [valor];
  while (pilha.length > 0) {
    const x = pilha.pop();
    if (x instanceof Literal) {
      partes.push(x.texto);
    } else if (Array.isArray(x)) {
      partes.push('[');
      pilha.push(FECHA_LISTA);
      for (let i = x.length - 1; i >= 0; i--) {
        pilha.push(x[i]);
        if (i > 0) pilha.push(VIRGULA);
      }
    } else if (x !== null && typeof x === 'object') {
      const chaves = Object.keys(x).sort();
      partes.push('{');
      pilha.push(FECHA_OBJETO);
      for (let i = chaves.length - 1; i >= 0; i--) {
        pilha.push(x[chaves[i]], new Literal(`${JSON.stringify(chaves[i])}:`));
        if (i > 0) pilha.push(VIRGULA);
      }
    } else {
      partes.push(JSON.stringify(x) ?? 'null');
    }
  }
  return partes.join('');
}

// Impressão de um settings já lido: o sha256 do JSON canônico de
// {disableAllHooks, enabledPlugins, hooks} e, à parte, o de cada campo (para
// o detalhe do evento dizer qual mudou). Campo ausente vale null; um valor
// que não é objeto (lista, número) tem os três null.
export function impressaoDe(valor) {
  const tres = {};
  const campos = {};
  for (const k of CAMPOS_GUARDA) {
    tres[k] = campoDe(valor, k);
    campos[k] = sha256(jsonCanonico(tres[k]));
  }
  return { impressao: sha256(jsonCanonico(tres)), campos };
}

// A impressão do arquivo ausente (os três null), calculada uma vez, na
// primeira vez que precisa (o import do módulo não faz hash).
let ausenteCache = null;
const impressaoAusente = () => {
  ausenteCache ??= impressaoDe({});
  return ausenteCache;
};

// O settings como o Claude Code o lê: segue link (um settings.json que é link
// de um repositório de dotfiles vale pelo destino), confere pelo stat e de
// novo pelo fstat (lerLimitado) que é arquivo regular dentro do teto. Ausente
// (ENOENT ou ENOTDIR, inclusive link quebrado): { ok: false, ausente: true }.
// Qualquer outra falha (pasta, acima de 1 MiB, sem permissão, preso por outro
// processo, JSON inválido): { ok: false, ausente: false }. O BOM do começo
// sai, como no lerJson. Nunca lança.
function lerSettings(arquivo) {
  try {
    let info;
    try {
      info = fs.statSync(arquivo);
    } catch (e) {
      return { ok: false, ausente: e?.code === 'ENOENT' || e?.code === 'ENOTDIR' };
    }
    if (!info.isFile() || info.size > SETTINGS_MAX_BYTES) return { ok: false, ausente: false };
    const lido = lerLimitado(arquivo, SETTINGS_MAX_BYTES);
    if (!lido.ok) return { ok: false, ausente: false };
    let texto = lido.bytes.toString('utf8');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    return { ok: true, valor: JSON.parse(texto) };
  } catch {
    return { ok: false, ausente: false };
  }
}

// { impressao, campos } do arquivo: ausente vale o objeto com os três null;
// ilegível, { impressao: 'ilegivel', campos: null }. Só a leitura é
// protegida: uma falha do hash é exceção inesperada e sobe (o hook passa e
// registra 'erro', §4.5).
export function impressaoDoArquivo(arquivo) {
  const lido = lerSettings(arquivo);
  if (lido.ok) return impressaoDe(lido.valor);
  return lido.ausente ? impressaoAusente() : { impressao: ILEGIVEL, campos: null };
}

// A chave da fotografia: o caminho real com a caixa do win32 normalizada
// (caminhoComparavel, a mesma regra da P5). Relativo, vazio, acima de 4096
// caracteres ou não texto: null.
export function chaveDoArquivo(arquivo) {
  return absoluto(arquivo) ? caminhoComparavel(arquivo) : null;
}

// Os três settings da sessão (regra 1 da Task 19b): o do usuário,
// <CLAUDE_CONFIG_DIR>/settings.json se a variável for caminho absoluto
// completo (caminhoDoAmbiente), senão <casa>/.claude/settings.json; e os dois
// do projeto, <cwd>/.claude/settings.json e settings.local.json. Sem casa ou
// sem cwd absolutos, os respectivos ficam de fora.
export function settingsDaSessao({ cwd, configDir, casa } = {}) {
  const r = [];
  const cfg = caminhoDoAmbiente(configDir);
  if (cfg !== null) r.push(path.join(cfg, 'settings.json'));
  else if (absoluto(casa)) r.push(path.join(casa, '.claude', 'settings.json'));
  if (absoluto(cwd)) r.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
  return r;
}

// Uma entrada lida de config-base.json: impressão em hex com os três campos
// em hex, ou 'ilegivel' com campos null; o resto não passa.
function fotoValida(e) {
  if (e.impressao === ILEGIVEL) return e.campos === null ? { impressao: ILEGIVEL, campos: null } : null;
  if (typeof e.impressao !== 'string' || !HEX64.test(e.impressao) || !ehObjeto(e.campos)) return null;
  const campos = {};
  for (const k of CAMPOS_GUARDA) {
    const v = e.campos[k];
    if (typeof v !== 'string' || !HEX64.test(v)) return null;
    campos[k] = v;
  }
  return { impressao: e.impressao, campos };
}

// Map chave → { at (ms), impressao, campos }, do mais velho para o mais novo
// na ordem do arquivo. Leitura como a dos outros arquivos novos da guarda
// (lerSemLink: lstat antes, link não é seguido, teto de 256 KiB). Ilegível
// ou fora da forma: vazio (sem fotografia, o hook compara com o arquivo
// ausente). Entrada fora da forma, com `at` inválido ou no futuro, ou com
// chave que não é caminho absoluto: sai, e as outras ficam. Nunca lança.
export function lerConfigBase(dir, agoraMs) {
  const r = new Map();
  try {
    if (typeof dir !== 'string') return r;
    const lido = lerSemLink(path.join(dir, ARQ_CONFIG_BASE), CONFIG_BASE_MAX_BYTES);
    if (!lido.ok || !ehObjeto(lido.valor) || lido.valor.v !== 1 || !ehObjeto(lido.valor.arquivos)) return r;
    for (const [chave, e] of Object.entries(lido.valor.arquivos)) {
      if (!absoluto(chave) || !ehObjeto(e)) continue;
      const at = instante(e.at, agoraMs);
      const foto = fotoValida(e);
      if (at !== null && foto !== null) r.set(chave, { at, ...foto });
    }
    return r;
  } catch {
    return new Map();
  }
}

const tamanho = (chave, e) => Buffer.byteLength(JSON.stringify(chave), 'utf8') + Buffer.byteLength(JSON.stringify(e), 'utf8') + 2;

// Fotografa os arquivos (a impressão de agora, sob a chave de cada um) sobre
// o que config-base.json já tem, e grava atômico (gravarJsonAtomico, como os
// outros arquivos da pasta de dados). Ficam os CONFIG_BASE_MAX caminhos de
// `at` mais novo e, deles, os mais novos que cabem em CONFIG_BASE_MAX_BYTES.
// Arquivo sem chave (relativo) fica de fora. Devolve { ok }. Uma falha do
// hash sobe (o SessionStart registra 'erro' config-foto); a gravação que
// falha devolve ok false.
export function fotografar(dir, arquivos, agoraMs) {
  if (typeof dir !== 'string' || !numeroFinito(agoraMs)) return { ok: false };
  const base = lerConfigBase(dir, agoraMs);
  for (const arquivo of Array.isArray(arquivos) ? arquivos : []) {
    const chave = chaveDoArquivo(arquivo);
    if (chave === null) continue;
    const foto = impressaoDoArquivo(arquivo);
    base.delete(chave);
    base.set(chave, { at: agoraMs, ...foto });
  }
  // sort estável: com o mesmo `at`, vale a ordem de inserção.
  const lista = [...base]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(-CONFIG_BASE_MAX)
    .map(([chave, e]) => [chave, { at: new Date(e.at).toISOString(), impressao: e.impressao, campos: e.campos }]);
  const tamanhos = lista.map(([chave, e]) => tamanho(chave, e));
  // {"v":1,"arquivos":{}} e folga.
  let total = 64 + tamanhos.reduce((s, t) => s + t, 0);
  let inicio = 0;
  while (inicio < lista.length && total > CONFIG_BASE_MAX_BYTES) total -= tamanhos[inicio++];
  const valor = { v: 1, arquivos: Object.fromEntries(lista.slice(inicio)) };
  return { ok: gravarJsonAtomico(path.join(dir, ARQ_CONFIG_BASE), valor, { compacto: true }).ok };
}

// O que mudou no arquivo desde a fotografia: null (nada nos três campos) ou o
// detalhe do evento 'config-bloqueada' — o primeiro campo que mudou, na ordem
// de CAMPOS_GUARDA, ou 'ilegivel' quando o arquivo atual (ou o fotografado)
// não se lê. Sem fotografia para a chave, a base é o arquivo ausente.
export function mudancaNaGuarda(dir, arquivo, agoraMs) {
  const chave = chaveDoArquivo(arquivo);
  const atual = impressaoDoArquivo(arquivo);
  const base = (chave === null ? undefined : lerConfigBase(dir, agoraMs).get(chave)) ?? impressaoAusente();
  if (atual.impressao === base.impressao) return null;
  if (atual.campos === null || base.campos === null) return ILEGIVEL;
  // Impressões diferentes com os três campos iguais só com um
  // config-base.json mexido à mão: bloqueia do mesmo jeito.
  return CAMPOS_GUARDA.find((k) => atual.campos[k] !== base.campos[k]) ?? ILEGIVEL;
}

// A decisão do hook ConfigChange (regra 2 da Task 19b): null passa; um texto
// é o detalhe do bloqueio. source fora das três origens: passa. file_path que
// não é caminho absoluto (ausente, não texto, vazio, relativo): bloqueia
// ('sem-caminho') nos settings de projeto e locais e passa nos do usuário.
export function decisaoConfig(dir, source, filePath, agoraMs) {
  if (!ORIGENS.includes(source)) return null;
  if (!absoluto(filePath)) return ORIGENS_SEM_CAMINHO.includes(source) ? 'sem-caminho' : null;
  return mudancaNaGuarda(dir, filePath, agoraMs);
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico, lerLimitado } from '../estado.js';
import { caminhoDoAmbiente, idValido, instante, numeroFinito } from '../base.js';
import { lerSemLink } from './arquivo.js';
import { caminhoComparavel } from './caminho.js';

// Fotografia dos campos da guarda nos settings (Task 19b, spike S13 (a) da
// Task 2 da parte 2; decisão do Sr. Garioli em 2026-10-01). Fecha, para a
// sessão em curso, o furo do R1 (SECURITY.md) que a P5 não pega: o sed -i (ou
// qualquer escrita pelo shell, ou do próprio usuário) num settings que liga
// disableAllHooks, desliga o plugin em enabledPlugins ou mexe em hooks.
// - O SessionStart grava em <dirDados>/config-base.json a impressão dos três
//   campos de cada settings da sessão (settingsDaSessao), sob a chave
//   (session_id, caminho normalizado) (caminhoComparavel: caminho real, 8.3 e
//   caixa no win32, a mesma regra da P5). Só a primeira vez da sessão grava
//   (fix round 1 da Task 19b): um compact, clear ou resume da mesma sessão
//   acha a fotografia dela e não a troca, senão a mudança segurada viraria a
//   base e passaria na escrita seguinte.
// - O hook ConfigChange (hooks/guarda-config.js) compara a impressão atual do
//   arquivo com a fotografia da própria sessão (decisaoConfig) e bloqueia o
//   que mudou. A de outra sessão nunca vale: uma sessão aberta depois da
//   mudança não solta a que a segurou. Sem fotografia da sessão para o
//   caminho (corrida de dois SessionStart, poda), compara com a do arquivo
//   ausente.
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
// No máximo 600 entradas (sessão, caminho), umas 200 sessões de três
// settings; saem as de `at` mais velho. Teto de leitura de 512 KiB: uma
// entrada tem uns 370 bytes além do caminho, e 600 delas com caminhos comuns
// passam dos 256 KiB da primeira versão. A gravação ainda poda até caber no
// teto (caminhos muito longos), para nunca deixar um arquivo que a próxima
// leitura recusaria.
export const CONFIG_BASE_MAX = 600;
export const CONFIG_BASE_MAX_BYTES = 512 * 1024;
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

// Map session_id → Map chave → { at (ms), impressao, campos }, na ordem do
// arquivo. Arquivo: { v: 2, sessoes: { <session_id>: { <chave>: { at,
// impressao, campos } } } }. Leitura como a dos outros arquivos novos da
// guarda (lerSemLink: lstat antes, link não é seguido, teto de 512 KiB).
// Ilegível, fora da forma ou de outra versão (a v 1, sem sessão): vazio (sem
// fotografia, o hook compara com o arquivo ausente). Sessão com id fora do
// padrão (idValido) ou que não é objeto: sai inteira. Entrada fora da forma,
// com `at` inválido ou no futuro, ou com chave que não é caminho absoluto:
// sai, e as outras ficam. Sessão sem nenhuma entrada válida não aparece.
// Nunca lança.
export function lerConfigBase(dir, agoraMs) {
  const r = new Map();
  try {
    if (typeof dir !== 'string') return r;
    const lido = lerSemLink(path.join(dir, ARQ_CONFIG_BASE), CONFIG_BASE_MAX_BYTES);
    if (!lido.ok || !ehObjeto(lido.valor) || lido.valor.v !== 2 || !ehObjeto(lido.valor.sessoes)) return r;
    for (const [sessao, fotos] of Object.entries(lido.valor.sessoes)) {
      if (!idValido(sessao) || !ehObjeto(fotos)) continue;
      const daSessao = new Map();
      for (const [chave, e] of Object.entries(fotos)) {
        if (!absoluto(chave) || !ehObjeto(e)) continue;
        const at = instante(e.at, agoraMs);
        const foto = fotoValida(e);
        if (at !== null && foto !== null) daSessao.set(chave, { at, ...foto });
      }
      if (daSessao.size > 0) r.set(sessao, daSessao);
    }
    return r;
  } catch {
    return new Map();
  }
}

// Bytes de uma entrada no arquivo: a chave e o valor e, por folga, o id da
// sessão de novo (conta a mais quando a sessão tem várias entradas, nunca a
// menos).
const tamanho = (sessao, chave, e) => Buffer.byteLength(JSON.stringify(sessao), 'utf8') + Buffer.byteLength(JSON.stringify(chave), 'utf8')
  + Buffer.byteLength(JSON.stringify(e), 'utf8') + 6;

// Fotografa os arquivos da sessão (regra 1 da Task 19b, com o fix round 1):
// cada (session_id, chave) que config-base.json ainda não tem ganha a
// impressão de agora; a que já existe fica como está (a base da sessão é a do
// primeiro SessionStart dela). Sem nada novo, não grava. Com algo novo, grava
// atômico (gravarJsonAtomico, como os outros arquivos da pasta de dados): ficam
// as CONFIG_BASE_MAX entradas de `at` mais novo e, delas, as mais novas que
// cabem em CONFIG_BASE_MAX_BYTES. Uma sessão cuja fotografia saiu na poda
// fotografa de novo no próximo SessionStart dela. Arquivo sem chave
// (relativo) fica de fora. Devolve { ok }. Uma falha do hash sobe (o
// SessionStart registra 'erro' config-foto); a gravação que falha devolve ok
// false.
export function fotografar(dir, sessionId, arquivos, agoraMs) {
  if (typeof dir !== 'string' || !idValido(sessionId) || !numeroFinito(agoraMs)) return { ok: false };
  const base = lerConfigBase(dir, agoraMs);
  const daSessao = base.get(sessionId) ?? new Map();
  let novas = 0;
  for (const arquivo of Array.isArray(arquivos) ? arquivos : []) {
    const chave = chaveDoArquivo(arquivo);
    if (chave === null || daSessao.has(chave)) continue;
    daSessao.set(chave, { at: agoraMs, ...impressaoDoArquivo(arquivo) });
    novas++;
  }
  if (novas === 0) return { ok: true };
  base.set(sessionId, daSessao);
  // sort estável: com o mesmo `at`, vale a ordem de inserção.
  const lista = [...base]
    .flatMap(([sessao, fotos]) => [...fotos].map(([chave, e]) => [sessao, chave, e]))
    .sort((a, b) => a[2].at - b[2].at)
    .slice(-CONFIG_BASE_MAX)
    .map(([sessao, chave, e]) => [sessao, chave, { at: new Date(e.at).toISOString(), impressao: e.impressao, campos: e.campos }]);
  const tamanhos = lista.map(([sessao, chave, e]) => tamanho(sessao, chave, e));
  // {"v":2,"sessoes":{}} e folga.
  let total = 64 + tamanhos.reduce((s, t) => s + t, 0);
  let inicio = 0;
  while (inicio < lista.length && total > CONFIG_BASE_MAX_BYTES) total -= tamanhos[inicio++];
  // Objetos sem protótipo: id e caminho já validados viram só chaves próprias.
  const sessoes = Object.create(null);
  for (const [sessao, chave, e] of lista.slice(inicio)) (sessoes[sessao] ??= Object.create(null))[chave] = e;
  return { ok: gravarJsonAtomico(path.join(dir, ARQ_CONFIG_BASE), { v: 2, sessoes }, { compacto: true }).ok };
}

// O que mudou no arquivo desde a fotografia da sessão: null (nada nos três
// campos) ou o detalhe do evento 'config-bloqueada' — o primeiro campo que
// mudou, na ordem de CAMPOS_GUARDA, ou 'ilegivel' quando o arquivo atual (ou
// o fotografado) não se lê. Só vale a fotografia da própria sessão; sem ela
// para a chave (ou com id inválido), a base é o arquivo ausente.
export function mudancaNaGuarda(dir, sessionId, arquivo, agoraMs) {
  const chave = chaveDoArquivo(arquivo);
  const atual = impressaoDoArquivo(arquivo);
  const fotos = chave !== null && idValido(sessionId) ? lerConfigBase(dir, agoraMs).get(sessionId) : undefined;
  const base = fotos?.get(chave) ?? impressaoAusente();
  if (atual.impressao === base.impressao) return null;
  if (atual.campos === null || base.campos === null) return ILEGIVEL;
  // Impressões diferentes com os três campos iguais só com um
  // config-base.json mexido à mão: bloqueia do mesmo jeito.
  return CAMPOS_GUARDA.find((k) => atual.campos[k] !== base.campos[k]) ?? ILEGIVEL;
}

// A decisão do hook ConfigChange (regra 2 da Task 19b): null passa; um texto
// é o detalhe do bloqueio. source fora das três origens: passa. file_path que
// não é caminho absoluto (ausente, não texto, vazio, relativo): bloqueia
// ('sem-caminho') nos settings de projeto e locais e passa nos do usuário. A
// comparação é com a fotografia da sessão sessionId (o session_id do stdin).
export function decisaoConfig(dir, sessionId, source, filePath, agoraMs) {
  if (!ORIGENS.includes(source)) return null;
  if (!absoluto(filePath)) return ORIGENS_SEM_CAMINHO.includes(source) ? 'sem-caminho' : null;
  return mudancaNaGuarda(dir, sessionId, filePath, agoraMs);
}

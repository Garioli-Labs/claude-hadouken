import { isUtf8 } from 'node:buffer';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  absolutoCompleto, apagar, DATA_MAX_MS, esperar, instante, numeroFinito, RENOMEAR_ESPERA_MS, RENOMEAR_TENTATIVAS,
  renomearDeNovo, varrerTmpVelhos,
} from '../base.js';
import { caminhoAceito } from '../configuracao.js';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { ID_EXTENSAO, montarVsix, versaoValida } from './vsix.js';

// Instalador do painel no VS Code (spec E4 e E8/S27, Task 4). O SessionStart
// dispara `cli.js painel instalar` em segundo plano, destacado, quando a
// versão instalada da extensão não é a do plugin (precisaInstalar), e o
// comando:
// 1. marca a tentativa (<dirDados>/painel/tentativa.json), que segura novos
//    disparos por 1 h, dê certo ou não;
// 2. monta o .vsix (vsix.js) com a versão do plugin.json e os dois arquivos
//    de <raiz>/vscode/, e grava em <dirDados>/painel/ por escrita atômica;
// 3. acha o CLI do VS Code só nos diretórios absolutos do PATH (code.cmd no
//    Windows, code fora dele) e confere o caminho dele e o do .vsix pela
//    mesma lista de caracteres do instalador da barra (caminhoSeguro);
// 4. roda `code --install-extension <vsix> --force`. No Windows o code.cmd só
//    roda por um shell: cmd.exe /d /s /c com a linha montada aqui, entre
//    aspas, e windowsVerbatimArguments para o Node não requotar. /d desliga o
//    AutoRun do registro, e /s tira só o par de aspas de fora. Os caminhos já
//    passaram pela lista, que recusa aspas, % ^ & | ! e o resto do que o
//    cmd.exe leria de outro jeito. O cwd do processo é a pasta do painel, não
//    o repo aberto: no Node 20, um "cmd.exe" plantado no cwd seria achado
//    antes do PATH;
// 5. com sucesso, grava <dirDados>/painel/instalado.json { versao, em }.
// Nada disto entra no contexto do Claude (zero tokens), e HADOUKEN_SEM_PAINEL=1
// desliga o disparo no SessionStart.
//
// Nenhuma função exportada lança: falha vira { ok: false, motivo } com motivo
// de uma lista fixa, ou false/null.

export const DIR_PAINEL = 'painel';
export const ARQ_INSTALADO = 'instalado.json';
export const ARQ_TENTATIVA = 'tentativa.json';
export const TENTATIVA_MS = 3_600_000;
export const PRAZO_INSTALAR_MS = 120_000;

const MAX_REGISTRO_BYTES = 4096;
const MAX_PLUGIN_JSON_BYTES = 64 * 1024;
const MAX_FONTE_BYTES = 256 * 1024;
const TMP_BYTES = 6;
// Temporário da escrita do .vsix: <nome do .vsix>.<12 hex sorteados>.tmp.
const TMP_VSIX = /^claude-hadouken-painel-\d{1,9}\.\d{1,9}\.\d{1,9}\.vsix\.[0-9a-f]{12}\.tmp$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (motivo) => ({ ok: false, motivo });
const dirValido = (dir) => typeof dir === 'string' && dir.length > 0 && !dir.includes('\0') && path.isAbsolute(dir);
const agoraValido = (ms) => numeroFinito(ms) && Math.abs(ms) <= DATA_MAX_MS;
const existePadrao = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const executarPadrao = (exe, args, opcoes, cb) => execFile(exe, args, opcoes, cb);

// Caminho do CLI do VS Code: code.cmd no win32, code fora dele, no primeiro
// diretório do PATH em que `existe` o confirma. Só entram diretórios que são
// caminho absoluto completo pela regra do processo (absolutoCompleto, de
// base.js); vazio, ".", relativo, "C:rel" e "\raiz" ficam de fora, e um par de
// aspas em volta da entrada sai no win32, como o próprio Windows faz. Devolve
// o caminho ou null. Nunca lança.
export function acharCode({ pathEnv = process.env.PATH, plataforma = process.platform, existe = existePadrao } = {}) {
  try {
    if (typeof pathEnv !== 'string' || typeof existe !== 'function') return null;
    const win = plataforma === 'win32';
    const nome = win ? 'code.cmd' : 'code';
    const caminhos = win ? path.win32 : path.posix;
    for (const cru of pathEnv.split(win ? ';' : ':')) {
      let dir = cru;
      if (win && dir.length >= 2 && dir.startsWith('"') && dir.endsWith('"')) dir = dir.slice(1, -1);
      if (dir === '' || dir.includes('\0') || !absolutoCompleto(dir)) continue;
      const candidato = caminhos.join(dir, nome);
      if (existe(candidato) === true) return candidato;
    }
    return null;
  } catch {
    return null;
  }
}

// Caminho que pode ir para a linha do cmd.exe ou para o execFile: a lista de
// caracteres do instalador da barra (caminhoAceito, de configuracao.js) e, no
// win32, também \ (o separador de lá). Qualquer outro caractere: false.
// Nunca lança.
export function caminhoSeguro(p, plataforma = process.platform) {
  try {
    if (typeof p !== 'string' || p.length === 0) return false;
    return caminhoAceito(plataforma === 'win32' ? p.replaceAll('\\', '/') : p);
  } catch {
    return false;
  }
}

// Versão do plugin em <raiz>/.claude-plugin/plugin.json, só no formato N.N.N;
// senão null. Nunca lança.
export function versaoDoPlugin(raizPlugin) {
  try {
    if (!dirValido(raizPlugin)) return null;
    const lido = lerJson(path.join(raizPlugin, '.claude-plugin', 'plugin.json'), MAX_PLUGIN_JSON_BYTES);
    if (!lido.ok || !ehObjeto(lido.valor)) return null;
    const { version } = lido.valor;
    return versaoValida(version) ? version : null;
  } catch {
    return null;
  }
}

// A extensão precisa ser instalada: instalado.json não tem esta `versao` e não
// houve tentativa (tentativa.json) há menos de TENTATIVA_MS. Arquivo ausente
// ou estragado conta como sem registro. Argumento inválido: false (não
// instala). Nunca lança.
export function precisaInstalar(opcoes) {
  try {
    if (!ehObjeto(opcoes)) return false;
    const { dir, versao, agoraMs } = opcoes;
    if (!dirValido(dir) || !versaoValida(versao) || !agoraValido(agoraMs)) return false;
    const pasta = path.join(dir, DIR_PAINEL);
    const instalado = lerJson(path.join(pasta, ARQ_INSTALADO), MAX_REGISTRO_BYTES);
    if (instalado.ok && ehObjeto(instalado.valor) && instalado.valor.versao === versao) return false;
    const tentativa = lerJson(path.join(pasta, ARQ_TENTATIVA), MAX_REGISTRO_BYTES);
    if (tentativa.ok && ehObjeto(tentativa.valor)) {
      const em = instante(tentativa.valor.em, agoraMs);
      if (em !== null && agoraMs - em < TENTATIVA_MS) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Grava tentativa.json { em } com o instante `agoraMs`. { ok: true } ou
// { ok: false, motivo }. Nunca lança.
export function marcarTentativa(opcoes) {
  try {
    if (!ehObjeto(opcoes)) return falha('argumentos');
    const { dir, agoraMs } = opcoes;
    if (!dirValido(dir) || !agoraValido(agoraMs)) return falha('argumentos');
    const r = gravarJsonAtomico(path.join(dir, DIR_PAINEL, ARQ_TENTATIVA), { em: new Date(agoraMs).toISOString() });
    return r.ok ? { ok: true } : falha('escrita');
  } catch {
    return falha('escrita');
  }
}

// Texto UTF-8 de um arquivo regular do plugin, até MAX_FONTE_BYTES; senão null.
function lerFonte(arquivo) {
  try {
    const info = fs.statSync(arquivo);
    if (!info.isFile() || info.size > MAX_FONTE_BYTES) return null;
    const bytes = fs.readFileSync(arquivo);
    return bytes.length <= MAX_FONTE_BYTES && isUtf8(bytes) ? bytes.toString('utf8') : null;
  } catch {
    return null;
  }
}

// Escrita atômica de bytes: temporário de nome sorteado criado com 'wx' na
// mesma pasta e rename, com a política de retentativa de base.js. Falhou: o
// temporário sai e o destino antigo fica. Devolve true ou false.
function gravarBytes(arquivo, bytes) {
  const tmp = `${arquivo}.${crypto.randomBytes(TMP_BYTES).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, bytes, { flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') apagar(tmp);
    return false;
  }
  for (let tentativa = 1; tentativa <= RENOMEAR_TENTATIVAS; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      return true;
    } catch (e) {
      if (!renomearDeNovo(e, tentativa)) break;
      esperar(RENOMEAR_ESPERA_MS);
    }
  }
  apagar(tmp);
  return false;
}

// Roda o CLI do VS Code por `executar` (a assinatura do execFile) e resolve
// 'ok', 'tempo' (morto pelo prazo) ou 'erro'. Nunca rejeita, também quando
// `executar` lança.
function rodar(executar, exe, args, opcoes) {
  return new Promise((resolve) => {
    try {
      executar(exe, args, opcoes, (erro) => {
        try {
          if (!erro) resolve('ok');
          else resolve(erro.killed === true || typeof erro.signal === 'string' || erro.code === 'ETIMEDOUT' ? 'tempo' : 'erro');
        } catch {
          resolve('erro');
        }
      });
    } catch {
      resolve('erro');
    }
  });
}

// Instala a extensão do painel (os passos no topo do arquivo). Motivos:
// 'sem-pasta', 'argumentos', 'escrita', 'plugin-invalido', 'extensao-invalida',
// 'sem-vscode', 'caminho-inseguro', 'tempo' e 'erro'; sucesso é
// { ok: true, motivo: 'ok' }. `achar`, `executar`, `plataforma`, `pathEnv` e
// `existe` existem para os testes. Nunca rejeita.
export async function instalarPainel(opcoes) {
  try {
    const {
      dir, raizPlugin, agoraMs = Date.now(), achar = acharCode, executar = executarPadrao,
      plataforma = process.platform, pathEnv = process.env.PATH, existe,
    } = ehObjeto(opcoes) ? opcoes : {};
    if (!dirValido(dir)) return falha('sem-pasta');
    if (!agoraValido(agoraMs) || typeof achar !== 'function' || typeof executar !== 'function') return falha('argumentos');
    if (!marcarTentativa({ dir, agoraMs }).ok) return falha('escrita');
    const versao = versaoDoPlugin(raizPlugin);
    if (versao === null) return falha('plugin-invalido');
    const packageJson = lerFonte(path.join(raizPlugin, 'vscode', 'package.json'));
    const extensionCjs = lerFonte(path.join(raizPlugin, 'vscode', 'extension.cjs'));
    const bytes = packageJson === null || extensionCjs === null ? null : montarVsix({ versao, packageJson, extensionCjs });
    if (bytes === null) return falha('extensao-invalida');
    const pasta = path.join(dir, DIR_PAINEL);
    const vsix = path.join(pasta, `${ID_EXTENSAO}-${versao}.vsix`);
    if (!gravarBytes(vsix, bytes)) return falha('escrita');
    varrerTmpVelhos(pasta, (nome) => TMP_VSIX.test(nome));
    const code = achar({ pathEnv, plataforma, existe });
    if (typeof code !== 'string' || code.length === 0) return falha('sem-vscode');
    // O `code` segue a regra da plataforma pedida; o .vsix, a do processo, que
    // montou o caminho com path.join (as duas são a mesma fora dos testes).
    const caminhos = plataforma === 'win32' ? path.win32 : path.posix;
    if (!caminhos.isAbsolute(code) || !caminhoSeguro(code, plataforma) || !caminhoSeguro(vsix)) return falha('caminho-inseguro');
    const r = plataforma === 'win32'
      ? await rodar(executar, 'cmd.exe', ['/d', '/s', '/c', `""${code}" --install-extension "${vsix}" --force"`], {
        windowsVerbatimArguments: true, windowsHide: true, timeout: PRAZO_INSTALAR_MS, cwd: pasta,
      })
      : await rodar(executar, code, ['--install-extension', vsix, '--force'], { timeout: PRAZO_INSTALAR_MS, cwd: pasta });
    if (r !== 'ok') return falha(r);
    const g = gravarJsonAtomico(path.join(pasta, ARQ_INSTALADO), { versao, em: new Date(agoraMs).toISOString() });
    return g.ok ? { ok: true, motivo: 'ok' } : falha('escrita');
  } catch {
    return falha('erro');
  }
}

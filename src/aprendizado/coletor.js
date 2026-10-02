import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { RENOMEAR_ESPERA_MS, RENOMEAR_TENTATIVAS, apagar, esperar, fechar, numeroFinito, renomearDeNovo, varrerTmpVelhos } from '../base.js';
import { gravarJsonAtomico } from '../estado.js';
import { lerSemLink, lerTextoSemLink } from '../guarda/arquivo.js';
import { RAM_MIN_BYTES } from '../uso/painel.js';
import { TETO, caminhos } from './arquivos.js';
import { configColetor } from './config-coletor.js';
import { ARQ_TELEMETRIA } from './otlp.js';

// Vida do Collector (spec aprendizado §3.3). É o ÚNICO módulo do aprendizado
// com processo filho (test/aprendizado-fronteiras.test.js): tar (R12),
// tasklist/ps, taskkill e o próprio Collector. No Windows, tudo do System32
// por caminho absoluto, como matarArvore em src/uso/oficial.js. O Collector
// sobe desanexado, sem janela, sem herdar o ambiente (só a lista de
// AMBIENTE_PERMITIDO, mais o GOMEMLIMIT fixo: nada de OTEL_* nem segredo),
// com o stderr no otel/coletor.log, que é só classificado (R6), nunca
// repetido. O PID é conferido pelo nome do processo antes de matar; uma
// consulta que falha (tasklist ou ps sem resposta) nunca vale como "morto":
// nada é morto, nada sobe e o arquivo de PID fica. Nenhuma função lança.

export const NOME_BINARIO = Object.freeze({ win32: 'otelcol-contrib.exe', posix: 'otelcol-contrib' });
// Emenda A2: o membro do .tar.gz (na raiz, com o nome do binário).
export const MEMBRO_TAR = NOME_BINARIO;
// Emenda 2026-10-01: a mensagem do Collector com a porta ocupada. No Windows
// em português ela sai localizada ("listen tcp 127.0.0.1:47318: bind:
// Normalmente é permitida apenas uma utilização de cada endereço de soquete
// (...)"); o "listen tcp ...: bind:" do Go casa em qualquer idioma.
export const PORTA_OCUPADA = /address already in use|only one usage of each socket address|listen tcp \S+: bind:/i;
const FALHOU = /\b(?:error|panic|fatal)\b/i;
// Emenda A3: true se o Claude Code atrasa ou mostra erro com o endpoint fora
// do ar; então o SessionEnd não para o Collector enquanto houver sessão
// conhecida (24 h, o teto de sessão de estado.json). Medido: não atrapalha.
export const A3_ATRAPALHA = false;
export const ORFAO_MS = 30 * 60_000;
export const OUTRA_SESSAO_MS = A3_ATRAPALHA ? 24 * 3_600_000 : 5 * 60_000;
// Emenda 2026-10-01: os 108 MiB parados (portão de 120 MiB) foram medidos com
// este limite do runtime do Go. Vai fixo no ambiente do Collector; o valor do
// ambiente do usuário nunca passa.
const MEMORIA_GO = '96MiB';
const SUBINDO_VENCIDA_MS = 60_000;
const LOG_LIDO_MAX = 64 * 1024;
// Cabe com o download (PRAZO_MS de baixar.js, 450 s) nos 600 s do hook.
const EXTRAIR_PRAZO_MS = 120_000;
// O SessionStart e o SessionEnd têm 5 s (hooks/hooks.json), e a consulta, o
// taskkill e o passo de aprendizado precisam caber neles (Task 12). Um
// tasklist que passa disso vira consulta sem resposta: nada é feito nesta
// sessão, e a próxima tenta de novo.
const CONSULTA_PRAZO_MS = 1_500;
const PEDACO = 1024 * 1024;
const AMBIENTE_PERMITIDO = Object.freeze(['SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'TZ']);
const WINDOWS = Object.freeze(['tar', 'tasklist', 'taskkill']);
const POSIX = Object.freeze({ tar: Object.freeze(['/usr/bin/tar', '/bin/tar']), ps: Object.freeze(['/bin/ps', '/usr/bin/ps']) });
// O .tar.gz vai ao tar só pelo nome, relativo a otel/bin: sem espaço, acento,
// separador nem hífen na frente (que o tar leria como opção).
const TAR_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.tar\.gz$/;
const SHA256 = /^[0-9a-f]{64}$/;
// Sobras de uma retomada da trava interrompida e de uma gravação da config
// interrompida, varridas depois de 1 h (varrerTmpVelhos).
const SUBINDO_VELHA = /^subindo\.lock\.[0-9a-f]{32}\.velha$/;
const CONFIG_TMP = /^config\.yaml\.\d{1,10}\.\d{1,15}\.\d{1,10}\.tmp$/;

const ehWin = (plataforma) => plataforma === 'win32';
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nomeBinario = (plataforma) => (ehWin(plataforma) ? NOME_BINARIO.win32 : NOME_BINARIO.posix);
const membro = (plataforma) => (ehWin(plataforma) ? MEMBRO_TAR.win32 : MEMBRO_TAR.posix);
const falhaExtrair = () => ({ ok: false, motivo: 'extrair' });

export function caminhoBinario(dir, plataforma = process.platform) {
  return typeof dir === 'string' ? path.join(caminhos(dir).bin, nomeBinario(plataforma)) : null;
}

function raizWindows(systemRoot) {
  return typeof systemRoot === 'string' && /^[A-Za-z]:[\\/]/.test(systemRoot) && !systemRoot.includes('\0') ? systemRoot : 'C:\\Windows';
}

function regular(arquivo) {
  try {
    return fs.lstatSync(arquivo, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

export function programa(nome, opcoes) {
  try {
    const { plataforma = process.platform, systemRoot = process.env.SystemRoot } = opcoes ?? {};
    if (ehWin(plataforma)) return WINDOWS.includes(nome) ? path.win32.join(raizWindows(systemRoot), 'System32', `${nome}.exe`) : null;
    if (typeof nome !== 'string' || !Object.hasOwn(POSIX, nome)) return null;
    return POSIX[nome].find(regular) ?? POSIX[nome][0];
  } catch {
    return null;
  }
}

// SHA-256 em hexadecimal, lido em pedaços de 1 MiB (o binário tem 367 MiB);
// null quando não dá para ler.
export function hashArquivo(arquivo) {
  let fd = null;
  try {
    fd = fs.openSync(arquivo, 'r');
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(PEDACO);
    let n;
    while ((n = fs.readSync(fd, buf, 0, PEDACO, null)) > 0) h.update(buf.subarray(0, n));
    return h.digest('hex');
  } catch {
    return null;
  } finally {
    if (fd !== null) fechar(fd);
  }
}

// Tamanho e mtime pelo descritor (fstat), nunca pela listagem: no Windows a
// entrada da pasta pode ficar velha enquanto outro processo segura o arquivo
// aberto (Emenda 2026-10-01).
function fotoDe(arquivo) {
  let fd = null;
  try {
    fd = fs.openSync(arquivo, 'r');
    const s = fs.fstatSync(fd);
    return s.isFile() ? { tamanho: s.size, mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fechar(fd);
  }
}

// R7: o hash do binário extraído, com o tamanho e o mtime, para conferir de
// novo só quando um deles mudar.
export function registrarInstalacao(dir, plataforma = process.platform, hashar = hashArquivo) {
  try {
    const bin = caminhoBinario(dir, plataforma);
    if (bin === null || !regular(bin)) return { ok: false };
    const foto = fotoDe(bin);
    if (foto === null) return { ok: false };
    const sha256 = hashar(bin);
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return { ok: false };
    return { ok: gravarJsonAtomico(caminhos(dir).instalado, { v: 1, sha256, tamanho: foto.tamanho, mtimeMs: foto.mtimeMs }).ok };
  } catch {
    return { ok: false };
  }
}

// R12: o tar do sistema, com cwd em otel/bin e só o membro fixado (nomes
// relativos; nenhum caminho com acento ou espaço vai nos argumentos). O
// binário anterior sai antes; se o tar falha ou não deixa um arquivo regular,
// nada fica no lugar.
export function extrairColetor(opcoes) {
  let bin = null;
  try {
    const { dir, tarGz, plataforma = process.platform, executar = execFileSync, systemRoot = process.env.SystemRoot } = opcoes ?? {};
    if (typeof dir !== 'string' || typeof tarGz !== 'string') return falhaExtrair();
    const pasta = caminhos(dir).bin;
    const nomeTar = path.basename(tarGz);
    if (!TAR_VALIDO.test(nomeTar) || path.dirname(path.resolve(tarGz)) !== path.resolve(pasta)) return falhaExtrair();
    const tar = programa('tar', { plataforma, systemRoot });
    if (tar === null) return falhaExtrair();
    fs.mkdirSync(pasta, { recursive: true });
    bin = caminhoBinario(dir, plataforma);
    apagar(bin);
    executar(tar, ['-xzf', nomeTar, membro(plataforma)], {
      cwd: pasta, windowsHide: true, timeout: EXTRAIR_PRAZO_MS, stdio: 'ignore',
    });
    if (!regular(bin)) {
      apagar(bin);
      return falhaExtrair();
    }
    if (!ehWin(plataforma)) fs.chmodSync(bin, 0o755);
    if (!registrarInstalacao(dir, plataforma).ok) {
      apagar(bin);
      return falhaExtrair();
    }
    return { ok: true };
  } catch {
    if (bin !== null) apagar(bin);
    return falhaExtrair();
  }
}

export function conferirIntegridade(dir, opcoes) {
  try {
    const { plataforma = process.platform, hashar = hashArquivo } = opcoes ?? {};
    const bin = caminhoBinario(dir, plataforma);
    if (bin === null || !regular(bin)) return { ok: false, motivo: 'coletor-ausente' };
    const c = caminhos(dir);
    const l = lerSemLink(c.instalado, TETO.instalado);
    const inst = l.ok ? l.valor : null;
    if (!ehObjeto(inst) || inst.v !== 1 || typeof inst.sha256 !== 'string' || !SHA256.test(inst.sha256)) {
      return { ok: false, motivo: 'coletor-hash' };
    }
    const foto = fotoDe(bin);
    if (foto === null) return { ok: false, motivo: 'coletor-hash' };
    if (inst.tamanho === foto.tamanho && inst.mtimeMs === foto.mtimeMs) return { ok: true };
    if (hashar(bin) !== inst.sha256) return { ok: false, motivo: 'coletor-hash' };
    gravarJsonAtomico(c.instalado, { v: 1, sha256: inst.sha256, tamanho: foto.tamanho, mtimeMs: foto.mtimeMs });
    return { ok: true };
  } catch {
    return { ok: false, motivo: 'coletor-hash' };
  }
}

export function lerPid(dir) {
  try {
    const l = lerSemLink(caminhos(dir).pid, TETO.pid);
    const v = l.ok ? l.valor : null;
    if (!ehObjeto(v) || v.v !== 1 || !Number.isSafeInteger(v.pid) || v.pid <= 0) return null;
    const emMs = typeof v.em === 'string' && v.em.length <= 64 ? Date.parse(v.em) : Number.NaN;
    return { pid: v.pid, emMs: numeroFinito(emMs) ? emMs : null };
  } catch {
    return null;
  }
}

// { ok: true, nome } quando o tasklist ou o ps respondeu (nome null = nenhum
// processo com esse PID); { ok: false } quando não deu para saber (prazo,
// programa ausente, erro). O ps sai com 1 e nada no stdout quando o PID não
// existe (procps e BSD); o tasklist sai com 0 e uma linha "INFO" localizada.
// O stdio é explícito: sem ele, o execFileSync repete o stderr do filho no
// stderr do hook (revisão da Task 8).
function consultarNome(pid, opcoes) {
  try {
    const { plataforma = process.platform, executar = execFileSync, systemRoot = process.env.SystemRoot } = opcoes ?? {};
    if (!Number.isSafeInteger(pid) || pid <= 0) return { ok: true, nome: null };
    if (ehWin(plataforma)) {
      const saida = String(executar(programa('tasklist', { plataforma, systemRoot }), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true, timeout: CONSULTA_PRAZO_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }));
      for (const linha of saida.split(/\r?\n/)) {
        const m = /^"([^"]{1,260})","(\d{1,10})"/.exec(linha.trim());
        if (m && Number(m[2]) === pid) return { ok: true, nome: m[1] };
      }
      return { ok: true, nome: null };
    }
    let saida;
    try {
      saida = String(executar(programa('ps', { plataforma }), ['-p', String(pid), '-o', 'comm='], {
        timeout: CONSULTA_PRAZO_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      })).trim();
    } catch (e) {
      return e?.status === 1 && String(e?.stdout ?? '').trim() === '' ? { ok: true, nome: null } : { ok: false };
    }
    return { ok: true, nome: saida === '' ? null : path.posix.basename(saida) };
  } catch {
    return { ok: false };
  }
}

export function nomeDoProcesso(pid, opcoes) {
  const r = consultarNome(pid, opcoes);
  return r.ok ? r.nome : null;
}

const ehColetor = (nome, plataforma) => typeof nome === 'string' && (ehWin(plataforma) ? nome.toLowerCase() === NOME_BINARIO.win32 : nome === NOME_BINARIO.posix);

// { vivo, pid, emMs }; quando o tasklist ou o ps não respondeu, vem também
// `consulta: 'falhou'` (vivo: false sem saber): quem chama não apaga o PID nem
// trata o Collector como morto ou órfão por isso (Tasks 10 e 12).
export function coletorVivo(dir, opcoes) {
  try {
    const p = lerPid(dir);
    if (p === null) return { vivo: false, pid: null, emMs: null };
    const plataforma = opcoes?.plataforma ?? process.platform;
    const q = consultarNome(p.pid, opcoes);
    if (!q.ok) return { vivo: false, pid: p.pid, emMs: p.emMs, consulta: 'falhou' };
    return { vivo: ehColetor(q.nome, plataforma), pid: p.pid, emMs: p.emMs };
  } catch {
    return { vivo: false, pid: null, emMs: null };
  }
}

// R6: o fim do log da subida anterior (até 64 KiB), só classificado. Lido
// pelo conteúdo: o início do trecho vem do fstat do descritor e a leitura vai
// até o fim de verdade, sem confiar no tamanho da listagem (Emenda
// 2026-10-01: no Windows ela mostra 0 enquanto o processo escreve).
export function classificarLog(dir) {
  let fd = null;
  try {
    const arq = caminhos(dir).log;
    if (!regular(arq)) return null;
    fd = fs.openSync(arq, 'r');
    const inicio = Math.max(0, fs.fstatSync(fd).size - LOG_LIDO_MAX);
    const buf = Buffer.alloc(LOG_LIDO_MAX);
    let n = 0;
    while (n < LOG_LIDO_MAX) {
      const lido = fs.readSync(fd, buf, n, LOG_LIDO_MAX - n, inicio + n);
      if (lido <= 0) break;
      n += lido;
    }
    const texto = buf.subarray(0, n).toString('utf8');
    if (PORTA_OCUPADA.test(texto)) return 'porta-ocupada';
    return FALHOU.test(texto) ? 'coletor-falhou' : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fechar(fd);
  }
}

let sequenciaTmp = 0;

// Temporário com 'wx' e rename por cima, com a política de rename de base.js.
function gravarTextoAtomico(arquivo, texto) {
  const tmp = `${arquivo}.${process.pid}.${Date.now()}.${sequenciaTmp++}.tmp`;
  try {
    fs.writeFileSync(tmp, texto, { flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') apagar(tmp);
    return { ok: false };
  }
  for (let tentativa = 1; tentativa <= RENOMEAR_TENTATIVAS; tentativa++) {
    try {
      fs.renameSync(tmp, arquivo);
      varrerTmpVelhos(path.dirname(arquivo), (nome) => CONFIG_TMP.test(nome));
      return { ok: true };
    } catch (e) {
      if (!renomearDeNovo(e, tentativa)) break;
      esperar(RENOMEAR_ESPERA_MS);
    }
  }
  apagar(tmp);
  return { ok: false };
}

// §3.2 passo 3: gerada pelo hadouken e regravada a cada subida.
export function gravarConfig(dir) {
  try {
    const c = caminhos(dir);
    fs.mkdirSync(c.otel, { recursive: true });
    const r = configColetor({ arquivoTelemetria: path.join(c.otel, ARQ_TELEMETRIA) });
    return r.ok ? gravarTextoAtomico(c.config, r.texto) : { ok: false };
  } catch {
    return { ok: false };
  }
}

// Só as variáveis da lista, uma vez cada (no Windows o process.env não
// distingue caixa: SystemRoot e SYSTEMROOT são a mesma), mais o GOMEMLIMIT
// fixo.
function ambienteColetor(env) {
  const r = { GOMEMLIMIT: MEMORIA_GO };
  const vistos = new Set(['gomemlimit']);
  for (const k of AMBIENTE_PERMITIDO) {
    let v;
    try {
      v = env?.[k];
    } catch {
      v = undefined;
    }
    if (typeof v !== 'string' || v.includes('\0') || vistos.has(k.toLowerCase())) continue;
    vistos.add(k.toLowerCase());
    r[k] = v;
  }
  return r;
}

// ------------------------------------------------------------ trava de subida

const novoToken = () => crypto.randomBytes(16).toString('hex');
const subindoVencida = (info) => info.isFile() && Date.now() - info.mtimeMs >= SUBINDO_VENCIDA_MS;

// Retoma a trava vencida como _retomarTravaVencida de registro.js: renomeia
// para um nome único e só então confere, já no nome novo, que ainda está
// vencida. Duas subidas que viram a mesma trava vencida: a primeira leva no
// rename; a segunda perde o rename (ENOENT) e não apaga nada, ou chega depois
// de a primeira já ter criado a trava nova e a leva no rename. Nesse caso a
// trava levada não está vencida: volta para o lugar por link, que nunca
// sobrescreve, e o nome único sai. Devolve true só quando apagou uma trava
// vencida. Exportada com _ só para o teste. Nunca lança.
export function _retomarSubindoVencida(arq) {
  const velha = `${arq}.${novoToken()}.velha`;
  try {
    fs.renameSync(arq, velha);
  } catch {
    return false;
  }
  try {
    const info = fs.lstatSync(velha);
    if (subindoVencida(info)) {
      apagar(velha);
      varrerTmpVelhos(path.dirname(arq), (nome) => SUBINDO_VELHA.test(nome));
      return true;
    }
    if (!info.isFile()) {
      fs.renameSync(velha, arq);
      return false;
    }
    try {
      fs.linkSync(velha, arq);
    } catch (e) {
      // Sem link no sistema de arquivos: volta pelo rename, se o nome ainda
      // estiver livre. Com EEXIST, uma terceira subida já criou a dela.
      if (e?.code !== 'EEXIST' && !fs.existsSync(arq)) fs.renameSync(velha, arq);
    }
    apagar(velha);
  } catch {
    /* melhor esforço */
  }
  return false;
}

// otel/subindo.lock criado com 'wx', com um token aleatório do dono no
// conteúdo; vencida (mais de 60 s pelo mtime) é de uma subida morta e é
// retomada. Devolve o token, ou null quando outra subida está no meio.
function pegarSubindo(arq) {
  const token = novoToken();
  for (let i = 0; i < 2; i++) {
    let fd;
    try {
      fd = fs.openSync(arq, 'wx');
    } catch (e) {
      if (e?.code !== 'EEXIST') return null;
      let info;
      try {
        info = fs.lstatSync(arq);
      } catch {
        continue; // sumiu entre o open e o lstat: tenta de novo
      }
      if (!subindoVencida(info)) return null;
      _retomarSubindoVencida(arq);
      continue;
    }
    try {
      fs.writeSync(fd, token);
    } catch {
      fechar(fd);
      apagar(arq);
      return null;
    }
    fechar(fd);
    return token;
  }
  return null;
}

// Solta só a trava com o token deste dono: uma subida lenta cuja trava venceu
// e foi retomada não solta a da outra.
function soltarSubindo(arq, token) {
  try {
    const l = lerTextoSemLink(arq, 1024);
    if (l.ok && l.texto === token) apagar(arq);
  } catch {
    /* fica para a retomada */
  }
}

function instanteIso(agoraMs) {
  const d = new Date(numeroFinito(agoraMs) ? agoraMs : Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// §3.3 SessionStart, sob a trava otel/subindo.lock (Foco de revisão 3: duas
// sessões juntas sobem um só Collector, e a segunda nunca tenta a porta).
export function subirColetor(opcoes) {
  let evento = null;
  let trava = null;
  let token = null;
  try {
    const {
      dir, agoraMs, plataforma = process.platform, memLivre = os.freemem, env = process.env,
      gerar = spawn, executar = execFileSync, systemRoot = process.env.SystemRoot, hashar = hashArquivo,
    } = opcoes ?? {};
    if (typeof dir !== 'string') return { ok: false, motivo: 'erro', evento };
    const c = caminhos(dir);
    fs.mkdirSync(c.otel, { recursive: true });
    token = pegarSubindo(c.subindo);
    if (token === null) return { ok: false, motivo: 'subindo', evento };
    trava = c.subindo;
    const anterior = lerPid(dir);
    if (anterior !== null) {
      const q = consultarNome(anterior.pid, { plataforma, executar, systemRoot });
      // Sem resposta, não dá para saber se o Collector está de pé: subir outro
      // arriscaria a porta e apagaria o PID do que talvez esteja vivo.
      if (!q.ok) return { ok: false, motivo: 'erro', evento };
      if (ehColetor(q.nome, plataforma)) return { ok: false, motivo: 'vivo', evento };
      evento = classificarLog(dir);
      apagar(c.pid);
    }
    let livre;
    try {
      livre = memLivre();
    } catch {
      livre = Number.NaN;
    }
    if (!numeroFinito(livre) || livre < RAM_MIN_BYTES) return { ok: false, motivo: 'pouca-ram', evento };
    const integ = conferirIntegridade(dir, { plataforma, hashar });
    if (!integ.ok) return { ok: false, motivo: integ.motivo, evento };
    if (!gravarConfig(dir).ok) return { ok: false, motivo: 'config', evento };
    const em = instanteIso(agoraMs);
    const ambiente = ambienteColetor(env);
    apagar(c.log);
    const fdLog = fs.openSync(c.log, 'wx');
    let filho;
    try {
      filho = gerar(caminhoBinario(dir, plataforma), ['--config', c.config], {
        detached: true, windowsHide: true, stdio: ['ignore', 'ignore', fdLog], env: ambiente, cwd: c.otel,
      });
    } finally {
      fechar(fdLog);
    }
    filho.on('error', () => { /* binário sumiu entre a conferência e o spawn: o próximo SessionStart vê pelo log */ });
    filho.unref();
    if (!Number.isSafeInteger(filho.pid) || filho.pid <= 0) return { ok: false, motivo: 'erro', evento };
    if (!gravarJsonAtomico(c.pid, { v: 1, pid: filho.pid, em }).ok) {
      // Sem o PID gravado, nenhum SessionEnd pararia este Collector: sai já.
      try {
        filho.kill();
      } catch {
        /* já saiu */
      }
      return { ok: false, motivo: 'erro', evento };
    }
    return { ok: true, pid: filho.pid, evento };
  } catch {
    return { ok: false, motivo: 'erro', evento };
  } finally {
    if (trava !== null) soltarSubindo(trava, token);
  }
}

// §3.3 SessionEnd: só mata o processo que tem o nome do Collector (um PID
// reaproveitado por outro programa nunca é morto). O arquivo de PID sai
// quando o Collector foi morto, já não existe ou o PID é de outro programa;
// fica quando a consulta falha ou o Collector continua de pé, para a próxima
// tentativa. `vivo`: o resultado do coletorVivo da mesma sessão; com o
// Collector vivo naquele mesmo PID, ele vale pela primeira consulta. Assim o
// pior caso de quem já consultou fica em 3 chamadas de CONSULTA_PRAZO_MS
// (coletorVivo, taskkill e a consulta depois do taskkill que falhou).
export function pararColetor(opcoes) {
  try {
    const {
      dir, plataforma = process.platform, executar = execFileSync, systemRoot = process.env.SystemRoot,
      matar = (pid, sinal) => process.kill(pid, sinal), vivo = null,
    } = opcoes ?? {};
    if (typeof dir !== 'string') return { ok: false, motivo: 'erro' };
    const p = lerPid(dir);
    if (p === null) return { ok: true, motivo: 'sem-pid' };
    const arqPid = caminhos(dir).pid;
    const consulta = { plataforma, executar, systemRoot };
    const jaVivo = vivo !== null && typeof vivo === 'object' && vivo.vivo === true && vivo.pid === p.pid;
    const q = jaVivo ? { ok: true, nome: nomeBinario(plataforma) } : consultarNome(p.pid, consulta);
    if (!q.ok) return { ok: false, motivo: 'erro' };
    if (q.nome === null) {
      apagar(arqPid);
      return { ok: true, motivo: 'morto' };
    }
    if (!ehColetor(q.nome, plataforma)) {
      apagar(arqPid);
      return { ok: false, motivo: 'outro-processo' };
    }
    try {
      if (ehWin(plataforma)) {
        executar(programa('taskkill', { plataforma, systemRoot }), ['/pid', String(p.pid), '/t', '/f'], {
          windowsHide: true, timeout: CONSULTA_PRAZO_MS, stdio: 'ignore',
        });
      } else {
        matar(p.pid, 'SIGTERM');
      }
    } catch {
      // O processo pode ter saído entre a consulta e a morte.
      const deNovo = consultarNome(p.pid, consulta);
      if (!deNovo.ok || ehColetor(deNovo.nome, plataforma)) return { ok: false, motivo: 'erro' };
      apagar(arqPid);
      return { ok: true, motivo: 'morto' };
    }
    apagar(arqPid);
    return { ok: true, motivo: 'parado' };
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

// §3.3: vivo sem sessão por mais de 30 min, contando da subida ou da última
// outra sessão, o que for mais novo.
export function ehOrfao(opcoes) {
  try {
    const { emMs, ultimaOutraSessaoMs, agoraMs } = opcoes ?? {};
    const ref = Math.max(numeroFinito(emMs) ? emMs : 0, numeroFinito(ultimaOutraSessaoMs) ? ultimaOutraSessaoMs : 0);
    return numeroFinito(agoraMs) && agoraMs - ref > ORFAO_MS;
  } catch {
    return false;
  }
}

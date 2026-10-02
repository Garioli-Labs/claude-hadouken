import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apagar, esperar as esperarMs } from '../base.js';
import { gravarJsonAtomico } from '../estado.js';
import { ARQ_OTEL, caminhos, ligadoExiste } from './arquivos.js';
import { baixarColetor, FIXADO, plataformaAtual, PRAZO_MS, TAMANHO_MAX, urlDoColetor, VERSAO_COLETOR } from './baixar.js';
import {
  A3_ATRAPALHA, coletorSaiu, conferirIntegridade, extrairColetor, gravarConfig, lerPid, pararColetor, subirColetor,
} from './coletor.js';
import { HOST, PORTA } from './config-coletor.js';
import { apagarLigado, gravarLigado, lerLigado, pegarTrava } from './registro.js';
import { aplicarDesligar, aplicarLigar, CHAVES_LIGAR, consultarDesligar, consultarLigar } from './settings-env.js';

// O `ligar` e o `desligar` (spec aprendizado §3.2 e `desligar`). Dois tempos
// (R4): a prévia só lê e devolve o plano e um código de 8 hex; o `ligar
// <código>` refaz a prévia e só segue se o código bate, isto é, se nem o
// settings.json nem o plano mudaram. A ordem do ligar deixa tudo como estava
// em qualquer falha: baixa e confere o hash (baixar.js), extrai e apaga o
// .tar.gz (coletor.js, R7), gera a configuração, grava otel/ligado.json (R8,
// o que o desligar tira) e só então o `env` do settings.json (settings-env.js);
// o par final (ligado.json e env) roda sob a trava do aprendizado, a mesma do
// desligar e do passo. Se o settings.json falha, o ligado.json sai e o
// Collector que este ligar subiu é parado (voltarAtras). O desligar também
// tem prévia (previaDesligar, §6 última linha): com o `esperado` dela, um
// settings.json que mudou no meio dá 'settings-mudou' antes de qualquer
// outro efeito. Rede e processo filho
// ficam nos módulos de fronteira; este só os chama. Argumentos com as regras
// de settings-env.js: pasta e arquivo absolutos, agoraMs inteiro seguro não
// negativo; fora disso, 'argumentos' sem tocar em nada. Nenhuma função lança.

const ALCANCES = Object.freeze(['nada', 'dados', 'tudo']);
const DADOS = Object.freeze(['aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos']);
// Sobras de um ligar que o timeout do hook (600 s, R5) cortou no meio, sem
// rodar o finally: o .parte do download e o .tar.gz da extração. Um ligar
// vivo nunca tem um .parte mais velho que o prazo do download, e o .tar.gz
// dele só existe durante a extração (120 s); o corte é o próprio timeout do
// hook, então nada de um ligar vivo sai.
const SOBRA = /\.(?:parte|tar\.gz)$/;
const SOBRA_VELHA_MS = PRAZO_MS + 150_000;
const falha = (motivo, detalhe) => (detalhe === undefined ? { ok: false, motivo } : { ok: false, motivo, detalhe });
const caminhoValido = (a) => typeof a === 'string' && a.length > 0 && !a.includes('\0') && path.isAbsolute(a);
const agoraValido = (ms) => Number.isSafeInteger(ms) && ms >= 0;

function codigoDe(assinatura, plano) {
  return crypto.createHash('sha256').update(`${assinatura}\0${JSON.stringify(plano)}`).digest('hex').slice(0, 8);
}

export function previa(opcoes) {
  try {
    const {
      dir, arquivo, ambiente = process.env, plataforma = process.platform, arch = process.arch, integridade = conferirIntegridade,
    } = opcoes ?? {};
    if (!caminhoValido(dir)) return falha('argumentos');
    if (ligadoExiste(dir)) return falha('ja-ligado');
    const chave = plataformaAtual(plataforma, arch);
    if (chave === null) return falha('plataforma');
    const c = consultarLigar({ arquivo, ambiente });
    if (!c.ok) return c;
    const plano = {
      versao: VERSAO_COLETOR,
      chave,
      url: urlDoColetor(chave),
      tamanhoMax: TAMANHO_MAX,
      host: HOST,
      porta: PORTA,
      pasta: caminhos(dir).otel,
      arquivo,
      adicionar: c.adicionar,
      criaEnv: c.criaEnv,
      // O conferirIntegridade (coletor.js) pode regravar o otel/bin/
      // instalado.json quando o tamanho ou o mtime do binário mudaram e o
      // hash ainda confere: a foto nova, com o mesmo sha256 (cache do R7).
      // É a única gravação possível da prévia, e não muda o que ela mostra.
      baixar: integridade(dir, { plataforma })?.ok !== true,
    };
    return { ok: true, plano, assinatura: c.assinatura, codigo: codigoDe(c.assinatura, plano) };
  } catch {
    return falha('erro-interno');
  }
}

// Só arquivo regular com um nome só (hard link: o unlink no Windows mexe no
// outro nome, base.js) e mais velho que o corte. Melhor esforço.
function varrerSobras(pasta) {
  let nomes;
  try {
    nomes = fs.readdirSync(pasta);
  } catch {
    return;
  }
  const corte = Date.now() - SOBRA_VELHA_MS;
  for (const nome of nomes) {
    if (!SOBRA.test(nome)) continue;
    try {
      const alvo = path.join(pasta, nome);
      const info = fs.lstatSync(alvo);
      if (info.isFile() && info.nlink === 1 && info.mtimeMs < corte) fs.unlinkSync(alvo);
    } catch {
      /* sumiu ou sem permissão: segue */
    }
  }
}

function existe(alvo) {
  try {
    return fs.lstatSync(alvo, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

// Os passos do ligar, em ordem. `feito` anota o que este ligar criou e a
// volta atrás desfaz: o .tar.gz, a trava, o ligado.json e o Collector.
async function passosDoLigar(o, feito) {
  const {
    dir, arquivo, codigo, agoraMs, ambiente = process.env, plataforma = process.platform, arch = process.arch,
    baixar = baixarColetor, extrair = extrairColetor, subir = subirColetor, parar = pararColetor, aplicar = aplicarLigar,
    integridade = conferirIntegridade, exigirColetor = A3_ATRAPALHA, opcoesBaixar = {}, executar, systemRoot,
  } = o;
  if (!agoraValido(agoraMs)) return falha('argumentos');
  const p = previa({ dir, arquivo, ambiente, plataforma, arch, integridade });
  if (!p.ok) return p;
  if (typeof codigo !== 'string' || codigo.toLowerCase() !== p.codigo) return falha('codigo');
  feito.dir = dir;
  const c = caminhos(dir);
  fs.mkdirSync(c.bin, { recursive: true });
  varrerSobras(c.bin);
  if (p.plano.baixar) {
    feito.tarGz = path.join(c.bin, FIXADO[p.plano.chave].arquivo);
    // Só o destino e a chave: URL, tamanho e hash são os fixados em baixar.js.
    const b = await baixar({ ...opcoesBaixar, destino: feito.tarGz, chave: p.plano.chave });
    if (b?.ok !== true) return falha('download', typeof b?.motivo === 'string' ? b.motivo : 'rede');
    const x = extrair({ dir, tarGz: feito.tarGz, plataforma, executar, systemRoot });
    if (x?.ok !== true) return falha('extrair');
  }
  if (gravarConfig(dir)?.ok !== true) return falha('config');
  // Emenda A3: se o Claude Code atrapalha com o endpoint fora do ar, o
  // Collector tem de estar de pé antes de o env entrar no settings.json.
  // 'vivo' é um Collector que já estava de pé: segue, e a volta atrás não o
  // para, porque não foi este ligar que o subiu. 'erro' (consulta sem
  // resposta) vira o detalhe, sem nova tentativa.
  if (exigirColetor) {
    const s = subir({ dir, agoraMs, plataforma, executar, systemRoot });
    if (s?.ok === true) feito.pararSubido = () => parar({ dir, plataforma, executar, systemRoot });
    else if (s?.motivo !== 'vivo') return falha('coletor', typeof s?.motivo === 'string' ? s.motivo : 'erro');
  }
  // O par final sob a trava do aprendizado (a do desligar e do passo): um
  // desligar ou outro ligar nunca cai entre o ligado.json e o env. Ocupada
  // (5 tentativas, registro.js): 'ocupado'; erro ao criá-la: 'escrita'.
  const t = pegarTrava(dir);
  if (!t.ok) return falha(t.motivo === 'ocupada' ? 'ocupado' : 'escrita');
  feito.trava = t;
  // Outro ligar com o mesmo código terminou durante o download: o
  // ligado.json é dele, e a volta atrás deste nunca o apaga.
  if (ligadoExiste(dir)) return falha('ja-ligado');
  const chaves = Object.fromEntries(p.plano.adicionar.map((k) => [k, CHAVES_LIGAR[k]]));
  if (gravarLigado(dir, { chaves, criouEnv: p.plano.criaEnv }, agoraMs)?.ok !== true) return falha('escrita');
  // Só depois de gravado: o que estava no lugar de um ligado.json que não
  // foi gravado não é deste ligar.
  feito.gravouLigado = true;
  const a = aplicar({ arquivo, agoraMs, ambiente, esperado: p.assinatura });
  if (a?.ok !== true) return typeof a?.motivo === 'string' ? a : falha('erro-interno');
  return { ok: true, plano: p.plano, backup: a.backup };
}

// A volta atrás de um ligar que não ligou, ainda sob a trava quando este
// ligar a tem. O ligado.json sai só se foi este ligar que o gravou; se ele
// fica (o unlink falhou), o resultado ganha `registroFicou: true`. O
// Collector que este ligar subiu é parado, com uma tentativa só e sem laço
// (o pararColetor que falha deixa o PID), exceto quando há um ligado.json
// válido que não é deste ligar: aí outro ligar ganhou ('ja-ligado', ou
// 'ocupado' com ele no meio) e pode estar usando este Collector, que recebeu
// como 'vivo'. Deixá-lo de pé é o lado seguro: com o ligado.json do outro, o
// SessionStart e o SessionEnd o acham pelo arquivo de PID.
function voltarAtras(r, feito) {
  let registroFicou = false;
  if (feito.gravouLigado) {
    apagarLigado(feito.dir);
    registroFicou = existe(caminhos(feito.dir).ligado);
  }
  if (feito.pararSubido !== null && (feito.gravouLigado || !ligadoExiste(feito.dir))) {
    try {
      feito.pararSubido();
    } catch {
      /* uma tentativa só */
    }
  }
  return registroFicou ? { ...r, registroFicou: true } : r;
}

export async function ligar(opcoes) {
  const feito = { dir: null, tarGz: null, trava: null, gravouLigado: false, pararSubido: null };
  let r;
  try {
    r = await passosDoLigar(opcoes ?? {}, feito);
  } catch {
    r = falha('erro-interno');
  }
  try {
    if (r?.ok !== true) r = voltarAtras(r, feito);
  } catch {
    /* fica o motivo dos passos */
  }
  try {
    feito.trava?.soltar();
  } catch {
    /* fica para a retomada da trava vencida */
  }
  if (feito.tarGz !== null) apagar(feito.tarGz);
  return r;
}

// Rodada 2 da revisão da Task 10 (medido no Windows 11: o `desligar tudo`
// deixava a otel/ inteira, e um Remove-Item segundos depois apagava): o
// taskkill /t /f volta antes de o processo sair e soltar o binário e o
// telemetria.jsonl. Duas defesas. (1) Depois de uma parada, o desligar
// consulta o PID a cada SAIDA_ESPERA_MS, no máximo SAIDA_CONSULTAS vezes
// (~5 s de espera mais as consultas, cada uma com o prazo do coletor.js), até
// o Collector sumir; consulta sem resposta para na hora. (2) Cada entrada é
// tentada até TIRAR_TENTATIVAS vezes, TIRAR_ESPERA_MS entre elas (~5 s), só
// nos erros de arquivo preso. A repetição é daqui, e não o maxRetries do
// rmSync: ele só vale com recursive (arquivo solto não repetiria) e espera
// cada vez mais. O hook do comando tem 600 s; o pior caso fica em segundos.
const SAIDA_CONSULTAS = 25;
const SAIDA_ESPERA_MS = 200;
const TIRAR_TENTATIVAS = 20;
const TIRAR_ESPERA_MS = 250;
const PRESO = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

// true só quando a consulta disse que o Collector saiu. Ainda de pé no fim,
// ou sem resposta: false, e o desligar o trata como vivo.
function esperarSaida(pid, saiu, esperar) {
  for (let i = 1; ; i++) {
    let s;
    try {
      s = saiu(pid);
    } catch {
      s = null;
    }
    if (s === true) return true;
    if (s !== false || i >= SAIDA_CONSULTAS) return false;
    esperar(SAIDA_ESPERA_MS);
  }
}

// Tira uma entrada sem seguir link: link e arquivo saem sozinhos; pasta de
// verdade sai inteira. Junção do Windows: o lstat a vê como link
// (isSymbolicLink, não isDirectory), então o rmSync sem recursive tira só a
// junção, nunca o alvo (medido no Node 24 e no Windows 11, com teste); se o
// rmSync falhar, o resultado é false, e o desligar devolve apagou: false, sem
// ter seguido o link. Arquivo preso (EBUSY, EPERM...) ou entrada que ainda
// aparece depois do rmSync (exclusão pendente no Windows): de novo, até
// TIRAR_TENTATIVAS vezes; outro erro desiste na hora.
function tirar(alvo, rm, esperar) {
  for (let i = 1; ; i++) {
    try {
      const info = fs.lstatSync(alvo, { throwIfNoEntry: false });
      if (!info) return true;
      rm(alvo, { recursive: info.isDirectory(), force: true });
      if (fs.lstatSync(alvo, { throwIfNoEntry: false }) === undefined) return true;
    } catch (e) {
      if (!PRESO.has(e?.code)) return false;
    }
    if (i >= TIRAR_TENTATIVAS) return false;
    esperar(TIRAR_ESPERA_MS);
  }
}

// true só quando tudo o que o alcance pede saiu. Com `vivo`, o Collector
// pode estar de pé (a parada não respondeu, ou ele não saiu no prazo): o
// arquivo de PID fica para o próximo SessionEnd ou SessionStart achá-lo
// (nunca se perde um Collector vivo) e o binário fica também em tudo (nunca
// se apaga o binário de um processo vivo); como eles não saíram, o resultado
// é false.
function apagarDados(dir, { tudo, vivo, rm, esperar }) {
  const c = caminhos(dir);
  const tira = (alvo) => tirar(alvo, rm, esperar);
  let ok = true;
  for (const k of DADOS) ok = tira(c[k]) && ok;
  let info;
  try {
    info = fs.lstatSync(c.otel, { throwIfNoEntry: false });
  } catch {
    return false;
  }
  if (!info) return ok;
  const fica = vivo && info.isDirectory();
  if (!info.isDirectory() || (tudo && !fica)) return tira(c.otel) && ok;
  let nomes;
  try {
    nomes = fs.readdirSync(c.otel);
  } catch {
    return false;
  }
  for (const nome of nomes) {
    if ((fica && (nome === ARQ_OTEL.pid || nome === ARQ_OTEL.bin)) || (nome === ARQ_OTEL.bin && !tudo)) continue;
    ok = tira(path.join(c.otel, nome)) && ok;
  }
  return ok && !fica;
}

// O Collector parado que não saiu no prazo: o arquivo de PID (que o
// pararColetor apagou) volta, para a próxima sessão tentar de novo
// (passo.js pararSemLigado). Só quando não há outro no lugar.
function devolverPid(dir, antes) {
  try {
    const arq = caminhos(dir).pid;
    if (existe(arq)) return;
    gravarJsonAtomico(arq, { v: 1, pid: antes.pid, em: antes.emMs === null ? null : new Date(antes.emMs).toISOString() });
  } catch {
    /* sem o PID, a pasta e o binário ficam assim mesmo (vivo) */
  }
}

// §6 última linha: o que o desligar vai tirar do `env`, com a assinatura dos
// bytes do settings.json para o `esperado` do desligar. Não grava nada.
// ligado.json ilegível: nada a tirar (remover vazio), como no desligar.
export function previaDesligar(opcoes) {
  try {
    const { dir, arquivo } = opcoes ?? {};
    if (!caminhoValido(dir)) return falha('argumentos');
    if (!ligadoExiste(dir)) return falha('desligado');
    const ligado = lerLigado(dir);
    const c = consultarDesligar({ arquivo, ligado });
    if (!c.ok) return c;
    return {
      ok: true, remover: c.remover, removeEnv: c.removeEnv, assinatura: c.assinatura, pasta: caminhos(dir).otel, ligadoInvalido: ligado === null,
    };
  } catch {
    return falha('erro-interno');
  }
}

export function desligar(opcoes) {
  const {
    dir, arquivo, agoraMs, apagar: alcance = 'nada', parar = pararColetor, plataforma = process.platform, executar, systemRoot, esperado,
    saiu = (pid) => coletorSaiu(pid, { plataforma, executar, systemRoot }), esperar = esperarMs, rm = fs.rmSync,
  } = opcoes ?? {};
  if (!ALCANCES.includes(alcance)) return falha('uso');
  if (!caminhoValido(dir) || !caminhoValido(arquivo) || !agoraValido(agoraMs)) return falha('argumentos');
  if (!ligadoExiste(dir) && alcance === 'nada') return falha('desligado');
  const t = pegarTrava(dir);
  if (!t.ok) return falha(t.motivo === 'ocupada' ? 'ocupado' : 'erro');
  try {
    // De novo sob a trava: outro desligar pode ter terminado entre a primeira
    // olhada e a trava, e o ligado.json que sumiu não é um ligado.json ilegível.
    const estavaLigado = ligadoExiste(dir);
    if (!estavaLigado && alcance === 'nada') return falha('desligado');
    let removidas = [];
    let backup = null;
    let ligadoInvalido = false;
    if (estavaLigado) {
      const l = lerLigado(dir);
      ligadoInvalido = l === null;
      // Com ligado.json ilegível nada sai do settings.json; com `esperado`,
      // a assinatura é conferida assim mesmo (ligado null = nada a gravar).
      if (!ligadoInvalido || esperado !== undefined) {
        const d = aplicarDesligar({ arquivo, agoraMs, ligado: l, esperado });
        if (!d.ok) return d;
        removidas = d.removidas;
        backup = d.backup;
      }
    }
    // O PID vem antes da parada: o pararColetor apaga o arquivo depois do
    // taskkill, e é por ele que se espera o processo sair (só quando há o
    // que apagar; no alcance nada, a parada basta).
    const antes = alcance === 'nada' ? null : lerPid(dir);
    let pr = null;
    try {
      pr = parar({ dir, plataforma, executar, systemRoot });
    } catch {
      pr = null;
    }
    apagarLigado(dir);
    // Parada que falhou: o pararColetor deixa o PID, e com ele o Collector
    // conta como vivo (o de outro programa já saiu do arquivo: nada a guardar).
    let vivo = pr?.ok !== true && existe(caminhos(dir).pid);
    let parado = pr?.ok === true && pr.motivo === 'parado';
    if (parado && antes !== null && !esperarSaida(antes.pid, saiu, esperar)) {
      devolverPid(dir, antes);
      vivo = true;
      parado = false;
    }
    const apagou = alcance === 'nada' ? false : apagarDados(dir, { tudo: alcance === 'tudo', vivo, rm, esperar });
    // O ligado.json que o unlink não tirou (dados e tudo tentam de novo):
    // para o resto do plugin o aprendizado pode continuar ligado, então o
    // resultado avisa. Um segundo desligar não tira nada do env (as chaves
    // já saíram) e tenta apagá-lo de novo.
    const registroFicou = existe(caminhos(dir).ligado);
    return {
      ok: true, removidas, backup, parado, apagou, pasta: caminhos(dir).otel, ligadoInvalido, registroFicou,
    };
  } catch {
    return falha('erro');
  } finally {
    t.soltar();
  }
}

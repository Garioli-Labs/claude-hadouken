import crypto from 'node:crypto';
import { arquivoSettings } from '../configuracao.js';
import { lerConfigGuardaBase } from '../guarda/config.js';
import { aprovar, desfazer, recusar } from './ajustar.js';
import { caminhos, ligadoExiste } from './arquivos.js';
import * as msg from './mensagens.js';
import {
  anexarEventoApr, gravarAjustes, gravarSugestoes, lerAjustes, lerAprendizado, lerEventosApr, lerSugestoes, pegarTrava,
} from './registro.js';

// O comando /claude-hadouken:aprender (spec aprendizado §3.2, R4). Chamado
// só pelo hook UserPromptExpansion (src/hooks/aprender.js), que bloqueia a
// expansão: o modelo não é chamado (0 tokens) e a resposta vai ao usuário.
// Dois portões antes de qualquer outra leitura ou gravação, na ordem do
// liberar.js: a recusa de -p e SDK (CLAUDE_CODE_ENTRYPOINT sdk-*, Foco de
// revisão 5) e a origem do comando (ruling I1 do preflight: a mesma lista
// fechada do liberar.js, command_source 'plugin' com expansion_type
// 'slash_command'; qualquer outro valor, inclusive ausente, é recusado, e um
// rótulo novo do CLI recusa o comando digitado até a lista ganhar o valor).
// A recusa vira o evento 'comando-recusado' só com o aprendizado ligado:
// desligado, nenhum arquivo é criado (§11).
// O argumento só passa pela gramática; o texto sai de mensagens.js. ligar.js
// (que carrega baixar.js e coletor.js, os módulos de rede e de processo
// filho) e coletor.js só entram por import dinâmico, nos ramos que os usam,
// depois dos portões. Nunca rejeita.

const TEXTO_MAX = 200;
const ORIGENS = Object.freeze(['plugin']);
const EXPANSOES = Object.freeze(['slash_command']);
const CODIGO = /^[0-9a-f]{8}$/;
const ALCANCES = Object.freeze(['dados', 'tudo']);
// A "assinatura" do desligar quando o aprendizado já está desligado e só os
// dados que ficaram serão apagados: não é hex, nem 'ausente', nem 'invalida'
// (settings-env.js), então nunca casa com a assinatura de um settings.json.
// Se um ligar terminar entre a prévia e a confirmação, o desligar recebe
// este `esperado` e recusa com 'settings-mudou' em vez de tirar chaves que a
// prévia não mostrou.
const SEM_LIGADO = 'sem-ligado';
const ARGUMENTO = Object.freeze({
  status: (a) => a === null,
  ligar: (a) => a === null || CODIGO.test(a),
  desfazer: (a) => a === null || /^a\d{1,6}$/.test(a),
  aprovar: (a) => a !== null && /^s\d{1,6}$/.test(a),
  recusar: (a) => a !== null && /^s\d{1,6}$/.test(a),
});

const digitado = (fonte, expansao) => ORIGENS.includes(fonte) && EXPANSOES.includes(expansao);

// `desligar [dados|tudo] [código]`: o alcance (qualquer caixa) e depois o
// código, que é exatamente 8 hex minúsculos, como a prévia o mostra.
function interpretarDesligar(resto) {
  let i = 0;
  let alcance = null;
  let codigo = null;
  if (i < resto.length && ALCANCES.includes(resto[i].toLowerCase())) alcance = resto[i++].toLowerCase();
  if (i < resto.length && CODIGO.test(resto[i])) codigo = resto[i++];
  return i === resto.length ? { sub: 'desligar', arg: alcance, codigo } : null;
}

export function interpretarComando(texto) {
  if (typeof texto !== 'string' || texto.length > TEXTO_MAX) return null;
  const partes = texto.trim().split(/\s+/).filter((p) => p !== '');
  if (partes.length === 0) return { sub: 'status', arg: null };
  const sub = partes[0].toLowerCase();
  if (sub === 'desligar') return interpretarDesligar(partes.slice(1));
  if (partes.length > 2) return null;
  const arg = partes.length === 2 ? partes[1].toLowerCase() : null;
  if (!Object.hasOwn(ARGUMENTO, sub) || !ARGUMENTO[sub](arg)) return null;
  return { sub, arg };
}

function registrarRecusa(dir, agoraMs, texto) {
  try {
    if (ligadoExiste(dir)) anexarEventoApr(dir, 'comando-recusado', agoraMs);
  } catch { /* a recusa segue de qualquer jeito */ }
  return texto;
}

async function mostrarStatus(dir, agoraMs) {
  if (!ligadoExiste(dir)) return msg.DESLIGADO;
  const { coletorVivo } = await import('./coletor.js');
  return msg.status({
    ligado: true,
    ap: lerAprendizado(dir, agoraMs),
    aj: lerAjustes(dir, agoraMs),
    sug: lerSugestoes(dir, agoraMs),
    eventos: lerEventosApr(dir, agoraMs),
    vivo: coletorVivo(dir).vivo,
    agoraMs,
  });
}

async function fazerLigar(dir, codigo, agoraMs, ambiente, arquivo, deps) {
  const { ligar, previa } = await import('./ligar.js');
  const base = { ...(deps.ligar ?? {}), dir, arquivo, ambiente };
  if (codigo === null) {
    const p = previa(base);
    return p.ok ? msg.previa(p.plano, p.codigo) : msg.falhaLigar(p);
  }
  const r = await ligar({ ...base, codigo, agoraMs });
  return r.ok ? msg.ligado(r) : msg.falhaLigar(r);
}

// O código do desligar (R4 aplicado ao desligar, ruling da Task 11): os 8
// primeiros hex do SHA-256 de um JSON com chaves em ordem fixa. Muda se o
// settings.json mudou (assinatura), se as chaves a tirar ou a saída do env
// mudaram, ou se o alcance ou a pasta são outros.
function codigoDesligar({ assinatura, remover, removeEnv, alcance, pasta }) {
  const texto = JSON.stringify({ assinatura, remover, removeEnv, alcance, pasta });
  return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 8);
}

// A prévia do desligar, só leitura. Já desligado, `desligar` (alcance nada)
// não tem o que fazer; `desligar dados|tudo` ainda apaga o que ficou.
function prepararDesligar(previaDesligar, dir, arquivo, alcance) {
  const pd = previaDesligar({ dir, arquivo });
  let previa;
  if (pd.ok) {
    previa = {
      ligado: true, ligadoInvalido: pd.ligadoInvalido, remover: pd.remover, removeEnv: pd.removeEnv, pasta: pd.pasta, arquivo, assinatura: pd.assinatura,
    };
  } else if (pd.motivo === 'desligado') {
    if (alcance === 'nada') return { ok: false, texto: msg.DESLIGADO };
    previa = { ligado: false, ligadoInvalido: false, remover: [], removeEnv: false, pasta: caminhos(dir).otel, arquivo, assinatura: SEM_LIGADO };
  } else {
    return { ok: false, texto: msg.falhaDesligar(pd) };
  }
  const codigo = codigoDesligar({ assinatura: previa.assinatura, remover: previa.remover, removeEnv: previa.removeEnv, alcance, pasta: previa.pasta });
  return { ok: true, previa, codigo };
}

// Dois tempos, como o ligar: sem código, a prévia e o código; com código, a
// prévia é refeita e o código conferido (se não bate, nada acontece), e o
// desligar recebe a assinatura como `esperado` (§6 última linha: um
// settings.json que muda entre a conferência e a gravação dá
// 'settings-mudou').
async function fazerDesligar(dir, arg, codigo, agoraMs, arquivo, deps) {
  const { desligar, previaDesligar } = await import('./ligar.js');
  const alcance = arg ?? 'nada';
  const p = prepararDesligar(previaDesligar, dir, arquivo, alcance);
  if (!p.ok) return p.texto;
  if (codigo === null) return msg.previaDesligar(p.previa, alcance, p.codigo);
  if (codigo !== p.codigo) return msg.falhaDesligar({ ok: false, motivo: 'codigo' });
  const r = desligar({ ...(deps.desligar ?? {}), dir, arquivo, agoraMs, apagar: alcance, esperado: p.previa.assinatura });
  if (r.ok) return msg.desligado(r, alcance);
  if (r.motivo === 'desligado') return msg.DESLIGADO;
  return msg.falhaDesligar(r);
}

// desfazer, aprovar e recusar: sob a trava do passo, para não gravar por
// cima de um passo que está rodando. As sugestões são gravadas antes dos
// ajustes: se a segunda gravação falha, a aprovação se perde (e a sugestão
// não volta a valer), mas nunca fica um afrouxamento sem a sugestão fechada.
function responder(dir, c, agoraMs) {
  if (!ligadoExiste(dir)) return msg.DESLIGADO;
  const t = pegarTrava(dir);
  if (!t.ok) return t.motivo === 'ocupada' ? msg.OCUPADO : msg.FALHOU;
  try {
    const aj = lerAjustes(dir, agoraMs);
    if (c.sub === 'desfazer') {
      const r = desfazer(aj, c.arg, agoraMs);
      if (!r.ok) return msg.falhaDesfazer(r.motivo);
      return gravarAjustes(dir, r.aj).ok ? msg.desfeito(r.registro) : msg.NAO_GRAVADO;
    }
    const sug = lerSugestoes(dir, agoraMs);
    const r = c.sub === 'aprovar'
      ? aprovar(aj, sug, c.arg, lerConfigGuardaBase(dir).config, agoraMs)
      : recusar(sug, aj, c.arg, agoraMs);
    if (!r.ok && r.motivo === 'nao-achou') return msg.SEM_SUGESTAO;
    if (!gravarSugestoes(dir, r.sug).ok || !gravarAjustes(dir, r.aj).ok) return msg.NAO_GRAVADO;
    if (!r.ok) return msg.MUDOU;
    if (c.sub === 'recusar') return msg.recusado(r.sugestao);
    return r.tipo === 'afrouxar' ? msg.aprovadoAfrouxar(r.registro) : msg.aprovadoModelo(r.sugestao);
  } finally {
    t.soltar();
  }
}

// `fonte` e `expansao` são o command_source e o expansion_type da entrada
// do hook; sem eles, o comando é recusado (fail-closed).
export async function executarComando(opcoes = {}) {
  try {
    const {
      dir, texto, agoraMs, entrypoint, fonte, expansao, ambiente = process.env, deps = {},
    } = opcoes ?? {};
    if (typeof entrypoint === 'string' && /^sdk/i.test(entrypoint)) return registrarRecusa(dir, agoraMs, msg.RECUSADO_ENTRYPOINT);
    if (!digitado(fonte, expansao)) return registrarRecusa(dir, agoraMs, msg.RECUSADO_ORIGEM);
    const c = interpretarComando(texto);
    if (c === null) return msg.USO;
    if (typeof dir !== 'string') return msg.FALHOU;
    if (c.sub === 'status') return await mostrarStatus(dir, agoraMs);
    if (c.sub === 'ligar' || c.sub === 'desligar') {
      let { arquivo } = opcoes;
      if (arquivo === undefined) {
        const s = arquivoSettings();
        if (!s.ok) return msg.falhaSettings(s.motivo);
        arquivo = s.arquivo;
      }
      return c.sub === 'ligar'
        ? await fazerLigar(dir, c.arg, agoraMs, ambiente, arquivo, deps)
        : await fazerDesligar(dir, c.arg, c.codigo, agoraMs, arquivo, deps);
    }
    return responder(dir, c, agoraMs);
  } catch {
    return msg.FALHOU;
  }
}

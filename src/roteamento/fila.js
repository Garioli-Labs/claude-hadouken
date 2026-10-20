import fs from 'node:fs';
import path from 'node:path';
import { idValido } from '../base.js';
import { lerJson, gravarJsonAtomico } from '../estado.js';

// A fila das sugestões (spec roteamento §7 e §9): uma por sessão a cada 30
// min e, depois disso, só quando a sugestão muda. A de maior economia sai
// primeiro. Textos fixos daqui; nada do transcript vira texto. Nunca lança.
export const DIR_SESSOES = 'roteamento-sessoes';
const INTERVALO_MS = 30 * 60_000;
const VELHO_MS = 24 * 3_600_000;
const APAGAR_MAX = 50;

export const TEXTOS = Object.freeze({
  'effort-medium': Object.freeze({ linha: 'hadouken: as últimas respostas são trabalho simples; sugira ao usuário /effort medium (economiza sem perder qualidade aqui).', marca: '↓ effort medium' }),
  'model-sonnet': Object.freeze({ linha: 'hadouken: as últimas respostas são trabalho simples; sugira ao usuário /model sonnet.', marca: '↓ sonnet' }),
  'effort-high': Object.freeze({ linha: 'hadouken: sinais de dificuldade (testes falhando, edições desfeitas); sugira ao usuário /effort high.', marca: '↑ effort high' }),
  O5: Object.freeze({ linha: 'hadouken: contexto alto e cache caindo; sugira ao usuário /compact agora, ou uma sessão nova com um resumo.', marca: '⇣ compact' }),
  O1: Object.freeze({ linha: 'hadouken: o mesmo arquivo grande foi lido inteiro várias vezes; leia só o trecho (offset/limit) ou use Grep.', marca: null }),
  O2: Object.freeze({ linha: 'hadouken: um comando devolveu mais de 30 KB; filtre (grep, head, tail) ou mande a saída para um arquivo e leia o fim.', marca: null }),
});

const arquivo = (dir, id) => path.join(dir, DIR_SESSOES, `${id}.json`);

// { em, chave } gravado, ou null (ausente, corrompido ou fora do formato).
function gravado(dir, id, agoraMs) {
  const lido = lerJson(arquivo(dir, id), 4096);
  if (!lido.ok || lido.valor === null || typeof lido.valor !== 'object') return null;
  const { em, chave } = lido.valor;
  if (!Number.isSafeInteger(em) || em > agoraMs || !Object.hasOwn(TEXTOS, chave)) return null;
  return { em, chave };
}

function limparVelhos(dir, agoraMs) {
  try {
    const pasta = path.join(dir, DIR_SESSOES);
    let n = 0;
    for (const nome of fs.readdirSync(pasta)) {
      if (n >= APAGAR_MAX) break;
      const p = path.join(pasta, nome);
      try {
        const st = fs.lstatSync(p);
        if (st.isFile() && agoraMs - st.mtimeMs > VELHO_MS) { fs.unlinkSync(p); n++; }
      } catch { /* segue para o próximo */ }
    }
  } catch { /* pasta ausente: nada a limpar */ }
}

export function escolher(entrada) {
  try {
    const { dir, sessionId, candidatas, agoraMs } = entrada;
    if (typeof dir !== 'string' || !idValido(sessionId) || !Array.isArray(candidatas) || !Number.isFinite(agoraMs)) return null;
    limparVelhos(dir, agoraMs);
    const antes = gravado(dir, sessionId, agoraMs);
    if (antes !== null && agoraMs - antes.em < INTERVALO_MS) return null;
    const c = candidatas
      .filter((x) => x !== null && typeof x === 'object' && Object.hasOwn(TEXTOS, x.chave) && Number.isFinite(x.economia))
      .sort((a, b) => b.economia - a.economia)
      .find((x) => x.chave !== antes?.chave);
    if (c === undefined) return null;
    fs.mkdirSync(path.join(dir, DIR_SESSOES), { recursive: true });
    if (!gravarJsonAtomico(arquivo(dir, sessionId), { em: agoraMs, chave: c.chave }, { compacto: true }).ok) return null;
    return { chave: c.chave, linha: TEXTOS[c.chave].linha, marca: TEXTOS[c.chave].marca };
  } catch {
    return null;
  }
}

export function marcaDaSessao(dir, sessionId, agoraMs) {
  try {
    if (typeof dir !== 'string' || !idValido(sessionId)) return null;
    const g = gravado(dir, sessionId, agoraMs);
    return g !== null && agoraMs - g.em < INTERVALO_MS ? TEXTOS[g.chave].marca : null;
  } catch {
    return null;
  }
}

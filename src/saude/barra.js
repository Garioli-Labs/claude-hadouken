import fs from 'node:fs';
import path from 'node:path';
import { configSaude } from '../config/ler.js';
import { lerJson } from '../estado.js';
import { medidasNaFaixa, montarBarra } from './faixas.js';
import { lerModo } from './modo.js';

// O segmento da saúde na barra (spec v0.5.5 §6.B e §6.C). A statusline
// redesenha a todo instante, então este caminho só carrega faixas.js e
// modo.js e nada grava. A leitura completa e o disparo do coletor (ler.js)
// só carregam quando saude.json tem mais de 1 min, e depois da barra escrita.
// Os números e prazos são os de ler.js; o teste confere que batem.

const ARQ_SAUDE = 'saude.json';
const INTERVALO_COLETA_MS = 60_000;
const LEITURA_VALE_MS = 5 * 60_000;
const SAUDE_MAX_BYTES = 256 * 1024;

const NADA = Object.freeze({ barra: null, depois: async () => {} });

function mtimeMs(arq) {
  try { return fs.statSync(arq).mtimeMs; } catch { return null; }
}

// { barra, depois }: barra é o texto do segmento ou null; depois() dispara o
// coletor, se for o caso. Nunca lança.
export function saudeNaBarra(dir, agoraMs) {
  try {
    const config = configSaude(dir);
    if (!config.ligado) return NADA;
    const arq = path.join(dir, ARQ_SAUDE);
    const m = mtimeMs(arq);
    const velha = m === null || m > agoraMs || agoraMs - m >= INTERVALO_COLETA_MS;
    let fora = {};
    const r = lerJson(arq, SAUDE_MAX_BYTES);
    const j = r.ok ? r.valor : null;
    // As mesmas regras de lerSaude: versão 1, nem do futuro nem de mais de 5 min.
    if (j !== null && typeof j === 'object' && j.versao === 1 && Number.isFinite(j.em)
      && agoraMs >= j.em && agoraMs - j.em <= LEITURA_VALE_MS) {
      fora = medidasNaFaixa(j, config);
    }
    const barra = montarBarra(fora, lerModo(dir, agoraMs).leve === true);
    const depois = !velha ? NADA.depois : async () => {
      try {
        const ler = await import('./ler.js');
        let pedido = null;
        ler.talvezColetar(dir, agoraMs, { ligado: true, disparar: (o) => { pedido = o; } });
        if (pedido !== null) await ler.dispararDoHook(dir, pedido);
      } catch { /* o próximo redesenho tenta */ }
    };
    return { barra, depois };
  } catch {
    return NADA;
  }
}

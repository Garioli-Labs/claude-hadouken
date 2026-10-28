import { configSaude } from '../config/ler.js';
import { semNovidade } from './faixas.js';
import { dispararDoHook, lerSaude, talvezColetar } from './ler.js';
import { gravarRegistroAvisos, lerModo, lerRegistroAvisos } from './modo.js';

export { MARCA_DISPARO } from './ler.js';

// A saúde dentro dos hooks (spec v0.5.5 §6.A–§6.C, §6.F): só leitura de
// arquivos pequenos e a decisão pura de avisos.js. O disparo do coletor sai
// depois da saída do hook (`depois`), fora da medida do teto: o spawn custa
// 20 ms a 100 ms num PC carregado, e desligar o coletor por isso calaria os
// avisos justo quando o PC está pesado. Nunca lança. No caso de sempre (PC
// bem, nada a anunciar), semNovidade (faixas.js) evita carregar avisos.js e
// mensagens.js; a barra tem o seu caminho, mais leve ainda (barra.js).

const vazio = (r) => Object.keys(r.episodios).length === 0 && Object.keys(r.modoAnunciado).length === 0;

const NADA = Object.freeze({ claude: null, usuario: null, depois: async () => {} });

// { claude, usuario, depois }: claude vai às linhas de contexto, usuario ao
// systemMessage e depois() é chamado depois de escrever a saída.
export async function saudeNoHook({ dir, sessionId, agoraMs, tetos, dirProjeto }) {
  try {
    const config = configSaude(dir);
    if (!config.ligado) return NADA;
    let pedido = null;
    await tetos.rodar('coletor', () => talvezColetar(dir, agoraMs, {
      ligado: true, dirProjeto, disparar: (o) => { pedido = o; },
    }));
    const depois = async () => { if (pedido !== null) await dispararDoHook(dir, pedido); };
    const { leitura } = lerSaude(dir, agoraMs);
    const bruto = lerRegistroAvisos(dir);
    const modo = lerModo(dir, agoraMs);
    if (semNovidade({ leitura, config, registro: bruto, modo, sessao: sessionId })) return { ...NADA, depois };
    const { decidirAvisos } = await import('./avisos.js');
    const r = decidirAvisos({ leitura, config, registro: bruto, modo, sessao: sessionId, agoraMs, pidSessao: process.ppid });
    // Sem arquivo e sem nada a guardar, nada é criado.
    const igual = bruto === undefined ? vazio(r.registro) : JSON.stringify(r.registro) === JSON.stringify(bruto);
    if (!igual) gravarRegistroAvisos(dir, r.registro);
    return { claude: r.claude, usuario: r.usuario, depois };
  } catch {
    return NADA;
  }
}

// As linhas ao usuário das partes que o teto desligou neste hook.
export async function avisosDoTeto(tetos) {
  try {
    const novas = tetos.novas();
    if (novas.length === 0) return [];
    const { linhaTetoDesligado } = await import('./mensagens.js');
    return novas.map(linhaTetoDesligado).filter(Boolean);
  } catch {
    return [];
  }
}

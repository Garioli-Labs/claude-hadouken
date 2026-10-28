import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { configSaude } from '../config/ler.js';
import { anexarEvento } from '../guarda/registros.js';

// O teto de tempo das partes opcionais dos hooks (spec v0.5.5 §6.F). Cada
// parte que passa de saude.tetoHooks.ms em 3 das últimas 10 execuções fica
// desligada por 24 h, com o evento 'reparo' `teto:<nome>`. A guarda nunca
// passa por aqui: só o que é conforto (aprendizado, versão, painel,
// previsão, coletor, otimizações do roteamento). tetos.json é lido uma vez
// por hook e gravado uma vez, no fechar, só se mudou.

export const ARQ_TETOS = 'tetos.json';
export const PARTES = Object.freeze(['aprendizado', 'versao', 'painel', 'previsao', 'coletor', 'roteamento-otimizacoes', 'economia']);
const JANELA = 10;
const ESTOUROS = 3;
const DESLIGA_MS = 86_400_000;
const FOLGA_RELOGIO_MS = 5 * 60_000;

function lerPartes(dir, agoraMs) {
  const partes = {};
  const r = lerJson(path.join(dir, ARQ_TETOS), 16 * 1024);
  const brutas = r.ok && r.valor?.v === 1 && r.valor.partes !== null && typeof r.valor.partes === 'object' ? r.valor.partes : {};
  for (const nome of PARTES) {
    const p = brutas[nome];
    if (p === null || typeof p !== 'object') continue;
    const execucoes = Array.isArray(p.execucoes) ? p.execucoes.filter((e) => typeof e === 'boolean').slice(-JANELA) : [];
    let ate = Number.isFinite(p.desligadaAteMs) ? p.desligadaAteMs : null;
    // Prazo além de 24 h é relógio que voltou ou arquivo forjado.
    if (ate !== null && (ate <= agoraMs || ate > agoraMs + DESLIGA_MS + FOLGA_RELOGIO_MS)) ate = null;
    partes[nome] = { execucoes, desligadaAteMs: ate };
  }
  return partes;
}

export function abrirTetos(dir, agoraMs, { relogio = () => performance.now(), config } = {}) {
  let cfg;
  try { cfg = (config ?? configSaude(dir)).tetoHooks; } catch { cfg = { ligado: false }; }
  const ligado = cfg?.ligado === true && Number.isFinite(cfg.ms);
  let partes = {};
  try { if (ligado) partes = lerPartes(dir, agoraMs); } catch { partes = {}; }
  let mudou = false;
  const novas = [];

  const desligada = (nome) => partes[nome]?.desligadaAteMs != null;

  // Janela sem estouro nenhum vale o mesmo que vazia: guardada como [], para
  // que o hook rápido de todo dia não regrave tetos.json (o prompt comum não
  // cria nem renomeia arquivo, M2 da v0.1.0).
  function anotar(nome, ms) {
    const p = partes[nome] ?? { execucoes: [], desligadaAteMs: null };
    const antes = JSON.stringify(p);
    p.execucoes = [...p.execucoes, ms > cfg.ms].slice(-JANELA);
    if (!p.execucoes.includes(true)) p.execucoes = [];
    if (p.execucoes.filter(Boolean).length >= ESTOUROS) {
      p.desligadaAteMs = agoraMs + DESLIGA_MS;
      p.execucoes = [];
      novas.push(nome);
      anexarEvento(dir, 'reparo', `teto:${nome}`, agoraMs);
    }
    if (JSON.stringify(p) === antes) return;
    partes[nome] = p;
    mudou = true;
  }

  return {
    async rodar(nome, fn) {
      if (!PARTES.includes(nome)) throw new Error(`parte desconhecida: ${nome}`);
      if (!ligado) {
        try { return await fn(); } catch { return undefined; }
      }
      if (desligada(nome)) return undefined;
      const inicio = relogio();
      let valor;
      try {
        valor = await fn();
      } catch {
        valor = undefined;
      }
      try { anotar(nome, relogio() - inicio); } catch { /* medir é melhor esforço */ }
      return valor;
    },
    fechar() {
      if (!ligado || !mudou) return;
      try {
        gravarJsonAtomico(path.join(dir, ARQ_TETOS), { v: 1, partes }, { compacto: true });
        mudou = false;
      } catch {
        /* fica para o próximo hook */
      }
    },
    desligadas() {
      if (!ligado) return [];
      return PARTES.filter(desligada).map((nome) => ({ nome, ateMs: partes[nome].desligadaAteMs }));
    },
    // As desligadas por este hook: o aviso único ao usuário (spec §6.F).
    novas() {
      return [...novas];
    },
  };
}

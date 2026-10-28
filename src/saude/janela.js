import { configSaude } from '../config/ler.js';
import { lerSaude } from './ler.js';
import { lerModo } from './modo.js';
import { medidasNaFaixa, montarBarra } from './faixas.js';
import { sugerirFechar } from './processos.js';
import { resumoCurto } from './relatorio.js';

// O que a seção "PC agora" da janela do VS Code mostra (spec v0.5.5 §6.L,
// variante A do protótipo), já decidido aqui: a janela só desenha, com
// textContent. Só lê; nunca dispara o coletor, porque no VS Code o
// process.execPath é o próprio editor (quem dispara são a barra e os hooks).

const GB = 1024 ** 3;
const ROTULO_MAX = 40;
const NA = 'não disponível neste PC';
const URGENCIA = { 1: 'atencao', 2: 'urgente' };

const urgencia = (fora, tipo) => URGENCIA[fora[tipo]?.nivel] ?? 'calma';
const limitar = (n) => Math.max(0, Math.min(100, Math.round(n)));

function medidas(l, config, fora) {
  const lista = [];
  const ram = l.ram.usadaPct;
  lista.push({
    chave: 'ram', rotulo: 'RAM', pct: ram === null ? null : limitar(ram),
    valor: ram === null ? NA : `${Math.round(ram)}% de ${l.ram.totalBytes === null ? '?' : Math.round(l.ram.totalBytes / GB)} GB`,
    urgencia: urgencia(fora, 'ram'),
  });
  const t = l.gpu.tempC;
  lista.push({
    chave: 'gpu', rotulo: (l.gpu.nome ? `GPU ${l.gpu.nome}` : 'GPU').slice(0, ROTULO_MAX),
    pct: t === null ? null : limitar((t / config.gpuMax) * 100),
    valor: t === null ? NA : `${Math.round(t)} °C`, urgencia: urgencia(fora, 'gpu'),
  });
  const carga = l.cpu.cargaPct;
  const tempCpu = l.cpu.tempC === null ? 'temperatura não disponível neste PC' : `${Math.round(l.cpu.tempC)} °C`;
  lista.push({
    chave: 'cpu', rotulo: 'CPU', pct: carga === null ? null : limitar(carga),
    valor: carga === null && l.cpu.tempC === null ? NA : `${carga === null ? 'carga ?' : `${Math.round(carga)}%`} · ${tempCpu}`,
    urgencia: urgencia(fora, 'cpu'),
  });
  const livres = [l.disco.dadosLivreBytes, l.disco.projetoLivreBytes].filter((b) => b !== null);
  lista.push({
    chave: 'disco', rotulo: 'Disco', pct: null,
    valor: livres.length === 0 ? NA : `${Math.floor(Math.min(...livres) / GB)} GB livres`, urgencia: urgencia(fora, 'disco'),
  });
  if (l.bateria !== null && l.bateria.pct !== null) {
    lista.push({
      chave: 'bateria', rotulo: 'Bateria', pct: limitar(l.bateria.pct),
      valor: `${Math.round(l.bateria.pct)}%${l.bateria.naTomada === false ? ' · fora da tomada' : ''}`, urgencia: urgencia(fora, 'bateria'),
    });
  }
  return lista;
}

// { idadeMs, leve, ateMs, medidas, sugestoes, acaoLeve, barra, resumo }, ou
// null com a saúde desligada (a seção some). acaoLeve: 'ligar' só com alerta,
// 'desligar' com o modo ligado, senão null. Nunca lança.
export function estadoJanela({ dir, agoraMs = Date.now(), raizPlugin = null, versaoNode = process.version }) {
  try {
    if (typeof dir !== 'string') return null;
    const config = configSaude(dir);
    if (!config.ligado) return null;
    const { leitura, idadeMs } = lerSaude(dir, agoraMs);
    const modo = lerModo(dir, agoraMs);
    const fora = leitura === null ? {} : medidasNaFaixa(leitura, config);
    const alerta = Object.keys(fora).length > 0;
    const sugestoes = leitura !== null && fora.ram?.nivel === 2
      ? sugerirFechar(leitura.processos).map((a) => ({ nome: a.nome, rssBytes: a.rssBytes }))
      : [];
    return {
      idadeMs,
      leve: modo.leve,
      ateMs: modo.ateMs,
      medidas: leitura === null ? [] : medidas(leitura, config, fora),
      sugestoes,
      acaoLeve: modo.leve ? 'desligar' : alerta ? 'ligar' : null,
      barra: montarBarra(fora, modo.leve),
      resumo: resumoCurto({ dir, agoraMs, config, raizPlugin, versaoNode }),
    };
  } catch {
    return null;
  }
}

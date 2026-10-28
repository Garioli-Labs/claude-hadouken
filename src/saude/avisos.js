import { sugerirFechar } from './processos.js';
import { avisoUsuario, barraTipo, linhaClaude, linhaModoLeve, LINHA_MODO_NORMAL, resumoUsuario } from './mensagens.js';

// A decisão dos avisos da saúde (spec v0.5.5 §6.B, §6.C e §9.1 item 2).
// Puro: os hooks leem a leitura, o registro e o modo, chamam isto e gravam o
// registro devolvido. Nada aqui bloqueia; é orientação.
//
// Episódio: começa quando a medida entra na faixa e acaba depois de 30 min
// abaixo dela. O usuário é avisado uma vez por episódio no PC inteiro; o
// Claude, uma vez por sessão e episódio. Se a RAM sobe do amarelo para o
// vermelho no mesmo episódio, os dois são avisados de novo (a orientação
// muda); a volta ao amarelo não repete nada.

export const TIPOS = Object.freeze(['ram', 'gpu', 'cpu', 'disco', 'bateria']);
const ESFRIAR_MS = 30 * 60_000;
const SESSOES_MAX = 20;
const MODO_SESSOES_MAX = 50;
const SID = /^[A-Za-z0-9-]{1,16}$/;
const BARRA_MAX = 24;
const GB = 1024 ** 3;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finito = Number.isFinite;

function sid(sessao) {
  const s = typeof sessao === 'string' ? sessao.slice(0, 16) : '';
  return SID.test(s) ? s : 'sem-sessao';
}

function episodioValido(e) {
  if (!ehObjeto(e) || !finito(e.inicioMs)) return null;
  return {
    inicioMs: e.inicioMs,
    fimAbaixoMs: finito(e.fimAbaixoMs) ? e.fimAbaixoMs : null,
    avisadoUsuario: e.avisadoUsuario === true,
    nivel: e.nivel === 1 ? 1 : 2,
    sessoes: Array.isArray(e.sessoes) ? e.sessoes.filter((s) => typeof s === 'string' && SID.test(s)).slice(-SESSOES_MAX) : [],
  };
}

function registroValido(r) {
  const episodios = {};
  const modoAnunciado = {};
  if (ehObjeto(r)) {
    if (ehObjeto(r.episodios)) {
      for (const t of TIPOS) {
        const e = episodioValido(r.episodios[t]);
        if (e !== null) episodios[t] = e;
      }
    }
    if (ehObjeto(r.modoAnunciado)) {
      for (const [s, m] of Object.entries(r.modoAnunciado).slice(-MODO_SESSOES_MAX)) {
        if (SID.test(s) && (m === 'leve' || m === 'normal')) modoAnunciado[s] = m;
      }
    }
  }
  return { episodios, modoAnunciado };
}

// { tipo: { nivel, valor } } das medidas na faixa agora.
function medidasNaFaixa(l, c) {
  const fora = {};
  const ram = l.ram?.usadaPct;
  if (finito(ram) && ram >= c.ram.vermelho) fora.ram = { nivel: 2, valor: ram };
  else if (finito(ram) && ram >= c.ram.amarelo) fora.ram = { nivel: 1, valor: ram };
  if (finito(l.gpu?.tempC) && l.gpu.tempC >= c.gpuMax) fora.gpu = { nivel: 2, valor: l.gpu.tempC };
  if (finito(l.cpu?.tempC) && l.cpu.tempC >= c.cpuMax) fora.cpu = { nivel: 2, valor: l.cpu.tempC };
  const livres = [l.disco?.dadosLivreBytes, l.disco?.projetoLivreBytes].filter(finito);
  if (livres.length > 0 && Math.min(...livres) < c.discoMinGB * GB) fora.disco = { nivel: 2, valor: Math.min(...livres) };
  const b = l.bateria;
  if (ehObjeto(b) && b.naTomada === false && finito(b.pct) && b.pct <= c.bateriaMin) fora.bateria = { nivel: 2, valor: b.pct };
  return fora;
}

// Vermelho antes de amarelo; no mesmo nível, a ordem de TIPOS.
const porGravidade = (fora) => TIPOS.filter((t) => fora[t]).sort((a, b) => fora[b].nivel - fora[a].nivel);

function montarBarra(tipo, fora, leve) {
  const partes = [];
  if (tipo !== undefined) partes.push(barraTipo(tipo, fora[tipo].valor));
  if (leve) partes.push('leve');
  const barra = partes.join(' · ');
  return barra === '' ? null : barra.slice(0, BARRA_MAX);
}

export function decidirAvisos({ leitura, config, registro, modo, sessao, agoraMs, pidSessao } = {}) {
  const reg = registroValido(registro);
  if (!config?.ligado) return { usuario: null, claude: null, barra: null, registro: reg };
  const s = sid(sessao);
  const leve = modo?.leve === true && finito(modo.ateMs);
  const linhas = [];
  let usuario = null;
  let fora = {};

  // Sem leitura válida (velha, do futuro, ausente): ninguém é avisado e os
  // episódios ficam como estão, para não fechar nem abrir no escuro.
  if (ehObjeto(leitura) && finito(agoraMs)) {
    fora = medidasNaFaixa(leitura, config);
    for (const t of TIPOS) {
      const ep = reg.episodios[t];
      if (fora[t] === undefined) {
        if (ep === undefined) continue;
        if (ep.fimAbaixoMs === null) ep.fimAbaixoMs = agoraMs;
        else if (agoraMs - ep.fimAbaixoMs >= ESFRIAR_MS) delete reg.episodios[t];
        continue;
      }
      const velho = ep === undefined || ep.inicioMs > agoraMs || (ep.fimAbaixoMs !== null && agoraMs - ep.fimAbaixoMs >= ESFRIAR_MS);
      if (velho) {
        reg.episodios[t] = { inicioMs: agoraMs, fimAbaixoMs: null, avisadoUsuario: false, nivel: fora[t].nivel, sessoes: [] };
      } else {
        ep.fimAbaixoMs = null;
        if (fora[t].nivel > ep.nivel) Object.assign(ep, { nivel: fora[t].nivel, avisadoUsuario: false, sessoes: [] });
      }
    }
    const ordem = porGravidade(fora);
    for (const t of ordem) {
      const ep = reg.episodios[t];
      if (ep.sessoes.includes(s)) continue;
      linhas.push(linhaClaude(t, fora[t].nivel, fora[t].valor));
      ep.sessoes = [...ep.sessoes, s].slice(-SESSOES_MAX);
    }
    // Ao usuário, um aviso só: o do mais grave entre os ainda não avisados.
    // Os outros tipos ficam marcados também, para não virar um aviso por mensagem.
    const novos = ordem.filter((t) => !reg.episodios[t].avisadoUsuario);
    if (novos.length > 0) {
      const t = novos[0];
      const sugestoes = t === 'ram' && fora.ram.nivel >= 2 ? sugerirFechar(leitura.processos, { pidSessao }) : [];
      usuario = avisoUsuario(resumoUsuario(t, fora[t].valor), sugestoes);
      for (const n of novos) reg.episodios[n].avisadoUsuario = true;
    }
  }

  // O modo leve, ao Claude, só quando muda para esta sessão.
  const anunciado = reg.modoAnunciado[s];
  if (leve && anunciado !== 'leve') {
    linhas.push(linhaModoLeve(modo.ateMs));
    reg.modoAnunciado[s] = 'leve';
  } else if (!leve && anunciado === 'leve') {
    linhas.push(LINHA_MODO_NORMAL);
    reg.modoAnunciado[s] = 'normal';
  }

  return {
    usuario,
    claude: linhas.length > 0 ? linhas.join('\n') : null,
    barra: montarBarra(porGravidade(fora)[0], fora, leve),
    registro: reg,
  };
}

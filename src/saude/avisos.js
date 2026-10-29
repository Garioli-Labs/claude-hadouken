import { sugerirFechar } from './processos.js';
import { avisoUsuario, linhaClaude, linhaModoLeve, linhaParadas, LINHA_MODO_NORMAL, resumoUsuario, textoParadas } from './mensagens.js';
import { paradas } from './ociosas.js';
import { medidasNaFaixa, montarBarra, porGravidade, sid, sidValido, TIPOS } from './faixas.js';

// A decisão dos avisos da saúde (spec v0.5.5 §6.B, §6.C e §9.1 item 2).
// Puro: os hooks leem a leitura, o registro e o modo, chamam isto e gravam o
// registro devolvido. Nada aqui bloqueia; é orientação.
//
// Episódio: começa quando a medida entra na faixa e acaba depois de 30 min
// abaixo dela. O usuário é avisado uma vez por episódio no PC inteiro; o
// Claude, uma vez por sessão e episódio. Se a RAM sobe do amarelo para o
// vermelho no mesmo episódio, os dois são avisados de novo (a orientação
// muda); a volta ao amarelo não repete nada.

export { TIPOS };
const ESFRIAR_MS = 30 * 60_000;
const SESSOES_MAX = 20;
const MODO_SESSOES_MAX = 50;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finito = Number.isFinite;

function episodioValido(e) {
  if (!ehObjeto(e) || !finito(e.inicioMs)) return null;
  return {
    inicioMs: e.inicioMs,
    fimAbaixoMs: finito(e.fimAbaixoMs) ? e.fimAbaixoMs : null,
    avisadoUsuario: e.avisadoUsuario === true,
    nivel: e.nivel === 1 ? 1 : 2,
    sessoes: Array.isArray(e.sessoes) ? e.sessoes.filter(sidValido).slice(-SESSOES_MAX) : [],
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
        if (sidValido(s) && (m === 'leve' || m === 'normal')) modoAnunciado[s] = m;
      }
    }
  }
  const p = ehObjeto(r) && ehObjeto(r.paradas) ? r.paradas : null;
  const paradas = p === null ? undefined : {
    avisadoUsuario: p.avisadoUsuario === true,
    sessoes: Array.isArray(p.sessoes) ? p.sessoes.filter(sidValido).slice(-SESSOES_MAX) : [],
  };
  return paradas === undefined ? { episodios, modoAnunciado } : { episodios, modoAnunciado, paradas };
}

// Sessões do Claude paradas: episódio à parte, fora de TIPOS (sem faixa nem
// barra). Começa quando há alguma parada na leitura e acaba quando n volta a
// 0. Ao usuário, uma vez por episódio e só num hook em que nenhum aviso de
// faixa saiu; ao Claude, uma vez por sessão e só com a RAM amarela ou pior.
function avisarParadas(reg, leitura, fora, s, usuarioJa, linhas) {
  const p = paradas(leitura.ociosas, leitura.em);
  if (p.n === 0) {
    delete reg.paradas;
    return null;
  }
  reg.paradas ??= { avisadoUsuario: false, sessoes: [] };
  if ((fora.ram?.nivel ?? 0) >= 1 && !reg.paradas.sessoes.includes(s)) {
    linhas.push(linhaParadas(p));
    reg.paradas.sessoes = [...reg.paradas.sessoes, s].slice(-SESSOES_MAX);
  }
  if (usuarioJa || reg.paradas.avisadoUsuario) return null;
  reg.paradas.avisadoUsuario = true;
  return textoParadas(p);
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
    const aviso = avisarParadas(reg, leitura, fora, s, usuario !== null, linhas);
    if (aviso !== null) usuario = aviso;
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
    barra: montarBarra(fora, leve),
    registro: reg,
  };
}

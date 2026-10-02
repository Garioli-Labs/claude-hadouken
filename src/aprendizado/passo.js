import path from 'node:path';
import { ARQ_ESTADO, instante, lerJson, limitesValidos, validarEstado } from '../estado.js';
import { lerConfigGuardaBase } from '../guarda/config.js';
import { lerEventos, ultimoLimiteFable } from '../guarda/registros.js';
import { lerUso } from '../uso/ler-uso.js';
import { ajustar } from './ajustar.js';
import { agregarHistorico, agregarRegistros, atualizarJanela, marcarNaJanela, marcarSessao, podar } from './agregar.js';
import { caminhos } from './arquivos.js';
import { coletorVivo, ehOrfao, OUTRA_SESSAO_MS, pararColetor, subirColetor } from './coletor.js';
import { anuncio, avisoColetor } from './mensagens.js';
import { lerNovos } from './otlp.js';
import {
  anexarEventoApr, desmarcarEncerrada, diaLocal, gravarAjustes, gravarAprendizado, gravarCursor, gravarSugestoes, lerAjustes,
  lerAprendizado, lerCursor, lerEncerradas, lerEventosApr, lerSugestoes, marcarEncerrada, pegarTrava,
} from './registro.js';

// O passo de aprendizado (spec aprendizado §3.1, §3.3, §4.6, §6, §7). Roda
// depois da saída do SessionStart e do SessionEnd, sob a trava
// aprendizado.lock (Foco de revisão 3), e só com o aprendizado ligado (quem
// chama confere ligadoExiste). Lê o que é novo desde o cursor (telemetria,
// histórico do estado.json) e o que é idempotente (a leitura oficial do Fable,
// os disparos e o limite da guarda), agrega, ajusta e grava. Nenhuma função
// lança: uma exceção vira o evento 'erro' e o hook segue (§6).
//
// A vida do Collector (§3.3) cabe nos 5 s do hook: cada consulta ao
// tasklist/ps e o taskkill têm 1,5 s (CONSULTA_PRAZO_MS de coletor.js), e
// nenhum caminho passa de 3 chamadas (4,5 s): o órfão do SessionStart reusa
// a consulta do coletorVivo na parada (coletorVivo, taskkill e a consulta
// depois de um taskkill que falhou); o SessionEnd e o pararSemLigado fazem a
// consulta do pararColetor, o taskkill e a mesma consulta final. Uma
// consulta sem resposta (coletorVivo com consulta: 'falhou') nunca vale como
// Collector morto ou órfão: nesta sessão nada é parado nem sobe, e o PID
// fica. Uma subida com 'erro' vira 'coletor-falhou' e uma parada com 'erro'
// vira 'parar-falhou', sem nova tentativa; o aviso sai no máximo uma vez por
// dia (linhasDoInicio).

const DIA_MS = 86_400_000;
export const GATILHO_JANELA = Object.freeze({ G1: 'h5', G3: 'h5', G2: 'd7', G4: 'd7', G6: 'fable', G7: 'fable' });
// Eventos que viram o aviso diário do SessionStart (§3.3, §6).
export const AVISOS = Object.freeze(['porta-ocupada', 'pouca-ram', 'coletor-hash', 'coletor-ausente', 'coletor-falhou', 'sem-otel', 'parar-falhou']);
// Motivos de subirColetor que viram evento; 'vivo' e 'subindo' são normais.
const EVENTO_DA_SUBIDA = Object.freeze({
  'pouca-ram': 'pouca-ram', 'coletor-ausente': 'coletor-ausente', 'coletor-hash': 'coletor-hash', config: 'coletor-falhou', erro: 'coletor-falhou',
});
// Sem nenhuma telemetria depois de SESSOES_SEM_OTEL sessões com o
// aprendizado ligado, o evento sem-otel (a primeira sessão depois do ligar
// ainda pode não ter exportado nada).
const SESSOES_SEM_OTEL = 2;

function estadoDe(dir, agoraMs) {
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  return lido.ok ? validarEstado(lido.valor, agoraMs) : null;
}

// Folga entre o último redesenho da barra (`at`) e a marca de fim: um `at`
// até FIM_FOLGA_MS depois do fim ainda é daquela sessão encerrada; mais que
// isso, a sessão voltou (resume sem a marca tirada) e conta de novo.
const FIM_FOLGA_MS = 10_000;

// R2: as sessões de estado.json fora a que chama e fora as encerradas
// (`encerradas`: Map id → fim, de lerEncerradas; rodada 2 da revisão da Task
// 12); `recente` com `at` de até OUTRA_SESSAO_MS (5 min; 24 h com a Emenda
// A3). O estado.json não perde a sessão no SessionEnd: sem a marca de fim,
// uma sessão recém-fechada contaria como aberta.
export function outrasSessoes(estado, sessionId, agoraMs, encerradas = new Map()) {
  let ultimaMs = null;
  let recente = false;
  const sessoes = estado !== null && typeof estado === 'object' && estado.sessoes && typeof estado.sessoes === 'object' ? estado.sessoes : {};
  const fins = encerradas instanceof Map ? encerradas : new Map();
  for (const [id, s] of Object.entries(sessoes)) {
    if (id === sessionId) continue;
    const t = instante(s?.at, agoraMs);
    if (t === null) continue;
    const fim = fins.get(id);
    if (fim !== undefined && t <= fim + FIM_FOLGA_MS) continue;
    if (ultimaMs === null || t > ultimaMs) ultimaMs = t;
    if (agoraMs - t <= OUTRA_SESSAO_MS) recente = true;
  }
  return { recente, ultimaMs };
}

// §4.1 "Ritmo das janelas": os pontos novos do histórico e a leitura atual,
// com o reset da leitura atual. atualizarJanela descarta o ponto que não é
// daquela janela e só guarda a primeira vez que cada limiar foi cruzado.
function janelasDoEstado(ap, estado, pontosNovos, agoraMs) {
  const lim = limitesValidos(estado, agoraMs);
  if (lim === null) return;
  for (const [tipo, chave] of [['h5', 'five_hour'], ['d7', 'seven_day']]) {
    const j = lim[chave];
    if (!j) continue;
    const resetMs = j.resets_at * 1000;
    for (const p of pontosNovos) {
      if (p[tipo] !== null) atualizarJanela(ap, tipo, { pct: p[tipo], resetMs, emMs: p.t });
    }
    const emMs = instante(estado[chave]?.at ?? estado.at, agoraMs);
    if (emMs !== null) atualizarJanela(ap, tipo, { pct: j.used_percentage, resetMs, emMs });
  }
}

function pontosDepois(estado, desdeMs, agoraMs) {
  const r = [];
  for (const p of Array.isArray(estado?.historico) ? estado.historico : []) {
    const t = instante(p.at, agoraMs);
    if (t !== null && t > desdeMs) r.push({ t, h5: p.h5, d7: p.d7 });
  }
  return r;
}

// `lidos`: quantos registros novos de telemetria este passo agregou (o teste
// de concorrência confere que só um dos passos paralelos os leu).
export function rodarPasso({ dir, agoraMs, inicio = false } = {}) {
  const t = pegarTrava(dir);
  if (!t.ok) return { ok: false, motivo: t.motivo };
  try {
    const c = caminhos(dir);
    const ap = lerAprendizado(dir, agoraMs);
    const antes = lerCursor(dir, agoraMs);
    const cursor = { ...antes };
    // 1. Telemetria nova (R11: só eventos e active_time).
    const n = lerNovos({ pasta: c.otel, cursor: cursor.arquivo, agoraMs });
    agregarRegistros(ap, n.registros);
    cursor.arquivo = n.cursor;
    if (n.corrompido) anexarEventoApr(dir, 'telemetria-corrompida', agoraMs);
    // 2. Ritmo e janelas de 5h e 7d pelo estado.json.
    const estado = estadoDe(dir, agoraMs);
    janelasDoEstado(ap, estado, pontosDepois(estado, cursor.historicoAte, agoraMs), agoraMs);
    cursor.historicoAte = agregarHistorico(ap, estado?.historico ?? [], cursor.historicoAte);
    // 3. Janela do Fable pela leitura oficial (uso-oficial.json).
    const uso = lerUso(dir, agoraMs);
    const fable = uso?.modelos?.fable;
    const lidoMs = typeof uso?.lidoEm === 'string' ? Date.parse(uso.lidoEm) : Number.NaN;
    if (fable && fable.resetsAtMs !== null && Number.isFinite(lidoMs)) {
      atualizarJanela(ap, 'fable', { pct: fable.pct, resetMs: fable.resetsAtMs, emMs: lidoMs });
    }
    // 4. Disparos da guarda e o limite do Fable atingido (§4.4).
    for (const e of lerEventos(dir, agoraMs)) {
      if (e.tipo !== 'disparo' || typeof e.detalhe !== 'string' || !Object.hasOwn(GATILHO_JANELA, e.detalhe)) continue;
      marcarNaJanela(ap, GATILHO_JANELA[e.detalhe], Date.parse(e.at), 'disparou');
    }
    const limite = ultimoLimiteFable(dir, agoraMs);
    if (limite !== null) marcarNaJanela(ap, 'fable', limite.atMs, 'esgotou');
    if (inicio) marcarSessao(ap, agoraMs);
    // 5. Sem telemetria depois de algumas sessões: evento, no máximo um por dia.
    const hoje = diaLocal(agoraMs);
    if (cursor.arquivo === null && ap.sessoes >= SESSOES_SEM_OTEL
      && !lerEventosApr(dir, agoraMs).some((e) => e.tipo === 'sem-otel' && diaLocal(Date.parse(e.at)) === hoje)) {
      anexarEventoApr(dir, 'sem-otel', agoraMs);
    }
    // 6. Ajustes e sugestões (§4.2–§4.5), nunca de uma leitura corrompida
    // (§6). As sugestões são gravadas antes dos ajustes, como no comando. O
    // decisor devolve o mesmo item fora dos limites a cada passo enquanto a
    // evidência durar: o evento ajuste-fora sai no máximo uma vez por item
    // por dia local (cursor.fora; ruling da Task 5).
    let novos = { ajustes: [], sugestoes: [] };
    if (!n.corrompido) {
      const r = ajustar({ ap, aj: lerAjustes(dir, agoraMs), sug: lerSugestoes(dir, agoraMs), config: lerConfigGuardaBase(dir).config, agoraMs });
      for (const item of new Set(r.fora)) {
        if (cursor.fora[item] === hoje) continue;
        anexarEventoApr(dir, 'ajuste-fora', agoraMs);
        cursor.fora = { ...cursor.fora, [item]: hoje };
      }
      if (gravarSugestoes(dir, r.sug).ok && gravarAjustes(dir, r.aj).ok) novos = r.novos;
    }
    podar(ap, agoraMs);
    // O cursor só anda com os agregados gravados: uma falha relê, nunca perde.
    // Só o `fora` anda mesmo assim, para o ajuste-fora já anotado não
    // repetir no passo seguinte (revisão M2).
    if (!gravarAprendizado(dir, ap).ok) {
      if (cursor.fora !== antes.fora) gravarCursor(dir, { ...antes, fora: cursor.fora });
      return { ok: false, motivo: 'erro' };
    }
    gravarCursor(dir, cursor);
    return { ok: true, novos, lidos: n.registros.length };
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
    return { ok: false, motivo: 'erro' };
  } finally {
    t.soltar();
  }
}

const idNum = (id) => Number(id.slice(1));

// §4.6 e §6: o anúncio (só com novidade e só se hoje ainda não houve) e um
// aviso do Collector (o evento de AVISOS mais novo das últimas 24 h, se o
// tipo dele ainda não foi avisado hoje). Sem a trava, nada: o próximo
// SessionStart mostra.
export function linhasDoInicio({ dir, agoraMs } = {}) {
  let t = null;
  try {
    t = pegarTrava(dir);
    if (!t.ok) return [];
    const linhas = [];
    const cursor = lerCursor(dir, agoraMs);
    const hoje = diaLocal(agoraMs);
    if (cursor.anuncio.dia !== hoje) {
      const aj = lerAjustes(dir, agoraMs);
      const sug = lerSugestoes(dir, agoraMs);
      const novos = aj.registros.filter((r) => r.origem === 'auto' && idNum(r.id) > cursor.anuncio.ajustes);
      const pendentes = sug.lista.filter((s) => s.estado === 'pendente' && idNum(s.id) > cursor.anuncio.sugestoes);
      const texto = anuncio(novos, pendentes.length);
      if (texto !== null) {
        linhas.push(texto);
        cursor.anuncio = {
          dia: hoje,
          ajustes: Math.max(cursor.anuncio.ajustes, ...aj.registros.map((r) => idNum(r.id))),
          sugestoes: Math.max(cursor.anuncio.sugestoes, ...sug.lista.map((s) => idNum(s.id))),
        };
      }
    }
    const recente = lerEventosApr(dir, agoraMs)
      .filter((e) => AVISOS.includes(e.tipo) && agoraMs - Date.parse(e.at) <= DIA_MS)
      .pop();
    if (recente && cursor.avisos[recente.tipo] !== hoje) {
      const aviso = avisoColetor(recente.tipo);
      if (aviso !== null) {
        linhas.push(aviso);
        cursor.avisos = { ...cursor.avisos, [recente.tipo]: hoje };
      }
    }
    if (linhas.length > 0) gravarCursor(dir, cursor);
    return linhas;
  } catch {
    return [];
  } finally {
    if (t?.ok) t.soltar();
  }
}

// Os eventos de uma sessão, cada tipo uma vez (o log da subida anterior e o
// motivo da subida podem dar o mesmo 'coletor-falhou').
function anexarUnicos(dir, tipos, agoraMs) {
  for (const tipo of new Set(tipos)) anexarEventoApr(dir, tipo, agoraMs);
}

// pararColetor com 'erro' (consulta sem resposta, taskkill que falhou e o
// processo de pé): o evento 'parar-falhou', e o PID fica para a próxima
// sessão, sem nova tentativa agora. 'outro-processo' e os sucessos não viram
// evento.
const falhouParar = (p) => p?.ok === false && p.motivo === 'erro';

// §3.3 SessionStart, depois da saída: órfão, subida e o passo.
export function depoisDoInicio({ dir, sessionId, source, agoraMs, opcoesColetor = {} } = {}) {
  try {
    // A sessão que volta (resume) está aberta de novo: a marca de fim sai.
    desmarcarEncerrada(dir, sessionId);
    const outras = outrasSessoes(estadoDe(dir, agoraMs), sessionId, agoraMs, lerEncerradas(dir, agoraMs));
    const vivo = coletorVivo(dir, opcoesColetor);
    // Sem resposta do tasklist/ps, nada se sabe do Collector: nada é parado
    // nem sobe nesta sessão (Task 8).
    if (vivo.consulta !== 'falhou') {
      const eventos = [];
      let subir = !vivo.vivo;
      if (vivo.vivo && ehOrfao({ emMs: vivo.emMs, ultimaOutraSessaoMs: outras.ultimaMs, agoraMs })) {
        eventos.push('orfao');
        if (falhouParar(pararColetor({ ...opcoesColetor, dir, vivo }))) eventos.push('parar-falhou');
        else subir = true;
      }
      if (subir) {
        const s = subirColetor({ ...opcoesColetor, dir, agoraMs });
        if (s.evento) eventos.push(s.evento);
        if (!s.ok && Object.hasOwn(EVENTO_DA_SUBIDA, s.motivo)) eventos.push(EVENTO_DA_SUBIDA[s.motivo]);
      }
      anexarUnicos(dir, eventos, agoraMs);
    }
    rodarPasso({ dir, agoraMs, inicio: source === 'startup' });
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
  }
}

// §3.3 SessionEnd: sem outra sessão ativa (R2), a parada; depois, o passo.
// A parada vem antes (ruling I2): o SessionEnd pode ser cortado, e o
// Collector parado no fim importa mais que o passo, que o próximo
// SessionStart refaz. Pior caso: 3 chamadas de 1,5 s (consulta, taskkill e a
// consulta depois do taskkill que falhou). A marca de fim vem antes da
// conferência (rodada 2 da revisão da Task 12): com dois fins ao mesmo tempo,
// quem confere por último vê a marca do outro e para o Collector.
export function depoisDoFim({ dir, sessionId, agoraMs, opcoesColetor = {} } = {}) {
  try {
    marcarEncerrada(dir, sessionId, agoraMs);
    const outras = outrasSessoes(estadoDe(dir, agoraMs), sessionId, agoraMs, lerEncerradas(dir, agoraMs));
    if (!outras.recente && falhouParar(pararColetor({ ...opcoesColetor, dir }))) {
      anexarEventoApr(dir, 'parar-falhou', agoraMs);
    }
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
  }
  try {
    rodarPasso({ dir, agoraMs, inicio: false });
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
  }
}

// SessionStart com o aprendizado desligado e um otel/coletor.pid de pé (o
// resto de um desligar cuja parada falhou, Task 10): uma parada, por melhor
// esforço. Sem resposta da consulta, nada (o PID fica). Fora isso, o
// pararColetor decide: mata o Collector vivo (reusando a consulta, no
// máximo 3 chamadas de 1,5 s) e apaga o PID de um processo morto ou de
// outro programa (revisão I1). Uma parada com 'erro' vira 'parar-falhou'.
export function pararSemLigado({ dir, agoraMs, opcoesColetor = {} } = {}) {
  try {
    const vivo = coletorVivo(dir, opcoesColetor);
    if (vivo.consulta === 'falhou') return;
    if (falhouParar(pararColetor({ ...opcoesColetor, dir, vivo }))) anexarEventoApr(dir, 'parar-falhou', agoraMs);
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
  }
}

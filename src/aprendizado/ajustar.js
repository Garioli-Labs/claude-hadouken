import { ITENS, SUBIR_AGENTE, chaveSugestao, valorDoItem } from './arquivos.js';
import { perfilDe, CAMPOS_MODELO, DURACAO_JANELA_MS, LIMIARES } from './agregar.js';

// Decisor do aprendizado (spec aprendizado §4.2 a §4.5 e §4.7). Puro: sem
// E/S e com o relógio por parâmetro. O conforto se ajusta sozinho dentro de
// ITENS; a guarda só aperta sozinha (−5, piso 70, nunca acima do
// config.json); afrouxar e trocar de modelo são sempre sugestões. Um valor
// calculado fora dos limites é descartado e volta em `fora` (§6), para o
// chamador gravar o evento ajuste-fora. O teste de propriedade de §8 prova
// as três garantias.

const M = 60_000;
const H = 60 * M;
const DIA_MS = 24 * H;
export const PISO_MS = 7 * DIA_MS;
export const PISO_SESSOES = 20;
export const AMOSTRAS_MIN = 20;
export const UM_AJUSTE_MS = DIA_MS;
export const BLOQUEIO_MS = 7 * DIA_MS;
export const PASSO_PONTOS = 5;
export const PISO_GUARDA = 70;
// "Sobrou > 30%" (§4.4): o máximo da janela ficou abaixo de 70%.
export const SOBRA_LIMITE = 70;
// Fora das horas ativas, até 120 s (§4.3 e R9).
export const INTERVALO_FORA_S = 120;
// Antecedência mediana entre cruzar a faixa e esgotar (§4.3; vermelho: R9).
export const ANTECEDENCIA_MS = Object.freeze({
  'painel.amarelo': Object.freeze({ h5: 45 * M, d7: 24 * H }),
  'painel.vermelho': Object.freeze({ h5: 15 * M, d7: 8 * H }),
});
// Janelas esgotadas mínimas para a faixa se mover por aquele tipo.
export const JANELAS_FAIXA_MIN = Object.freeze({ h5: 5, d7: 3 });
export const PESO_ALVO = 0.5;
export const PESO_PASSO = 0.1;
export const COBERTURA_MIN = 0.8;
export const SEMANAS_MODELO = 4;

const redondo1 = (n) => Math.round(n * 10) / 10;

function ultimoRegistro(aj, item) {
  for (let i = aj.registros.length - 1; i >= 0; i--) if (aj.registros[i].item === item) return aj.registros[i];
  return null;
}
const instanteDoUltimo = (aj, item) => {
  const r = ultimoRegistro(aj, item);
  return r === null ? Number.NEGATIVE_INFINITY : Date.parse(r.em);
};
const bloqueado = (aj, chave, agoraMs) => Object.hasOwn(aj.bloqueios, chave) && aj.bloqueios[chave] > agoraMs;

// No máximo um ajuste por item a cada 24 h (§4.3), e nada durante o
// bloqueio de 7 dias do desfazer (§4.7). Vale para qualquer origem.
const podeMudar = (aj, item, agoraMs) => !bloqueado(aj, item, agoraMs) && agoraMs - instanteDoUltimo(aj, item) >= UM_AJUSTE_MS;

function registrar(aj, item, depois, motivo, origem, agoraMs) {
  aj.seq += 1;
  const r = { id: `a${aj.seq}`, item, antes: aj.vigentes[item], depois, motivo, em: new Date(agoraMs).toISOString(), origem };
  aj.registros.push(r);
  aj.vigentes[item] = depois;
  return r;
}

// Passo máximo (§4.3): dobro ou metade no intervalo, 0,1 no peso (R9), 5
// pontos no resto; nunca passa do alvo.
function passoPara(item, atual, alvo) {
  if (item === 'painel.intervaloS') return alvo > atual ? Math.min(alvo, atual * 2) : Math.max(alvo, Math.ceil(atual / 2));
  if (item === 'previsao.pesoPerfil') return redondo1(alvo > atual ? Math.min(alvo, atual + PESO_PASSO) : Math.max(alvo, atual - PESO_PASSO));
  return alvo > atual ? Math.min(alvo, atual + PASSO_PONTOS) : Math.max(alvo, atual - PASSO_PONTOS);
}

function mediana(xs) {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// O maior limiar dentro da faixa do item em que, em cada tipo de janela com
// dados suficientes, a antecedência mediana até esgotar é a pedida. null =
// sem dados; { fora: true } = nenhum limiar dentro da faixa serve (o ideal
// fica abaixo do mínimo: descartado, §6).
function alvoDaFaixa(ap, item, agoraMs) {
  const d = ITENS[item];
  let comDados = false;
  for (let T = d.max; T >= d.min; T -= PASSO_PONTOS) {
    if (!LIMIARES.includes(T)) continue;
    let algum = false;
    let vale = true;
    for (const tipo of ['h5', 'd7']) {
      const leads = ap.janelas[tipo]
        .filter((j) => j.reset <= agoraMs && j.esgotou !== null && Object.hasOwn(j.cruzou, String(T)))
        .map((j) => j.esgotou - j.cruzou[String(T)]);
      if (leads.length < JANELAS_FAIXA_MIN[tipo]) continue;
      algum = true;
      if (mediana(leads) < ANTECEDENCIA_MS[item][tipo]) vale = false;
    }
    comDados ||= algum;
    if (algum && vale) return { alvo: T };
  }
  return comDados ? { fora: true } : null;
}

// Fração das horas ativas (dia × hora) cuja hora do dia tem ritmo típico.
function cobertura(perfil) {
  let ativas = 0;
  let cobertas = 0;
  for (let dia = 0; dia < 7; dia++) {
    for (let h = 0; h < 24; h++) {
      if (((perfil.horasAtivas[dia] >>> h) & 1) === 0) continue;
      ativas += 1;
      if (perfil.ritmoHora.h5[h] !== null) cobertas += 1;
    }
  }
  return ativas === 0 ? 0 : cobertas / ativas;
}

// Guarda (§4.4). Aperto: −5 a partir do valor efetivo (min(config,
// vigente)), piso 70, quando 2 das 3 últimas janelas concluídas esgotaram e
// o esgotamento mais novo é posterior à última mudança do item (a mesma
// evidência nunca aperta duas vezes). Afrouxar: só sugestão, +5 até o
// config.json, com 4 janelas inteiras depois da última mudança, todas abaixo
// de 70%, sem esgotar e sem disparo.
function guarda(ap, aj, sug, config, agoraMs, novos, fora) {
  for (const item of ['guarda.fableTetoPct', 'guarda.teto7d']) {
    const d = ITENS[item];
    const cfg = config?.[d.campo];
    if (!Number.isInteger(cfg)) continue;
    const vig = aj.vigentes[item];
    const ef = vig === null ? cfg : Math.min(vig, cfg);
    const desdeMs = instanteDoUltimo(aj, item);
    const concluidas = ap.janelas[d.janela].filter((j) => j.reset <= agoraMs);
    const ult3 = concluidas.slice(-3);
    const esgotadas = ult3.filter((j) => j.esgotou !== null);
    if (ult3.length === 3 && esgotadas.length >= 2 && Math.max(...esgotadas.map((j) => j.esgotou)) > desdeMs) {
      if (!podeMudar(aj, item, agoraMs)) continue;
      const novo = ef - PASSO_PONTOS;
      if (novo < PISO_GUARDA || valorDoItem(item, novo) === undefined) fora.push(item);
      else novos.ajustes.push(registrar(aj, item, novo, 'esgotou-2-de-3', 'auto', agoraMs));
      continue;
    }
    const ult4 = concluidas.slice(-4);
    const sobrou = ult4.length === 4 && ult4.every((j) => j.reset - DURACAO_JANELA_MS[d.janela] >= desdeMs
      && j.max < SOBRA_LIMITE && j.esgotou === null && !j.disparou);
    if (vig === null || vig >= cfg || !sobrou) continue;
    const s = { tipo: 'afrouxar', item, de: vig, para: Math.min(cfg, vig + PASSO_PONTOS) };
    if (bloqueado(aj, chaveSugestao(s), agoraMs) || sug.lista.some((x) => x.tipo === 'afrouxar' && x.item === item)) continue;
    sug.seq += 1;
    const nova = { id: `s${sug.seq}`, ...s, estado: 'pendente', em: new Date(agoraMs).toISOString() };
    sug.lista.push(nova);
    novos.sugestoes.push(nova);
  }
}

// Sugestão de modelo (§4.5): nas últimas 4 semanas, na mesma origem, o
// modelo·effort mais usado contra o mais barato que custa no máximo metade
// por pedido, com erro de API e falha de ferramenta até 2 pontos pior e 20
// pedidos de cada lado. Uma por origem; nunca aplicada.
function modelos(ap, aj, sug, agoraMs, novos) {
  const somas = new Map();
  for (const s of ap.semanas.slice(-SEMANAS_MODELO)) {
    for (const [k, v] of Object.entries(s.modelos)) {
      const a = somas.get(k) ?? new Array(CAMPOS_MODELO.length).fill(0);
      for (let i = 0; i < a.length; i++) a[i] += v[i];
      somas.set(k, a);
    }
  }
  const porOrigem = new Map();
  for (const [k, v] of somas) {
    const [modelo, effort, ...resto] = k.split('|');
    const origem = resto.join('|');
    if (v[0] < AMOSTRAS_MIN || !(v[1] > 0)) continue;
    // Taxas limitadas a 100: um api_error contado fora do api_request pode
    // passar do total, e o carregador recusa erroDe/erroPara acima de 100.
    const erro = Math.min(100, (100 * v[9]) / v[0]);
    const falha = v[10] > 0 ? Math.min(100, (100 * v[11]) / v[10]) : 0;
    const linha = { modelo, effort, pedidos: v[0], cpp: v[1] / v[0], erro, falha };
    if (!porOrigem.has(origem)) porOrigem.set(origem, []);
    porOrigem.get(origem).push(linha);
  }
  for (const [origem, lista] of porOrigem) {
    if (lista.length < 2 || sug.lista.some((x) => x.tipo === 'modelo' && x.origem === origem && x.estado === 'pendente')) continue;
    const de = lista.reduce((a, b) => (b.pedidos > a.pedidos ? b : a));
    const candidatos = lista
      .filter((p) => p !== de && p.cpp <= de.cpp / 2 && p.erro <= de.erro + 2 && p.falha <= de.falha + 2)
      .sort((a, b) => a.cpp - b.cpp);
    for (const para of candidatos) {
      const s = { tipo: 'modelo', origem, de: { modelo: de.modelo, effort: de.effort }, para: { modelo: para.modelo, effort: para.effort } };
      const chave = chaveSugestao(s);
      if (bloqueado(aj, chave, agoraMs) || sug.lista.some((x) => x.tipo === 'modelo' && chaveSugestao(x) === chave)) continue;
      sug.seq += 1;
      const nova = {
        id: `s${sug.seq}`, ...s, razao: Math.min(1000, redondo1(de.cpp / para.cpp)), erroDe: redondo1(de.erro), erroPara: redondo1(para.erro),
        estado: 'pendente', em: new Date(agoraMs).toISOString(),
      };
      sug.lista.push(nova);
      novos.sugestoes.push(nova);
      break;
    }
  }
}

// Spec roteamento §8: um agente do plugin com retrabalho ≥ 20% em ≥ 10
// despachos na semana vira sugestão de subir. Nunca aplicada aqui; a mesma
// pendente não repete e a recusada fica bloqueada como as outras.
const SUBIR_PCT_MIN = 20;
const SUBIR_DESPACHOS_MIN = 10;

function subirAgentes(roteamento, aj, sug, agoraMs, novos) {
  const linhas = Array.isArray(roteamento?.porAgente) ? roteamento.porAgente : [];
  for (const l of linhas) {
    const alvo = typeof l?.agente === 'string' && Object.hasOwn(SUBIR_AGENTE, l.agente) ? SUBIR_AGENTE[l.agente] : null;
    if (alvo === null || l.familia !== alvo.de) continue;
    if (!Number.isInteger(l.despachos) || l.despachos < SUBIR_DESPACHOS_MIN) continue;
    if (!Number.isInteger(l.retrabalhoPct) || l.retrabalhoPct < SUBIR_PCT_MIN || l.retrabalhoPct > 100) continue;
    const s = { tipo: 'subir-agente', agente: l.agente, de: alvo.de, para: alvo.para };
    const chave = chaveSugestao(s);
    if (bloqueado(aj, chave, agoraMs) || sug.lista.some((x) => x.tipo === 'subir-agente' && x.agente === l.agente)) continue;
    sug.seq += 1;
    const nova = { id: `s${sug.seq}`, ...s, retrabalhoPct: l.retrabalhoPct, estado: 'pendente', em: new Date(agoraMs).toISOString() };
    sug.lista.push(nova);
    novos.sugestoes.push(nova);
  }
}

// Um afrouxar pendente vale para o vigente de quando nasceu; se o vigente
// mudou (aperto, desfazer, aprovação), ele sai, para não segurar a
// sugestão atual do item nem cair em 'mudou' na aprovação.
function podarObsoletas(aj, sug) {
  sug.lista = sug.lista.filter((x) => x.tipo !== 'afrouxar' || x.estado !== 'pendente' || x.de === aj.vigentes[x.item]);
}

export function ajustar({ ap, aj, sug, config, agoraMs, roteamento }) {
  const novos = { ajustes: [], sugestoes: [] };
  const fora = [];
  aj.perfil = perfilDe(ap);
  podarObsoletas(aj, sug);
  if (!(agoraMs - ap.desde >= PISO_MS) || ap.sessoes < PISO_SESSOES) return { aj, sug, novos, fora };

  const mudar = (item, alvo, motivoSobe, motivoDesce) => {
    const atual = aj.vigentes[item];
    if (alvo === atual || !podeMudar(aj, item, agoraMs)) return;
    const depois = passoPara(item, atual, alvo);
    const hip = { ...aj.vigentes, [item]: depois };
    if (valorDoItem(item, depois) === undefined || hip['painel.amarelo'] >= hip['painel.vermelho']) {
      fora.push(item);
      return;
    }
    novos.ajustes.push(registrar(aj, item, depois, depois > atual ? motivoSobe : motivoDesce, 'auto', agoraMs));
  };

  const temHoraAtiva = aj.perfil.horasAtivas.some((m) => m !== 0);
  mudar('painel.intervaloS', temHoraAtiva ? INTERVALO_FORA_S : ITENS['painel.intervaloS'].padrao, 'fora-do-horario', 'horario-mudou');
  for (const item of ['painel.vermelho', 'painel.amarelo']) {
    const a = alvoDaFaixa(ap, item, agoraMs);
    if (a === null) continue;
    // ajuste-fora só quando o item poderia mudar: dentro das 24 h ou do
    // bloqueio, nada se descarta, como na guarda.
    if (a.fora) {
      if (podeMudar(aj, item, agoraMs)) fora.push(item);
    } else mudar(item, a.alvo, 'faixa-historico', 'faixa-historico');
  }
  mudar('previsao.pesoPerfil', cobertura(aj.perfil) >= COBERTURA_MIN ? PESO_ALVO : 0, 'perfil-por-hora', 'perfil-insuficiente');
  guarda(ap, aj, sug, config, agoraMs, novos, fora);
  // Um aperto deste passo deixa obsoleto o afrouxar pendente do item.
  podarObsoletas(aj, sug);
  modelos(ap, aj, sug, agoraMs, novos);
  subirAgentes(roteamento, aj, sug, agoraMs, novos);
  return { aj, sug, novos, fora };
}

// §4.7: sem id, o último ajuste que ainda vale (o mais novo do seu item e
// que não é um desfazer); com id, só se ele for o mais novo do item. Volta
// ao valor anterior e bloqueia o item por 7 dias. Se a volta deixaria
// amarelo ≥ vermelho, recusa com 'conflito' e não muda nada (desfaça antes
// a outra faixa); o texto ao usuário fica com quem renderiza o motivo.
export function desfazer(aj, id, agoraMs) {
  let alvo = null;
  if (id === null) {
    for (let i = aj.registros.length - 1; i >= 0 && alvo === null; i--) {
      const r = aj.registros[i];
      if (r.origem !== 'desfeito' && ultimoRegistro(aj, r.item) === r) alvo = r;
    }
    if (alvo === null) return { ok: false, motivo: 'nada' };
  } else {
    alvo = aj.registros.find((r) => r.id === id) ?? null;
    if (alvo === null) return { ok: false, motivo: 'nao-achou' };
    if (alvo.origem === 'desfeito' || ultimoRegistro(aj, alvo.item) !== alvo) return { ok: false, motivo: 'nao-e-o-ultimo' };
  }
  const hip = { ...aj.vigentes, [alvo.item]: alvo.antes };
  if (hip['painel.amarelo'] >= hip['painel.vermelho']) return { ok: false, motivo: 'conflito' };
  const registro = registrar(aj, alvo.item, alvo.antes, 'desfazer', 'desfeito', agoraMs);
  aj.bloqueios[alvo.item] = agoraMs + BLOQUEIO_MS;
  return { ok: true, aj, registro };
}

// Aprovar um afrouxamento (§4.4): só até o config.json; no valor dele ou
// acima, o vigente volta a null (= o config.json). Se o vigente mudou desde a
// sugestão, ela sai sem aplicar. Aprovar uma sugestão de modelo só a marca
// (§4.5: nunca aplicada).
export function aprovar(aj, sug, id, config, agoraMs) {
  const s = sug.lista.find((x) => x.id === id && x.estado === 'pendente');
  if (s === undefined) return { ok: false, motivo: 'nao-achou' };
  if (s.tipo === 'modelo') {
    s.estado = 'aprovada';
    return { ok: true, tipo: 'modelo', aj, sug, sugestao: s };
  }
  // Subir agente: a sugestão sai e quem chama grava roteamento.subir.
  if (s.tipo === 'subir-agente') {
    sug.lista = sug.lista.filter((x) => x !== s);
    return { ok: true, tipo: 'subir-agente', aj, sug, sugestao: s };
  }
  sug.lista = sug.lista.filter((x) => x !== s);
  const cfg = config?.[ITENS[s.item].campo];
  if (aj.vigentes[s.item] !== s.de || !Number.isInteger(cfg)) return { ok: false, motivo: 'mudou', aj, sug };
  const para = Math.min(s.para, cfg);
  const registro = registrar(aj, s.item, para >= cfg ? null : para, 'sobra-4-semanas', 'aprovado', agoraMs);
  return { ok: true, tipo: 'afrouxar', aj, sug, registro };
}

// O senhor afrouxou a guarda no /hadouken:limites (spec v0.5.3 VS Code,
// foco 3): o aperto do item sai (null = o config.json) e o item fica
// bloqueado 7 dias, para o aprendizado não reapertar na hora. Sem aperto
// vigente, só bloqueia, sem registro novo.
export function soltarAperto(aj, item, agoraMs) {
  if (!Object.hasOwn(ITENS, item) || ITENS[item].tipo !== 'guarda') return { ok: false, aj };
  if (aj.vigentes[item] !== null) registrar(aj, item, null, 'limites', 'limites', agoraMs);
  aj.bloqueios[item] = agoraMs + BLOQUEIO_MS;
  return { ok: true, aj };
}

// Recusar: a sugestão sai e a mesma (pela chave) fica bloqueada 7 dias.
export function recusar(sug, aj, id, agoraMs) {
  const s = sug.lista.find((x) => x.id === id && x.estado === 'pendente');
  if (s === undefined) return { ok: false, motivo: 'nao-achou' };
  sug.lista = sug.lista.filter((x) => x !== s);
  aj.bloqueios[chaveSugestao(s)] = agoraMs + BLOQUEIO_MS;
  return { ok: true, aj, sug, sugestao: s };
}

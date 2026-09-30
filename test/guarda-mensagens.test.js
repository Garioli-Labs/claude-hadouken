import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/guarda/mensagens.js';
import { horaLocal, quandoLocal } from '../src/util.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';

const H = 3_600_000;
const agora = Date.UTC(2026, 8, 29, 6, 0);
const agoraS = agora / 1000;
const mot = (trava, gatilho, dados, resets_at = agoraS + 3600, desde = new Date(agora - H).toISOString()) => ({ trava, gatilho, resets_at, dados, desde });

test('motivos por gatilho', () => {
  const q = agora + 7 * H;
  assert.equal(m.textoMotivo(mot('seven_day', 'G2', { quandoMs: q }, agoraS + 86_400), agora),
    `7d chega a 100% ${quandoLocal(q / 1000, agora)}, antes do reset ${quandoLocal(agoraS + 86_400, agora)}`);
  assert.equal(m.textoMotivo(mot('five_hour', 'G1', { quandoMs: agora + H }), agora),
    `5h chega a 100% às ${horaLocal(agoraS + 3600)}, antes do reset das ${horaLocal(agoraS + 3600)}`);
  assert.equal(m.textoMotivo(mot('seven_day', 'G4', { usado: 86.7, teto: 85, fresca: true, idadeMs: 0 }), agora), '7d em 86%, teto 85%');
  assert.equal(m.textoMotivo(mot('seven_day', 'G4', { usado: 86, teto: 85, fresca: false, idadeMs: 3 * H + 10 }), agora), '7d ≥ 86% (leitura de 3 h)');
  assert.equal(m.textoMotivo(mot('five_hour', 'G3', { usado: 91, teto: 90, fresca: true, idadeMs: 0 }), agora), '5h em 91%, teto 90%');
  assert.equal(m.textoMotivo(mot('fable', 'G6', { atMs: agora - H }), agora), `limite do Fable atingido ${quandoLocal(agoraS - 3600, agora)}`);
  assert.equal(m.textoMotivo(mot('fable-despachos', 'G7', { n: 4, max: 4, horas: 5 }), agora), '4 despachos Fable em 5 h, teto 4');
  assert.equal(m.textoMotivo(mot('fable-despachos', 'G7', { n: 0, max: 0, horas: 5, pct: 92 }), agora), 'Fable em 92% da semana: todo despacho Fable pede liberação');
  // O /usage pode gravar porcentagem com casas (S28): o piso inteiro, como na barra.
  assert.equal(m.textoMotivo(mot('fable-despachos', 'G7', { n: 0, max: 0, horas: 5, pct: 92.7 }), agora), 'Fable em 92% da semana: todo despacho Fable pede liberação');
  assert.equal(m.textoMotivo(mot('fable', 'G6', { atMs: agora - H, fonte: 'oficial' }), agora), `limite do Fable atingido ${quandoLocal(agoraS - 3600, agora)}`);
  assert.equal(m.textoMotivo(mot('ilegivel', null, null, null, null), agora), 'estado da guarda ilegível');
  assert.equal(m.textoMotivo(mot('seven_day', 'G2', null), agora), `trava de 7d desde ${quandoLocal(agoraS - 3600, agora)}`);
  assert.equal(m.textoMotivos([mot('ilegivel', null, null), mot('fable', 'G6', null)], agora),
    `estado da guarda ilegível; trava do Fable desde ${quandoLocal(agoraS - 3600, agora)}`);
});

test('P1: Claude, usuário e subagente', () => {
  const ms = [mot('seven_day', 'G4', { usado: 86, teto: 85, fresca: true, idadeMs: 0 })];
  assert.equal(m.p1Claude(ms, agora), 'hadouken: guarda ativa: 7d em 86%, teto 85%. Despacho de subagente bloqueado. Pare e pergunte ao usuário se ele libera; só ele libera, digitando /claude-hadouken:liberar. Não mude o plano dele por conta própria, não repita o despacho e não mexa nos arquivos do hadouken.');
  assert.equal(m.p1Usuario(ms, ['seven_day'], agora), 'hadouken parou o turno: 7d em 86%, teto 85%. Para seguir, digite /claude-hadouken:liberar.');
  assert.equal(m.p1Usuario(ms, ['seven_day', 'fable'], agora), 'hadouken parou o turno: 7d em 86%, teto 85%. Para seguir, digite /claude-hadouken:liberar fable.');
  assert.equal(m.p1Subagente(ms, agora), 'hadouken: guarda ativa: 7d em 86%, teto 85%. Novo despacho bloqueado. Termine sua tarefa sem abrir subagentes e relate o bloqueio.');
});

test('G5 despacho caro', () => {
  const fable = { modelo: 'fable', effort: 'xhigh', origem: 'frontmatter' };
  const outro = { modelo: 'outro', effort: 'max', origem: 'parametro' };
  assert.equal(m.caroMotivo(fable), 'despacho caro: Fable com effort xhigh');
  assert.equal(m.caroMotivo(outro), 'despacho caro: effort max');
  assert.equal(m.caroClaude(fable), 'hadouken: despacho caro: Fable com effort xhigh. Despacho bloqueado. Pare e pergunte ao usuário se ele libera ou prefere um modelo ou effort mais barato; só ele libera, digitando /claude-hadouken:liberar caro. Não repita o despacho e não mexa nos arquivos do hadouken.');
  assert.equal(m.caroUsuario(outro), 'hadouken parou o turno: despacho caro: effort max. Para seguir, digite /claude-hadouken:liberar caro.');
  assert.equal(m.caroSubagente(outro), 'hadouken: despacho caro: effort max. Despacho bloqueado. Termine sua tarefa sem abrir esse subagente e relate o bloqueio.');
});

test('P2, P3, P4, P5', () => {
  const ms = [mot('fable', 'G6', { atMs: agora - H })];
  const txt = `limite do Fable atingido ${quandoLocal(agoraS - 3600, agora)}`;
  assert.equal(m.p2Usuario(ms, ['fable'], agora), `hadouken: guarda ativa: ${txt}. Esta sessão está no Fable. Troque com /model ou libere com /claude-hadouken:liberar fable.`);
  assert.equal(m.p3Usuario(ms, ['fable'], agora), `hadouken: guarda ativa: ${txt}. Troca para o Fable bloqueada; libere com /claude-hadouken:liberar fable.`);
  assert.equal(m.P4_TEXTO, 'hadouken: bloqueado: sessões claude filhas ficam fechadas com a guarda ativa.');
  assert.equal(m.P5_TEXTO, 'hadouken: bloqueado: arquivos do hadouken só o usuário edita.');
  assert.equal(m.P4_LIBERAR_TEXTO, 'hadouken: bloqueado: uma sessão claude filha não libera a guarda. Pare e pergunte ao usuário; só ele libera, digitando /claude-hadouken:liberar. Se o texto só cita o comando (numa mensagem de commit, por exemplo), use git commit -F <arquivo>.');
});

test('liberação: confirmação, linha seguinte ao Claude e recusas', () => {
  const ate = agora + 2 * H;
  const lib = { id: 'abcdef01', ate: new Date(ate).toISOString(), solta: ['five_hour', 'seven_day', 'fable-despachos', 'ilegivel'], base7d: 84, tetoPontos7d: 10 };
  const q = quandoLocal(ate / 1000, agora);
  assert.equal(m.liberado(lib, agora), `hadouken: liberado até ${q} (ou até 7d 94%).`);
  assert.equal(m.posLiberacao(lib, agora), `hadouken: o usuário liberou a guarda até ${q} ou até 7d 94%.`);
  const libFable = { ...lib, base7d: null, solta: [...lib.solta, 'fable', 'despacho-caro'] };
  assert.equal(m.liberado(libFable, agora), `hadouken: liberado até ${q}, com Fable (pode consumir créditos de uso) e despacho caro.`);
  assert.equal(m.posLiberacao(libFable, agora), `hadouken: o usuário liberou a guarda até ${q}, com Fable e despacho caro.`);
  assert.equal(m.recusadoArgs(24), 'hadouken: nada liberado. Use /claude-hadouken:liberar [Nh | janela] [fable] [caro], com N de 1 a 24.');
  assert.equal(m.RECUSADO_ENTRYPOINT, 'hadouken: nada liberado. A liberação só vale digitada pelo usuário numa sessão interativa.');
  assert.equal(m.NAO_GRAVADO, 'hadouken: nada liberado. A liberação não pôde ser gravada.');
});

test('segmento da barra', () => {
  const base = { marcada: true, status: 'armada', ativas: [], liberacao: null, origemConhecida: true, fableSessao: false, despachosFable: [], config: PADRAO_GUARDA };
  assert.equal(m.segmentoBarra(base, agora), '');
  assert.equal(m.segmentoBarra({ ...base, marcada: false }, agora), 'sem guarda nesta sessão');
  assert.equal(m.segmentoBarra({ ...base, status: 'desligada' }, agora), 'guarda desligada');
  assert.equal(m.segmentoBarra({ ...base, status: 'erro' }, agora), 'guarda com erro');
  assert.equal(m.segmentoBarra({ ...base, status: 'sem-leitura' }, agora), 'guarda sem leitura');
  assert.equal(m.segmentoBarra({ ...base, status: 'disparada', ativas: ['seven_day', 'fable', 'fable-despachos'] }, agora), 'guarda: 7d + Fable');
  assert.equal(m.segmentoBarra({ ...base, status: 'disparada', ativas: ['ilegivel'] }, agora), 'guarda: ilegível');
  const lib = { ate: new Date(agora + 2 * H).toISOString() };
  assert.equal(m.segmentoBarra({ ...base, status: 'liberada', liberacao: lib }, agora), `liberada até ${quandoLocal(agoraS + 7200, agora)}`);
  assert.equal(m.segmentoBarra({ ...base, status: 'liberada', liberacao: lib, origemConhecida: false }, agora), `liberada até ${quandoLocal(agoraS + 7200, agora)} · liberação sem origem`);
  assert.equal(m.segmentoBarra({ ...base, fableSessao: true, despachosFable: [agora - H, agora - 2 * H, agora - 6 * H] }, agora), 'Fable 2/4 em 5h · sem leitura oficial');
});

// M3 e M4 da revisão final da parte 1: a liberação em vigor aparece ao lado
// das travas que ela não cobre (a statusline só a passa com a cobertura
// ativa), e um evento 'erro' recente de hook mostra "guarda com erro" (§4.5).
test('segmento da barra: liberação ao lado das travas e erro recente de hook', () => {
  const base = { marcada: true, status: 'armada', ativas: [], liberacao: null, origemConhecida: true, fableSessao: false, despachosFable: [], config: PADRAO_GUARDA };
  const lib = { ate: new Date(agora + 2 * H).toISOString() };
  const ate = `liberada até ${quandoLocal(agoraS + 7200, agora)}`;
  const disparada = { ...base, status: 'disparada', ativas: ['fable'], liberacao: lib };
  assert.equal(m.segmentoBarra(disparada, agora), `guarda: Fable · ${ate}`);
  assert.equal(m.segmentoBarra({ ...disparada, origemConhecida: false }, agora), `guarda: Fable · ${ate} · liberação sem origem`);
  assert.equal(m.segmentoBarra({ ...base, status: 'sem-leitura', liberacao: lib }, agora), `guarda sem leitura · ${ate}`);
  assert.equal(m.segmentoBarra({ ...base, erroRecente: true }, agora), 'guarda com erro');
  assert.equal(m.segmentoBarra({ ...disparada, erroRecente: true }, agora), `guarda: Fable · guarda com erro · ${ate}`);
  assert.equal(m.segmentoBarra({ ...base, status: 'liberada', liberacao: lib, erroRecente: true }, agora), `guarda com erro · ${ate}`);
  // Uma vez só com a avaliação da barra em erro; desligada, só "desligada".
  assert.equal(m.segmentoBarra({ ...base, status: 'erro', erroRecente: true }, agora), 'guarda com erro');
  assert.equal(m.segmentoBarra({ ...base, status: 'desligada', liberacao: lib, erroRecente: true }, agora), 'guarda desligada');
});

test('segmento da barra: semana do Fable pela leitura oficial (E2, E7)', () => {
  const base = { marcada: true, status: 'armada', ativas: [], liberacao: null, origemConhecida: true, fableSessao: true, despachosFable: [agora - H], config: PADRAO_GUARDA };
  const u = (pct, idadeMs, resetsAtMs = agora + 48 * H) => ({ pct, resetsAtMs, idadeMs });
  assert.equal(m.segmentoBarra({ ...base, usoFable: u(57.8, 60_000) }, agora), 'Fable 1/4 em 5h · semana Fable 57%');
  assert.equal(m.segmentoBarra({ ...base, usoFable: u(57, 15 * 60_000) }, agora), 'Fable 1/4 em 5h · semana Fable 57%');
  assert.equal(m.segmentoBarra({ ...base, usoFable: u(57, 60_000, null) }, agora), 'Fable 1/4 em 5h · semana Fable 57%');
  assert.equal(m.segmentoBarra({ ...base, usoFable: u(57, 40 * 60_000) }, agora), 'Fable 1/4 em 5h · semana Fable ≥ 57% (leitura de 40 min)');
  assert.equal(m.segmentoBarra({ ...base, usoFable: u(57, 3 * H + 10) }, agora), 'Fable 1/4 em 5h · semana Fable ≥ 57% (leitura de 3 h)');
  for (const hostil of [undefined, null, 'x', u(101, 0), u(Number.NaN, 0), u(57, -1), u(57, 60_000, agora - 1)]) {
    assert.equal(m.segmentoBarra({ ...base, usoFable: hostil }, agora), 'Fable 1/4 em 5h · sem leitura oficial', JSON.stringify(hostil));
  }
});

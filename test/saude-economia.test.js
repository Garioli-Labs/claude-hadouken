import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_ECONOMIA, linhaDaSemana, resumoEconomia, semanaIso } from '../src/saude/economia.js';

// Spec v0.5.5 §6.J e §9.1 item 3: só o que já é registrado (eventos da guarda
// e roteamento.json), uma vez por semana, sempre marcado como estimativa.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-economia-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novo = () => fs.mkdtempSync(path.join(tmp, 'd'));
// Quarta, 28/10/2026, 12:00 local.
const AGORA = new Date(2026, 9, 28, 12, 0, 0).getTime();
const DIA = 86_400_000;

function eventos(dir, lista) {
  fs.writeFileSync(path.join(dir, 'guarda-eventos.json'), JSON.stringify({ v: 1, eventos: lista.map(([tipo, ms]) => ({ at: new Date(ms).toISOString(), tipo, detalhe: null })) }));
}
function despachos(dir, lista) {
  const d = lista.map(([decisao, regra, ms]) => ({ sessao: 's1', agente: 'Explore', familia: 'opus', effort: null, regra, decisao, em: ms, tamPrompt: 10, palavras: [] }));
  fs.writeFileSync(path.join(dir, 'roteamento.json'), JSON.stringify({ versao: 1, despachos: d }));
}
const respostasHaiku = (n, tokens) => Array.from({ length: n }, () => ({ subagente: true, model: 'claude-haiku-5-5', input: tokens, output: 0, cacheRead: 0, cacheCreate: 0 }));

test('conta só eventos dos últimos 7 dias', () => {
  const dir = novo();
  eventos(dir, [['negado', AGORA - DIA], ['perguntado', AGORA - 2 * DIA], ['negado', AGORA - 8 * DIA], ['liberacao', AGORA - DIA], ['troca-bloqueada', AGORA - DIA]]);
  despachos(dir, [['negar', 'N1', AGORA - DIA], ['avisar', 'A2', AGORA - DIA], ['passar', null, AGORA - DIA], ['negar', 'N2', AGORA - 9 * DIA]]);
  const r = resumoEconomia({ dir, agoraMs: AGORA });
  assert.deepEqual(r.contagens, { guarda: 2, trocas: 1, rebaixamentos: 2 });
});

test('sem base medida: sem tokens, e o texto ainda diz estimativa', () => {
  const dir = novo();
  despachos(dir, [['negar', 'N1', AGORA - DIA]]);
  const r = resumoEconomia({ dir, agoraMs: AGORA, respostasSubagente: respostasHaiku(4, 9000) });
  assert.equal(r.tokensEstimados, null);
  assert.equal(r.texto, 'hadouken na semana (estimativa): 1 rebaixamento do roteamento.');
});

test('com base: texto traz estimativa de tokens', () => {
  const dir = novo();
  eventos(dir, [['negado', AGORA - DIA], ['perguntado', AGORA - DIA]]);
  despachos(dir, [['negar', 'N1', AGORA - DIA], ['negar', 'N2', AGORA - DIA]]);
  const r = resumoEconomia({ dir, agoraMs: AGORA, respostasSubagente: respostasHaiku(5, 12_000) });
  assert.equal(r.tokensEstimados, 24_000);
  assert.equal(r.texto, 'hadouken na semana (estimativa): 2 despachos perguntados ou negados pela guarda, 2 rebaixamentos do roteamento; ~24 mil tokens poupados.');
});

test('nada a contar: null', () => {
  const r = resumoEconomia({ dir: novo(), agoraMs: AGORA });
  assert.equal(r.texto, null);
  assert.equal(r.tokensEstimados, null);
});

test('semanaIso: segunda abre a semana; virada de ano pela quinta', () => {
  assert.equal(semanaIso(new Date(2026, 9, 26, 0, 1).getTime()), '2026-W44');
  assert.equal(semanaIso(new Date(2026, 10, 1, 23, 59).getTime()), '2026-W44');
  assert.equal(semanaIso(new Date(2026, 10, 2, 0, 1).getTime()), '2026-W45');
  assert.equal(semanaIso(new Date(2027, 0, 1, 12).getTime()), '2026-W53');
  assert.equal(semanaIso(new Date(2024, 11, 30, 12).getTime()), '2025-W01');
});

test('segunda sessão da semana não repete; na semana seguinte volta', () => {
  const dir = novo();
  eventos(dir, [['negado', AGORA - DIA]]);
  const cfg = { ligado: true, economia: true };
  assert.match(linhaDaSemana({ dir, agoraMs: AGORA, config: cfg }), /^hadouken na semana \(estimativa\): 1 despacho perguntado ou negado pela guarda\.$/);
  assert.equal(linhaDaSemana({ dir, agoraMs: AGORA + 3600_000, config: cfg }), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ARQ_ECONOMIA), 'utf8')).semana, '2026-W44');
  eventos(dir, [['negado', AGORA + 6 * DIA]]);
  assert.match(linhaDaSemana({ dir, agoraMs: AGORA + 6 * DIA, config: cfg }), /1 despacho/);
});

test('desligada ou sem nada: não fala; sem nada, a semana conta como vista', () => {
  const dir = novo();
  eventos(dir, [['negado', AGORA - DIA]]);
  assert.equal(linhaDaSemana({ dir, agoraMs: AGORA, config: { ligado: true, economia: false } }), null);
  assert.equal(linhaDaSemana({ dir, agoraMs: AGORA, config: { ligado: false, economia: true } }), null);
  assert.equal(fs.existsSync(path.join(dir, ARQ_ECONOMIA)), false);
  const vazio = novo();
  assert.equal(linhaDaSemana({ dir: vazio, agoraMs: AGORA, config: { ligado: true, economia: true } }), null);
  assert.equal(fs.existsSync(path.join(vazio, ARQ_ECONOMIA)), true);
});

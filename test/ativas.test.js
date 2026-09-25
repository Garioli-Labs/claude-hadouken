import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrarSessao, sessaoAtiva, ARQ_ATIVAS } from '../src/ativas.js';
import { lerJson, SESSAO_MAX_MS } from '../src/estado.js';

// Registro de ativação (spec 8.2): só sessões que passaram pelo SessionStart
// do plugin ganham barra e hooks.

let dir;
const homeOriginal = process.env.HADOUKEN_HOME;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadouken ativas ç '));
  process.env.HADOUKEN_HOME = dir;
});
afterEach(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
});

const H = 3600_000;
const agora = Date.UTC(2026, 8, 25, 18, 0);
const iso = (ms) => new Date(ms).toISOString();
const arq = () => path.join(dir, ARQ_ATIVAS);
const gravar = (valor) => fs.writeFileSync(arq(), typeof valor === 'string' ? valor : JSON.stringify(valor));

test('ARQ_ATIVAS é ativas.json', () => {
  assert.equal(ARQ_ATIVAS, 'ativas.json');
});

test('registrarSessao grava o formato e sessaoAtiva reconhece', () => {
  assert.deepEqual(registrarSessao('s1', agora), { ok: true });
  assert.deepEqual(lerJson(arq()).valor, { versao: 1, sessoes: { s1: { at: iso(agora) } } });
  assert.equal(sessaoAtiva('s1', agora), true);
  assert.equal(sessaoAtiva('s2', agora), false);
  assert.deepEqual(fs.readdirSync(dir), [ARQ_ATIVAS]);
});

test('sem registro: inativa e nada gravado', () => {
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('registro com mais de 24 h não vale; até 24 h vale', () => {
  registrarSessao('s1', agora);
  assert.equal(sessaoAtiva('s1', agora + 23 * H), true);
  assert.equal(sessaoAtiva('s1', agora + SESSAO_MAX_MS), true);
  assert.equal(sessaoAtiva('s1', agora + SESSAO_MAX_MS + 1), false);
  assert.equal(sessaoAtiva('s1', agora + 25 * H), false);
});

test('registrar de novo renova o at', () => {
  registrarSessao('s1', agora);
  registrarSessao('s1', agora + 20 * H);
  assert.equal(sessaoAtiva('s1', agora + 30 * H), true);
  assert.deepEqual(lerJson(arq()).valor.sessoes, { s1: { at: iso(agora + 20 * H) } });
});

test('gravação poda entradas com mais de 24 h', () => {
  registrarSessao('s1', agora);
  registrarSessao('s2', agora + 25 * H);
  assert.deepEqual(Object.keys(lerJson(arq()).valor.sessoes), ['s2']);
});

test('no máximo 200 entradas: a atual e as mais recentes', () => {
  const sessoes = {};
  // v0 é a mais recente das antigas; a ordem de gravação é embaralhada de propósito.
  const ordem = Array.from({ length: 250 }, (_, i) => i).sort((a, b) => ((a * 7919) % 250) - ((b * 7919) % 250));
  for (const i of ordem) sessoes[`v${i}`] = { at: iso(agora - (i + 1) * 60_000) };
  gravar({ versao: 1, sessoes });
  assert.deepEqual(registrarSessao('nova', agora), { ok: true });
  const ids = Object.keys(lerJson(arq()).valor.sessoes);
  assert.equal(ids.length, 200);
  assert.equal(ids[0], 'nova');
  assert.deepEqual(ids.slice(1), Array.from({ length: 199 }, (_, i) => `v${i}`));
  assert.equal(sessaoAtiva('v198', agora), true);
  assert.equal(sessaoAtiva('v199', agora), false);
});

test('sessão já registrada entre as 200 não se duplica e vai para o topo', () => {
  const sessoes = {};
  for (let i = 0; i < 250; i++) sessoes[`v${i}`] = { at: iso(agora - (i + 1) * 60_000) };
  gravar({ versao: 1, sessoes });
  registrarSessao('v240', agora);
  const valor = lerJson(arq()).valor.sessoes;
  const ids = Object.keys(valor);
  assert.equal(ids.length, 200);
  assert.equal(ids[0], 'v240');
  assert.equal(valor.v240.at, iso(agora));
  assert.equal(ids.filter((id) => id === 'v240').length, 1);
});

const IDS_RUINS = [
  '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__',
  '../x', '..', '.', 'a/b', 'a\\b', 'C:x', '/etc/passwd', '..\\..\\x', ' s1', 's1 ', 's1\n', 's1\x00',
  '', 'x'.repeat(65), 42, null, undefined, {}, ['s1'], true,
];

test('ids inválidos: registrarSessao não grava e sessaoAtiva é false', () => {
  for (const id of IDS_RUINS) {
    assert.deepEqual(registrarSessao(id, agora), { ok: false, motivo: 'id_invalido' }, String(id));
    assert.equal(sessaoAtiva(id, agora), false, String(id));
  }
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(sessaoAtiva(Symbol('s1'), agora), false);
  assert.deepEqual(registrarSessao(Symbol('s1'), agora), { ok: false, motivo: 'id_invalido' });
});

test('chaves de protótipo gravadas à mão nunca ativam e saem na regravação', () => {
  const at = iso(agora);
  gravar(`{"versao":1,"sessoes":{"__proto__":{"at":"${at}"},"constructor":{"at":"${at}"},"toString":{"at":"${at}"},"s1":{"at":"${at}"}}}`);
  for (const id of ['__proto__', 'constructor', 'toString']) assert.equal(sessaoAtiva(id, agora), false, id);
  assert.equal(sessaoAtiva('s1', agora), true);
  assert.deepEqual(registrarSessao('s2', agora), { ok: true });
  const bruto = fs.readFileSync(arq(), 'utf8');
  assert.ok(!bruto.includes('__proto__'));
  assert.ok(!bruto.includes('constructor'));
  assert.ok(!bruto.includes('toString'));
  assert.deepEqual(Object.keys(JSON.parse(bruto).sessoes).sort(), ['s1', 's2']);
});

test('sessaoAtiva só olha chaves próprias, mesmo com Object.prototype poluído', () => {
  gravar({ versao: 1, sessoes: { s1: { at: iso(agora) } } });
  Object.prototype.s9 = { at: iso(agora) };
  try {
    assert.equal(sessaoAtiva('s9', agora), false);
    assert.equal(sessaoAtiva('s1', agora), true);
  } finally {
    delete Object.prototype.s9;
  }
});

test('sessoes em array nunca ativa o id "0"', () => {
  gravar({ versao: 1, sessoes: [{ at: iso(agora) }] });
  assert.equal(sessaoAtiva('0', agora), false);
});

test('ativas.json adulterado ou malformado: inativo e nada lança', () => {
  const at = iso(agora);
  const casos = [
    'lixo{', '', '[]', 'null', '42', '"s1"', '{}',
    JSON.stringify({ versao: 2, sessoes: { s1: { at } } }),
    JSON.stringify({ versao: '1', sessoes: { s1: { at } } }),
    JSON.stringify({ sessoes: { s1: { at } } }),
    JSON.stringify({ versao: 1, sessoes: null }),
    JSON.stringify({ versao: 1, sessoes: 's1' }),
    JSON.stringify({ versao: 1, sessoes: { s1: null } }),
    JSON.stringify({ versao: 1, sessoes: { s1: at } }),
    JSON.stringify({ versao: 1, sessoes: { s1: [at] } }),
    JSON.stringify({ versao: 1, sessoes: { s1: {} } }),
    JSON.stringify({ versao: 1, sessoes: { s1: { at: 'ontem' } } }),
    JSON.stringify({ versao: 1, sessoes: { s1: { at: agora } } }),
    JSON.stringify({ versao: 1, sessoes: { s1: { at: iso(agora + H) } } }),
    JSON.stringify({ versao: 1, sessoes: { s1: { at: `${at}${' '.repeat(100)}` } } }),
  ];
  for (const c of casos) {
    gravar(c);
    assert.equal(sessaoAtiva('s1', agora), false, c);
  }
});

test('ativas.json de 2 MB: inativo, e o registro recomeça do zero', () => {
  gravar(JSON.stringify({ versao: 1, sessoes: { s1: { at: iso(agora) } }, lixo: 'x'.repeat(2 * 1024 * 1024) }));
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.deepEqual(registrarSessao('s2', agora), { ok: true });
  assert.deepEqual(lerJson(arq()).valor, { versao: 1, sessoes: { s2: { at: iso(agora) } } });
});

test('ativas.json que é diretório: inativo, e registrar falha sem lançar', () => {
  fs.mkdirSync(arq());
  assert.equal(sessaoAtiva('s1', agora), false);
  const r = registrarSessao('s1', agora);
  assert.equal(r.ok, false);
  assert.equal(typeof r.motivo, 'string');
  assert.ok(fs.statSync(arq()).isDirectory());
  assert.deepEqual(fs.readdirSync(dir), [ARQ_ATIVAS]);
});

test('registro sobre lixo se recupera', () => {
  gravar('lixo{');
  assert.deepEqual(registrarSessao('s1', agora), { ok: true });
  assert.equal(sessaoAtiva('s1', agora), true);
});

test('sessaoAtiva é leitura pura: não grava, não poda, não renova', () => {
  gravar({ versao: 1, sessoes: { s1: { at: iso(agora) }, velha: { at: iso(agora - 30 * H) } } });
  const antes = fs.readFileSync(arq());
  const mtime = fs.statSync(arq()).mtimeMs;
  for (const [id, t] of [['s1', agora], ['s1', agora + 30 * H], ['velha', agora], ['nada', agora]]) sessaoAtiva(id, t);
  assert.deepEqual(fs.readFileSync(arq()), antes);
  assert.equal(fs.statSync(arq()).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(dir), [ARQ_ATIVAS]);
});

test('agoraMs inválido: não registra e não ativa', () => {
  registrarSessao('s1', agora);
  const antes = fs.readFileSync(arq(), 'utf8');
  for (const t of [NaN, Infinity, -Infinity, '1', null, undefined, 1e20]) {
    assert.deepEqual(registrarSessao('s2', t), { ok: false, motivo: 'agora' }, String(t));
    assert.equal(sessaoAtiva('s1', t), false, String(t));
  }
  assert.equal(fs.readFileSync(arq(), 'utf8'), antes);
});

test('sem home: registrarSessao devolve sem_diretorio e sessaoAtiva é false', () => {
  delete process.env.HADOUKEN_HOME;
  const original = os.homedir;
  const falsos = [() => { throw new Error('sem home'); }, () => '', () => 'relativo/home', () => undefined];
  try {
    for (const falso of falsos) {
      os.homedir = falso;
      assert.deepEqual(registrarSessao('s1', agora), { ok: false, motivo: 'sem_diretorio' });
      assert.equal(sessaoAtiva('s1', agora), false);
    }
  } finally {
    os.homedir = original;
  }
});

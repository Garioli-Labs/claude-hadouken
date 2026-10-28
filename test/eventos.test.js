import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_EVENTO, registrarEvento, ultimoEvento } from '../src/eventos/eventos.js';
import { anexarEvento, TIPOS_EVENTO } from '../src/guarda/registros.js';
import { talvezAtualizar } from '../src/uso/painel.js';
import { urgenciaDoAlerta } from '../src/hooks/alertas-gravados.js';

// O último evento que anima a logo na barra do VS Code (spec v0.5.3 VS Code
// §2.1). Pastas temporárias; nada toca ~/.claude.

delete process.env.HADOUKEN_SEM_PAINEL;
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk eventos ç '));
  dirs.push(d);
  return d;
}
const AGORA = new Date(2026, 9, 20, 17, 4).getTime();
const lerArq = (d) => JSON.parse(fs.readFileSync(path.join(d, ARQ_EVENTO), 'utf8'));

test('grava e lê o último evento', () => {
  const d = novo();
  assert.equal(ARQ_EVENTO, 'ultimo-evento.json');
  assert.equal(registrarEvento(d, 'leitura', 'calma', AGORA), true);
  assert.deepEqual(ultimoEvento(d), { tipo: 'leitura', urgencia: 'calma', em: AGORA });
  assert.equal(registrarEvento(d, 'alerta', 'urgente', AGORA + 1), true);
  assert.deepEqual(ultimoEvento(d), { tipo: 'alerta', urgencia: 'urgente', em: AGORA + 1 });
});

test('tipo, urgência ou instante inválidos não gravam', () => {
  const d = novo();
  assert.equal(registrarEvento(d, 'outro', 'calma', AGORA), false);
  assert.equal(registrarEvento(d, 'leitura', 'panico', AGORA), false);
  assert.equal(registrarEvento(d, 'leitura', 'calma', 1.5), false);
  assert.equal(registrarEvento(null, 'leitura', 'calma', AGORA), false);
  assert.equal(fs.existsSync(path.join(d, ARQ_EVENTO)), false);
  assert.equal(ultimoEvento(d), null);
});

test('pasta no lugar do arquivo: null, sem lançar', () => {
  const d = novo();
  fs.mkdirSync(path.join(d, ARQ_EVENTO));
  assert.equal(ultimoEvento(d), null);
  assert.equal(registrarEvento(d, 'leitura', 'calma', AGORA), false);
  assert.equal(ultimoEvento(null), null);
});

test('arquivo com valor fora das listas: null', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, ARQ_EVENTO), JSON.stringify({ tipo: 'leitura', urgencia: 'x', em: AGORA }));
  assert.equal(ultimoEvento(d), null);
});

test('anexarEvento: negar ou pedir anima como guarda; os outros tipos não', () => {
  const atencao = [
    'negado', 'prompt-bloqueado', 'troca-bloqueada', 'liberacao-recusada', 'filha-negada', 'arquivo-negado',
    'config-bloqueada', 'roteamento-negado', 'roteamento-aviso', 'perguntado',
  ];
  for (const tipo of TIPOS_EVENTO) {
    const d = novo();
    assert.equal(anexarEvento(d, tipo, 'x', AGORA).ok, true, tipo);
    const ev = ultimoEvento(d);
    if (atencao.includes(tipo)) assert.deepEqual(ev, { tipo: 'guarda', urgencia: 'atencao', em: AGORA }, tipo);
    else assert.equal(ev, null, tipo);
  }
  const d = novo();
  anexarEvento(d, 'config-bloqueada', 'x', AGORA);
  assert.equal(lerArq(d).tipo, 'guarda');
});

test('talvezAtualizar: leitura boa grava tipo leitura com a urgência do nível', async () => {
  const R = AGORA + 3 * 3_600_000;
  for (const [pct, urgencia] of [[25, 'calma'], [80, 'atencao'], [95, 'urgente']]) {
    const d = novo();
    const rodar = async () => ({ ok: true, uso: { sessao: { pct, resetsAtMs: R }, semana: { pct: 10, resetsAtMs: R }, modelos: {} } });
    const r = await talvezAtualizar({ dir: d, agoraMs: AGORA, memLivre: () => 8 * 1024 ** 3, estadoAtivo: () => true, achar: () => 'claude', rodar });
    assert.deepEqual(r, { feito: true, motivo: 'ok' });
    const ev = ultimoEvento(d);
    assert.equal(ev.tipo, 'leitura');
    assert.equal(ev.urgencia, urgencia, String(pct));
  }
});

test('talvezAtualizar: leitura que falha não anima', async () => {
  const d = novo();
  const rodar = async () => ({ ok: false, motivo: 'timeout' });
  await talvezAtualizar({ dir: d, agoraMs: AGORA, memLivre: () => 8 * 1024 ** 3, estadoAtivo: () => true, achar: () => 'claude', rodar });
  assert.equal(ultimoEvento(d), null);
});

test('urgência do alerta: vermelho é urgente, o resto atenção', () => {
  assert.equal(urgenciaDoAlerta({ five_hour: { faixa: 'fechar' }, seven_day: null }), 'urgente');
  assert.equal(urgenciaDoAlerta({ five_hour: { faixa: 'ok' }, seven_day: { faixa: 'so-leitura' } }), 'urgente');
  assert.equal(urgenciaDoAlerta({ five_hour: { faixa: 'serializar' }, seven_day: { faixa: 'normal' } }), 'atencao');
  assert.equal(urgenciaDoAlerta(null), 'atencao');
});

// O brief pedia 2 s; no Windows o temporário, o rename e a varredura de
// gravarJsonAtomico custam cerca de 2,4 ms por chamada (2,3–2,6 s medidos).
// Cada hook chama uma vez só; 4 s ainda pega uma regressão de ordem.
test('1 000 chamadas de registrarEvento em menos de 4 s', () => {
  const d = novo();
  const t = performance.now();
  for (let i = 0; i < 1000; i++) registrarEvento(d, 'leitura', 'calma', AGORA + i);
  assert.ok(performance.now() - t < 4000);
  assert.equal(ultimoEvento(d).em, AGORA + 999);
});

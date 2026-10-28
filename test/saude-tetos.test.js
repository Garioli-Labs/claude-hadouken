import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirTetos, ARQ_TETOS, PARTES } from '../src/saude/tetos.js';

// Spec v0.5.5 §6.F: parte opcional de hook que passa do teto em 3 das
// últimas 10 execuções fica desligada por 24 h. O hook nunca espera por ela.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-tetos-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novoDir = () => fs.mkdtempSync(path.join(tmp, 'd'));
const AGORA = 1_800_000_000_000;
const DIA = 86_400_000;
const CONFIG = { tetoHooks: { ligado: true, ms: 40 } };

// Relógio falso: cada fn "dura" o que a lista manda.
function relogioFalso() {
  let t = 0;
  return { relogio: () => t, passar: (ms) => { t += ms; } };
}

async function execucoes(d, agoraMs, duracoes, nome = 'previsao') {
  const r = relogioFalso();
  const tetos = abrirTetos(d, agoraMs, { relogio: r.relogio, config: CONFIG });
  const saidas = [];
  for (const ms of duracoes) saidas.push(await tetos.rodar(nome, () => { r.passar(ms); return 'ok'; }));
  tetos.fechar();
  return { saidas, tetos };
}

test('nomes fixos: nome fora da lista é erro de programação', async () => {
  assert.deepEqual(PARTES, ['aprendizado', 'versao', 'painel', 'previsao', 'coletor', 'roteamento-otimizacoes']);
  const tetos = abrirTetos(novoDir(), AGORA, { config: CONFIG });
  await assert.rejects(() => tetos.rodar('inventada', () => 1), /parte desconhecida/);
});

test('3 estouros em 10 desligam por 24 h', async () => {
  const d = novoDir();
  const { saidas, tetos } = await execucoes(d, AGORA, [10, 50, 10, 60, 10, 70, 10]);
  assert.deepEqual(saidas, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', undefined]);
  assert.deepEqual(tetos.desligadas(), [{ nome: 'previsao', ateMs: AGORA + DIA }]);
  // outra execução do hook, mais tarde, continua pulando
  const r2 = await execucoes(d, AGORA + 1000, [10]);
  assert.deepEqual(r2.saidas, [undefined]);
  const eventos = fs.readFileSync(path.join(d, 'guarda-eventos.json'), 'utf8');
  assert.match(eventos, /teto:previsao/);
});

test('2 em 10 não', async () => {
  const d = novoDir();
  const { saidas, tetos } = await execucoes(d, AGORA, [50, 10, 10, 10, 10, 10, 10, 10, 10, 10, 50, 10]);
  // dois estouros a 10 execuções de distância: nunca 3 na mesma janela
  assert.ok(saidas.every((s) => s === 'ok'));
  assert.deepEqual(tetos.desligadas(), []);
});

test('a janela de 10 sobrevive entre execuções do hook', async () => {
  const d = novoDir();
  await execucoes(d, AGORA, [50, 50]);
  const r = await execucoes(d, AGORA + 1000, [50, 10]);
  assert.deepEqual(r.saidas, ['ok', undefined]);
});

test('volta depois de 24 h', async () => {
  const d = novoDir();
  await execucoes(d, AGORA, [50, 50, 50]);
  const r = await execucoes(d, AGORA + DIA + 1, [10, 50, 50]);
  assert.deepEqual(r.saidas, ['ok', 'ok', 'ok']);
  assert.deepEqual(r.tetos.desligadas(), []);
});

test('fn que lança: rodar devolve undefined e conta como execução', async () => {
  const d = novoDir();
  const r = relogioFalso();
  const tetos = abrirTetos(d, AGORA, { relogio: r.relogio, config: CONFIG });
  for (let i = 0; i < 3; i++) {
    assert.equal(await tetos.rodar('versao', () => { r.passar(100); throw new Error('x'); }), undefined);
  }
  assert.deepEqual(tetos.desligadas().map((x) => x.nome), ['versao']);
  tetos.fechar();
});

test('fn assíncrona é medida até resolver', async () => {
  const d = novoDir();
  const r = relogioFalso();
  const tetos = abrirTetos(d, AGORA, { relogio: r.relogio, config: CONFIG });
  for (let i = 0; i < 3; i++) await tetos.rodar('painel', async () => { await null; r.passar(100); return 1; });
  assert.deepEqual(tetos.desligadas().map((x) => x.nome), ['painel']);
});

test('fechar sem mudança não grava', async () => {
  const d = novoDir();
  const tetos = abrirTetos(d, AGORA, { config: CONFIG });
  tetos.fechar();
  assert.equal(fs.existsSync(path.join(d, ARQ_TETOS)), false);
});

test('tetos.json corrompido ou com prazo absurdo: começa vazio', async () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, ARQ_TETOS), '{lixo');
  assert.deepEqual((await execucoes(d, AGORA, [10])).saidas, ['ok']);
  fs.writeFileSync(path.join(d, ARQ_TETOS), JSON.stringify({ v: 1, partes: { previsao: { execucoes: [], desligadaAteMs: AGORA + 400 * DIA } } }));
  assert.deepEqual((await execucoes(d, AGORA, [10])).saidas, ['ok']);
});

test('saude.tetoHooks desligado: só roda, nem mede nem pula', async () => {
  const d = novoDir();
  await execucoes(d, AGORA, [50, 50, 50]);
  const r = relogioFalso();
  const tetos = abrirTetos(d, AGORA + 1000, { relogio: r.relogio, config: { tetoHooks: { ligado: false, ms: 40 } } });
  assert.equal(await tetos.rodar('previsao', () => 'ok'), 'ok');
  assert.deepEqual(tetos.desligadas(), []);
});

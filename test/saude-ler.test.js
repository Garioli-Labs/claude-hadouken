import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_SAUDE, ARQ_TRAVA_SAUDE, lerSaude, talvezColetar } from '../src/saude/ler.js';
import { conteudoTrava } from '../src/saude/trava-pid.js';

// Spec v0.5.5 §6.A: os hooks só leem saude.json e, quando ele está velho,
// disparam o coletor desanexado; nunca coletam nem esperam.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-saude-ler-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novoDir = () => fs.mkdtempSync(path.join(tmp, 'd'));
const AGORA = 1_800_000_000_000;
const MIN = 60_000;

const leitura = (em, extra = {}) => ({
  versao: 1, em,
  ram: { totalBytes: 16e9, livreBytes: 1e9, usadaPct: 94 },
  cpu: { cargaPct: 30, tempC: null },
  gpu: { nome: 'GTX', tempC: 88, usoPct: 50 },
  bateria: null,
  disco: { dadosLivreBytes: 9e10, projetoLivreBytes: null },
  processos: [{ pid: 10, ppid: 1, nome: 'chrome.exe', rssBytes: 1e9, cpuPct: 0, classe: 'navegador' }],
  fontes: { processos: 'ok', cpuCarga: 'ok', cpuTemp: 'na', gpu: 'ok', bateria: 'na', disco: 'ok' },
  ...extra,
});
function gravar(d, valor, mtimeMs = AGORA) {
  const arq = path.join(d, ARQ_SAUDE);
  fs.writeFileSync(arq, typeof valor === 'string' ? valor : JSON.stringify(valor));
  fs.utimesSync(arq, mtimeMs / 1000, mtimeMs / 1000);
}

test('lerSaude: ausente, fresca, velha, do futuro', () => {
  const d = novoDir();
  assert.deepEqual(lerSaude(d, AGORA), { leitura: null, idadeMs: null });
  gravar(d, leitura(AGORA - 30_000));
  const fresca = lerSaude(d, AGORA);
  assert.equal(fresca.idadeMs, 30_000);
  assert.equal(fresca.leitura.ram.usadaPct, 94);
  assert.equal(fresca.leitura.processos[0].classe, 'navegador');
  gravar(d, leitura(AGORA - 6 * MIN));
  assert.deepEqual(lerSaude(d, AGORA), { leitura: null, idadeMs: 6 * MIN });
  gravar(d, leitura(AGORA + 10 * MIN));
  assert.equal(lerSaude(d, AGORA).leitura, null);
});

test('lerSaude: lixo e campos fora da faixa não passam', () => {
  const d = novoDir();
  gravar(d, '{quebrado');
  assert.equal(lerSaude(d, AGORA).leitura, null);
  gravar(d, leitura(AGORA, { versao: 2 }));
  assert.equal(lerSaude(d, AGORA).leitura, null);
  gravar(d, leitura(AGORA, {
    ram: { totalBytes: 1, livreBytes: 1, usadaPct: 400 },
    gpu: { nome: 'x\u202ey'.repeat(40), tempC: 'quente', usoPct: 50 },
    processos: [{ pid: 1, nome: 7 }, { pid: 11, ppid: 1, nome: 'ok', rssBytes: 5, cpuPct: 0, classe: 'inventada' }],
  }));
  const l = lerSaude(d, AGORA).leitura;
  assert.equal(l.ram.usadaPct, null);
  assert.equal(l.gpu.tempC, null);
  assert.equal(l.gpu.nome.length, 60);
  assert.ok(!l.gpu.nome.includes('\u202e'));
  assert.deepEqual(l.processos.map((p) => [p.pid, p.classe]), [[11, 'outro']]);
});

function disparoFalso(d, { criaTrava = false } = {}) {
  const chamadas = [];
  return {
    chamadas,
    disparar: (opcoes) => {
      chamadas.push(opcoes);
      if (criaTrava) fs.writeFileSync(path.join(d, ARQ_TRAVA_SAUDE), conteudoTrava({ token: 't', prazoMs: 8000, agoraMs: AGORA, pid: 777, script: 'coletor-main' }));
    },
  };
}

test('talvezColetar: fresca não dispara; velha dispara; trava viva não dispara', () => {
  const d = novoDir();
  gravar(d, leitura(AGORA), AGORA - 30_000);
  const a = disparoFalso(d);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), false);
  gravar(d, leitura(AGORA), AGORA - 2 * MIN);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true, dirProjeto: '/proj' }), true);
  assert.deepEqual(a.chamadas, [{ dirProjeto: '/proj' }]);
  fs.writeFileSync(path.join(d, ARQ_TRAVA_SAUDE), conteudoTrava({ token: 't', prazoMs: 8000, agoraMs: AGORA - 5000, pid: 9, script: 'coletor-main' }));
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), false);
  // Trava vencida (30 s): dispara de novo.
  fs.writeFileSync(path.join(d, ARQ_TRAVA_SAUDE), conteudoTrava({ token: 't', prazoMs: 8000, agoraMs: AGORA - 31_000, pid: 9, script: 'coletor-main' }));
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), true);
});

test('talvezColetar: ausente dispara; saude.json do futuro conta como velho', () => {
  const d = novoDir();
  const a = disparoFalso(d);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), true);
  fs.rmSync(path.join(d, ARQ_TRAVA_SAUDE), { force: true });
  gravar(d, leitura(AGORA), AGORA + 10 * MIN);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), true);
});

test('dois talvezColetar seguidos: um disparo', () => {
  const d = novoDir();
  const a = disparoFalso(d, { criaTrava: true });
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), true);
  assert.equal(talvezColetar(d, AGORA + 10, { disparar: a.disparar, ligado: true }), false);
  assert.equal(a.chamadas.length, 1);
});

test('saude.ligado false: não dispara', () => {
  const d = novoDir();
  const a = disparoFalso(d);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: false }), false);
  assert.equal(a.chamadas.length, 0);
});

test('trava ilegível conta pela data do arquivo', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TRAVA_SAUDE);
  fs.writeFileSync(arq, 'lixo');
  fs.utimesSync(arq, (AGORA - 5000) / 1000, (AGORA - 5000) / 1000);
  const a = disparoFalso(d);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), false);
  fs.utimesSync(arq, (AGORA - 60_000) / 1000, (AGORA - 60_000) / 1000);
  assert.equal(talvezColetar(d, AGORA, { disparar: a.disparar, ligado: true }), true);
});

test('disparar que lança não derruba o hook', () => {
  const d = novoDir();
  assert.equal(talvezColetar(d, AGORA, { disparar: () => { throw new Error('x'); }, ligado: true }), false);
  assert.equal(talvezColetar(null, AGORA, { disparar: () => {}, ligado: true }), false);
});

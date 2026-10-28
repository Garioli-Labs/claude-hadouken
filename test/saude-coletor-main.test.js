import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rodarColetor } from '../src/saude/coletor-main.js';
import { ARQ_SAUDE, ARQ_TRAVA_SAUDE } from '../src/saude/ler.js';
import { conteudoTrava } from '../src/saude/trava-pid.js';
import { caminhos } from '../src/aprendizado/arquivos.js';

// Spec v0.5.5 §6.A/§6.C: o coletor desanexado pega saude.lock, coleta com
// prazo, libera processo do próprio hadouken pendurado, repara, limpa,
// grava saude.json e solta a trava.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-coletor-main-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novoDir = () => fs.mkdtempSync(path.join(tmp, 'd'));
const AGORA = 1_800_000_000_000;

const CONFIG = { liberarProprios: true, limpeza: { ligada: true, mb: 50 } };
const leitura = (processos = []) => ({
  versao: 1, em: AGORA,
  ram: { totalBytes: 16e9, livreBytes: 8e9, usadaPct: 50 },
  cpu: { cargaPct: 10, tempC: null }, gpu: { nome: null, tempC: null, usoPct: null },
  bateria: null, disco: { dadosLivreBytes: null, projetoLivreBytes: null }, processos,
  fontes: { processos: 'ok', cpuCarga: 'ok', cpuTemp: 'na', gpu: 'na', bateria: 'na', disco: 'na' },
});
const lerSaudeJson = (d) => JSON.parse(fs.readFileSync(path.join(d, ARQ_SAUDE), 'utf8'));

test('coletor-main com coletar falso grava saude.json e solta a trava', async () => {
  const d = novoDir();
  const r = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => leitura(), matar: () => {}, config: CONFIG });
  assert.equal(r.ok, true);
  assert.equal(lerSaudeJson(d).ram.usadaPct, 50);
  assert.equal(fs.existsSync(path.join(d, ARQ_TRAVA_SAUDE)), false);
});

test('trava ocupada: não coleta nem grava', async () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, ARQ_TRAVA_SAUDE), conteudoTrava({ token: 'outro', prazoMs: 8000, agoraMs: AGORA - 1000, pid: 99, script: 'coletor-main' }));
  let coletou = false;
  const r = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => { coletou = true; return leitura(); }, matar: () => {}, config: CONFIG });
  assert.deepEqual(r, { ok: false, motivo: 'ocupado' });
  assert.equal(coletou, false);
  assert.equal(fs.existsSync(path.join(d, ARQ_SAUDE)), false);
  assert.match(fs.readFileSync(path.join(d, ARQ_TRAVA_SAUDE), 'utf8'), /outro/);
});

test('coleta que passa do prazo grava só a RAM', async () => {
  const d = novoDir();
  const r = await rodarColetor({
    dir: d, agoraMs: AGORA, prazoColetaMs: 30, config: CONFIG, matar: () => {},
    coletar: () => new Promise((ok) => setTimeout(() => ok(leitura()), 2000).unref()),
  });
  assert.equal(r.ok, true);
  const s = lerSaudeJson(d);
  assert.equal(s.fontes.processos, 'prazo');
  assert.deepEqual(s.processos, []);
});

test('coletar que lança grava só a RAM e solta a trava', async () => {
  const d = novoDir();
  const r = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => { throw new Error('x'); }, matar: () => {}, config: CONFIG });
  assert.equal(r.ok, true);
  assert.equal(lerSaudeJson(d).fontes.gpu, 'prazo');
  assert.equal(fs.existsSync(path.join(d, ARQ_TRAVA_SAUDE)), false);
});

function cenarioPendurado(d) {
  // Trava do aprender de 10 min atrás (prazo 2 min: 3× estourado) e coletor
  // antigo de 40 s (prazo 8 s: 3× estourado e trava vencida, retomada).
  fs.mkdirSync(path.dirname(caminhos(d).trava), { recursive: true });
  fs.writeFileSync(caminhos(d).trava, conteudoTrava({ token: 'a', prazoMs: 120_000, agoraMs: AGORA - 600_000, pid: 501, script: 'session-start' }));
  fs.writeFileSync(path.join(d, ARQ_TRAVA_SAUDE), conteudoTrava({ token: 'c', prazoMs: 8000, agoraMs: AGORA - 40_000, pid: 502, script: 'coletor-main' }));
  return leitura([
    { pid: 501, ppid: 1, nome: 'node.exe', rssBytes: 1, cpuPct: 0, classe: 'hadouken', script: 'session-start' },
    { pid: 502, ppid: 1, nome: 'node.exe', rssBytes: 1, cpuPct: 0, classe: 'hadouken', script: 'coletor-main' },
    { pid: process.pid, ppid: 1, nome: 'node.exe', rssBytes: 1, cpuPct: 0, classe: 'hadouken', script: 'coletor-main' },
  ]);
}

test('encerra processo do hadouken pendurado só com liberarProprios, nunca o próprio pid', async () => {
  const d = novoDir();
  const l = cenarioPendurado(d);
  const mortos = [];
  const r = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => l, matar: (pid) => mortos.push(pid), config: CONFIG });
  assert.equal(r.ok, true);
  assert.deepEqual(mortos.sort(), [501, 502]);
  assert.deepEqual(r.encerrados.sort(), [501, 502]);
  const eventos = JSON.parse(fs.readFileSync(path.join(d, 'guarda-eventos.json'), 'utf8'));
  const detalhes = JSON.stringify(eventos);
  assert.match(detalhes, /encerrado:session-start/);
  assert.match(detalhes, /encerrado:coletor-main/);

  const d2 = novoDir();
  const l2 = cenarioPendurado(d2);
  const mortos2 = [];
  await rodarColetor({ dir: d2, agoraMs: AGORA, coletar: async () => l2, matar: (pid) => mortos2.push(pid), config: { ...CONFIG, liberarProprios: false } });
  assert.deepEqual(mortos2, []);
});

test('a trava própria nunca vira alvo, mesmo com o pid na lista', async () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, ARQ_TRAVA_SAUDE), conteudoTrava({ token: 'c', prazoMs: 8000, agoraMs: AGORA - 40_000, pid: process.pid, script: 'coletor-main' }));
  const mortos = [];
  await rodarColetor({
    dir: d, agoraMs: AGORA, matar: (pid) => mortos.push(pid), config: CONFIG,
    coletar: async () => leitura([{ pid: process.pid, ppid: 1, nome: 'node', rssBytes: 1, cpuPct: 0, classe: 'hadouken', script: 'coletor-main' }]),
  });
  assert.deepEqual(mortos, []);
});

test('o reparo roda: JSON de estado quebrado vai para a quarentena', async () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, 'alertas.json'), '{quebrado');
  const r = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => leitura(), matar: () => {}, config: CONFIG });
  assert.deepEqual(r.reparos.map((x) => x.arquivo), ['alertas.json']);
  assert.equal(fs.existsSync(path.join(d, 'alertas.json')), false);
});

test('limpeza desligada não corta nada', async () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, 'historico.jsonl'), ('x'.repeat(99) + '\n').repeat(60_000));
  const r1 = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => leitura(), matar: () => {}, config: { ...CONFIG, limpeza: { ligada: false, mb: 50 } } });
  assert.deepEqual(r1.cortes, []);
  const r2 = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => leitura(), matar: () => {}, config: CONFIG });
  assert.deepEqual(r2.cortes.map((c) => c.arquivo), ['historico.jsonl']);
});

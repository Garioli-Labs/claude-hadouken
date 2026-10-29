import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estadoJanela } from '../src/saude/janela.js';
import { gravarModo } from '../src/saude/modo.js';

// Spec v0.5.5 §6.L (Task 13): o que a seção "PC agora" da janela do VS Code
// recebe, já decidido no plugin. A janela só desenha.

const GB = 1024 ** 3;
const AGORA = Date.UTC(2026, 9, 28, 15, 0, 0);
const pastas = [];
after(() => { for (const p of pastas) fs.rmSync(p, { recursive: true, force: true }); });

function pasta() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk saude-janela ç '));
  pastas.push(p);
  return p;
}

function leitura(extra = {}) {
  return {
    versao: 1, em: AGORA - 12_000,
    ram: { totalBytes: 16 * GB, livreBytes: 5 * GB, usadaPct: 71 },
    cpu: { cargaPct: 31, tempC: null },
    gpu: { nome: 'GTX 1050', tempC: 54, usoPct: 10 },
    bateria: null,
    disco: { dadosLivreBytes: 212 * GB, projetoLivreBytes: 300 * GB },
    processos: [],
    fontes: { processos: 'ok', cpuCarga: 'ok', cpuTemp: 'na', gpu: 'ok', bateria: 'na', disco: 'ok' },
    ...extra,
  };
}

function comLeitura(extra) {
  const dir = pasta();
  fs.writeFileSync(path.join(dir, 'saude.json'), JSON.stringify(leitura(extra)));
  return dir;
}

test('PC tranquilo: feixes calmos, sem sugestões, sem botão, CPU sem temperatura diz que não há', () => {
  const e = estadoJanela({ dir: comLeitura(), agoraMs: AGORA, raizPlugin: null });
  assert.equal(e.idadeMs, 12_000);
  assert.equal(e.leve, false);
  assert.equal(e.acaoLeve, null);
  assert.deepEqual(e.sugestoes, []);
  assert.equal(e.barra, null);
  const ram = e.medidas.find((m) => m.chave === 'ram');
  assert.deepEqual(ram, { chave: 'ram', rotulo: 'RAM', pct: 71, valor: '71% de 16 GB', urgencia: 'calma' });
  assert.equal(e.medidas.find((m) => m.chave === 'gpu').rotulo, 'GPU GTX 1050');
  assert.equal(e.medidas.find((m) => m.chave === 'gpu').valor, '54 °C');
  assert.equal(e.medidas.find((m) => m.chave === 'cpu').valor, '31% · temperatura não disponível neste PC');
  assert.equal(e.medidas.find((m) => m.chave === 'disco').valor, '212 GB livres');
  assert.equal(e.medidas.some((m) => m.chave === 'bateria'), false, 'sem bateria, sem feixe');
  assert.match(e.resumo, /^Hooks: no tempo · Reparos: nenhum · Compat: em dia \(Node .+\) · Conflitos: ainda não conferido/);
  // Revisão do branch (spec §6.J e §6.L): dados e economia também na janela,
  // sem os maiores arquivos e sem ler o índice dos transcripts.
  assert.match(e.resumo, / · Dados: [\d,]+ KB de 50 MB · Economia: nada a contar · Plano: não identificado \(os relatórios mostram só tokens\)$/);
});

test('plano da conta no resumo da janela', () => {
  const dir = comLeitura();
  fs.writeFileSync(path.join(dir, 'conta-plano.json'), JSON.stringify({ v: 1, plano: 'max5', em: AGORA }));
  assert.match(estadoJanela({ dir, agoraMs: AGORA, raizPlugin: null }).resumo, / · Plano: Max 5x \(do Claude Code\)$/);
});

test('RAM 94%: feixe urgente, até 5 apps para fechar, botão de ligar o leve e o segmento da barra', () => {
  const processos = ['chrome.exe', 'firefox.exe', 'a.exe', 'b.exe', 'c.exe', 'd.exe'].map((nome, i) => ({
    pid: 100 + i, ppid: 1, nome, rssBytes: (6 - i) * GB, cpuPct: 0, classe: i < 2 ? 'navegador' : 'outro',
  }));
  const e = estadoJanela({ dir: comLeitura({ ram: { totalBytes: 16 * GB, livreBytes: GB, usadaPct: 94 }, processos }), agoraMs: AGORA, raizPlugin: null });
  assert.equal(e.medidas.find((m) => m.chave === 'ram').urgencia, 'urgente');
  assert.equal(e.sugestoes.length, 5);
  assert.deepEqual(e.sugestoes[0], { nome: 'chrome', rssBytes: 6 * GB });
  assert.equal(e.acaoLeve, 'ligar');
  assert.equal(e.barra, 'PC: RAM 94%');
});

test('RAM na faixa amarela: atenção e botão, mas sem sugestões', () => {
  const processos = [{ pid: 9, ppid: 1, nome: 'chrome.exe', rssBytes: 3 * GB, cpuPct: 0, classe: 'navegador' }];
  const e = estadoJanela({ dir: comLeitura({ ram: { totalBytes: 16 * GB, livreBytes: 2 * GB, usadaPct: 88 }, processos }), agoraMs: AGORA, raizPlugin: null });
  assert.equal(e.medidas.find((m) => m.chave === 'ram').urgencia, 'atencao');
  assert.deepEqual(e.sugestoes, []);
  assert.equal(e.acaoLeve, 'ligar');
});

test('GPU quente sem nome e GPU sem leitura: "não disponível neste PC"', () => {
  const quente = estadoJanela({ dir: comLeitura({ gpu: { nome: null, tempC: 89, usoPct: null } }), agoraMs: AGORA, raizPlugin: null });
  const gpu = quente.medidas.find((m) => m.chave === 'gpu');
  assert.equal(gpu.rotulo, 'GPU');
  assert.equal(gpu.urgencia, 'urgente');
  assert.equal(gpu.pct, 100);
  const sem = estadoJanela({ dir: comLeitura({ gpu: { nome: null, tempC: null, usoPct: null } }), agoraMs: AGORA, raizPlugin: null });
  assert.deepEqual(sem.medidas.find((m) => m.chave === 'gpu'), { chave: 'gpu', rotulo: 'GPU', pct: null, valor: 'não disponível neste PC', urgencia: 'calma' });
});

test('bateria fora da tomada aparece; modo leve ligado: etiqueta, botão de voltar e "leve" na barra', () => {
  const dir = comLeitura({ bateria: { pct: 40, naTomada: false } });
  assert.equal(gravarModo(dir, true, AGORA).ok, true);
  const e = estadoJanela({ dir, agoraMs: AGORA + 1000, raizPlugin: null });
  assert.equal(e.leve, true);
  assert.equal(e.ateMs, AGORA + 4 * 3_600_000);
  assert.equal(e.acaoLeve, 'desligar');
  assert.equal(e.barra, 'leve');
  assert.deepEqual(e.medidas.find((m) => m.chave === 'bateria'), { chave: 'bateria', rotulo: 'Bateria', pct: 40, valor: '40% · fora da tomada', urgencia: 'calma' });
});

test('sem saude.json: sem medidas, idade null; leitura velha: idade sem medidas', () => {
  const vazio = estadoJanela({ dir: pasta(), agoraMs: AGORA, raizPlugin: null });
  assert.deepEqual(vazio.medidas, []);
  assert.equal(vazio.idadeMs, null);
  assert.equal(vazio.acaoLeve, null);
  const velha = estadoJanela({ dir: comLeitura({ em: AGORA - 10 * 60_000 }), agoraMs: AGORA, raizPlugin: null });
  assert.deepEqual(velha.medidas, []);
  assert.equal(velha.idadeMs, 10 * 60_000);
});

test('saude.ligado false: null (a seção some); pasta null: null', () => {
  const dir = comLeitura();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ saude: { ligado: false } }));
  assert.equal(estadoJanela({ dir, agoraMs: AGORA, raizPlugin: null }), null);
  assert.equal(estadoJanela({ dir: null, agoraMs: AGORA, raizPlugin: null }), null);
});

test('nome de app com controle e marca de direção chega saneado', () => {
  const processos = [{ pid: 9, ppid: 1, nome: 'ev\u202eil\u0007.exe', rssBytes: 3 * GB, cpuPct: 0, classe: 'outro' }];
  const e = estadoJanela({ dir: comLeitura({ ram: { totalBytes: 16 * GB, livreBytes: GB, usadaPct: 95 }, processos }), agoraMs: AGORA, raizPlugin: null });
  assert.equal(e.sugestoes[0].nome, 'evil');
});

test('sessões do Claude paradas: medida própria, só contagem e GB', () => {
  const em = AGORA - 12_000;
  const ociosas = [
    { pid: 900, desdeMs: em - 40 * 60_000, cpuMs: 10, rssBytes: 2 * GB },
    { pid: 901, desdeMs: em - 5 * 60_000, cpuMs: 10, rssBytes: GB },
  ];
  const e = estadoJanela({ dir: comLeitura({ ociosas }), agoraMs: AGORA, raizPlugin: null });
  const m = e.medidas.find((x) => x.chave === 'paradas');
  assert.deepEqual(m, { chave: 'paradas', rotulo: 'Sessões do Claude paradas', pct: null, valor: '1 há mais de 30 min · 2,0 GB', urgencia: 'atencao' });
  const sem = estadoJanela({ dir: comLeitura(), agoraMs: AGORA, raizPlugin: null });
  assert.equal(sem.medidas.some((x) => x.chave === 'paradas'), false);
});

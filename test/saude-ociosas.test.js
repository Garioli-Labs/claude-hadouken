import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atualizarOciosas, CPU_PARADA_MS, paradas, tempoCpuMs } from '../src/saude/ociosas.js';
import { linhaParadas, textoParadas } from '../src/saude/mensagens.js';
import { decidirAvisos } from '../src/saude/avisos.js';
import { semNovidade } from '../src/saude/faixas.js';
import { coletar } from '../src/saude/coletor.js';
import { validarLeitura } from '../src/saude/ler.js';

// Plano v0.5.6, Task 3 (decisões 8 a 10): uma sessão do Claude está parada
// enquanto o tempo de CPU acumulado dela quase não sobe entre duas leituras;
// o aviso sai quando isso dura 30 min.

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const GB = 1024 ** 3;

const proc = (pid, cpuMs, extra = {}) => ({ pid, ppid: 1, nome: 'claude', classe: 'claude', rssBytes: GB, cpuMs, ...extra });
const leitura = (em, processos, fontes = { processos: 'ok' }) => ({ em, processos, fontes });

// Encadeia leituras como o coletor faz: cada uma vê a anterior com as ociosas.
function rodar(sequencia) {
  let anterior = null;
  let ociosas = [];
  for (const l of sequencia) {
    ociosas = atualizarOciosas(anterior, l, l.em);
    anterior = { ...l, ociosas };
  }
  return ociosas;
}

test('tempoCpuMs: formatos do ps (Linux e macOS)', () => {
  assert.equal(tempoCpuMs('02:03:04'), (2 * 3600 + 3 * 60 + 4) * 1000);
  assert.equal(tempoCpuMs('1-02:03:04'), (86_400 + 2 * 3600 + 3 * 60 + 4) * 1000);
  assert.equal(tempoCpuMs('3:04.50'), 184_500);
  assert.equal(tempoCpuMs('0:00.01'), 10);
  for (const lixo of ['', 'abc', '-1:00', '1:2:3:4:5', null, undefined, '12']) assert.equal(tempoCpuMs(lixo), null, String(lixo));
});

test('sessão sem CPU por 31 min vira parada; aos 20 ainda não', () => {
  const seq = [0, 10, 20, 31].map((m, i) => leitura(T0 + m * MIN, [proc(500, 10_000 + i * 500)]));
  assert.deepEqual(paradas(rodar(seq.slice(0, 3)), T0 + 20 * MIN), { n: 0, rssBytes: 0 });
  assert.deepEqual(paradas(rodar(seq), T0 + 31 * MIN), { n: 1, rssBytes: GB });
});

test('CPU subindo numa leitura do meio recomeça a contagem', () => {
  const seq = [
    leitura(T0, [proc(500, 10_000)]),
    leitura(T0 + 10 * MIN, [proc(500, 10_000 + CPU_PARADA_MS + 3000)]),
    leitura(T0 + 31 * MIN, [proc(500, 10_000 + CPU_PARADA_MS + 3100)]),
  ];
  const o = rodar(seq);
  assert.equal(o[0].desdeMs, T0 + 10 * MIN);
  assert.equal(paradas(o, T0 + 31 * MIN).n, 0);
});

test('pid que some e volta, ou CPU que desce (pid reaproveitado), recomeça', () => {
  const sumiu = rodar([
    leitura(T0, [proc(500, 1000)]),
    leitura(T0 + 10 * MIN, []),
    leitura(T0 + 35 * MIN, [proc(500, 1000)]),
  ]);
  assert.equal(sumiu[0].desdeMs, T0 + 35 * MIN);
  const desceu = rodar([
    leitura(T0, [proc(500, 90_000)]),
    leitura(T0 + 35 * MIN, [proc(500, 100)]),
  ]);
  assert.equal(desceu[0].desdeMs, T0 + 35 * MIN);
});

test('sem cpuMs na leitura atual ou na anterior, o processo não entra', () => {
  assert.deepEqual(rodar([leitura(T0, [proc(500, null)]), leitura(T0 + 40 * MIN, [proc(500, null)])]), []);
  const o = rodar([leitura(T0, [proc(500, null)]), leitura(T0 + 40 * MIN, [proc(500, 1000)])]);
  assert.equal(paradas(o, T0 + 40 * MIN).n, 0);
});

test('mais de 2 h entre as leituras recomeça tudo; anterior null começa agora', () => {
  const o = rodar([leitura(T0, [proc(500, 1000)]), leitura(T0 + 3 * 60 * MIN, [proc(500, 1000)])]);
  assert.equal(o[0].desdeMs, T0 + 3 * 60 * MIN);
  const n = atualizarOciosas(null, leitura(T0, [proc(500, 1000)]), T0);
  assert.equal(n[0].desdeMs, T0);
});

test('leitura sem processos (prazo) devolve as anteriores sem mudar', () => {
  const anteriores = [{ pid: 500, desdeMs: T0, cpuMs: 1000, rssBytes: GB }];
  const r = atualizarOciosas({ em: T0, processos: [], ociosas: anteriores }, leitura(T0 + 10 * MIN, [], { processos: 'prazo' }), T0 + 10 * MIN);
  assert.deepEqual(r, anteriores);
});

test('só a classe claude entra; teto de 20 itens', () => {
  const outros = [proc(1, 0, { classe: 'vscode' }), proc(2, 0, { classe: 'hadouken' }), proc(3, 0, { classe: 'outro' })];
  assert.deepEqual(rodar([leitura(T0, outros), leitura(T0 + 40 * MIN, outros)]), []);
  const muitos = Array.from({ length: 30 }, (_, i) => proc(100 + i, 0));
  assert.equal(rodar([leitura(T0, muitos)]).length, 20);
});

test('paradas soma a RAM das sessões paradas há 30 min ou mais', () => {
  const lista = [
    { pid: 1, desdeMs: T0, cpuMs: 0, rssBytes: GB },
    { pid: 2, desdeMs: T0 + 10 * MIN, cpuMs: 0, rssBytes: 2 * GB },
    { pid: 3, desdeMs: T0 - 60 * MIN, cpuMs: 0, rssBytes: GB / 2 },
  ];
  assert.deepEqual(paradas(lista, T0 + 30 * MIN), { n: 2, rssBytes: 1.5 * GB });
  assert.deepEqual(paradas(null, T0), { n: 0, rssBytes: 0 });
  assert.deepEqual(paradas([{ pid: 1, desdeMs: 'x' }], T0), { n: 0, rssBytes: 0 });
});

test('textos: singular, plural e nada de pid, nome ou caminho', () => {
  assert.equal(textoParadas({ n: 1, rssBytes: 1.5 * GB }), 'hadouken: 1 sessão do Claude parada há mais de 30 min ocupa 1,5 GB. Fechar libera memória para esta.');
  assert.equal(textoParadas({ n: 3, rssBytes: 4 * GB }), 'hadouken: 3 sessões do Claude paradas há mais de 30 min ocupam 4,0 GB. Fechar libera memória para esta.');
  assert.equal(linhaParadas({ n: 2, rssBytes: 3 * GB }), 'hadouken: 2 sessões do Claude paradas ocupam 3,0 GB; se o usuário fechar, a RAM folga.');
  for (const t of [textoParadas({ n: 2, rssBytes: 3 * GB }), linhaParadas({ n: 2, rssBytes: 3 * GB })]) {
    assert.doesNotMatch(t, /\d{3,}|\.exe|[\\/]/);
  }
});

const CONFIG = { ligado: true, ram: { amarelo: 85, vermelho: 93 }, gpuMax: 85, cpuMax: 90, bateriaMin: 15, discoMinGB: 5 };
const NORMAL = { leve: false, ateMs: null };
function leituraSaude({ ram = 50, ociosas = [], em = T0 } = {}) {
  return {
    versao: 1, em,
    ram: { totalBytes: 16 * GB, livreBytes: GB, usadaPct: ram },
    cpu: { cargaPct: 30, tempC: null }, gpu: { nome: null, tempC: null, usoPct: null }, bateria: null,
    disco: { dadosLivreBytes: 100 * GB, projetoLivreBytes: null }, processos: [], fontes: {}, ociosas,
  };
}
const PARADA = { pid: 9, desdeMs: T0 - 40 * MIN, cpuMs: 0, rssBytes: 2 * GB };
const decidir = (o) => decidirAvisos({ config: CONFIG, modo: NORMAL, sessao: 'sessao-aaaa-1111', agoraMs: T0, ...o });

test('avisos: o das paradas sai uma vez por episódio e volta depois que n zera', () => {
  const r1 = decidir({ leitura: leituraSaude({ ociosas: [PARADA] }) });
  assert.equal(r1.usuario, textoParadas({ n: 1, rssBytes: 2 * GB }));
  assert.equal(r1.claude, null);
  const r2 = decidir({ leitura: leituraSaude({ ociosas: [PARADA] }), registro: r1.registro });
  assert.equal(r2.usuario, null);
  const r3 = decidir({ leitura: leituraSaude({ ociosas: [] }), registro: r2.registro });
  assert.equal(r3.registro.paradas, undefined);
  const r4 = decidir({ leitura: leituraSaude({ ociosas: [PARADA] }), registro: r3.registro });
  assert.equal(r4.usuario, textoParadas({ n: 1, rssBytes: 2 * GB }));
});

test('avisos: com aviso de faixa no mesmo hook, o das paradas espera o próximo', () => {
  const r1 = decidir({ leitura: leituraSaude({ ram: 94, ociosas: [PARADA] }) });
  assert.match(r1.usuario, /RAM do PC em 94%/);
  const r2 = decidir({ leitura: leituraSaude({ ram: 94, ociosas: [PARADA] }), registro: r1.registro });
  assert.equal(r2.usuario, textoParadas({ n: 1, rssBytes: 2 * GB }));
});

test('avisos: ao Claude só com RAM amarela ou pior, uma vez por sessão', () => {
  const r1 = decidir({ leitura: leituraSaude({ ram: 88, ociosas: [PARADA] }) });
  assert.ok(r1.claude.includes(linhaParadas({ n: 1, rssBytes: 2 * GB })));
  const r2 = decidir({ leitura: leituraSaude({ ram: 88, ociosas: [PARADA] }), registro: r1.registro });
  assert.ok(r2.claude === null || !r2.claude.includes('paradas'));
});

test('semNovidade: sessão parada sem aviso ainda não é "nada novo"', () => {
  assert.equal(semNovidade({ leitura: leituraSaude({ ociosas: [PARADA] }), config: CONFIG, registro: undefined, modo: NORMAL, sessao: 's' }), false);
  assert.equal(semNovidade({ leitura: leituraSaude({ ociosas: [] }), config: CONFIG, registro: undefined, modo: NORMAL, sessao: 's' }), true);
});

test('validarLeitura mantém ociosas válidas e descarta o resto', () => {
  const v = validarLeitura({
    ...leituraSaude(),
    ociosas: [PARADA, { pid: -1, desdeMs: T0, cpuMs: 0, rssBytes: 0 }, { pid: 3, desdeMs: 'x', cpuMs: 0, rssBytes: 0 }, 'lixo'],
  });
  assert.deepEqual(v.ociosas, [PARADA]);
  assert.deepEqual(validarLeitura(leituraSaude({ ociosas: undefined })).ociosas, []);
});

test('coletor no Windows: UserModeTime + KernelModeTime viram cpuMs', async () => {
  const ps = JSON.stringify({
    p: [
      { i: 10, p: 1, n: 'claude.exe', c: 'claude', r: GB, u: 20_000_000, k: 5_000_000 },
      { i: 11, p: 1, n: 'claude.exe', c: 'claude', r: GB },
    ],
    b: [],
  });
  const executar = async (nome, args) => (nome === 'powershell'
    ? { ok: true, stdout: Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('Win32_Process') ? ps : '{"t":null}' }
    : { ok: false, stdout: '', motivo: 'erro' });
  const os = { totalmem: () => 16 * GB, freemem: () => 8 * GB, cpus: () => [{ times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } }], loadavg: () => [0, 0, 0] };
  const fs = { statfsSync: () => { throw new Error('x'); }, readdirSync: () => [], readFileSync: () => { throw new Error('x'); } };
  const l = await coletar({ agoraMs: T0, plataforma: 'win32', executar, fs, os, dirDados: '/d', dirProjeto: null });
  const porPid = Object.fromEntries(l.processos.map((p) => [p.pid, p.cpuMs]));
  assert.equal(porPid[10], 2500);
  assert.equal(porPid[11], null);
});

test('coletor no posix: coluna time= vira cpuMs, e o formato antigo continua lido', async () => {
  const executar = async (nome, args) => {
    if (nome !== 'ps') return { ok: false, stdout: '', motivo: 'erro' };
    if (args.join(' ').includes('args=')) return { ok: true, stdout: ' 700 claude\n 701 claude\n' };
    return { ok: true, stdout: ' 700 1 102400 0.3 00:01:05 claude\n 701 1 2048 0.0 claude\n' };
  };
  const os = { totalmem: () => 16 * GB, freemem: () => 8 * GB, cpus: () => [{ times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } }], loadavg: () => [0, 0, 0] };
  const fs = { statfsSync: () => { throw new Error('x'); }, readdirSync: () => [], readFileSync: () => { throw new Error('x'); } };
  const l = await coletar({ agoraMs: T0, plataforma: 'linux', executar, fs, os, dirDados: '/d', dirProjeto: null });
  const porPid = Object.fromEntries(l.processos.map((p) => [p.pid, [p.nome, p.cpuMs]]));
  assert.deepEqual(porPid[700], ['claude', 65_000]);
  assert.deepEqual(porPid[701], ['claude', null]);
});

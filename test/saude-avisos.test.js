import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAvisos } from '../src/saude/avisos.js';

// Spec v0.5.5 §6.B, §6.C e §9.1 item 2: avisos por episódio, globais ao
// usuário e por sessão ao Claude, o mais grave primeiro, nunca bloqueando.

const AGORA = 1_800_000_000_000;
const MIN = 60_000;
const GB = 1024 ** 3;
const CONFIG = {
  ligado: true, ram: { amarelo: 85, vermelho: 93 }, gpuMax: 85, cpuMax: 90, bateriaMin: 15, discoMinGB: 5,
};
const NORMAL = { leve: false, ateMs: null };

function leitura({ ram = 50, gpu = null, cpu = null, bateria = null, discoGB = 100, processos = [] } = {}) {
  return {
    versao: 1, em: AGORA,
    ram: { totalBytes: 16 * GB, livreBytes: 1 * GB, usadaPct: ram },
    cpu: { cargaPct: 30, tempC: cpu },
    gpu: { nome: 'GTX', tempC: gpu, usoPct: 10 },
    bateria,
    disco: { dadosLivreBytes: discoGB * GB, projetoLivreBytes: null },
    processos,
    fontes: {},
  };
}

const decidir = (o) => decidirAvisos({ config: CONFIG, modo: NORMAL, registro: undefined, sessao: 'sessao-aaaa-1111', agoraMs: AGORA, ...o });

test('RAM 94% na primeira mensagem: usuário e Claude avisados, barra PC: RAM 94%', () => {
  const r = decidir({ leitura: leitura({ ram: 94 }) });
  assert.equal(r.barra, 'PC: RAM 94%');
  assert.equal(r.claude, 'hadouken: RAM do PC em 94%. Até baixar: testes com concorrência 1, sem subagentes em paralelo, sem build em watch; prefira ler trechos a arquivos inteiros.');
  assert.match(r.usuario, /^hadouken: RAM do PC em 94%/);
  assert.match(r.usuario, /\/hadouken:saude leve alivia o PC por 4 h; \/hadouken:saude mostra o que fechar\.$/);
  assert.ok(r.usuario.length <= 300);
  assert.equal(r.registro.episodios.ram.avisadoUsuario, true);
});

test('RAM amarela: orientação branda', () => {
  const r = decidir({ leitura: leitura({ ram: 88 }) });
  assert.equal(r.claude, 'hadouken: RAM do PC em 88%. Prefira testes e subagentes em série enquanto durar.');
  assert.equal(r.barra, 'PC: RAM 88%');
});

test('segunda mensagem da mesma sessão: nada, mas a barra continua', () => {
  const r1 = decidir({ leitura: leitura({ ram: 94 }) });
  const r2 = decidir({ leitura: leitura({ ram: 95 }), registro: r1.registro, agoraMs: AGORA + MIN });
  assert.equal(r2.usuario, null);
  assert.equal(r2.claude, null);
  assert.equal(r2.barra, 'PC: RAM 95%');
});

test('outra sessão no mesmo episódio: só o Claude dela, usuário não', () => {
  const r1 = decidir({ leitura: leitura({ ram: 94 }) });
  const r2 = decidir({ leitura: leitura({ ram: 94 }), registro: r1.registro, sessao: 'sessao-bbbb-2222', agoraMs: AGORA + MIN });
  assert.equal(r2.usuario, null);
  assert.match(r2.claude, /RAM do PC em 94%/);
});

test('amarelo que vira vermelho no mesmo episódio: avisa de novo', () => {
  const r1 = decidir({ leitura: leitura({ ram: 88 }) });
  const r2 = decidir({ leitura: leitura({ ram: 94 }), registro: r1.registro, agoraMs: AGORA + MIN });
  assert.match(r2.claude, /Até baixar/);
  assert.notEqual(r2.usuario, null);
  // e o vermelho que volta ao amarelo não repete
  const r3 = decidir({ leitura: leitura({ ram: 88 }), registro: r2.registro, agoraMs: AGORA + 2 * MIN });
  assert.equal(r3.claude, null);
  assert.equal(r3.usuario, null);
});

test('RAM cai e volta em menos de 30 min: mesmo episódio; depois de 30 min: episódio novo', () => {
  const r1 = decidir({ leitura: leitura({ ram: 94 }) });
  const baixa = decidir({ leitura: leitura({ ram: 60 }), registro: r1.registro, agoraMs: AGORA + MIN });
  assert.equal(baixa.barra, null);
  const volta = decidir({ leitura: leitura({ ram: 94 }), registro: baixa.registro, agoraMs: AGORA + 20 * MIN });
  assert.equal(volta.usuario, null);
  assert.equal(volta.claude, null);
  const baixa2 = decidir({ leitura: leitura({ ram: 60 }), registro: volta.registro, agoraMs: AGORA + 21 * MIN });
  const nova = decidir({ leitura: leitura({ ram: 94 }), registro: baixa2.registro, agoraMs: AGORA + 52 * MIN });
  assert.notEqual(nova.usuario, null);
  assert.notEqual(nova.claude, null);
});

test('vários tipos: um aviso ao usuário, o mais grave; ao Claude, uma linha por tipo', () => {
  const r = decidir({ leitura: leitura({ ram: 88, gpu: 89, cpu: 95 }) });
  // vermelho (GPU, CPU) vence o amarelo da RAM; entre os vermelhos, a ordem ram, gpu, cpu.
  assert.match(r.usuario, /^hadouken: GPU a 89 °C\./);
  assert.equal(r.barra, 'PC: GPU 89°C');
  const linhas = r.claude.split('\n');
  assert.deepEqual(linhas.map((l) => l.slice(0, 25)), [
    'hadouken: GPU a 89 °C. Ev', 'hadouken: CPU a 95 °C. Ev', 'hadouken: RAM do PC em 88',
  ]);
  assert.equal(linhas[0], 'hadouken: GPU a 89 °C. Evite tarefas pesadas em paralelo (builds, testes e subagentes ao mesmo tempo); faça em série.');
  // os outros tipos não voltam a avisar o usuário depois
  const r2 = decidir({ leitura: leitura({ ram: 88, gpu: 89, cpu: 95 }), registro: r.registro, sessao: 'outra', agoraMs: AGORA + MIN });
  assert.equal(r2.usuario, null);
});

test('bateria baixa só fora da tomada; disco abaixo do mínimo', () => {
  assert.equal(decidir({ leitura: leitura({ bateria: { pct: 10, naTomada: true } }) }).barra, null);
  const b = decidir({ leitura: leitura({ bateria: { pct: 10, naTomada: false } }) });
  assert.equal(b.barra, 'PC: bateria 10%');
  assert.match(b.usuario, /^hadouken: bateria em 10%, fora da tomada\./);
  const d = decidir({ leitura: leitura({ discoGB: 3.4 }) });
  assert.equal(d.barra, 'PC: disco 3 GB');
  assert.match(d.claude, /disco/);
});

test('leitura velha ou do futuro: sem aviso', () => {
  const r = decidir({ leitura: null });
  assert.deepEqual([r.usuario, r.claude, r.barra], [null, null, null]);
  // e o episódio aberto não fecha só porque a leitura sumiu
  const r1 = decidir({ leitura: leitura({ ram: 94 }) });
  const r2 = decidir({ leitura: null, registro: r1.registro, agoraMs: AGORA + 40 * MIN });
  const r3 = decidir({ leitura: leitura({ ram: 94 }), registro: r2.registro, agoraMs: AGORA + 41 * MIN });
  assert.equal(r3.usuario, null);
});

test('modo leve: linha ao Claude só quando muda; barra mostra leve', () => {
  const ate = AGORA + 4 * 60 * MIN;
  const d = new Date(ate);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const leve = { leve: true, ateMs: ate };
  const r1 = decidir({ leitura: leitura(), modo: leve });
  assert.equal(r1.claude, `hadouken: modo leve até ${hhmm}. Um subagente por vez, effort mínimo necessário, Haiku/Sonnet para busca, sem Fable nem Workflow sem pedido explícito, testes com concorrência 1.`);
  assert.equal(r1.barra, 'leve');
  const r2 = decidir({ leitura: leitura({ ram: 94 }), modo: leve, registro: r1.registro, agoraMs: AGORA + MIN });
  assert.doesNotMatch(r2.claude, /modo leve/);
  assert.equal(r2.barra, 'PC: RAM 94% · leve');
  const r3 = decidir({ leitura: leitura(), modo: NORMAL, registro: r2.registro, agoraMs: AGORA + 2 * MIN });
  assert.equal(r3.claude, 'hadouken: modo leve encerrado; ritmo normal de trabalho.');
  const r4 = decidir({ leitura: leitura(), modo: NORMAL, registro: r3.registro, agoraMs: AGORA + 3 * MIN });
  assert.equal(r4.claude, null);
  // sessão que nunca viu o modo leve não recebe "encerrado"
  assert.equal(decidir({ leitura: leitura(), sessao: 'nova' }).claude, null);
});

test('saude.ligado false: tudo null', () => {
  const r = decidir({ leitura: leitura({ ram: 99, gpu: 99 }), config: { ...CONFIG, ligado: false }, modo: { leve: true, ateMs: AGORA + MIN } });
  assert.deepEqual([r.usuario, r.claude, r.barra], [null, null, null]);
});

test('texto ao Claude nunca traz nome de processo; o do usuário traz, saneado e no teto', () => {
  const processos = [
    { pid: 50, ppid: 1, nome: 'segredo-do-app.exe', rssBytes: 3 * GB, cpuPct: 0, classe: 'outro' },
    { pid: 51, ppid: 1, nome: 'chrome.exe', rssBytes: 2 * GB, cpuPct: 0, classe: 'navegador' },
    ...Array.from({ length: 6 }, (_, i) => ({ pid: 60 + i, ppid: 1, nome: 'x'.repeat(60) + i, rssBytes: GB, cpuPct: 0, classe: 'outro' })),
  ];
  const r = decidir({ leitura: leitura({ ram: 95, processos }) });
  assert.doesNotMatch(r.claude, /segredo|chrome/);
  assert.match(r.usuario, /segredo-do-app 3,0 GB/);
  assert.ok(r.usuario.length <= 300, String(r.usuario.length));
  assert.match(r.usuario, /\/hadouken:saude mostra o que fechar\.$/);
});

test('registro corrompido ou de outro formato começa vazio', () => {
  for (const lixo of [null, 'x', [], { episodios: 'x' }, { episodios: { ram: { inicioMs: 'a' } }, modoAnunciado: { '../x': 'leve' } }]) {
    const r = decidir({ leitura: leitura({ ram: 94 }), registro: lixo });
    assert.notEqual(r.usuario, null);
    assert.deepEqual(Object.keys(r.registro.modoAnunciado), []);
  }
});

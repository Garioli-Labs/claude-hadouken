import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coletar } from '../src/saude/coletor.js';

// Spec v0.5.5 §6.A: as leituras por plataforma. `executar` é a costura: aqui,
// um falso que responde por nome de programa; nada é executado de verdade.

const GB = 1024 ** 3;
const AGORA = 1_800_000_000_000;

// cpus() devolve as amostras em sequência (início e fim da coleta); sem
// `ocupadoPct`, as duas são iguais e a carga cai no loadavg (só posix).
function falsoOs({ total = 16 * GB, livre = 4 * GB, carga = 2, nucleos = 4, ocupadoPct = null } = {}) {
  const nucleo = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  const amostras = ocupadoPct === null
    ? [Array(nucleos).fill(nucleo(10, 30))]
    : [Array(nucleos).fill(nucleo(0, 0)), Array(nucleos).fill(nucleo(ocupadoPct, 100 - ocupadoPct))];
  let i = 0;
  return { totalmem: () => total, freemem: () => livre, loadavg: () => [carga, 0, 0], cpus: () => amostras[Math.min(i++, amostras.length - 1)] };
}
// As duas chamadas de PowerShell: a térmica é a que fala de ThermalZone.
const ehTermica = (args) => Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('ThermalZone');
const powershell = (principal, termica) => (args) => (ehTermica(args) ? termica : principal);

// arquivos: { caminho: conteúdo }; diretórios saem dos prefixos.
function falsoFs(arquivos = {}, livrePorDir = {}) {
  const norm = (p) => p.replaceAll('\\', '/');
  return {
    readFileSync: (p) => {
      const k = norm(p);
      if (!Object.hasOwn(arquivos, k)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return arquivos[k];
    },
    readdirSync: (d) => {
      const pre = norm(d).replace(/\/$/, '') + '/';
      const nomes = new Set(Object.keys(arquivos).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length).split('/')[0]));
      if (nomes.size === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return [...nomes];
    },
    statfsSync: (d) => {
      const k = norm(d);
      if (!Object.hasOwn(livrePorDir, k)) throw new Error('ENOENT');
      return { bavail: livrePorDir[k] / 4096, bsize: 4096 };
    },
  };
}

// respostas: { nome: stdout | { ok:false, motivo } | (args) => resposta }.
function falsoExecutar(respostas) {
  const chamadas = [];
  const executar = async (nome, args, opcoes) => {
    chamadas.push({ nome, args, opcoes });
    let r = respostas[nome];
    if (typeof r === 'function') r = r(args);
    if (r === undefined) return { ok: false, stdout: '', motivo: 'erro' };
    if (typeof r === 'string') return { ok: true, stdout: r };
    return { stdout: '', ...r };
  };
  return { executar, chamadas };
}

const base = (extra) => ({ agoraMs: AGORA, os: falsoOs(), fs: falsoFs(), dirDados: '/dados', dirProjeto: '/proj', ...extra });

const PS_WIN = JSON.stringify({
  p: [
    { i: 4, p: 0, n: 'System', c: null, r: 1000 },
    { i: 100, p: 1, n: 'chrome.exe', c: 'C:\\chrome.exe --token=SEGREDO', r: 2 * GB },
    { i: 200, p: 1, n: 'node.exe', c: 'node C:\\x\\claude-hadouken\\src\\saude\\coletor-main.js', r: 50_000_000 },
  ],
  b: [{ c: 81, s: 2 }],
});

test('win32: json do powershell vira leitura; térmica negada fica na', async () => {
  const { executar, chamadas } = falsoExecutar({ powershell: powershell(PS_WIN, '{"t":"negado"}'), 'nvidia-smi': 'NVIDIA GeForce GTX 1050, 54, 3\n' });
  const l = await coletar(base({ plataforma: 'win32', executar, os: falsoOs({ ocupadoPct: 37 }), fs: falsoFs({}, { '/dados': 20 * GB, '/proj': 3 * GB }) }));
  assert.equal(l.versao, 1);
  assert.equal(l.em, AGORA);
  assert.deepEqual(l.ram, { totalBytes: 16 * GB, livreBytes: 4 * GB, usadaPct: 75 });
  assert.deepEqual(l.cpu, { cargaPct: 37, tempC: null });
  assert.deepEqual(l.gpu, { nome: 'NVIDIA GeForce GTX 1050', tempC: 54, usoPct: 3 });
  assert.deepEqual(l.bateria, { pct: 81, naTomada: true });
  assert.deepEqual(l.disco, { dadosLivreBytes: 20 * GB, projetoLivreBytes: 3 * GB });
  assert.deepEqual(l.processos.map((p) => [p.pid, p.classe, p.script ?? null]), [[100, 'navegador', null], [200, 'hadouken', 'coletor-main'], [4, 'sistema', null]]);
  // A linha de comando nunca vai para a leitura (pode ter segredo).
  assert.ok(!JSON.stringify(l).includes('SEGREDO'));
  assert.ok(l.processos.every((p) => !('cmd' in p)));
  assert.deepEqual(l.fontes, { processos: 'ok', cpuCarga: 'ok', cpuTemp: 'na', gpu: 'ok', bateria: 'ok', disco: 'ok' });
  // Duas chamadas de PowerShell (a térmica à parte) e uma do nvidia-smi, todas com prazo.
  assert.deepEqual(chamadas.map((c) => c.nome).sort(), ['nvidia-smi', 'powershell', 'powershell']);
  assert.ok(chamadas.every((c) => Number.isInteger(c.opcoes.prazoMs) && c.opcoes.prazoMs <= 6000));
});

test('win32: térmica em décimos de Kelvin vira °C e bateria descarregando', async () => {
  const ps = JSON.stringify({ p: [], b: [{ c: 12, s: 1 }] });
  const { executar } = falsoExecutar({ powershell: powershell(ps, '{"t":[3232,3332]}') });
  const l = await coletar(base({ plataforma: 'win32', executar }));
  // Sem intervalo entre as amostras, a carga fica null no Windows (o loadavg dele é sempre 0).
  assert.deepEqual(l.cpu, { cargaPct: null, tempC: 60 });
  assert.equal(l.fontes.cpuCarga, 'na');
  const uma = falsoExecutar({ powershell: powershell(ps, '{"t":3132}') });
  assert.equal((await coletar(base({ plataforma: 'win32', executar: uma.executar }))).cpu.tempC, 40);
  assert.deepEqual(l.bateria, { pct: 12, naTomada: false });
  assert.equal(l.fontes.gpu, 'na');
  assert.deepEqual(l.disco, { dadosLivreBytes: null, projetoLivreBytes: null });
  assert.equal(l.fontes.disco, 'na');
});

test('linux: ps e thermal viram leitura', async () => {
  const { executar } = falsoExecutar({
    ps: (args) => (args.join(' ').includes('args=')
      ? '  1 /sbin/init\n 300 node /home/x/.claude/plugins/cache/claude-hadouken/hadouken/0.5.5/src/aprendizado/aprender.js\n 400 /opt/google/chrome/chrome --type=renderer\n'
      : '    1     0  1000  0.0 systemd\n  300     1 20480  1.5 node\n  400     1 409600 12.5 chrome\n'),
  });
  const fs = falsoFs({
    '/sys/class/thermal/thermal_zone0/temp': '45000\n',
    '/sys/class/thermal/thermal_zone1/temp': '71500\n',
    '/sys/class/thermal/cooling_device0/type': 'Fan',
    '/sys/class/power_supply/AC/type': 'Mains\n',
    '/sys/class/power_supply/BAT0/type': 'Battery\n',
    '/sys/class/power_supply/BAT0/capacity': '64\n',
    '/sys/class/power_supply/BAT0/status': 'Discharging\n',
  });
  const l = await coletar(base({ plataforma: 'linux', executar, fs, os: falsoOs({ carga: 2, nucleos: 4 }) }));
  assert.deepEqual(l.cpu, { cargaPct: 50, tempC: 72 });
  assert.deepEqual(l.bateria, { pct: 64, naTomada: false });
  assert.deepEqual(l.processos.map((p) => [p.pid, p.nome, p.classe, p.rssBytes, p.cpuPct]), [
    [400, 'chrome', 'navegador', 409600 * 1024, 12.5],
    [300, 'node', 'hadouken', 20480 * 1024, 1.5],
    [1, 'systemd', 'sistema', 1000 * 1024, 0],
  ]);
  assert.equal(l.processos[1].script, 'aprender');
  assert.equal(l.fontes.cpuTemp, 'ok');
});

test('darwin: pmset vira bateria; cpu tempC null', async () => {
  const { executar } = falsoExecutar({
    ps: (args) => (args.join(' ').includes('args=') ? '' : ' 500 1 102400 3.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n'),
    pmset: "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t87%; charging; 0:40 remaining present: true\n",
  });
  const l = await coletar(base({ plataforma: 'darwin', executar }));
  assert.deepEqual(l.bateria, { pct: 87, naTomada: true });
  assert.equal(l.cpu.tempC, null);
  assert.equal(l.fontes.cpuTemp, 'na');
  assert.deepEqual(l.processos.map((p) => [p.nome, p.classe]), [['Google Chrome', 'navegador']]);
});

test('darwin sem bateria (Mac de mesa): bateria null e na', async () => {
  const { executar } = falsoExecutar({ ps: '', pmset: "Now drawing from 'AC Power'\n" });
  const l = await coletar(base({ plataforma: 'darwin', executar }));
  assert.equal(l.bateria, null);
  assert.equal(l.fontes.bateria, 'na');
});

test('executar que estoura o prazo: leitura parcial, na', async () => {
  const { executar } = falsoExecutar({ powershell: { ok: false, motivo: 'prazo' }, 'nvidia-smi': { ok: false, motivo: 'prazo' } });
  const l = await coletar(base({ plataforma: 'win32', executar }));
  assert.deepEqual(l.ram.usadaPct, 75);
  assert.deepEqual(l.processos, []);
  assert.equal(l.cpu.cargaPct, null);
  assert.equal(l.bateria, null);
  assert.deepEqual(l.gpu, { nome: null, tempC: null, usoPct: null });
  assert.equal(l.fontes.processos, 'prazo');
  assert.equal(l.fontes.bateria, 'prazo');
  assert.equal(l.fontes.cpuTemp, 'prazo');
  assert.equal(l.fontes.gpu, 'prazo');
});

test('linux: carga da CPU entre as amostras vence o loadavg', async () => {
  const { executar } = falsoExecutar({ ps: '' });
  const l = await coletar(base({ plataforma: 'linux', executar, os: falsoOs({ ocupadoPct: 23, carga: 4, nucleos: 4 }) }));
  assert.equal(l.cpu.cargaPct, 23);
});

test('executar que lança ou devolve lixo não derruba a coleta', async () => {
  const executar = async () => { throw new Error('x'); };
  const l = await coletar(base({ plataforma: 'win32', executar }));
  assert.equal(l.fontes.processos, 'na');
  const lixo = falsoExecutar({ powershell: powershell('{"p": "nao lista", "b": 7}', '{"t": {}}'), 'nvidia-smi': 'lixo sem virgula' });
  const l2 = await coletar(base({ plataforma: 'win32', executar: lixo.executar }));
  assert.deepEqual(l2.processos, []);
  assert.equal(l2.cpu.cargaPct, null);
  assert.equal(l2.gpu.nome, null);
  const quebrado = falsoExecutar({ powershell: '{nao json' });
  assert.equal((await coletar(base({ plataforma: 'win32', executar: quebrado.executar }))).fontes.processos, 'na');
});

test('saídas com vírgula, acento e nome gigante', async () => {
  const gigante = 'Ã'.repeat(500);
  const { executar } = falsoExecutar({
    ps: (args) => (args.join(' ').includes('args=') ? '' : ` 700 1 2048 7,5 Aplicação\u0007 São\n 701 1 1024 0,0 ${gigante}\n linha quebrada\n`),
    'nvidia-smi': 'NVIDIA RTX A2000, 61, 12\nsegunda GPU ignorada, 99, 99\n',
  });
  const l = await coletar(base({ plataforma: 'linux', executar }));
  assert.deepEqual(l.processos.map((p) => [p.nome, p.cpuPct]), [['Aplicação São', 7.5], ['Ã'.repeat(60), 0]]);
  assert.deepEqual(l.gpu, { nome: 'NVIDIA RTX A2000', tempC: 61, usoPct: 12 });
});

test('sem nvidia-smi: gpu na; valores absurdos também viram na', async () => {
  const { executar } = falsoExecutar({ ps: '' });
  const l = await coletar(base({ plataforma: 'linux', executar }));
  assert.deepEqual(l.gpu, { nome: null, tempC: null, usoPct: null });
  assert.equal(l.fontes.gpu, 'na');
  const absurdo = falsoExecutar({ ps: '', 'nvidia-smi': 'GPU, 900, [N/A]\n' });
  const l2 = await coletar(base({ plataforma: 'linux', executar: absurdo.executar }));
  assert.deepEqual(l2.gpu, { nome: 'GPU', tempC: null, usoPct: null });
});

test('no máximo 40 processos, os de maior RSS', async () => {
  const p = Array.from({ length: 100 }, (_, i) => ({ i: 1000 + i, p: 1, n: `app${i}.exe`, c: '', r: (i + 1) * 1_000_000 }));
  const { executar } = falsoExecutar({ powershell: powershell(JSON.stringify({ p, b: [] }), '{"t":null}') });
  const l = await coletar(base({ plataforma: 'win32', executar }));
  assert.equal(l.processos.length, 40);
  assert.equal(l.processos[0].pid, 1099);
  assert.equal(l.bateria, null);
});

test('ram: total zero ou os que lança não vira NaN', async () => {
  const { executar } = falsoExecutar({ ps: '' });
  const l = await coletar(base({ plataforma: 'linux', executar, os: falsoOs({ total: 0, livre: 0 }) }));
  assert.equal(l.ram.usadaPct, null);
  const quebra = { totalmem: () => { throw new Error('x'); }, freemem: () => 0, loadavg: () => { throw new Error('x'); }, cpus: () => [] };
  const l2 = await coletar(base({ plataforma: 'linux', executar, os: quebra }));
  assert.deepEqual(l2.ram, { totalBytes: null, livreBytes: null, usadaPct: null });
  assert.equal(l2.cpu.cargaPct, null);
});

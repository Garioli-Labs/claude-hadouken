import { classificar } from './processos.js';
import { tempoCpuMs } from './ociosas.js';

// As leituras do PC por plataforma (spec v0.5.5 §6.A). Roda só no coletor
// desanexado, nunca num hook. Toda saída externa é dado: cada número passa
// por faixa, cada nome é saneado, e o que falha vira null com a fonte
// marcada 'na' (não disponível) ou 'prazo' (estourou). Nunca lança.
//
// `executar(nome, args, { prazoMs })` → Promise<{ ok, stdout, motivo? }> é a
// costura; `nome` é lógico ('powershell', 'ps', 'nvidia-smi', 'pmset') e o
// adaptador real (executar.js) resolve o caminho.

const PRAZO_MS = 3000;
// Medido com a CPU a 96%: partida do PowerShell ~1 s, Win32_Process com
// -Property ~0,9 s, e a térmica sozinha ~2,4 s (só para dizer "Acesso
// negado" sem admin). Por isso a térmica vai numa chamada à parte, em
// paralelo, e a carga da CPU sai de os.cpus(), sem PowerShell.
const PRAZO_POWERSHELL_MS = 6000;
const PRAZO_TERMICA_MS = 4000;
const PROCESSOS_MAX = 40;
const LINHAS_MAX = 5000;

// Só ASCII; vai codificado em -EncodedCommand, sem camada de aspas. Sem o
// OutputEncoding o pipe sai na página OEM (850 em português) e o acento quebra.
const comoArgs = (linhas) => ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(
  ["$ErrorActionPreference='SilentlyContinue'", '[Console]::OutputEncoding=[Text.Encoding]::UTF8', ...linhas].join('\n'), 'utf16le',
).toString('base64')];
const ARGS_WIN = comoArgs([
  '$p=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,UserModeTime,KernelModeTime | ForEach-Object { $c=$_.CommandLine; if ($c -and $c.Length -gt 400) { $c=$c.Substring(0,400) }; @{i=$_.ProcessId;p=$_.ParentProcessId;n=$_.Name;c=$c;r=$_.WorkingSetSize;u=$_.UserModeTime;k=$_.KernelModeTime} })',
  '$b=@(Get-CimInstance Win32_Battery -Property EstimatedChargeRemaining,BatteryStatus | ForEach-Object { @{c=$_.EstimatedChargeRemaining;s=$_.BatteryStatus} })',
  '@{p=$p;b=$b} | ConvertTo-Json -Depth 3 -Compress',
]);
const ARGS_TERMICA = comoArgs([
  "$t=$null; try { $t=@(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | ForEach-Object { $_.CurrentTemperature }) } catch { $t='negado' }",
  '@{t=$t} | ConvertTo-Json -Depth 2 -Compress',
]);
const ARGS_NVIDIA = ['--query-gpu=name,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits'];

const naFaixa = (v, min, max) => (Number.isFinite(v) && v >= min && v <= max ? v : null);
// Aceita vírgula decimal (locale) e devolve null para o resto.
function numero(texto) {
  if (typeof texto === 'number') return texto;
  if (typeof texto !== 'string') return null;
  const t = texto.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

async function rodar(executar, nome, args, prazoMs) {
  try {
    const r = await executar(nome, args, { prazoMs });
    if (r?.ok === true && typeof r.stdout === 'string') return { ok: true, stdout: r.stdout, fonte: 'ok' };
    return { ok: false, stdout: '', fonte: r?.motivo === 'prazo' ? 'prazo' : 'na' };
  } catch {
    return { ok: false, stdout: '', fonte: 'na' };
  }
}

const linhas = (texto) => texto.split(/\r?\n/, LINHAS_MAX);

function lerRam(os) {
  try {
    const total = os.totalmem();
    const livre = os.freemem();
    if (!Number.isFinite(total) || !Number.isFinite(livre) || total <= 0 || livre < 0 || livre > total) {
      return { totalBytes: Number.isFinite(total) ? total : null, livreBytes: Number.isFinite(livre) ? livre : null, usadaPct: null };
    }
    return { totalBytes: total, livreBytes: livre, usadaPct: Math.round(((total - livre) / total) * 100) };
  } catch {
    return { totalBytes: null, livreBytes: null, usadaPct: null };
  }
}

function lerDisco(fs, dir) {
  if (typeof dir !== 'string' || dir === '') return null;
  try {
    const s = fs.statfsSync(dir);
    const livre = s.bavail * s.bsize;
    return Number.isFinite(livre) && livre >= 0 ? livre : null;
  } catch {
    return null;
  }
}

function lerGpu(r) {
  const vazio = { nome: null, tempC: null, usoPct: null };
  if (!r.ok) return vazio;
  // Uma GPU só, a primeira. O separador do csv é ", "; a vírgula decimal fica.
  const campos = linhas(r.stdout)[0].split(/,\s+/);
  if (campos.length < 3) return vazio;
  const nome = campos[0].replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 60);
  return { nome: nome === '' ? null : nome, tempC: naFaixa(numero(campos[1]), 0, 130), usoPct: naFaixa(numero(campos[2]), 0, 100) };
}

// ---- Windows: uma chamada de PowerShell com tudo -------------------------

function objetoJson(r) {
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout);
    return j !== null && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

// UserModeTime + KernelModeTime vêm em unidades de 100 ns; sem os dois, null.
function cpuMsWindows(u, k) {
  const us = naFaixa(numero(u), 0, Number.MAX_SAFE_INTEGER);
  const ks = naFaixa(numero(k), 0, Number.MAX_SAFE_INTEGER);
  return us === null || ks === null ? null : Math.floor((us + ks) / 10_000);
}

function lerWindows(r) {
  const fontes = { processos: r.fonte, bateria: r.fonte };
  const saida = { processos: [], bateria: null, fontes };
  if (!r.ok) return saida;
  const j = objetoJson(r);
  if (j === null) {
    fontes.processos = 'na';
    fontes.bateria = 'na';
    return saida;
  }
  const lista = Array.isArray(j.p) ? j.p : [];
  fontes.processos = Array.isArray(j.p) ? 'ok' : 'na';
  saida.processos = lista.map((x) => (x && typeof x === 'object'
    ? { pid: x.i, ppid: x.p, nome: x.n, cmd: x.c, rssBytes: x.r, cpuPct: 0, cpuMs: cpuMsWindows(x.u, x.k) }
    : null));
  const b = Array.isArray(j.b) ? j.b.find((x) => x && typeof x === 'object') : undefined;
  const pct = naFaixa(numero(b?.c), 0, 100);
  // BatteryStatus 1 = descarregando; os outros estados são na tomada.
  saida.bateria = pct === null ? null : { pct, naTomada: b.s !== 1 };
  fontes.bateria = saida.bateria === null ? 'na' : 'ok';
  return saida;
}

// Décimos de Kelvin; "negado" (sem admin) ou nada: não disponível.
function lerTermicaWindows(r) {
  const j = objetoJson(r);
  if (j === null) return null;
  const temps = (Array.isArray(j.t) ? j.t : [j.t])
    .map((d) => naFaixa(numero(d) / 10 - 273.15, 1, 130))
    .filter((v) => v !== null);
  return temps.length > 0 ? Math.round(Math.max(...temps)) : null;
}

// ---- posix --------------------------------------------------------------

// A coluna do tempo de CPU (time=) é opcional na leitura: sempre tem ':', o
// que a separa de um nome de processo.
const LINHA_PS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s+(?:((?:\d+-)?\d+:[\d:.]+)\s+)?(.+)$/;
const LINHA_ARGS = /^\s*(\d+)\s+(.+)$/;

function lerPs(rLista, rArgs) {
  if (!rLista.ok) return { processos: [], fonte: rLista.fonte };
  const cmds = new Map();
  if (rArgs.ok) {
    for (const l of linhas(rArgs.stdout)) {
      const m = LINHA_ARGS.exec(l);
      if (m) cmds.set(Number(m[1]), m[2].slice(0, 400));
    }
  }
  const processos = [];
  for (const l of linhas(rLista.stdout)) {
    const m = LINHA_PS.exec(l);
    if (!m) continue;
    const pid = Number(m[1]);
    // No macOS o comm= traz o caminho; para o usuário, só o nome do app.
    const nome = m[6].startsWith('/') ? m[6].slice(m[6].lastIndexOf('/') + 1) : m[6];
    processos.push({
      pid, ppid: Number(m[2]), nome, cmd: cmds.get(pid) ?? '', rssBytes: Number(m[3]) * 1024, cpuPct: numero(m[4]), cpuMs: tempoCpuMs(m[5]),
    });
  }
  return { processos, fonte: 'ok' };
}

function lerTermicaLinux(fs) {
  try {
    const temps = fs.readdirSync('/sys/class/thermal')
      .filter((n) => /^thermal_zone\d+$/.test(n))
      .map((n) => {
        try { return naFaixa(numero(String(fs.readFileSync(`/sys/class/thermal/${n}/temp`, 'utf8'))) / 1000, 1, 130); } catch { return null; }
      })
      .filter((v) => v !== null);
    return temps.length > 0 ? Math.round(Math.max(...temps)) : null;
  } catch {
    return null;
  }
}

function lerBateriaLinux(fs) {
  try {
    const raiz = '/sys/class/power_supply';
    for (const n of fs.readdirSync(raiz)) {
      if (!/^[\w.-]{1,40}$/.test(n)) continue;
      let tipo;
      try { tipo = String(fs.readFileSync(`${raiz}/${n}/type`, 'utf8')).trim(); } catch { continue; }
      if (tipo !== 'Battery') continue;
      const pct = naFaixa(numero(String(fs.readFileSync(`${raiz}/${n}/capacity`, 'utf8'))), 0, 100);
      if (pct === null) continue;
      let status = '';
      try { status = String(fs.readFileSync(`${raiz}/${n}/status`, 'utf8')).trim(); } catch { /* sem status: na tomada */ }
      return { pct, naTomada: status !== 'Discharging' };
    }
  } catch { /* sem power_supply */ }
  return null;
}

function lerPmset(r) {
  if (!r.ok) return null;
  const m = /(\d{1,3})%/.exec(r.stdout);
  const pct = m ? naFaixa(Number(m[1]), 0, 100) : null;
  return pct === null ? null : { pct, naTomada: /'AC Power'/.test(r.stdout) };
}

function amostraCpu(os) {
  try {
    let ocupado = 0;
    let total = 0;
    const cpus = os.cpus();
    if (!Array.isArray(cpus) || cpus.length === 0) return null;
    for (const c of cpus) {
      const t = c?.times;
      if (!t) return null;
      const soma = t.user + t.nice + t.sys + t.idle + t.irq;
      if (!Number.isFinite(soma)) return null;
      total += soma;
      ocupado += soma - t.idle;
    }
    return { ocupado, total };
  } catch {
    return null;
  }
}

// A carga entre duas amostras de os.cpus(): o início e o fim da coleta, que
// já dura mais de um segundo. Sem intervalo útil, o loadavg (só posix; no
// Windows ele é sempre 0).
function cargaCpu(os, antes, depois, win) {
  if (antes !== null && depois !== null && depois.total - antes.total > 0) {
    const pct = Math.round(((depois.ocupado - antes.ocupado) / (depois.total - antes.total)) * 100);
    return naFaixa(pct, 0, 100);
  }
  if (win) return null;
  try {
    const n = os.cpus().length;
    const carga = os.loadavg()[0];
    if (!(n > 0) || !Number.isFinite(carga) || carga < 0) return null;
    return Math.min(100, Math.round((carga / n) * 100));
  } catch {
    return null;
  }
}

// ---- a leitura ----------------------------------------------------------

// Quando a coleta inteira estoura o prazo do coletor-main: só a RAM, que vem
// do próprio Node e nunca demora; o resto fica 'prazo'.
export function leituraSoRam(agoraMs, os) {
  return {
    versao: 1,
    em: agoraMs,
    ram: lerRam(os),
    cpu: { cargaPct: null, tempC: null },
    gpu: { nome: null, tempC: null, usoPct: null },
    bateria: null,
    disco: { dadosLivreBytes: null, projetoLivreBytes: null },
    processos: [],
    fontes: { processos: 'prazo', cpuCarga: 'prazo', cpuTemp: 'prazo', gpu: 'prazo', bateria: 'prazo', disco: 'prazo' },
  };
}

export async function coletar({ agoraMs, plataforma, executar, fs, os, dirDados, dirProjeto }) {
  const win = plataforma === 'win32';
  const antes = amostraCpu(os);
  const [rWin, rTermica, rLista, rArgs, rGpu, rPmset] = await Promise.all([
    win ? rodar(executar, 'powershell', ARGS_WIN, PRAZO_POWERSHELL_MS) : null,
    win ? rodar(executar, 'powershell', ARGS_TERMICA, PRAZO_TERMICA_MS) : null,
    win ? null : rodar(executar, 'ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,time=,comm='], PRAZO_MS),
    win ? null : rodar(executar, 'ps', ['-axww', '-o', 'pid=,args='], PRAZO_MS),
    rodar(executar, 'nvidia-smi', ARGS_NVIDIA, PRAZO_MS),
    plataforma === 'darwin' ? rodar(executar, 'pmset', ['-g', 'batt'], PRAZO_MS) : null,
  ]);
  const cargaPct = cargaCpu(os, antes, amostraCpu(os), win);

  let brutos;
  let cpu;
  let bateria;
  const fontes = { cpuCarga: cargaPct === null ? 'na' : 'ok' };
  if (win) {
    const w = lerWindows(rWin);
    brutos = w.processos;
    cpu = { cargaPct, tempC: lerTermicaWindows(rTermica) };
    fontes.cpuTemp = cpu.tempC !== null ? 'ok' : rTermica.fonte === 'prazo' ? 'prazo' : 'na';
    bateria = w.bateria;
    Object.assign(fontes, w.fontes);
  } else {
    const ps = lerPs(rLista, rArgs);
    brutos = ps.processos;
    fontes.processos = ps.fonte;
    cpu = { cargaPct, tempC: plataforma === 'linux' ? lerTermicaLinux(fs) : null };
    fontes.cpuTemp = cpu.tempC === null ? 'na' : 'ok';
    bateria = plataforma === 'darwin' ? lerPmset(rPmset) : lerBateriaLinux(fs);
    fontes.bateria = bateria !== null ? 'ok' : plataforma === 'darwin' && rPmset.fonte === 'prazo' ? 'prazo' : 'na';
  }

  const gpu = lerGpu(rGpu);
  fontes.gpu = rGpu.ok ? 'ok' : rGpu.fonte;
  const disco = { dadosLivreBytes: lerDisco(fs, dirDados), projetoLivreBytes: lerDisco(fs, dirProjeto) };
  fontes.disco = disco.dadosLivreBytes === null && disco.projetoLivreBytes === null ? 'na' : 'ok';

  // A linha de comando fica só na memória: classificar já tirou dela o que
  // importa (classe e script); pode ter segredo e não vai para o disco. Os
  // processos do hadouken ficam mesmo fora dos 40 maiores: um coletor
  // pendurado ocupa pouca memória, e encerraveis precisa dele na lista. As
  // sessões do Claude também: uma parada há horas pode ter a memória
  // devolvida ao sistema e cair do topo (ociosas.js precisa dela).
  const ordenados = classificar(brutos).sort((a, b) => b.rssBytes - a.rssBytes);
  const processos = [
    ...ordenados.slice(0, PROCESSOS_MAX),
    ...ordenados.slice(PROCESSOS_MAX).filter((p) => p.classe === 'hadouken' || p.classe === 'claude').slice(0, PROCESSOS_MAX),
  ].map(({ cmd, ...resto }) => resto);

  return {
    versao: 1,
    em: agoraMs,
    ram: lerRam(os),
    cpu,
    gpu,
    bateria,
    disco,
    processos,
    fontes: {
      processos: fontes.processos, cpuCarga: fontes.cpuCarga, cpuTemp: fontes.cpuTemp,
      gpu: fontes.gpu, bateria: fontes.bateria, disco: fontes.disco,
    },
  };
}

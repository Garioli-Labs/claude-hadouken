// Classes de processo, sugestões de fechar e a regra dos 3× o prazo (spec
// v0.5.5 §6.B). Puro: recebe a lista pronta do coletor e nunca lê o sistema.
// O hadouken só encerra processo dele mesmo; o resto é sugestão ao usuário.

import { sanearNome } from './faixas.js';

export { sanearNome };

const SUGESTOES_MAX = 5;
const PRAZOS_PENDURADO = 3;

// No macOS o `ps -o comm=` traz o caminho inteiro; no Windows vem o .exe.
function chave(nome) {
  const base = nome.startsWith('/') ? nome.slice(nome.lastIndexOf('/') + 1) : nome;
  return base.toLowerCase().replace(/\.exe$/, '');
}
// O app para somar e mostrar: sem .exe e sem os "Helper (…)" do macOS.
const nomeDoApp = (nome) => nome.replace(/\.exe$/i, '').replace(/ Helper( \(.*\))?$/i, '');

const SISTEMA = new Set([
  // Windows
  'system', 'idle', 'system idle process', 'registry', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon',
  'services', 'lsass', 'lsaiso', 'svchost', 'dwm', 'fontdrvhost', 'memory compression', 'spoolsv', 'explorer',
  'sihost', 'taskhostw', 'ctfmon', 'runtimebroker', 'searchindexer', 'searchhost', 'startmenuexperiencehost',
  'shellexperiencehost', 'textinputhost', 'audiodg', 'conhost', 'dllhost', 'wmiprvse', 'msmpeng', 'nissrv',
  'mpdefendercoreservice', 'securityhealthservice', 'securityhealthsystray', 'wudfhost', 'dashost', 'smartscreen',
  'applicationframehost', 'lockapp', 'widgets', 'widgetservice',
  // Componente de outros apps (Teams, Widgets…): o usuário não o fecha sozinho.
  'msedgewebview2',
  // Linux
  'init', 'kthreadd', 'dbus-daemon', 'dbus-broker', 'xorg', 'xwayland', 'gnome-shell', 'kwin_x11', 'kwin_wayland',
  'plasmashell', 'pipewire', 'pipewire-pulse', 'pulseaudio', 'wireplumber', 'networkmanager', 'sshd', 'cron',
  'polkitd', 'udisksd', 'upowerd', 'rsyslogd', 'agetty', 'login',
  // macOS
  'kernel_task', 'launchd', 'windowserver', 'loginwindow', 'mds', 'mds_stores', 'coreaudiod', 'configd',
  'opendirectoryd', 'trustd', 'cfprefsd', 'distnoted', 'logd', 'hidd', 'bluetoothd', 'airportd', 'dock', 'finder',
  'systemuiserver', 'controlcenter', 'notificationcenter', 'spotlight',
]);
const SISTEMA_PREFIXO = /^(systemd|kworker|ksoftirqd|migration|rcu_|irq\/|mdworker|watchdog|cpuhp)/;
const NAVEGADOR = /^(chrome|google chrome|chromium|chromium-browser|msedge|microsoft edge|firefox|firefox-bin|firefox-esr|brave|brave browser|opera|vivaldi|safari|arc|librewolf|waterfox|web content|isolated web co|com\.apple\.webkit\.[a-z]+)( helper.*)?$/;
const VSCODE = /^(code|code - insiders|code-insiders|codium|vscodium|cursor|windsurf)( helper.*)?$/;
const NODE_DEV = /^(node|bun|deno|npm|npx|pnpm|yarn|esbuild|vite|tsc|java|python3?|dotnet|go|cargo|rustc|gradle)$/;
// Script do plugin: o cache (…/claude-hadouken/hadouken/<versão>/src/…) ou um clone do repositório.
const SCRIPT_HADOUKEN = /[\\/]claude-hadouken[\\/](.*[\\/])?src[\\/]/i;
// O nome do script (sem extensão), para a confirmação dupla sem guardar a
// linha de comando, que pode ter segredo.
const NOME_SCRIPT = /[\\/]src[\\/](?:[^\\/"'\s]+[\\/])*([a-z0-9-]{1,40})\.[cm]?js\b/i;
const CLI_CLAUDE =/[\\/]claude(\.cmd|\.exe)?(["'\s]|$)|@anthropic-ai[\\/]claude-code/i;

function classeDe(pid, k, cmd) {
  if (pid <= 4) return 'sistema';
  if ((k === 'node' || k === 'bun') && SCRIPT_HADOUKEN.test(cmd)) return 'hadouken';
  if (k === 'claude' || (k === 'node' && CLI_CLAUDE.test(cmd))) return 'claude';
  if (SISTEMA.has(k) || SISTEMA_PREFIXO.test(k)) return 'sistema';
  if (VSCODE.test(k)) return 'vscode';
  if (NAVEGADOR.test(k)) return 'navegador';
  if (NODE_DEV.test(k)) return 'node-dev';
  return 'outro';
}

const inteiroNaoNeg = (v) => Number.isInteger(v) && v >= 0;

// Cópias com `nome` saneado e `classe`; item malformado sai da lista.
export function classificar(lista) {
  if (!Array.isArray(lista)) return [];
  const saida = [];
  for (const p of lista) {
    if (p === null || typeof p !== 'object' || !inteiroNaoNeg(p.pid) || typeof p.nome !== 'string') continue;
    const nome = sanearNome(p.nome);
    const cmd = typeof p.cmd === 'string' ? p.cmd : '';
    const classe = classeDe(p.pid, chave(nome), cmd);
    const item = {
      pid: p.pid,
      ppid: inteiroNaoNeg(p.ppid) ? p.ppid : 0,
      nome,
      cmd,
      rssBytes: Number.isFinite(p.rssBytes) && p.rssBytes > 0 ? p.rssBytes : 0,
      cpuPct: Number.isFinite(p.cpuPct) && p.cpuPct > 0 ? p.cpuPct : 0,
      cpuMs: inteiroNaoNeg(p.cpuMs) ? p.cpuMs : null,
      classe,
    };
    if (classe === 'hadouken') item.script = cmd.match(NOME_SCRIPT)?.[1].toLowerCase() ?? null;
    saida.push(item);
  }
  return saida;
}

// A sessão inteira: os ancestrais (terminal, VS Code que a hospeda) e os
// descendentes do pid da sessão. Fechar qualquer um deles derruba o trabalho.
function arvoreDaSessao(lista, pidSessao) {
  const fora = new Set();
  if (!inteiroNaoNeg(pidSessao)) return fora;
  const porPid = new Map(lista.map((p) => [p.pid, p]));
  for (let pid = pidSessao; porPid.has(pid) && !fora.has(pid); pid = porPid.get(pid).ppid) fora.add(pid);
  fora.add(pidSessao);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const p of lista) {
      if (!fora.has(p.pid) && fora.has(p.ppid) && p.ppid !== 0) {
        fora.add(p.pid);
        cresceu = true;
      }
    }
  }
  return fora;
}

const SUGERIVEIS = new Set(['navegador', 'vscode', 'node-dev', 'outro']);

// Até 5 aplicativos, somados por nome, do que mais ocupa memória para o menor.
// Do VS Code, a janela com mais RAM fica: só as extras são sugestão.
export function sugerirFechar(lista, { pidSessao } = {}) {
  if (!Array.isArray(lista)) return [];
  const fora = arvoreDaSessao(lista, pidSessao);
  const candidatos = lista.filter((p) => SUGERIVEIS.has(p.classe) && !fora.has(p.pid));
  const vscode = candidatos.filter((p) => p.classe === 'vscode');
  if (vscode.length > 0) {
    const maior = vscode.reduce((a, b) => (b.rssBytes > a.rssBytes ? b : a));
    candidatos.splice(candidatos.indexOf(maior), 1);
  }
  const apps = new Map();
  for (const p of candidatos) {
    const nome = nomeDoApp(p.nome);
    const k = nome.toLowerCase();
    const app = apps.get(k) ?? { nome, rssBytes: 0 };
    app.rssBytes += p.rssBytes;
    apps.set(k, app);
  }
  return [...apps.values()]
    .filter((a) => a.rssBytes > 0)
    .sort((a, b) => b.rssBytes - a.rssBytes || a.nome.localeCompare(b.nome))
    .slice(0, SUGESTOES_MAX);
}

// Confirmação dupla: o pid da trava ainda é um processo hadouken e a linha
// de comando dele aponta para o script da trava (`script`, de classificar).
// Só então, e com 3× o prazo estourado, o pid pode ser encerrado.
export function encerraveis(lista, travas, agoraMs) {
  if (!Array.isArray(lista) || !Array.isArray(travas) || !Number.isFinite(agoraMs)) return [];
  const porPid = new Map(lista.map((p) => [p.pid, p]));
  const pids = [];
  for (const t of travas) {
    if (t === null || typeof t !== 'object') continue;
    const { pid, script, inicioMs, prazoMs } = t;
    if (!Number.isInteger(pid) || pid <= 4 || typeof script !== 'string' || !/^[a-z0-9-]{1,40}$/.test(script)) continue;
    if (!Number.isFinite(inicioMs) || !Number.isFinite(prazoMs) || prazoMs <= 0) continue;
    if (agoraMs - inicioMs <= PRAZOS_PENDURADO * prazoMs) continue;
    const p = porPid.get(pid);
    if (p?.classe !== 'hadouken' || p.script !== script) continue;
    if (!pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

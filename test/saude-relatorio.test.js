import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relatorioSaude } from '../src/saude/relatorio.js';
import { ARQ_MODO } from '../src/saude/modo.js';
import { MARCA_DISPARO } from '../src/saude/ler.js';

// Spec v0.5.5 §6.D: /hadouken:saude, só leitura de arquivos, com leve e
// normal. O texto vai só ao usuário (decision: block).

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk saude rel '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg'), { recursive: true });
  return d;
}
const GB = 1024 ** 3;
const AGORA = Date.now();
const CONFIG = {
  ligado: true, ram: { amarelo: 85, vermelho: 93 }, gpuMax: 85, cpuMax: 90, bateriaMin: 15, discoMinGB: 5,
  compat: true, conflitos: true, economia: true, limpeza: { ligada: true, mb: 50 }, tetoHooks: { ligado: true, ms: 40 },
};

function gravarSaude(dir, ramPct, idadeMs = 20_000) {
  const proc = (pid, nome, gb, classe) => ({ pid, ppid: 1, nome, rssBytes: gb * GB, cpuPct: 0, classe });
  fs.writeFileSync(path.join(dir, 'saude.json'), JSON.stringify({
    versao: 1, em: AGORA - idadeMs,
    ram: { totalBytes: 16 * GB, livreBytes: GB, usadaPct: ramPct },
    cpu: { cargaPct: 20, tempC: null }, gpu: { nome: 'GPU', tempC: 70, usoPct: 10 }, bateria: null,
    disco: { dadosLivreBytes: 100 * GB, projetoLivreBytes: null },
    processos: [
      proc(11, 'chrome.exe', 3, 'navegador'), proc(12, 'chrome.exe', 1, 'navegador'), proc(13, 'Slack.exe', 1.5, 'outro'),
      proc(14, 'Teams.exe', 1.2, 'outro'), proc(15, 'Spotify.exe', 0.8, 'outro'), proc(16, 'Discord.exe', 0.7, 'outro'),
      proc(17, 'Zoom.exe', 0.6, 'outro'),
    ],
    fontes: { processos: 'ok', cpuCarga: 'ok', cpuTemp: 'na', gpu: 'ok', bateria: 'na', disco: 'ok' },
  }));
}
const rel = (dir, extra = {}) => relatorioSaude({ dir, agoraMs: AGORA, config: CONFIG, raizPlugin: repo, dirConfig: path.join(dir, 'cfg'), ...extra });

test('relatório sem saude.json diz que a primeira leitura vem em instantes', () => {
  const t = rel(novoHome());
  assert.match(t, /^hadouken \d+\.\d+\.\d+ · saúde: a primeira leitura do PC vem em instantes\./);
  for (const r of ['Modo  ', 'Hooks ', 'Reparo', 'Compat', 'Confl.', 'Dados ', 'Semana']) assert.match(t, new RegExp(`^${r} `, 'm'), r);
});

test('relatório com RAM vermelha lista até 5 apps', () => {
  const dir = novoHome();
  gravarSaude(dir, 95);
  const t = rel(dir);
  assert.match(t, /^hadouken \d+\.\d+\.\d+ · saúde \(leitura de 20 s atrás\)/);
  assert.match(t, /^PC     RAM 95% de 16 GB · CPU 20% · GPU 70 °C · disco 100 GB livres$/m);
  assert.match(t, /indisponível neste PC: temperatura da CPU, bateria/);
  assert.match(t, /Fechar libera memória \(só sugestão; quem fecha é você\):/);
  const apps = t.split('\n').filter((l) => l.startsWith('  - '));
  assert.equal(apps.length, 5);
  assert.equal(apps[0], '  - chrome: 4,0 GB');
  assert.doesNotMatch(t, /Zoom/);
});

test('RAM normal: sem quadro de fechar; leitura velha avisa a idade', () => {
  const dir = novoHome();
  gravarSaude(dir, 50);
  assert.doesNotMatch(rel(dir), /Fechar libera/);
  const velho = novoHome();
  gravarSaude(velho, 50, 12 * 60_000);
  assert.match(rel(velho), /saúde: a última leitura do PC tem 12 min; a próxima vem em instantes\./);
});

test('seções: modo, teto, reparos, conflitos, dados e semana', () => {
  const dir = novoHome();
  const ate = AGORA + 2 * 3600_000;
  fs.writeFileSync(path.join(dir, ARQ_MODO), JSON.stringify({ v: 1, leve: true, ateMs: ate }));
  fs.writeFileSync(path.join(dir, 'tetos.json'), JSON.stringify({ v: 1, partes: { previsao: { ultimas: [], desligadaAteMs: ate } } }));
  const ev = (tipo, detalhe) => ({ at: new Date(AGORA - 3600_000).toISOString(), tipo, detalhe });
  fs.writeFileSync(path.join(dir, 'guarda-eventos.json'), JSON.stringify({ v: 1, eventos: [ev('reparo', 'config.json'), ev('reparo', 'encerrado:coletor-main'), ev('negado', null)] }));
  fs.writeFileSync(path.join(dir, 'conflitos.json'), JSON.stringify({ v: 1, em: AGORA, itens: [{ tipo: 'statusLine', plugin: null }] }));
  const t = rel(dir);
  assert.match(t, /^Modo   leve até \d\d:\d\d \(\/hadouken:saude normal para voltar\)$/m);
  assert.match(t, /^Hooks  .*desligada por 24 h: a previsão de estouro, até \d\d:\d\d/m);
  assert.match(t, /^Reparo 2 nos últimos 7 dias: config\.json; encerrado:coletor-main$/m);
  assert.match(t, /^Confl\. outra statusLine no settings\.json/m);
  assert.match(t, /^Dados  [\d,]+ (KB|MB) de 50 MB/m);
  assert.match(t, /^Semana hadouken na semana \(estimativa\): 1 despacho perguntado ou negado pela guarda\.$/m);
});

test('relatório vazio: tudo em dia, sem acusar nada', () => {
  const t = rel(novoHome(), { versaoNode: 'v22.0.0' });
  assert.match(t, /^Modo   normal \(\/hadouken:saude leve para aliviar o PC por 4 h\)$/m);
  assert.match(t, /^Reparo nenhum$/m);
  assert.match(t, /^Compat em dia \(Node 22\.0\.0, plugin \d+\.\d+\.\d+\)$/m);
  assert.match(t, /^Confl\. ainda não conferido \(o coletor confere uma vez por dia\)$/m);
  assert.match(t, /^Semana nada a contar$/m);
});

// ---------------------------------------------------------------- o hook

const script = path.join(repo, 'src', 'hooks', 'saude.js');
function rodar(args, home, extra = {}) {
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'),
    HADOUKEN_SEM_PAINEL: '1', HADOUKEN_SAUDE_DISPARAR: '0', CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra.env,
  };
  const entrada = {
    session_id: 's1', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
    command_name: 'hadouken:saude', command_args: args, command_source: 'plugin', prompt: `/hadouken:saude ${args}`, ...extra.entrada,
  };
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const j = JSON.parse(r.stdout);
  assert.equal(j.decision, 'block');
  return j.reason;
}

test('o hook sem argumento mostra o relatório e pede uma leitura', () => {
  const home = novoHome();
  assert.match(rodar('', home), /^hadouken \d+\.\d+\.\d+ · saúde: a primeira leitura do PC vem em instantes\./);
  assert.equal(fs.existsSync(path.join(home, MARCA_DISPARO)), true);
});

test('leve grava saude-modo.json e responde com a hora', () => {
  const home = novoHome();
  const antes = Date.now();
  assert.match(rodar('leve', home), /^hadouken: modo leve até \d\d:\d\d\. O Claude passa a trabalhar em série; \/hadouken:saude normal volta\.$/);
  const m = JSON.parse(fs.readFileSync(path.join(home, ARQ_MODO), 'utf8'));
  assert.equal(m.leve, true);
  assert.ok(m.ateMs >= antes + 4 * 3600_000 - 1000 && m.ateMs <= Date.now() + 4 * 3600_000);
});

test('normal desliga', () => {
  const home = novoHome();
  rodar('leve', home);
  assert.equal(rodar('  NORMAL ', home), 'hadouken: modo normal.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, ARQ_MODO), 'utf8')).leve, false);
});

test('argumento estranho: uso, nada gravado', () => {
  const home = novoHome();
  for (const a of ['leve agora', 'pesado', 'leve; rm -rf', 'x'.repeat(5000)]) {
    assert.equal(rodar(a, home), 'uso: /hadouken:saude [leve | normal]');
  }
  assert.equal(fs.existsSync(path.join(home, ARQ_MODO)), false);
});

test('origem não digitada: recusado', () => {
  const home = novoHome();
  assert.match(rodar('leve', home, { entrada: { command_source: 'model' } }), /^hadouken: nada mudado\. \/hadouken:saude só vale digitado pelo usuário\.$/);
  assert.match(rodar('leve', home, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }), /só vale digitado numa sessão normal/);
  assert.equal(fs.existsSync(path.join(home, ARQ_MODO)), false);
});

test('sessões do Claude paradas aparecem no PC, sem pid nem nome', () => {
  const d = novoHome();
  gravarSaude(d, 50);
  const arq = path.join(d, 'saude.json');
  const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
  j.ociosas = [{ pid: 4321, desdeMs: j.em - 45 * 60_000, cpuMs: 5, rssBytes: 1.5 * GB }, { pid: 4322, desdeMs: j.em - 50 * 60_000, cpuMs: 5, rssBytes: GB }];
  fs.writeFileSync(arq, JSON.stringify(j));
  const t = rel(d);
  assert.match(t, /2 sessões do Claude paradas há mais de 30 min: 2,5 GB \(fechar libera memória; quem fecha é você\)/);
  assert.doesNotMatch(t, /4321/);
});

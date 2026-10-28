import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import { gravarConfiguracao } from '../src/config/gravar.js';
import { MARCA_DISPARO } from '../src/saude/hook.js';

// Spec v0.5.5 §6.A–§6.C e §6.F nos hooks de verdade: só leitura de
// saude.json, aviso uma vez por episódio, disparo do coletor depois da saída
// (aqui, um marcador: HADOUKEN_SAUDE_DISPARAR=0) e o prazo interno.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const GB = 1024 ** 3;
const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-saude-hook-'));
  homes.push(d);
  return d;
}

function ambiente(home) {
  return {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1',
    CLAUDE_CONFIG_DIR: path.join(home, 'sem-config'), HADOUKEN_SAUDE_DISPARAR: '0', NO_COLOR: '1',
  };
}
function rodar(script, entrada, home) {
  return spawnSync(process.execPath, [path.join(repo, 'src', script)], {
    input: JSON.stringify(entrada), env: ambiente(home), encoding: 'utf8', timeout: 15_000,
  });
}
function registrar(home, id) {
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try {
    assert.equal(registrarSessao(id, Date.now()).ok, true);
  } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
}
function gravarSaude(home, ramPct) {
  fs.writeFileSync(path.join(home, 'saude.json'), JSON.stringify({
    versao: 1, em: Date.now(),
    ram: { totalBytes: 16 * GB, livreBytes: GB, usadaPct: ramPct },
    cpu: { cargaPct: 20, tempC: null }, gpu: { nome: null, tempC: null, usoPct: null }, bateria: null,
    disco: { dadosLivreBytes: 100 * GB, projetoLivreBytes: null },
    processos: [{ pid: 4242, ppid: 1, nome: 'chrome.exe', rssBytes: 3 * GB, cpuPct: 0, classe: 'navegador' }],
    fontes: { processos: 'ok', cpuCarga: 'ok', cpuTemp: 'na', gpu: 'na', bateria: 'na', disco: 'ok' },
  }));
}
function saida(r) {
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout === '') return { contexto: '', usuario: '' };
  const j = JSON.parse(r.stdout);
  return { contexto: j.hookSpecificOutput?.additionalContext ?? '', usuario: j.systemMessage ?? '' };
}
const prompt = (id) => ({ session_id: id, prompt: 'oi', hook_event_name: 'UserPromptSubmit' });

test('prompt sem saude.json: dispara e não emite aviso', () => {
  const home = novoHome();
  registrar(home, 'sessao-1');
  const s = saida(rodar('hooks/prompt-submit.js', prompt('sessao-1'), home));
  assert.doesNotMatch(s.contexto + s.usuario, /RAM|PC/);
  assert.equal(fs.existsSync(path.join(home, MARCA_DISPARO)), true);
});

test('prompt com RAM 94%: contexto traz a orientação e systemMessage traz o aviso; segunda vez nada', () => {
  const home = novoHome();
  registrar(home, 'sessao-2');
  gravarSaude(home, 94);
  const s1 = saida(rodar('hooks/prompt-submit.js', prompt('sessao-2'), home));
  assert.match(s1.contexto, /hadouken: RAM do PC em 94%\. Até baixar/);
  assert.doesNotMatch(s1.contexto, /chrome/);
  assert.match(s1.usuario, /^hadouken: RAM do PC em 94%; dá para fechar: chrome 3,0 GB\./);
  // saude.json fresco: nada de disparo
  assert.equal(fs.existsSync(path.join(home, MARCA_DISPARO)), false);
  const s2 = saida(rodar('hooks/prompt-submit.js', prompt('sessao-2'), home));
  assert.doesNotMatch(s2.contexto + s2.usuario, /RAM do PC/);
});

test('prompt com saude.ligado false: igual à 0.5.4', () => {
  const home = novoHome();
  registrar(home, 'sessao-3');
  assert.equal(gravarConfiguracao(home, { 'saude.ligado': false }, { versao: 'ausente', agoraMs: Date.now() }).ok, true);
  gravarSaude(home, 94);
  fs.utimesSync(path.join(home, 'saude.json'), 1, 1);
  const s = saida(rodar('hooks/prompt-submit.js', prompt('sessao-3'), home));
  assert.doesNotMatch(s.contexto + s.usuario, /RAM|PC/);
  assert.equal(fs.existsSync(path.join(home, MARCA_DISPARO)), false);
  assert.equal(fs.existsSync(path.join(home, 'saude-avisos.json')), false);
});

test('session-start com o modo leve ligado: a orientação vai ao contexto', () => {
  const home = novoHome();
  fs.writeFileSync(path.join(home, 'saude-modo.json'), JSON.stringify({ v: 1, leve: true, ateMs: Date.now() + 3_600_000 }));
  const r = rodar('hooks/session-start.js', { session_id: 'sessao-4', source: 'startup', hook_event_name: 'SessionStart' }, home);
  const s = saida(r);
  assert.match(s.contexto, /hadouken: modo leve até \d\d:\d\d\. Um subagente por vez/);
});

test('statusline com saude barra: termina com PC: RAM 94% │ hadouken X', () => {
  const home = novoHome();
  registrar(home, 'sessao-5');
  gravarSaude(home, 94);
  const r = rodar('statusline.js', { session_id: 'sessao-5', model: { display_name: 'Opus' } }, home);
  assert.equal(r.status, 0, r.stderr);
  const versao = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  assert.ok(r.stdout.endsWith(`PC: RAM 94% │ hadouken ${versao}`), r.stdout);
});

test('statusline com saude.json velho: segmento some e o coletor é disparado; fresco não dispara', () => {
  const home = novoHome();
  registrar(home, 'sessao-6');
  gravarSaude(home, 94);
  const entrada = { session_id: 'sessao-6', model: { display_name: 'Opus' } };
  assert.equal(rodar('statusline.js', entrada, home).status, 0);
  assert.equal(fs.existsSync(path.join(home, MARCA_DISPARO)), false);
  const velho = (Date.now() - 10 * 60_000) / 1000;
  const arq = path.join(home, 'saude.json');
  fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace(/"em":\d+/, `"em":${Math.round(velho * 1000)}`));
  fs.utimesSync(arq, velho, velho);
  const r = rodar('statusline.js', entrada, home);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /PC:/);
  assert.equal(fs.existsSync(path.join(home, MARCA_DISPARO)), true);
});

test('barra.js e avisos.js dão o mesmo segmento; prazos de barra.js batem com ler.js', async () => {
  const { saudeNaBarra } = await import('../src/saude/barra.js');
  const { decidirAvisos } = await import('../src/saude/avisos.js');
  const ler = await import('../src/saude/ler.js');
  const { configSaude } = await import('../src/config/ler.js');
  const fonte = fs.readFileSync(path.join(repo, 'src', 'saude', 'barra.js'), 'utf8');
  for (const nome of ['ARQ_SAUDE', 'INTERVALO_COLETA_MS', 'LEITURA_VALE_MS']) {
    const m = fonte.match(new RegExp(`const ${nome} = ([^;]+);`));
    assert.ok(m, nome);
    assert.equal(eval(m[1]), ler[nome], nome);
  }
  const casos = [
    [{ ram: 94 }], [{ ram: 86 }], [{ ram: 50 }], [{ ram: 50, gpu: 91 }], [{ ram: 50, disco: 2 * GB }],
    [{ ram: 50, bateria: { pct: 8, naTomada: false } }], [{ ram: 50, bateria: { pct: 8, naTomada: true } }],
    [{ ram: 101 }], [{ ram: '94' }], [{ ram: 50, gpu: 400 }], [{ ram: 94, leve: true }], [{ ram: 50, leve: true }],
  ];
  for (const [c] of casos) {
    const home = novoHome();
    const agora = Date.now();
    const j = {
      versao: 1, em: agora, ram: { totalBytes: 16 * GB, livreBytes: GB, usadaPct: c.ram },
      cpu: { cargaPct: 20, tempC: null }, gpu: { nome: null, tempC: c.gpu ?? null, usoPct: null },
      bateria: c.bateria ?? null, disco: { dadosLivreBytes: c.disco ?? 100 * GB, projetoLivreBytes: null }, processos: [], fontes: {},
    };
    fs.writeFileSync(path.join(home, 'saude.json'), JSON.stringify(j));
    const modo = c.leve ? { leve: true, ateMs: agora + 3_600_000 } : { leve: false, ateMs: null };
    if (c.leve) fs.writeFileSync(path.join(home, 'saude-modo.json'), JSON.stringify({ v: 1, ...modo }));
    const esperado = decidirAvisos({ leitura: ler.lerSaude(home, agora).leitura, config: configSaude(home), modo, sessao: 'x', agoraMs: agora }).barra;
    assert.equal(saudeNaBarra(home, agora).barra, esperado, JSON.stringify(c));
  }
});

test('watchdog: parte que trava faz o hook sair 0 sem saída antes do timeout', () => {
  const dir = novoHome();
  const script = path.join(dir, 'trava.mjs');
  const comum = pathToFileURL(path.join(repo, 'src', 'hooks', 'comum.js')).href;
  fs.writeFileSync(script, `import { rodarHook } from ${JSON.stringify(comum)};
rodarHook(() => new Promise(() => { setInterval(() => {}, 1000); }), undefined, undefined, undefined, { prazoMs: 300 });
`);
  const inicio = Date.now();
  const r = spawnSync(process.execPath, [script], { input: '{}', encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(Date.now() - inicio < 5000);
});

test('guarda-despacho sem watchdog: guarda-* e liberar nunca recebem prazoMs', () => {
  const dirHooks = path.join(repo, 'src', 'hooks');
  for (const nome of fs.readdirSync(dirHooks).filter((n) => /^(guarda-.*|liberar)\.js$/.test(n))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dirHooks, nome), 'utf8'), /prazoMs/, nome);
  }
  for (const nome of ['prompt-submit.js', 'session-start.js', 'session-end.js']) {
    assert.match(fs.readFileSync(path.join(dirHooks, nome), 'utf8'), /\{ prazoMs: \d+ \}\);\s*$/, nome);
  }
});

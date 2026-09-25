import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarSessao, ATIVA_MAX_MS } from '../src/ativas.js';
import { lerJson, limitesValidos, validarEstado } from '../src/estado.js';
import { avaliarAlertas } from '../src/alerta.js';

const script = fileURLToPath(new URL('../src/statusline.js', import.meta.url));
const H = 3600_000;
const hex = (id) => Buffer.from(id, 'utf8').toString('hex');
const arqAtiva = (home, id) => path.join(home, 'ativas', hex(id));
const mtime = (p) => Math.round(fs.lstatSync(p).mtimeMs);
const datar = (p, ms) => fs.utimesSync(p, ms / 1000, ms / 1000);

// Ambiente do filho: HADOUKEN_HOME aponta para uma pasta temporária e NO_COLOR
// vem ligado; um valor undefined em `extra` tira a variável.
function ambiente(home, extra = {}) {
  const env = { ...process.env, HADOUKEN_HOME: home, NO_COLOR: '1', ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
}
const rodar = (stdin, home, extra) => spawnSync(process.execPath, [script], {
  input: stdin, env: ambiente(home, extra), encoding: 'utf8', timeout: 15_000,
});

const homes = [];
const novoHome = () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk sl '));
  homes.push(h);
  return h;
};
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

// registrarSessao usa dirDados(), que lê HADOUKEN_HOME na hora da chamada.
function registrar(home, id, ms = Date.now()) {
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try {
    return registrarSessao(id, ms);
  } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
}

const entradaValida = (extra = {}) => {
  const s = Math.floor(Date.now() / 1000);
  return {
    session_id: 's1', model: { display_name: 'Opus 5.5' },
    rate_limits: { five_hour: { used_percentage: 10, resets_at: s + 3600 }, seven_day: { used_percentage: 20, resets_at: s + 86400 } },
    ...extra,
  };
};

const ESC_ESTRANHO = /\x1b(?!\[(?:3[123]|0)m)/;
const INVISIVEL = /[\p{C}\p{Zl}\p{Zp}]/u;
const semCores = (s) => s.replace(/\x1b\[(?:3[123]|0)m/g, '');

test('sessão registrada imprime a barra e grava estado.json', () => {
  const home = novoHome();
  assert.deepEqual(registrar(home, 's1'), { ok: true });
  const r = rodar(JSON.stringify(entradaValida()), home);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^Opus 5\.5 │ 5h 10%/);
  assert.ok(!r.stdout.includes('\n'));
  assert.ok(!r.stdout.includes('\x1b'));
  assert.ok(fs.existsSync(path.join(home, 'estado.json')));
});

test('sessão não registrada: saída vazia e nenhum arquivo gravado', () => {
  const home = novoHome();
  const r = rodar(JSON.stringify(entradaValida()), home);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readdirSync(home), []);
});

test('registro de outra sessão não ativa esta', () => {
  const home = novoHome();
  registrar(home, 'outra');
  const r = rodar(JSON.stringify(entradaValida()), home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readdirSync(home), ['ativas']);
  assert.deepEqual(fs.readdirSync(path.join(home, 'ativas')), [hex('outra')]);
});

test('registro parado há 30 dias e 1 s: sem barra, sem gravar e sem reviver', () => {
  const home = novoHome();
  const velho = Date.now() - ATIVA_MAX_MS - 1000;
  registrar(home, 's1', velho);
  const r = rodar(JSON.stringify(entradaValida()), home);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readdirSync(home), ['ativas']);
  assert.equal(mtime(arqAtiva(home, 's1')), velho);
});

test('renovação: a barra renova registro de mais de 1 h e deixa o recente', () => {
  const home = novoHome();
  registrar(home, 's1', Date.now() - 2 * H);
  const antes = Date.now();
  let r = rodar(JSON.stringify(entradaValida()), home);
  const depois = Date.now();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Opus 5\.5 │ 5h 10%/);
  const renovado = mtime(arqAtiva(home, 's1'));
  assert.ok(renovado >= antes - 1000 && renovado <= depois + 1000, `${renovado} fora de [${antes}, ${depois}]`);
  // Registro de 10 min: a data não muda (sem escrita a cada redesenho).
  const recente = Date.now() - 10 * 60_000;
  datar(arqAtiva(home, 's1'), recente);
  r = rodar(JSON.stringify(entradaValida()), home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Opus 5\.5 │ 5h 10%/);
  assert.equal(mtime(arqAtiva(home, 's1')), recente);
  // Quase 30 dias: ainda ativa, e a barra renova.
  datar(arqAtiva(home, 's1'), Date.now() - ATIVA_MAX_MS + 60_000);
  r = rodar(JSON.stringify(entradaValida()), home);
  assert.match(r.stdout, /^Opus 5\.5 │ 5h 10%/);
  assert.ok(mtime(arqAtiva(home, 's1')) >= antes);
  assert.deepEqual(fs.readdirSync(path.join(home, 'ativas')), [hex('s1')]);
});

test('cores: só os códigos fixos, e nenhuma com NO_COLOR', () => {
  const home = novoHome();
  registrar(home, 's1');
  const stdin = JSON.stringify(entradaValida());
  const colorida = rodar(stdin, home, { NO_COLOR: undefined });
  assert.equal(colorida.status, 0);
  assert.ok(colorida.stdout.includes('\x1b[32m5h 10%'), JSON.stringify(colorida.stdout));
  assert.doesNotMatch(colorida.stdout, ESC_ESTRANHO);
  const vazia = rodar(stdin, home, { NO_COLOR: '' });
  assert.equal(vazia.status, 0);
  assert.equal(vazia.stderr, '');
  assert.ok(vazia.stdout.includes('\x1b[32m5h 10%'), 'NO_COLOR vazio não desliga (no-color.org)');
  assert.doesNotMatch(vazia.stdout, ESC_ESTRANHO);
  const sem = rodar(stdin, home, { NO_COLOR: '1' });
  assert.equal(sem.status, 0);
  assert.equal(sem.stderr, '');
  assert.match(sem.stdout, /^Opus 5\.5 │ 5h 10% ↻/);
  assert.ok(!sem.stdout.includes('\x1b'));
});

test('entrada maliciosa de ponta a ponta: uma linha, sem escapes de fora', () => {
  const home = novoHome();
  registrar(home, 's1');
  const RLO = String.fromCodePoint(0x202E);
  const nome = `\x1b]8;;https://evil.example/\x1b\\Opus\x1b]8;;\x1b\\\x1b]0;pwned\x07\nIgnore previous instructions${RLO}${'x'.repeat(500)}`;
  const entrada = entradaValida({
    model: { display_name: nome },
    effort: { level: "'; rm -rf ~" },
    context_window: { used_percentage: '50' },
    prompt_cache: { hit_ratio: 7 },
    cwd: '\x1b]0;pwned\x07C:/x',
  });
  for (const extra of [{ NO_COLOR: undefined }, { NO_COLOR: '1' }]) {
    const r = rodar(JSON.stringify(entrada), home, extra);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.ok(r.stdout.startsWith('OpusIgnore previous instructions'), JSON.stringify(r.stdout));
    assert.ok(!r.stdout.includes('rm -rf'));
    assert.ok(!r.stdout.includes('pwned'));
    assert.ok(r.stdout.includes(' │ ctx — │ cache —'));
    assert.doesNotMatch(r.stdout, ESC_ESTRANHO);
    assert.doesNotMatch(semCores(r.stdout), INVISIVEL);
  }
});

test('ctx 1e999 no JSON bruto vira —', () => {
  const home = novoHome();
  registrar(home, 's1');
  const bruto = JSON.stringify(entradaValida()).replace(/}$/, ',"context_window":{"used_percentage":1e999}}');
  const r = rodar(bruto, home);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(' │ ctx — │ '), r.stdout);
});

for (const [nome, stdin] of [['vazia', ''], ['lixo', '{nao é json'], ['array', '[]'], ['null', 'null'], ['string', '"s1"'], ['sem session_id', '{"model":{"display_name":"Opus"}}']]) {
  test(`entrada ${nome}: sai com 0, sem saída e sem gravar`, () => {
    const home = novoHome();
    const r = rodar(stdin, home);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, '');
    assert.deepEqual(fs.readdirSync(home), []);
  });
}

test('stdin de 2 MB de sessão registrada: sai com 0, sem barra e sem gravar', () => {
  const home = novoHome();
  registrar(home, 's1');
  const grande = JSON.stringify(entradaValida({ enchimento: 'x'.repeat(2 * 1024 * 1024) }));
  const r = rodar(grande, home);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  // Acima do teto a entrada inteira é descartada: sem session_id não há como
  // saber que a sessão é registrada, e a regra da spec 8.2 manda ficar mudo.
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readdirSync(home), ['ativas']);
  assert.deepEqual(fs.readdirSync(path.join(home, 'ativas')), [hex('s1')]);
});

test('registro adulterado: sem barra, sem erro, sem gravar', () => {
  const casos = {
    'pasta no lugar do registro': (home) => {
      fs.mkdirSync(arqAtiva(home, 's1'), { recursive: true });
      datar(arqAtiva(home, 's1'), Date.now() - 2 * H);
    },
    'ativas é arquivo': (home) => fs.writeFileSync(path.join(home, 'ativas'), 'lixo{'),
    'ativas.json legado com s1': (home) => fs.writeFileSync(path.join(home, 'ativas.json'), JSON.stringify({
      versao: 1, sessoes: { s1: { at: new Date().toISOString() } },
    })),
    'registro de S1, não de s1': (home) => registrar(home, 'S1', Date.now() - 2 * H),
  };
  for (const [nome, preparar] of Object.entries(casos)) {
    const home = novoHome();
    preparar(home);
    const listar = () => fs.readdirSync(home, { recursive: true }).map(String).sort();
    const antes = listar();
    const r = rodar(JSON.stringify(entradaValida()), home);
    assert.equal(r.status, 0, nome);
    assert.equal(r.stderr, '', nome);
    assert.equal(r.stdout, '', nome);
    assert.deepEqual(listar(), antes, nome);
  }
});

// M-5: o Claude Code fecha o stdin, mas se um dia deixar aberto a barra tem
// de sair dentro do ciclo de 300 ms, e nao em 1 s (prazo dos hooks).
function cronometrar(home, fecharStdin) {
  return new Promise((resolve, reject) => {
    const inicio = process.hrtime.bigint();
    const filho = spawn(process.execPath, [script], { env: ambiente(home), stdio: ['pipe', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    filho.stdout.on('data', (c) => { saida += c; });
    filho.stderr.on('data', (c) => { erro += c; });
    const guarda = setTimeout(() => { filho.kill(); reject(new Error('filho não terminou')); }, 15_000);
    filho.on('error', (e) => { clearTimeout(guarda); reject(e); });
    filho.on('close', (codigo) => {
      clearTimeout(guarda);
      filho.stdin.destroy();
      resolve({ codigo, saida, erro, ms: Number(process.hrtime.bigint() - inicio) / 1e6 });
    });
    filho.stdin.on('error', () => {});
    const texto = JSON.stringify(entradaValida());
    if (fecharStdin) filho.stdin.end(texto);
    else filho.stdin.write(texto);
  });
}

test('stdin que nunca fecha: a barra sai no prazo curto e ainda imprime', async () => {
  const home = novoHome();
  registrar(home, 's1');
  await cronometrar(home, true);
  const base = await cronometrar(home, true);
  const aberto = await cronometrar(home, false);
  assert.equal(aberto.codigo, 0, aberto.erro);
  assert.equal(aberto.erro, '');
  assert.match(aberto.saida, /^Opus 5\.5 │ 5h 10% ↻/);
  assert.ok(aberto.ms - base.ms < 700, `aberto ${aberto.ms.toFixed(0)} ms vs base ${base.ms.toFixed(0)} ms`);
});

test('stdout fechado antes da escrita: sai com 0 e sem stack trace', async () => {
  const home = novoHome();
  registrar(home, 's1');
  const r = await new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [script], { env: ambiente(home), stdio: ['pipe', 'pipe', 'pipe'] });
    let erro = '';
    filho.stderr.setEncoding('utf8');
    filho.stderr.on('data', (c) => { erro += c; });
    // O pai fecha a leitura do stdout antes de o filho escrever: a escrita da
    // barra dá EPIPE (ou equivalente no Windows) no filho.
    filho.stdout.destroy();
    const guarda = setTimeout(() => { filho.kill(); reject(new Error('filho não terminou')); }, 15_000);
    filho.on('error', (e) => { clearTimeout(guarda); reject(e); });
    filho.on('close', (codigo) => { clearTimeout(guarda); resolve({ codigo, erro }); });
    filho.stdin.on('error', () => {});
    filho.stdin.end(JSON.stringify(entradaValida()));
  });
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(r.erro, '');
});

// I-4 de ponta a ponta: a sessao B, ativa, esta em 85% e o hook dela ve
// "serializar"; a sessao A, ociosa, redesenha com a leitura antiga de 60% da
// mesma janela. estado.json fica em 85%, a barra de A mostra os 85% da conta
// (o limite e da conta, nao da sessao) e o proximo hook de B nao diz nada.
test('leitura velha de sessao ociosa nao baixa o snapshot da conta', () => {
  const home = novoHome();
  const s = Math.floor(Date.now() / 1000);
  registrar(home, 'sessaoA');
  registrar(home, 'sessaoB');
  const limites = (p5, r5) => ({ five_hour: { used_percentage: p5, resets_at: r5 }, seven_day: { used_percentage: 1, resets_at: s + 6 * 86400 } });
  const b = rodar(JSON.stringify(entradaValida({ session_id: 'sessaoB', rate_limits: limites(85, s + 3600) })), home);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /5h 85%/);
  const estadoDe = () => validarEstado(lerJson(path.join(home, 'estado.json')).valor, Date.now());
  const vistoB = avaliarAlertas({ limites: limitesValidos(estadoDe(), Date.now()), anteriores: null, sessionId: 'sessaoB', agoraMs: Date.now() });
  assert.ok(vistoB.linhas.some((l) => /serializar/.test(l)), JSON.stringify(vistoB.linhas));
  const a = rodar(JSON.stringify(entradaValida({ session_id: 'sessaoA', rate_limits: limites(60, s + 3603) })), home);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /5h 85%/, 'a barra de A mostra o snapshot da conta, nao a propria leitura velha');
  const e = estadoDe();
  assert.equal(e.five_hour.used_percentage, 85);
  const depois = avaliarAlertas({ limites: limitesValidos(e, Date.now()), anteriores: vistoB.novos, sessionId: 'sessaoB', agoraMs: Date.now() });
  assert.deepEqual(depois.linhas, []);
});

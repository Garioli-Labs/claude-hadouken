import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  caminhoBinario, programa, registrarInstalacao, extrairColetor, conferirIntegridade, lerPid, nomeDoProcesso, coletorVivo, coletorSaiu,
  classificarLog, subirColetor, pararColetor, ehOrfao, hashArquivo, NOME_BINARIO, ORFAO_MS, PORTA_OCUPADA, _retomarSubindoVencida,
} from '../src/aprendizado/coletor.js';

// Vida do Collector (spec aprendizado §3.3 e §8 "Coletor"): um processo
// falso em Node no lugar do binário; tasklist, ps e taskkill trocados por
// funções que respondem o que o teste quer. Pastas temporárias.

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FALSO = path.join(aqui, 'fixtures', 'coletor-falso.mjs');
const PARALELO = path.join(aqui, 'fixtures', 'subir-paralelo.mjs');
const GiB = 1024 ** 3;
const plat = process.platform;
const dirs = [];
const filhos = [];
// Preflight I4: cada filho falso sai antes de a pasta ser apagada (no Windows
// o filho morto ainda segura o cwd em otel/ e o coletor.log por alguns ms), e
// o rmSync tenta de novo, como o tirar() do ligar.js. O subirColetor deu
// unref no filho; o ref e o relógio mantêm o laço vivo até o 'exit' (no Node
// 20 o laço terminava antes e cancelava testes, commit 8d1bff3).
after(async () => {
  for (const f of filhos) {
    if (f.exitCode !== null || f.signalCode !== null) continue;
    const saiu = once(f, 'exit');
    f.ref();
    try { f.kill(); } catch { /* já saiu */ }
    let relogio;
    await Promise.race([saiu, new Promise((r) => { relogio = setTimeout(r, 5000); })]);
    clearTimeout(relogio);
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk coletor ç '));
  dirs.push(d);
  return d;
}
function instalarFalso(d, conteudo = 'binario falso') {
  fs.mkdirSync(path.join(d, 'otel', 'bin'), { recursive: true });
  fs.writeFileSync(caminhoBinario(d, plat), conteudo);
  assert.equal(registrarInstalacao(d, plat).ok, true);
}
function gravarPid(d, pid, emMs = Date.now()) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(d, 'otel', 'coletor.pid'), JSON.stringify({ v: 1, pid, em: new Date(emMs).toISOString() }));
}
// "tasklist"/"ps" falso: vivos é o conjunto de PIDs que respondem com o nome do Collector.
function consultaFalsa(vivos, chamadas = []) {
  return (arquivo, args) => {
    chamadas.push({ arquivo, args });
    const pid = Number(plat === 'win32' ? String(args[1]).replace('PID eq ', '') : args[1]);
    if (!vivos.has(pid)) {
      if (plat === 'win32') return 'INFO: No tasks are running which match the specified criteria.\r\n';
      throw Object.assign(new Error('sem processo'), { status: 1 });
    }
    return plat === 'win32' ? `"otelcol-contrib.exe","${pid}","Console","1","80.000 K"\r\n` : 'otelcol-contrib\n';
  };
}
function gerarFalso(chamadas, msg, ms = 3000) {
  return (bin, args, opcoes) => {
    chamadas.push({ bin, args, opcoes });
    const filho = spawn(process.execPath, [FALSO, msg, String(ms)], opcoes);
    filhos.push(filho);
    return filho;
  };
}
// Preflight M1: um "gerar" que não cria processo, para nenhum filho disputar
// o coletor.log com o teste.
function gerarSemProcesso(chamadas, extra = {}) {
  return (bin, args, opcoes) => {
    chamadas.push({ bin, args, opcoes });
    return { pid: 99999, unref() {}, on() {}, kill() {}, ...extra };
  };
}
async function esperarLog(d, re) {
  const log = path.join(d, 'otel', 'coletor.log');
  for (let i = 0; i < 100; i++) {
    const t = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    if (re.test(t)) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
// .tar.gz com um só membro, montado aqui (cabeçalho ustar de 512 bytes).
function tarGz(nome, conteudo) {
  const h = Buffer.alloc(512);
  h.write(nome, 0, 'utf8');
  h.write('0000755\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${conteudo.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let soma = 0;
  for (const b of h) soma += b;
  h.write(`${soma.toString(8).padStart(6, '0')}\0 `, 148);
  const resto = Buffer.alloc((512 - (conteudo.length % 512)) % 512);
  return zlib.gzipSync(Buffer.concat([h, conteudo, resto, Buffer.alloc(1024)]));
}

test('programa: System32 por caminho absoluto no Windows; tar e ps do sistema no POSIX', () => {
  assert.equal(programa('tar', { plataforma: 'win32', systemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\tar.exe');
  assert.equal(programa('taskkill', { plataforma: 'win32', systemRoot: 'relativo' }), 'C:\\Windows\\System32\\taskkill.exe');
  assert.equal(programa('tasklist', { plataforma: 'win32', systemRoot: '' }), 'C:\\Windows\\System32\\tasklist.exe');
  assert.equal(programa('ps', { plataforma: 'linux' }), '/bin/ps');
  assert.equal(programa('cmd', { plataforma: 'win32', systemRoot: 'C:\\Windows' }), null, 'só os programas da lista');
  assert.equal(programa('sh', { plataforma: 'linux' }), null);
});

test('extrair com o tar do sistema: só o membro fixado, hash do binário em instalado.json; sem o membro, falha limpa', () => {
  const d = novoDir();
  const bin = path.join(d, 'otel', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const nome = plat === 'win32' ? NOME_BINARIO.win32 : NOME_BINARIO.posix;
  fs.writeFileSync(path.join(bin, 'c.tar.gz'), tarGz(nome, Buffer.from('conteudo do binario')));
  assert.deepEqual(extrairColetor({ dir: d, tarGz: path.join(bin, 'c.tar.gz') }), { ok: true });
  assert.equal(fs.readFileSync(caminhoBinario(d), 'utf8'), 'conteudo do binario');
  assert.deepEqual(conferirIntegridade(d), { ok: true });
  const e = novoDir();
  fs.mkdirSync(path.join(e, 'otel', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(e, 'otel', 'bin', 'c.tar.gz'), tarGz('outro-nome', Buffer.from('x')));
  assert.deepEqual(extrairColetor({ dir: e, tarGz: path.join(e, 'otel', 'bin', 'c.tar.gz') }), { ok: false, motivo: 'extrair' });
  assert.equal(fs.existsSync(caminhoBinario(e)), false);
});

test('extrair (R12): tar do System32, cwd em otel/bin, nomes relativos, prazo de no máximo 120 s', () => {
  const d = novoDir();
  const bin = path.join(d, 'otel', 'bin');
  const chamadas = [];
  const executar = (arquivo, args, opcoes) => {
    chamadas.push({ arquivo, args, opcoes });
    fs.writeFileSync(path.join(opcoes.cwd, args[2]), 'extraido');
  };
  const r = extrairColetor({ dir: d, tarGz: path.join(bin, 'otelcol-contrib_0.162.0_windows_amd64.tar.gz'), plataforma: 'win32', executar, systemRoot: 'C:\\Windows' });
  assert.deepEqual(r, { ok: true });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].arquivo, 'C:\\Windows\\System32\\tar.exe');
  assert.deepEqual(chamadas[0].args, ['-xzf', 'otelcol-contrib_0.162.0_windows_amd64.tar.gz', 'otelcol-contrib.exe']);
  assert.equal(chamadas[0].opcoes.cwd, bin);
  assert.equal(chamadas[0].opcoes.windowsHide, true);
  assert.ok(chamadas[0].opcoes.timeout > 0 && chamadas[0].opcoes.timeout <= 120_000, String(chamadas[0].opcoes.timeout));
  assert.deepEqual(conferirIntegridade(d, { plataforma: 'win32' }), { ok: true });
});

test('extrair: .tar.gz fora de otel/bin, com nome fora da lista ou tar que falha não deixa binário', () => {
  const d = novoDir();
  const bin = path.join(d, 'otel', 'bin');
  let chamou = 0;
  const executar = () => { chamou += 1; };
  for (const ruim of [path.join(d, 'otel', 'c.tar.gz'), path.join(bin, '-x.tar.gz'), path.join(bin, 'c d.tar.gz'), path.join(bin, 'c.zip'), null]) {
    assert.deepEqual(extrairColetor({ dir: d, tarGz: ruim, plataforma: 'win32', executar }), { ok: false, motivo: 'extrair' }, String(ruim));
  }
  assert.equal(chamou, 0);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(caminhoBinario(d, 'win32'), 'velho');
  const falha = () => { throw Object.assign(new Error('tar: otelcol-contrib.exe: Not found in archive'), { status: 1 }); };
  assert.deepEqual(extrairColetor({ dir: d, tarGz: path.join(bin, 'c.tar.gz'), plataforma: 'win32', executar: falha }), { ok: false, motivo: 'extrair' });
  assert.equal(fs.existsSync(caminhoBinario(d, 'win32')), false, 'o binário anterior sai antes do tar');
});

test('integridade (§3.3, R7): tamanho e mtime iguais não recalculam; binário trocado ou sem instalado.json bloqueia', () => {
  const d = novoDir();
  assert.deepEqual(conferirIntegridade(d), { ok: false, motivo: 'coletor-ausente' });
  instalarFalso(d);
  const esperado = crypto.createHash('sha256').update('binario falso').digest('hex');
  assert.equal(hashArquivo(caminhoBinario(d)), esperado);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'otel', 'bin', 'instalado.json'), 'utf8')).sha256, esperado);
  let hashes = 0;
  const hashar = () => { hashes += 1; return 'f'.repeat(64); };
  assert.deepEqual(conferirIntegridade(d, { hashar }), { ok: true });
  assert.equal(hashes, 0);
  fs.appendFileSync(caminhoBinario(d), 'trocado');
  assert.deepEqual(conferirIntegridade(d), { ok: false, motivo: 'coletor-hash' });
  instalarFalso(d);
  fs.rmSync(path.join(d, 'otel', 'bin', 'instalado.json'));
  assert.deepEqual(conferirIntegridade(d), { ok: false, motivo: 'coletor-hash' });
});

test('integridade: mtime mudado com o mesmo conteúdo recalcula, confere e grava o mtime novo', () => {
  const d = novoDir();
  instalarFalso(d);
  const velho = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(caminhoBinario(d), velho, velho);
  let hashes = 0;
  const hashar = (arq) => { hashes += 1; return hashArquivo(arq); };
  assert.deepEqual(conferirIntegridade(d, { hashar }), { ok: true });
  assert.equal(hashes, 1);
  assert.deepEqual(conferirIntegridade(d, { hashar }), { ok: true });
  assert.equal(hashes, 1, 'o mtime novo ficou gravado');
});

test('nomeDoProcesso: tasklist em CSV pelo System32; ps -o comm=; ausente = null', () => {
  const chamadas = [];
  const win = (arquivo, args) => {
    chamadas.push({ arquivo, args });
    return '"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n';
  };
  assert.equal(nomeDoProcesso(4242, { plataforma: 'win32', executar: win, systemRoot: 'C:\\Windows' }), 'otelcol-contrib.exe');
  assert.deepEqual(chamadas[0], { arquivo: 'C:\\Windows\\System32\\tasklist.exe', args: ['/FI', 'PID eq 4242', '/FO', 'CSV', '/NH'] });
  assert.equal(nomeDoProcesso(4243, { plataforma: 'win32', executar: win }), null, 'outro PID na resposta não conta');
  assert.equal(nomeDoProcesso(7, { plataforma: 'linux', executar: () => '/opt/x/otelcol-contrib\n' }), 'otelcol-contrib');
  assert.equal(nomeDoProcesso(7, { plataforma: 'linux', executar: () => { throw new Error('status 1'); } }), null);
  assert.equal(nomeDoProcesso(-1, { plataforma: 'linux', executar: () => 'x' }), null);
});

test('subirColetor: desanexado e sem janela, stderr no coletor.log, só o ambiente permitido, PID gravado', async () => {
  const d = novoDir();
  instalarFalso(d);
  const chamadas = [];
  const r = subirColetor({
    dir: d, agoraMs: Date.now(), plataforma: plat, memLivre: () => 8 * GiB,
    env: { ...process.env, OTEL_LOGS_EXPORTER: 'otlp', SEGREDO_TESTE: 'x', PATH: '/x', GOMEMLIMIT: '1GiB' },
    gerar: gerarFalso(chamadas, 'oi'), executar: consultaFalsa(new Set()),
  });
  assert.equal(r.ok, true);
  assert.equal(r.evento, null);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].bin, caminhoBinario(d));
  assert.deepEqual(chamadas[0].args, ['--config', path.join(d, 'otel', 'config.yaml')]);
  assert.equal(chamadas[0].opcoes.detached, true);
  assert.equal(chamadas[0].opcoes.windowsHide, true);
  assert.equal(chamadas[0].opcoes.cwd, path.join(d, 'otel'));
  assert.deepEqual(chamadas[0].opcoes.stdio.slice(0, 2), ['ignore', 'ignore']);
  const env = chamadas[0].opcoes.env;
  // Emenda 2026-10-01: a RAM do portão (108 MiB parado) foi medida com GOMEMLIMIT=96MiB.
  assert.equal(env.GOMEMLIMIT, '96MiB', 'o limite fixo, nunca o do ambiente');
  for (const k of Object.keys(env)) {
    assert.ok(['SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'TZ', 'GOMEMLIMIT'].includes(k), k);
  }
  assert.equal(new Set(Object.keys(env).map((k) => k.toLowerCase())).size, Object.keys(env).length, 'sem nome repetido em outra caixa');
  assert.equal(lerPid(d).pid, r.pid);
  assert.ok(await esperarLog(d, /falso otel:0 segredo:nao oi/), 'o Collector não herda OTEL_* nem segredos');
  assert.ok(fs.readFileSync(path.join(d, 'otel', 'config.yaml'), 'utf8').includes('endpoint: 127.0.0.1:47318'));
  assert.equal(fs.existsSync(path.join(d, 'otel', 'subindo.lock')), false, 'a trava sai');
});

test('subirColetor: vivo, pouca RAM, integridade e trava de subida', () => {
  const d = novoDir();
  instalarFalso(d);
  const chamadas = [];
  const base = { dir: d, agoraMs: Date.now(), plataforma: plat, env: {}, gerar: gerarFalso(chamadas, 'x') };
  gravarPid(d, 4242);
  assert.deepEqual(subirColetor({ ...base, memLivre: () => 8 * GiB, executar: consultaFalsa(new Set([4242])) }), { ok: false, motivo: 'vivo', evento: null });
  fs.rmSync(path.join(d, 'otel', 'coletor.pid'));
  assert.deepEqual(subirColetor({ ...base, memLivre: () => GiB, executar: consultaFalsa(new Set()) }), { ok: false, motivo: 'pouca-ram', evento: null });
  fs.writeFileSync(path.join(d, 'otel', 'subindo.lock'), '');
  assert.deepEqual(subirColetor({ ...base, memLivre: () => 8 * GiB, executar: consultaFalsa(new Set()) }), { ok: false, motivo: 'subindo', evento: null });
  const velho = (Date.now() - 5 * 60_000) / 1000;
  fs.utimesSync(path.join(d, 'otel', 'subindo.lock'), velho, velho);
  fs.appendFileSync(caminhoBinario(d), 'trocado');
  assert.deepEqual(subirColetor({ ...base, memLivre: () => 8 * GiB, executar: consultaFalsa(new Set()) }), { ok: false, motivo: 'coletor-hash', evento: null });
  assert.equal(chamadas.length, 0);
  assert.equal(fs.existsSync(path.join(d, 'otel', 'subindo.lock')), false);
});

test('porta ocupada (R6): o log da subida anterior vira o evento e o PID velho sai', () => {
  const d = novoDir();
  instalarFalso(d);
  const log = path.join(d, 'otel', 'coletor.log');
  gravarPid(d, 4242);
  fs.writeFileSync(log, 'Error: cannot start pipelines: listen tcp 127.0.0.1:47318: bind: address already in use\n');
  assert.equal(classificarLog(d), 'porta-ocupada');
  const chamadas = [];
  const r = subirColetor({ dir: d, agoraMs: Date.now(), plataforma: plat, memLivre: () => 8 * GiB, env: {}, gerar: gerarSemProcesso(chamadas), executar: consultaFalsa(new Set()) });
  assert.equal(r.ok, true);
  assert.equal(r.evento, 'porta-ocupada');
  assert.equal(lerPid(d).pid, 99999, 'o PID velho saiu');
  assert.equal(chamadas.length, 1);
  assert.equal(fs.readFileSync(log, 'utf8'), '', 'o log da subida nova começa vazio');
  fs.writeFileSync(log, 'Only one usage of each socket address (protocol/network address/port) is normally permitted.\n');
  assert.equal(classificarLog(d), 'porta-ocupada');
  fs.writeFileSync(log, 'panic: runtime error\n');
  assert.equal(classificarLog(d), 'coletor-falhou');
  fs.writeFileSync(log, '');
  assert.equal(classificarLog(d), null);
});

test('porta ocupada, Emenda 2026-10-01: a mensagem localizada do Windows em português, lida de um log UTF-8', () => {
  const d = novoDir();
  instalarFalso(d);
  const log = path.join(d, 'otel', 'coletor.log');
  const pt = 'Error: cannot start pipelines: failed to start "otlp" receiver: listen tcp 127.0.0.1:47318: bind: '
    + 'Normalmente é permitida apenas uma utilização de cada endereço de soquete (protocolo/endereço de rede/porta).\n';
  assert.match(pt, PORTA_OCUPADA);
  gravarPid(d, 4242);
  fs.writeFileSync(log, Buffer.from(`2026-10-01T21:31:30.026-0300\terror\tservice@v0.162.0/service.go:189\t${pt}`, 'utf8'));
  assert.equal(classificarLog(d), 'porta-ocupada');
  const r = subirColetor({ dir: d, agoraMs: Date.now(), plataforma: plat, memLivre: () => 8 * GiB, env: {}, gerar: gerarSemProcesso([]), executar: consultaFalsa(new Set()) });
  assert.equal(r.ok, true);
  assert.equal(r.evento, 'porta-ocupada');
  // Só a frase em português, sem o "error" do zap na frente: casa pelo "listen tcp ...: bind:".
  fs.writeFileSync(log, Buffer.from('listen tcp 127.0.0.1:47318: bind: Normalmente é permitida apenas uma utilização de cada endereço de soquete\n', 'utf8'));
  assert.equal(classificarLog(d), 'porta-ocupada');
});

test('classificarLog: lê o fim de um log grande pelo conteúdo, nunca o repete', () => {
  const d = novoDir();
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  const log = path.join(d, 'otel', 'coletor.log');
  const enchimento = 'info ok\n'.repeat(20_000);
  fs.writeFileSync(log, `${enchimento}listen tcp 127.0.0.1:47318: bind: Normalmente é permitida apenas uma utilização\n`);
  assert.equal(classificarLog(d), 'porta-ocupada');
  fs.writeFileSync(log, `panic: no começo\n${enchimento}`);
  assert.equal(classificarLog(d), null, 'só os últimos 64 KiB contam');
  assert.equal(classificarLog(path.join(d, 'nao-existe')), null);
});

test('Foco de revisão 3: dois SessionStart ao mesmo tempo sobem um só Collector, sem porta-ocupada falso', async () => {
  const d = novoDir();
  instalarFalso(d);
  const rodar = () => new Promise((pronto) => {
    const filho = spawn(process.execPath, [PARALELO, d], { stdio: ['ignore', 'pipe', 'inherit'] });
    let saida = '';
    filho.stdout.on('data', (b) => { saida += b; });
    filho.on('close', () => pronto(JSON.parse(saida)));
  });
  const rs = await Promise.all([rodar(), rodar()]);
  assert.equal(fs.readFileSync(path.join(d, 'gerados.txt'), 'utf8').trim().split('\n').length, 1);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok(rs.every((r) => r.ok || r.motivo === 'vivo' || r.motivo === 'subindo'));
  assert.ok(rs.every((r) => r.evento === null));
});

test('trava de subida: só o dono a solta; a retomada devolve uma trava que não venceu', () => {
  const d = novoDir();
  instalarFalso(d);
  const trava = path.join(d, 'otel', 'subindo.lock');
  // Outro processo levou a trava (vencida) enquanto este subia: a dele fica.
  const gerar = gerarSemProcesso([], {});
  const r = subirColetor({
    dir: d, agoraMs: Date.now(), plataforma: plat, memLivre: () => 8 * GiB, env: {}, executar: consultaFalsa(new Set()),
    gerar: (...a) => { fs.writeFileSync(trava, 'outro-dono'); return gerar(...a); },
  });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(trava, 'utf8'), 'outro-dono');
  // Trava nova: a retomada a devolve intacta.
  assert.equal(_retomarSubindoVencida(trava), false);
  assert.equal(fs.readFileSync(trava, 'utf8'), 'outro-dono');
  assert.deepEqual(fs.readdirSync(path.join(d, 'otel')).filter((n) => n.endsWith('.velha')), []);
  // Trava vencida: sai.
  const velho = (Date.now() - 5 * 60_000) / 1000;
  fs.utimesSync(trava, velho, velho);
  assert.equal(_retomarSubindoVencida(trava), true);
  assert.equal(fs.existsSync(trava), false);
});

test('subirColetor: consulta que falha não é "morto"; sem o PID gravado, o filho é morto', () => {
  const d = novoDir();
  fs.mkdirSync(path.join(d, 'otel', 'bin'), { recursive: true });
  fs.writeFileSync(caminhoBinario(d, 'win32'), 'binario falso');
  assert.equal(registrarInstalacao(d, 'win32').ok, true);
  gravarPid(d, 4242);
  const chamadas = [];
  const quebrada = () => { throw Object.assign(new Error('tasklist: prazo'), { code: 'ETIMEDOUT' }); };
  const base = { dir: d, agoraMs: Date.now(), plataforma: 'win32', systemRoot: 'C:\\Windows', memLivre: () => 8 * GiB, env: {} };
  assert.deepEqual(subirColetor({ ...base, executar: quebrada, gerar: gerarSemProcesso(chamadas) }), { ok: false, motivo: 'erro', evento: null });
  assert.equal(chamadas.length, 0);
  assert.equal(lerPid(d).pid, 4242, 'o PID fica para a próxima conferência');
  // POSIX: ps que sai com 1 e nada no stdout é "sem processo"; outro erro não.
  const semPs = () => { throw Object.assign(new Error('spawn /bin/ps ENOENT'), { code: 'ENOENT' }); };
  const posix = { ...base, plataforma: 'linux' };
  fs.writeFileSync(caminhoBinario(d, 'linux'), 'binario falso');
  assert.equal(registrarInstalacao(d, 'linux').ok, true);
  assert.deepEqual(subirColetor({ ...posix, executar: semPs, gerar: gerarSemProcesso(chamadas) }), { ok: false, motivo: 'erro', evento: null });
  const ausente = () => { throw Object.assign(new Error('Command failed: /bin/ps'), { status: 1, stdout: '' }); };
  assert.equal(subirColetor({ ...posix, executar: ausente, gerar: gerarSemProcesso(chamadas) }).ok, true);
  // O PID que não grava (coletor.pid é uma pasta): o filho recém-nascido é morto.
  fs.rmSync(path.join(d, 'otel', 'coletor.pid'), { force: true });
  fs.mkdirSync(path.join(d, 'otel', 'coletor.pid'));
  let mortos = 0;
  const r = subirColetor({ ...base, executar: quebrada, gerar: gerarSemProcesso([], { kill() { mortos += 1; } }) });
  assert.deepEqual(r, { ok: false, motivo: 'erro', evento: null });
  assert.equal(mortos, 1);
});

test('pararColetor: confere o nome antes de matar; outro processo com o mesmo PID não é morto', () => {
  const d = novoDir();
  assert.deepEqual(pararColetor({ dir: d, plataforma: plat }), { ok: true, motivo: 'sem-pid' });
  gravarPid(d, 4242);
  const chamadas = [];
  const outro = (arquivo, args) => {
    chamadas.push({ arquivo, args });
    return '"notepad.exe","4242","Console","1","8.000 K"\r\n';
  };
  assert.deepEqual(pararColetor({ dir: d, plataforma: 'win32', executar: outro, systemRoot: 'C:\\Windows' }), { ok: false, motivo: 'outro-processo' });
  assert.ok(chamadas.every((c) => !c.arquivo.endsWith('taskkill.exe')));
  assert.equal(lerPid(d), null);

  gravarPid(d, 4242);
  const win = [];
  const executar = (arquivo, args) => {
    win.push({ arquivo, args });
    return '"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n';
  };
  assert.deepEqual(pararColetor({ dir: d, plataforma: 'win32', executar, systemRoot: 'C:\\Windows' }), { ok: true, motivo: 'parado' });
  assert.deepEqual(win.at(-1), { arquivo: 'C:\\Windows\\System32\\taskkill.exe', args: ['/pid', '4242', '/t', '/f'] });
  assert.equal(lerPid(d), null);

  gravarPid(d, 4242);
  const sinais = [];
  const r = pararColetor({ dir: d, plataforma: 'linux', executar: () => 'otelcol-contrib\n', matar: (pid, sinal) => sinais.push([pid, sinal]) });
  assert.deepEqual(r, { ok: true, motivo: 'parado' });
  assert.deepEqual(sinais, [[4242, 'SIGTERM']]);
});

test('pararColetor: processo já morto, consulta que falha e taskkill que falha', () => {
  const d = novoDir();
  const W = { plataforma: 'win32', systemRoot: 'C:\\Windows' };
  const VIVO = '"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n';
  const NADA = 'INFO: No tasks are running which match the specified criteria.\r\n';
  gravarPid(d, 4242);
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: () => NADA }), { ok: true, motivo: 'morto' });
  assert.equal(lerPid(d), null);

  gravarPid(d, 4242);
  const nomes = [];
  const quebrada = (arquivo) => { nomes.push(path.win32.basename(arquivo)); throw new Error('tasklist: prazo'); };
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: quebrada }), { ok: false, motivo: 'erro' });
  assert.deepEqual(nomes, ['tasklist.exe'], 'sem saber o nome, nada é morto');
  assert.equal(lerPid(d).pid, 4242, 'o PID fica para a próxima tentativa');

  // taskkill falha porque o processo saiu no meio: conta como morto.
  let consultas = 0;
  const saiuNoMeio = (arquivo) => {
    if (arquivo.endsWith('taskkill.exe')) throw Object.assign(new Error('não encontrado'), { status: 128 });
    consultas += 1;
    return consultas === 1 ? VIVO : NADA;
  };
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: saiuNoMeio }), { ok: true, motivo: 'morto' });
  assert.equal(lerPid(d), null);

  // taskkill falha e o Collector continua vivo: erro, e o PID fica.
  gravarPid(d, 4242);
  const negado = (arquivo) => {
    if (arquivo.endsWith('taskkill.exe')) throw Object.assign(new Error('acesso negado'), { status: 1 });
    return VIVO;
  };
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: negado }), { ok: false, motivo: 'erro' });
  assert.equal(lerPid(d).pid, 4242);

  // POSIX: ESRCH no kill, e o ps já não acha o processo.
  let ps = 0;
  const r = pararColetor({
    dir: d, plataforma: 'linux',
    executar: () => { ps += 1; if (ps === 1) return 'otelcol-contrib\n'; throw Object.assign(new Error('Command failed'), { status: 1, stdout: '' }); },
    matar: () => { throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }); },
  });
  assert.deepEqual(r, { ok: true, motivo: 'morto' });
  assert.equal(lerPid(d), null);
});

test('pararColetor com o coletorVivo da sessão: sem a primeira consulta, no máximo 3 chamadas de 1,5 s no total', () => {
  const d = novoDir();
  const W = { plataforma: 'win32', systemRoot: 'C:\\Windows' };
  const VIVO = '"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n';
  const chamadas = [];
  const negado = (arquivo) => {
    chamadas.push(path.win32.basename(arquivo));
    if (arquivo.endsWith('taskkill.exe')) throw Object.assign(new Error('acesso negado'), { status: 1 });
    return VIVO;
  };
  gravarPid(d, 4242);
  const vivo = coletorVivo(d, { ...W, executar: negado });
  assert.equal(vivo.vivo, true);
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: negado, vivo }), { ok: false, motivo: 'erro' });
  assert.deepEqual(chamadas, ['tasklist.exe', 'taskkill.exe', 'tasklist.exe'], 'a consulta do coletorVivo vale pela primeira');
  assert.equal(lerPid(d).pid, 4242);

  // O resultado só vale para o mesmo PID e com o Collector vivo; fora disso,
  // a consulta normal.
  chamadas.length = 0;
  const ok = (arquivo) => { chamadas.push(path.win32.basename(arquivo)); return VIVO; };
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: ok, vivo: { vivo: true, pid: 9999, emMs: 0 } }), { ok: true, motivo: 'parado' });
  assert.deepEqual(chamadas, ['tasklist.exe', 'taskkill.exe']);
  gravarPid(d, 4242);
  chamadas.length = 0;
  assert.deepEqual(pararColetor({ dir: d, ...W, executar: ok, vivo: { vivo: false, pid: 4242, emMs: 0 } }), { ok: true, motivo: 'parado' });
  assert.deepEqual(chamadas, ['tasklist.exe', 'taskkill.exe']);
});

test('coletorVivo e órfão (§3.3): vivo pelo nome; órfão com mais de 30 min sem sessão', () => {
  const d = novoDir();
  assert.deepEqual(coletorVivo(d, { plataforma: plat, executar: consultaFalsa(new Set()) }), { vivo: false, pid: null, emMs: null });
  const em = Date.now() - 60 * 60_000;
  gravarPid(d, 4242, em);
  assert.deepEqual(coletorVivo(d, { plataforma: plat, executar: consultaFalsa(new Set([4242])) }), { vivo: true, pid: 4242, emMs: em });
  const agora = Date.now();
  assert.equal(ehOrfao({ emMs: agora - ORFAO_MS - 1, ultimaOutraSessaoMs: null, agoraMs: agora }), true);
  assert.equal(ehOrfao({ emMs: agora - ORFAO_MS - 1, ultimaOutraSessaoMs: agora - 60_000, agoraMs: agora }), false);
  assert.equal(ehOrfao({ emMs: agora - 60_000, ultimaOutraSessaoMs: null, agoraMs: agora }), false);
});

// Rodada 1 da revisão da Task 8.

test('coletorVivo: consulta que falha vem marcada (consulta: "falhou"), sem virar "morto"', () => {
  const d = novoDir();
  const em = Date.now() - 60_000;
  gravarPid(d, 4242, em);
  const prazo = () => { throw Object.assign(new Error('tasklist: prazo'), { code: 'ETIMEDOUT' }); };
  assert.deepEqual(coletorVivo(d, { plataforma: 'win32', systemRoot: 'C:\\Windows', executar: prazo }), { vivo: false, pid: 4242, emMs: em, consulta: 'falhou' });
  const semPs = () => { throw Object.assign(new Error('spawn /bin/ps ENOENT'), { code: 'ENOENT' }); };
  assert.deepEqual(coletorVivo(d, { plataforma: 'linux', executar: semPs }), { vivo: false, pid: 4242, emMs: em, consulta: 'falhou' });
  // Morto de verdade: a forma de antes, sem o campo.
  const ausente = () => { throw Object.assign(new Error('Command failed: /bin/ps'), { status: 1, stdout: '' }); };
  assert.deepEqual(coletorVivo(d, { plataforma: 'linux', executar: ausente }), { vivo: false, pid: 4242, emMs: em });
  assert.deepEqual(coletorVivo(d, { plataforma: 'win32', executar: () => 'INFO: No tasks are running which match the specified criteria.\r\n' }), { vivo: false, pid: 4242, emMs: em });
  assert.deepEqual(coletorVivo(d, { plataforma: 'win32', executar: () => '"notepad.exe","4242","Console","1","8.000 K"\r\n' }), { vivo: false, pid: 4242, emMs: em });
  assert.equal(lerPid(d).pid, 4242, 'coletorVivo só lê; o PID fica');
});

test('lerPid: PID 0, negativo, fracionário, string, fora do inteiro seguro ou arquivo acima do teto não é PID', () => {
  const d = novoDir();
  const arq = path.join(d, 'otel', 'coletor.pid');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const em = new Date().toISOString();
  const nuncaConsulta = () => { throw new Error('sem PID válido, nada é consultado'); };
  const casos = [
    JSON.stringify({ v: 1, pid: 0, em }),
    JSON.stringify({ v: 1, pid: -4242, em }),
    JSON.stringify({ v: 1, pid: 4242.5, em }),
    JSON.stringify({ v: 1, pid: '4242', em }),
    JSON.stringify({ v: 1, pid: 2 ** 53, em }),
    `{"v":1,"pid":1e400,"em":"${em}"}`,
    JSON.stringify({ v: 1, em }),
    JSON.stringify({ v: 2, pid: 4242, em }),
    JSON.stringify([4242]),
    JSON.stringify({ v: 1, pid: 4242, em, enchimento: 'x'.repeat(2000) }),
  ];
  for (const texto of casos) {
    fs.writeFileSync(arq, texto);
    const rotulo = texto.slice(0, 60);
    assert.equal(lerPid(d), null, rotulo);
    assert.deepEqual(coletorVivo(d, { plataforma: plat, executar: nuncaConsulta }), { vivo: false, pid: null, emMs: null }, rotulo);
    assert.deepEqual(pararColetor({ dir: d, plataforma: plat, executar: nuncaConsulta }), { ok: true, motivo: 'sem-pid' }, rotulo);
  }
  fs.writeFileSync(arq, JSON.stringify({ v: 1, pid: 4242, em: 'não é data' }));
  assert.deepEqual(lerPid(d), { pid: 4242, emMs: null }, 'instante ilegível: o PID vale, sem o instante');
  fs.writeFileSync(arq, JSON.stringify({ v: 1, pid: 4242, em }));
  assert.deepEqual(lerPid(d), { pid: 4242, emMs: Date.parse(em) });
});

test('consulta do processo: tasklist e ps com stdio explícito, o stderr deles nunca chega ao hook', () => {
  const opcoes = [];
  const espia = (saida) => (_arquivo, _args, o) => { opcoes.push(o); return saida; };
  assert.equal(nomeDoProcesso(4242, { plataforma: 'win32', executar: espia('"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n') }), 'otelcol-contrib.exe');
  assert.equal(nomeDoProcesso(4242, { plataforma: 'linux', executar: espia('otelcol-contrib\n') }), 'otelcol-contrib');
  assert.equal(opcoes.length, 2);
  for (const o of opcoes) assert.deepEqual(o.stdio, ['ignore', 'pipe', 'ignore']);
});

test('consulta do processo: um tasklist que escreve no stderr não suja o stderr de quem chama', {
  skip: plat !== 'win32' && 'só no Windows: no POSIX o ps é /bin/ps fixo, sem como pôr um falso no lugar',
}, () => {
  const raiz = novoDir();
  const falso = path.join(raiz, 'System32', 'tasklist.exe');
  fs.mkdirSync(path.dirname(falso), { recursive: true });
  // O node.exe com outro nome: com "/FI ..." nos argumentos, ele procura o
  // módulo "\FI", escreve o erro no stderr e sai com 1.
  fs.copyFileSync(process.execPath, falso);
  // Aquecimento e prova de que o falso escreve no stderr. O antivírus examina
  // o .exe novo na primeira execução, o que pode passar dos 5 s da consulta;
  // depois dela, a consulta abaixo roda no tempo normal.
  const prova = spawnSync(falso, ['/FI', 'PID eq 4242', '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.equal(prova.status, 1);
  assert.match(prova.stderr, /Cannot find module/);
  // O "hook": o execFileSync de verdade, envolvido só para anotar o status de
  // saída, prova que o falso rodou (status 1) com as opções do coletor.js.
  const modulo = pathToFileURL(path.join(aqui, '..', 'src', 'aprendizado', 'coletor.js')).href;
  const codigo = [
    "import cp from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const original = cp.execFileSync;',
    'let status = null;',
    'cp.execFileSync = (...a) => { try { return original(...a); } catch (e) { status = e.status; throw e; } };',
    'syncBuiltinESMExports();',
    `const { nomeDoProcesso } = await import(${JSON.stringify(modulo)});`,
    "const nome = nomeDoProcesso(4242, { plataforma: 'win32', systemRoot: process.argv[1] });",
    'process.stdout.write(JSON.stringify({ nome, status }));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo, raiz], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { nome: null, status: 1 }, 'o tasklist falso rodou e saiu com 1');
  assert.equal(r.stderr, '', 'nada do tasklist no stderr do hook');
});

// Rodada 2 da revisão da Task 10: o desligar espera o Collector parado sair
// antes de apagar a pasta (o taskkill /t /f volta antes disso).
test('coletorSaiu: true sem processo ou com outro programa no PID, false com o Collector, null sem resposta', () => {
  assert.equal(coletorSaiu(4242, { plataforma: plat, executar: consultaFalsa(new Set()) }), true);
  assert.equal(coletorSaiu(4242, { plataforma: plat, executar: consultaFalsa(new Set([4242])) }), false);
  assert.equal(coletorSaiu(4242, { plataforma: 'win32', executar: () => '"notepad.exe","4242","Console","1","1.000 K"\r\n' }), true, 'PID já reaproveitado');
  assert.equal(coletorSaiu(4242, { plataforma: 'win32', executar: () => '"OTELCOL-CONTRIB.EXE","4242","Console","1","1.000 K"\r\n' }), false);
  const prazo = () => { throw Object.assign(new Error('tasklist: prazo'), { code: 'ETIMEDOUT' }); };
  assert.equal(coletorSaiu(4242, { plataforma: 'win32', systemRoot: 'C:\\Windows', executar: prazo }), null);
  const semPs = () => { throw Object.assign(new Error('spawn /bin/ps ENOENT'), { code: 'ENOENT' }); };
  assert.equal(coletorSaiu(4242, { plataforma: 'linux', executar: semPs }), null);
  assert.equal(coletorSaiu(4242, { plataforma: 'linux', executar: () => { throw Object.assign(new Error('status 1'), { status: 1, stdout: '' }); } }), true);
});

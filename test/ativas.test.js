import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  registrarSessao, sessaoAtiva, renovarSessao, idadeSessao, DIR_ATIVAS, ATIVA_MAX_MS, RENOVAR_APOS_MS,
} from '../src/ativas.js';

// Registro de ativacao (spec 8.2): um arquivo vazio por sessao em
// ativas/<hex(session_id)>; a data de modificacao e o unico dado.

let dir;
const homeOriginal = process.env.HADOUKEN_HOME;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadouken ativas ç '));
  process.env.HADOUKEN_HOME = dir;
});
afterEach(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
});

const H = 3600_000;
const D = 24 * H;
const agora = Date.UTC(2026, 8, 25, 18, 0);
const hex = (id) => Buffer.from(id, 'utf8').toString('hex');
const pasta = () => path.join(dir, DIR_ATIVAS);
const arqDe = (id) => path.join(pasta(), hex(id));
const mtime = (p) => Math.round(fs.lstatSync(p).mtimeMs);
const datar = (p, ms) => fs.utimesSync(p, ms / 1000, ms / 1000);

// Symlink de arquivo no Windows pede modo desenvolvedor; sem permissao o teste
// e pulado em vez de passar sem provar nada.
function link(t, alvo, caminho, tipo) {
  try {
    fs.symlinkSync(alvo, caminho, tipo);
    return true;
  } catch (e) {
    t.skip(`symlink indisponivel aqui (${e.code})`);
    return false;
  }
}

test('constantes: pasta ativas, 30 dias de vigencia, renovacao no maximo por hora', () => {
  assert.equal(DIR_ATIVAS, 'ativas');
  assert.equal(ATIVA_MAX_MS, 30 * D);
  assert.equal(RENOVAR_APOS_MS, H);
});

test('registrar cria ativas/<hex> vazio com a data de agora, e nada mais', () => {
  assert.deepEqual(registrarSessao('s1', agora), { ok: true });
  assert.deepEqual(fs.readdirSync(dir), ['ativas']);
  assert.deepEqual(fs.readdirSync(pasta()), ['7331']);
  assert.equal(fs.lstatSync(arqDe('s1')).size, 0);
  assert.ok(fs.lstatSync(arqDe('s1')).isFile());
  assert.equal(mtime(arqDe('s1')), agora);
  assert.equal(sessaoAtiva('s1', agora), true);
  assert.equal(sessaoAtiva('s2', agora), false);
  assert.equal(idadeSessao('s1', agora + 5000), 5000);
  assert.equal(idadeSessao('s2', agora), null);
});

test('duas sessoes: dois arquivos, uma nao mexe na outra', () => {
  registrarSessao('s1', agora - 2 * H);
  registrarSessao('s2', agora);
  assert.deepEqual(fs.readdirSync(pasta()).sort(), [hex('s1'), hex('s2')].sort());
  assert.equal(mtime(arqDe('s1')), agora - 2 * H);
  assert.equal(mtime(arqDe('s2')), agora);
  assert.equal(sessaoAtiva('s1', agora), true);
  assert.equal(sessaoAtiva('s2', agora), true);
});

test('maiusculas contam: s1 registrada nao ativa S1 (NTFS nao diferencia)', () => {
  registrarSessao('s1', agora);
  assert.equal(sessaoAtiva('S1', agora), false);
  assert.equal(idadeSessao('S1', agora), null);
  registrarSessao('abc', agora);
  assert.equal(sessaoAtiva('ABC', agora), false);
  assert.equal(sessaoAtiva('Abc', agora), false);
});

test('nomes reservados do Windows sao ids comuns (arquivo em hex)', () => {
  const reservados = ['CON', 'NUL', 'AUX', 'PRN', 'COM1', 'LPT9', 'con', 'nul'];
  for (const id of reservados) assert.deepEqual(registrarSessao(id, agora), { ok: true }, id);
  for (const id of reservados) assert.equal(sessaoAtiva(id, agora), true, id);
  const nomes = fs.readdirSync(pasta());
  assert.equal(nomes.length, reservados.length);
  for (const n of nomes) assert.match(n, /^[0-9a-f]+$/);
});

test('registrar de novo renova a data, mesmo de um registro vencido', () => {
  registrarSessao('s1', agora - 40 * D);
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.deepEqual(registrarSessao('s1', agora), { ok: true });
  assert.equal(mtime(arqDe('s1')), agora);
  assert.equal(sessaoAtiva('s1', agora), true);
  assert.deepEqual(fs.readdirSync(pasta()), [hex('s1')]);
});

test('vigencia: exatamente 30 dias vale; 30 dias e 1 ms nao; data no futuro vale', () => {
  registrarSessao('s1', agora);
  assert.equal(sessaoAtiva('s1', agora + ATIVA_MAX_MS), true);
  assert.equal(sessaoAtiva('s1', agora + ATIVA_MAX_MS + 1), false);
  assert.equal(sessaoAtiva('s1', agora + 29 * D), true);
  // Relogio que voltou: sem limite inferior, a sessao registrada continua ativa.
  assert.equal(sessaoAtiva('s1', agora - 3 * D), true);
  assert.equal(idadeSessao('s1', agora - 3 * D), -3 * D);
});

test('o gate nunca cria ativas/, nem o home', () => {
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.deepEqual(fs.readdirSync(dir), []);
  const inexistente = path.join(dir, 'nao', 'existe');
  process.env.HADOUKEN_HOME = inexistente;
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.equal(idadeSessao('s1', agora), null);
  assert.equal(renovarSessao('s1', agora), false);
  assert.equal(fs.existsSync(inexistente), false);
  assert.equal(fs.existsSync(path.join(dir, 'nao')), false);
});

test('registrar cria o home que ainda nao existe', () => {
  const novo = path.join(dir, 'a', 'b');
  process.env.HADOUKEN_HOME = novo;
  assert.deepEqual(registrarSessao('s1', agora), { ok: true });
  assert.ok(fs.lstatSync(path.join(novo, 'ativas', hex('s1'))).isFile());
});

test('sessaoAtiva e idadeSessao sao leitura pura: nao gravam, nao podam, nao renovam', () => {
  registrarSessao('s1', agora - 2 * H);
  fs.writeFileSync(arqDe('velha'), '');
  datar(arqDe('velha'), agora - 40 * D);
  const antes = fs.readdirSync(pasta()).sort();
  for (let i = 0; i < 5; i++) {
    sessaoAtiva('s1', agora);
    sessaoAtiva('velha', agora);
    idadeSessao('s1', agora);
    sessaoAtiva('outra', agora);
  }
  assert.deepEqual(fs.readdirSync(pasta()).sort(), antes);
  assert.equal(mtime(arqDe('s1')), agora - 2 * H);
  assert.equal(mtime(arqDe('velha')), agora - 40 * D);
});

test('diretorio no lugar de ativas/<hex>: inativo, e registrar/renovar nao tocam nele', () => {
  fs.mkdirSync(arqDe('s1'), { recursive: true });
  fs.writeFileSync(path.join(arqDe('s1'), 'dentro'), 'x');
  datar(arqDe('s1'), agora - 2 * H);
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.equal(idadeSessao('s1', agora), null);
  assert.deepEqual(registrarSessao('s1', agora), { ok: false, motivo: 'invalido' });
  assert.equal(renovarSessao('s1', agora), false);
  assert.ok(fs.lstatSync(arqDe('s1')).isDirectory());
  assert.deepEqual(fs.readdirSync(arqDe('s1')), ['dentro']);
  assert.equal(mtime(arqDe('s1')), agora - 2 * H);
});

test('symlink no lugar de ativas/<hex>: inativo, e ninguem escreve nem data atraves dele', (t) => {
  fs.mkdirSync(pasta());
  const alvo = path.join(dir, 'alvo.txt');
  fs.writeFileSync(alvo, 'conteudo do usuario');
  datar(alvo, agora - 5 * D);
  if (!link(t, alvo, arqDe('s1'), 'file')) return;
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.equal(idadeSessao('s1', agora), null);
  assert.deepEqual(registrarSessao('s1', agora), { ok: false, motivo: 'invalido' });
  assert.equal(renovarSessao('s1', agora), false);
  assert.equal(fs.readFileSync(alvo, 'utf8'), 'conteudo do usuario');
  assert.equal(mtime(alvo), agora - 5 * D);
  assert.ok(fs.lstatSync(arqDe('s1')).isSymbolicLink());
  // Link quebrado: o 'wx' nao cria o alvo.
  const sumido = path.join(dir, 'sumido.txt');
  if (!link(t, sumido, arqDe('s2'), 'file')) return;
  assert.deepEqual(registrarSessao('s2', agora), { ok: false, motivo: 'invalido' });
  assert.equal(fs.existsSync(sumido), false);
});

// Um registro ingenuo com open('w') travaria num FIFO sem leitor; roda num
// processo filho com prazo para que uma regressao falhe em vez de travar a suite.
test('FIFO no lugar de ativas/<hex>: inativo e registrar recusa sem travar (POSIX)', { skip: process.platform === 'win32' && 'FIFO e POSIX' }, () => {
  fs.mkdirSync(pasta());
  execFileSync('mkfifo', [arqDe('s1')]);
  const url = new URL('../src/ativas.js', import.meta.url).href;
  const script = `import { registrarSessao, sessaoAtiva, renovarSessao } from ${JSON.stringify(url)};
process.stdout.write(JSON.stringify([registrarSessao('s1', ${agora}), sessaoAtiva('s1', ${agora}), renovarSessao('s1', ${agora})]));`;
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, HADOUKEN_HOME: dir }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(p.error, undefined, String(p.error));
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(JSON.parse(p.stdout), [{ ok: false, motivo: 'invalido' }, false, false]);
  assert.ok(fs.lstatSync(arqDe('s1')).isFIFO());
});

test('ativas como arquivo: registrar falha sem lancar e o arquivo fica intacto', () => {
  fs.writeFileSync(pasta(), 'nao sou pasta');
  const r = registrarSessao('s1', agora);
  assert.equal(r.ok, false);
  assert.equal(typeof r.motivo, 'string');
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.equal(renovarSessao('s1', agora), false);
  assert.equal(fs.readFileSync(pasta(), 'utf8'), 'nao sou pasta');
});

test('ativas como link para outra pasta: registrar recusa e nada nasce no alvo', (t) => {
  const alvo = path.join(dir, 'outra pasta');
  fs.mkdirSync(alvo);
  if (!link(t, alvo, pasta(), process.platform === 'win32' ? 'junction' : 'dir')) return;
  assert.deepEqual(registrarSessao('s1', agora), { ok: false, motivo: 'invalido' });
  assert.deepEqual(fs.readdirSync(alvo), []);
});

test('poda no registro: mais de 30 dias sai; 29 dias e exatamente 30 ficam', () => {
  registrarSessao('velha', agora - 31 * D);
  registrarSessao('recente', agora - 29 * D);
  registrarSessao('limite', agora - 30 * D);
  assert.deepEqual(registrarSessao('nova', agora), { ok: true });
  assert.deepEqual(fs.readdirSync(pasta()).sort(), ['limite', 'nova', 'recente'].map(hex).sort());
});

test('poda so apaga arquivo regular com nome que o registro geraria', () => {
  fs.mkdirSync(pasta());
  const velho = agora - 40 * D;
  const estranhos = ['notas.txt', 'ABCD', '7A31', 'abc', hex('../x'), hex('a b'), hex('x'.repeat(65))];
  for (const n of estranhos) {
    fs.writeFileSync(path.join(pasta(), n), '');
    datar(path.join(pasta(), n), velho);
  }
  fs.mkdirSync(path.join(pasta(), hex('pasta')));
  datar(path.join(pasta(), hex('pasta')), velho);
  registrarSessao('nova', agora);
  const ficou = fs.readdirSync(pasta()).sort();
  assert.deepEqual(ficou, [...new Set([...estranhos, hex('pasta'), hex('nova')])].sort());
});

test('poda apaga no maximo 50 por chamada', () => {
  fs.mkdirSync(pasta());
  for (let i = 0; i < 60; i++) {
    const p = path.join(pasta(), hex(`v${i}`));
    fs.writeFileSync(p, '');
    datar(p, agora - 40 * D);
  }
  registrarSessao('nova', agora);
  assert.equal(fs.readdirSync(pasta()).length, 11);
  registrarSessao('outra', agora);
  assert.deepEqual(fs.readdirSync(pasta()).sort(), [hex('nova'), hex('outra')].sort());
});

test('renovarSessao: so apos 1 h, nunca revive vencida, nunca cria', () => {
  registrarSessao('s1', agora - 2 * H);
  assert.equal(renovarSessao('s1', agora), true);
  assert.equal(mtime(arqDe('s1')), agora);
  // Menos de 1 h: nao escreve (a barra redesenha a cada 300 ms).
  assert.equal(renovarSessao('s1', agora + 10 * 60_000), false);
  assert.equal(mtime(arqDe('s1')), agora);
  // Exatamente 1 h: renova.
  assert.equal(renovarSessao('s1', agora + H), true);
  assert.equal(mtime(arqDe('s1')), agora + H);
  // Vencida: nao revive.
  registrarSessao('s2', agora - ATIVA_MAX_MS - 1);
  assert.equal(renovarSessao('s2', agora), false);
  assert.equal(mtime(arqDe('s2')), agora - ATIVA_MAX_MS - 1);
  assert.equal(sessaoAtiva('s2', agora), false);
  // No limite de 30 dias ainda renova.
  registrarSessao('s3', agora - ATIVA_MAX_MS);
  assert.equal(renovarSessao('s3', agora), true);
  // Nao registrada: nada criado.
  assert.equal(renovarSessao('s4', agora), false);
  assert.equal(fs.existsSync(arqDe('s4')), false);
  // Data no futuro (relogio voltou): nao mexe.
  registrarSessao('s5', agora + 3 * D);
  assert.equal(renovarSessao('s5', agora), false);
  assert.equal(mtime(arqDe('s5')), agora + 3 * D);
});

test('um ativas.json legado e ignorado', () => {
  fs.writeFileSync(path.join(dir, 'ativas.json'), JSON.stringify({ versao: 1, sessoes: { s1: { at: new Date(agora).toISOString() } } }));
  assert.equal(sessaoAtiva('s1', agora), false);
  assert.deepEqual(registrarSessao('s2', agora), { ok: true });
  assert.equal(sessaoAtiva('s1', agora), false);
});

const IDS_RUINS = [
  '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__',
  '../x', '..', '.', 'a/b', 'a\\b', 'C:x', '/etc/passwd', '..\\..\\x', ' s1', 's1 ', 's1\n', 's1\x00',
  '', 'x'.repeat(65), 42, null, undefined, {}, ['s1'], true, Symbol('s1'),
];

test('ids invalidos: nada registrado, nada ativo, nada renovado, nada criado', () => {
  for (const id of IDS_RUINS) {
    assert.deepEqual(registrarSessao(id, agora), { ok: false, motivo: 'id_invalido' }, String(id));
    assert.equal(sessaoAtiva(id, agora), false, String(id));
    assert.equal(idadeSessao(id, agora), null, String(id));
    assert.equal(renovarSessao(id, agora), false, String(id));
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('Object.prototype poluido nao ativa nada', () => {
  Object.prototype.s9 = true;
  try {
    assert.equal(sessaoAtiva('s9', agora), false);
    assert.deepEqual(registrarSessao('s1', agora), { ok: true });
    assert.equal(sessaoAtiva('s1', agora), true);
  } finally {
    delete Object.prototype.s9;
  }
});

test('agoraMs invalido: nao registra, nao ativa, nao renova, nao mexe no arquivo', () => {
  registrarSessao('s1', agora - 2 * H);
  for (const t of [NaN, Infinity, -Infinity, '1', null, undefined, 1e20, {}]) {
    assert.deepEqual(registrarSessao('s2', t), { ok: false, motivo: 'agora' }, String(t));
    assert.equal(sessaoAtiva('s1', t), false, String(t));
    assert.equal(idadeSessao('s1', t), null, String(t));
    assert.equal(renovarSessao('s1', t), false, String(t));
  }
  assert.deepEqual(fs.readdirSync(pasta()), [hex('s1')]);
  assert.equal(mtime(arqDe('s1')), agora - 2 * H);
});

test('sem home: registrar devolve sem_diretorio; gate e renovacao sao false', () => {
  delete process.env.HADOUKEN_HOME;
  const original = os.homedir;
  const falsos = [() => { throw new Error('sem home'); }, () => '', () => 'relativo/home', () => undefined];
  try {
    for (const falso of falsos) {
      os.homedir = falso;
      assert.deepEqual(registrarSessao('s1', agora), { ok: false, motivo: 'sem_diretorio' });
      assert.equal(sessaoAtiva('s1', agora), false);
      assert.equal(idadeSessao('s1', agora), null);
      assert.equal(renovarSessao('s1', agora), false);
    }
  } finally {
    os.homedir = original;
  }
});

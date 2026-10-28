import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { conteudoTrava, lerTravaPid, scriptAtual, tokenDaTrava } from '../src/saude/trava-pid.js';
import { pegarTrava } from '../src/aprendizado/registro.js';
import { caminhos } from '../src/aprendizado/arquivos.js';

// Spec v0.5.5 §9.1 item 6: as travas do coletor e do aprender guardam pid,
// script, início e prazo, para a confirmação dupla de encerraveis.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-trava-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novoDir = () => fs.mkdtempSync(path.join(tmp, 'd'));

test('scriptAtual: o nome do script sem extensão, ou null', () => {
  assert.equal(scriptAtual('/x/claude-hadouken/src/hooks/session-start.js'), 'session-start');
  assert.equal(scriptAtual('C:\\x\\src\\saude\\coletor-main.js'), 'coletor-main');
  assert.equal(scriptAtual(undefined), null);
  assert.equal(scriptAtual('/x/nome com espaço.js'), null);
});

test('conteudoTrava e lerTravaPid ida e volta', () => {
  const d = novoDir();
  const arq = path.join(d, 'x.lock');
  fs.writeFileSync(arq, conteudoTrava({ token: 'ab12', prazoMs: 8000, agoraMs: 1000, pid: 4321, script: 'coletor-main' }));
  assert.deepEqual(lerTravaPid(arq), { pid: 4321, script: 'coletor-main', inicioMs: 1000, prazoMs: 8000 });
  assert.equal(tokenDaTrava(fs.readFileSync(arq, 'utf8')), 'ab12');
});

test('lerTravaPid: trava antiga (só token), lixo, link e ausente dão null', () => {
  const d = novoDir();
  const arq = path.join(d, 'x.lock');
  assert.equal(lerTravaPid(arq), null);
  fs.writeFileSync(arq, '0123456789abcdef0123456789abcdef');
  assert.equal(lerTravaPid(arq), null);
  assert.equal(tokenDaTrava('0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef');
  fs.writeFileSync(arq, JSON.stringify({ token: 'a', pid: -1, script: 'x', inicioMs: 1, prazoMs: 1 }));
  assert.equal(lerTravaPid(arq), null);
  fs.writeFileSync(arq, JSON.stringify({ token: 'a', pid: 10, script: '../../x', inicioMs: 1, prazoMs: 1 }));
  assert.equal(lerTravaPid(arq), null);
  fs.writeFileSync(arq, 'x'.repeat(5000));
  assert.equal(lerTravaPid(arq), null);
});

test('a trava do aprendizado guarda o pid e ainda solta pelo token', () => {
  const d = novoDir();
  const t = pegarTrava(d);
  assert.equal(t.ok, true);
  // No node --test o script é o arquivo de teste (nome com ponto: script null);
  // no hook, é session-start ou session-end.
  const lida = JSON.parse(fs.readFileSync(caminhos(d).trava, 'utf8'));
  assert.equal(lida.pid, process.pid);
  assert.equal(lida.script, scriptAtual());
  assert.equal(lida.prazoMs, 120_000);
  assert.ok(Math.abs(lida.inicioMs - Date.now()) < 5000);
  t.soltar();
  assert.equal(fs.existsSync(caminhos(d).trava), false);
});

test('soltar aceita a trava antiga, gravada só com o token', () => {
  const d = novoDir();
  const t = pegarTrava(d);
  const arq = caminhos(d).trava;
  const token = tokenDaTrava(fs.readFileSync(arq, 'utf8'));
  fs.writeFileSync(arq, token);
  t.soltar();
  assert.equal(fs.existsSync(arq), false);
});

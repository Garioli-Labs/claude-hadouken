import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {
  baixarColetor, plataformaAtual, urlDoColetor, FIXADO, VERSAO_COLETOR, HOSTS,
  TAMANHO_MAX, PRAZO_MS, REDIRECIONAMENTOS_MAX,
} from '../src/aprendizado/baixar.js';

// Download do Collector (spec aprendizado §3.2 passo 2, §6 e §8 "Download"):
// um servidor HTTP local em 127.0.0.1, nunca a rede de verdade.

const CONTEUDO = crypto.randomBytes(300_000);
const SHA = crypto.createHash('sha256').update(CONTEUDO).digest('hex');
const dirs = [];
let servidor;
let base;

// Trava: este arquivo nunca sai da máquina. Um pedido para fora de
// 127.0.0.1 não é feito; fica anotado em `fora` e falha como erro de rede.
const fora = [];
for (const m of [http, https]) {
  const original = m.get;
  m.get = function travado(alvo, ...resto) {
    if (new URL(String(alvo)).hostname === '127.0.0.1') return original.call(this, alvo, ...resto);
    fora.push(String(alvo));
    const falso = new EventEmitter();
    falso.destroy = () => {};
    process.nextTick(() => falso.emit('error', new Error('fora da máquina')));
    return falso;
  };
}

before(async () => {
  servidor = http.createServer((req, res) => {
    const rota = new URL(req.url, 'http://x').pathname;
    if (rota === '/ok') {
      res.writeHead(200, { 'content-length': CONTEUDO.length });
      res.end(CONTEUDO);
    } else if (rota === '/pedacos') {
      res.writeHead(200);
      res.write(CONTEUDO);
      res.end(CONTEUDO);
    } else if (rota === '/redir') {
      res.writeHead(302, { location: '/ok' });
      res.end();
    } else if (rota === '/laco') {
      res.writeHead(302, { location: '/laco' });
      res.end();
    } else if (rota === '/fora') {
      res.writeHead(302, { location: 'http://localhost:1/ok' });
      res.end();
    } else if (rota === '/porta') {
      res.writeHead(302, { location: `https://127.0.0.1:${servidor.address().port}/ok` });
      res.end();
    } else if (rota === '/parado') {
      res.writeHead(200);
      res.write(CONTEUDO.subarray(0, 1000));
    } else if (rota === '/corta') {
      req.socket.destroy();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.closeAllConnections();
  servidor.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function novoDestino() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk baixar ç '));
  dirs.push(d);
  return path.join(d, 'otel', 'bin', 'coletor.tar.gz');
}
const local = (rota, extra = {}) => ({ url: `${base}${rota}`, sha256: SHA, hosts: ['127.0.0.1'], protocolos: ['http:'], ...extra });
const soltos = (destino) => (fs.existsSync(path.dirname(destino)) ? fs.readdirSync(path.dirname(destino)).filter((n) => n.endsWith('.parte')) : []);

test('bloco fixado da Task 1 colado: versão e as 5 plataformas com SHA-256', () => {
  assert.match(VERSAO_COLETOR, /^\d+\.\d+\.\d+$/);
  assert.notEqual(VERSAO_COLETOR, '0.0.0', 'cole o bloco de $S\\fixado.js (Task 1, Step 1)');
  const sufixo = { 'win32-x64': 'windows_amd64', 'linux-x64': 'linux_amd64', 'linux-arm64': 'linux_arm64', 'darwin-x64': 'darwin_amd64', 'darwin-arm64': 'darwin_arm64' };
  assert.deepEqual(Object.keys(FIXADO).sort(), Object.keys(sufixo).sort());
  for (const [k, f] of Object.entries(FIXADO)) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/, k);
    assert.equal(f.arquivo, `otelcol-contrib_${VERSAO_COLETOR}_${sufixo[k]}.tar.gz`);
  }
  assert.equal(
    urlDoColetor('win32-x64'),
    `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSAO_COLETOR}/otelcol-contrib_${VERSAO_COLETOR}_windows_amd64.tar.gz`,
  );
  assert.ok(HOSTS.includes('github.com'));
  assert.ok(HOSTS.every((h) => h === 'github.com' || h.endsWith('.githubusercontent.com')));
});

// Emenda A2 (spec aprendizado, 2026-10-01): 107,1 MiB no maior .tar.gz (× 2,
// arredondado para cima); o prazo é a decisão do Sr. Garioli, 450 s, que com
// os 120 s da extração cabe nos 600 s do hook (R5); o redirecionamento medido
// foi github.com → release-assets.githubusercontent.com.
test('Emenda A2: teto de 215 MiB, prazo de 450 s, 5 saltos e os 3 hosts do plano, tudo congelado', () => {
  assert.equal(VERSAO_COLETOR, '0.162.0');
  assert.equal(TAMANHO_MAX, 215 * 1024 * 1024);
  assert.equal(PRAZO_MS, 450_000);
  assert.ok(PRAZO_MS + 120_000 <= 600_000, 'download + extração dentro do timeout do hook');
  assert.equal(REDIRECIONAMENTOS_MAX, 5);
  assert.deepEqual([...HOSTS], ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
  assert.ok(Object.isFrozen(HOSTS));
  assert.ok(Object.isFrozen(FIXADO));
  for (const f of Object.values(FIXADO)) assert.ok(Object.isFrozen(f));
});

test('plataformaAtual: só as 5 do release', () => {
  assert.equal(plataformaAtual('win32', 'x64'), 'win32-x64');
  assert.equal(plataformaAtual('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(plataformaAtual('linux', 'ia32'), null);
  assert.equal(plataformaAtual('sunos', 'x64'), null);
});

test('hash certo: grava o destino (criando a pasta) e não deixa .parte; redirecionamento no mesmo host vale', async () => {
  for (const rota of ['/ok', '/redir']) {
    const destino = novoDestino();
    const r = await baixarColetor({ destino, ...local(rota) });
    assert.deepEqual(r, { ok: true, bytes: CONTEUDO.length });
    assert.ok(fs.readFileSync(destino).equals(CONTEUDO));
    assert.deepEqual(soltos(destino), []);
  }
});

test('hash errado: nada gravado e o .parte é apagado (§6)', async () => {
  const destino = novoDestino();
  assert.deepEqual(await baixarColetor({ destino, ...local('/ok', { sha256: '0'.repeat(64) }) }), { ok: false, motivo: 'hash' });
  assert.equal(fs.existsSync(destino), false);
  assert.deepEqual(soltos(destino), []);
});

test('acima do teto, pelo cabeçalho ou no meio do fluxo: grande', async () => {
  const d1 = novoDestino();
  assert.deepEqual(await baixarColetor({ destino: d1, ...local('/ok', { tamanhoMax: 1000 }) }), { ok: false, motivo: 'grande' });
  const d2 = novoDestino();
  assert.deepEqual(await baixarColetor({ destino: d2, ...local('/pedacos', { tamanhoMax: 400_000 }) }), { ok: false, motivo: 'grande' });
  assert.deepEqual(soltos(d2), []);
});

test('HTTP fora de 200, laço de redirecionamento, outro host, http sem permissão, conexão cortada', async () => {
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/nada') }), { ok: false, motivo: 'http' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/laco') }), { ok: false, motivo: 'http' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/fora') }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/ok', { protocolos: undefined }) }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/ok', { hosts: undefined }) }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/corta') }), { ok: false, motivo: 'rede' });
});

test('https só na porta padrão, também depois de redirecionar: github.com:8443 é recusado sem conexão', async () => {
  const destino = novoDestino();
  assert.deepEqual(await baixarColetor({ destino, url: 'https://github.com:8443/x.tar.gz', sha256: SHA }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino, ...local('/porta', { protocolos: ['http:', 'https:'] }) }), { ok: false, motivo: 'host' });
  assert.deepEqual(fora, []);
  assert.equal(fs.existsSync(destino), false);
  assert.deepEqual(soltos(destino), []);
});

test('prazo: servidor que não termina', async () => {
  const destino = novoDestino();
  assert.deepEqual(await baixarColetor({ destino, ...local('/parado', { prazoMs: 300 }) }), { ok: false, motivo: 'prazo' });
  assert.deepEqual(soltos(destino), []);
});

test('plataforma sem binário fixado', async () => {
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), chave: 'sunos-x64' }), { ok: false, motivo: 'plataforma' });
});

test('nenhum pedido deste arquivo saiu de 127.0.0.1', () => {
  assert.deepEqual(fora, []);
});

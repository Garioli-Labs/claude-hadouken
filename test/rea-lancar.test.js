import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comandoRea, nodeServe, VERSAO_REA } from '../rea/lancar.mjs';

const PASTA = '/plugins/hadouken-rea/1.0.0';

test('versão exata, nunca latest', () => {
  assert.equal(VERSAO_REA, '6.1.0');
  const texto = fs.readFileSync(new URL('../rea/lancar.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(texto, /@latest/);
});

test('Linux e macOS: npx direto', () => {
  for (const pl of ['linux', 'darwin']) {
    const r = comandoRea(pl, {}, PASTA);
    assert.equal(r.comando, 'npx');
    assert.deepEqual(r.args, ['-y', 'rea-agents@6.1.0', 'mcp']);
  }
});

test('Windows: cmd.exe por caminho absoluto, /d /c, mesmos argumentos', () => {
  const r = comandoRea('win32', { SystemRoot: 'C:\\Windows' }, PASTA);
  assert.equal(r.comando, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(r.args, ['/d', '/c', 'npx', '-y', 'rea-agents@6.1.0', 'mcp']);
});

test('Windows sem SystemRoot: cai em C:\\Windows, nunca no cmd do PATH', () => {
  assert.equal(comandoRea('win32', {}, PASTA).comando, 'C:\\Windows\\System32\\cmd.exe');
});

test('nada do ambiente entra nos argumentos', () => {
  const r = comandoRea('linux', { REA_VERSAO: '9.9.9', npm_config_tag: 'latest' }, PASTA);
  assert.deepEqual(r.args, ['-y', 'rea-agents@6.1.0', 'mcp']);
});

// I1 da revisão final: o npx usa primeiro o rea-agents do node_modules (e o
// .npmrc) do cwd, que seria o projeto aberto. O cwd é a pasta do plugin, em
// toda plataforma; no Windows, o cmd.exe também não procura npx.cmd no cwd.
test('cwd na pasta do plugin, nunca o do projeto; Windows sem npx do cwd', () => {
  for (const pl of ['linux', 'darwin', 'win32']) {
    const r = comandoRea(pl, { PATH: '/bin' }, PASTA);
    assert.equal(r.cwd, PASTA, pl);
    assert.equal(r.env.PATH, '/bin', pl);
  }
  assert.equal(comandoRea('win32', {}, PASTA).env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(comandoRea('linux', {}, PASTA).env.NoDefaultCurrentDirectoryInExePath, undefined);
  const texto = fs.readFileSync(new URL('../rea/lancar.mjs', import.meta.url), 'utf8');
  assert.match(texto, /spawn\(comando, args, \{[^}]*cwd[^}]*env/);
});

// v0.5.1: o rea-agents 6.1.0 pede Node ^22.19.0 || ^24.11.0 || >=26.0.0
// (engines no npm). Fora disso, o lançador diz o motivo em vez de deixar o npx
// falhar sem explicação.
test('nodeServe: as faixas do engines do rea-agents 6.1.0', () => {
  for (const v of ['22.19.0', '22.20.1', '24.11.0', '24.18.0', '26.0.0', '27.1.0']) assert.equal(nodeServe(v), true, v);
  for (const v of ['20.18.0', '22.18.9', '23.9.0', '24.10.0', '25.2.0', 'x']) assert.equal(nodeServe(v), false, v);
});

// v0.5.1: o plugin pode estar sob uma junção ou link (pasta de perfil
// movida, OneDrive) e num caminho com espaço. O lançador roda de verdade, com
// um npx falso no PATH que imprime o cwd que recebeu. Num Node fora da faixa
// (o CI roda também o 20), o mesmo lançador sai com 1, diz por quê e não
// chega ao npx: cada lado da matriz confere um caminho.
const NODE_SERVE = nodeServe(process.versions.node);
test(`lançador por caminho com espaço e por junção: ${NODE_SERVE ? 'cwd na pasta do plugin' : 'Node fora da faixa sai com 1'}`, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rea com espaco '));  // sem acento: o cmd.exe ecoa na página OEM
  try {
    const real = path.join(tmp, 'plugin real');
    const link = path.join(tmp, 'plugin link');
    const bin = path.join(tmp, 'bin falso');
    fs.mkdirSync(real); fs.mkdirSync(bin);
    fs.copyFileSync(new URL('../rea/lancar.mjs', import.meta.url), path.join(real, 'lancar.mjs'));
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'npx.cmd'), '@echo cwd=%CD%\r\n');
    else { fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\necho "cwd=$(pwd -P)"\n'); fs.chmodSync(path.join(bin, 'npx'), 0o755); }
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    for (const pasta of [real, link]) {
      const r = spawnSync(process.execPath, [path.join(pasta, 'lancar.mjs')], { env, encoding: 'utf8', timeout: 15_000 });
      if (!NODE_SERVE) {
        assert.equal(r.status, 1, pasta);
        assert.match(r.stderr, new RegExp(`pede Node .*este é o ${process.versions.node.replaceAll('.', '\\.')}`), pasta);
        assert.doesNotMatch(r.stdout, /cwd=/, `${pasta}: o npx não podia rodar`);
        continue;
      }
      assert.equal(r.status, 0, `${pasta}: ${r.stderr}`);
      const cwd = /cwd=(.*)/.exec(r.stdout)?.[1]?.trim();
      assert.ok(cwd, `${pasta}: o npx falso não rodou (stdout: ${JSON.stringify(r.stdout)})`);
      assert.equal(fs.realpathSync(cwd), fs.realpathSync(real), pasta);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

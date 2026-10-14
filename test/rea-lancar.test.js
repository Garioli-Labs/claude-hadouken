import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { comandoRea, VERSAO_REA } from '../rea/lancar.mjs';

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

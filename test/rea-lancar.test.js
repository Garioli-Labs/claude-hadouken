import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { comandoRea, VERSAO_REA } from '../rea/lancar.mjs';

test('versão exata, nunca latest', () => {
  assert.equal(VERSAO_REA, '6.1.0');
  const texto = fs.readFileSync(new URL('../rea/lancar.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(texto, /@latest/);
});

test('Linux e macOS: npx direto', () => {
  for (const pl of ['linux', 'darwin']) {
    assert.deepEqual(comandoRea(pl, {}), {
      comando: 'npx', args: ['-y', 'rea-agents@6.1.0', 'mcp'] });
  }
});

test('Windows: cmd.exe por caminho absoluto, /d /c, mesmos argumentos', () => {
  const r = comandoRea('win32', { SystemRoot: 'C:\\Windows' });
  assert.equal(r.comando, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(r.args, ['/d', '/c', 'npx', '-y', 'rea-agents@6.1.0', 'mcp']);
});

test('Windows sem SystemRoot: cai em C:\\Windows, nunca no cmd do PATH', () => {
  assert.equal(comandoRea('win32', {}).comando, 'C:\\Windows\\System32\\cmd.exe');
});

test('nada do ambiente entra nos argumentos', () => {
  const r = comandoRea('linux', { REA_VERSAO: '9.9.9', npm_config_tag: 'latest' });
  assert.deepEqual(r.args, ['-y', 'rea-agents@6.1.0', 'mcp']);
});

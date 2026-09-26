import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutoCompleto } from '../src/executavel.js';
import { criarExecutorGh } from '../src/github.js';

const WIN = process.platform === 'win32';

test('absolutoCompleto: no Windows exige unidade ou UNC', { skip: !WIN && 'regra do win32' }, () => {
  assert.equal(absolutoCompleto('C:\\bin\\gh.exe'), true);
  assert.equal(absolutoCompleto('c:/bin/gh.exe'), true);
  assert.equal(absolutoCompleto('\\\\srv\\share\\gh.exe'), true);
  assert.equal(absolutoCompleto('\\bin\\gh.exe'), false);
  assert.equal(absolutoCompleto('/bin/gh.exe'), false);
  assert.equal(absolutoCompleto('gh.exe'), false);
  assert.equal(absolutoCompleto(null), false);
});

// Revisão final de segurança, M-B: o UNC precisa de servidor e
// compartilhamento; só com servidor, o path.win32 o resolve contra a unidade
// do cwd. Caminho de dispositivo (\\?\, \\.\) nunca vale, nem com unidade.
test('absolutoCompleto: no Windows, UNC com servidor e compartilhamento; caminho de dispositivo nunca', { skip: !WIN && 'regra do win32' }, () => {
  const invalidos = ['\\\\x', '//x', '\\\\x\\', '\\\\x\\\\', '\\\\x/', '\\\\?\\', '\\\\.\\', '\\\\?\\x', '\\\\.\\pipe\\gh',
    '\\\\?\\C:', '\\\\?\\UNC\\srv', '\\\\?\\C:\\..\\gh.exe', '\\\\?\\UNC\\srv\\..\\x',
    '\\\\?\\C:\\bin\\gh.exe', '\\\\?\\UNC\\srv\\share\\gh.exe', '\\\\.\\C:\\bin', '//?/C:/bin', '//./C:/bin', '\\\\?/C:/bin'];
  for (const v of invalidos) assert.equal(absolutoCompleto(v), false, v);
  const validos = ['\\\\server\\share\\dir', '//server/share/dir', '\\\\server\\share', '\\\\server\\\\share\\gh.exe', '/\\server/share'];
  for (const v of validos) assert.equal(absolutoCompleto(v), true, v);
});

test('absolutoCompleto: no POSIX exige barra inicial', { skip: WIN && 'regra do POSIX' }, () => {
  assert.equal(absolutoCompleto('/usr/bin/gh'), true);
  assert.equal(absolutoCompleto('usr/bin/gh'), false);
  assert.equal(absolutoCompleto(''), false);
});

test('executor injetado com caminho enraizado sem unidade nunca cria processo', { skip: !WIN && 'regra do win32' }, async () => {
  const gh = criarExecutorGh({ executavel: '\\nao-existe-hdk\\gh.exe' });
  const r = await gh(['api', 'x']);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'gh ausente');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arquivoStorageVscode, perfisDoVscode } from '../src/painel/perfis.js';

// v0.5.9, issue #7: a extensão vai para todos os perfis do VS Code.

test('arquivoStorageVscode: Windows, macOS e Linux', () => {
  assert.equal(arquivoStorageVscode({ plataforma: 'win32', appData: 'C:\\U\\a\\AppData\\Roaming' }), 'C:\\U\\a\\AppData\\Roaming\\Code\\User\\globalStorage\\storage.json');
  assert.equal(arquivoStorageVscode({ plataforma: 'darwin', casa: '/Users/f' }), '/Users/f/Library/Application Support/Code/User/globalStorage/storage.json');
  assert.equal(arquivoStorageVscode({ plataforma: 'linux', casa: '/home/f' }), '/home/f/.config/Code/User/globalStorage/storage.json');
  assert.equal(arquivoStorageVscode({ plataforma: 'win32', appData: '' }), null);
  assert.equal(arquivoStorageVscode({ plataforma: 'linux', casa: 'relativo' }), null);
});

test('perfisDoVscode: só nomes seguros, sem repetidos; texto ruim dá []', () => {
  const t = JSON.stringify({ userDataProfiles: [{ name: 'Educbank' }, { name: 'a"&b' }, { name: 'Educbank' }, { name: 'Trabalho 2' }, { name: 5 }, null] });
  assert.deepEqual(perfisDoVscode(t), ['Educbank', 'Trabalho 2']);
  assert.deepEqual(perfisDoVscode('{x'), []);
  assert.deepEqual(perfisDoVscode('{}'), []);
  assert.deepEqual(perfisDoVscode('null'), []);
  const muitos = JSON.stringify({ userDataProfiles: Array.from({ length: 30 }, (_, i) => ({ name: `p${i}` })) });
  assert.equal(perfisDoVscode(muitos).length, 20);
});

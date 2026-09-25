import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import * as base from '../src/base.js';
import * as estado from '../src/estado.js';

// base.js guarda o que o caminho curto da barra (antes do gate) precisa:
// dirDados, idValido e instante. estado.js os reexporta, sem cópia.

test('estado.js reexporta as funções de base.js, sem cópia', () => {
  for (const nome of ['dirDados', 'idValido', 'instante']) {
    assert.equal(typeof base[nome], 'function', nome);
    assert.equal(estado[nome], base[nome], nome);
  }
});

// Os testes de "sem home" trocam os.homedir no objeto padrão de node:os. Se
// base.js desestruturasse homedir no import, a troca não valeria e dirDados
// devolveria o ~/.claude/hadouken de verdade do desenvolvedor.
test('dirDados lê os.homedir pelo objeto padrão de node:os (a troca do teste vale)', () => {
  const homeAntes = process.env.HADOUKEN_HOME;
  const original = os.homedir;
  const falso = path.resolve(os.tmpdir(), 'hdk-home-falso-nunca-criado');
  delete process.env.HADOUKEN_HOME;
  try {
    os.homedir = () => falso;
    assert.equal(base.dirDados(), path.join(falso, '.claude', 'hadouken'));
    os.homedir = () => { throw new Error('sem home'); };
    assert.equal(base.dirDados(), null);
  } finally {
    os.homedir = original;
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
});

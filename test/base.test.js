import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Política de retentativa do rename, a mesma para estado.json, shims e
// settings.json: 3 tentativas, 20 ms entre elas, só EPERM, EACCES e EBUSY.
test('renomearDeNovo: só EPERM, EACCES e EBUSY, e só abaixo de 3 tentativas', () => {
  assert.equal(base.RENOMEAR_TENTATIVAS, 3);
  assert.equal(base.RENOMEAR_ESPERA_MS, 20);
  const erro = (code) => Object.assign(new Error(String(code)), { code });
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    assert.equal(base.renomearDeNovo(erro(code), 1), true, `${code} 1`);
    assert.equal(base.renomearDeNovo(erro(code), 2), true, `${code} 2`);
    assert.equal(base.renomearDeNovo(erro(code), 3), false, `${code} 3`);
  }
  for (const code of ['EXDEV', 'ENOENT', 'EEXIST', 'EISDIR', 'eperm', '', undefined]) {
    assert.equal(base.renomearDeNovo(erro(code), 1), false, String(code));
  }
  for (const e of [{}, null, undefined, 'EPERM', 1]) {
    assert.equal(base.renomearDeNovo(e, 1), false, String(e));
  }
});

test('apagar, fechar e esperar nunca lançam; erroComCodigo leva o código', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-base-'));
  try {
    const arq = path.join(dir, 'a.tmp');
    fs.writeFileSync(arq, 'x');
    base.apagar(arq);
    assert.equal(fs.existsSync(arq), false);
    base.apagar(arq);
    base.apagar(path.join(dir, 'nunca', 'existiu'));
    const fd = fs.openSync(path.join(dir, 'b.tmp'), 'w');
    base.fechar(fd);
    assert.throws(() => fs.fstatSync(fd));
    base.fechar(fd);
    base.fechar(-1);
    const antes = Date.now();
    base.esperar(0);
    base.esperar(base.RENOMEAR_ESPERA_MS);
    assert.ok(Date.now() - antes < 1000);
    const e = base.erroComCodigo('tmp_invalido');
    assert.ok(e instanceof Error);
    assert.equal(e.code, 'tmp_invalido');
    assert.equal(e.message, 'tmp_invalido');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Uma política só: nenhum outro arquivo de src/ volta a ter a sua cópia da
// lista de erros passageiros, da espera síncrona ou dos ajudantes que moram
// em base.js (o fechar assíncrono de transcripts.js é outra coisa e não conta).
test('a política de rename e os ajudantes da escrita atômica só existem em base.js', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const arquivos = [];
  const listar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) listar(path.join(d, e.name));
      else if (e.name.endsWith('.js')) arquivos.push(path.join(d, e.name));
    }
  };
  listar(src);
  const marcas = ["'EPERM', 'EACCES', 'EBUSY'", 'Atomics.wait(', 'const apagar =', 'const esperar =', 'const erroComCodigo =', 'RENOMEAR_TENTATIVAS = '];
  const achados = [];
  for (const arq of arquivos) {
    const texto = fs.readFileSync(arq, 'utf8');
    for (const m of marcas) if (texto.includes(m)) achados.push(`${path.relative(src, arq).split(path.sep).join('/')}: ${m}`);
  }
  assert.deepEqual(achados.filter((a) => !a.startsWith('base.js:')), []);
  assert.equal(achados.filter((a) => a.startsWith('base.js:')).length, marcas.length);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montarRelatorio } from '../src/relatorio.js';
import { jsonSeguro } from '../src/util.js';

// Critério 4 da spec v0.2.0 (§1 e §9): o --json do /consumo é idêntico byte a
// byte ao da v0.1.0 para os mesmos dados. A entrada é sintética e a saída foi
// gerada com o src/ da tag v0.1.0, antes de qualquer mudança em src/; as duas
// ficam versionadas e nenhuma se edita à mão. O --json é jsonSeguro do
// montarRelatorio (comandos.js); o \n do fim é da CLI.
const ler = (nome) => fs.readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');

test('--json idêntico ao da v0.1.0, byte a byte, para a entrada de referência', () => {
  const entrada = JSON.parse(ler('consumo-v0.1.0-entrada.json'));
  assert.equal(jsonSeguro(montarRelatorio(entrada)), ler('consumo-v0.1.0.json'));
});

test('a referência é o --json puro: nenhuma barrinha, formato na versão 1', () => {
  const saida = ler('consumo-v0.1.0.json');
  assert.doesNotMatch(saida, /[▰▱┃]/u, 'barrinha nunca entra no --json');
  assert.equal(JSON.parse(saida).versao, 1);
});

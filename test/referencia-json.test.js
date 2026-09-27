import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montarRelatorio } from '../src/relatorio.js';
import { jsonSeguro } from '../src/util.js';

// Critério 4 da spec v0.2.0 (§1 e §9): o --json do /consumo é idêntico byte a
// byte ao da v0.1.0 para os mesmos dados. A entrada é sintética e a saída foi
// gerada com o src/ da tag v0.1.0, antes de qualquer mudança em src/; as duas
// ficam versionadas e nenhuma se edita à mão. O --json é jsonSeguro do
// montarRelatorio (comandos.js); o \n do fim é da CLI. A §12.6 acrescenta
// a chave `sessoesAbertas`, sempre a última: o teste compara só as chaves da
// v0.1.0, que seguem idênticas byte a byte.
const ler = (nome) => fs.readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');

test('--json: as chaves da v0.1.0 idênticas às da v0.1.0, byte a byte, e sessoesAbertas por último', () => {
  const entrada = JSON.parse(ler('consumo-v0.1.0-entrada.json'));
  const r = montarRelatorio(entrada);
  assert.equal(Object.keys(r).at(-1), 'sessoesAbertas');
  assert.equal(r.sessoesAbertas, null, 'a entrada da v0.1.0 não traz o agregado da última hora');
  delete r.sessoesAbertas;
  assert.equal(jsonSeguro(r), ler('consumo-v0.1.0.json'));
});

test('--json com o agregado da última hora: sessoesAbertas é lista e as chaves da v0.1.0 não mudam um byte', () => {
  const entrada = JSON.parse(ler('consumo-v0.1.0-entrada.json'));
  entrada.claude.abertas = entrada.claude.hoje;
  const r = montarRelatorio(entrada);
  assert.ok(Array.isArray(r.sessoesAbertas) && r.sessoesAbertas.length > 0);
  for (const s of r.sessoesAbertas) assert.deepEqual(Object.keys(s), ['id', 'projeto', 'modelos', 'tokens', 'parte']);
  delete r.sessoesAbertas;
  assert.equal(jsonSeguro(r), ler('consumo-v0.1.0.json'));
});

test('a referência é o --json puro: nenhuma barrinha, formato na versão 1', () => {
  const saida = ler('consumo-v0.1.0.json');
  assert.doesNotMatch(saida, /[▰▱┃]/u, 'barrinha nunca entra no --json');
  assert.equal(JSON.parse(saida).versao, 1);
});

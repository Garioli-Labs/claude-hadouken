// Pré-carga (node --import) do teste R13 de aprendizado-passo.test.js: a
// gravação do aprendizado.json pelo passo espera ATRASO_MS e anota o instante
// (Date.now) no arquivo de HADOUKEN_TESTE_ORDEM. O teste compara esse
// instante com a chegada do primeiro byte do stdout do hook: a saída chega
// antes de o passo gravar, mesmo com o passo lento.
import fs from 'node:fs';
import path from 'node:path';

const ATRASO_MS = 400;
const registro = process.env.HADOUKEN_TESTE_ORDEM;
const original = fs.renameSync;
fs.renameSync = function renameAtrasado(de, para) {
  if (typeof registro === 'string' && path.basename(String(para)) === 'aprendizado.json') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ATRASO_MS);
    fs.appendFileSync(registro, `${Date.now()}\n`);
  }
  return original.call(this, de, para);
};

// Foco de revisão 3: dois processos chamam subirColetor ao mesmo tempo. O
// "gerar" falso anota cada subida em gerados.txt; o "executar" falso diz que
// todo PID do arquivo de PID é o Collector vivo.
import fs from 'node:fs';
import path from 'node:path';
import { subirColetor } from '../../src/aprendizado/coletor.js';

const [dir] = process.argv.slice(2);
const plataforma = process.platform;
const r = subirColetor({
  dir,
  agoraMs: Date.now(),
  plataforma,
  memLivre: () => 8 * 1024 ** 3,
  env: {},
  gerar: () => {
    fs.appendFileSync(path.join(dir, 'gerados.txt'), `${process.pid}\n`);
    return { pid: process.pid, unref() {}, on() {} };
  },
  executar: (_arquivo, args) => {
    const pid = plataforma === 'win32' ? String(args[1]).replace('PID eq ', '') : String(args[1]);
    return plataforma === 'win32' ? `"otelcol-contrib.exe","${pid}","Console","1","1.000 K"\r\n` : 'otelcol-contrib\n';
  },
});
process.stdout.write(JSON.stringify(r));

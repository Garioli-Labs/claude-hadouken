import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { criarPerguntar } from '../src/instalar-tudo.js';

// Perguntas do instalar-tudo (revisão final da v0.5.2, Critical 1): duas
// perguntas seguidas são lidas, o processo sai depois da última, e o prompt
// vai para o stderr (no install.ps1 o stdout do node passa pelo Out-Host, que
// só mostra linha inteira). No POSIX, uma pty de verdade (Python); no Windows,
// uma entrada falsa com isTTY.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pastas = [];
after(() => { for (const d of pastas) fs.rmSync(d, { recursive: true, force: true }); });

function entradaFalsa() {
  const e = new PassThrough();
  e.isTTY = true;
  return e;
}

function saidaFalsa() {
  const s = new PassThrough();
  let texto = '';
  s.on('data', (d) => { texto += d; });
  return { s, texto: () => texto };
}

test('win32: duas perguntas na mesma entrada, sem destruir o stdin, prompt na saída de erro', async () => {
  const stdin = entradaFalsa();
  const saida = saidaFalsa();
  const perguntar = criarPerguntar({ plataforma: 'win32', stdin, saida: saida.s });
  const p1 = perguntar('Primeira? [s/N] ', false);
  stdin.write('n\n');
  const r1 = await p1;
  const p2 = perguntar('Segunda? [s/N] ', false);
  stdin.write('s\n');
  const r2 = await p2;
  assert.deepEqual([r1, r2], [false, true]);
  assert.equal(stdin.destroyed, false, 'o stdin não pode ser destruído');
  assert.match(saida.texto(), /Primeira\? \[s\/N\] .*Segunda\? \[s\/N\] /s);
});

test('win32: sem tty, "não" sem ler nada', async () => {
  const stdin = new PassThrough();
  const perguntar = criarPerguntar({ plataforma: 'win32', stdin, saida: saidaFalsa().s });
  assert.equal(await perguntar('Pergunta? [S/n] ', true), false);
});

const temPython = process.platform !== 'win32' && spawnSync('python3', ['--version']).status === 0;
test('POSIX: numa pty, duas perguntas respondidas e o processo sai', { skip: temPython ? false : 'precisa de POSIX com python3' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk pty '));
  pastas.push(d);
  const filho = path.join(d, 'filho.mjs');
  fs.writeFileSync(filho, [
    `import { criarPerguntar } from ${JSON.stringify(path.join(repo, 'src', 'instalar-tudo.js'))};`,
    'const perguntar = criarPerguntar();',
    "const a = await perguntar('Primeira? [s/N] ', false);",
    "const b = await perguntar('Segunda? [s/N] ', false);",
    "process.stdout.write(`fim ${a} ${b}\\n`);",
  ].join('\n'));
  const arnes = path.join(d, 'arnes.py');
  fs.writeFileSync(arnes, `
import os, pty, sys, time, select
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2]])
buf = b''
def ler(t):
    global buf
    fim = time.time() + t
    while time.time() < fim:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                dados = os.read(fd, 4096)
            except OSError:
                return
            if not dados:
                return
            buf += dados
for resp in ['n', 's']:
    ler(2)
    os.write(fd, (resp + '\\n').encode())
fim = time.time() + 10
w = 0
while time.time() < fim and not w:
    ler(0.2)
    w, _ = os.waitpid(pid, os.WNOHANG)
print(buf.decode(errors='replace').replace('\\r', ''))
print('SAIU' if w else 'PRESO')
if not w:
    os.kill(pid, 9)
`);
  const r = spawnSync('python3', [arnes, process.execPath, filho], { encoding: 'utf8', timeout: 60_000 });
  assert.match(r.stdout, /fim false true/, r.stdout + r.stderr);
  assert.match(r.stdout, /SAIU/, r.stdout);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizarEffort, horaLocal, diaHora, formatarTokens } from '../src/util.js';

test('normalizarEffort aceita string, objeto e ausência', () => {
  assert.equal(normalizarEffort('high'), 'high');
  assert.equal(normalizarEffort({ level: 'xhigh' }), 'xhigh');
  assert.equal(normalizarEffort(undefined), null);
  assert.equal(normalizarEffort({}), null);
  assert.equal(normalizarEffort(42), null);
});

test('horaLocal e diaHora usam o fuso local', () => {
  const d = new Date(2026, 8, 24, 22, 5); // quinta, 22:05 local
  const s = Math.floor(d.getTime() / 1000);
  assert.equal(horaLocal(s), '22:05');
  assert.equal(diaHora(s), 'qui 22:05');
});

test('horaLocal e diaHora devolvem — sem epoch válido', () => {
  for (const v of [null, undefined, NaN, '1758760000', Infinity]) {
    assert.equal(horaLocal(v), '—');
    assert.equal(diaHora(v), '—');
  }
});

test('formatarTokens', () => {
  assert.equal(formatarTokens(999), '999');
  assert.equal(formatarTokens(850_000), '850k');
  assert.equal(formatarTokens(1_234_567), '1.2M');
  assert.equal(formatarTokens(null), '—');
});

test('formatarTokens nas fronteiras k/M', () => {
  assert.equal(formatarTokens(999), '999');
  assert.equal(formatarTokens(1_000), '1k');
  assert.equal(formatarTokens(999_499), '999k');
  assert.equal(formatarTokens(999_500), '1.0M');
  assert.equal(formatarTokens(999_999), '1.0M');
});

// lerStdin lê o process.stdin global, então roda num processo filho.
const UTIL_URL = new URL('../src/util.js', import.meta.url).href;

function rodarFilho(corpo, { stdio = 'pipe', entrada, timeoutMs = 5000 } = {}) {
  const script = `import { lerStdin } from ${JSON.stringify(UTIL_URL)};\n${corpo}`;
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: [stdio, 'pipe', 'pipe'],
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    let saida = '';
    let erro = '';
    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    filho.stdout.on('data', (c) => { saida += c; });
    filho.stderr.on('data', (c) => { erro += c; });
    const guarda = setTimeout(() => {
      filho.kill();
      reject(new Error(`filho não terminou em ${timeoutMs} ms; stderr: ${erro}`));
    }, timeoutMs);
    filho.on('error', (e) => { clearTimeout(guarda); reject(e); });
    filho.on('close', (codigo) => {
      clearTimeout(guarda);
      resolve({ codigo, saida, erro, filho });
    });
    if (stdio === 'pipe' && entrada !== undefined) filho.stdin.end(entrada);
    // stdio 'pipe' sem entrada: o stdin fica aberto de propósito.
  });
}

test('lerStdin devolve a entrada canalizada', async () => {
  const r = await rodarFilho(
    'const t = await lerStdin(); process.stdout.write(JSON.stringify(t));',
    { entrada: '{"a":"sáb"}' },
  );
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(JSON.parse(r.saida), '{"a":"sáb"}');
});

test('lerStdin resolve com stdin fechado (ignore)', async () => {
  const r = await rodarFilho(
    'const t = await lerStdin(); process.stdout.write(JSON.stringify(t));',
    { stdio: 'ignore' },
  );
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(JSON.parse(r.saida), '');
});

test('lerStdin resolve vazio na hora quando stdin é TTY', async () => {
  const r = await rodarFilho(
    "Object.defineProperty(process.stdin, 'isTTY', { value: true });\n" +
      'const t0 = Date.now(); const t = await lerStdin();\n' +
      'process.stdout.write(JSON.stringify({ t, ms: Date.now() - t0 })); process.exit(0);',
  );
  assert.equal(r.codigo, 0, r.erro);
  const { t, ms } = JSON.parse(r.saida);
  assert.equal(t, '');
  assert.ok(ms < 500, `demorou ${ms} ms`);
});

test('lerStdin desiste após o prazo se o stdin nunca fecha', async () => {
  const r = await rodarFilho(
    'const t0 = Date.now(); const t = await lerStdin(50);\n' +
      'process.stdout.write(JSON.stringify({ t, ms: Date.now() - t0 }));',
    { timeoutMs: 5000 },
  );
  // O pai nunca fecha o stdin do filho: o filho só termina se lerStdin
  // resolver pelo prazo e soltar o stdin.
  assert.equal(r.codigo, 0, r.erro);
  const { t, ms } = JSON.parse(r.saida);
  assert.equal(t, '');
  assert.ok(ms >= 40 && ms < 1000, `demorou ${ms} ms`);
});

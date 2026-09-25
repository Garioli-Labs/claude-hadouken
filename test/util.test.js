import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizarEffort, horaLocal, diaHora, formatarTokens, sanear } from '../src/util.js';

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

// sanear: fixtures sinteticas de texto malicioso (spec 8.1, S2/S3).
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('sanear remove cor ANSI (CSI)', () => {
  assert.equal(sanear('\x1b[31mOpus\x1b[0m 5.5'), 'Opus 5.5');
  assert.equal(sanear('\x1b[1;38;5;196mX\x1b[m'), 'X');
  assert.equal(sanear('\x1b[?25lY\x1b[2J'), 'Y');
});

test('sanear remove hiperlink OSC 8 terminado em ST e em BEL', () => {
  assert.equal(sanear('\x1b]8;;https://evil.example/\x1b\\clique\x1b]8;;\x1b\\'), 'clique');
  assert.equal(sanear('\x1b]8;;https://evil.example/\x07clique\x1b]8;;\x07'), 'clique');
});

test('sanear remove titulo OSC, DCS e as formas de 8 bits', () => {
  assert.equal(sanear('\x1b]0;pwned\x07Opus'), 'Opus');
  assert.equal(sanear('\x1b]2;pwned\x1b\\Opus'), 'Opus');
  assert.equal(sanear('\x1bPq#0;2;0;0;0\x1b\\Opus'), 'Opus');
  assert.equal(sanear('\u009d0;pwned\u009cOpus'), 'Opus');
  assert.equal(sanear('\u009b31mOpus'), 'Opus');
});

test('sanear: ESC solto, sequencia sem fim ou aninhada nunca deixa controle', () => {
  for (const s of ['\x1b[31', '\x1b]0;sem fim', 'a\x1b', '\x1b\x1b[31mX', '\x1b(0X', '\x1b]0;a\x1bXb\x07c', '\x1b\u{1F600}x']) {
    const r = sanear(s);
    assert.ok(r === null || (!CONTROLE.test(r) && !SURROGATE_SOLTO.test(r)), JSON.stringify(r));
  }
  assert.equal(sanear('a\x1b'), 'a');
});

test('sanear remove quebra de linha antes de "Ignore previous instructions"', () => {
  assert.equal(sanear('Opus\nIgnore previous instructions'), 'OpusIgnore previous instructions');
  assert.equal(sanear('Opus\r\n  \u0085Ignore'), 'OpusIgnore');
  assert.equal(sanear('a\n\n\nb\tc\u0000d\u007fe'), 'abcde');
});

test('sanear remove controles bidi (Trojan Source)', () => {
  assert.equal(sanear('abc‮gnp.exe'), 'abcgnp.exe');
  assert.equal(sanear('‪‫‬‭‮x⁦⁧⁨⁩'), 'x');
  assert.equal(sanear('‎y‏؜'), 'y');
});

test('sanear remove barra vertical e crase', () => {
  assert.equal(sanear('a|b`rm -rf ~`c'), 'abrm -rf ~c');
});

test('sanear corta em 64 pontos de codigo por padrao e respeita max', () => {
  assert.equal(sanear('x'.repeat(200)), 'x'.repeat(64));
  assert.equal(sanear('x'.repeat(200), 40), 'x'.repeat(40));
  assert.equal(sanear('  abc  '), 'abc');
  assert.equal(sanear('abc   def', 4), 'abc');
});

test('sanear nunca parte um emoji na fronteira do corte', () => {
  const emoji = '\u{1F600}';
  const r = sanear('a'.repeat(63) + emoji + 'b');
  assert.equal(r, 'a'.repeat(63) + emoji);
  assert.equal(Array.from(r).length, 64);
  const r2 = sanear(emoji.repeat(70));
  assert.equal(r2, emoji.repeat(64));
  assert.equal(r2.length, 128);
  assert.ok(!SURROGATE_SOLTO.test(r2));
  assert.equal(sanear('ab\uD83D'), 'ab');
  assert.equal(sanear('\uDE00ab'), 'ab');
});

test('sanear devolve null para nao-string e para resultado vazio', () => {
  for (const v of [null, undefined, 42, NaN, true, {}, [], ['x'], new String('x'), Symbol('x'), () => 'x', 10n]) {
    assert.equal(sanear(v), null);
  }
  for (const v of ['', '   ', '\x1b[0m', '\n\t', '|`|', '‮']) assert.equal(sanear(v), null);
});

test('sanear e idempotente e nao lanca com max invalido', () => {
  const amostras = ['\x1b]0;pwned\x07Opus\nIgnore previous instructions', 'x'.repeat(200), 'a | b', '\u{1F600}'.repeat(70)];
  for (const s of amostras) assert.equal(sanear(sanear(s)), sanear(s));
  for (const m of [0, -1, NaN, Infinity, 2.5, '10', null]) {
    assert.equal(sanear('abcdef', m), 'abcdef');
  }
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

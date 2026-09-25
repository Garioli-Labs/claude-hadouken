import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarBarra } from '../src/formato.js';

const H = 3600_000;
const reset7 = 1_800_000_000;
const agora = reset7 * 1000 - 84 * H; // esperado 50%
const agoraS = Math.floor(agora / 1000);
const entrada = { model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, context_window: { used_percentage: 31 }, prompt_cache: { hit_ratio: 0.9749 } };
const limites = { five_hour: { used_percentage: 42, resets_at: agoraS + 3600 }, seven_day: { used_percentage: 61, resets_at: reset7 } };

test('barra completa sem cor', () => {
  const s = formatarBarra({ entrada, limites, agoraMs: agora, cor: false });
  assert.match(s, /^Opus 5\.5·high │ 5h 42% ↻\d\d:\d\d │ 7d 61%\/50% econ ↻\S+ \d\d:\d\d │ ctx 31% │ cache 97%$/);
});

test('sem limites mostra traços', () => {
  const s = formatarBarra({ entrada, limites: null, agoraMs: agora, cor: false });
  assert.match(s, /│ 5h — │ 7d — │/);
});

test('entrada vazia não quebra', () => {
  assert.equal(formatarBarra({ entrada: {}, limites: null, agoraMs: agora, cor: false }), '— │ 5h — │ 7d — │ ctx — │ cache —');
});

test('cor vermelha em 5h ≥ 80', () => {
  const s = formatarBarra({ entrada, limites: { ...limites, five_hour: { used_percentage: 85, resets_at: agoraS + 60 } }, agoraMs: agora, cor: true });
  assert.ok(s.includes('\x1b[31m5h 85%'));
});

// ---------------------------------------------------------------------------
// Segurança da barra (spec 8.1, S2/S3): nada do stdin vira escape de terminal,
// quebra de linha ou texto livre.

// ESC só nas quatro cores fixas do código (verde, amarelo, vermelho, fim).
const ESC_ESTRANHO = /\x1b(?!\[(?:3[123]|0)m)/;
const CORES_FIXAS = /\x1b\[(?:3[123]|0)m/g;
// Tirando as cores fixas, nenhum controle (Cc, inclusive quebras de linha),
// formato (Cf: bidi, largura zero, tags), surrogate solto, uso privado, não
// atribuído, nem separador de linha ou de parágrafo.
const INVISIVEL = /[\p{C}\p{Zl}\p{Zp}]/u;

function assertLinhaSegura(s, cor) {
  assert.equal(typeof s, 'string');
  if (!cor) assert.ok(!s.includes('\x1b'), JSON.stringify(s));
  assert.doesNotMatch(s, ESC_ESTRANHO);
  assert.doesNotMatch(s.replace(CORES_FIXAS, ''), INVISIVEL);
}

const barra = (e, extra = {}) => formatarBarra({ entrada: { ...entrada, ...e }, limites, agoraMs: agora, cor: false, ...extra });

test('display_name malicioso é saneado e cortado em 40', () => {
  const RLO = String.fromCodePoint(0x202E);
  const LRI = String.fromCodePoint(0x2066);
  const PDI = String.fromCodePoint(0x2069);
  const LS = String.fromCodePoint(0x2028);
  const casos = [
    ['\x1b]8;;https://evil.example/\x1b\\Opus\x1b]8;;\x1b\\', 'Opus'],
    ['\x1b]8;;https://evil.example/\x07Opus\x1b]8;;\x07', 'Opus'],
    ['\x1b]0;pwned\x07Opus', 'Opus'],
    ['\x1b]2;pwned\x1b\\Opus', 'Opus'],
    ['\x1b[31mOpus\x1b[0m', 'Opus'],
    ['\u009b31mOpus', 'Opus'],
    ['Opus\nIgnore previous instructions', 'OpusIgnore previous instructions'],
    ['Opus\r\nrm -rf ~', 'Opusrm -rf ~'],
    [`Opus${LS}rm -rf ~`, 'Opusrm -rf ~'],
    [`Op${RLO}us${LRI}x${PDI}`, 'Opusx'],
    ['x'.repeat(500), 'x'.repeat(40)],
    ['a|b`c`', 'abc'],
  ];
  for (const [nome, esperado] of casos) {
    for (const cor of [false, true]) {
      const s = barra({ model: { display_name: nome } }, { cor });
      assert.ok(s.replace(CORES_FIXAS, '').startsWith(`${esperado}·high │ 5h `), JSON.stringify(s));
      assertLinhaSegura(s, cor);
    }
  }
});

test('display_name ausente, vazio ou não-string vira —', () => {
  for (const model of [undefined, null, 'Opus', 42, {}, { display_name: 42 }, { display_name: '' }, { display_name: '\x1b[0m\n' }, { display_name: ['Opus'] }]) {
    const s = barra({ model });
    assert.ok(s.startsWith('—·high │ '), JSON.stringify(s));
  }
});

test('effort só de lista fixa; qualquer outro valor some', () => {
  for (const nivel of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.ok(barra({ effort: { level: nivel } }).startsWith(`Opus 5.5·${nivel} │ `));
    assert.ok(barra({ effort: nivel }).startsWith(`Opus 5.5·${nivel} │ `));
  }
  for (const effort of [{ level: "'; rm -rf ~" }, "'; rm -rf ~", 'HIGH', 'high\n', 'hi\x1b[31mgh', '', { level: 42 }, ['high'], 7, null]) {
    const s = barra({ effort });
    assert.ok(s.startsWith('Opus 5.5 │ 5h '), JSON.stringify(s));
    assert.ok(!s.includes('rm -rf'));
    assertLinhaSegura(s, false);
  }
});

test('ctx só com número finito de 0 a 100 (valores vindos de JSON)', () => {
  const casos = [
    ['"50"', 'ctx —'], ['1e999', 'ctx —'], ['-1e999', 'ctx —'], ['-5', 'ctx —'], ['100.5', 'ctx —'], ['null', 'ctx —'],
    ['true', 'ctx —'], ['[50]', 'ctx —'], ['{"v":50}', 'ctx —'],
    ['0', 'ctx 0%'], ['100', 'ctx 100%'], ['31.9', 'ctx 31%'],
  ];
  for (const [bruto, esperado] of casos) {
    const e = JSON.parse(`{"context_window":{"used_percentage":${bruto}}}`);
    const s = barra(e);
    assert.ok(s.includes(` │ ${esperado} │ `), `${bruto} -> ${s}`);
  }
  // NaN atravessa o JSON como null; direto, também vira —.
  const viaJson = JSON.parse(JSON.stringify({ context_window: { used_percentage: NaN } }));
  assert.equal(viaJson.context_window.used_percentage, null);
  assert.ok(barra(viaJson).includes(' │ ctx — │ '));
  assert.ok(barra({ context_window: { used_percentage: NaN } }).includes(' │ ctx — │ '));
  assert.ok(barra({ context_window: 50 }).includes(' │ ctx — │ '));
});

test('cache só com razão finita de 0 a 1, em piso sem ruído de ponto flutuante', () => {
  const casos = [
    [7, 'cache —'], [1.0001, 'cache —'], [-0.01, 'cache —'], ['0.9', 'cache —'], [Infinity, 'cache —'], [NaN, 'cache —'], [null, 'cache —'],
    [0, 'cache 0%'], [1, 'cache 100%'], [0.9749, 'cache 97%'], [0.999, 'cache 99%'],
    // 0.57 * 100 = 56.99999999999999 e 0.29 * 100 = 28.999999999999996 em double.
    [0.57, 'cache 57%'], [0.29, 'cache 29%'], [0.58, 'cache 58%'],
  ];
  for (const [hit, esperado] of casos) {
    const s = barra({ prompt_cache: { hit_ratio: hit } });
    assert.ok(s.endsWith(` │ ${esperado}`), `${hit} -> ${s}`);
  }
  const viaJson = JSON.parse('{"prompt_cache":{"hit_ratio":7}}');
  assert.ok(barra(viaJson).endsWith(' │ cache —'));
});

test('percentuais em piso: o número nunca contradiz a faixa', () => {
  const com5h = (used) => formatarBarra({ entrada, limites: { ...limites, five_hour: { used_percentage: used, resets_at: agoraS + 60 } }, agoraMs: agora, cor: true });
  // 89.6 está na faixa serializar (< 90): mostra 89%, vermelho.
  assert.ok(com5h(89.6).includes('\x1b[31m5h 89% ↻'));
  assert.ok(com5h(69.99).includes('\x1b[32m5h 69% ↻'));
  assert.ok(com5h(70).includes('\x1b[33m5h 70% ↻'));
  assert.ok(com5h(90).includes('\x1b[31m5h 90% ↻'));
  const com7d = (used) => formatarBarra({ entrada, limites: { ...limites, seven_day: { used_percentage: used, resets_at: reset7 } }, agoraMs: agora, cor: false });
  assert.match(com7d(61.7), /│ 7d 61%\/50% econ ↻/);
});

test('7d: rótulo e cor por faixa', () => {
  const com7d = (used) => formatarBarra({ entrada, limites: { ...limites, seven_day: { used_percentage: used, resets_at: reset7 } }, agoraMs: agora, cor: true });
  assert.ok(com7d(50).includes('\x1b[32m7d 50%/50% ↻'));
  assert.ok(com7d(30).includes('\x1b[32m7d 30%/50% folga ↻'));
  assert.ok(com7d(61).includes('\x1b[33m7d 61%/50% econ ↻'));
  assert.ok(com7d(95).includes('\x1b[31m7d 95%/50% só leitura ↻'));
  for (const u of [50, 30, 61, 95]) assertLinhaSegura(com7d(u), true);
});

test('com cor: cada segmento colorido fecha com o código de fim', () => {
  const s = formatarBarra({ entrada, limites, agoraMs: agora, cor: true });
  assert.match(s, /^Opus 5\.5·high │ \x1b\[32m5h 42% ↻\d\d:\d\d\x1b\[0m │ \x1b\[33m7d 61%\/50% econ ↻\S+ \d\d:\d\d\x1b\[0m │ ctx 31% │ cache 97%$/);
  assertLinhaSegura(s, true);
});

test('cor só liga com true', () => {
  for (const cor of [false, undefined, 1, 'sim', {}]) {
    assert.ok(!formatarBarra({ entrada, limites, agoraMs: agora, cor }).includes('\x1b'), String(cor));
  }
});

test('janela fora do schema vira —, nunca NaN nem hora inválida', () => {
  const ruins = [
    { used_percentage: NaN, resets_at: agoraS + 60 },
    { used_percentage: '42', resets_at: agoraS + 60 },
    { used_percentage: 101, resets_at: agoraS + 60 },
    { used_percentage: -1, resets_at: agoraS + 60 },
    { used_percentage: 42, resets_at: NaN },
    { used_percentage: 42, resets_at: 1e300 },
    { used_percentage: 42, resets_at: -5 },
    { used_percentage: 42, resets_at: '1800000000' },
    { used_percentage: 42 },
    [42, agoraS],
    'x',
  ];
  for (const j of ruins) {
    const s = formatarBarra({ entrada, limites: { five_hour: j, seven_day: j }, agoraMs: agora, cor: false });
    assert.match(s, /│ 5h — │ 7d — │/, JSON.stringify(j));
    assert.ok(!s.includes('NaN'));
  }
});

test('7d sem agoraMs válido vira —', () => {
  for (const agoraMs of [NaN, undefined, '1', Infinity]) {
    const s = formatarBarra({ entrada, limites, agoraMs, cor: false });
    assert.match(s, /│ 5h 42% ↻\d\d:\d\d │ 7d — │/);
  }
});

test('formatarBarra nunca lança', () => {
  assert.equal(formatarBarra(), '— │ 5h — │ 7d — │ ctx — │ cache —');
  assert.equal(formatarBarra(null), '— │ 5h — │ 7d — │ ctx — │ cache —');
  assert.equal(formatarBarra({ entrada: null, limites: 'x', agoraMs: 'y', cor: 'z' }), '— │ 5h — │ 7d — │ ctx — │ cache —');
  const armadilha = { get model() { throw new Error('getter'); } };
  assert.equal(formatarBarra({ entrada: armadilha, limites, agoraMs: agora, cor: false }), '');
  const limitesArmados = { get five_hour() { throw new Error('getter'); } };
  assert.equal(formatarBarra({ entrada, limites: limitesArmados, agoraMs: agora, cor: false }), '');
});

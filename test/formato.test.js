import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarBarra, PARTES_BARRA } from '../src/formato.js';

const H = 3600_000;
const reset7 = 1_800_000_000;
const agora = reset7 * 1000 - 84 * H;
const agoraS = Math.floor(agora / 1000);
const entrada = { model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, context_window: { used_percentage: 31 }, prompt_cache: { hit_ratio: 0.9749 } };
const limites = { five_hour: { used_percentage: 42, resets_at: agoraS + 3600 }, seven_day: { used_percentage: 61, resets_at: reset7 } };

// Barrinhas da linha padrão (spec v0.2.0 §4 e §5): ctx 31 → 2 casas; cache
// 97,49 → 7.
const BCTX = '▰▰▱▱▱▱▱▱';
const BCACHE = '▰▰▰▰▰▰▰▱';
// E6 (emenda 2026-09-29): a barra do terminal fica só com a sessão.
const LINHA = `Opus 5.5·high │ ctx ${BCTX} 31% │ cache ${BCACHE} 97%`;
const MIN = 60_000;

test('E6: barra completa sem cor é só modelo·effort, ctx e cache', () => {
  assert.equal(formatarBarra({ entrada, cor: false }), LINHA);
  assert.deepEqual(PARTES_BARRA, ['modelo', 'ctx', 'cache']);
  assert.ok(Object.isFrozen(PARTES_BARRA));
});

test('E6: limites, agoraMs, previsão e sessões ativas são aceitos e ignorados', () => {
  const previsao = { five_hour: agora + 26 * MIN, seven_day: agora + 30 * H };
  for (const cor of [false, true]) {
    const s = formatarBarra({ entrada, limites, agoraMs: agora, cor, previsao, sessoesAtivas: 3 });
    const limpa = s.replace(CORES_FIXAS, '');
    for (const proibido of ['5h', '7d', 'sessões', '→100%', '→', '↻', '┃']) {
      assert.equal(limpa.includes(proibido), false, `${proibido} em ${limpa}`);
    }
    assert.equal(limpa, LINHA);
    assertLinhaSegura(s, cor);
  }
});

test('entrada vazia não quebra', () => {
  assert.equal(formatarBarra({ entrada: {}, limites: null, agoraMs: agora, cor: false }), '— │ ctx — │ cache —');
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

const barra = (e, extra = {}) => formatarBarra({ entrada: { ...entrada, ...e }, cor: false, ...extra });

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
      assert.ok(s.replace(CORES_FIXAS, '').startsWith(`${esperado}·high │ ctx `), JSON.stringify(s));
      assertLinhaSegura(s, cor);
    }
  }
});

// M-1 (v0.1.0) e spec v0.2.0 §7: o nome do modelo não pode imitar segmentos
// da barra nem forjar uma barrinha ou uma marca com os glifos dela.
test('display_name sem os glifos da barra e da barrinha: nunca forja segmento, effort, barrinha nem marca', () => {
  const casos = [
    ['Opus │ 5h 3% ↻09:00 │ 7d 2%/9%', 'Opus 5h 3% 09:00 7d 2%/9%'],
    ['Opus 5.5·max', 'Opus 5.5 max'],
    ['Opus│5h', 'Opus 5h'],
    ['·Opus↻', 'Opus'],
    ['Opus ▰▰▰▱ 5h┃', 'Opus 5h'],
    ['▰▰▰▰┃▱▱▱▱ 99%', '99%'],
    ['Op┃us', 'Op us'],
    ['Opus →100% 09:00', 'Opus 100% 09:00'],
  ];
  for (const [nome, esperado] of casos) {
    for (const cor of [false, true]) {
      const s = barra({ model: { display_name: nome } }, { cor });
      const limpa = s.replace(CORES_FIXAS, '');
      assert.equal(limpa.split(' │ ').length, 3, limpa);
      assert.equal((limpa.match(/│/g) ?? []).length, 2, limpa);
      assert.equal(limpa, `${esperado}·high │ ctx ${BCTX} 31% │ cache ${BCACHE} 97%`);
      assert.equal((limpa.match(/·/g) ?? []).length, 1, limpa);
      assert.equal(limpa.includes('↻'), false, limpa);
      // Só as duas barrinhas do código: 16 casas e nenhuma marca.
      assert.equal((limpa.match(/[▰▱]/g) ?? []).length, 16, limpa);
      assert.equal(limpa.includes('┃'), false, limpa);
      assert.equal(limpa.split(' │ ')[0].match(/[▰▱┃]/), null, limpa);
      assert.equal(limpa.includes('→'), false, limpa);
    }
  }
  const soGlifos = barra({ model: { display_name: ' │ ↻ · ▰ ▱ ┃ → ' } });
  assert.ok(soGlifos.startsWith('—·high │ ctx '), soGlifos);
  const semEffort = formatarBarra({ entrada: { model: { display_name: 'Opus·max' } }, cor: false });
  assert.equal(semEffort, 'Opus max │ ctx — │ cache —');
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
    assert.ok(s.startsWith('Opus 5.5 │ ctx '), JSON.stringify(s));
    assert.ok(!s.includes('rm -rf'));
    assertLinhaSegura(s, false);
  }
});

test('ctx só com número finito de 0 a 100 (valores vindos de JSON); a barrinha usa o valor antes do piso', () => {
  const casos = [
    ['"50"', 'ctx —'], ['1e999', 'ctx —'], ['-1e999', 'ctx —'], ['-5', 'ctx —'], ['100.5', 'ctx —'], ['null', 'ctx —'],
    ['true', 'ctx —'], ['[50]', 'ctx —'], ['{"v":50}', 'ctx —'],
    ['0', 'ctx ▱▱▱▱▱▱▱▱ 0%'], ['100', 'ctx ▰▰▰▰▰▰▰▰ 100%'], ['31.9', 'ctx ▰▰▰▱▱▱▱▱ 31%'], ['0.5', 'ctx ▱▱▱▱▱▱▱▱ 0%'], ['1', 'ctx ▰▱▱▱▱▱▱▱ 1%'],
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
  for (const v of [Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, -0.0001, Infinity]) {
    assert.ok(barra({ context_window: { used_percentage: v } }).includes(' │ ctx — │ '), String(v));
  }
});

test('cache só com razão finita de 0 a 1, em piso sem ruído de ponto flutuante', () => {
  const casos = [
    [7, 'cache —'], [1.0001, 'cache —'], [-0.01, 'cache —'], ['0.9', 'cache —'], [Infinity, 'cache —'], [NaN, 'cache —'], [null, 'cache —'],
    [0, 'cache ▱▱▱▱▱▱▱▱ 0%'], [1, 'cache ▰▰▰▰▰▰▰▰ 100%'], [0.9749, `cache ${BCACHE} 97%`], [0.999, 'cache ▰▰▰▰▰▰▰▱ 99%'],
    // 0.57 * 100 = 56.99999999999999 e 0.29 * 100 = 28.999999999999996 em double.
    [0.57, 'cache ▰▰▰▰▰▱▱▱ 57%'], [0.29, 'cache ▰▰▱▱▱▱▱▱ 29%'], [0.58, 'cache ▰▰▰▰▰▱▱▱ 58%'],
  ];
  for (const [hit, esperado] of casos) {
    const s = barra({ prompt_cache: { hit_ratio: hit } });
    assert.ok(s.endsWith(` │ ${esperado}`), `${hit} -> ${s}`);
  }
  const viaJson = JSON.parse('{"prompt_cache":{"hit_ratio":7}}');
  assert.ok(barra(viaJson).endsWith(' │ cache —'));
});

// Faixas novas, só visuais (spec v0.2.0 §5): ctx verde abaixo de 70, amarelo
// de 70 a 84, vermelho de 85; cache verde de 80, amarelo de 50 a 79,
// vermelho abaixo de 50. Comparam o inteiro exibido.
const VERDE = '\x1b[32m';
const AMARELO = '\x1b[33m';
const VERMELHO = '\x1b[31m';
const FIM = '\x1b[0m';

test('ctx: cor por faixa nos limites 69/70 e 84/85, pelo piso exibido', () => {
  const comCtx = (v, cor = true) => barra({ context_window: { used_percentage: v } }, { cor });
  const casos = [
    [0, VERDE, '▱▱▱▱▱▱▱▱ 0%'], [69, VERDE, '▰▰▰▰▰▰▱▱ 69%'], [69.99, VERDE, '▰▰▰▰▰▰▱▱ 69%'],
    [70, AMARELO, '▰▰▰▰▰▰▱▱ 70%'], [84, AMARELO, '▰▰▰▰▰▰▰▱ 84%'], [84.99, AMARELO, '▰▰▰▰▰▰▰▱ 84%'],
    [85, VERMELHO, '▰▰▰▰▰▰▰▱ 85%'], [100, VERMELHO, '▰▰▰▰▰▰▰▰ 100%'],
  ];
  for (const [v, cor, texto] of casos) {
    const s = comCtx(v);
    assert.ok(s.includes(` │ ${cor}ctx ${texto}${FIM} │ `), `${v} -> ${JSON.stringify(s)}`);
    assertLinhaSegura(s, true);
    const semCor = comCtx(v, false);
    assert.ok(semCor.includes(` │ ctx ${texto} │ `), `${v} -> ${semCor}`);
    assertLinhaSegura(semCor, false);
  }
});

test('cache: cor por faixa nos limites 49/50 e 79/80, pelo piso exibido', () => {
  const comCache = (v, cor = true) => barra({ prompt_cache: { hit_ratio: v } }, { cor });
  const casos = [
    [0, VERMELHO, '▱▱▱▱▱▱▱▱ 0%'], [0.49, VERMELHO, '▰▰▰▰▱▱▱▱ 49%'], [0.4999, VERMELHO, '▰▰▰▰▱▱▱▱ 49%'],
    [0.5, AMARELO, '▰▰▰▰▱▱▱▱ 50%'], [0.79, AMARELO, '▰▰▰▰▰▰▱▱ 79%'], [0.7999, AMARELO, '▰▰▰▰▰▰▱▱ 79%'],
    [0.8, VERDE, '▰▰▰▰▰▰▱▱ 80%'], [0.9749, VERDE, `${BCACHE} 97%`], [1, VERDE, '▰▰▰▰▰▰▰▰ 100%'],
  ];
  for (const [v, cor, texto] of casos) {
    const s = comCache(v);
    assert.ok(s.endsWith(` │ ${cor}cache ${texto}${FIM}`), `${v} -> ${JSON.stringify(s)}`);
    assertLinhaSegura(s, true);
    const semCor = comCache(v, false);
    assert.ok(semCor.endsWith(` │ cache ${texto}`), `${v} -> ${semCor}`);
    assertLinhaSegura(semCor, false);
  }
});

test('com cor: cada segmento colorido fecha com o código de fim; o modelo fica sem cor', () => {
  const s = formatarBarra({ entrada, cor: true });
  assert.equal(s, `Opus 5.5·high │ ${VERDE}ctx ${BCTX} 31%${FIM} │ ${VERDE}cache ${BCACHE} 97%${FIM}`);
  assertLinhaSegura(s, true);
});

test('cor só liga com true; sem cor as barrinhas ficam', () => {
  for (const cor of [false, undefined, 1, 'sim', {}]) {
    const s = formatarBarra({ entrada, cor });
    assert.equal(s, LINHA, String(cor));
  }
});

test('formatarBarra nunca lança', () => {
  assert.equal(formatarBarra(), '— │ ctx — │ cache —');
  assert.equal(formatarBarra(null), '— │ ctx — │ cache —');
  assert.equal(formatarBarra({ entrada: null, limites: 'x', agoraMs: 'y', cor: 'z' }), '— │ ctx — │ cache —');
  const armadilha = { get model() { throw new Error('getter'); } };
  assert.equal(formatarBarra({ entrada: armadilha, cor: false }), '');
  // As opções ignoradas (E6) nem são lidas: getter que lança não muda a linha.
  const armada = { get five_hour() { throw new Error('getter'); } };
  assert.equal(formatarBarra({ entrada, limites: armada, previsao: armada, cor: false }), LINHA);
  const opcoesArmadas = { entrada, cor: false, get limites() { throw new Error('getter'); }, get sessoesAtivas() { throw new Error('getter'); } };
  assert.equal(formatarBarra(opcoesArmadas), LINHA);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarBarra } from '../src/formato.js';
import { diaHora, horaLocal } from '../src/util.js';

const H = 3600_000;
const reset7 = 1_800_000_000;
const agora = reset7 * 1000 - 84 * H; // esperado 50%
const agoraS = Math.floor(agora / 1000);
const entrada = { model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, context_window: { used_percentage: 31 }, prompt_cache: { hit_ratio: 0.9749 } };
const limites = { five_hour: { used_percentage: 42, resets_at: agoraS + 3600 }, seven_day: { used_percentage: 61, resets_at: reset7 } };

// Barrinhas da linha padrão (spec v0.2.0 §4 e §5): 5h 42 → 3 casas; 7d 61
// com a marca do esperado 50 (k = 4); ctx 31 → 2 casas; cache 97,49 → 7.
const B5 = '▰▰▰▱▱▱▱▱';
const B7 = '▰▰▰▰┃▰▱▱▱';
const BCTX = '▰▰▱▱▱▱▱▱';
const BCACHE = '▰▰▰▰▰▰▰▱';

test('barra completa sem cor, com as quatro barrinhas', () => {
  const s = formatarBarra({ entrada, limites, agoraMs: agora, cor: false });
  assert.match(s, new RegExp(`^Opus 5\\.5·high │ 5h ${B5} 42% ↻\\d\\d:\\d\\d │ 7d ${B7} 61%\\/50% econ ↻\\S+ \\d\\d:\\d\\d │ ctx ${BCTX} 31% │ cache ${BCACHE} 97%$`));
});

test('sem limites mostra traços, sem barrinha', () => {
  const s = formatarBarra({ entrada, limites: null, agoraMs: agora, cor: false });
  assert.match(s, /│ 5h — │ 7d — │/);
});

test('entrada vazia não quebra', () => {
  assert.equal(formatarBarra({ entrada: {}, limites: null, agoraMs: agora, cor: false }), '— │ 5h — │ 7d — │ ctx — │ cache —');
});

test('cor vermelha em 5h ≥ 80, barrinha dentro da cor', () => {
  const s = formatarBarra({ entrada, limites: { ...limites, five_hour: { used_percentage: 85, resets_at: agoraS + 60 } }, agoraMs: agora, cor: true });
  assert.ok(s.includes('\x1b[31m5h ▰▰▰▰▰▰▰▱ 85%'), JSON.stringify(s));
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
      assert.equal(limpa.split(' │ ').length, 5, limpa);
      assert.equal((limpa.match(/│/g) ?? []).length, 4, limpa);
      assert.ok(limpa.startsWith(`${esperado}·high │ 5h ${B5} 42% ↻`), limpa);
      assert.equal((limpa.match(/·/g) ?? []).length, 1, limpa);
      assert.equal((limpa.match(/↻/g) ?? []).length, 2, limpa);
      // Só as quatro barrinhas do código: 32 casas e uma marca (a da 7d).
      assert.equal((limpa.match(/[▰▱]/g) ?? []).length, 32, limpa);
      assert.equal((limpa.match(/┃/g) ?? []).length, 1, limpa);
      assert.equal(limpa.split(' │ ')[0].match(/[▰▱┃]/), null, limpa);
      // Sem previsão passada, nenhuma seta: o nome nunca forja uma (§12.3).
      assert.equal(limpa.includes('→'), false, limpa);
    }
  }
  const soGlifos = barra({ model: { display_name: ' │ ↻ · ▰ ▱ ┃ → ' } });
  assert.ok(soGlifos.startsWith('—·high │ 5h '), soGlifos);
  const semEffort = formatarBarra({ entrada: { model: { display_name: 'Opus·max' } }, limites: null, agoraMs: agora, cor: false });
  assert.equal(semEffort, 'Opus max │ 5h — │ 7d — │ ctx — │ cache —');
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

test('percentuais em piso: o número nunca contradiz a faixa', () => {
  const com5h = (used) => formatarBarra({ entrada, limites: { ...limites, five_hour: { used_percentage: used, resets_at: agoraS + 60 } }, agoraMs: agora, cor: true });
  // 89.6 está na faixa serializar (< 90): mostra 89%, vermelho.
  assert.ok(com5h(89.6).includes('\x1b[31m5h ▰▰▰▰▰▰▰▱ 89% ↻'));
  assert.ok(com5h(69.99).includes('\x1b[32m5h ▰▰▰▰▰▰▱▱ 69% ↻'));
  assert.ok(com5h(70).includes('\x1b[33m5h ▰▰▰▰▰▰▱▱ 70% ↻'));
  assert.ok(com5h(90).includes('\x1b[31m5h ▰▰▰▰▰▰▰▱ 90% ↻'));
  const com7d = (used) => formatarBarra({ entrada, limites: { ...limites, seven_day: { used_percentage: used, resets_at: reset7 } }, agoraMs: agora, cor: false });
  assert.match(com7d(61.7), /│ 7d ▰▰▰▰┃▰▱▱▱ 61%\/50% econ ↻/);
  // M-2: a mesma tela "60%/50%" nunca é econ; "40%/50%" nunca é folga. O
  // esperado 50,4 põe a marca depois de 4 casas.
  const agora504 = reset7 * 1000 - 168 * H + 0.504 * 168 * H;
  const em504 = (used) => formatarBarra({ entrada, limites: { ...limites, seven_day: { used_percentage: used, resets_at: reset7 } }, agoraMs: agora504, cor: false });
  for (const u of [60, 60.4, 60.5, 60.99]) assert.match(em504(u), /│ 7d ▰▰▰▰┃▰▱▱▱ 60%\/50% ↻/, String(u));
  for (const u of [40, 40.3, 40.99]) assert.match(em504(u), /│ 7d ▰▰▰▱┃▱▱▱▱ 40%\/50% ↻/, String(u));
  assert.match(em504(61), /│ 7d ▰▰▰▰┃▰▱▱▱ 61%\/50% econ ↻/);
  assert.match(em504(39.9), /│ 7d ▰▰▰▱┃▱▱▱▱ 39%\/50% folga ↻/);
});

test('7d: rótulo, cor e marca por faixa; 5h nunca tem marca', () => {
  const com7d = (used) => formatarBarra({ entrada, limites: { ...limites, seven_day: { used_percentage: used, resets_at: reset7 } }, agoraMs: agora, cor: true });
  assert.ok(com7d(50).includes('\x1b[32m7d ▰▰▰▰┃▱▱▱▱ 50%/50% ↻'));
  assert.ok(com7d(30).includes('\x1b[32m7d ▰▰▱▱┃▱▱▱▱ 30%/50% folga ↻'));
  assert.ok(com7d(61).includes('\x1b[33m7d ▰▰▰▰┃▰▱▱▱ 61%/50% econ ↻'));
  assert.ok(com7d(95).includes('\x1b[31m7d ▰▰▰▰┃▰▰▰▱ 95%/50% só leitura ↻'));
  for (const u of [50, 30, 61, 95]) assertLinhaSegura(com7d(u), true);
  assert.equal(com7d(50).split(' │ ')[1].includes('┃'), false);
});

test('com cor: cada segmento colorido fecha com o código de fim', () => {
  const s = formatarBarra({ entrada, limites, agoraMs: agora, cor: true });
  assert.match(s, new RegExp(`^Opus 5\\.5·high │ \\x1b\\[32m5h ${B5} 42% ↻\\d\\d:\\d\\d\\x1b\\[0m │ \\x1b\\[33m7d ${B7} 61%\\/50% econ ↻\\S+ \\d\\d:\\d\\d\\x1b\\[0m │ \\x1b\\[32mctx ${BCTX} 31%\\x1b\\[0m │ \\x1b\\[32mcache ${BCACHE} 97%\\x1b\\[0m$`));
  assertLinhaSegura(s, true);
});

test('cor só liga com true; sem cor as barrinhas ficam', () => {
  for (const cor of [false, undefined, 1, 'sim', {}]) {
    const s = formatarBarra({ entrada, limites, agoraMs: agora, cor });
    assert.ok(!s.includes('\x1b'), String(cor));
    assert.ok(s.includes(`5h ${B5} 42%`) && s.includes(`ctx ${BCTX} 31%`) && s.includes(`cache ${BCACHE} 97%`), s);
  }
});

test('janela fora do schema vira —, nunca NaN, hora inválida nem barrinha', () => {
  const ruins = [
    { used_percentage: NaN, resets_at: agoraS + 60 },
    { used_percentage: '42', resets_at: agoraS + 60 },
    { used_percentage: 101, resets_at: agoraS + 60 },
    { used_percentage: -1, resets_at: agoraS + 60 },
    { used_percentage: Number.MAX_SAFE_INTEGER, resets_at: agoraS + 60 },
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
    assert.match(s, new RegExp(`│ 5h ${B5} 42% ↻\\d\\d:\\d\\d │ 7d — │`));
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

// ---------------------------------------------------------------------------
// Sessões simultâneas (spec v0.2.0 §12.3 e §12.4).

const MIN = 60_000;

test('sessões ativas (§12.4): trecho logo depois do modelo, só de 2 a 50, sem cor', () => {
  for (const cor of [false, true]) {
    const s = formatarBarra({ entrada, limites, agoraMs: agora, cor, sessoesAtivas: 3 });
    assert.ok(s.startsWith('Opus 5.5·high │ 3 sessões │ '), JSON.stringify(s));
    assert.equal(s.split(' │ ').length, 6);
    assertLinhaSegura(s, cor);
  }
  assert.ok(barra({}, { sessoesAtivas: 2 }).startsWith(`Opus 5.5·high │ 2 sessões │ 5h ${B5} 42%`));
  assert.ok(barra({}, { sessoesAtivas: 50 }).startsWith(`Opus 5.5·high │ 50 sessões │ 5h ${B5} 42%`));
  for (const n of [1, 0, -2, 51, 2.5, '3', Number.NaN, Infinity, null, undefined, [3], { valueOf: () => 3 }]) {
    assert.ok(barra({}, { sessoesAtivas: n }).startsWith(`Opus 5.5·high │ 5h ${B5} 42%`), String(n));
  }
});

test('previsão (§12.3): →100% depois do reset da janela, em vermelho; 7d com o dia', () => {
  const p5 = agora + 26 * MIN;
  const p7 = agora + 30 * H;
  const previsao = { five_hour: p5, seven_day: p7 };
  const s = formatarBarra({ entrada, limites, agoraMs: agora, cor: false, previsao });
  const partes = s.split(' │ ');
  assert.equal(partes.length, 5);
  assert.equal(partes[1], `5h ${B5} 42% ↻${horaLocal(agoraS + 3600)} →100% ${horaLocal(p5 / 1000)}`);
  assert.equal(partes[2], `7d ${B7} 61%/50% econ ↻${diaHora(reset7)} →100% ${diaHora(p7 / 1000)}`);
  const c = formatarBarra({ entrada, limites, agoraMs: agora, cor: true, previsao });
  assert.ok(c.includes(` ↻${horaLocal(agoraS + 3600)}\x1b[0m \x1b[31m→100% ${horaLocal(p5 / 1000)}\x1b[0m │ `), JSON.stringify(c));
  assert.ok(c.includes(` ↻${diaHora(reset7)}\x1b[0m \x1b[31m→100% ${diaHora(p7 / 1000)}\x1b[0m │ \x1b[32mctx`), JSON.stringify(c));
  assertLinhaSegura(c, true);
  // O exemplo da spec, em hora local: 74% com reset às 15:30 e previsão para 14:40.
  const exemplo = formatarBarra({
    entrada: {}, agoraMs: new Date(2026, 8, 26, 14, 14).getTime(), cor: false,
    limites: { five_hour: { used_percentage: 74, resets_at: new Date(2026, 8, 26, 15, 30).getTime() / 1000 } },
    previsao: { five_hour: new Date(2026, 8, 26, 14, 40).getTime() },
  });
  assert.equal(exemplo.split(' │ ')[1], '5h ▰▰▰▰▰▰▱▱ 74% ↻15:30 →100% 14:40');
  const junto = formatarBarra({ entrada, limites, agoraMs: agora, cor: false, previsao, sessoesAtivas: 3 });
  assert.match(junto, /^Opus 5\.5·high │ 3 sessões │ 5h \S+ 42% ↻\d\d:\d\d →100% \d\d:\d\d │ 7d /);
});

test('previsão fora do lugar não aparece: no passado, no reset ou depois, não finita, sem janela', () => {
  const r5 = (agoraS + 3600) * 1000;
  for (const five_hour of [agora, agora - 1, r5, r5 + 1, Number.NaN, Infinity, '1', null, undefined, {}]) {
    assert.equal(barra({}, { previsao: { five_hour } }).includes('→'), false, String(five_hour));
  }
  assert.ok(barra({}, { previsao: { five_hour: r5 - 1 } }).includes(' →100% '));
  assert.ok(barra({}, { previsao: { seven_day: reset7 * 1000 - 1 } }).includes(' →100% '));
  assert.equal(barra({}, { previsao: { seven_day: reset7 * 1000 } }).includes('→'), false);
  for (const previsao of [null, 'x', 42, [agora + MIN]]) assert.equal(barra({}, { previsao }).includes('→'), false);
  const valida = { five_hour: agora + MIN, seven_day: agora + MIN };
  const semJanela = formatarBarra({ entrada, limites: null, agoraMs: agora, cor: false, previsao: valida });
  assert.equal(semJanela.includes('→'), false, semJanela);
  const semAgora = formatarBarra({ entrada, limites, agoraMs: Number.NaN, cor: false, previsao: valida });
  assert.equal(semAgora.includes('→'), false, semAgora);
  const armada = { get five_hour() { throw new Error('getter'); } };
  assert.equal(typeof formatarBarra({ entrada, limites, agoraMs: agora, cor: false, previsao: armada }), 'string');
});

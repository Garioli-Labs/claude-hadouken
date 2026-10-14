import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _lerLinha, ARQ_TELEMETRIA, lerNovos, registrosDaLinha } from '../src/aprendizado/otlp.js';
import { registrosDaLinha as referencia } from './fixtures/otlp-referencia.mjs';

// Leitura rápida do telemetria.jsonl (revisão da Task 12, desempenho): a
// linha é lida direto dos bytes, sem JSON.parse do lote inteiro, e o leitor
// tem de dar exatamente o mesmo que o leitor original (congelado em
// test/fixtures/otlp-referencia.mjs: toString, trim e JSON.parse). O
// gerador é determinístico (semente fixa) e mistura lotes válidos, campos de
// tipo errado, chaves repetidas e com escape, Unicode, bytes inválidos,
// espaços de todo tipo, listas acima dos limites, aninhamento fundo e linhas
// truncadas ou com lixo.

const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// O que o leitor original faz com uma linha (processarLinha): vazia depois do
// trim conta como lida, sem registro; null é linha corrompida.
function esperado(buf, pares) {
  const texto = buf.toString('utf8').trim();
  return texto.length === 0 ? [] : referencia(texto, AGORA, pares);
}

// Objeto com pares (permite chave repetida e chave escrita com escape).
const P = (...pares) => ({ pares });
function gerador(r) {
  const um = (xs) => xs[Math.floor(r() * xs.length)];
  const chance = (p) => r() < p;
  const nano = (ms) => `${BigInt(Math.max(0, Math.floor(ms))) * 1_000_000n}`;
  const instante = () => (chance(0.75) ? nano(AGORA - r() * 39 * 86_400_000) : um([
    () => nano(AGORA - r() * 39 * 86_400_000), () => nano(AGORA + 10 * 60_000),
    () => nano(AGORA - 41 * 86_400_000), () => (AGORA - 1000) * 1e6, () => `00${nano(AGORA - 5000)}`, () => '12', () => '-5',
    () => `${nano(AGORA - 3000)}.5`, () => '', () => null, () => [], () => P(), () => true, () => '9'.repeat(21),
  ])());
  const texto = () => um([
    'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'gpt-x', 'CLAUDE', 'high', 'xhigh', 'max', 'low', 'medium', 'nada',
    'repl_main_thread', 'main', 'sdk', 'agent:custom', 'agente-1', 'agente com espaço', 'a'.repeat(41), 'ç'.repeat(150), 'é'.repeat(201),
    'x'.repeat(200), 'x'.repeat(201), '🙂'.repeat(60), '\u2028', 'p-1', 'p-2', 'p-3', '', 'true', 'false', '1200', '0.5', '01', '1e3', ' 12',
    '1.1234567890123', '\ud800', 'claude_code.api_request', 'claude_code.tool_result', 'claude_code.api_error', 'api_request', 'tool_result',
  ]);
  const numero = () => um([0, 1, 12, 1200, 0.0123, -1, 1e9, 1e10, 1e400, -0, 3_600_000, 3_600_001, 86_400, 1.5e-7, 123456789012345680000]);
  const lixo = (n = 0) => (n > 2 ? null : um([
    () => null, () => true, () => false, () => numero(), () => texto(), () => [], () => P(), () => [lixo(n + 1), lixo(n + 1)],
    () => P(['a', lixo(n + 1)], ['stringValue', texto()]),
  ])());
  const valorAttr = () => um([
    () => P(['stringValue', texto()]), () => P(['stringValue', texto()]), () => P(['intValue', `${Math.floor(r() * 5000)}`]),
    () => P(['intValue', numero()]), () => P(['doubleValue', numero()]), () => P(['boolValue', chance(0.5)]), () => P(['boolValue', 'true']),
    () => P(['stringValue', lixo()], ['intValue', '7']), () => P(['stringValue', 'a'], ['stringValue', 'claude-opus-5-5']), () => lixo(),
    () => P(['arrayValue', P(['values', [P(['stringValue', 'x'])]])]),
  ])();
  const CHAVES = ['event.name', 'model', 'effort', 'query_source', 'agent.name', 'prompt.id', 'cost_usd', 'input_tokens', 'output_tokens',
    'cache_read_tokens', 'cache_creation_tokens', 'duration_ms', 'ttft_ms', 'success', 'session.id', 'user.email', 'prompt', 'terminal.type'];
  const atributo = (chave, valor) => um([
    () => P(['key', chave], ['value', valor]), () => P(['value', valor], ['key', chave]), () => P(['key', chave], ['value', valor], ['key', 'outra']),
    () => P(['key', chave]), () => P(['key', lixo()], ['value', valor]), () => P(['key', chave], ['value', valor], ['value', valorAttr()]),
  ])();
  const evento = () => um(['api_request', 'api_request', 'tool_result', 'api_error', 'user_prompt', 'tool_decision']);
  const atributosDe = (ev) => {
    const a = [];
    if (chance(0.9)) a.push(atributo('event.name', chance(0.9) ? P(['stringValue', ev]) : valorAttr()));
    if (chance(0.8)) a.push(atributo('model', P(['stringValue', um(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'gpt-x'])])));
    if (chance(0.7)) a.push(atributo('effort', P(['stringValue', um(['high', 'xhigh', 'max', 'low', 'medium', 'turbo'])])));
    if (chance(0.7)) a.push(atributo('query_source', P(['stringValue', um(['repl_main_thread', 'main', 'sdk', 'agent:custom'])])));
    if (chance(0.3)) a.push(atributo('agent.name', P(['stringValue', um(['agente-1', 'Plan', 'a b', ''])])));
    if (chance(0.8)) a.push(atributo('prompt.id', P(['stringValue', um(['p-1', 'p-2', 'p-3', ''])])));
    if (chance(0.5)) a.push(atributo('success', um([P(['boolValue', true]), P(['boolValue', false]), P(['stringValue', 'false']), P(['stringValue', 'sim'])])));
    for (const k of ['cost_usd', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'duration_ms', 'ttft_ms']) {
      if (chance(0.7)) a.push(atributo(k, valorAttr()));
    }
    for (let i = Math.floor(r() * 4); i > 0; i--) a.push(atributo(um(CHAVES), valorAttr()));
    if (chance(0.15)) a.push(lixo());
    // Embaralha um pouco.
    for (let i = a.length - 1; i > 0; i--) { if (chance(0.3)) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
    return a;
  };
  const registro = () => {
    const ev = evento();
    const pares = [];
    if (chance(0.95)) pares.push(['timeUnixNano', instante()]);
    if (chance(0.3)) pares.push(['observedTimeUnixNano', instante()]);
    if (chance(0.7)) pares.push(['body', chance(0.9) ? P(['stringValue', `claude_code.${ev}`]) : lixo()]);
    if (chance(0.95)) pares.push(['attributes', chance(0.95) ? atributosDe(ev) : lixo()]);
    if (chance(0.1)) pares.push(['attributes', atributosDe(evento())]);
    if (chance(0.2)) pares.push(['severityText', 'INFO'], ['droppedAttributesCount', 0]);
    for (let i = pares.length - 1; i > 0; i--) { if (chance(0.3)) { const j = Math.floor(r() * (i + 1)); [pares[i], pares[j]] = [pares[j], pares[i]]; } }
    return chance(0.03) ? lixo() : P(...pares);
  };
  const recurso = () => P(['attributes', [P(['key', 'service.name'], ['value', P(['stringValue', 'claude-code'])]), P(['key', 'user.email'], ['value', P(['stringValue', 'x@y'])])]]);
  const ponto = () => P(
    ...(chance(0.95) ? [['timeUnixNano', instante()]] : []),
    ...(chance(0.8) ? [[um(['asDouble', 'asInt']), um([30, 0, 5.5, '45', '1.5', -1, 90_000, null, P()])]] : []),
    ...(chance(0.2) ? [['asDouble', 12]] : []),
  );
  const metrica = () => P(
    ['name', um(['claude_code.active_time.total', 'claude_code.active_time.total', 'claude_code.cost.usage', 7, null])],
    ...(chance(0.95) ? [['sum', chance(0.95) ? P(
      ['aggregationTemporality', um([1, 1, 2, 'AGGREGATION_TEMPORALITY_DELTA', 'AGGREGATION_TEMPORALITY_CUMULATIVE', '1', null])],
      ['dataPoints', chance(0.95) ? Array.from({ length: 1 + Math.floor(r() * 3) }, ponto) : lixo()],
    ) : lixo()]] : []),
  );
  const lote = () => {
    const pares = [];
    if (chance(0.8)) {
      pares.push(['resourceLogs', Array.from({ length: 1 + Math.floor(r() * 2) }, () => (chance(0.97) ? P(
        ['resource', recurso()],
        ['scopeLogs', Array.from({ length: 1 + Math.floor(r() * 2) }, () => (chance(0.97) ? P(['scope', P(['name', 'x'])], ['logRecords', Array.from({ length: 1 + Math.floor(r() * 3) }, registro)]) : lixo()))],
      ) : lixo()))]);
    }
    if (chance(0.35)) {
      pares.push(['resourceMetrics', [P(['resource', recurso()], ['scopeMetrics', [P(['metrics', Array.from({ length: 1 + Math.floor(r() * 2) }, metrica)])]])]]);
    }
    if (chance(0.05)) pares.push(['resourceLogs', lixo()]);
    if (chance(0.05)) pares.push(['__proto__', P(['resourceLogs', []])]);
    return P(...pares);
  };
  // Serialização com espaços JSON aleatórios e escapes nas chaves e textos.
  const espaco = () => (chance(0.85) ? '' : um([' ', '\t', '\r', '\n ', '  ']));
  const textoJson = (s) => {
    let j = JSON.stringify(s);
    if (chance(0.1)) j = j.replace(/[a-zA-Z]/, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    if (chance(0.05)) j = j.replace(/[a-zA-Z]/, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`);
    if (chance(0.03)) j = j.replace(/\./, '\\/');
    return j;
  };
  const serializar = (v) => {
    if (v === null || typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return chance(0.1) && Number.isFinite(v) && v !== 0 ? um([v.toExponential(), `${v}`, v.toFixed(3)]) : JSON.stringify(v) ?? 'null';
    if (typeof v === 'string') return textoJson(v);
    if (Array.isArray(v)) return `[${espaco()}${v.map((x) => `${serializar(x)}${espaco()}`).join(`,${espaco()}`)}]`;
    return `{${espaco()}${v.pares.map(([k, x]) => `${textoJson(k)}${espaco()}:${espaco()}${serializar(x)}${espaco()}`).join(`,${espaco()}`)}}`;
  };
  // Estragos em bytes: o leitor rápido desiste (ou não) e o resultado tem
  // de ser igual ao do original.
  const ESTRAGOS = [
    (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b]),
    (b) => Buffer.concat([Buffer.from('\u00a0'), b, Buffer.from('\u00a0')]),
    (b) => Buffer.concat([Buffer.from('\u000b'), b]),
    (b) => Buffer.concat([b, Buffer.from(um([' x', '}', ',', '\u2028', '\u000c', ' \r', '\u0000']))]),
    (b) => b.subarray(0, Math.floor(r() * b.length)),
    (b) => { const c = Buffer.from(b); c[Math.floor(r() * c.length)] = Math.floor(r() * 256); return c; },
    (b) => { const i = Math.floor(r() * b.length); return Buffer.concat([b.subarray(0, i), Buffer.from([um([0x80, 0xc3, 0xe2, 0xf0, 0xff, 0x01, 0x1f, 0x22, 0x5c, 0x7f])]), b.subarray(i)]); },
    (b) => { const i = Math.floor(r() * b.length); return Buffer.concat([b.subarray(0, i), b.subarray(i + 1)]); },
    (b) => { const s = b.toString('latin1'); const i = s.indexOf('"', Math.floor(r() * s.length)); return i < 0 ? b : Buffer.concat([b.subarray(0, i + 1), Buffer.from([0xc3, 0x28, 0xed, 0xa0, 0x80]), b.subarray(i + 1)]); },
    (b) => Buffer.from(b.toString('latin1').replace(/"\w/, (m) => `"\\${um(['x', 'u12', 'u12G4', 'U0041', "'", '0'])}${m[1]}`), 'latin1'),
    (b) => Buffer.from(b.toString('latin1').replace(/\d+/, (m) => um([`0${m}`, `-${m}`, `${m}.`, `${m}e`, `${m}.e1`, `+${m}`, `${m}E+2`, '-'])), 'latin1'),
  ];
  return () => {
    let b = Buffer.from(`${espaco()}${serializar(lote())}${espaco()}`, 'utf8');
    if (chance(0.25)) b = um(ESTRAGOS)(b);
    if (chance(0.02)) b = Buffer.from(um(['', ' ', '\t\r', '\u00a0', '\ufeff', 'null', '[]', '"x"', '{}', '1', '{"resourceLogs":[]}']));
    return b;
  };
}

function compararSequencia(linhas) {
  const paresNovo = new Map();
  const paresRef = new Map();
  let rapidas = 0;
  let comRegistros = 0;
  for (const [i, b] of linhas.entries()) {
    const r = _lerLinha(b, AGORA, paresNovo);
    const e = esperado(b, paresRef);
    assert.deepEqual(r.registros, e, `linha ${i}: ${JSON.stringify(b.toString('latin1').slice(0, 400))}`);
    if (r.rapida) rapidas += 1;
    if (Array.isArray(e) && e.length > 0) comRegistros += 1;
  }
  assert.deepEqual([...paresNovo], [...paresRef]);
  return { rapidas, comRegistros };
}

test('leitura rápida: 8 mil linhas geradas dão o mesmo resultado que o leitor original', (t) => {
  const r = aleatorio(20261001);
  const gerar = gerador(r);
  const linhas = Array.from({ length: 8000 }, gerar);
  const { rapidas, comRegistros } = compararSequencia(linhas);
  // O gerador exercita os dois caminhos: a maioria das linhas sai pela
  // leitura rápida, e uma parte relevante tem registros.
  assert.ok(rapidas > 0.6 * linhas.length, `rápidas: ${rapidas}`);
  assert.ok(rapidas < linhas.length, 'e alguma linha cai no caminho original');
  assert.ok(comRegistros > 0.15 * linhas.length, `com registros: ${comRegistros}`);
  t.diagnostic(`rápidas ${rapidas}, com registros ${comRegistros}, de ${linhas.length}`);
});

const S = (v) => ({ stringValue: v });
const nano = (ms) => `${BigInt(ms) * 1_000_000n}`;
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
const PEDIDO = {
  'event.name': S('api_request'), model: S('claude-sonnet-5-5'), effort: S('high'), query_source: S('repl_main_thread'), 'prompt.id': S('p-9'),
  cost_usd: { doubleValue: 0.5 }, input_tokens: { intValue: '10' },
};
const lote = (registros) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: registros }] }] });
const b = (s) => Buffer.from(s, 'utf8');

test('leitura rápida: casos de borda escritos à mão', () => {
  const ms = AGORA - 60_000;
  const casos = [
    // Chave repetida: vale a última, como no JSON.parse.
    b(`{"resourceLogs":[],"resourceLogs":${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]).resourceLogs)}}`),
    b(`{"resourceLogs":${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]).resourceLogs)},"resourceLogs":5}`),
    // Contêiner onde se espera um instante: não é nulo, então o ?? não cai
    // no observedTimeUnixNano.
    b(JSON.stringify(lote([{ timeUnixNano: {}, observedTimeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))),
    b(JSON.stringify(lote([{ timeUnixNano: [], observedTimeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))),
    b(JSON.stringify(lote([{ timeUnixNano: null, observedTimeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))),
    // Chaves e textos com escape.
    b(`{"resource\\u004cogs":${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]).resourceLogs).replace('"model"', '"mod\\u0065l"').replace('claude-sonnet', 'claude\\u002dsonnet')}}`),
    // Mais de 256 atributos: o que vem depois do 256º não conta.
    b(JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: [...Array.from({ length: 256 }, (_, i) => ({ key: `k${i}`, value: S('x') })), ...attrs(PEDIDO)] }]))),
    b(JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: [...Array.from({ length: 255 }, (_, i) => ({ key: `k${i}`, value: S('x') })), ...attrs(PEDIDO)] }]))),
    // Mais de 4096 registros num lote: só os 4096 primeiros.
    b(JSON.stringify(lote(Array.from({ length: 4100 }, (_, i) => ({ timeUnixNano: nano(ms + i), attributes: attrs(PEDIDO) }))))),
    // Aninhamento fundo num campo ignorado (sem recursão) e num campo lido.
    b(`{"x":${'['.repeat(200_000)}${']'.repeat(200_000)},"resourceLogs":${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]).resourceLogs)}}`),
    b(`{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"body":${'{"a":'.repeat(50_000)}1${'}'.repeat(50_000)}}]}]}]}`),
    b(`{"x":${'['.repeat(200_000)}}`),
    // Fim de linha do Windows, espaços JSON e Unicode nas pontas.
    b(`${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))}\r`),
    b(` \t${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))} \t\r`),
    b(`\ufeff${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))}`),
    b(`${JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs(PEDIDO) }]))}\u00a0\u3000`),
    b(' \t\r'), b(''), b('\u00a0'),
    // Bytes que não são UTF-8 dentro de um texto lido.
    Buffer.concat([b(JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs({ ...PEDIDO, effort: S('hi') }) }])).split('"hi"')[0]), Buffer.from([0x22, 0x68, 0xff, 0x22]),
      b(JSON.stringify(lote([{ timeUnixNano: nano(ms), attributes: attrs({ ...PEDIDO, effort: S('hi') }) }])).split('"hi"')[1])]),
    // Números no limite da gramática.
    b('{"resourceLogs":[],"n":-0}'), b('{"n":01}'), b('{"n":1.}'), b('{"n":.5}'), b('{"n":1e}'), b('{"n":-}'), b('{"n":1E+2}'),
    b('{"a":tru}'), b('{"a":nulll}'), b('{"a" 1}'), b('{"a":1,}'), b('[1]'), b('{"a":"\u0001"}'), b('{"a":"\\u00e"}'),
    b('{"resourceLogs":[{"scopeLogs":[{"logRecords":[1,null,"x",[],{}]}]}]}'),
  ];
  compararSequencia(casos);
});

test('lerNovos com a leitura rápida dá os mesmos registros e o mesmo corrompido do leitor original', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk otlp rápido '));
  dirs.push(d);
  for (const semente of [1, 2]) {
    const gerar = gerador(aleatorio(semente));
    const linhas = Array.from({ length: 1500 }, gerar).map((x) => Buffer.from(x.toString('latin1').replace(/\n/g, ' '), 'latin1'));
    fs.writeFileSync(path.join(d, ARQ_TELEMETRIA), Buffer.concat(linhas.flatMap((x) => [x, Buffer.from('\n')])));
    const pares = new Map();
    const esperados = linhas.map((x) => esperado(x, pares));
    const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
    assert.deepEqual(r.registros, esperados.filter((x) => x !== null).flat());
    assert.equal(r.corrompido, esperados.some((x) => x === null));
  }
});

test('registrosDaLinha (texto) continua igual ao original', () => {
  const r = aleatorio(7);
  const gerar = gerador(r);
  const paresNovo = new Map();
  const paresRef = new Map();
  for (let i = 0; i < 1500; i++) {
    const texto = gerar().toString('utf8');
    assert.deepEqual(registrosDaLinha(texto, AGORA, paresNovo), referencia(texto, AGORA, paresRef));
  }
});

// O mapa de prompt.id (Ruling M2) passa de PARES_MAX (4096): o mais antigo
// sai por um iterador guardado, e tem de sair o mesmo que no original
// (keys().next() de um iterador novo), com o mapa na mesma ordem no fim.
test('pares acima de 4096 prompt.id: sai o mesmo par que no original, na mesma ordem', () => {
  const r = aleatorio(4096);
  const nano = (ms) => `${BigInt(ms) * 1_000_000n}`;
  const at = (key, v) => ({ key, value: { stringValue: v } });
  const linha = (ev, id, modelo) => Buffer.from(JSON.stringify({
    resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: nano(AGORA - 60_000),
      attributes: [at('event.name', ev), at('prompt.id', id), ...(modelo ? [at('model', modelo)] : []), at('success', 'true')],
    }] }] }],
  }));
  let proximo = 0;
  const linhas = [];
  for (let i = 0; i < 9000; i++) {
    const x = r();
    // Um id novo, um recente (volta para o fim da fila) ou um antigo (talvez
    // já fora); tool_result sem modelo só sai se o id ainda está no mapa.
    const id = x < 0.6 || proximo === 0 ? `p-${proximo++}` : x < 0.8 ? `p-${Math.max(0, proximo - 1 - Math.floor(r() * 50))}` : `p-${Math.floor(r() * proximo)}`;
    linhas.push(r() < 0.65 ? linha('api_request', id, r() < 0.5 ? 'claude-opus-5-5' : 'claude-sonnet-5-5') : linha('tool_result', id, null));
  }
  const { rapidas, comRegistros } = compararSequencia(linhas);
  assert.equal(rapidas, linhas.length);
  assert.ok(proximo > 5000 && comRegistros > 0.7 * linhas.length && comRegistros < linhas.length, `${proximo} ${comRegistros}`);
});

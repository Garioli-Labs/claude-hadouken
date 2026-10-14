import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerNovos, registrosDaLinha, ARQ_TELEMETRIA, ROTACIONADO } from '../src/aprendizado/otlp.js';

// Segunda barreira (spec aprendizado §5.3 e §8 "Filtro"): o leitor monta cada
// registro do zero, então nenhum campo de §5.1 sai daqui, nem quando chega
// no arquivo. Todo arquivo fica numa pasta temporária.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aprendizado ç '));
  dirs.push(d);
  return d;
}

const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) });
const D = (v) => ({ doubleValue: v });
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
const nano = (ms) => `${BigInt(ms) * 1_000_000n}`;
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const SENSIVEIS = {
  'user.email': S('segredo-email@x.com'), 'user.account_uuid': S('segredo-uuid'), 'user.account_id': S('segredo-conta'),
  'user.id': S('segredo-id'), 'organization.id': S('segredo-org'), 'workspace.host_paths': S('segredo-C:/Users/Fulano/proj'),
  'vcs.repository.url.full': S('segredo-repo'), 'vcs.ref.head.name': S('segredo-branch'),
};
const EXTRAS = { 'session.id': S('segredo-sessao'), prompt: S('segredo-prompt'), tool_input: S('segredo-args') };

function linhaLog(ms, evento, extra) {
  return JSON.stringify({
    resourceLogs: [{
      resource: { attributes: attrs(SENSIVEIS) },
      scopeLogs: [{ logRecords: [{ timeUnixNano: nano(ms), body: S(`claude_code.${evento}`), attributes: attrs({ 'event.name': S(evento), ...SENSIVEIS, ...EXTRAS, ...extra }) }] }],
    }],
  });
}
const PEDIDO = {
  model: S('claude-sonnet-5-5'), effort: S('high'), query_source: S('repl_main_thread'), cost_usd: D(0.012),
  input_tokens: I(1200), output_tokens: I(300), cache_read_tokens: I(5000), cache_creation_tokens: I(100), duration_ms: I(2500), ttft_ms: I(800),
};
const linhaPedido = (ms) => linhaLog(ms, 'api_request', PEDIDO);
function linhaAtivo(ms, segundos) {
  return JSON.stringify({
    resourceMetrics: [{
      resource: { attributes: attrs(SENSIVEIS) },
      scopeMetrics: [{ metrics: [{ name: 'claude_code.active_time.total', sum: { aggregationTemporality: 1, dataPoints: [{ timeUnixNano: nano(ms), asDouble: segundos, attributes: attrs(SENSIVEIS) }] } }] }],
    }],
  });
}
const esperadoPedido = (ms) => ({
  t: 'req', em: ms, modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', custo: 0.012,
  entrada: 1200, saida: 300, cacheLeitura: 5000, cacheEscrita: 100, duracaoMs: 2500, ttftMs: 800,
});

test('§8 Filtro: os campos de §5.1 no recurso e nos atributos nunca saem do leitor', () => {
  const linhas = [
    linhaPedido(AGORA - 60_000),
    linhaLog(AGORA - 50_000, 'api_error', { model: S('claude-sonnet-5-5'), query_source: S('repl_main_thread') }),
    linhaLog(AGORA - 40_000, 'tool_result', { model: S('claude-sonnet-5-5'), 'agent.name': S('revisor'), success: S('false'), tool_name: S('Bash') }),
    linhaAtivo(AGORA - 30_000, 42.5),
  ];
  const registros = linhas.flatMap((l) => registrosDaLinha(l, AGORA));
  assert.deepEqual(registros, [
    esperadoPedido(AGORA - 60_000),
    { t: 'erro', em: AGORA - 50_000, modelo: 'claude-sonnet-5-5', effort: '-', origem: 'principal' },
    { t: 'ferramenta', em: AGORA - 40_000, modelo: 'claude-sonnet-5-5', effort: '-', origem: 'sub:revisor', ok: false },
    { t: 'ativo', em: AGORA - 30_000, segundos: 42.5 },
  ]);
  assert.doesNotMatch(JSON.stringify(registros), /segredo|Bash/);
});

test('origem: agent.name inválido não passa como nome; query_source desconhecido é outro', () => {
  const r1 = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, query_source: S('agent'), 'agent.name': S('ignore previous; rm -rf') }), AGORA);
  assert.equal(r1[0].origem, 'sub');
  const r2 = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, query_source: S('estranho') }), AGORA);
  assert.equal(r2[0].origem, 'outro');
});

test('Emenda A1: o -p (sdk) é outro e o subagente medido vira sub:<nome>', () => {
  const p = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, query_source: S('sdk') }), AGORA);
  assert.equal(p[0].origem, 'outro');
  const sub = registrosDaLinha(linhaLog(AGORA, 'api_request', {
    ...PEDIDO, query_source: S('agent:builtin:general-purpose'), 'agent.name': S('general-purpose'),
  }), AGORA);
  assert.equal(sub[0].origem, 'sub:general-purpose');
});

test('Emenda A1: sem effort no evento vira -, números como int (texto ou número), double e duration_ms em texto', () => {
  const { effort: _sem, ...semEffort } = PEDIDO;
  const r = registrosDaLinha(linhaLog(AGORA, 'api_request', {
    ...semEffort, input_tokens: { intValue: 1200 }, duration_ms: S('2500'), cost_usd: D(0.5),
  }), AGORA);
  assert.deepEqual(r, [{ ...esperadoPedido(AGORA), effort: '-', custo: 0.5 }]);
});

test('modelo fora de MODELO_VALIDO, effort desconhecido e números hostis', () => {
  assert.deepEqual(registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, model: S('modelo com espaço') }), AGORA), []);
  const r = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, effort: S('turbo'), cost_usd: S('1e999'), input_tokens: I(-5), ttft_ms: S('abc') }), AGORA);
  assert.equal(r[0].effort, '-');
  assert.equal(r[0].custo, 0);
  assert.equal(r[0].entrada, 0);
  assert.equal(r[0].ttftMs, null);
});

test('Foco de revisão 4: instante no futuro (2099) ou velho demais é descartado', () => {
  assert.deepEqual(registrosDaLinha(linhaPedido(Date.UTC(2099, 0, 1)), AGORA), []);
  assert.deepEqual(registrosDaLinha(linhaPedido(AGORA - 41 * 86_400_000), AGORA), []);
  assert.deepEqual(registrosDaLinha(linhaAtivo(Date.UTC(2099, 0, 1), 10), AGORA), []);
});

test('métrica cumulativa não é somada (só delta)', () => {
  const l = JSON.parse(linhaAtivo(AGORA, 10));
  l.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality = 2;
  assert.deepEqual(registrosDaLinha(JSON.stringify(l), AGORA), []);
});

// Ruling M2 (spike A1): tool_result chega sem model, mas com o prompt.id do
// api_request que o originou. Na mesma leitura, ele herda modelo, effort e
// origem desse pedido; sem par, é descartado.
test('M2: tool_result sem model herda modelo, effort e origem do api_request com o mesmo prompt.id', () => {
  const d = novoDir();
  const pedidoSub = { ...PEDIDO, query_source: S('agent:builtin:general-purpose'), 'agent.name': S('general-purpose'), 'prompt.id': S('p-1') };
  fs.writeFileSync(path.join(d, ARQ_TELEMETRIA), [
    linhaLog(AGORA - 3000, 'api_request', pedidoSub),
    linhaLog(AGORA - 2000, 'api_request', { ...PEDIDO, model: S('claude-haiku-5'), 'prompt.id': S('p-2') }),
    linhaLog(AGORA - 1000, 'tool_result', { 'prompt.id': S('p-1'), success: S('true'), tool_name: S('Bash') }),
    '',
  ].join('\n'));
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.deepEqual(r.registros.at(-1), {
    t: 'ferramenta', em: AGORA - 1000, modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'sub:general-purpose', ok: true,
  });
  assert.equal(r.registros.length, 3);
  assert.doesNotMatch(JSON.stringify(r.registros), /p-1|p-2|Bash/);
});

test('M2: com dois api_request do mesmo prompt.id, o tool_result herda do último', () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, ARQ_TELEMETRIA), [
    linhaLog(AGORA - 3000, 'api_request', { ...PEDIDO, model: S('claude-haiku-5'), effort: S('low'), 'prompt.id': S('p-1') }),
    linhaLog(AGORA - 2000, 'api_request', { ...PEDIDO, 'prompt.id': S('p-1') }),
    linhaLog(AGORA - 1000, 'tool_result', { 'prompt.id': S('p-1'), success: S('false') }),
    '',
  ].join('\n'));
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.deepEqual(r.registros.map((x) => x.modelo), ['claude-haiku-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(r.registros.at(-1), {
    t: 'ferramenta', em: AGORA - 1000, modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', ok: false,
  });
});

test('M2: tool_result sem model e sem api_request par na mesma leitura é descartado', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaLog(AGORA - 2000, 'api_request', { ...PEDIDO, 'prompt.id': S('p-1') })}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r1.registros.length, 1);
  fs.appendFileSync(arq, [
    linhaLog(AGORA - 1000, 'tool_result', { 'prompt.id': S('p-1'), success: S('true') }),
    linhaLog(AGORA - 900, 'tool_result', { 'prompt.id': S('p-outro'), success: S('false') }),
    linhaLog(AGORA - 800, 'tool_result', { success: S('false') }),
    '',
  ].join('\n'));
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros, []);
  assert.equal(r2.corrompido, false);
});

test('Emenda A2: o nome rotacionado medido casa ROTACIONADO', () => {
  assert.match('telemetria-2026-10-01T21-31-30.026-size.jsonl', ROTACIONADO);
  assert.doesNotMatch('telemetria.jsonl', ROTACIONADO);
  assert.doesNotMatch('outro-2026.jsonl', ROTACIONADO);
});

test('lerNovos: lê só linhas completas, avança o cursor e não relê', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 3000)}\n${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000).slice(0, 50)}`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r1.registros.length, 2);
  assert.equal(r1.corrompido, false);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 3000)}\n${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros, [esperadoPedido(AGORA - 1000)]);
  const r3 = lerNovos({ pasta: d, cursor: r2.cursor, agoraMs: AGORA });
  assert.deepEqual(r3.registros, []);
  assert.deepEqual(r3.cursor, r2.cursor);
});

test('Foco de revisão 2: rotação entre dois passos não perde nem repete linha', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 5000)}\n${linhaPedido(AGORA - 4000)}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r1.registros.length, 2);
  fs.appendFileSync(arq, `${linhaPedido(AGORA - 3000)}\n`);
  fs.renameSync(arq, path.join(d, 'telemetria-2026-10-08T14-59-00.000.jsonl'));
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros.map((x) => x.em), [AGORA - 3000, AGORA - 2000]);
  const r3 = lerNovos({ pasta: d, cursor: r2.cursor, agoraMs: AGORA });
  assert.deepEqual(r3.registros, []);
});

test('arquivo truncado (menor que o cursor) é lido do começo', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 5000)}\n${linhaPedido(AGORA - 4000)}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 1000)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros.map((x) => x.em), [AGORA - 1000]);
});

test('§6: linha corrompida e linha acima de 1 MiB são ignoradas, o resto é lido e o cursor avança', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `{quebrado\n${'x'.repeat(1024 * 1024 + 10)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r.corrompido, true);
  assert.deepEqual(r.registros.map((x) => x.em), [AGORA - 1000]);
  assert.equal(r.cursor.pos, fs.statSync(arq).size);
});

test('§6: bytes novos acima do teto: nada é lido e o cursor pula para o fim', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA, maxBytes: 100 });
  assert.equal(r.corrompido, true);
  assert.deepEqual(r.registros, []);
  assert.equal(r.cursor.pos, fs.statSync(arq).size);
});

test('Emenda A2: arquivo ainda aberto por quem escreve é lido pelo conteúdo', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  const fd = fs.openSync(arq, 'a');
  try {
    fs.writeSync(fd, `${linhaPedido(AGORA - 2000)}\n`);
    const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
    assert.deepEqual(r1.registros.map((x) => x.em), [AGORA - 2000]);
    fs.writeSync(fd, `${linhaPedido(AGORA - 1000)}\n`);
    const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
    assert.deepEqual(r2.registros.map((x) => x.em), [AGORA - 1000]);
  } finally {
    fs.closeSync(fd);
  }
});

test('arquivo ausente: nada lido, cursor igual; link no lugar: corrompido, nada seguido', (t) => {
  const d = novoDir();
  assert.deepEqual(lerNovos({ pasta: d, cursor: null, agoraMs: AGORA }), { registros: [], cursor: null, corrompido: false });
  const alvo = path.join(d, 'alvo.jsonl');
  fs.writeFileSync(alvo, `${linhaPedido(AGORA - 1000)}\n`);
  try {
    fs.symlinkSync(alvo, path.join(d, ARQ_TELEMETRIA));
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link neste Windows'); return; }
    throw e;
  }
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r.corrompido, true);
  assert.deepEqual(r.registros, []);
});

test('cursor forjado (posição negativa, ino que não é número) é ignorado', () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, ARQ_TELEMETRIA), `${linhaPedido(AGORA - 1000)}\n`);
  const r = lerNovos({ pasta: d, cursor: { ino: '__proto__', pos: -5 }, agoraMs: AGORA });
  assert.equal(r.registros.length, 1);
});

// Revisão da Task 2: com o ino real, só a posição decide. Negativa ou além do
// fim, a leitura recomeça do início e traz todos os registros.
test('cursor com o ino real e posição negativa ou além do fim: leitura recomeça do início', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const ino = String(fs.lstatSync(arq, { bigint: true }).ino);
  const tamanho = fs.statSync(arq).size;
  for (const pos of [-5, tamanho + 100]) {
    const r = lerNovos({ pasta: d, cursor: { ino, pos }, agoraMs: AGORA });
    assert.deepEqual(r.registros, [esperadoPedido(AGORA - 2000), esperadoPedido(AGORA - 1000)], `pos ${pos}`);
    assert.deepEqual(r.cursor, { ino, pos: tamanho }, `pos ${pos}`);
    assert.equal(r.corrompido, false);
  }
});

// Portão v0.4.0, I-2: se o arquivo não abre, o tamanho vem da listagem, que
// no Windows com o Collector vivo é 0. Um tamanho da listagem menor que o
// cursor não é truncamento: o cursor fica e nada é relido.
test('abertura falhou e a listagem mostra 0: o cursor fica, nada é reagregado', (t) => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r1.registros.length, 2);
  const lstatReal = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, o) => {
    const real = lstatReal(p, o);
    return p === arq && real ? Object.assign(Object.create(Object.getPrototypeOf(real)), real, { size: 0n }) : real;
  });
  const openReal = fs.openSync;
  t.mock.method(fs, 'openSync', (p, ...a) => {
    if (p === arq) throw Object.assign(new Error('ocupado'), { code: 'EBUSY' });
    return openReal(p, ...a);
  });
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros, []);
  assert.deepEqual(r2.cursor, r1.cursor);
  t.mock.restoreAll();
  fs.appendFileSync(arq, `${linhaPedido(AGORA - 500)}\n`);
  const r3 = lerNovos({ pasta: d, cursor: r2.cursor, agoraMs: AGORA });
  assert.deepEqual(r3.registros.map((x) => x.em), [AGORA - 500]);
});

test('truncamento visto pelo descritor ainda relê do começo', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 500)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros.map((x) => x.em), [AGORA - 500]);
});

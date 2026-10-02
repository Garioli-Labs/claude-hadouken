import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aplicarDesligar, aplicarLigar, assinaturaSettings, CHAVES_LIGAR, consultarDesligar, consultarLigar, ENDPOINT,
  interruptorLigado, planejarDesligar, planejarLigar,
} from '../src/aprendizado/settings-env.js';
import { lerSettings } from '../src/configuracao.js';

// O `env` do settings.json (spec aprendizado §3.2, §8 "Ligar e desligar";
// Foco de revisão 1). Todo settings.json é temporário: nenhum teste toca o
// ~/.claude/settings.json de verdade.

const BOM = String.fromCodePoint(0xfeff);
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const dirs = [];
after(() => {
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) { try { fs.chmodSync(path.join(d, f), 0o644); } catch { /* link */ } }
    fs.rmSync(d, { recursive: true, force: true });
  }
});
function novoArquivo(conteudo) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk settings ç '));
  dirs.push(d);
  const arq = path.join(d, 'settings.json');
  if (conteudo !== undefined) fs.writeFileSync(arq, conteudo);
  return arq;
}
const esperadoDe = (arq) => assinaturaSettings(lerSettings(arq));
const ligadoDe = (r) => ({ chaves: r.adicionadas, criouEnv: r.criouEnv });

test('interruptores: só vazio, 0, false, no e off contam como desligado', () => {
  for (const v of [undefined, null, '', '0', 'false', 'FALSE', 'no', 'off', ' 0 ']) assert.equal(interruptorLigado(v), false, String(v));
  for (const v of ['1', 'true', 'yes', 'on', 1, true]) assert.equal(interruptorLigado(v), true, String(v));
});

test('planejarLigar: env que não é objeto é recusado', () => {
  for (const env of ['OTEL=1', ['a'], null, 7]) assert.deepEqual(planejarLigar({ env }, {}), { ok: false, motivo: 'env-invalido' });
});

test('§3.2 passo 5: conteúdo ligado no env ou no ambiente, ou outro endpoint, é recusado', () => {
  assert.deepEqual(planejarLigar({ env: { OTEL_LOG_USER_PROMPTS: '1' } }, {}), { ok: false, motivo: 'conteudo-ligado' });
  assert.deepEqual(planejarLigar({}, { OTEL_LOG_RAW_API_BODIES: 'true' }), { ok: false, motivo: 'conteudo-ligado' });
  assert.deepEqual(planejarLigar({}, { OTEL_LOG_TOOL_DETAILS: 'yes' }), { ok: false, motivo: 'conteudo-ligado' });
  assert.equal(planejarLigar({ env: { OTEL_LOG_USER_PROMPTS: '0' } }, {}).ok, true);
  assert.deepEqual(planejarLigar({ env: { OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://coletor.exemplo' } }, {}), { ok: false, motivo: 'outro-endpoint' });
  assert.deepEqual(planejarLigar({}, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://10.0.0.5:4318' }), { ok: false, motivo: 'outro-endpoint' });
  assert.equal(planejarLigar({}, { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT }).ok, true, 'o nosso endpoint no ambiente é o de uma sessão já ligada');
  assert.deepEqual(planejarLigar({ env: { OTEL_METRICS_EXPORTER: 'console' } }, {}), { ok: false, motivo: 'env-conflito' });
});

test('planejarLigar: chave que já está com o mesmo valor não entra (e o desligar não a tira)', () => {
  const p = planejarLigar({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: 1 } }, {});
  assert.equal(p.ok, true);
  assert.equal(p.criaEnv, false);
  assert.deepEqual(p.adicionar, Object.keys(CHAVES_LIGAR).filter((k) => k !== 'CLAUDE_CODE_ENABLE_TELEMETRY'));
  assert.deepEqual(planejarLigar({}, {}).adicionar, Object.keys(CHAVES_LIGAR));
  assert.equal(planejarLigar({}, {}).criaEnv, true);
});

test('Foco de revisão 1: CRLF, BOM, tabulação e chaves do usuário antes e depois; desligar volta byte a byte', () => {
  const original = {
    permissions: { allow: ['Bash(ls)'] },
    env: { MINHA: 'x', OUTRA: 'y' },
    statusLine: { type: 'command', command: 'node "C:/x/statusline.mjs"', padding: 0 },
    zeta: 1,
  };
  const texto = `${BOM}${JSON.stringify(original, null, '\t').replace(/\n/g, '\r\n')}\r\n`;
  const arq = novoArquivo(texto);
  const antes = fs.readFileSync(arq);
  const c = consultarLigar({ arquivo: arq, ambiente: {} });
  assert.equal(c.ok, true);
  assert.deepEqual(fs.readFileSync(arq), antes, 'consultar não grava');
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: c.assinatura });
  assert.equal(r.ok, true);
  assert.equal(r.backup, `${arq}.bak-hadouken-${AGORA}`);
  assert.deepEqual(fs.readFileSync(r.backup), antes, 'a cópia é o original');
  const depois = fs.readFileSync(arq, 'utf8');
  assert.ok(depois.startsWith(BOM));
  assert.doesNotMatch(depois.replace(/\r\n/g, ''), /\n/, 'só CRLF');
  assert.match(depois, /\r\n\t"env": \{\r\n\t\t"MINHA": "x",/);
  const v = JSON.parse(depois.slice(1));
  assert.deepEqual(Object.keys(v), ['permissions', 'env', 'statusLine', 'zeta']);
  assert.deepEqual(Object.keys(v.env), ['MINHA', 'OUTRA', ...Object.keys(CHAVES_LIGAR)]);
  assert.deepEqual(r.adicionadas, CHAVES_LIGAR);
  assert.equal(r.criouEnv, false);
  const d = aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) });
  assert.equal(d.ok, true);
  assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR));
  assert.deepEqual(fs.readFileSync(arq), antes, 'desligar devolve os bytes do original');
});

test('sem env: o ligar cria o env no fim e o desligar o tira inteiro', () => {
  const texto = '{\n  "model": "opus"\n}\n';
  const arq = novoArquivo(texto);
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) });
  assert.equal(r.criouEnv, true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(arq, 'utf8'))), ['model', 'env']);
  assert.equal(aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) }).ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), texto);
});

test('arquivo ausente: o ligar cria só o env; esperado "ausente"', () => {
  const arq = novoArquivo();
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: 'ausente' });
  assert.equal(r.ok, true);
  assert.equal(r.backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), { env: CHAVES_LIGAR });
});

test('desligar tira só as chaves com o valor que o ligar gravou; chave nova do usuário fica no lugar', () => {
  const arq = novoArquivo('{\n  "env": {\n    "MINHA": "x"\n  }\n}\n');
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) });
  const v = JSON.parse(fs.readFileSync(arq, 'utf8'));
  v.env.OTEL_LOGS_EXPORTER = 'console';
  v.env.DEPOIS = 'z';
  fs.writeFileSync(arq, `${JSON.stringify(v, null, 2)}\n`);
  const d = aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) });
  assert.equal(d.ok, true);
  assert.ok(!d.removidas.includes('OTEL_LOGS_EXPORTER'));
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).env, { MINHA: 'x', OTEL_LOGS_EXPORTER: 'console', DEPOIS: 'z' });
  assert.deepEqual(planejarDesligar({ env: 'x' }, ligadoDe(r)), { remover: [], removeEnv: false });
});

test('§6 última linha: settings.json mudou entre a prévia e a gravação → recusa sem gravar', () => {
  const arq = novoArquivo('{}\n');
  const esperado = esperadoDe(arq);
  fs.writeFileSync(arq, '{"model":"opus"}\n');
  const antes = fs.readFileSync(arq);
  assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado }), { ok: false, motivo: 'settings-mudou' });
  assert.deepEqual(fs.readFileSync(arq), antes);
  assert.equal(fs.readdirSync(path.dirname(arq)).length, 1, 'nem cópia nem temporário');
});

test('somente leitura e link são recusados sem gravar', (t) => {
  const arq = novoArquivo('{}\n');
  fs.chmodSync(arq, 0o444);
  assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) }), { ok: false, motivo: 'settings-somente-leitura' });
  fs.chmodSync(arq, 0o644);
  const link = path.join(path.dirname(arq), 'link.json');
  try {
    fs.symlinkSync(arq, link);
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link'); return; }
    throw e;
  }
  assert.deepEqual(consultarLigar({ arquivo: link, ambiente: {} }), { ok: false, motivo: 'settings-link' });
});

// O caso do link acima sai como skip no Windows sem modo de desenvolvedor; o
// hard link não pede permissão e passa pela mesma recusa do gravador da barra.
test('hard link é recusado como link no consultar, no ligar e no desligar, sem gravar', () => {
  const arq = novoArquivo('{\n  "env": {}\n}\n');
  fs.linkSync(arq, path.join(path.dirname(arq), 'outro.json'));
  const LINK = { ok: false, motivo: 'settings-link' };
  assert.deepEqual(consultarLigar({ arquivo: arq, ambiente: {} }), LINK);
  assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: 'ausente' }), LINK);
  assert.deepEqual(aplicarDesligar({ arquivo: arq, agoraMs: AGORA, ligado: { chaves: CHAVES_LIGAR, criouEnv: true } }), LINK);
  assert.deepEqual(fs.readdirSync(path.dirname(arq)).sort(), ['outro.json', 'settings.json']);
});

test('desligar em settings.json somente leitura recusa sem gravar', () => {
  const arq = novoArquivo();
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: 'ausente' });
  assert.equal(r.ok, true);
  const antes = fs.readFileSync(arq);
  fs.chmodSync(arq, 0o444);
  assert.deepEqual(aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) }), { ok: false, motivo: 'settings-somente-leitura' });
  assert.deepEqual(fs.readFileSync(arq), antes);
  assert.equal(fs.readdirSync(path.dirname(arq)).length, 1, 'nem cópia nem temporário');
});

// Mesmas regras de argumento da barra (configuracao.js, arquivoDe e agoraDe):
// o arquivo é caminho absoluto, não vazio e sem NUL; agoraMs entra no nome da
// cópia, então é inteiro seguro não negativo. Opções ausentes ou nulas não
// lançam.
test('argumentos: caminho que não é absoluto ou agoraMs inválido são recusados sem gravar, e nada lança', () => {
  const arq = novoArquivo('{\n  "env": {\n    "MINHA": "x"\n  }\n}\n');
  const antes = fs.readFileSync(arq);
  const esperado = esperadoDe(arq);
  const ligado = { chaves: CHAVES_LIGAR, criouEnv: false };
  const ARGUMENTOS = { ok: false, motivo: 'argumentos' };
  for (const arquivo of [undefined, '', 'settings.json', `${arq}\0`, 7]) {
    const nome = JSON.stringify(arquivo) ?? 'undefined';
    assert.deepEqual(consultarLigar({ arquivo, ambiente: {} }), ARGUMENTOS, nome);
    assert.deepEqual(aplicarLigar({ arquivo, agoraMs: AGORA, ambiente: {}, esperado }), ARGUMENTOS, nome);
    assert.deepEqual(aplicarDesligar({ arquivo, agoraMs: AGORA, ligado }), ARGUMENTOS, nome);
    assert.deepEqual(consultarDesligar({ arquivo, ligado }), ARGUMENTOS, nome);
  }
  for (const agoraMs of [undefined, -1, 1.5, Number.NaN, '1', 2 ** 53]) {
    assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs, ambiente: {}, esperado }), ARGUMENTOS, String(agoraMs));
    assert.deepEqual(aplicarDesligar({ arquivo: arq, agoraMs, ligado }), ARGUMENTOS, String(agoraMs));
  }
  for (const opcoes of [undefined, null, 7]) {
    assert.deepEqual(consultarLigar(opcoes), ARGUMENTOS, String(opcoes));
    assert.deepEqual(aplicarLigar(opcoes), ARGUMENTOS, String(opcoes));
    assert.deepEqual(aplicarDesligar(opcoes), ARGUMENTOS, String(opcoes));
    assert.deepEqual(consultarDesligar(opcoes), ARGUMENTOS, String(opcoes));
  }
  assert.deepEqual(fs.readFileSync(arq), antes);
  assert.equal(fs.readdirSync(path.dirname(arq)).length, 1, 'nem cópia nem temporário');
});

test('planejarLigar não lança com valor que não vira texto: recusa', () => {
  const semTexto = Object.create(null);
  assert.deepEqual(planejarLigar({ env: { OTEL_METRICS_EXPORTER: semTexto } }, {}), { ok: false, motivo: 'env-conflito' });
  assert.deepEqual(planejarLigar({}, { OTEL_EXPORTER_OTLP_ENDPOINT: semTexto }), { ok: false, motivo: 'outro-endpoint' });
  assert.equal(interruptorLigado(semTexto), true);
});

// Rodada 1 (revisão da Task 9, Important 1): no Windows o nome de variável de
// ambiente não diferencia caixa, então `otel_log_user_prompts` no env do
// settings.json (ou no ambiente) liga o mesmo interruptor. Toda variante de
// caixa conta; basta uma ligada, ou com outro endpoint, para recusar.
const CONTEUDO = { ok: false, motivo: 'conteudo-ligado' };
const OUTRO = { ok: false, motivo: 'outro-endpoint' };
const CONFLITO = { ok: false, motivo: 'env-conflito' };

test('variante de caixa no env ou no ambiente: conteúdo ligado ou outro endpoint recusa', () => {
  assert.deepEqual(planejarLigar({ env: { otel_log_user_prompts: '1' } }, {}), CONTEUDO);
  assert.deepEqual(planejarLigar({ env: { Otel_Log_Tool_Details: 'true' } }, {}), CONTEUDO);
  assert.deepEqual(planejarLigar({}, { otel_log_raw_api_bodies: 'yes' }), CONTEUDO);
  assert.deepEqual(planejarLigar({}, { oTeL_lOg_UsEr_PrOmPtS: 'on' }), CONTEUDO);
  assert.deepEqual(planejarLigar({ env: { OTEL_LOG_USER_PROMPTS: '0', otel_log_user_prompts: '1' } }, {}), CONTEUDO, 'uma variante ligada basta');
  assert.deepEqual(planejarLigar({ env: { OTEL_LOG_TOOL_DETAıLS: '1' } }, {}), CONTEUDO, 'ı vira I no toUpperCase: recusa a mais, nunca a menos');
  assert.equal(planejarLigar({ env: { otel_log_user_prompts: '0' } }, { otel_log_tool_details: 'off' }).ok, true);
  assert.deepEqual(planejarLigar({ env: { otel_exporter_otlp_endpoint: 'http://10.0.0.5:4318' } }, {}), OUTRO);
  assert.deepEqual(planejarLigar({ env: { Otel_Exporter_Otlp_Logs_Endpoint: 'https://coletor.exemplo' } }, {}), OUTRO);
  assert.deepEqual(planejarLigar({}, { otel_exporter_otlp_traces_endpoint: 'https://coletor.exemplo' }), OUTRO);
  assert.deepEqual(planejarLigar({}, { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, otel_exporter_otlp_endpoint: 'http://x:1' }), OUTRO);
  assert.equal(planejarLigar({}, { otel_exporter_otlp_endpoint: ENDPOINT }).ok, true, 'o nosso endpoint em outra caixa não recusa');
});

test('variante de caixa de uma chave nossa: outro valor é conflito; o mesmo valor conta como a chave e nunca vira duplicata', () => {
  assert.deepEqual(planejarLigar({ env: { otel_metrics_exporter: 'console' } }, {}), CONFLITO);
  assert.deepEqual(planejarLigar({ env: { OTEL_METRICS_EXPORTER: 'otlp', Otel_Metrics_Exporter: 'console' } }, {}), CONFLITO);
  const p = planejarLigar({ env: { otel_metrics_exporter: 'otlp', Otel_Exporter_Otlp_Endpoint: ENDPOINT } }, {});
  assert.equal(p.ok, true);
  assert.deepEqual(p.adicionar, Object.keys(CHAVES_LIGAR).filter((k) => k !== 'OTEL_METRICS_EXPORTER' && k !== 'OTEL_EXPORTER_OTLP_ENDPOINT'));
  // De ponta a ponta: o ligar não grava OTEL_METRICS_EXPORTER ao lado da
  // variante do usuário, e o desligar não a tira (não é nossa).
  const original = '{\n  "env": {\n    "otel_metrics_exporter": "otlp"\n  }\n}\n';
  const arq = novoArquivo(original);
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) });
  assert.equal(r.ok, true);
  assert.equal(Object.hasOwn(r.adicionadas, 'OTEL_METRICS_EXPORTER'), false);
  const env = JSON.parse(fs.readFileSync(arq, 'utf8')).env;
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'OTEL_METRICS_EXPORTER'), ['otel_metrics_exporter']);
  const d = aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) });
  assert.equal(d.ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), original);
});

// Rodada 1, Minor 1: spec §6 última linha também no desligar. Em dois
// tempos, como o ligar: consultarDesligar devolve o plano e a assinatura sem
// gravar; aplicarDesligar com `esperado` recusa se o arquivo mudou. Sem
// `esperado` (undefined), o comportamento é o de antes.
const MUDOU = { ok: false, motivo: 'settings-mudou' };

test('consultarDesligar não grava; aplicarDesligar com esperado diferente recusa sem gravar; com o certo desliga', () => {
  const arq = novoArquivo('{\n  "env": {\n    "MINHA": "x"\n  }\n}\n');
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) });
  const ligado = ligadoDe(r);
  const ligadoBytes = fs.readFileSync(arq);
  const c = consultarDesligar({ arquivo: arq, ligado });
  assert.deepEqual(c, { ok: true, assinatura: esperadoDe(arq), remover: Object.keys(CHAVES_LIGAR), removeEnv: false });
  assert.deepEqual(fs.readFileSync(arq), ligadoBytes, 'consultar não grava');
  const v = JSON.parse(ligadoBytes.toString('utf8'));
  v.model = 'opus';
  fs.writeFileSync(arq, `${JSON.stringify(v, null, 2)}\n`);
  const mudado = fs.readFileSync(arq);
  const nomes = fs.readdirSync(path.dirname(arq)).sort();
  assert.deepEqual(aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado, esperado: c.assinatura }), MUDOU);
  assert.deepEqual(aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado, esperado: null }), MUDOU, 'só undefined é "sem esperado"');
  assert.deepEqual(fs.readFileSync(arq), mudado);
  assert.deepEqual(fs.readdirSync(path.dirname(arq)).sort(), nomes, 'nem cópia nem temporário');
  const c2 = consultarDesligar({ arquivo: arq, ligado });
  const d = aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 2, ligado, esperado: c2.assinatura });
  assert.equal(d.ok, true);
  assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR));
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), { env: { MINHA: 'x' }, model: 'opus' });
});

test('consultarDesligar: arquivo ausente, nada a tirar, somente leitura e env criado pelo ligar', () => {
  const ausente = novoArquivo();
  const ligado = { chaves: CHAVES_LIGAR, criouEnv: true };
  assert.deepEqual(consultarDesligar({ arquivo: ausente, ligado }), { ok: true, assinatura: 'ausente', remover: [], removeEnv: false });
  assert.deepEqual(aplicarDesligar({ arquivo: ausente, agoraMs: AGORA, ligado, esperado: 'ausente' }), { ok: true, removidas: [], backup: null });
  assert.deepEqual(aplicarDesligar({ arquivo: ausente, agoraMs: AGORA, ligado, esperado: 'a'.repeat(64) }), MUDOU, 'mudou mesmo sem nada a tirar');
  const arq = novoArquivo();
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: 'ausente' });
  assert.deepEqual(consultarDesligar({ arquivo: arq, ligado: ligadoDe(r) }), {
    ok: true, assinatura: esperadoDe(arq), remover: Object.keys(CHAVES_LIGAR), removeEnv: true,
  });
  fs.chmodSync(arq, 0o444);
  assert.deepEqual(consultarDesligar({ arquivo: arq, ligado: ligadoDe(r) }), { ok: false, motivo: 'settings-somente-leitura' });
  assert.deepEqual(consultarDesligar({ arquivo: arq, ligado: { chaves: {}, criouEnv: false } }), {
    ok: true, assinatura: esperadoDe(arq), remover: [], removeEnv: false,
  }, 'sem nada a tirar, somente leitura não impede');
});

// Rodada 1, Minor 3: assinaturaSettings nunca lança. Sem arquivo é
// 'ausente'; `existe` sem bytes Buffer (o lerSettings nunca dá) é 'invalida',
// que não é hex nem 'ausente' e nunca casa com a assinatura de uma prévia.
test('assinaturaSettings: ausente, invalida ou o SHA-256 dos bytes, sem lançar', () => {
  for (const lido of [undefined, null, 7, { ok: true, existe: false, info: null }]) assert.equal(assinaturaSettings(lido), 'ausente', String(lido));
  for (const lido of [{ existe: true }, { existe: true, bytes: '{}' }, { existe: true, bytes: [1, 2] }]) {
    assert.equal(assinaturaSettings(lido), 'invalida', JSON.stringify(lido));
  }
  const arq = novoArquivo('{}\n');
  assert.equal(esperadoDe(arq), crypto.createHash('sha256').update('{}\n').digest('hex'));
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aplicarDesligar, aplicarLigar, assinaturaSettings, CHAVES_LIGAR, consultarLigar, ENDPOINT, interruptorLigado,
  planejarDesligar, planejarLigar,
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
  }
  for (const agoraMs of [undefined, -1, 1.5, Number.NaN, '1', 2 ** 53]) {
    assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs, ambiente: {}, esperado }), ARGUMENTOS, String(agoraMs));
    assert.deepEqual(aplicarDesligar({ arquivo: arq, agoraMs, ligado }), ARGUMENTOS, String(agoraMs));
  }
  for (const opcoes of [undefined, null, 7]) {
    assert.deepEqual(consultarLigar(opcoes), ARGUMENTOS, String(opcoes));
    assert.deepEqual(aplicarLigar(opcoes), ARGUMENTOS, String(opcoes));
    assert.deepEqual(aplicarDesligar(opcoes), ARGUMENTOS, String(opcoes));
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

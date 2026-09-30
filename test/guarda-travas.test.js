import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARQ_GUARDA, travasVazias, travasValidas, lerTravas, unirTravas, gravarTravas, limparTravas,
} from '../src/guarda/travas.js';

const dirs = [];
const novo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-trava-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const agora = Date.UTC(2026, 8, 29, 6, 0);
const agoraS = agora / 1000;
const iso = (ms) => new Date(ms).toISOString();
const trava = (gatilho, resets_at) => ({ resets_at, gatilho, desde: iso(agora - 60_000) });

test('arquivo ausente: vazias; gravar cria; ler devolve o gravado', () => {
  const d = novo();
  assert.deepEqual(lerTravas(d, agora), { estado: 'ausente', travas: travasVazias() });
  const r = gravarTravas(d, { seven_day: trava('G2', agoraS + 86_400) }, agora);
  assert.deepEqual(r, { ok: true, gravou: true });
  const lido = lerTravas(d, agora);
  assert.equal(lido.estado, 'ok');
  assert.deepEqual(lido.travas.seven_day, trava('G2', agoraS + 86_400));
  assert.equal(lido.travas.five_hour, null);
});

// Grava só na transição (spec §5.3): sem trava nova (nenhuma, ou só uma já
// vencida), o arquivo ausente continua ausente.
test('arquivo ausente e nada novo: não cria o arquivo', () => {
  const d = novo();
  assert.deepEqual(gravarTravas(d, {}, agora), { ok: true, gravou: false });
  assert.deepEqual(gravarTravas(d, { five_hour: trava('G3', agoraS - 1) }, agora), { ok: true, gravou: false });
  assert.equal(fs.existsSync(path.join(d, ARQ_GUARDA)), false);
});

test('união: a trava existente fica; a nova entra; sem mudança, sem gravação', () => {
  const d = novo();
  gravarTravas(d, { seven_day: trava('G2', agoraS + 86_400) }, agora);
  const r = gravarTravas(d, { seven_day: trava('G4', agoraS + 86_400), fable: trava('G6', null) }, agora);
  assert.equal(r.gravou, true);
  const t = lerTravas(d, agora).travas;
  assert.equal(t.seven_day.gatilho, 'G2');
  assert.equal(t.fable.gatilho, 'G6');
  assert.deepEqual(gravarTravas(d, { fable: trava('G6', null) }, agora), { ok: true, gravou: false });
});

test('trava com reset vencido cai na leitura', () => {
  const d = novo();
  gravarTravas(d, { five_hour: trava('G3', agoraS + 60) }, agora);
  assert.equal(lerTravas(d, agora + 61_000).travas.five_hour, null);
});

test('ilegível (JSON quebrado, grande, pasta, link, esquema errado) é fail-closed e não é sobrescrito', () => {
  const casos = [
    (arq) => fs.writeFileSync(arq, '{'),
    (arq) => fs.writeFileSync(arq, JSON.stringify({ v: 1, travas: {}, x: 'y'.repeat(20_000) })),
    (arq) => fs.mkdirSync(arq),
    (arq) => fs.writeFileSync(arq, JSON.stringify({ v: 2, travas: {} })),
    (arq) => fs.writeFileSync(arq, JSON.stringify({ v: 1, travas: { seven_day: { gatilho: 'G9', resets_at: null, desde: iso(agora) } } })),
  ];
  for (const estragar of casos) {
    const d = novo();
    const arq = path.join(d, ARQ_GUARDA);
    estragar(arq);
    assert.equal(lerTravas(d, agora).estado, 'ilegivel');
    assert.deepEqual(gravarTravas(d, { seven_day: trava('G2', agoraS + 60) }, agora), { ok: false, motivo: 'ilegivel', gravou: false });
    assert.equal(lerTravas(d, agora).estado, 'ilegivel');
  }
});

// Spec §4.5: trocar a trava por um link nunca a solta. O link não é seguido
// nem na leitura nem na gravação (o alvo fica intacto); só a liberação
// (limparTravas) o troca por um arquivo regular, pela renomeação atômica,
// que substitui o link e não escreve no alvo.
test('link simbólico no lugar do arquivo é ilegível, e só a liberação o substitui', (t) => {
  const d = novo();
  const alvo = path.join(d, 'alvo.json');
  const conteudo = JSON.stringify({ v: 1, travas: {} });
  fs.writeFileSync(alvo, conteudo);
  const arq = path.join(d, ARQ_GUARDA);
  try { fs.symlinkSync(alvo, arq); } catch { t.skip('sem permissão para criar link'); return; }
  assert.equal(lerTravas(d, agora).estado, 'ilegivel');
  assert.deepEqual(gravarTravas(d, { seven_day: trava('G2', agoraS + 60) }, agora), { ok: false, motivo: 'ilegivel', gravou: false });
  assert.equal(fs.lstatSync(arq).isSymbolicLink(), true);
  assert.deepEqual(limparTravas(d, ['seven_day'], agora), { ok: true });
  assert.equal(fs.lstatSync(arq).isFile(), true);
  assert.equal(lerTravas(d, agora).estado, 'ok');
  assert.equal(fs.readFileSync(alvo, 'utf8'), conteudo);
});

// Spec §4.5: "trava existente mas ilegível" conta como disparada. Um arquivo
// presente que não abre (sem permissão de leitura, preso por outro processo
// no Windows) é ilegível, nunca ausente: senão um chmod soltaria a guarda.
// Sem como tirar a leitura (Windows, root), o teste sai como skip.
test('arquivo presente que não abre é ilegível, não ausente', (t) => {
  const d = novo();
  const arq = path.join(d, ARQ_GUARDA);
  gravarTravas(d, { seven_day: trava('G2', agoraS + 86_400) }, agora);
  fs.chmodSync(arq, 0o000);
  try {
    let abre = true;
    try { fs.readFileSync(arq); } catch { abre = false; }
    if (abre) { t.skip('sem como tirar a permissão de leitura aqui'); return; }
    assert.equal(lerTravas(d, agora).estado, 'ilegivel');
    assert.deepEqual(gravarTravas(d, { fable: trava('G6', null) }, agora), { ok: false, motivo: 'ilegivel', gravou: false });
  } finally {
    fs.chmodSync(arq, 0o600);
  }
});

test('limparTravas limpa as chaves pedidas e regrava mesmo um arquivo ilegível', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, ARQ_GUARDA), '{');
  assert.deepEqual(limparTravas(d, ['five_hour', 'seven_day'], agora), { ok: true });
  assert.equal(lerTravas(d, agora).estado, 'ok');
  gravarTravas(d, { seven_day: trava('G2', agoraS + 60), fable: trava('G6', null) }, agora);
  limparTravas(d, ['seven_day'], agora);
  const t = lerTravas(d, agora).travas;
  assert.equal(t.seven_day, null);
  assert.equal(t.fable.gatilho, 'G6');
});

test('travasValidas reconstrói só os campos conhecidos, sem protótipo herdado', () => {
  const v = JSON.parse(`{"v":1,"travas":{"__proto__":{"x":1},"seven_day":{"gatilho":"G2","resets_at":${agoraS + 60},"desde":"${iso(agora)}","extra":"texto"}}}`);
  const t = travasValidas(v, agora);
  assert.deepEqual(Object.keys(t).sort(), ['fable', 'fable-despachos', 'five_hour', 'seven_day']);
  assert.deepEqual(t.seven_day, { resets_at: agoraS + 60, gatilho: 'G2', desde: iso(agora) });
  assert.equal(unirTravas(travasVazias(), t).seven_day.gatilho, 'G2');
  assert.equal(travasValidas(null, agora), null);
});

// Não é um teste de corrida: gravarTravas lê, une e renomeia sem trava de
// arquivo, e o desenho (S21) aceita perder uma gravação concorrente, porque a
// condição continua valendo e a avaliação seguinte a grava de novo. Aqui só
// se confere a união entre gravações sucessivas.
test('gravações sucessivas com travas diferentes somam pela união (S21)', () => {
  const d = novo();
  gravarTravas(d, { five_hour: trava('G3', agoraS + 600) }, agora);
  gravarTravas(d, { seven_day: trava('G4', agoraS + 86_400) }, agora);
  const t = lerTravas(d, agora).travas;
  assert.ok(t.five_hour && t.seven_day);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { avaliarGuarda, CHAVES_MOTIVO } from '../src/guarda/avaliar.js';
import { ARQ_GUARDA, GUARDA_MAX_BYTES, lerTravas, gravarTravas } from '../src/guarda/travas.js';
import { gravarLiberacao, montarLiberacao, lerPedido } from '../src/guarda/liberacao.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';
import { registrarDespachoFable, lerEventos, gravarModeloSessao } from '../src/guarda/registros.js';

// Avaliador central da guarda (spec v0.4.0 §4.1, §4.5 e §5.3). Cada teste
// numa pasta temporária própria; nada toca ~/.claude/hadouken.

const dirs = [];
const novo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-aval-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const H = 3_600_000;
const agora = Date.UTC(2026, 8, 29, 6, 0);
const agoraS = agora / 1000;
const iso = (ms) => new Date(ms).toISOString();

// estado.json no formato validado por validarEstado (versão 1).
function gravarEstado(d, { u5 = 20, u7 = 40, lidoHa = 0, historico = [], sessoes = {} } = {}) {
  const at = iso(agora - lidoHa);
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: u5, resets_at: agoraS + 3 * 3600, at },
    seven_day: { used_percentage: u7, resets_at: agoraS + 4 * 86_400, at },
    sessoes, historico,
  }));
}
const liberar = (d, args, usado7d) => gravarLiberacao(d, montarLiberacao({
  pedido: lerPedido(args, PADRAO_GUARDA), agoraMs: agora, usado7d, travas: lerTravas(d, agora).travas,
  config: PADRAO_GUARDA, sessionId: 's', id: 'abcdef01',
}));
const disparos = (d) => lerEventos(d, agora + H).filter((e) => e.tipo === 'disparo').length;

test('sem estado: sem-leitura; tudo abaixo: armada', () => {
  const d = novo();
  assert.equal(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).status, 'sem-leitura');
  gravarEstado(d);
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'armada');
  assert.deepEqual(g.ativas, []);
  assert.equal(fs.existsSync(path.join(d, ARQ_GUARDA)), false);
});

test('G4 dispara, grava a trava e o evento uma vez; a trava fica mesmo com a condição sumindo', () => {
  const d = novo();
  gravarEstado(d, { u7: 86 });
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'disparada');
  assert.deepEqual(g.ativas, ['seven_day']);
  assert.equal(g.motivos[0].gatilho, 'G4');
  avaliarGuarda({ dir: d, agoraMs: agora + 1000, sessionId: 's' });
  assert.equal(lerEventos(d, agora + 2000).filter((e) => e.tipo === 'disparo').length, 1);
  gravarEstado(d, { u7: 50 });
  const depois = avaliarGuarda({ dir: d, agoraMs: agora + 2000, sessionId: 's' });
  assert.deepEqual(depois.ativas, ['seven_day']);
  assert.equal(depois.motivos[0].gatilho, 'G4');
  assert.equal(depois.motivos[0].dados, null);
});

test('guarda.json corrompido: disparada com ilegivel; apagar só volta a avaliar a condição', () => {
  const d = novo();
  gravarEstado(d, { u7: 86 });
  fs.writeFileSync(path.join(d, ARQ_GUARDA), '{');
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'disparada');
  assert.deepEqual(g.ativas, ['ilegivel', 'seven_day']);
  assert.equal(fs.readFileSync(path.join(d, ARQ_GUARDA), 'utf8'), '{');
  fs.rmSync(path.join(d, ARQ_GUARDA));
  assert.deepEqual(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).ativas, ['seven_day']);
});

// Revisão do plano: um guarda.json corrompido, grande demais ou trocado por
// um link mantém a guarda disparada com o motivo ilegível (§4.5), sem
// sobrescrever o arquivo nem seguir o link.
test('guarda.json grande demais: disparada com ilegivel, sem gravar', () => {
  const grande = novo();
  gravarEstado(grande);
  const conteudo = JSON.stringify({ v: 1, travas: {}, x: 'a'.repeat(GUARDA_MAX_BYTES) });
  fs.writeFileSync(path.join(grande, ARQ_GUARDA), conteudo);
  const g = avaliarGuarda({ dir: grande, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'disparada');
  assert.deepEqual(g.ativas, ['ilegivel']);
  assert.deepEqual(g.motivos, [{ trava: 'ilegivel', gatilho: null, resets_at: null, dados: null, desde: null }]);
  assert.equal(fs.readFileSync(path.join(grande, ARQ_GUARDA), 'utf8'), conteudo);
});

test('guarda.json trocado por link: disparada com ilegivel, sem seguir nem gravar', (t) => {
  const d = novo();
  gravarEstado(d, { u7: 86 });
  const alvo = path.join(d, 'alvo.json');
  const vazio = JSON.stringify({ v: 1, travas: {} });
  fs.writeFileSync(alvo, vazio);
  const arq = path.join(d, ARQ_GUARDA);
  try { fs.symlinkSync(alvo, arq); } catch { t.skip('sem permissão para criar link'); return; }
  assert.deepEqual(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).ativas, ['ilegivel', 'seven_day']);
  assert.equal(fs.lstatSync(arq).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(alvo, 'utf8'), vazio);
  assert.equal(disparos(d), 0);
});

// Um 'ilegivel' passageiro (no Windows, a renomeação atômica de outra sessão
// no meio da leitura) trava só aquela avaliação: nunca vira trava gravada.
test('ilegível passageiro não é gravado: com o arquivo legível de novo, vale só o que está nele', () => {
  const d = novo();
  gravarEstado(d);
  fs.writeFileSync(path.join(d, ARQ_GUARDA), '{');
  assert.deepEqual(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).ativas, ['ilegivel']);
  fs.writeFileSync(path.join(d, ARQ_GUARDA), JSON.stringify({ v: 1, travas: {} }));
  const g = avaliarGuarda({ dir: d, agoraMs: agora + 1000, sessionId: 's' });
  assert.equal(g.status, 'armada');
  assert.deepEqual(g.ativas, []);
});

// O arquivo fica ilegível entre a leitura do avaliador e a de gravarTravas
// (outra sessão no meio): o 'ilegivel' da gravação também trava (§4.5).
test('guarda.json estraga entre a leitura e a gravação: ilegivel também trava', (t) => {
  const d = novo();
  gravarEstado(d, { u7: 86 });
  const arq = path.join(d, ARQ_GUARDA);
  const original = fs.lstatSync;
  let vistas = 0;
  t.mock.method(fs, 'lstatSync', function (p, ...resto) {
    if (typeof p === 'string' && path.basename(p) === ARQ_GUARDA && ++vistas === 2) fs.writeFileSync(arq, '{');
    return original.call(this, p, ...resto);
  });
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  t.mock.restoreAll();
  assert.ok(vistas >= 2, 'gravarTravas releu guarda.json');
  assert.equal(g.status, 'disparada');
  assert.deepEqual(g.ativas, ['ilegivel', 'seven_day']);
  assert.equal(fs.readFileSync(arq, 'utf8'), '{');
  assert.equal(disparos(d), 0);
});

test('liberação cobre o ilegível: liberada, e o arquivo fica como está', () => {
  const d = novo();
  gravarEstado(d, { u7: 86 });
  fs.writeFileSync(path.join(d, ARQ_GUARDA), '{');
  liberar(d, '2h', 86);
  const g = avaliarGuarda({ dir: d, agoraMs: agora + H, sessionId: 's' });
  assert.equal(g.status, 'liberada');
  assert.deepEqual(g.ativas, []);
  assert.equal(fs.readFileSync(path.join(d, ARQ_GUARDA), 'utf8'), '{');
});

test('liberação cobre a trava e não grava disparo novo; ao acabar, trava de novo', () => {
  const d = novo();
  gravarEstado(d, { u7: 86 });
  avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  fs.rmSync(path.join(d, ARQ_GUARDA));
  liberar(d, '2h', 86);
  const g = avaliarGuarda({ dir: d, agoraMs: agora + H, sessionId: 's' });
  assert.equal(g.status, 'liberada');
  assert.deepEqual(g.ativas, []);
  assert.equal(fs.existsSync(path.join(d, ARQ_GUARDA)), false);
  const fim = avaliarGuarda({ dir: d, agoraMs: agora + 2 * H + 1000, sessionId: 's' });
  assert.equal(fim.status, 'disparada');
  assert.deepEqual(fim.ativas, ['seven_day']);
});

test('liberação comum não cobre G6; com fable, cobre', () => {
  const d = novo();
  gravarEstado(d);
  gravarTravas(d, { fable: { resets_at: null, gatilho: 'G6', desde: iso(agora) } }, agora);
  liberar(d, '2h', 40);
  assert.deepEqual(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).ativas, ['fable']);
  liberar(d, 'fable', 40);
  assert.equal(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).status, 'liberada');
});

// Gatilho atual diferente do gravado (G2 gravado, G4 agora): o motivo segue o
// gravado, sem os dados do outro gatilho (a mensagem usa o texto genérico).
test('trava gravada por G2 com G4 agora: motivo G2, dados null; ordem de CHAVES_MOTIVO', () => {
  const d = novo();
  gravarEstado(d, { u5: 95, u7: 86 });
  gravarTravas(d, { seven_day: { resets_at: agoraS + 4 * 86_400, gatilho: 'G2', desde: iso(agora - H) } }, agora);
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  assert.deepEqual(g.ativas, ['seven_day', 'five_hour']);
  assert.deepEqual(g.ativas, CHAVES_MOTIVO.filter((k) => g.ativas.includes(k)));
  assert.deepEqual(g.motivos[0], { trava: 'seven_day', gatilho: 'G2', resets_at: agoraS + 4 * 86_400, dados: null, desde: iso(agora - H) });
  assert.equal(g.motivos[1].gatilho, 'G3');
  assert.deepEqual(g.motivos[1].dados, { usado: 95, teto: 90, fresca: true, idadeMs: 0 });
});

test('G7 pelos despachos gravados; modelo da sessão de modelos.json antes do estado', () => {
  const d = novo();
  gravarEstado(d, { sessoes: { s: { at: iso(agora), model: 'Opus 5.5' } } });
  for (let i = 4; i >= 1; i--) registrarDespachoFable(d, agora - i * H / 2);
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  assert.deepEqual(g.ativas, ['fable-despachos']);
  assert.equal(g.despachosFable.length, 4);
  assert.equal(g.modeloSessao, 'Opus 5.5');
  gravarModeloSessao(d, 's', 'claude-fable-5-1', agora);
  assert.equal(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).modeloSessao, 'claude-fable-5-1');
});

test('desligada no config.json: nada avalia', () => {
  const d = novo();
  gravarEstado(d, { u7: 99 });
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { ligada: false } }));
  const g = avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'desligada');
  assert.equal(fs.existsSync(path.join(d, ARQ_GUARDA)), false);
});

test('entrada inválida: status erro, nunca lança', () => {
  assert.equal(avaliarGuarda({ dir: null, agoraMs: agora, sessionId: 's' }).status, 'erro');
  assert.equal(avaliarGuarda({ dir: novo(), agoraMs: NaN, sessionId: 's' }).status, 'erro');
  assert.equal(avaliarGuarda().status, 'erro');
});

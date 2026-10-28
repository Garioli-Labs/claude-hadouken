import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidirPrompt } from '../src/guarda/prompt.js';
import { avaliarGuarda } from '../src/guarda/avaliar.js';
import { gravarTravas, travasVazias } from '../src/guarda/travas.js';
import { gravarModeloSessao, lerEventos } from '../src/guarda/registros.js';
import { gravarLiberacao, montarLiberacao, lerPedido, lerLiberacao } from '../src/guarda/liberacao.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';
import { quandoLocal } from '../src/util.js';

const dirs = [];
// Modo estrito (guarda.perguntar = false) por padrão nos testes; o padrão da
// v0.5.4 é perguntar, conferido no seu próprio teste com novo(true).
const novo = (perguntar = false) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-p2-'));
  dirs.push(d);
  if (!perguntar) fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { perguntar: false } }));
  return d;
};
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const H = 3_600_000;
const agora = Date.UTC(2026, 8, 29, 6, 0);
const iso = (ms) => new Date(ms).toISOString();
const travarG6 = (d) => gravarTravas(d, { fable: { resets_at: null, gatilho: 'G6', desde: iso(agora - H) } }, agora);

test('sessão Fable com trava: prompt digitado é bloqueado com o texto da P2', () => {
  const d = novo();
  travarG6(d);
  gravarModeloSessao(d, 's1', 'claude-fable-5-1', agora);
  const r = decidirPrompt({ dir: d, sessionId: 's1', prompt: 'continue', agoraMs: agora });
  assert.equal(r.bloquear, `hadouken: guarda ativa: trava do Fable desde ${quandoLocal((agora - H) / 1000, agora)}. Esta sessão está no Fable. Troque com /model ou libere com /hadouken:liberar fable.`);
  assert.equal(lerEventos(d, agora).filter((e) => e.tipo === 'prompt-bloqueado').length, 1);
});

test('guarda.perguntar (padrão v0.5.4): o prompt digitado passa com o aviso e registra perguntado', () => {
  const d = novo(true);
  travarG6(d);
  gravarModeloSessao(d, 's1', 'claude-fable-5-1', agora);
  const r = decidirPrompt({ dir: d, sessionId: 's1', prompt: 'continue', agoraMs: agora });
  assert.equal(r.bloquear, null);
  assert.match(r.linha, /^hadouken: guarda ativa \(trava do Fable desde .+\) e esta sessão está no Fable\. O usuário decidiu seguir/);
  assert.deepEqual(lerEventos(d, agora).filter((e) => e.tipo === 'perguntado').map((e) => e.detalhe), ['P2:fable']);
});

test('foco 1: turno automático <task-notification> e comando do hadouken passam', () => {
  const d = novo();
  travarG6(d);
  gravarModeloSessao(d, 's1', 'claude-fable-5-1', agora);
  for (const prompt of ['<task-notification>\n<task-id>a1</task-id>', '  /hadouken:liberar fable', '/hadouken:consumo']) {
    assert.deepEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt, agoraMs: agora }), { bloquear: null, linha: null });
  }
});

test('sessão fora do Fable ou modelo desconhecido: não bloqueia', () => {
  const d = novo();
  travarG6(d);
  assert.equal(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).bloquear, null);
  gravarModeloSessao(d, 's1', 'claude-opus-5-5', agora);
  assert.equal(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).bloquear, null);
});

test('linha pós-liberação: uma vez, só na sessão que liberou', () => {
  const d = novo();
  const lib = montarLiberacao({ pedido: lerPedido('2h', PADRAO_GUARDA), agoraMs: agora, usado7d: 84, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's1', id: 'abcdef01' });
  gravarLiberacao(d, lib);
  assert.equal(decidirPrompt({ dir: d, sessionId: 's2', prompt: 'x', agoraMs: agora }).linha, null);
  assert.equal(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).linha,
    `hadouken: o usuário liberou a guarda até ${quandoLocal((agora + 2 * H) / 1000, agora)} ou até 7d 94%.`);
  assert.equal(lerLiberacao(d, agora).avisada, true);
  assert.equal(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).linha, null);
});

test('erro na avaliação: não bloqueia e registra o evento erro (§4.5)', () => {
  // Sessão Fable com trava: sem o erro, o prompt seria bloqueado. O erro é
  // forçado dentro da avaliação pelo parâmetro `avaliar` (só para teste):
  // uma vez com status 'erro', outra lançando.
  const d = novo();
  travarG6(d);
  gravarModeloSessao(d, 's1', 'claude-fable-5-1', agora);
  const comErro = () => ({ status: 'erro' });
  const quebra = () => { throw new Error('falha simulada'); };
  assert.deepEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora, avaliar: comErro }), { bloquear: null, linha: null });
  assert.deepEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora, avaliar: quebra }), { bloquear: null, linha: null });
  assert.deepEqual(lerEventos(d, agora).filter((e) => e.tipo === 'erro').map((e) => e.detalhe), ['P2', 'P2']);
  assert.deepEqual(decidirPrompt({ dir: null, sessionId: 's1', prompt: 'x', agoraMs: agora }), { bloquear: null, linha: null });
});

// M9 da revisão final da parte 1 (spec v0.4.0 §9.2): o modelo da sessão vem
// primeiro (modelos.json, senão estado.sessoes); a avaliação completa só roda
// numa sessão Fable. Fora do Fable, só liberacao.json para a linha
// pós-liberação (e config.json e estado.json só quando há linha a dar).
test('M9: fora do Fable a avaliação completa não roda; no Fable, roda uma vez', () => {
  const d = novo();
  travarG6(d);
  let chamadas = 0;
  const espia = (a) => { chamadas += 1; return avaliarGuarda(a); };
  assert.deepEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora, avaliar: espia }), { bloquear: null, linha: null });
  gravarModeloSessao(d, 's1', 'claude-opus-5-5', agora);
  assert.deepEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora, avaliar: espia }), { bloquear: null, linha: null });
  assert.equal(chamadas, 0);
  gravarModeloSessao(d, 's1', 'claude-fable-5-1', agora);
  assert.notEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora, avaliar: espia }).bloquear, null);
  assert.equal(chamadas, 1);
});

test('M9: o modelo do estado.json vale quando modelos.json não tem a sessão', () => {
  const d = novo();
  travarG6(d);
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({ versao: 1, at: iso(agora), five_hour: null, seven_day: null,
    sessoes: { s1: { at: iso(agora - 60_000), model: 'Fable 5.1' } }, historico: [] }));
  assert.notEqual(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).bloquear, null);
  assert.equal(decidirPrompt({ dir: d, sessionId: 's2', prompt: 'x', agoraMs: agora }).bloquear, null);
});

test('M9: fora do Fable, sem linha com a guarda desligada ou a liberação acabada nos pontos', () => {
  const d = novo();
  const lib = montarLiberacao({ pedido: lerPedido('2h', PADRAO_GUARDA), agoraMs: agora, usado7d: 84, travas: travasVazias(), config: PADRAO_GUARDA, sessionId: 's1', id: 'abcdef01' });
  gravarLiberacao(d, lib);
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { ligada: false } }));
  assert.equal(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).linha, null);
  fs.rmSync(path.join(d, 'config.json'));
  // 7d em 94% = base 84 + teto 10: a liberação acabou pelos pontos.
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({ versao: 1, at: iso(agora), five_hour: null,
    seven_day: { used_percentage: 94, resets_at: Math.floor(agora / 1000) + 86_400, at: iso(agora) }, sessoes: {}, historico: [] }));
  assert.equal(decidirPrompt({ dir: d, sessionId: 's1', prompt: 'x', agoraMs: agora }).linha, null);
  assert.equal(lerLiberacao(d, agora).avisada, false);
});

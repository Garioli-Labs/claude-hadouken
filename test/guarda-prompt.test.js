import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidirPrompt } from '../src/guarda/prompt.js';
import { gravarTravas, travasVazias } from '../src/guarda/travas.js';
import { gravarModeloSessao, lerEventos } from '../src/guarda/registros.js';
import { gravarLiberacao, montarLiberacao, lerPedido, lerLiberacao } from '../src/guarda/liberacao.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';
import { quandoLocal } from '../src/util.js';

const dirs = [];
const novo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-p2-')); dirs.push(d); return d; };
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
  assert.equal(r.bloquear, `hadouken: guarda ativa: trava do Fable desde ${quandoLocal((agora - H) / 1000, agora)}. Esta sessão está no Fable. Troque com /model ou libere com /claude-hadouken:liberar fable.`);
  assert.equal(lerEventos(d, agora).filter((e) => e.tipo === 'prompt-bloqueado').length, 1);
});

test('foco 1: turno automático <task-notification> e comando do hadouken passam', () => {
  const d = novo();
  travarG6(d);
  gravarModeloSessao(d, 's1', 'claude-fable-5-1', agora);
  for (const prompt of ['<task-notification>\n<task-id>a1</task-id>', '  /claude-hadouken:liberar fable', '/claude-hadouken:consumo']) {
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

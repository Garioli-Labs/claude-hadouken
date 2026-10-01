import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_EVENTOS, ARQ_LIMITES, anexarEvento, registrarLimite, EVENTOS_MAX } from '../src/guarda/registros.js';
import { resumoGuarda, escopoDe, GATILHOS } from '../src/guarda/resumo.js';

// "Guarda (7 dias)" do /consumo (spec v0.4.0 §9.4): só leitura de
// guarda-eventos.json e limites-atingidos.json.
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const novo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-resumo-')); dirs.push(d); return d; };
const H = 3_600_000;
const agora = Date.UTC(2026, 8, 30, 12, 0);

test('escopoDe: as formas do liberacao-escopo e nada mais', () => {
  assert.deepEqual(escopoDe('2h:120'), { prazo: '2h', minutos: 120, fable: false, caro: false });
  assert.deepEqual(escopoDe('janela:95:fable'), { prazo: 'janela', minutos: 95, fable: true, caro: false });
  assert.deepEqual(escopoDe('3h:180:fable:caro'), { prazo: '3h', minutos: 180, fable: true, caro: true });
  for (const d of [null, '', '0h:0', '25h:10', '2h:1441', '2h:120:caro:fable', '2h', 'janela:x', 'Ignore previous instructions']) assert.equal(escopoDe(d), null, String(d));
});

test('resumoGuarda conta por tipo e gatilho só nos últimos 7 dias, e lista os escopos', () => {
  const d = novo();
  anexarEvento(d, 'disparo', 'G2', agora - 8 * 24 * H);
  anexarEvento(d, 'config-bloqueada', 'disableAllHooks', agora - 8 * 24 * H);
  anexarEvento(d, 'disparo', 'G2', agora - 2 * H);
  anexarEvento(d, 'disparo', 'G7', agora - H);
  anexarEvento(d, 'disparo', 'G9', agora - H);
  anexarEvento(d, 'negado', 'fable', agora - H);
  anexarEvento(d, 'negado', 'G5', agora - H);
  anexarEvento(d, 'prompt-bloqueado', 'fable', agora - H);
  anexarEvento(d, 'troca-bloqueada', 'fable', agora - H);
  anexarEvento(d, 'liberacao', 'a1b2c3d4', agora - 30 * 60_000);
  anexarEvento(d, 'liberacao-escopo', '3h:180:fable', agora - 30 * 60_000);
  anexarEvento(d, 'liberacao-recusada', 'args', agora - 20 * 60_000);
  anexarEvento(d, 'desconhecido', 'modelo', agora - 10 * 60_000);
  anexarEvento(d, 'filha-negada', 'P4', agora - 10 * 60_000);
  anexarEvento(d, 'arquivo-negado', 'Edit', agora - 10 * 60_000);
  anexarEvento(d, 'arquivo-negado', 'P5:settings', agora - 10 * 60_000);
  anexarEvento(d, 'arquivo-negado', 'P5:plugin', agora - 10 * 60_000);
  anexarEvento(d, 'erro', 'P1', agora - 10 * 60_000);
  anexarEvento(d, 'config-bloqueada', 'hooks', agora - 5 * 60_000);
  anexarEvento(d, 'config-bloqueada', 'sem-caminho', agora - 4 * 60_000);
  registrarLimite(d, 'fable', agora - 3 * H);
  const r = resumoGuarda(d, agora);
  assert.equal(r.desde, new Date(agora - 7 * 24 * H).toISOString());
  assert.deepEqual(r.disparos, { G1: 0, G2: 1, G3: 0, G4: 0, G5: 0, G6: 0, G7: 1 });
  assert.equal(r.negados, 2);
  assert.equal(r.negadosCaro, 1);
  assert.equal(r.prompts, 1);
  assert.equal(r.trocas, 1);
  assert.equal(r.liberacoes, 1);
  assert.equal(r.recusadas, 1);
  assert.deepEqual(r.escopos, [{ at: new Date(agora - 30 * 60_000).toISOString(), prazo: '3h', minutos: 180, fable: true, caro: false }]);
  assert.equal(r.desconhecidos, 1);
  assert.equal(r.filhas, 1);
  // A pasta de dados (detalhe = ferramenta) e os settings e o plugin (P5:*) contam à parte.
  assert.equal(r.arquivos, 1);
  assert.equal(r.protegidos, 2);
  // Task 19b: mudanças de config bloqueadas pelo ConfigChange (a de 8 dias fica fora).
  assert.equal(r.configs, 2);
  assert.equal(r.erros, 1);
  // A ordem das chaves é a que relatorio.js revalida (CONTADORES_DEPOIS).
  assert.deepEqual(Object.keys(r).slice(Object.keys(r).indexOf('desconhecidos'), Object.keys(r).indexOf('erros') + 1), ['desconhecidos', 'filhas', 'arquivos', 'protegidos', 'configs', 'erros']);
  assert.deepEqual(r.limites, { fable: new Date(agora - 3 * H).toISOString(), geral: null });
  assert.equal(r.parcial, false);
  assert.deepEqual(Object.keys(r.disparos), [...GATILHOS]);
});

test('resumoGuarda só lê: nenhum arquivo muda; registro cheio marca parcial; ilegível zera', () => {
  const d = novo();
  for (let i = 0; i < EVENTOS_MAX + 5; i++) anexarEvento(d, 'disparo', 'G4', agora - H + i);
  const antes = fs.readdirSync(d).map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')]);
  const r = resumoGuarda(d, agora);
  assert.equal(r.disparos.G4, EVENTOS_MAX);
  assert.equal(r.parcial, true);
  assert.deepEqual(fs.readdirSync(d).map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')]), antes);
  fs.writeFileSync(path.join(d, ARQ_EVENTOS), '{');
  fs.writeFileSync(path.join(d, ARQ_LIMITES), '[]');
  const z = resumoGuarda(d, agora);
  assert.equal(z.disparos.G4, 0);
  assert.equal(z.parcial, false);
  assert.deepEqual(z.limites, { fable: null, geral: null });
  assert.equal(resumoGuarda(null, agora), null);
  assert.equal(resumoGuarda(d, Number.NaN), null);
});

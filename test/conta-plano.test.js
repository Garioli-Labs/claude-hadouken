import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARQ_PLANO, arquivoClaudeJson, atualizarPlano, planoDoClaude, planoEfetivo, ROTULO_PLANO,
} from '../src/conta/plano.js';
import { rodarColetor } from '../src/saude/coletor-main.js';

// Plano v0.5.6, Task 2 (decisão 3): o plano da conta vem só do campo
// organizationRateLimitTier do .claude.json, lido pelo coletor no máximo uma
// vez a cada 24 h e guardado em conta-plano.json.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-conta-plano-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const novoDir = () => fs.mkdirSync(path.join(tmp, `d${n++}`), { recursive: true });
const AGORA = Date.UTC(2026, 9, 28, 12);
const H = 3600_000;
const claudeJson = (tier) => JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c', organizationRateLimitTier: tier }, organizationRateLimitTier: tier });

test('planoDoClaude: os três planos e o resto', () => {
  assert.equal(planoDoClaude(JSON.stringify({ organizationRateLimitTier: 'default_claude_max_20x' })), 'max20');
  assert.equal(planoDoClaude(JSON.stringify({ organizationRateLimitTier: 'default_claude_max_5x' })), 'max5');
  assert.equal(planoDoClaude(JSON.stringify({ organizationRateLimitTier: 'default_claude_pro' })), 'pro');
  assert.equal(planoDoClaude(JSON.stringify({ organizationRateLimitTier: 'enterprise_x' })), null);
  assert.equal(planoDoClaude(JSON.stringify({ outro: 1 })), null);
  assert.equal(planoDoClaude(JSON.stringify({ organizationRateLimitTier: null })), null);
  assert.equal(planoDoClaude(JSON.stringify({ organizationRateLimitTier: { max_20x: 1 } })), null);
  assert.equal(planoDoClaude('{quebrado'), null);
  assert.equal(planoDoClaude('null'), null);
  assert.equal(planoDoClaude(undefined), null);
});

test('planoDoClaude: BOM no início é aceito', () => {
  const bom = String.fromCodePoint(0xfeff);
  assert.equal(planoDoClaude(bom + JSON.stringify({ organizationRateLimitTier: 'default_claude_max_20x' })), 'max20');
});

test('planoDoClaude: só devolve rótulo fixo, nunca outro campo do arquivo', () => {
  const r = planoDoClaude(claudeJson('default_claude_max_5x'));
  assert.equal(r, 'max5');
  for (const t of ['x', 'a@b.c', 'default_claude_max_20x_a@b.c']) {
    assert.ok([null, 'pro', 'max5', 'max20'].includes(planoDoClaude(claudeJson(t))));
  }
});

test('arquivoClaudeJson: CLAUDE_CONFIG_DIR absoluto, senão a pasta do usuário', () => {
  const abs = path.resolve('/x');
  const home = path.resolve('/h');
  assert.equal(arquivoClaudeJson({ CLAUDE_CONFIG_DIR: abs }, home), path.join(abs, '.claude.json'));
  assert.equal(arquivoClaudeJson({}, home), path.join(home, '.claude.json'));
  assert.equal(arquivoClaudeJson({ CLAUDE_CONFIG_DIR: 'relativo' }, home), path.join(home, '.claude.json'));
  assert.equal(arquivoClaudeJson({}, ''), null);
  assert.equal(arquivoClaudeJson({}, 'relativo'), null);
  assert.equal(arquivoClaudeJson(null, home), path.join(home, '.claude.json'));
});

test('planoEfetivo: arquivo ausente, corrompido ou plano estranho → desconhecido', () => {
  const d = novoDir();
  assert.equal(planoEfetivo(d), 'desconhecido');
  fs.writeFileSync(path.join(d, ARQ_PLANO), '{x');
  assert.equal(planoEfetivo(d), 'desconhecido');
  fs.writeFileSync(path.join(d, ARQ_PLANO), JSON.stringify({ v: 1, plano: 'ultra', em: AGORA }));
  assert.equal(planoEfetivo(d), 'desconhecido');
  fs.writeFileSync(path.join(d, ARQ_PLANO), JSON.stringify({ v: 1, plano: 'max20', em: AGORA }));
  assert.equal(planoEfetivo(d), 'max20');
  assert.equal(planoEfetivo(null), 'desconhecido');
});

test('ROTULO_PLANO', () => {
  assert.deepEqual(ROTULO_PLANO, { pro: 'Pro', max5: 'Max 5x', max20: 'Max 20x' });
});

test('atualizarPlano: grava, não relê em 24 h, relê depois', () => {
  const d = novoDir();
  let leituras = 0;
  const ler = () => { leituras++; return { ok: true, texto: claudeJson('default_claude_max_20x') }; };
  assert.deepEqual(atualizarPlano({ dir: d, agoraMs: AGORA, arquivo: '/c/.claude.json', ler }), { lido: true });
  assert.equal(planoEfetivo(d), 'max20');
  const gravado = JSON.parse(fs.readFileSync(path.join(d, ARQ_PLANO), 'utf8'));
  assert.deepEqual(gravado, { v: 1, plano: 'max20', em: AGORA });
  assert.deepEqual(atualizarPlano({ dir: d, agoraMs: AGORA + 23 * H, arquivo: '/c/.claude.json', ler }), { lido: false });
  assert.equal(leituras, 1);
  assert.deepEqual(atualizarPlano({ dir: d, agoraMs: AGORA + 25 * H, arquivo: '/c/.claude.json', ler }), { lido: true });
  assert.equal(leituras, 2);
});

test('atualizarPlano: arquivo sem o campo grava desconhecido (o padrão vale)', () => {
  const d = novoDir();
  atualizarPlano({ dir: d, agoraMs: AGORA, arquivo: '/c/.claude.json', ler: () => ({ ok: true, texto: '{}' }) });
  assert.equal(planoEfetivo(d), 'desconhecido');
});

test('atualizarPlano: ler que lança, falha ou arquivo null → nada gravado', () => {
  const d = novoDir();
  assert.deepEqual(atualizarPlano({ dir: d, agoraMs: AGORA, arquivo: '/c/.claude.json', ler: () => { throw new Error('x'); } }), { lido: false });
  assert.deepEqual(atualizarPlano({ dir: d, agoraMs: AGORA, arquivo: '/c/.claude.json', ler: () => ({ ok: false, motivo: 'grande' }) }), { lido: false });
  assert.deepEqual(atualizarPlano({ dir: d, agoraMs: AGORA, arquivo: null, ler: () => ({ ok: true, texto: '{}' }) }), { lido: false });
  assert.equal(fs.existsSync(path.join(d, ARQ_PLANO)), false);
});

test('atualizarPlano: lê com teto de 8 MB', () => {
  const d = novoDir();
  let teto = null;
  atualizarPlano({ dir: d, agoraMs: AGORA, arquivo: '/c/.claude.json', ler: (_a, max) => { teto = max; return { ok: false, motivo: 'grande' }; } });
  assert.equal(teto, 8 * 1024 * 1024);
});

test('rodarColetor: chama o plano depois do saude.json, e erro nele não derruba a coleta', async () => {
  const d = novoDir();
  let viuSaude = null;
  const config = { liberarProprios: false, conflitos: false, limpeza: { ligada: false } };
  const leitura = { v: 1, em: AGORA, processos: [], fontes: {} };
  const plano = ({ dir }) => { viuSaude = fs.existsSync(path.join(dir, 'saude.json')); throw new Error('x'); };
  const r = await rodarColetor({ dir: d, agoraMs: AGORA, coletar: async () => leitura, matar: () => {}, config, plano });
  assert.equal(viuSaude, true);
  assert.equal(r.ok, true);
});

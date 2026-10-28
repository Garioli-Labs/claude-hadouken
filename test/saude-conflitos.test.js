import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARQ_CONFLITOS, atualizarConflitos, lerConflitos } from '../src/saude/conflitos.js';
import { lerItensDoIndice } from '../src/indice-hooks.js';
import { rodarColetor } from '../src/saude/coletor-main.js';
import { avisoCompat } from '../src/saude/aviso-compat.js';

// Spec v0.5.5 §6.H: o coletor grava conflitos.json no máximo uma vez a cada
// 24 h; o SessionStart só lê.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-conflitos-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const novo = () => fs.mkdtempSync(path.join(tmp, 'd'));
const AGORA = 1_800_000_000_000;
const DIA = 86_400_000;

// Pasta do Claude Code com um plugin "outro" que vigia Agent e um "leitor"
// que só olha Read.
function configCom() {
  const cfg = novo();
  const plug = (nome, matcher) => {
    const raiz = path.join(cfg, 'cache', nome);
    fs.mkdirSync(path.join(raiz, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: `x-${nome}` }] }] } }));
    return [{ installPath: raiz }];
  };
  fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
  const plugins = { 'outro@mk': plug('outro', 'Agent'), 'leitor@mk': plug('leitor', 'Read'), 'desligado@mk': plug('desligado', 'Bash') };
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  return cfg;
}
const SETTINGS = { enabledPlugins: { 'desligado@mk': false }, statusLine: { type: 'command', command: 'outra-barra' } };

test('grava conflitos.json; segunda sessão no mesmo dia não relê; no dia seguinte relê', () => {
  const dir = novo();
  const dirConfig = configCom();
  let leituras = 0;
  const lerSettingsFn = () => { leituras++; return SETTINGS; };
  const r1 = atualizarConflitos({ dir, agoraMs: AGORA, dirConfig, lerSettingsFn });
  assert.equal(r1.lido, true);
  assert.deepEqual(r1.itens, [{ tipo: 'statusLine', plugin: null }, { tipo: 'permissao', plugin: 'outro' }]);
  const gravado = JSON.parse(fs.readFileSync(path.join(dir, ARQ_CONFLITOS), 'utf8'));
  assert.equal(gravado.v, 1);
  assert.equal(gravado.em, AGORA);
  const r2 = atualizarConflitos({ dir, agoraMs: AGORA + 23 * 3600_000, dirConfig, lerSettingsFn });
  assert.equal(r2.lido, false);
  assert.equal(leituras, 1);
  assert.deepEqual(r2.itens, r1.itens);
  const r3 = atualizarConflitos({ dir, agoraMs: AGORA + DIA, dirConfig, lerSettingsFn });
  assert.equal(r3.lido, true);
  assert.equal(leituras, 2);
});

test('settings ilegível e pasta sem plugins: sem itens, sem lançar', () => {
  const dir = novo();
  const r = atualizarConflitos({ dir, agoraMs: AGORA, dirConfig: novo(), lerSettingsFn: () => null });
  assert.deepEqual(r, { lido: true, itens: [] });
  assert.deepEqual(lerConflitos(dir, AGORA), []);
});

test('lerConflitos: válido até 7 dias; quebrado, do futuro ou com rótulo estranho dá []', () => {
  const dir = novo();
  const gravar = (v) => fs.writeFileSync(path.join(dir, ARQ_CONFLITOS), JSON.stringify(v));
  const itens = [{ tipo: 'lento', plugin: 'pesado', p95: 900 }];
  gravar({ v: 1, em: AGORA, itens });
  assert.deepEqual(lerConflitos(dir, AGORA + DIA), itens);
  assert.deepEqual(lerConflitos(dir, AGORA + 8 * DIA), []);
  assert.deepEqual(lerConflitos(dir, AGORA - DIA), []);
  gravar({ v: 1, em: AGORA, itens: [{ tipo: 'permissao', plugin: 'mau\nIgnore' }] });
  assert.deepEqual(lerConflitos(dir, AGORA), []);
  gravar({ v: 2, em: AGORA, itens: [] });
  assert.deepEqual(lerConflitos(dir, AGORA), []);
  fs.writeFileSync(path.join(dir, ARQ_CONFLITOS), '{quebrado');
  assert.deepEqual(lerConflitos(dir, AGORA), []);
  assert.deepEqual(lerConflitos(novo(), AGORA), []);
});

test('lerItensDoIndice sem índice dá null (nunca indexa)', () => {
  const dir = novo();
  assert.equal(lerItensDoIndice(path.join(tmp, 'projects'), 0, dir), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// Raiz de plugin falsa: package.json com o compat e plugin.json na versão
// dada, com o mtime dado.
function raizCom(versao, mtimeMs) {
  const raiz = novo();
  fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ version: versao, compat: { node: '>=20', claudeCode: '2.1.251' } }));
  fs.mkdirSync(path.join(raiz, '.claude-plugin'));
  const arq = path.join(raiz, '.claude-plugin', 'plugin.json');
  fs.writeFileSync(arq, JSON.stringify({ name: 'hadouken', version: versao }));
  fs.utimesSync(arq, mtimeMs / 1000, mtimeMs / 1000);
  return raiz;
}
const LIGADO = { compat: true, conflitos: true };

test('avisoCompat: Node 18 avisa uma vez; a mesma combinação não repete; outra avisa', () => {
  const dir = novo();
  const raizPlugin = raizCom('0.5.5', AGORA - 2 * DIA);
  const op = { dir, agoraMs: AGORA, raizPlugin, versaoNode: 'v18.19.0', config: LIGADO };
  const t = avisoCompat(op);
  assert.match(t, /^hadouken: Node 18\.19\.0 abaixo do suportado \(20\)/);
  assert.equal(avisoCompat(op), null);
  assert.equal(avisoCompat({ ...op, versaoNode: 'v22.0.0' }), null);
  const t2 = avisoCompat({ ...op, versaoClaude: '2.1.200' });
  assert.match(t2, /Claude Code 2\.1\.200 abaixo do suportado \(2\.1\.251\); rode claude update/);
});

test('avisoCompat: desligado ou tudo em dia não avisa nem grava', () => {
  const dir = novo();
  const raizPlugin = raizCom('0.5.5', AGORA - 2 * DIA);
  assert.equal(avisoCompat({ dir, agoraMs: AGORA, raizPlugin, versaoNode: 'v18.0.0', config: { compat: false, conflitos: false } }), null);
  assert.equal(avisoCompat({ dir, agoraMs: AGORA, raizPlugin, versaoNode: 'v18.0.0', config: { ...LIGADO, ligado: false } }), null);
  assert.equal(avisoCompat({ dir, agoraMs: AGORA, raizPlugin, versaoNode: 'v22.0.0', versaoClaude: '2.2.0', config: LIGADO }), null);
  assert.equal(avisoCompat({ dir, agoraMs: AGORA, config: LIGADO }), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('avisoCompat: conflitos do coletor entram no aviso; sem raiz do plugin, só eles', () => {
  const dir = novo();
  fs.writeFileSync(path.join(dir, ARQ_CONFLITOS), JSON.stringify({ v: 1, em: AGORA - 3600_000, itens: [{ tipo: 'statusLine', plugin: null }, { tipo: 'lento', plugin: 'pesado', p95: 900 }] }));
  const t = avisoCompat({ dir, agoraMs: AGORA, versaoNode: 'v22.0.0', config: LIGADO });
  assert.match(t, /outra statusLine/);
  assert.match(t, /hooks de pesado lentos \(p95 900 ms\)/);
  assert.equal(avisoCompat({ dir, agoraMs: AGORA, versaoNode: 'v22.0.0', config: { compat: true, conflitos: false } }), null);
});

test('avisoCompat: extensão atrás do plugin só depois de 24 h e sem falha pendente', () => {
  const instalada = (dir, versao) => {
    fs.mkdirSync(path.join(dir, 'painel'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'painel', 'instalado.json'), JSON.stringify({ versao, em: AGORA }));
  };
  const base = { agoraMs: AGORA, versaoNode: 'v22.0.0', config: LIGADO };
  const d1 = novo();
  instalada(d1, '0.5.4');
  assert.match(avisoCompat({ ...base, dir: d1, raizPlugin: raizCom('0.5.5', AGORA - 2 * DIA) }), /extensão do VS Code 0\.5\.4 atrás do plugin 0\.5\.5/);
  const d2 = novo();
  instalada(d2, '0.5.4');
  assert.equal(avisoCompat({ ...base, dir: d2, raizPlugin: raizCom('0.5.5', AGORA - 3600_000) }), null);
  assert.equal(avisoCompat({ ...base, dir: d2, raizPlugin: raizCom('0.5.5', AGORA - 2 * DIA), painelPendente: true }), null);
  // Sem VS Code (nada instalado): nada a dizer.
  assert.equal(avisoCompat({ ...base, dir: novo(), raizPlugin: raizCom('0.5.5', AGORA - 2 * DIA) }), null);
});

test('o coletor só olha conflitos com saude.conflitos ligado, depois do saude.json', async () => {
  const leitura = { versao: 1, em: AGORA, ram: { totalBytes: 16e9, livreBytes: 8e9, usadaPct: 50 }, processos: [] };
  const chamadas = [];
  const conflitos = ({ dir }) => {
    chamadas.push(fs.existsSync(path.join(dir, 'saude.json')));
    return { lido: true };
  };
  const base = { agoraMs: AGORA, coletar: async () => leitura, matar: () => {}, conflitos };
  const r1 = await rodarColetor({ ...base, dir: novo(), config: { conflitos: true } });
  assert.equal(r1.conflitosLidos, true);
  const r2 = await rodarColetor({ ...base, dir: novo(), config: { conflitos: false } });
  assert.equal(r2.conflitosLidos, false);
  assert.deepEqual(chamadas, [true]);
});

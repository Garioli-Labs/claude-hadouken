import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARQ_VERSAO, ARQ_TRAVA_VERSAO, URL_RELEASE, compararVersoes, comandoAtualizar, estadoVersao, talvezConsultarVersao,
} from '../src/atualizacao/versao.js';

// Aviso de versão nova (spec v0.5.3 VS Code §2.4): uma consulta ao GitHub a
// cada 6 h no máximo, uma por vez entre as janelas. `buscar` é sempre falso;
// pastas temporárias, nada toca ~/.claude nem a rede.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const AGORA = Date.UTC(2026, 9, 20, 18, 0);
const H = 3_600_000;

// Pasta de dados e raiz de plugin com a versão instalada.
function novo(instalada = '0.5.3', config) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk versao ç '));
  dirs.push(d);
  const raiz = path.join(d, 'plugin');
  fs.mkdirSync(path.join(raiz, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'hadouken', version: instalada }));
  const dados = path.join(d, 'dados');
  fs.mkdirSync(dados);
  if (config !== undefined) fs.writeFileSync(path.join(dados, 'config.json'), JSON.stringify(config));
  return { dir: dados, raizPlugin: raiz };
}
const resposta = (corpo, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
function buscarFalso(corpo, status) {
  const chamadas = [];
  const buscar = async (url, opcoes) => { chamadas.push({ url, opcoes }); return resposta(corpo, status); };
  return { buscar, chamadas };
}
const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });
const arq = (dir) => path.join(dir, ARQ_VERSAO);

test('release v0.5.9 com o plugin em 0.5.3: nova 0.5.9', async () => {
  const c = novo();
  const { buscar, chamadas } = buscarFalso(release('v0.5.9'));
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: AGORA, buscar }), { motivo: 'consultou' });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, URL_RELEASE);
  assert.equal(URL_RELEASE, 'https://api.github.com/repos/Garioli-Labs/claude-hadouken/releases/latest');
  assert.equal(chamadas[0].opcoes.headers['User-Agent'], 'claude-hadouken');
  assert.deepEqual(JSON.parse(fs.readFileSync(arq(c.dir), 'utf8')), { versao: '0.5.9', consultadaEm: AGORA });
  assert.deepEqual(estadoVersao(c), { nova: '0.5.9', instalada: '0.5.3' });
  assert.equal(fs.existsSync(path.join(c.dir, ARQ_TRAVA_VERSAO)), false);
});

test('draft, prerelease e tags fora da forma não mudam o arquivo', async () => {
  for (const corpo of [
    release('v0.6.0', { draft: true }), release('v0.6.0', { prerelease: true }), release('latest'), release('v0.5'),
    release('v0.5.9-rc1'), release('v00000.1.1'),
  ]) {
    const c = novo();
    fs.writeFileSync(arq(c.dir), JSON.stringify({ versao: '0.5.4', consultadaEm: AGORA - 7 * H }));
    const antes = fs.readFileSync(arq(c.dir), 'utf8');
    await talvezConsultarVersao({ ...c, agoraMs: AGORA, buscar: buscarFalso(corpo).buscar });
    assert.equal(fs.readFileSync(arq(c.dir), 'utf8'), antes, JSON.stringify(corpo));
  }
});

test('buscar que rejeita, 403, JSON que não é objeto ou grande demais: falhou, arquivo igual', async () => {
  const casos = [
    async () => { throw new Error('rede'); },
    buscarFalso({ message: 'rate limit' }, 403).buscar,
    buscarFalso('[1,2]').buscar,
    buscarFalso('null').buscar,
    buscarFalso('{').buscar,
    buscarFalso(JSON.stringify({ tag_name: 'v0.5.9', x: 'a'.repeat(300 * 1024) })).buscar,
  ];
  for (const buscar of casos) {
    const c = novo();
    fs.writeFileSync(arq(c.dir), JSON.stringify({ versao: '0.5.4', consultadaEm: AGORA - 7 * H }));
    const antes = fs.readFileSync(arq(c.dir), 'utf8');
    assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: AGORA, buscar }), { motivo: 'falhou' });
    assert.equal(fs.readFileSync(arq(c.dir), 'utf8'), antes);
    assert.equal(fs.existsSync(path.join(c.dir, ARQ_TRAVA_VERSAO)), false);
  }
});

test('segunda chamada em menos de 6 h: recente, sem buscar; forcar consulta', async () => {
  const c = novo();
  await talvezConsultarVersao({ ...c, agoraMs: AGORA, buscar: buscarFalso(release('v0.5.9')).buscar });
  const { buscar, chamadas } = buscarFalso(release('v0.6.0'));
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: AGORA + 5 * H, buscar }), { motivo: 'recente' });
  assert.equal(chamadas.length, 0);
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: AGORA + 5 * H, buscar, forcar: true }), { motivo: 'consultou' });
  assert.equal(estadoVersao(c).nova, '0.6.0');
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: AGORA + 12 * H, buscar }), { motivo: 'consultou' });
});

test('trava presente e nova: travado, mesmo com forcar; vencida é tomada', async () => {
  const c = novo();
  const trava = path.join(c.dir, ARQ_TRAVA_VERSAO);
  fs.writeFileSync(trava, '{}');
  const { buscar, chamadas } = buscarFalso(release('v0.5.9'));
  const agora = Date.now();
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: agora, buscar }), { motivo: 'travado' });
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: agora, buscar, forcar: true }), { motivo: 'travado' });
  assert.equal(chamadas.length, 0);
  assert.ok(fs.existsSync(trava));
  fs.utimesSync(trava, (agora - 60_000) / 1000, (agora - 60_000) / 1000);
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: agora, buscar }), { motivo: 'consultou' });
  assert.equal(fs.existsSync(trava), false);
});

test('plugin já em 0.5.9: nova null; versão mais nova instalada também', async () => {
  const c = novo('0.5.9');
  await talvezConsultarVersao({ ...c, agoraMs: AGORA, buscar: buscarFalso(release('v0.5.9')).buscar });
  assert.deepEqual(estadoVersao(c), { nova: null, instalada: '0.5.9' });
  const d = novo('0.6.0');
  fs.writeFileSync(arq(d.dir), JSON.stringify({ versao: '0.5.9', consultadaEm: AGORA }));
  assert.deepEqual(estadoVersao(d), { nova: null, instalada: '0.6.0' });
});

test('estadoVersao sem arquivo, com arquivo ruim ou plugin.json ruim', () => {
  const c = novo();
  assert.deepEqual(estadoVersao(c), { nova: null, instalada: '0.5.3' });
  fs.writeFileSync(arq(c.dir), JSON.stringify({ versao: '0.5.9-rc1', consultadaEm: AGORA }));
  assert.deepEqual(estadoVersao(c), { nova: null, instalada: '0.5.3' });
  const ruim = novo('x');
  fs.writeFileSync(arq(ruim.dir), JSON.stringify({ versao: '0.5.9', consultadaEm: AGORA }));
  assert.deepEqual(estadoVersao(ruim), { nova: null, instalada: null });
  assert.deepEqual(estadoVersao({}), { nova: null, instalada: null });
});

test('painel.avisarVersaoNova false: desligado, sem buscar', async () => {
  const c = novo('0.5.3', { painel: { avisarVersaoNova: false } });
  const { buscar, chamadas } = buscarFalso(release('v0.5.9'));
  assert.deepEqual(await talvezConsultarVersao({ ...c, agoraMs: AGORA, buscar, forcar: true }), { motivo: 'desligado' });
  assert.equal(chamadas.length, 0);
});

test('compararVersoes', () => {
  assert.equal(compararVersoes('0.5.9', '0.5.3'), 1);
  assert.equal(compararVersoes('0.5.3', '0.5.9'), -1);
  assert.equal(compararVersoes('0.10.0', '0.9.9'), 1);
  assert.equal(compararVersoes('1.0.0', '1.0.0'), 0);
});

test('comandoAtualizar: os comandos do README, exatos', () => {
  const win = comandoAtualizar('win32');
  const nix = comandoAtualizar('linux');
  assert.deepEqual(win, { shell: 'powershell', texto: 'irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex' });
  assert.deepEqual(nix, { shell: 'posix', texto: 'curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash' });
  assert.equal(comandoAtualizar('darwin').shell, 'posix');
  const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
  assert.ok(readme.includes(win.texto));
  assert.ok(readme.includes(nix.texto));
});

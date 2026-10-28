import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificar, sugerirFechar, encerraveis, sanearNome } from '../src/saude/processos.js';

// Spec v0.5.5 §6.B: classes de processo, sugestões ao usuário e a regra dos
// 3× o prazo. Puro: a lista vem pronta, nada é lido do sistema.

const MB = 1024 * 1024;
const p = (pid, nome, rssMb = 10, extra = {}) => ({ pid, ppid: 1, nome, cmd: nome, rssBytes: rssMb * MB, cpuPct: 0, ...extra });
const classeDe = (lista) => Object.fromEntries(classificar(lista).map((x) => [x.pid, x.classe]));

test('classifica navegador, vscode, claude e sistema nas três plataformas', () => {
  const c = classeDe([
    // Windows
    p(10, 'chrome.exe'), p(11, 'msedge.exe'), p(12, 'firefox.exe'), p(13, 'Code.exe'),
    p(14, 'claude.exe'), p(15, 'svchost.exe'), p(16, 'node.exe', 10, { cmd: 'node.exe C:\\proj\\node_modules\\vite\\bin\\vite.js' }),
    p(17, 'node.exe', 10, { cmd: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\x\\.claude\\plugins\\cache\\claude-hadouken\\hadouken\\0.5.5\\src\\saude\\coletor-main.js"' }),
    p(18, 'notepad.exe'), p(4, 'System'),
    // Linux
    p(20, 'chrome'), p(21, 'code'), p(22, 'systemd'), p(23, 'kworker/0:1'), p(24, 'claude'),
    p(25, 'node', 10, { cmd: 'node /home/x/.claude/plugins/cache/claude-hadouken/hadouken/0.5.5/src/aprendizado/aprender.js' }),
    // macOS
    p(30, 'Google Chrome Helper (Renderer)'), p(31, 'Code Helper (Renderer)'), p(32, 'kernel_task'), p(33, 'WindowServer'), p(34, 'Safari'),
    p(35, 'node', 10, { cmd: 'node /Users/x/.npm/bin/claude' }),
  ]);
  assert.deepEqual(c, {
    10: 'navegador', 11: 'navegador', 12: 'navegador', 13: 'vscode', 14: 'claude', 15: 'sistema', 16: 'node-dev',
    17: 'hadouken', 18: 'outro', 4: 'sistema',
    20: 'navegador', 21: 'vscode', 22: 'sistema', 23: 'sistema', 24: 'claude', 25: 'hadouken',
    30: 'navegador', 31: 'vscode', 32: 'sistema', 33: 'sistema', 34: 'navegador', 35: 'claude',
  });
});

test('classificar ignora itens malformados e não lança', () => {
  assert.deepEqual(classificar(null), []);
  assert.deepEqual(classificar([null, 3, { pid: 'x' }, { pid: 5, nome: 7 }]).map((x) => x.pid), []);
  assert.equal(classificar([{ pid: 5, ppid: 1, nome: 'a', rssBytes: 1 }])[0].classe, 'outro');
});

test('sugerirFechar soma por app, tira sistema e a sessão, no máximo 5', () => {
  const lista = [
    p(100, 'chrome.exe', 300), p(101, 'chrome.exe', 200), p(102, 'chrome.exe', 100),
    p(110, 'Code.exe', 900), p(111, 'Code.exe', 400), p(112, 'Code.exe', 50),
    p(120, 'svchost.exe', 5000), p(130, 'claude.exe', 2000),
    p(140, 'Slack.exe', 700), p(150, 'Spotify.exe', 450), p(160, 'Teams.exe', 650),
    p(170, 'node.exe', 350, { cmd: 'node server.js' }), p(180, 'notepad.exe', 20),
    // A árvore da sessão: o terminal que hospeda o claude e um filho dele.
    p(190, 'WindowsTerminal.exe', 3000), p(191, 'claude.exe', 500, { ppid: 190 }), p(192, 'bash.exe', 2500, { ppid: 191 }),
  ];
  const s = sugerirFechar(classificar(lista), { pidSessao: 191 });
  assert.deepEqual(s, [
    { nome: 'Slack', rssBytes: 700 * MB },
    { nome: 'Teams', rssBytes: 650 * MB },
    { nome: 'chrome', rssBytes: 600 * MB },
    { nome: 'Code', rssBytes: 450 * MB },
    { nome: 'Spotify', rssBytes: 450 * MB },
  ]);
});

test('sugerirFechar sem pidSessao e com lista vazia', () => {
  assert.deepEqual(sugerirFechar([], {}), []);
  assert.deepEqual(sugerirFechar(null), []);
  // Uma janela só do VS Code nunca é sugerida.
  assert.deepEqual(sugerirFechar(classificar([p(1000, 'Code.exe', 900)]), {}), []);
});

test('encerraveis só pega hadouken com trava, cmd batendo e 3× o prazo', () => {
  const cmd = 'node /x/claude-hadouken/hadouken/0.5.5/src/saude/coletor-main.js';
  const lista = classificar([
    p(500, 'node', 10, { cmd }),
    p(501, 'notepad.exe'), // pid de trava velha reaproveitado por outro processo
    p(502, 'node', 10, { cmd }),
    p(503, 'node', 10, { cmd: 'node /x/claude-hadouken/hadouken/0.5.5/src/aprendizado/aprender.js' }),
  ]);
  const agora = 1_000_000;
  const travas = [
    { pid: 500, script: 'coletor-main', inicioMs: agora - 24_001, prazoMs: 8000 },
    { pid: 501, script: 'coletor-main', inicioMs: agora - 100_000, prazoMs: 8000 },
    { pid: 502, script: 'coletor-main', inicioMs: agora - 23_200, prazoMs: 8000 }, // 2,9×
    { pid: 503, script: 'coletor-main', inicioMs: agora - 100_000, prazoMs: 8000 }, // cmd é do aprender
    { pid: 'x', script: 'coletor-main', inicioMs: 0, prazoMs: 1 },
    null,
  ];
  assert.deepEqual(encerraveis(lista, travas, agora), [500]);
  assert.deepEqual(encerraveis(lista, null, agora), []);
  // Sem a linha de comando (como fica em saude.json), vale o `script` guardado.
  assert.deepEqual(lista.map((x) => x.script ?? null), ['coletor-main', null, 'coletor-main', 'aprender']);
  const semCmd = lista.map(({ cmd, ...resto }) => resto);
  assert.deepEqual(encerraveis(semCmd, travas, agora), [500]);
});

test('nome com controle ou gigante é saneado em 60', () => {
  assert.equal(sanearNome('a\u0000b\u001bc\u202ed\u007fe\r\nf'), 'abcdef');
  assert.equal(sanearNome('x'.repeat(500)).length, 60);
  assert.equal(sanearNome('  São Paulo.exe  '), 'São Paulo.exe');
  assert.equal(sanearNome(42), '');
  const [x] = classificar([p(1, 'z'.repeat(300))]);
  assert.equal(x.nome.length, 60);
});

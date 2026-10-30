import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Spec v0.5.3 VS Code §3 (Task 9): a logo animada (no próprio item e em loop
// desde a v0.5.8), os
// segmentos de energia e a seta da versão nova, com o `vscode` falso e um
// painel.mjs de teste na pasta de dados. O relógio é o mock.timers do
// node:test (setTimeout e setInterval); as promessas e o import() do shim
// andam com setImmediate, que fica de fora do mock.

const requireDaqui = createRequire(import.meta.url);
const Module = requireDaqui('node:module');
const { criar } = requireDaqui('./vscode-falso.cjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQ_EXTENSAO = path.join(repo, 'vscode', 'extension.cjs');
const QUADROS = ['$(hadouken-0)', '$(hadouken-1)', '$(hadouken-2)', '$(hadouken-3)', '$(hadouken-4)'];

// O painel novo lê tudo de globalThis.hdk; `portao`, quando é uma promessa,
// segura o ultimoEvento até ela resolver, e `ems` dá um `em` por chamada.
const PAINEL_NOVO = `const g = () => globalThis.hdk;
export function estadoPainel(o) { g().desenhos++; return { texto: '5h 55% · sem — · Fable —', nivel: g().nivel, dica: 'dica', pcts: g().pcts }; }
export async function talvezAtualizar(o) { g().leituras.push(o); return { feito: false, motivo: 'recente' }; }
export async function ultimoEvento() { await g().portao; const em = g().ems.length > 0 ? g().ems.shift() : g().em; return em === null ? null : { tipo: 'leitura', urgencia: 'calma', em }; }
export async function estadoVersao() { return { nova: g().nova, instalada: '0.5.4' }; }
export async function lerConfiguracao() { return { versao: g().versaoCfg, itens: [{ id: 'painel.animarLogo', valor: g().animarLogo }, { id: 'barra.ctx.amarelo', valor: 70 }] }; }
export async function gravarConfiguracao(m, o) { g().gravacoes.push([m, o]); return g().respostaGravar; }
export async function voltarAoPadrao(ids, o) { g().gravacoes.push([ids, o]); return g().respostaGravar; }
export async function desfazer(t) { g().desfeitos.push(t); return { ok: true }; }
export async function comandoAtualizar(p) { return { shell: p === 'win32' ? 'powershell' : 'posix', texto: 'atualizar-' + p }; }
export async function resumoRoteamento7d() { return null; }
export async function talvezConsultarVersao(o) { g().consultas.push(o); return null; }
export async function estadoSaude() { return g().saude; }
export async function barraSaude() { return g().barraSaude; }
export async function mudarModo(leve) { g().modos.push(leve); return { ok: true }; }
`;
const PAINEL_VELHO = `const g = () => globalThis.hdk;
export function estadoPainel(o) { g().desenhos++; return { texto: '5h 25% · sem 41% · Fable 57%', nivel: 'ok', dica: '' }; }
export async function talvezAtualizar(o) { g().leituras.push(o); return { feito: true, motivo: 'ok' }; }
`;

async function esperar(cond, voltas = 20_000) {
  for (let i = 0; i < voltas && !cond(); i++) await new Promise((r) => setImmediate(r));
  return cond();
}

// Ativa a extensão com o shim dado e o relógio falso. Devolve os dois itens e
// um `fim` para o finally.
async function montar(t, { shim = PAINEL_NOVO, hdk = {}, reduceMotion = 'off', globalState = new Map(), respostas = [] } = {}) {
  globalThis.hdk = {
    desenhos: 0, leituras: [], nivel: 'ok', pcts: { h5: 55, d7: null, fable: null }, em: 1, ems: [], portao: null, nova: null, animarLogo: true,
    versaoCfg: 'ausente', gravacoes: [], desfeitos: [], respostaGravar: { ok: true, desfazer: { antes: {}, versaoDepois: 'v', ate: 1 } }, consultas: [],
    saude: null, barraSaude: null, modos: [], ...hdk,
  };
  const { api, estado } = criar();
  estado.reduceMotion = reduceMotion;
  estado.respostas.push(...respostas);
  const cargaOriginal = Module._load;
  Module._load = function carregar(pedido, ...resto) { return pedido === 'vscode' ? api : cargaOriginal.call(this, pedido, ...resto); };
  const homeAntes = process.env.HADOUKEN_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk extensao ç '));
  fs.mkdirSync(path.join(home, 'bin'));
  fs.writeFileSync(path.join(home, 'bin', 'painel.mjs'), shim);
  process.env.HADOUKEN_HOME = home;
  delete requireDaqui.cache[requireDaqui.resolve(ARQ_EXTENSAO)];
  const ext = requireDaqui(ARQ_EXTENSAO);
  const ctx = {
    subscriptions: [], extensionUri: api.Uri.file(path.join(repo, 'vscode')),
    globalState: { get: (k) => globalState.get(k), update: async (k, v) => { globalState.set(k, v); } },
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  ext.activate(ctx);
  const fim = () => {
    for (const d of ctx.subscriptions) try { d.dispose(); } catch { /* já descartado */ }
    try { ext.deactivate(); } catch { /* já desativada */ }
    Module._load = cargaOriginal;
    delete globalThis.hdk;
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
    fs.rmSync(home, { recursive: true, force: true });
  };
  const uso = estado.itens.find((i) => i.id === 'claudeHadouken.uso');
  // O primeiro tique desenha.
  assert.ok(await esperar(() => globalThis.hdk.desenhos > 0), 'o primeiro tique não desenhou');
  return { ext, api, estado, uso, fim, globalState, home };
}

// Um tique do relógio de 5 s, esperando o desenho que ele faz.
async function tique(t) {
  const antes = globalThis.hdk.desenhos;
  t.mock.timers.tick(5_000);
  assert.ok(await esperar(() => globalThis.hdk.desenhos > antes), 'o tique não desenhou');
}

test('_teste: quadros e segmentos de energia', () => {
  const { api } = criar();
  const cargaOriginal = Module._load;
  Module._load = function carregar(pedido, ...resto) { return pedido === 'vscode' ? api : cargaOriginal.call(this, pedido, ...resto); };
  try {
    delete requireDaqui.cache[requireDaqui.resolve(ARQ_EXTENSAO)];
    const { _teste } = requireDaqui(ARQ_EXTENSAO);
    assert.deepEqual(_teste.quadros(), QUADROS);
    const s = _teste.segmentos(55);
    assert.equal(s.length, 8);
    assert.equal(s.filter((x) => x === '$(hadouken-seg-cheio)').length, 4);
    assert.equal(s.filter((x) => x === '$(hadouken-seg-meio)').length, 1);
    assert.equal(s.filter((x) => x === '$(hadouken-seg-vazio)').length, 3);
    assert.deepEqual(_teste.segmentos(0), Array(8).fill('$(hadouken-seg-vazio)'));
    assert.deepEqual(_teste.segmentos(100), Array(8).fill('$(hadouken-seg-cheio)'));
    assert.deepEqual(_teste.segmentos(250), Array(8).fill('$(hadouken-seg-cheio)'));
    for (const ruim of [null, Number.NaN, '55', undefined]) assert.equal(_teste.segmentos(ruim), null, String(ruim));
  } finally {
    Module._load = cargaOriginal;
  }
});

test('plugin novo: um item só, com a logo no começo, o comando da janela e segmentos no lugar das porcentagens soltas', async (t) => {
  const m = await montar(t, { hdk: { nivel: 'aviso' } });
  try {
    assert.equal(m.estado.itens.length, 1);
    assert.equal(m.uso.prioridade, 100);
    assert.equal(m.uso.command, 'claudeHadouken.abrirJanela');
    // Sem cor própria: a logo segue a cor do texto da barra, em qualquer tema.
    assert.equal(m.uso.color, undefined);
    assert.equal(m.uso.backgroundColor.id, 'statusBarItem.warningBackground');
    const segs = ['cheio', 'cheio', 'cheio', 'cheio', 'meio', 'vazio', 'vazio', 'vazio'].map((s) => `$(hadouken-seg-${s})`).join('');
    assert.equal(m.uso.text, `$(hadouken-0) 5h ${segs} 55% · sem — · Fable —`);
  } finally {
    m.fim();
  }
});

test('animação: os quadros giram sem parar, como um gif, e o resto do texto fica', async (t) => {
  const m = await montar(t);
  try {
    const resto = m.uso.text.slice(m.uso.text.indexOf(' '));
    const vistos = [];
    for (let i = 0; i < 12; i++) {
      t.mock.timers.tick(120);
      vistos.push(m.uso.text.slice(0, m.uso.text.indexOf(' ')));
      assert.equal(m.uso.text.slice(m.uso.text.indexOf(' ')), resto);
    }
    assert.deepEqual(vistos, [1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2].map((k) => QUADROS[k]));
    // Um tique de 5 s redesenha sem parar o loop.
    await tique(t);
    const antes = m.uso.text;
    t.mock.timers.tick(120);
    assert.notEqual(m.uso.text, antes);
  } finally {
    m.fim();
  }
});

test('janela sem foco: a logo para no quadro 0 e volta a girar com o foco', async (t) => {
  const m = await montar(t);
  try {
    t.mock.timers.tick(240);
    m.api.window.state = { focused: false };
    const n = m.uso.historico.length;
    t.mock.timers.tick(1_200);
    assert.ok(m.uso.text.startsWith('$(hadouken-0) '));
    assert.equal(m.uso.historico.length, n + 1);
    m.api.window.state = { focused: true };
    t.mock.timers.tick(120);
    assert.ok(m.uso.text.startsWith('$(hadouken-1) '));
  } finally {
    m.fim();
  }
});

test('movimento reduzido: a logo fica no quadro 0', async (t) => {
  const m = await montar(t, { reduceMotion: 'on' });
  try {
    t.mock.timers.tick(1_200);
    assert.ok(m.uso.text.startsWith('$(hadouken-0) '));
    assert.ok(m.uso.historico.every((x) => !x.includes('$(hadouken-1)')));
  } finally {
    m.fim();
  }
});

test('painel.animarLogo false: não anima', async (t) => {
  const m = await montar(t, { hdk: { animarLogo: false } });
  try {
    t.mock.timers.tick(1_200);
    assert.ok(m.uso.text.startsWith('$(hadouken-0) '));
    assert.ok(m.uso.historico.every((x) => !x.includes('$(hadouken-1)')));
  } finally {
    m.fim();
  }
});

test('plugin velho: um item como hoje, e o clique atualiza o uso', async (t) => {
  const m = await montar(t, { shim: PAINEL_VELHO });
  try {
    assert.equal(m.uso.text, '$(pulse) 5h 25% · sem 41% · Fable 57%');
    assert.equal(m.uso.command, 'claudeHadouken.atualizarUso');
    assert.ok(!m.uso.text.includes('$(hadouken-'));
    await m.api.commands.executeCommand(m.uso.command);
    assert.ok(globalThis.hdk.leituras.some((o) => o?.forcar === true));
  } finally {
    m.fim();
  }
});

test('v0.5.7: o shim do painel muda (plugin atualizado) e o próximo tique já usa o módulo novo, sem Reload Window', async (t) => {
  const m = await montar(t, { shim: PAINEL_VELHO });
  try {
    assert.equal(m.uso.command, 'claudeHadouken.atualizarUso');
    fs.writeFileSync(path.join(m.home, 'bin', 'painel.mjs'), PAINEL_NOVO);
    t.mock.timers.tick(5_000);
    assert.ok(await esperar(() => m.uso.command === 'claudeHadouken.abrirJanela'), 'continuou no módulo velho');
    // Shim igual: o módulo fica (nenhuma recarga a cada tique).
    const desenhos = globalThis.hdk.desenhos;
    await tique(t);
    assert.ok(globalThis.hdk.desenhos > desenhos);
    assert.equal(m.uso.command, 'claudeHadouken.abrirJanela');
  } finally {
    m.fim();
  }
});

test('versão nova: o item de uso termina com a seta e a versão', async (t) => {
  const m = await montar(t, { hdk: { nova: '0.5.9' } });
  try {
    assert.ok(m.uso.text.endsWith(' $(hadouken-seta) 0.5.9'), m.uso.text);
    globalThis.hdk.nova = '../../x';
    await tique(t);
    assert.doesNotMatch(m.uso.text, /seta/);
  } finally {
    m.fim();
  }
});

// --- a janela (Task 10) ---------------------------------------------------------

// Abre a janela e espera o primeiro estado que ela recebe depois do 'pronto'.
async function abrir(m) {
  await m.api.commands.executeCommand('claudeHadouken.abrirJanela');
  const painel = m.estado.paineis[0];
  await painel.receber({ tipo: 'pronto' });
  assert.ok(await esperar(() => painel.enviadas.some((x) => x.tipo === 'estado')));
  return painel;
}

test('janela: dois cliques dão um painel e um reveal; HTML com nonce e a CSP da spec', async (t) => {
  const m = await montar(t);
  try {
    await m.api.commands.executeCommand('claudeHadouken.abrirJanela');
    await m.api.commands.executeCommand('claudeHadouken.abrirJanela');
    assert.equal(m.estado.criacoesDePainel, 1);
    const painel = m.estado.paineis[0];
    assert.equal(painel.revelado, 1);
    assert.equal(painel.coluna, m.api.ViewColumn.Beside);
    assert.equal(painel.opcoes.enableScripts, true);
    const raizes = painel.opcoes.localResourceRoots.map((u) => u.fsPath.replace(/\\/g, '/'));
    assert.equal(raizes.length, 2);
    assert.ok(raizes[0].endsWith('vscode/janela'), raizes[0]);
    assert.ok(raizes[1].endsWith('vscode/icones'), raizes[1]);
    const html = painel.webview.html;
    const nonce = /<script nonce="([A-Za-z0-9+/=]+)"/.exec(html)?.[1];
    assert.ok(nonce && nonce.length >= 24, nonce);
    assert.ok(html.includes(`content="default-src 'none'; img-src vscode-resource: data:; style-src vscode-resource:; script-src 'nonce-${nonce}'; font-src vscode-resource:"`));
    assert.doesNotMatch(html, /\{\{/);
    // Fechar e abrir de novo cria outro painel, com outro nonce.
    painel.dispose();
    await m.api.commands.executeCommand('claudeHadouken.abrirJanela');
    assert.equal(m.estado.criacoesDePainel, 2);
    assert.notEqual(/<script nonce="([^"]+)"/.exec(m.estado.paineis[1].webview.html)[1], nonce);
  } finally {
    m.fim();
  }
});

test('janela: o estado leva painel, config, versão e movimento reduzido', async (t) => {
  const m = await montar(t, { reduceMotion: 'on', hdk: { nova: '0.5.9' } });
  try {
    const painel = await abrir(m);
    const e = painel.enviadas.find((x) => x.tipo === 'estado');
    assert.equal(e.movimentoReduzido, true);
    assert.equal(e.versaoNova, '0.5.9');
    assert.equal(e.versaoInstalada, '0.5.4');
    assert.deepEqual(e.painel.pcts, { h5: 55, d7: null, fable: null });
    assert.equal(e.config.versao, 'ausente');
    assert.equal(e.roteamento, null);
    // O tique de 5 s manda de novo.
    const antes = painel.enviadas.length;
    await tique(t);
    assert.ok(await esperar(() => painel.enviadas.length > antes));
  } finally {
    m.fim();
  }
});

// --- saúde do PC (v0.5.5, Task 13) ---------------------------------------------

const SAUDE = {
  idadeMs: 12_000, leve: false, ateMs: null,
  medidas: [
    { chave: 'ram', rotulo: 'RAM', pct: 94, valor: '94% de 16 GB', urgencia: 'urgente' },
    { chave: 'gpu', rotulo: 'GPU', pct: null, valor: 'não disponível neste PC', urgencia: 'calma' },
  ],
  sugestoes: [{ nome: '<img src=x onerror=alert(1)>', rssBytes: 3 * 1024 ** 3 }],
  acaoLeve: 'ligar', barra: 'PC: RAM 94%', resumo: 'Hooks: no tempo · Reparos: nenhum',
};

test('janela: o estado traz a saúde conferida; forma estranha cai fora', async (t) => {
  const estranha = {
    ...SAUDE, idadeMs: -5, acaoLeve: 'apagar',
    medidas: [...SAUDE.medidas, { chave: 'xyz', rotulo: 'X', pct: 5, valor: 'v', urgencia: 'calma' }, { chave: 'cpu', rotulo: 'CPU', pct: 900, valor: 'v', urgencia: 'calma' }],
    sugestoes: [...SAUDE.sugestoes, { nome: 5, rssBytes: 1 }],
  };
  const m = await montar(t, { hdk: { saude: estranha } });
  try {
    const e = (await abrir(m)).enviadas.find((x) => x.tipo === 'estado');
    assert.equal(e.saude.idadeMs, null);
    assert.equal(e.saude.acaoLeve, null);
    // Chave desconhecida sai; pct fora de 0–100 fica sem feixe (null).
    assert.deepEqual(e.saude.medidas.map((x) => x.chave), ['ram', 'gpu', 'cpu']);
    assert.equal(e.saude.medidas[1].pct, null);
    assert.equal(e.saude.medidas[2].pct, null);
    assert.deepEqual(e.saude.sugestoes, SAUDE.sugestoes, 'o nome vai como texto; a página usa textContent');
    assert.equal(e.saude.resumo, SAUDE.resumo);
  } finally {
    m.fim();
  }
});

test('janela: painel sem estadoSaude (plugin 0.5.4) manda saude null', async (t) => {
  const semSaude = PAINEL_NOVO.split('\n').filter((l) => !/estadoSaude|barraSaude|mudarModo/.test(l)).join('\n');
  const v = await montar(t, { shim: semSaude });
  try {
    const e = (await abrir(v)).enviadas.find((x) => x.tipo === 'estado');
    assert.equal(e.saude, null);
  } finally {
    v.fim();
  }
});

test('janela: ligarLeve e desligarLeve chamam mudarModo e reenviam o estado; sem mudarModo, nada', async (t) => {
  const m = await montar(t, { hdk: { saude: SAUDE } });
  try {
    const painel = await abrir(m);
    const antes = painel.enviadas.filter((x) => x.tipo === 'estado').length;
    await painel.receber({ tipo: 'ligarLeve' });
    await painel.receber({ tipo: 'desligarLeve' });
    await painel.receber({ tipo: 'ligarLeve', leve: 'x' });
    assert.deepEqual(globalThis.hdk.modos, [true, false, true]);
    assert.ok(painel.enviadas.filter((x) => x.tipo === 'estado').length >= antes + 3);
  } finally {
    m.fim();
  }
});

test('barra do VS Code: o segmento da saúde entra depois do uso; texto fora da forma não entra', async (t) => {
  const m = await montar(t, { hdk: { barraSaude: 'PC: GPU 89°C, leve' } });
  try {
    await tique(t);
    assert.ok(await esperar(() => m.uso.text.endsWith(' · PC: GPU 89°C, leve')), m.uso.text);
    globalThis.hdk.barraSaude = '$(alert) <b>x</b>';
    await tique(t);
    assert.ok(await esperar(() => !m.uso.text.includes('PC:') && !m.uso.text.includes('<b>')), m.uso.text);
  } finally {
    m.fim();
  }
});

test('janela: mensagem fora da lista ou com forma errada não grava; chave desconhecida é recusada', async (t) => {
  const m = await montar(t);
  try {
    const painel = await abrir(m);
    const ruins = [
      { tipo: 'xyz' }, null, 'salvar',
      { tipo: 'salvar', mudancas: { 'barra.ctx.amarelo': 'x' }, versao: 'ausente' },
      { tipo: 'salvar', mudancas: { 'barra.ctx.amarelo': 60 }, versao: '../x' },
      { tipo: 'salvar', mudancas: { 'a b': 1 }, versao: 'ausente' },
    ];
    for (const ruim of ruins) await painel.receber(ruim);
    await painel.receber({ tipo: 'salvar', mudancas: { 'nao.existe': 1 }, versao: 'ausente' });
    assert.deepEqual(globalThis.hdk.gravacoes, []);
    const recusas = painel.enviadas.filter((x) => x.tipo === 'recusado');
    assert.equal(recusas.length, 1);
    assert.equal(recusas[0].motivo, 'invalido');
  } finally {
    m.fim();
  }
});

test('janela: salvar válido grava com a versão, guarda o desfazer na extensão e manda salvo', async (t) => {
  const m = await montar(t);
  try {
    const painel = await abrir(m);
    await painel.receber({ tipo: 'salvar', mudancas: { 'barra.ctx.amarelo': 60 }, versao: 'ausente' });
    assert.deepEqual(globalThis.hdk.gravacoes, [[{ 'barra.ctx.amarelo': 60 }, { versao: 'ausente' }]]);
    const salvo = painel.enviadas.find((x) => x.tipo === 'salvo');
    assert.ok(Number.isFinite(salvo.desfazerAte));
    assert.equal(JSON.stringify(painel.enviadas).includes('versaoDepois'), false, 'o token não vai para a página');
    await painel.receber({ tipo: 'desfazer' });
    assert.deepEqual(globalThis.hdk.desfeitos, [{ antes: {}, versaoDepois: 'v', ate: 1 }]);
    // Um segundo desfazer não tem mais token.
    await painel.receber({ tipo: 'desfazer' });
    assert.equal(globalThis.hdk.desfeitos.length, 1);
    await painel.receber({ tipo: 'voltarPadrao', ids: ['barra.ctx.amarelo'], versao: 'ausente' });
    assert.deepEqual(globalThis.hdk.gravacoes.at(-1), [['barra.ctx.amarelo'], { versao: 'ausente' }]);
  } finally {
    m.fim();
  }
});

test('janela: config mudada em outro lugar volta como recusado com a config nova', async (t) => {
  const m = await montar(t, { hdk: { respostaGravar: { ok: false, motivo: 'mudou' } } });
  try {
    const painel = await abrir(m);
    globalThis.hdk.versaoCfg = '0123456789abcdef';
    await painel.receber({ tipo: 'salvar', mudancas: { 'barra.ctx.amarelo': 60 }, versao: 'ausente' });
    const r = painel.enviadas.find((x) => x.tipo === 'recusado');
    assert.equal(r.motivo, 'mudou');
    assert.equal(r.config.versao, '0123456789abcdef');
  } finally {
    m.fim();
  }
});

test('janela: atualizarHadouken abre o terminal "hadouken" com o comando do plugin; o segundo só mostra', async (t) => {
  // win32 só depois de montar: antes, no Linux e no macOS, o HADOUKEN_HOME
  // posix deixaria de ser caminho completo e o shim não carregaria.
  const m = await montar(t);
  const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const painel = await abrir(m);
    await painel.receber({ tipo: 'atualizarHadouken', comando: 'rm -rf /' });
    assert.equal(m.estado.terminais.length, 1);
    const term = m.estado.terminais[0];
    assert.deepEqual(term.opcoes, { name: 'hadouken', shellPath: 'powershell.exe' });
    assert.deepEqual(term.enviados, ['atualizar-win32']);
    term.mostrado = false;
    await painel.receber({ tipo: 'atualizarHadouken' });
    assert.equal(m.estado.terminais.length, 1);
    assert.deepEqual(term.enviados, ['atualizar-win32']);
    assert.equal(term.mostrado, true);
  } finally {
    m.fim();
    Object.defineProperty(process, 'platform', plataforma);
  }
});

// Task 11: o aviso de versão nova na extensão (spec §5).
const avisos = (m) => m.estado.mensagens.filter((a) => typeof a[0] === 'string' && a[0].startsWith('hadouken '));

test('versão nova: consulta no máximo a cada 10 min; avisa uma vez por versão', async (t) => {
  const m = await montar(t, { hdk: { nova: '0.5.9' } });
  try {
    assert.equal(globalThis.hdk.consultas.length, 1, 'o primeiro tique consulta');
    assert.deepEqual(globalThis.hdk.consultas[0], {});
    assert.ok(await esperar(() => avisos(m).length === 1));
    assert.deepEqual(avisos(m)[0], ['hadouken 0.5.9 disponível', 'Atualizar', 'Depois']);
    assert.equal(m.globalState.get('claudeHadouken.versaoAvisada'), '0.5.9');
    await tique(t);
    await tique(t);
    assert.equal(avisos(m).length, 1, 'a mesma versão não avisa de novo');
    assert.equal(globalThis.hdk.consultas.length, 1, 'menos de 10 min: sem consulta');
    t.mock.timers.tick(10 * 60_000);
    assert.ok(await esperar(() => globalThis.hdk.consultas.length === 2));
    globalThis.hdk.nova = '0.6.0';
    await tique(t);
    assert.ok(await esperar(() => avisos(m).length === 2));
    assert.equal(avisos(m)[1][0], 'hadouken 0.6.0 disponível');
  } finally {
    m.fim();
  }
});

test('versão nova: já avisada em outra janela não avisa; "Atualizar" abre o terminal', async (t) => {
  const m1 = await montar(t, { hdk: { nova: '0.5.9' }, globalState: new Map([['claudeHadouken.versaoAvisada', '0.5.9']]) });
  try {
    await tique(t);
    assert.equal(avisos(m1).length, 0);
    assert.match(m1.uso.text, /\$\(hadouken-seta\) 0\.5\.9$/, 'a marca no item continua');
  } finally {
    m1.fim();
  }
  t.mock.timers.reset();
  const m2 = await montar(t, { hdk: { nova: '0.5.9' }, respostas: ['Atualizar'] });
  try {
    assert.ok(await esperar(() => m2.estado.terminais.length === 1));
    assert.deepEqual(m2.estado.terminais[0].enviados, [`atualizar-${process.platform}`]);
  } finally {
    m2.fim();
  }
});

test('versão nova: "Depois" só grava; plugin velho não consulta nem lança', async (t) => {
  const m = await montar(t, { hdk: { nova: '0.5.9' }, respostas: ['Depois'] });
  try {
    assert.ok(await esperar(() => avisos(m).length === 1));
    await tique(t);
    assert.equal(m.estado.terminais.length, 0);
    assert.equal(m.globalState.get('claudeHadouken.versaoAvisada'), '0.5.9');
  } finally {
    m.fim();
  }
  t.mock.timers.reset();
  const v = await montar(t, { shim: PAINEL_VELHO });
  try {
    await tique(t);
    assert.equal(avisos(v).length, 0);
    assert.equal(globalThis.hdk.consultas.length, 0);
  } finally {
    v.fim();
  }
});

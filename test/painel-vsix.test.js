import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { crc32, crc32Tabela, MAX_ZIP_BYTES, montarVsix, montarZip } from '../src/painel/vsix.js';

// .vsix sem dependências (spec E4, Task 4): o zip montado passa por um leitor
// mínimo daqui, que percorre o diretório central, confere o cabeçalho local, o
// CRC (por uma conta bit a bit própria, independente da de vsix.js) e
// descomprime com inflateRawSync. No fim, a extensão (vscode/extension.cjs)
// roda com um módulo `vscode` falso: não há VS Code no CI, então isto só prova
// que ela carrega, desenha o item e chama o painel pelos nomes combinados; o
// teste manual do controlador cobre o VS Code de verdade.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACOTE = fs.readFileSync(path.join(repo, 'vscode', 'package.json'), 'utf8');
const EXTENSAO = fs.readFileSync(path.join(repo, 'vscode', 'extension.cjs'), 'utf8');
const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
// 1980-01-01 no formato de data do DOS: (ano - 1980) << 9 | mês << 5 | dia.
const DATA_DOS_1980 = (1 << 5) | 1;

// CRC-32 (polinômio refletido 0xEDB88320) bit a bit, sem tabela.
function crcBits(dados) {
  let c = 0xffffffff;
  for (const b of dados) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Leitor mínimo de zip: EOCD sem comentário nos últimos 22 bytes, diretório
// central colado nele, cada entrada conferida contra o cabeçalho local.
function lerZip(buf) {
  const fim = buf.length - 22;
  assert.equal(buf.readUInt32LE(fim), ASSINATURA_FIM, 'EOCD');
  assert.equal(buf.readUInt16LE(fim + 4), 0);
  assert.equal(buf.readUInt16LE(fim + 6), 0);
  const total = buf.readUInt16LE(fim + 10);
  assert.equal(buf.readUInt16LE(fim + 8), total);
  const tamCentral = buf.readUInt32LE(fim + 12);
  const iniCentral = buf.readUInt32LE(fim + 16);
  assert.equal(buf.readUInt16LE(fim + 20), 0, 'sem comentário');
  assert.equal(iniCentral + tamCentral, fim, 'diretório central colado no EOCD');
  const entradas = [];
  let p = iniCentral;
  for (let i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(p), ASSINATURA_CENTRAL, `central ${i}`);
    const metodo = buf.readUInt16LE(p + 10);
    const hora = buf.readUInt16LE(p + 12);
    const data = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const nNome = buf.readUInt16LE(p + 28);
    const nExtra = buf.readUInt16LE(p + 30);
    const nComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('latin1', p + 46, p + 46 + nNome);
    p += 46 + nNome + nExtra + nComentario;
    assert.equal(buf.readUInt32LE(local), ASSINATURA_LOCAL, `local ${nome}`);
    assert.equal(buf.readUInt16LE(local + 8), metodo, nome);
    assert.equal(buf.readUInt16LE(local + 10), hora, nome);
    assert.equal(buf.readUInt16LE(local + 12), data, nome);
    assert.equal(buf.readUInt32LE(local + 14), crc, nome);
    assert.equal(buf.readUInt32LE(local + 18), comprimido, nome);
    assert.equal(buf.readUInt32LE(local + 22), tamanho, nome);
    const nNomeLocal = buf.readUInt16LE(local + 26);
    assert.equal(buf.toString('latin1', local + 30, local + 30 + nNomeLocal), nome);
    const ini = local + 30 + nNomeLocal + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(ini, ini + comprimido);
    assert.ok(metodo === 0 || metodo === 8, `${nome}: método ${metodo}`);
    const dados = metodo === 8 ? zlib.inflateRawSync(bruto) : Buffer.from(bruto);
    assert.equal(dados.length, tamanho, nome);
    assert.equal(crcBits(dados), crc, `${nome}: CRC`);
    entradas.push({ nome, metodo, hora, data, dados });
  }
  assert.equal(p, fim);
  return entradas;
}

test('crc32: vetores conhecidos, a tabela de reserva e o zlib.crc32 (quando existe) dão o mesmo', () => {
  const casos = [['', 0], ['123456789', 0xcbf43926], ['The quick brown fox jumps over the lazy dog', 0x414fa339]];
  for (const [texto, esperado] of casos) {
    assert.equal(crc32(Buffer.from(texto)), esperado, texto);
    assert.equal(crc32Tabela(Buffer.from(texto)), esperado, texto);
  }
  const aleatorio = crypto.randomBytes(4096);
  assert.equal(crc32Tabela(aleatorio), crcBits(aleatorio));
  assert.equal(crc32(aleatorio), crcBits(aleatorio));
  if (typeof zlib.crc32 === 'function') assert.equal(crc32(aleatorio), zlib.crc32(aleatorio));
});

test('montarZip: entradas na ordem, deflate só quando reduz, data fixa de 1980 e montagem determinística', () => {
  const texto = Buffer.from('hadouken '.repeat(500));
  const ruido = crypto.randomBytes(1000);
  const entradas = [
    { nome: 'a.txt', dados: texto },
    { nome: 'pasta/sub/b.bin', dados: ruido },
    { nome: 'vazio', dados: Buffer.alloc(0) },
    { nome: '[Content_Types].xml', dados: Buffer.from('<x/>') },
  ];
  const zip = montarZip(entradas);
  assert.ok(Buffer.isBuffer(zip));
  const lidas = lerZip(zip);
  assert.deepEqual(lidas.map((e) => e.nome), entradas.map((e) => e.nome));
  assert.deepEqual(lidas.map((e) => e.metodo), [8, 0, 0, 0]);
  for (const [i, e] of lidas.entries()) {
    assert.ok(e.dados.equals(entradas[i].dados), e.nome);
    assert.equal(e.hora, 0, e.nome);
    assert.equal(e.data, DATA_DOS_1980, e.nome);
  }
  assert.ok(montarZip(entradas).equals(zip), 'mesma entrada, mesmos bytes');
  assert.equal(lerZip(montarZip([])).length, 0, 'zip vazio é só o EOCD');
});

test('montarZip: nome fora do ASCII seguro, "..", repetido, dados que não são Buffer e zip acima de 4 MiB dão null', () => {
  const um = (nome, dados = Buffer.from('x')) => montarZip([{ nome, dados }]);
  for (const nome of ['../x', 'a/../b', './a', 'a/./b', '..', '/abs', 'a/', 'a//b', '', 'a\\b', 'C:x', 'olá.txt', 'a b', 'a\nb', 'a\0b', 'x'.repeat(256), 42, null]) {
    assert.equal(um(nome), null, JSON.stringify(nome));
  }
  assert.equal(um('a', 'texto'), null);
  assert.equal(um('a', null), null);
  assert.equal(montarZip([{ nome: 'a', dados: Buffer.from('1') }, { nome: 'a', dados: Buffer.from('2') }]), null, 'repetido');
  assert.equal(montarZip(null), null);
  assert.equal(montarZip('a'), null);
  assert.equal(montarZip([null]), null);
  assert.equal(um('grande', crypto.randomBytes(MAX_ZIP_BYTES + 1)), null);
  const metade = crypto.randomBytes(MAX_ZIP_BYTES / 2);
  assert.equal(montarZip([{ nome: 'a', dados: metade }, { nome: 'b', dados: metade }]), null, 'soma acima do teto');
  assert.equal(MAX_ZIP_BYTES, 4 * 1024 * 1024);
});

test('montarVsix: as quatro entradas, o manifesto com a versão e o package.json com a versão trocada', () => {
  const vsix = montarVsix({ versao: '0.3.0', packageJson: PACOTE, extensionCjs: EXTENSAO });
  assert.ok(Buffer.isBuffer(vsix));
  const lidas = lerZip(vsix);
  assert.deepEqual(lidas.map((e) => e.nome), ['extension.vsixmanifest', '[Content_Types].xml', 'extension/package.json', 'extension/extension.cjs']);
  const [manifesto, tipos, pacote, extensao] = lidas.map((e) => e.dados.toString('utf8'));
  assert.match(manifesto, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(manifesto, /<Identity Language="en-US" Id="claude-hadouken-painel" Version="0\.3\.0" Publisher="gariolilabs" \/>/);
  assert.match(manifesto, /<InstallationTarget Id="Microsoft\.VisualStudio\.Code" \/>/);
  assert.match(manifesto, /<Property Id="Microsoft\.VisualStudio\.Code\.Engine" Value="\^1\.90\.0" \/>/);
  assert.match(manifesto, /<Asset Type="Microsoft\.VisualStudio\.Code\.Manifest" Path="extension\/package\.json" Addressable="true" \/>/);
  assert.match(manifesto, /<DisplayName>Claude Hadouken: painel de uso<\/DisplayName>/);
  for (const ext of ['.json', '.cjs', '.vsixmanifest', '.xml']) assert.ok(tipos.includes(`<Default Extension="${ext}" `), ext);
  const esperado = { ...JSON.parse(PACOTE), version: '0.3.0' };
  assert.deepEqual(JSON.parse(pacote), esperado);
  assert.deepEqual(Object.keys(JSON.parse(pacote)), Object.keys(JSON.parse(PACOTE)), 'mesma ordem de chaves');
  assert.equal(extensao, EXTENSAO);
  assert.ok(montarVsix({ versao: '0.3.0', packageJson: PACOTE, extensionCjs: EXTENSAO }).equals(vsix), 'determinístico');
});

test('montarVsix: versão fora de N.N.N, package.json inválido ou de outra extensão e fonte que não é texto dão null', () => {
  const base = { versao: '1.2.3', packageJson: PACOTE, extensionCjs: EXTENSAO };
  for (const versao of ['0.3', 'v0.3.0', '0.3.0-beta', '0.3.0\n', ' 0.3.0', '1.2.3.4', '1234567890.0.0', '', 42, null, undefined]) {
    assert.equal(montarVsix({ ...base, versao }), null, JSON.stringify(versao));
  }
  const outro = (mudar) => JSON.stringify({ ...JSON.parse(PACOTE), ...mudar });
  for (const packageJson of ['{', '[]', 'null', '"x"', outro({ name: 'outra' }), outro({ publisher: 'outro' }), 42, null]) {
    assert.equal(montarVsix({ ...base, packageJson }), null, String(packageJson).slice(0, 40));
  }
  assert.equal(montarVsix({ ...base, extensionCjs: Buffer.from('x') }), null);
  assert.equal(montarVsix(null), null);
  assert.equal(montarVsix(), null);
  // Texto do package.json vai escapado para o XML.
  const hostil = montarVsix({ ...base, packageJson: outro({ displayName: 'a <b> & "c"', description: '</Description><x>' }) });
  const manifesto = lerZip(hostil)[0].dados.toString('utf8');
  assert.match(manifesto, /<DisplayName>a &lt;b&gt; &amp; &quot;c&quot;<\/DisplayName>/);
  assert.ok(!manifesto.includes('<x>'));
});

// bsdtar lê zip: o tar do Windows 10+ (System32) e o do macOS. O GNU tar do
// Linux e o do Git Bash não leem: o teste pula.
test('o .vsix abre num leitor de zip de fora (tar -tf), se houver um', (t) => {
  const vsix = montarVsix({ versao: '0.3.0', packageJson: PACOTE, extensionCjs: EXTENSAO });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk vsix '));
  try {
    const arq = path.join(dir, 'x.vsix');
    fs.writeFileSync(arq, vsix);
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tar, ['-tf', arq], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    if (r.error || r.status !== 0) {
      t.skip(`tar indisponível ou sem suporte a zip (${r.error?.code ?? r.status})`);
      return;
    }
    assert.deepEqual(r.stdout.split(/\r?\n/).filter(Boolean).sort(), ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/extension.cjs', 'extension/package.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ vscode/

test('vscode/package.json: o manifesto do plano, sem dependências', () => {
  const p = JSON.parse(PACOTE);
  assert.deepEqual(p, {
    name: 'claude-hadouken-painel',
    displayName: 'Claude Hadouken: painel de uso',
    description: '5h, semana e Fable do plano Claude na barra de status, sem gastar tokens.',
    publisher: 'gariolilabs',
    version: '0.0.0',
    license: 'MIT',
    engines: { vscode: '^1.90.0' },
    main: './extension.cjs',
    activationEvents: ['onStartupFinished'],
    contributes: { commands: [{ command: 'claudeHadouken.atualizarUso', title: 'Claude Hadouken: atualizar uso agora' }] },
  });
  assert.doesNotMatch(PACOTE, /\r/);
});

test('vscode/extension.cjs: sintaxe válida e só require de vscode e de módulos node:', () => {
  const r = spawnSync(process.execPath, ['--check', path.join(repo, 'vscode', 'extension.cjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const requires = [...EXTENSAO.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]);
  assert.ok(requires.includes('vscode'));
  for (const m of requires) assert.ok(m === 'vscode' || m.startsWith('node:'), m);
  assert.doesNotMatch(EXTENSAO, /\r/);
});

// Um `vscode` falso só com o que a extensão usa: um item de barra, cores de
// tema, Markdown e comandos. O módulo do plugin é um painel.mjs falso na pasta
// de dados temporária, que anota as chamadas em globalThis.hdkChamadas.
function vscodeFalso() {
  const estado = { itens: [], comandos: new Map() };
  const api = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class { constructor(valor) { this.value = valor; } },
    window: {
      createStatusBarItem(id, alinhamento, prioridade) {
        const item = { id, alinhamento, prioridade, text: '', visivel: false, descartado: false, show() { this.visivel = true; }, hide() { this.visivel = false; }, dispose() { this.descartado = true; } };
        estado.itens.push(item);
        return item;
      },
    },
    commands: {
      registerCommand(nome, fn) {
        estado.comandos.set(nome, fn);
        return { dispose() { estado.comandos.delete(nome); } };
      },
    },
  };
  return { api, estado };
}

const PAINEL_FALSO = `export function estadoPainel(o) { (globalThis.hdkChamadas ??= []).push(['estadoPainel', o]); return { texto: '5h 25% · sem 41% · Fable 57%', nivel: globalThis.hdkNivel ?? 'aviso', dica: '**Sessão (5h):** 25%' }; }
export async function talvezAtualizar(o) { (globalThis.hdkChamadas ??= []).push(['talvezAtualizar', o]); return { feito: true, motivo: 'pouca-ram' }; }
`;

async function esperarAte(cond, ms = 5000) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

test('extensão com vscode falso: desenha o item pelo painel, chama os nomes combinados e se descarta sem sobrar relógio', async () => {
  const requireDaqui = createRequire(import.meta.url);
  const Module = requireDaqui('node:module');
  const { api, estado } = vscodeFalso();
  const cargaOriginal = Module._load;
  Module._load = function carregar(pedido, ...resto) { return pedido === 'vscode' ? api : cargaOriginal.call(this, pedido, ...resto); };
  const homeAntes = process.env.HADOUKEN_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk extensao ç '));
  const arqExtensao = path.join(repo, 'vscode', 'extension.cjs');
  const ctx = { subscriptions: [] };
  let ext;
  try {
    process.env.HADOUKEN_HOME = home;
    delete globalThis.hdkChamadas;
    ext = requireDaqui(arqExtensao);
    // Sem o shim: o aviso fixo, e nenhuma chamada ao painel.
    ext.activate(ctx);
    const [item] = estado.itens;
    assert.equal(item.id, 'claudeHadouken.uso');
    assert.equal(item.alinhamento, api.StatusBarAlignment.Right);
    assert.equal(item.prioridade, 100);
    assert.equal(item.command, 'claudeHadouken.atualizarUso');
    assert.equal(typeof item.name, 'string');
    assert.ok(item.visivel);
    assert.ok(await esperarAte(() => item.text === '$(pulse) Hadouken: abra uma sessão do Claude Code'), item.text);
    assert.equal(globalThis.hdkChamadas, undefined);
    // O shim aparece: o comando manual tenta de novo na hora (o relógio só
    // tentaria depois de 60 s), desenha e pede a leitura forçada.
    fs.mkdirSync(path.join(home, 'bin'));
    fs.writeFileSync(path.join(home, 'bin', 'painel.mjs'), PAINEL_FALSO);
    await estado.comandos.get('claudeHadouken.atualizarUso')();
    assert.equal(item.text, '$(pulse) 5h 25% · sem 41% · Fable 57%');
    assert.ok(item.backgroundColor instanceof api.ThemeColor);
    assert.equal(item.backgroundColor.id, 'statusBarItem.warningBackground');
    assert.ok(item.tooltip instanceof api.MarkdownString);
    assert.equal(item.tooltip.value, '**Sessão (5h):** 25%');
    const nomes = globalThis.hdkChamadas.map(([n, o]) => `${n} ${JSON.stringify(o)}`);
    assert.ok(nomes.includes('talvezAtualizar {"forcar":true}'), nomes.join(' | '));
    // O motivo da última leitura vai para o estadoPainel seguinte.
    assert.deepEqual(globalThis.hdkChamadas.at(-1), ['estadoPainel', { ultimoMotivo: 'pouca-ram' }]);
    for (const d of ctx.subscriptions) d.dispose();
    ext.deactivate();
    assert.ok(item.descartado);
    assert.equal(estado.comandos.size, 0);
    // Segunda ativação (módulo já carregado): o relógio desenha na hora, com a
    // cor de erro, e pede talvezAtualizar({}).
    globalThis.hdkNivel = 'erro';
    globalThis.hdkChamadas = [];
    const ctx2 = { subscriptions: [] };
    ext.activate(ctx2);
    const item2 = estado.itens[1];
    assert.ok(await esperarAte(() => item2.backgroundColor?.id === 'statusBarItem.errorBackground'));
    assert.ok(await esperarAte(() => globalThis.hdkChamadas.some(([n, o]) => n === 'talvezAtualizar' && JSON.stringify(o) === '{}')));
    for (const d of ctx2.subscriptions) d.dispose();
    ext.deactivate();
  } finally {
    Module._load = cargaOriginal;
    for (const d of ctx.subscriptions) try { d.dispose(); } catch { /* já descartado */ }
    try { ext?.deactivate(); } catch { /* já desativada */ }
    delete globalThis.hdkChamadas;
    delete globalThis.hdkNivel;
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('extensão: HADOUKEN_HOME relativo não carrega nada (a mesma regra de base.js)', async () => {
  const requireDaqui = createRequire(import.meta.url);
  const Module = requireDaqui('node:module');
  const { api, estado } = vscodeFalso();
  const cargaOriginal = Module._load;
  Module._load = function carregar(pedido, ...resto) { return pedido === 'vscode' ? api : cargaOriginal.call(this, pedido, ...resto); };
  const homeAntes = process.env.HADOUKEN_HOME;
  const arqExtensao = path.join(repo, 'vscode', 'extension.cjs');
  delete requireDaqui.cache[requireDaqui.resolve(arqExtensao)];
  const ctx = { subscriptions: [] };
  let ext;
  try {
    process.env.HADOUKEN_HOME = 'relativo';
    ext = requireDaqui(arqExtensao);
    ext.activate(ctx);
    await estado.comandos.get('claudeHadouken.atualizarUso')();
    assert.equal(estado.itens[0].text, '$(pulse) Hadouken: abra uma sessão do Claude Code');
  } finally {
    Module._load = cargaOriginal;
    for (const d of ctx.subscriptions) try { d.dispose(); } catch { /* já descartado */ }
    try { ext?.deactivate(); } catch { /* já desativada */ }
    if (homeAntes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = homeAntes;
  }
});

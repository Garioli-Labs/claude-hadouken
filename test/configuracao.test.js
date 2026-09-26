import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  arquivoSettings,
  comandoStatusline,
  statusLineProposta,
  planejarStatusline,
  consultarStatusline,
  aplicarStatusline,
  removerStatusline,
  MAX_SETTINGS_BYTES,
  MAX_BACKUPS,
} from '../src/configuracao.js';

// Instalador da statusline (spec 8.1 S7 e 8.2; task-11-security.md). O
// settings.json guarda permissões, hooks e às vezes segredos em `env`: é a
// gravação mais sensível do plugin. Todo teste usa HADOUKEN_SETTINGS e
// HADOUKEN_HOME numa pasta temporária; o settings.json de verdade nunca é lido
// nem gravado aqui (o beforeEach confere).

const SO_POSIX = process.platform === 'win32' && 'modo de arquivo é do POSIX';
// No Windows a junção não pede privilégio; no POSIX um symlink de pasta também não.
const LINK_PASTA = process.platform === 'win32' ? 'junction' : 'dir';
const REAL = (() => {
  try { return path.join(os.homedir(), '.claude', 'settings.json'); } catch { return null; }
})();
const mesmoCaminho = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

let dir;
let arq;
let homeDados;
const VARIAVEIS = ['HADOUKEN_HOME', 'HADOUKEN_SETTINGS', 'CLAUDE_CONFIG_DIR'];
const envAntes = Object.fromEntries(VARIAVEIS.map((v) => [v, process.env[v]]));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk cfg ç '));
  homeDados = path.join(dir, 'hadouken');
  arq = path.join(dir, 'settings.json');
  process.env.HADOUKEN_HOME = homeDados;
  process.env.HADOUKEN_SETTINGS = arq;
  // Um CLAUDE_CONFIG_DIR de quem roda os testes não entra em teste nenhum.
  delete process.env.CLAUDE_CONFIG_DIR;
  // Guarda: o arquivo alvo é o temporário, nunca o do usuário.
  assert.deepEqual(arquivoSettings(), { ok: true, arquivo: arq });
  if (REAL !== null) assert.ok(!mesmoCaminho(path.resolve(arquivoSettings().arquivo), path.resolve(REAL)));
});

afterEach(() => {
  for (const chave of VARIAVEIS) {
    if (envAntes[chave] === undefined) delete process.env[chave];
    else process.env[chave] = envAntes[chave];
  }
  // Somente leitura no Windows impede o rmSync: devolve a escrita antes.
  const liberar = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const c = path.join(p, e.name);
      try {
        const info = fs.lstatSync(c);
        if (info.isFile()) fs.chmodSync(c, 0o644);
        else if (info.isDirectory()) liberar(c);
      } catch { /* segue */ }
    }
  };
  try { liberar(dir); } catch { /* segue */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const alvoShim = () => path.join(homeDados, 'bin', 'statusline.mjs').split(path.sep).join('/');
const comandoEsperado = () => `node "${alvoShim()}"`;
const nossa = () => ({ type: 'command', command: comandoEsperado(), padding: 0 });
const bonito = (v, indent = 2) => `${JSON.stringify(v, null, indent)}\n`;
const ler = () => fs.readFileSync(arq);
const lerTexto = () => fs.readFileSync(arq, 'utf8');
const nomes = () => fs.readdirSync(dir).sort();
const backups = () => nomes().filter((n) => n.startsWith('settings.json.bak-hadouken-'));
const temporarios = () => nomes().filter((n) => n.endsWith('.tmp'));
const NOME_TMP = /\.hadouken-[0-9a-f]{12}\.tmp$/;

// Symlink de arquivo no Windows pede modo desenvolvedor; sem permissão o teste
// é pulado em vez de passar sem provar nada.
function link(t, alvo, caminho, tipo) {
  try {
    fs.symlinkSync(alvo, caminho, tipo);
    return true;
  } catch (e) {
    t.skip(`symlink indisponivel aqui (${e.code})`);
    return false;
  }
}

// Troca fs[nome] por um espião até a primeira chamada que casa com `casa`;
// nessa chamada restaura o original, roda `antes` e segue. Devolve o restaurador.
function espiar(nome, casa, antes) {
  const original = fs[nome];
  let disparou = false;
  fs[nome] = function espiao(...args) {
    if (!disparou && casa(...args)) {
      disparou = true;
      fs[nome] = original;
      antes(...args);
    }
    return original.apply(this, args);
  };
  return () => {
    fs[nome] = original;
    return disparou;
  };
}

// ---------------------------------------------------------------- ambiente

test('ambiente: HADOUKEN_SETTINGS e HADOUKEN_HOME apontam para a pasta temporária', () => {
  assert.equal(process.env.HADOUKEN_SETTINGS, arq);
  assert.equal(process.env.HADOUKEN_HOME, homeDados);
  assert.ok(arq.startsWith(os.tmpdir()));
  assert.equal(process.env.CLAUDE_CONFIG_DIR, undefined);
  assert.deepEqual(arquivoSettings(), { ok: true, arquivo: arq });
});

// Roda `corpo` sem HADOUKEN_SETTINGS e com os.homedir numa pasta falsa que
// nunca é criada: se a ordem dos caminhos errar, o resultado aponta para ela,
// nunca para o settings.json de verdade. Devolve a pasta falsa.
function semHadoukenSettings(corpo) {
  const original = os.homedir;
  const falso = path.resolve(os.tmpdir(), 'hdk-home-falso-nunca-criado');
  delete process.env.HADOUKEN_SETTINGS;
  try {
    os.homedir = () => falso;
    corpo(falso);
  } finally {
    os.homedir = original;
    process.env.HADOUKEN_SETTINGS = arq;
    delete process.env.CLAUDE_CONFIG_DIR;
  }
  assert.equal(fs.existsSync(falso), false);
  return falso;
}

const nuncaOReal = (r) => {
  if (r.ok && REAL !== null) assert.ok(!mesmoCaminho(path.resolve(r.arquivo), path.resolve(REAL)), r.arquivo);
  return r;
};

test('arquivoSettings: sem HADOUKEN_SETTINGS nem CLAUDE_CONFIG_DIR usa <home>/.claude/settings.json; sem home, sem-diretorio', () => {
  semHadoukenSettings((falso) => {
    assert.deepEqual(nuncaOReal(arquivoSettings()), { ok: true, arquivo: path.join(falso, '.claude', 'settings.json') });
    os.homedir = () => { throw new Error('sem home'); };
    assert.deepEqual(arquivoSettings(), { ok: false, motivo: 'sem-diretorio' });
    os.homedir = () => 'relativo';
    assert.deepEqual(arquivoSettings(), { ok: false, motivo: 'sem-diretorio' });
  });
});

test('arquivoSettings: HADOUKEN_SETTINGS relativo vira absoluto', () => {
  process.env.HADOUKEN_SETTINGS = path.join('rel', 'settings.json');
  assert.deepEqual(arquivoSettings(), { ok: true, arquivo: path.resolve('rel', 'settings.json') });
});

// Formas absolutas de cada sistema; path.isAbsolute decide, sem I/O.
const CONFIG_ABSOLUTOS = process.platform === 'win32'
  ? ['C:\\hdk\\config', 'C:/hdk/config', 'D:\\Dados do Usuário\\claude cfg\\', '\\\\servidor\\pasta\\cfg']
  : ['/hdk/config', '/home/usuário/claude cfg/', '/tmp/a b/c'];

test('arquivoSettings: CLAUDE_CONFIG_DIR absoluto vira <CLAUDE_CONFIG_DIR>/settings.json', () => {
  semHadoukenSettings(() => {
    for (const cfg of [path.join(dir, 'cfg'), ...CONFIG_ABSOLUTOS]) {
      process.env.CLAUDE_CONFIG_DIR = cfg;
      assert.deepEqual(nuncaOReal(arquivoSettings()), { ok: true, arquivo: path.join(cfg, 'settings.json') }, cfg);
    }
  });
});

test('arquivoSettings: CLAUDE_CONFIG_DIR definido mas relativo, vazio ou só espaços é config-dir-invalido', () => {
  const relativos = ['', ' ', '\t', 'cfg', path.join('rel', 'cfg'), '.claude', '~/.claude', '~', `.${path.sep}cfg`, 'C:cfg',
    ` ${path.join(dir, 'cfg')}`];
  semHadoukenSettings(() => {
    for (const cfg of relativos) {
      process.env.CLAUDE_CONFIG_DIR = cfg;
      assert.equal(process.env.CLAUDE_CONFIG_DIR, cfg);
      assert.deepEqual(arquivoSettings(), { ok: false, motivo: 'config-dir-invalido' }, JSON.stringify(cfg));
    }
  });
});

test('arquivoSettings: HADOUKEN_SETTINGS vence CLAUDE_CONFIG_DIR, válido ou não', () => {
  for (const cfg of [path.join(dir, 'cfg'), 'relativo', '']) {
    process.env.CLAUDE_CONFIG_DIR = cfg;
    assert.deepEqual(arquivoSettings(), { ok: true, arquivo: arq }, JSON.stringify(cfg));
  }
});

test('arquivoSettings: o arquivo de CLAUDE_CONFIG_DIR é o que consultar e aplicar usam', () => {
  const cfg = path.join(dir, 'cfg');
  semHadoukenSettings(() => {
    process.env.CLAUDE_CONFIG_DIR = cfg;
    const { arquivo } = nuncaOReal(arquivoSettings());
    assert.equal(arquivo, path.join(cfg, 'settings.json'));
    assert.equal(consultarStatusline({ arquivo }).acao, 'instalar');
    assert.deepEqual(aplicarStatusline({ arquivo, substituir: false, agoraMs: 1 }), { ok: true, acao: 'instalar', backup: null });
    assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')), { statusLine: nossa() });
  });
  assert.deepEqual(nomes(), ['cfg']);
});

// ---------------------------------------------------------------- comando

test('comando: node "<dirDados>/bin/statusline.mjs", aspas e barras normais', () => {
  const r = comandoStatusline();
  assert.deepEqual(r, { ok: true, comando: comandoEsperado() });
  assert.match(r.comando, /^node ".*\/hadouken\/bin\/statusline\.mjs"$/);
  assert.ok(!r.comando.includes('\\'));
  assert.deepEqual(statusLineProposta(), { ok: true, valor: nossa() });
});

// O comando só leva o caminho quando cada caractere dele, depois da troca de
// separador por /, está na lista do que pode entrar: letras e algarismos
// ASCII, espaço, / : . _ - ( ) + , @ ~ e as letras latinas de U+00C0 a
// U+024F, fora U+00D7 (vezes) e U+00F7 (dividido). Todo caractere não ASCII
// destes vetores é montado com String.fromCodePoint.
const cp = (n) => String.fromCodePoint(n);
const alvoDe = (home) => path.join(path.resolve(home), 'bin', 'statusline.mjs').split(path.sep).join('/');
const ACEITOS = [
  `C:/Users/Jos${cp(0xe9)} ${cp(0xd1)}and${cp(0xfa)}/.claude/hadouken`,
  '/home/ana-maria/.claude/hadouken',
  'C:/Users/Lucas Garioli/.claude/hadouken',
  `C:/Users/${cp(0xc7)}a${cp(0x11f)}r${cp(0x131)}/.claude/hadouken`,
  'C:/Users/LUCASG~1/AppData/Local/Temp/x (1) + a,b @c_d-e.f',
];

test('comando: pastas pessoais comuns, acentos latinos e ( ) + , @ ~ são aceitos', () => {
  // Nada é lido nem gravado. No POSIX, "C:/..." é relativo e resolve contra o
  // cwd, posto na pasta temporária (só caracteres aceitos).
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    for (const home of ACEITOS) {
      process.env.HADOUKEN_HOME = home;
      const alvo = alvoDe(home);
      assert.ok(alvo.endsWith(`${home}/bin/statusline.mjs`), alvo);
      assert.deepEqual(comandoStatusline(), { ok: true, comando: `node "${alvo}"` }, home);
    }
  } finally {
    process.chdir(cwd);
  }
});

test('comando: as bordas da faixa latina U+00C0 a U+024F são aceitas', () => {
  for (const n of [0xc0, 0xd6, 0xd8, 0xf6, 0xf8, 0xff, 0x100, 0x17f, 0x180, 0x24f]) {
    process.env.HADOUKEN_HOME = path.join(dir, `pasta${cp(n)}dados`);
    assert.deepEqual(comandoStatusline(), { ok: true, comando: `node "${alvoDe(process.env.HADOUKEN_HOME)}"` }, n.toString(16));
  }
});

// Todo o resto recusa com caminho-inseguro. É uma lista do que pode entrar,
// não do que não pode: a lista antiga de proibidos esquecia as aspas
// tipográficas, que o PowerShell trata como aspas (U+2018 a U+201B simples,
// U+201C a U+201E duplas) e que fechavam a string do comando. Também recusam,
// de propósito, o ASCII que as aspas duplas neutralizariam (& ' ; # ^...) e
// as letras de outros alfabetos (cirílico, CJK...): quem tem uma pasta
// pessoal assim instala à mão pela chave em "manual".
const PROIBIDOS = [
  ['aspas', '"'], ['crase', '`'], ['cifrão', '$'], ['porcento', '%'], ['exclamação', '!'],
  ['e comercial', '&'], ['apóstrofo', "'"], ['ponto e vírgula', ';'], ['cerquilha', '#'], ['circunflexo', '^'],
  ['asterisco', '*'], ['interrogação', '?'], ['colchete', '['], ['chave', '{'], ['menor', '<'], ['barra vertical', '|'], ['igual', '='],
  ['LF', '\n'], ['CR', '\r'], ['TAB', '\t'], ['SOH', cp(0x01)], ['ESC', cp(0x1b)],
  ['DEL', cp(0x7f)], ['NEL', cp(0x85)], ['CSI de 8 bits', cp(0x9b)], ['NBSP', cp(0xa0)],
  ['RLO bidi', cp(0x202e)], ['LS', cp(0x2028)], ['PS', cp(0x2029)],
  ['ZWSP', cp(0x200b)], ['BOM', cp(0xfeff)], ['tag', cp(0xe0041)],
  ['U+2018', cp(0x2018)], ['U+2019', cp(0x2019)], ['U+201A', cp(0x201a)], ['U+201B', cp(0x201b)],
  ['U+201C', cp(0x201c)], ['U+201D', cp(0x201d)], ['U+201E', cp(0x201e)],
  ['meia-risca U+2013', cp(0x2013)], ['travessão U+2014', cp(0x2014)],
  ['aspas de largura total U+FF02', cp(0xff02)], ['cifrão de largura total U+FF04', cp(0xff04)],
  ['vezes U+00D7', cp(0xd7)], ['dividido U+00F7', cp(0xf7)], ['antes da faixa U+00BF', cp(0xbf)], ['depois da faixa U+0250', cp(0x250)],
  ['cirílico U+0418', cp(0x418)], ['CJK U+4E2D', cp(0x4e2d)], ['letra fora do BMP U+1D400', cp(0x1d400)],
  ['marca combinante U+0301 (acento em NFD)', cp(0x301)],
];

test('comando: a sonda do revisor (aspas tipográficas + comando do PowerShell) recusa', () => {
  for (const n of [0x201c, 0x201d, 0x201e]) {
    process.env.HADOUKEN_HOME = path.join(dir, `rr11 x${cp(n)}; Write-Output INJETADO; ${cp(n)}`);
    assert.deepEqual(comandoStatusline(), { ok: false, motivo: 'caminho-inseguro' }, n.toString(16));
  }
});

test('comando: todo caractere fora da lista recusa com caminho-inseguro', () => {
  for (const [nome, c] of PROIBIDOS) {
    process.env.HADOUKEN_HOME = path.join(dir, `pasta${c}dados`);
    assert.deepEqual(comandoStatusline(), { ok: false, motivo: 'caminho-inseguro' }, nome);
    assert.deepEqual(statusLineProposta(), { ok: false, motivo: 'caminho-inseguro' }, nome);
    assert.deepEqual(planejarStatusline({}), { ok: false, motivo: 'caminho-inseguro' }, nome);
  }
});

test('caminho inseguro: aplicar e remover não tocam no settings.json', () => {
  const original = bonito({ permissions: { allow: [] } });
  fs.writeFileSync(arq, original);
  for (const [nome, c] of PROIBIDOS) {
    process.env.HADOUKEN_HOME = path.join(dir, `pasta${c}dados`);
    assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'caminho-inseguro' }, nome);
    assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: false, motivo: 'caminho-inseguro' }, nome);
    assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'caminho-inseguro' }, nome);
  }
  assert.equal(lerTexto(), original);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('barra invertida no nome de pasta: recusada no POSIX (continua \\ depois da conversão)', { skip: process.platform === 'win32' && 'no Windows \\ é separador' }, () => {
  process.env.HADOUKEN_HOME = path.join(dir, 'a\\b');
  assert.deepEqual(comandoStatusline(), { ok: false, motivo: 'caminho-inseguro' });
});

test('barra invertida no Windows é separador: vira / e o comando é aceito', { skip: process.platform !== 'win32' && 'só no Windows \\ é separador' }, () => {
  process.env.HADOUKEN_HOME = `${dir}\\a\\b`;
  const r = comandoStatusline();
  assert.equal(r.ok, true);
  assert.ok(!r.comando.includes('\\'));
  assert.ok(r.comando.endsWith('/a/b/bin/statusline.mjs"'));
});

test('sem home: sem-diretorio em comando, planejar e aplicar, sem I/O', () => {
  const original = os.homedir;
  delete process.env.HADOUKEN_HOME;
  try {
    os.homedir = () => { throw new Error('sem home'); };
    assert.deepEqual(comandoStatusline(), { ok: false, motivo: 'sem-diretorio' });
    assert.deepEqual(planejarStatusline({}), { ok: false, motivo: 'sem-diretorio' });
    assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'sem-diretorio' });
  } finally {
    os.homedir = original;
    process.env.HADOUKEN_HOME = homeDados;
  }
  assert.deepEqual(nomes(), []);
});

// ---------------------------------------------------------------- planejar

test('planejar: instalar, já instalado e conflito', () => {
  for (const s of [{}, null, undefined, { permissions: {} }]) {
    const p = planejarStatusline(s);
    assert.deepEqual(p, { ok: true, acao: 'instalar', atual: null, proposto: nossa() });
  }
  assert.equal(planejarStatusline({ statusLine: nossa() }).acao, 'ja-instalado');
  // Comando exato decide; padding ou outras chaves do usuário não importam.
  assert.equal(planejarStatusline({ statusLine: { ...nossa(), padding: 2, extra: true } }).acao, 'ja-instalado');
  const outra = { type: 'command', command: 'outra' };
  assert.deepEqual(planejarStatusline({ statusLine: outra }), { ok: true, acao: 'conflito', atual: outra, proposto: nossa() });
});

test('planejar: qualquer statusLine que não seja exatamente a nossa é conflito', () => {
  const variantes = [
    { type: 'command', command: 'node "/outra/copia/hadouken/bin/statusline.mjs"' },
    { type: 'command', command: `node ${alvoShim()}` },
    { type: 'command', command: `${comandoEsperado()} ` },
    { type: 'command', command: comandoEsperado().toUpperCase() },
    { type: 'static', command: comandoEsperado() },
    { command: comandoEsperado() },
    'texto', 0, null, false, [], [nossa()],
  ];
  for (const v of variantes) {
    assert.equal(planejarStatusline({ statusLine: v }).acao, 'conflito', JSON.stringify(v));
  }
});

test('planejar: só chaves próprias contam (__proto__ e protótipo herdado não instalam nem conflitam)', () => {
  const doJson = JSON.parse(`{"__proto__": {"statusLine": ${JSON.stringify(nossa())}}}`);
  assert.ok(Object.hasOwn(doJson, '__proto__'));
  assert.equal(planejarStatusline(doJson).acao, 'instalar');
  const herdado = Object.create({ statusLine: nossa() });
  assert.equal(planejarStatusline(herdado).acao, 'instalar');
  const linhaHerdada = { statusLine: Object.create({ type: 'command', command: comandoEsperado() }) };
  assert.equal(planejarStatusline(linhaHerdada).acao, 'conflito');
  // Cada campo conta sozinho: tipo herdado com comando próprio, e o contrário.
  const tipoHerdado = Object.assign(Object.create({ type: 'command' }), { command: comandoEsperado() });
  assert.equal(planejarStatusline({ statusLine: tipoHerdado }).acao, 'conflito');
  const comandoHerdado = Object.assign(Object.create({ command: comandoEsperado() }), { type: 'command' });
  assert.equal(planejarStatusline({ statusLine: comandoHerdado }).acao, 'conflito');
  assert.equal({}.statusLine, undefined);
});

test('planejar: topo que não é objeto é settings-invalido; nunca lança', () => {
  for (const s of [[], [{}], 'x', 3, true]) {
    assert.deepEqual(planejarStatusline(s), { ok: false, motivo: 'settings-invalido' }, JSON.stringify(s));
  }
  const hostil = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('C:\\segredo'); },
    get() { throw new Error('C:\\segredo'); },
    has() { throw new Error('C:\\segredo'); },
  });
  assert.deepEqual(planejarStatusline(hostil), { ok: false, motivo: 'settings-invalido' });
});

// ---------------------------------------------------------------- aplicar

test('aplicar: preserva as outras chaves e a ordem, grava bonito com \\n final e faz backup dos bytes', () => {
  const original = { permissions: { defaultMode: 'auto', allow: ['Bash(npm:*)'] }, hooks: { X: [] }, env: { SEGREDO: 'nao-mexer' } };
  const texto = bonito(original);
  fs.writeFileSync(arq, texto);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.deepEqual(r, { ok: true, acao: 'instalar', backup: `${arq}.bak-hadouken-1` });
  assert.equal(lerTexto(), bonito({ ...original, statusLine: nossa() }));
  assert.deepEqual(Object.keys(JSON.parse(lerTexto())), ['permissions', 'hooks', 'env', 'statusLine']);
  assert.deepEqual(fs.readFileSync(r.backup), Buffer.from(texto));
  assert.deepEqual(temporarios(), []);
});

test('aplicar: conflito sem substituir não altera nada nem cria backup', () => {
  const original = JSON.stringify({ statusLine: { type: 'command', command: 'outra' } });
  fs.writeFileSync(arq, original);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'conflito' });
  assert.equal(lerTexto(), original);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('aplicar: conflito com substituir troca a statusLine no mesmo lugar, com backup', () => {
  const original = { a: 1, statusLine: { type: 'command', command: 'outra', padding: 1 }, b: [2] };
  const texto = bonito(original);
  fs.writeFileSync(arq, texto);
  const r = aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 7 });
  assert.deepEqual(r, { ok: true, acao: 'substituir', backup: `${arq}.bak-hadouken-7` });
  assert.equal(lerTexto(), bonito({ a: 1, statusLine: nossa(), b: [2] }));
  assert.deepEqual(fs.readFileSync(r.backup), Buffer.from(texto));
});

test('aplicar: já instalado não grava nada (nem com substituir)', () => {
  const texto = bonito({ x: 1, statusLine: nossa() });
  fs.writeFileSync(arq, texto);
  const antes = fs.statSync(arq, { bigint: true });
  for (const substituir of [false, true]) {
    assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir, agoraMs: 1 }), { ok: true, acao: 'ja-instalado', backup: null });
  }
  const depois = fs.statSync(arq, { bigint: true });
  assert.equal(depois.mtimeNs, antes.mtimeNs);
  assert.equal(depois.ino, antes.ino);
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('aplicar: settings.json ausente é criado (e a pasta também), sem backup', () => {
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.deepEqual(r, { ok: true, acao: 'instalar', backup: null });
  assert.equal(lerTexto(), bonito({ statusLine: nossa() }));
  const fundo = path.join(dir, 'nova', 'pasta', 'settings.json');
  assert.deepEqual(aplicarStatusline({ arquivo: fundo, substituir: false, agoraMs: 1 }), { ok: true, acao: 'instalar', backup: null });
  assert.equal(fs.readFileSync(fundo, 'utf8'), bonito({ statusLine: nossa() }));
  assert.deepEqual(temporarios(), []);
});

test('aplicar e remover: JSON inválido, topo não objeto e vazio nunca são sobrescritos', () => {
  for (const texto of ['{ quebrado', '[]', 'null', '"texto"', '3', '', '{"a":1}{"b":2}', '{"a":1,}']) {
    fs.writeFileSync(arq, texto);
    for (const substituir of [false, true]) {
      assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir, agoraMs: 1 }), { ok: false, motivo: 'settings-invalido' }, texto);
    }
    assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: false, motivo: 'settings-invalido' }, texto);
    assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-invalido' }, texto);
    assert.equal(lerTexto(), texto);
    assert.deepEqual(nomes(), ['settings.json']);
  }
});

test('aplicar: bytes que não são UTF-8 (ex.: é em Latin-1) são settings-invalido, nunca regravados com U+FFFD', () => {
  const bytes = Buffer.concat([Buffer.from('{"nome":"Jos'), Buffer.from([0xe9]), Buffer.from('"}\n')]);
  fs.writeFileSync(arq, bytes);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'settings-invalido' });
  assert.deepEqual(ler(), bytes);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('aplicar: UTF-8 malformado (surrogate codificado, forma longa, byte solto, sequência cortada) é settings-invalido', () => {
  const ruins = [[0xed, 0xa0, 0x80], [0xc0, 0xaf], [0x80], [0xe2, 0x82], [0xf4, 0x90, 0x80, 0x80]];
  for (const ruim of ruins) {
    const bytes = Buffer.concat([Buffer.from('{"a":"x'), Buffer.from(ruim), Buffer.from('"}\n')]);
    fs.writeFileSync(arq, bytes);
    assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'settings-invalido' }, ruim.join(','));
    assert.deepEqual(ler(), bytes);
  }
  assert.deepEqual(nomes(), ['settings.json']);
});

// Um Node compilado sem ICU (tabela de https://nodejs.org/api/intl.html,
// coluna none) lança no new TextDecoder('utf-8', { fatal: true }) e acusa
// toda regex com escape de propriedade (\p{...} ou \P{...}) como erro
// antecipado: o módulo nem carregaria. A simulação importa, num filho em que
// o TextDecoder lança, uma cópia de src/ em que cada \p{X} virou
// \p{SemICU_X}: nome inválido, o mesmo SyntaxError na carga. O controle prova
// que a troca morde: um módulo com uma regex \p, copiado junto, não carrega.
test('sem ICU (sem TextDecoder e sem escapes \\p): o módulo carrega, valida UTF-8 e confere o caminho', () => {
  const semIcu = (texto) => texto.replace(/\\([pP])\{/g, (_, p) => `\\${p}{SemICU_`);
  const copia = path.join(dir, 'src sem icu');
  const copiar = (de, para) => {
    fs.mkdirSync(para, { recursive: true });
    for (const e of fs.readdirSync(de, { withFileTypes: true })) {
      if (e.isDirectory()) copiar(path.join(de, e.name), path.join(para, e.name));
      else if (e.name.endsWith('.js')) fs.writeFileSync(path.join(para, e.name), semIcu(fs.readFileSync(path.join(de, e.name), 'utf8')));
    }
  };
  copiar(fileURLToPath(new URL('../src/', import.meta.url)), copia);
  fs.writeFileSync(path.join(copia, 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(copia, 'controle.js'), semIcu('export const r = /\\p{L}/u;\n'));
  assert.ok(fs.readFileSync(path.join(copia, 'controle.js'), 'utf8').includes('SemICU_L'));
  const url = (nome) => pathToFileURL(path.join(copia, nome)).href;
  const latin1 = path.join(dir, 'latin1.json');
  fs.writeFileSync(latin1, Buffer.concat([Buffer.from('{"nome":"Jos'), Buffer.from([0xe9]), Buffer.from('"}\n')]));
  fs.writeFileSync(arq, bonito({ nome: `Jos${cp(0xe9)}` }));
  const aceito = path.join(dir, `Jos${cp(0xe9)} ${cp(0xd1)}and${cp(0xfa)}`);
  const recusado = path.join(dir, `x${cp(0x201d)}; Write-Output INJETADO; ${cp(0x201d)}`);
  const script = [
    "globalThis.TextDecoder = class { constructor() { throw Object.assign(new Error('sem ICU'), { code: 'ERR_NO_ICU' }); } };",
    "let controle = 'carregou';",
    `try { await import(${JSON.stringify(url('controle.js'))}); } catch (e) { controle = e?.name ?? 'erro'; }`,
    `const m = await import(${JSON.stringify(url('configuracao.js'))});`,
    `const a = m.aplicarStatusline({ arquivo: ${JSON.stringify(latin1)}, substituir: false, agoraMs: 1 });`,
    `const b = m.aplicarStatusline({ arquivo: ${JSON.stringify(arq)}, substituir: false, agoraMs: 2 });`,
    `process.env.HADOUKEN_HOME = ${JSON.stringify(aceito)};`,
    'const c = m.comandoStatusline();',
    `process.env.HADOUKEN_HOME = ${JSON.stringify(recusado)};`,
    'const d = m.comandoStatusline();',
    'process.stdout.write(JSON.stringify({ controle, a, b, c, d }));',
  ].join('\n');
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, HADOUKEN_HOME: homeDados, HADOUKEN_SETTINGS: arq }, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(p.error, undefined, String(p.error));
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(JSON.parse(p.stdout), {
    controle: 'SyntaxError',
    a: { ok: false, motivo: 'settings-invalido' },
    b: { ok: true, acao: 'instalar', backup: `${arq}.bak-hadouken-2` },
    c: { ok: true, comando: `node "${alvoDe(aceito)}"` },
    d: { ok: false, motivo: 'caminho-inseguro' },
  });
  assert.deepEqual(JSON.parse(lerTexto()), { nome: `Jos${cp(0xe9)}`, statusLine: nossa() });
});

// ---------------------------------------------------------------- fidelidade dos números

// Literais que o JSON.parse + JSON.stringify não regravam com o mesmo valor
// decimal: o texto que o usuário escreveu mudaria de sentido.
const NUMEROS_IMPRECISOS = [
  '12345678901234567890', '9007199254740993', '-9007199254740993', '123456789012345678', '10000000000000001',
  '-0', '-0.0', '-0e5', '-0.000E-3', '1e400', '-1e400', '1e-400', '-1e-400', '2.4703282292062328e-324',
  '0.1000000000000000055511151231257827', '3.14159265358979323846',
];
// Literais que saem com o mesmo valor, ainda que noutra grafia (1.0 vira 1).
const NUMEROS_EXATOS = [
  '0', '1', '-1', '1.0', '1E3', '1e+3', '1E-3', '0.1', '9007199254740992', '-9007199254740992', '1e23',
  '100000000000000000000', '5e-324', '123e-20', '1.50000000000000000000', `0.${'0'.repeat(30)}1`,
  '1.7976931348623157e308', '0e999999', '-1.5e-7', '0.000001',
];
const comNumero = (lit) => `{\n  "permissions": {\n    "allow": []\n  },\n  "limites": {\n    "n": [\n      1,\n      ${lit}\n    ]\n  }\n}\n`;

test('fidelidade: número que não regrava igual (inteiro > 2^53, -0, 1e400...) recusa com settings-numero-impreciso', () => {
  for (const lit of NUMEROS_IMPRECISOS) {
    const texto = comNumero(lit);
    JSON.parse(texto);
    fs.writeFileSync(arq, texto);
    for (const substituir of [false, true]) {
      assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir, agoraMs: 1 }), { ok: false, motivo: 'settings-numero-impreciso' }, lit);
    }
    assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-numero-impreciso' }, lit);
    assert.equal(lerTexto(), texto, lit);
    assert.deepEqual(nomes(), ['settings.json'], lit);
  }
});

test('fidelidade: número que regrava com o mesmo valor é aceito, na forma canônica', () => {
  let ms = 1;
  for (const lit of NUMEROS_EXATOS) {
    fs.writeFileSync(arq, comNumero(lit));
    assert.equal(consultarStatusline({ arquivo: arq }).acao, 'instalar', lit);
    const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: ms++ });
    assert.equal(r.ok, true, `${lit}: ${JSON.stringify(r)}`);
    const novo = JSON.parse(lerTexto());
    assert.ok(Object.is(novo.limites.n[1], Number(lit)), lit);
    assert.deepEqual(novo.statusLine, nossa());
    fs.rmSync(arq);
  }
});

test('fidelidade: remover também recusa; o arquivo e a nossa barra ficam', () => {
  const texto = bonito({ statusLine: nossa() }).replace(/\n}\n$/, ',\n  "id": 12345678901234567890\n}\n');
  fs.writeFileSync(arq, texto);
  assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: false, motivo: 'settings-numero-impreciso' });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('fidelidade: sem nada a gravar (já instalado, ou remover sem barra), o número não impede', () => {
  const instalado = bonito({ statusLine: nossa() }).replace(/\n}\n$/, ',\n  "zero": -0\n}\n');
  fs.writeFileSync(arq, instalado);
  assert.equal(consultarStatusline({ arquivo: arq }).acao, 'ja-instalado');
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: true, acao: 'ja-instalado', backup: null });
  const semBarra = '{"zero": -0}\n';
  fs.writeFileSync(arq, semBarra);
  assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: true, acao: 'nao-instalado', backup: null });
  assert.equal(lerTexto(), semBarra);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('fidelidade: o que só parece número dentro de texto (valor ou chave) não conta', () => {
  const texto = [
    '{',
    '  "s": "-0",',
    '  "t": "12345678901234567890",',
    '  "u": "a\\"-0 1e400",',
    '  "v": "\\\\",',
    '  "w": "\\\\\\"-0",',
    '  "12345678901234567890": [-1, 2.5, "1e400"],',
    '  "-0": {"x": "\\u0022-0"}',
    '}',
    '',
  ].join('\n');
  const antes = JSON.parse(texto);
  fs.writeFileSync(arq, texto);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(JSON.parse(lerTexto()), { ...antes, statusLine: nossa() });
});

test('fidelidade: número impreciso dentro da statusLine que sai também recusa (conferência do texto inteiro)', () => {
  const texto = '{"statusLine": {"type": "command", "command": "outra", "padding": -0}}\n';
  fs.writeFileSync(arq, texto);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-numero-impreciso' });
  assert.equal(lerTexto(), texto);
});

test('fidelidade: literal de milhões de algarismos perto do teto é recusado sem travar', { timeout: 30_000 }, () => {
  const casos = [
    [`{"n":${'1'.repeat(MAX_SETTINGS_BYTES - 16)}}`, 'settings-numero-impreciso'],
    [`{"n":1${'0'.repeat(MAX_SETTINGS_BYTES - 16)}1}`, 'settings-numero-impreciso'],
  ];
  for (const [texto, motivo] of casos) {
    fs.writeFileSync(arq, texto);
    assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo });
    assert.equal(fs.statSync(arq).size, texto.length);
  }
  // Exato apesar do tamanho: 0,000...01 × 10^n com o expoente certo é 0.1.
  const zeros = MAX_SETTINGS_BYTES - 64;
  fs.writeFileSync(arq, `{"n":0.${'0'.repeat(zeros)}1e${zeros}}`);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.parse(lerTexto()).n, 0.1);
});

test('aplicar: arquivo de 5 MB é settings-grande e fica intacto', () => {
  const texto = `{"x":"${'a'.repeat(5 * 1024 * 1024)}"}`;
  fs.writeFileSync(arq, texto);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-grande' });
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-grande' });
  assert.equal(fs.statSync(arq).size, texto.length);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('aplicar: arquivo acima do teto é recusado pelo lstat, sem nem ser aberto', () => {
  fs.writeFileSync(arq, `{"x":"${'a'.repeat(MAX_SETTINGS_BYTES)}"}`);
  const original = fs.openSync;
  let aberturas = 0;
  fs.openSync = function (p, ...resto) {
    if (p === arq) aberturas++;
    return original.call(this, p, ...resto);
  };
  try {
    assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'settings-grande' });
  } finally {
    fs.openSync = original;
  }
  assert.equal(aberturas, 0);
});

test('aplicar: o teto é 4 MiB exatos (no teto aceita, um byte acima recusa)', () => {
  assert.equal(MAX_SETTINGS_BYTES, 4 * 1024 * 1024);
  const comTamanho = (n) => `{"x":"${'a'.repeat(n - 8)}"}`;
  fs.writeFileSync(arq, comTamanho(MAX_SETTINGS_BYTES + 1));
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'settings-grande' });
  fs.writeFileSync(arq, comTamanho(MAX_SETTINGS_BYTES));
  assert.equal(fs.statSync(arq).size, MAX_SETTINGS_BYTES);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 2 });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(lerTexto()).x.length, MAX_SETTINGS_BYTES - 8);
});

test('aplicar: BOM é aceito e mantido; o backup guarda os bytes com BOM', () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const corpo = bonito({ model: 'opus' });
  const bytes = Buffer.concat([bom, Buffer.from(corpo)]);
  fs.writeFileSync(arq, bytes);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true);
  const novo = ler();
  assert.deepEqual(novo.subarray(0, 3), bom);
  assert.equal(novo.subarray(3).toString('utf8'), bonito({ model: 'opus', statusLine: nossa() }));
  assert.deepEqual(fs.readFileSync(r.backup), bytes);
});

test('aplicar: indentação do original é mantida (tab, 4 espaços); minificado vira 2 espaços; CRLF é mantido', () => {
  const casos = [
    [JSON.stringify({ a: { b: 1 } }, null, '\t'), '\t', '\n'],
    [JSON.stringify({ a: { b: 1 } }, null, 4), 4, '\n'],
    [JSON.stringify({ a: { b: 1 } }), 2, '\n'],
    [JSON.stringify({ a: { b: 1 } }, null, 2).replace(/\n/g, '\r\n'), 2, '\r\n'],
    [JSON.stringify({ a: { b: 1 } }, null, '\t').replace(/\n/g, '\r\n'), '\t', '\r\n'],
  ];
  let ms = 1;
  for (const [texto, indent, eol] of casos) {
    fs.writeFileSync(arq, texto);
    assert.equal(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: ms++ }).ok, true);
    const esperado = `${JSON.stringify({ a: { b: 1 }, statusLine: nossa() }, null, indent)}\n`.replace(/\n/g, eol);
    assert.equal(lerTexto(), esperado, JSON.stringify(texto));
  }
});

test('aplicar: chaves __proto__ e constructor sobrevivem byte a byte e nada vaza para o protótipo', () => {
  const texto = [
    '{',
    '  "__proto__": {',
    '    "statusLine": {',
    '      "type": "command",',
    '      "command": "x"',
    '    }',
    '  },',
    '  "constructor": {',
    '    "prototype": {',
    '      "polu": 1',
    '    }',
    '  },',
    '  "hooks": {',
    '    "__proto__": {',
    '      "a": 1',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(arq, texto);
  assert.equal(consultarStatusline({ arquivo: arq }).acao, 'instalar');
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true);
  const bloco = JSON.stringify(nossa(), null, 2).replace(/\n/g, '\n  ');
  assert.equal(lerTexto(), texto.replace(/\n}\n$/, `,\n  "statusLine": ${bloco}\n}\n`));
  assert.equal({}.statusLine, undefined);
  assert.equal({}.polu, undefined);
  assert.equal({}.a, undefined);
  // E sai de novo sem levar as chaves perigosas junto.
  assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 2 }).acao, 'remover');
  assert.equal(lerTexto(), texto);
});

test('aplicar: aninhamento que o JSON.stringify não aguenta vira serializacao, nada gravado', () => {
  const n = 200_000;
  const texto = `{"a":${'['.repeat(n)}${']'.repeat(n)}}`;
  fs.writeFileSync(arq, texto);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'serializacao' });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('aplicar: argumentos inválidos devolvem argumentos, nunca lançam', () => {
  const casos = [
    undefined, null, {}, { arquivo: 5, agoraMs: 1 }, { arquivo: arq }, { arquivo: arq, agoraMs: Number.NaN },
    { arquivo: arq, agoraMs: -1 }, { arquivo: arq, agoraMs: 1.5 }, { arquivo: arq, agoraMs: 2 ** 60 },
    { arquivo: 'relativo/settings.json', agoraMs: 1 }, { arquivo: `${arq}\0x`, agoraMs: 1 }, { arquivo: '', agoraMs: 1 },
  ];
  for (const c of casos) {
    assert.deepEqual(aplicarStatusline(c), { ok: false, motivo: 'argumentos' }, JSON.stringify(c));
    assert.deepEqual(removerStatusline(c), { ok: false, motivo: 'argumentos' }, JSON.stringify(c));
  }
  assert.deepEqual(consultarStatusline({ arquivo: 5 }), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(consultarStatusline(), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(nomes(), []);
});

// ---------------------------------------------------------------- links e tipos

test('settings.json como symlink de arquivo: settings-link, link e alvo intactos', (t) => {
  const alvo = path.join(dir, 'dotfiles-settings.json');
  const texto = bonito({ a: 1 });
  fs.writeFileSync(alvo, texto);
  if (!link(t, alvo, arq, 'file')) return;
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-link' });
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-link' });
  assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: false, motivo: 'settings-link' });
  assert.ok(fs.lstatSync(arq).isSymbolicLink());
  assert.equal(fs.readFileSync(alvo, 'utf8'), texto);
  assert.deepEqual(nomes(), ['dotfiles-settings.json', 'settings.json']);
});

test('settings.json como junção (ou symlink de pasta): settings-link, nada criado no alvo', (t) => {
  const alvo = path.join(dir, 'fora');
  fs.mkdirSync(alvo);
  if (!link(t, alvo, arq, LINK_PASTA)) return;
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-link' });
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-link' });
  assert.ok(fs.lstatSync(arq).isSymbolicLink());
  assert.deepEqual(fs.readdirSync(alvo), []);
  assert.deepEqual(nomes(), ['fora', 'settings.json']);
});

test('settings.json como junção pendente: settings-link, o alvo não é criado', (t) => {
  const alvo = path.join(dir, 'nao-existe');
  if (!link(t, alvo, arq, LINK_PASTA)) return;
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-link' });
  assert.equal(fs.existsSync(alvo), false);
});

test('settings.json com hard link: settings-link (o rename quebraria o outro nome)', (t) => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  const outro = path.join(dir, 'dotfiles-settings.json');
  try {
    fs.linkSync(arq, outro);
  } catch (e) {
    t.skip(`hard link indisponivel aqui (${e.code})`);
    return;
  }
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'settings-link' });
  assert.equal(lerTexto(), texto);
  assert.equal(fs.statSync(arq).nlink, 2);
  assert.deepEqual(nomes(), ['dotfiles-settings.json', 'settings.json']);
});

test('pasta no lugar do settings.json: settings-invalido', () => {
  fs.mkdirSync(arq);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-invalido' });
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-invalido' });
  assert.ok(fs.statSync(arq).isDirectory());
});

test('FIFO no lugar do settings.json: settings-invalido sem travar (POSIX)', { skip: process.platform === 'win32' && 'FIFO é do POSIX' }, () => {
  execFileSync('mkfifo', [arq]);
  const url = new URL('../src/configuracao.js', import.meta.url).href;
  const p = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { aplicarStatusline } from ${JSON.stringify(url)}; process.stdout.write(JSON.stringify(aplicarStatusline({ arquivo: ${JSON.stringify(arq)}, substituir: true, agoraMs: 1 })));`,
  ], { env: { ...process.env, HADOUKEN_HOME: homeDados, HADOUKEN_SETTINGS: arq }, encoding: 'utf8', timeout: 5000 });
  assert.equal(p.error, undefined, String(p.error));
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(JSON.parse(p.stdout), { ok: false, motivo: 'settings-invalido' });
  assert.ok(fs.lstatSync(arq).isFIFO());
});

test('settings.json somente leitura: recusa com settings-somente-leitura, mas já instalado segue ok', () => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  fs.chmodSync(arq, 0o444);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-somente-leitura' });
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: false, motivo: 'settings-somente-leitura' });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
  fs.chmodSync(arq, 0o644);
  fs.writeFileSync(arq, bonito({ statusLine: nossa() }));
  fs.chmodSync(arq, 0o444);
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: true, acao: 'ja-instalado', backup: null });
  assert.equal(consultarStatusline({ arquivo: arq }).acao, 'ja-instalado');
});

// ---------------------------------------------------------------- gravação concorrente

const ehNossoTmp = (p) => typeof p === 'string' && NOME_TMP.test(p);

test('concorrência: o Claude Code grava o settings.json entre a leitura e o rename: settings-mudou', () => {
  fs.writeFileSync(arq, bonito({ a: 1 }));
  const doClaude = bonito({ a: 1, permissions: { allow: ['Read'] } });
  const restaurar = espiar('openSync', ehNossoTmp, () => fs.writeFileSync(arq, doClaude));
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    assert.equal(restaurar(), true);
  }
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.equal(lerTexto(), doClaude);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('concorrência: só a data mudou (mesmo tamanho e bytes): settings-mudou', () => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  const restaurar = espiar('openSync', ehNossoTmp, () => {
    const s = fs.statSync(arq);
    fs.utimesSync(arq, s.atime, new Date(s.mtimeMs + 10_000));
  });
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    assert.equal(restaurar(), true);
  }
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('concorrência: trocado por outro arquivo de mesmo tamanho e data (só o ino muda): settings-mudou', () => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  const segundo = 1_700_000_000;
  fs.utimesSync(arq, segundo, segundo);
  const restaurar = espiar('openSync', ehNossoTmp, () => {
    const outro = path.join(dir, 'gravado-pelo-claude');
    fs.writeFileSync(outro, texto);
    fs.utimesSync(outro, segundo, segundo);
    fs.renameSync(outro, arq);
  });
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    assert.equal(restaurar(), true);
  }
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('concorrência: ausente na leitura e criado antes do rename: settings-mudou, o criado fica', () => {
  const doClaude = bonito({ criadoPeloClaude: true });
  const restaurar = espiar('openSync', ehNossoTmp, () => fs.writeFileSync(arq, doClaude));
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    assert.equal(restaurar(), true);
  }
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.equal(lerTexto(), doClaude);
  assert.deepEqual(nomes(), ['settings.json']);
});

test('concorrência: regravado no lugar durante a leitura (lido ≠ tamanho do lstat): settings-mudou, não inválido', () => {
  const texto = bonito({ a: 1, b: 'x'.repeat(100) });
  fs.writeFileSync(arq, texto);
  // O Claude Code trunca e está no meio da escrita quando a leitura começa.
  const restaurar = espiar('readSync', () => true, () => fs.truncateSync(arq, 10));
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    assert.equal(restaurar(), true);
  }
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.deepEqual(nomes(), ['settings.json']);
});

test('rename: EPERM passageiro tenta de novo e grava; EPERM persistente falha sem sobras', () => {
  fs.writeFileSync(arq, bonito({ a: 1 }));
  const original = fs.renameSync;
  let falhas = 1;
  fs.renameSync = function (de, para, ...resto) {
    if (ehNossoTmp(de) && falhas > 0) {
      falhas--;
      throw Object.assign(new Error('preso'), { code: 'EPERM' });
    }
    return original.call(this, de, para, ...resto);
  };
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    fs.renameSync = original;
  }
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(lerTexto()).statusLine.command, comandoEsperado());

  const texto = bonito({ b: 2 });
  fs.writeFileSync(arq, texto);
  fs.renameSync = function (de, ...resto) {
    if (ehNossoTmp(de)) throw Object.assign(new Error('C:\\caminho\\secreto'), { code: 'EPERM' });
    return original.call(this, de, ...resto);
  };
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 2 });
  } finally {
    fs.renameSync = original;
  }
  assert.deepEqual(r, { ok: false, motivo: 'escrita', codigo: 'EPERM' });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(backups(), ['settings.json.bak-hadouken-1']);
  assert.deepEqual(temporarios(), []);
});

// ---------------------------------------------------------------- backup

test('backup: criado com wx; nome já existente nunca é sobrescrito (backup-existe)', () => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  const sentinela = path.join(dir, 'settings.json.bak-hadouken-1');
  fs.writeFileSync(sentinela, 'sentinela');
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'backup-existe' });
  assert.equal(fs.readFileSync(sentinela, 'utf8'), 'sentinela');
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json', 'settings.json.bak-hadouken-1']);
});

test('backup: arquivo que aparece entre o lstat e o open não é sobrescrito (o wx recusa)', () => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  const nomeBackup = `${arq}.bak-hadouken-1`;
  const restaurar = espiar('openSync', (p) => p === nomeBackup, () => fs.writeFileSync(nomeBackup, 'sentinela'));
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    assert.equal(restaurar(), true);
  }
  assert.deepEqual(r, { ok: false, motivo: 'backup-existe' });
  assert.equal(fs.readFileSync(nomeBackup, 'utf8'), 'sentinela');
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json', 'settings.json.bak-hadouken-1']);
});

test('backup: junção pendente no nome do backup é recusada e o alvo não nasce', (t) => {
  fs.writeFileSync(arq, bonito({ a: 1 }));
  const alvo = path.join(dir, 'fora-nao-existe');
  if (!link(t, alvo, path.join(dir, 'settings.json.bak-hadouken-1'), LINK_PASTA)) return;
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }), { ok: false, motivo: 'backup-existe' });
  assert.equal(fs.existsSync(alvo), false);
  assert.equal(JSON.parse(lerTexto()).statusLine, undefined);
});

test('backup com modo 0600 e settings.json com o modo original (POSIX)', { skip: SO_POSIX }, () => {
  fs.writeFileSync(arq, bonito({ a: 1 }));
  fs.chmodSync(arq, 0o640);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true);
  assert.equal(fs.statSync(r.backup).mode & 0o777, 0o600);
  assert.equal(fs.statSync(arq).mode & 0o777, 0o640);
});

test('modos exatos mesmo com umask hostil: backup 0600, settings com o modo original (POSIX)', { skip: SO_POSIX }, () => {
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  fs.chmodSync(arq, 0o640);
  const antes = process.umask(0o277);
  let r;
  try {
    r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  } finally {
    process.umask(antes);
  }
  assert.equal(r.ok, true);
  assert.equal(fs.statSync(r.backup).mode & 0o777, 0o600);
  assert.equal(fs.statSync(arq).mode & 0o777, 0o640);
  assert.deepEqual(fs.readFileSync(r.backup), Buffer.from(texto));
});

test('settings.json novo nasce com modo 0600 (POSIX)', { skip: SO_POSIX }, () => {
  assert.equal(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }).ok, true);
  assert.equal(fs.statSync(arq).mode & 0o777, 0o600);
});

test(`backup: guarda no máximo ${MAX_BACKUPS} nossos; apaga os mais velhos, nunca link, pasta ou nome alheio`, (t) => {
  assert.equal(MAX_BACKUPS, 5);
  fs.writeFileSync(arq, bonito({ a: 1 }));
  for (const ms of [10, 11, 12, 13, 14, 15]) fs.writeFileSync(path.join(dir, `settings.json.bak-hadouken-${ms}`), `v${ms}`);
  const alheios = ['settings.json.bak-hadouken-abc', 'settings.json.bak-hadouken-', 'outro.json.bak-hadouken-1', 'settings.json.bak-hadouken-1x'];
  for (const n of alheios) fs.writeFileSync(path.join(dir, n), 'alheio');
  fs.mkdirSync(path.join(dir, 'settings.json.bak-hadouken-9'));
  const fora = path.join(dir, 'fora');
  fs.mkdirSync(fora);
  fs.writeFileSync(path.join(fora, 'dentro'), 'x');
  const comLink = link(t, fora, path.join(dir, 'settings.json.bak-hadouken-8'), LINK_PASTA);
  let comHard = true;
  try {
    fs.linkSync(path.join(fora, 'dentro'), path.join(dir, 'settings.json.bak-hadouken-7'));
  } catch {
    comHard = false;
  }
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 100 });
  assert.equal(r.ok, true);
  const nossos = backups().filter((n) => /^settings\.json\.bak-hadouken-\d+$/.test(n)).filter((n) => {
    const i = fs.lstatSync(path.join(dir, n));
    return i.isFile() && i.nlink === 1;
  });
  assert.deepEqual(nossos.sort(), ['settings.json.bak-hadouken-100', 'settings.json.bak-hadouken-12', 'settings.json.bak-hadouken-13',
    'settings.json.bak-hadouken-14', 'settings.json.bak-hadouken-15']);
  for (const n of alheios) assert.equal(fs.readFileSync(path.join(dir, n), 'utf8'), 'alheio', n);
  assert.ok(fs.statSync(path.join(dir, 'settings.json.bak-hadouken-9')).isDirectory());
  if (comLink) assert.ok(fs.lstatSync(path.join(dir, 'settings.json.bak-hadouken-8')).isSymbolicLink());
  if (comHard) assert.equal(fs.readFileSync(path.join(dir, 'settings.json.bak-hadouken-7'), 'utf8'), 'x');
  assert.equal(fs.readFileSync(path.join(fora, 'dentro'), 'utf8'), 'x');
});

test('backup: o recém-criado nunca é podado, mesmo com o relógio atrasado', () => {
  fs.writeFileSync(arq, bonito({ a: 1 }));
  for (const ms of [1000, 1001, 1002, 1003, 1004, 1005]) fs.writeFileSync(path.join(dir, `settings.json.bak-hadouken-${ms}`), `v${ms}`);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(backups().sort(), ['settings.json.bak-hadouken-1', 'settings.json.bak-hadouken-1002', 'settings.json.bak-hadouken-1003',
    'settings.json.bak-hadouken-1004', 'settings.json.bak-hadouken-1005']);
});

test('temporário nosso abandonado há mais de 1 h é varrido; alheio fica', () => {
  fs.writeFileSync(arq, bonito({ a: 1 }));
  const velho = path.join(dir, 'settings.json.hadouken-0123456789ab.tmp');
  const alheio = path.join(dir, 'settings.json.outro.tmp');
  for (const p of [velho, alheio]) {
    fs.writeFileSync(p, '{}');
    const s = (Date.now() - 2 * 3_600_000) / 1000;
    fs.utimesSync(p, s, s);
  }
  assert.equal(aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 }).ok, true);
  assert.equal(fs.existsSync(velho), false);
  assert.equal(fs.existsSync(alheio), true);
});

// ---------------------------------------------------------------- remover

test('remover: tira só a nossa statusLine, mantém o resto e a ordem, com backup', () => {
  const resto = { a: 1, b: { c: [1, 2] } };
  const texto = bonito({ a: 1, statusLine: nossa(), b: { c: [1, 2] } });
  fs.writeFileSync(arq, texto);
  const r = removerStatusline({ arquivo: arq, agoraMs: 3 });
  assert.deepEqual(r, { ok: true, acao: 'remover', backup: `${arq}.bak-hadouken-3` });
  assert.equal(lerTexto(), bonito(resto));
  assert.deepEqual(fs.readFileSync(r.backup), Buffer.from(texto));
});

test('remover: a nossa com padding diferente também sai (o comando decide)', () => {
  fs.writeFileSync(arq, bonito({ statusLine: { ...nossa(), padding: 3 } }));
  assert.equal(removerStatusline({ arquivo: arq, agoraMs: 1 }).acao, 'remover');
  assert.equal(lerTexto(), bonito({}));
});

test('remover: outra statusLine nunca é tocada (outra-barra)', () => {
  for (const outra of [{ type: 'command', command: 'outra' }, { type: 'command', command: 'node "/outra/copia/hadouken/bin/statusline.mjs"' }, null, 'x']) {
    const texto = bonito({ statusLine: outra });
    fs.writeFileSync(arq, texto);
    assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: false, motivo: 'outra-barra' }, JSON.stringify(outra));
    assert.equal(lerTexto(), texto);
    assert.deepEqual(nomes(), ['settings.json']);
  }
});

test('remover: sem statusLine ou sem arquivo não grava nada (nao-instalado)', () => {
  assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: true, acao: 'nao-instalado', backup: null });
  assert.deepEqual(nomes(), []);
  const texto = bonito({ a: 1 });
  fs.writeFileSync(arq, texto);
  assert.deepEqual(removerStatusline({ arquivo: arq, agoraMs: 1 }), { ok: true, acao: 'nao-instalado', backup: null });
  assert.equal(lerTexto(), texto);
  assert.deepEqual(nomes(), ['settings.json']);
});

// ---------------------------------------------------------------- consultar

test('consultar: plano sem gravar nada, lendo o arquivo', () => {
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: true, acao: 'instalar', atual: null, proposto: nossa() });
  assert.deepEqual(nomes(), []);
  const outra = { type: 'command', command: 'outra' };
  fs.writeFileSync(arq, bonito({ statusLine: outra }));
  assert.deepEqual(consultarStatusline({ arquivo: arq }), { ok: true, acao: 'conflito', atual: outra, proposto: nossa() });
  assert.deepEqual(nomes(), ['settings.json']);
  assert.equal(fs.existsSync(homeDados), false);
});

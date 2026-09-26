import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rodarCli, instalar, jsonSeguro, USO, NAO_DISPONIVEL } from '../src/comandos.js';
import { AVISO_DADOS, CLAUDE_RAIZ_RECUSADA } from '../src/relatorio.js';

// CLI do plugin (addendum da Task 10, A, B, D, F e G): tabela de comandos fixa,
// nada do argv ecoado, erro interno numa linha fixa, instalar carregado sob
// demanda e o processo saindo depois de escrever. Os filhos rodam com HOME,
// USERPROFILE e HADOUKEN_HOME temporários; o gh de verdade nunca roda.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src', 'cli.js');
const tmps = [];
const novoTmp = (prefixo = 'hdk cli ç ') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  tmps.push(d);
  return d;
};
// Um executável que acabou de sair ainda pode estar preso no Windows por
// alguns milissegundos: a remoção tenta de novo.
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

function capturar() {
  const saidas = [];
  const codigos = [];
  return { saidas, codigos, escrever: async (t) => { saidas.push(t); }, sair: (c) => { codigos.push(c); } };
}

// ------------------------------------------------------------ em processo

test('comando desconhecido, vazio ou do protótipo: linha de uso fixa, código 1, nada ecoado', async () => {
  for (const argv of [[], ['desconhecido', '$(rm -rf ~)'], ['__proto__'], ['constructor'], ['toString'], ['hasOwnProperty'], [42], null, 'consumo', ['CONSUMO']]) {
    const c = capturar();
    await rodarCli(argv, c);
    assert.deepEqual(c.saidas, [`${USO}\n`], String(argv));
    assert.deepEqual(c.codigos, [1], String(argv));
  }
  assert.doesNotMatch(USO, /rm|desconhecido/);
});

test('consumo recebe só o resto do argv; a saída do comando vai inteira e sai com o código dele', async () => {
  const c = capturar();
  let recebidos;
  await rodarCli(['consumo', '--json', '--evil'], { ...c, comandos: { consumo: async (args) => { recebidos = args; return { texto: 'ok\n', codigo: 0 }; } } });
  assert.deepEqual(recebidos, ['--json', '--evil']);
  assert.deepEqual(c.saidas, ['ok\n']);
  assert.deepEqual(c.codigos, [0]);
});

test('malicioso: erro interno com caminho na mensagem imprime só a linha fixa com código da lista', async () => {
  const casos = [
    [new Error('falhou em C:\\Users\\Fulano\\segredo.json'), 'desconhecido'],
    [Object.assign(new Error('EACCES: permission denied, open \'/home/fulano/x\''), { code: 'EACCES' }), 'EACCES'],
    [Object.assign(new Error('x'), { code: 'C:\\Users\\Fulano' }), 'desconhecido'],
    ['texto solto /home/fulano', 'desconhecido'],
    [{ get code() { throw new Error('x'); } }, 'desconhecido'],
  ];
  for (const [erro, codigo] of casos) {
    const c = capturar();
    await rodarCli(['consumo'], { ...c, comandos: { consumo: async () => { throw erro; } } });
    assert.deepEqual(c.saidas, [`erro interno (${codigo})\n`]);
    assert.deepEqual(c.codigos, [1]);
  }
});

test('escrita que falha (stdout fechado) ainda sai, com o código do comando', async () => {
  const codigos = [];
  await rodarCli(['consumo'], {
    escrever: async () => { throw Object.assign(new Error('EPIPE'), { code: 'EPIPE' }); },
    sair: (c) => codigos.push(c),
    comandos: { consumo: async () => ({ texto: 'x\n', codigo: 0 }) },
  });
  assert.deepEqual(codigos, [0]);
});

test('instalar: módulo da Task 11 ausente é "ainda não disponível" com código 0', async () => {
  const dir = novoTmp();
  const r = await instalar(['--aplicar'], { url: pathToFileURL(path.join(dir, 'instalar-cli.js')).href });
  assert.deepEqual(r, { texto: `${NAO_DISPONIVEL}\n`, codigo: 0 });
  assert.equal(NAO_DISPONIVEL, 'instalar: ainda não disponível');
});

test('instalar: repassa só as flags conhecidas; o exitCode que o módulo pôs é o código de saída', async () => {
  const dir = novoTmp();
  const mod = path.join(dir, 'instalar-cli.js');
  fs.writeFileSync(mod, 'export async function instalar(args) { globalThis.hdkArgs = args; process.exitCode = 3; }\n');
  try {
    const r = await instalar(['--aplicar', '--evil', '$(x)', '--remover', '--substituir', '--aplicar', 7], { url: pathToFileURL(mod).href });
    assert.deepEqual(globalThis.hdkArgs, ['--aplicar', '--remover', '--substituir']);
    assert.deepEqual(r, { texto: '', codigo: null }, 'null: vale o exitCode do módulo');
    assert.equal(process.exitCode, 3);
    process.exitCode = undefined;
    const c = capturar();
    await rodarCli(['instalar', '--remover'], { ...c, comandos: { instalar: (a) => instalar(a, { url: pathToFileURL(mod).href }) } });
    assert.deepEqual(c.saidas, ['']);
    assert.deepEqual(c.codigos, [3], 'rodarCli sai com o exitCode posto pelo módulo');
    assert.deepEqual(globalThis.hdkArgs, ['--remover']);
  } finally {
    process.exitCode = undefined;
    delete globalThis.hdkArgs;
  }
  const c = capturar();
  await rodarCli(['instalar'], { ...c, comandos: { instalar: async () => ({ texto: 'ok\n', codigo: null }) } });
  assert.deepEqual(c.codigos, [0], 'sem exitCode posto, 0');
});

test('instalar: import que falta dentro do módulo, ou módulo sem a função, é erro interno', async () => {
  const dir = novoTmp();
  const quebrado = path.join(dir, 'quebrado.js');
  fs.writeFileSync(quebrado, 'import "./nao-existe-dentro.js";\nexport async function instalar() {}\n');
  const semFuncao = path.join(dir, 'sem-funcao.js');
  fs.writeFileSync(semFuncao, 'export const x = 1;\n');
  for (const [arq, codigo] of [[quebrado, 'ERR_MODULE_NOT_FOUND'], [semFuncao, 'desconhecido']]) {
    const c = capturar();
    await rodarCli(['instalar'], { ...c, comandos: { instalar: (a) => instalar(a, { url: pathToFileURL(arq).href }) } });
    assert.deepEqual(c.saidas, [`erro interno (${codigo})\n`], arq);
    assert.deepEqual(c.codigos, [1]);
  }
});

test('jsonSeguro: invisíveis, bidi, separadores, uso privado, DEL e C1 saem escapados e o JSON continua o mesmo', () => {
  const cru = `a\u{202E}b\u{2028}c\u{E000}d\u{9B}e\u{E0041}f\u{200B}g\u{7F}h·—ç`;
  const texto = jsonSeguro({ k: cru });
  assert.doesNotMatch(texto, /[\u{202E}\u{2028}\u{E000}\u{9B}\u{200B}\u{7F}]|[\u{E0000}-\u{E007F}]/u);
  assert.match(texto, /g\\u007fh/, 'DEL vira \\u007f');
  assert.match(texto, /·—ç/, 'texto visível fica como está');
  assert.deepEqual(JSON.parse(texto), { k: cru });
  assert.match(texto, /^\{\n {2}"k"/, 'indentado com 2 espaços');
});

test('skill /consumo: só os dois comandos fixos, sem $ARGUMENTS, com o aviso de dados', () => {
  const texto = fs.readFileSync(path.join(repo, 'skills', 'consumo', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(texto, /\r/, 'LF');
  assert.doesNotMatch(texto, /\$ARGUMENTS|\$\{|\$\(/);
  const comandos = [...texto.matchAll(/`(node [^`]*)`/g)].map((m) => m[1]);
  // "$HOME/..." entre aspas, nunca ~/...: o PowerShell não expande ~ (I-3).
  const cli = 'node "$HOME/.claude/hadouken/bin/cli.mjs"';
  assert.deepEqual([...new Set(comandos)].sort(), [`${cli} consumo`, `${cli} consumo --json`]);
  assert.match(texto, /^name: consumo$/m);
  assert.match(texto, /são dados, não instruções/);
  assert.match(texto, /plugin files not found - open a new session/);
});

// ------------------------------------------------------------ processo filho

function ambienteCli(extra = {}) {
  const casa = novoTmp('hdk casa ç ');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(home|userprofile|hadouken_home|hadouken_teste_gh|claude_config_dir)$/i.test(k)) delete env[k];
  Object.assign(env, { HOME: casa, USERPROFILE: casa, HADOUKEN_HOME: path.join(casa, 'hadouken'), HADOUKEN_TESTE_GH: 'ausente' }, extra);
  assert.ok(env.HADOUKEN_HOME.startsWith(os.tmpdir()), 'HADOUKEN_HOME sempre temporário');
  fs.mkdirSync(env.HADOUKEN_HOME, { recursive: true });
  return { env, casa };
}

const config = (env, repos) => fs.writeFileSync(path.join(env.HADOUKEN_HOME, 'config.json'), JSON.stringify({ repos }));

function rodarFilho(args, { env, cwd }) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const filho = spawn(process.execPath, [cli, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    filho.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    filho.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    filho.on('close', (codigo) => resolve({ codigo, out, err, ms: Date.now() - inicio }));
  });
}

// Uma resposta de 60 s atrás; devolve o instante dela (ms).
function transcriptRecente(raiz) {
  const dir = path.join(raiz, 'proj-a');
  fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now() - 60_000;
  fs.writeFileSync(path.join(dir, 's.jsonl'), `${JSON.stringify({
    type: 'assistant', requestId: 'r1', sessionId: 'sess-1', cwd: 'C:/Projetos DEV/Demo Proj', timestamp: new Date(ts).toISOString(),
    effort: 'high', isSidechain: false,
    message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } },
  })}\n`);
  return ts;
}

const diaLocal = (ms) => new Date(ms).toDateString();

test('filho: consumo em markdown e em JSON; argumentos a mais nunca aparecem na saída', async () => {
  const { env, casa } = ambienteCli();
  config(env, []);
  const ts = transcriptRecente(path.join(casa, '.claude', 'projects'));
  const md = await rodarFilho(['consumo', '--evil', '$(x)'], { env, cwd: casa });
  assert.equal(md.codigo, 0, md.err);
  assert.equal(md.err, '');
  assert.equal(md.out.split('\n')[0], AVISO_DADOS);
  assert.match(md.out, /\| `Demo Proj` \| 1 \|/);
  assert.match(md.out, /Nenhum repo configurado/);
  const json = await rodarFilho(['consumo', '--json', '--evil', '$(x)'], { env, cwd: casa });
  assert.equal(json.codigo, 0, json.err);
  const fim = Date.now();
  const r = JSON.parse(json.out);
  assert.equal(r.versao, 1);
  assert.equal(r.claude.semana.total.respostas, 1);
  // O filho lê o relógio entre `ts` e `fim`. "Hoje" começa na meia-noite
  // local desse instante: se `ts` e `fim` caem no mesmo dia local, a resposta
  // é de hoje; se a execução cruzou a meia-noite, pode ter ficado de ontem.
  if (diaLocal(ts) === diaLocal(fim)) assert.equal(r.claude.hoje.total.respostas, 1);
  else assert.ok([0, 1].includes(r.claude.hoje.total.respostas), String(r.claude.hoje.total.respostas));
  for (const s of [md.out, json.out]) assert.doesNotMatch(s, /--evil|\$\(x\)/);
  const uso = await rodarFilho(['--json', 'consumo'], { env, cwd: casa });
  assert.equal(uso.codigo, 1);
  assert.equal(uso.out, `${USO}\n`);
});

test('filho: raiz de transcripts ligada (junção ou link) é "raiz recusada", nunca "nenhum transcript"', async (t) => {
  const { env, casa } = ambienteCli();
  config(env, []);
  const alvo = path.join(casa, 'alvo');
  transcriptRecente(alvo);
  fs.mkdirSync(path.join(casa, '.claude'));
  try {
    fs.symlinkSync(alvo, path.join(casa, '.claude', 'projects'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    t.skip(`sem link: ${e.code}`);
    return;
  }
  const r = await rodarFilho(['consumo'], { env, cwd: casa });
  assert.equal(r.codigo, 0, r.err);
  assert.ok(r.out.includes(`Claude: indisponível: ${CLAUDE_RAIZ_RECUSADA}`), r.out);
  assert.doesNotMatch(r.out, /nenhum transcript/);
});

// Sentinela: um "gh" que é o próprio node, primeiro (e único) no PATH, e que
// roda o arquivo `api` do cwd do CLI. No Windows o execFile acha gh.exe, então
// a sentinela é um hard link (ou cópia) de uma cópia temporária do node.exe:
// um link do node.exe que roda este teste (possível com um node portátil)
// não pode ser apagado no after enquanto o teste roda (EPERM). No POSIX, um
// link simbólico chamado gh.
let nodeTemporario = null;
function sentinela(scriptApi) {
  const bin = novoTmp('hdk bin ');
  const nome = path.join(bin, process.platform === 'win32' ? 'gh.exe' : 'gh');
  try {
    if (process.platform === 'win32') {
      if (nodeTemporario === null) {
        nodeTemporario = path.join(novoTmp('hdk node '), 'node.exe');
        fs.copyFileSync(process.execPath, nodeTemporario);
      }
      fs.linkSync(nodeTemporario, nome);
    } else {
      fs.symlinkSync(process.execPath, nome);
    }
  } catch {
    fs.copyFileSync(process.execPath, nome);
    fs.chmodSync(nome, 0o755);
  }
  const cwd = novoTmp('hdk cwd ');
  fs.writeFileSync(path.join(cwd, 'api'), scriptApi);
  return { bin, cwd };
}

const soPath = (env, bin) => {
  const e = { ...env };
  for (const k of Object.keys(e)) if (k.toLowerCase() === 'path') delete e[k];
  e.PATH = bin;
  return e;
};

test('filho: com HADOUKEN_TESTE_GH=ausente o gh do PATH nunca roda (controle positivo sem o gancho)', async () => {
  const marcador = path.join(novoTmp('hdk marca '), 'marcador');
  const { bin, cwd } = sentinela(`require('fs').appendFileSync(${JSON.stringify(marcador)}, 'x\\n');\n`);
  const semGancho = ambienteCli();
  config(semGancho.env, ['o/r']);
  const envSem = soPath(semGancho.env, bin);
  delete envSem.HADOUKEN_TESTE_GH;
  const r1 = await rodarFilho(['consumo'], { env: envSem, cwd });
  assert.equal(r1.codigo, 0, r1.err);
  assert.ok(fs.existsSync(marcador), 'sem o gancho, a sentinela é o gh que o CLI acha');
  fs.rmSync(marcador);
  const comGancho = ambienteCli();
  config(comGancho.env, ['o/r']);
  const r2 = await rodarFilho(['consumo'], { env: soPath(comGancho.env, bin), cwd });
  assert.equal(r2.codigo, 0, r2.err);
  assert.equal(fs.existsSync(marcador), false, 'com o gancho, nenhum gh roda');
  assert.match(r2.out, /`o\/r`: indisponível: gh ausente/);
});

test('filho: gh que nunca responde não segura o CLI; o prazo de 10 s fecha a coleta e o processo sai', async () => {
  const { bin, cwd } = sentinela('setInterval(() => {}, 1000);\n');
  const { env } = ambienteCli();
  config(env, ['o/r']);
  const semGancho = soPath(env, bin);
  delete semGancho.HADOUKEN_TESTE_GH;
  const r = await rodarFilho(['consumo'], { env: semGancho, cwd });
  assert.equal(r.codigo, 0, r.err);
  assert.match(r.out, /`o\/r`: indisponível: tempo esgotado/);
  assert.ok(r.ms >= 9_000 && r.ms < 30_000, `${r.ms} ms`);
});

test('filho: instalar sem o módulo da Task 11', { skip: fs.existsSync(path.join(repo, 'src', 'instalar-cli.js')) && 'instalar-cli.js presente' }, async () => {
  const { env, casa } = ambienteCli();
  const r = await rodarFilho(['instalar', '--aplicar', '--evil'], { env, cwd: casa });
  assert.equal(r.codigo, 0, r.err);
  assert.equal(r.out, `${NAO_DISPONIVEL}\n`);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutoCompleto, caminhoDoAmbiente, dirDados, origemDados } from '../src/base.js';
import * as executavel from '../src/executavel.js';

// Revisão final de segurança, M-1: HADOUKEN_HOME, HADOUKEN_SETTINGS e
// HADOUKEN_TESTE_GH valem sempre que estão no ambiente, não só nos testes (o
// ambiente da sessão é confiável; SECURITY.md). Um HADOUKEN_HOME que não é
// caminho absoluto completo seria resolvido contra o cwd, o repo aberto, e o
// estado, o índice e os shims iriam parar dentro dele. Agora ele deixa o
// plugin sem pasta de dados (dirDados() null): barra e hooks mudos, nada
// gravado em lugar nenhum (nem no cwd, nem na home, nem no temporário), e
// nunca a pasta padrão no lugar, que quem definiu a variável quis trocar. O
// instalador recusa (instalar-cli.test.js); HADOUKEN_SETTINGS está em
// configuracao.test.js e HADOUKEN_TESTE_GH em cli.test.js.

const WIN = process.platform === 'win32';
const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// Marca única no nome: se um valor fosse aceito e resolvido, a pasta criada
// seria achada por ela (e apagada no fim).
const MARCA = `hdk-marca-${process.pid}`;
// Nenhum é caminho absoluto completo. No Windows, "\x" e "/x" pegam a unidade
// do cwd e "C:x" o diretório corrente da unidade C.
const INVALIDOS = [
  '', ' ', '\t', MARCA, `.${path.sep}${MARCA}`, `..${path.sep}${MARCA}`, `~/${MARCA}`, '~',
  ...(WIN ? [`\\${MARCA}`, `/${MARCA}`, `C:${MARCA}`, 'C:', ` C:\\${MARCA}`] : [` /${MARCA}`]),
];
// Os que rodam também nos processos filhos (cada um custa quatro processos).
const INVALIDOS_FILHO = [
  '', ' ', MARCA, `.${path.sep}${MARCA}`, `~/${MARCA}`,
  ...(WIN ? [`\\${MARCA}`, `/${MARCA}`, `C:${MARCA}`] : [` /${MARCA}`]),
];
const ABSOLUTOS = WIN
  ? ['C:\\hdk\\dados', 'c:/hdk/./x/../dados', 'D:\\Dados do Usuário\\hdk', '\\\\servidor\\pasta\\dados']
  : ['/hdk/dados', '/hdk/./x/../dados', '/home/usuário/hdk dados'];

const tmps = [];
const suspeitos = new Set();
const novoTmp = (prefixo) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  tmps.push(d);
  return d;
};
after(() => {
  for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
  // Só pastas com a marca, criadas por uma regressão: nada mais é apagado.
  for (const p of suspeitos) if (path.basename(p).includes(MARCA)) fs.rmSync(p, { recursive: true, force: true });
});

// Roda `corpo` com HADOUKEN_HOME = valor (undefined tira a variável) e devolve
// o ambiente como estava.
function comHome(valor, corpo) {
  const antes = process.env.HADOUKEN_HOME;
  if (valor === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = valor;
  try {
    return corpo();
  } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
}

// ---------------------------------------------------------------- em processo

test('dirDados: HADOUKEN_HOME que não é caminho absoluto completo dá null, nunca a pasta padrão nem o cwd', () => {
  for (const v of INVALIDOS) {
    const rotulo = JSON.stringify(v);
    comHome(v, () => {
      assert.equal(dirDados(), null, rotulo);
      assert.equal(origemDados(), 'HADOUKEN_HOME', rotulo);
    });
    assert.equal(absolutoCompleto(v), false, rotulo);
    assert.equal(caminhoDoAmbiente(v), null, rotulo);
  }
});

test('dirDados: HADOUKEN_HOME absoluto completo vale, normalizado e sem depender do cwd', () => {
  for (const v of ABSOLUTOS) {
    comHome(v, () => {
      assert.equal(dirDados(), path.resolve(v), v);
      assert.ok(!dirDados().includes(`${path.sep}.${path.sep}`), v);
      assert.equal(origemDados(), 'HADOUKEN_HOME', v);
    });
  }
});

test('origemDados: padrao sem HADOUKEN_HOME, e a pasta fica na home', () => {
  const original = os.homedir;
  const falso = path.resolve(os.tmpdir(), 'hdk-home-falso-nunca-criado');
  try {
    os.homedir = () => falso;
    comHome(undefined, () => {
      assert.equal(origemDados(), 'padrao');
      assert.equal(dirDados(), path.join(falso, '.claude', 'hadouken'));
    });
  } finally {
    os.homedir = original;
  }
  assert.equal(fs.existsSync(falso), false);
});

test('caminhoDoAmbiente: NUL e o que não é texto dão null', () => {
  for (const v of [`${ABSOLUTOS[0]}\0x`, undefined, null, 42, {}, [ABSOLUTOS[0]]]) {
    assert.equal(caminhoDoAmbiente(v), null, String(v));
  }
});

test('absolutoCompleto: uma regra só, em base.js, reexportada por executavel.js', () => {
  assert.equal(executavel.absolutoCompleto, absolutoCompleto);
});

// ------------------------------------------------------------ processos filhos

const s = () => Math.floor(Date.now() / 1000);
const SCRIPTS = [
  ['hooks/session-start.js', () => ({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: 'C:/x' })],
  ['hooks/prompt-submit.js', () => ({ session_id: 's1', hook_event_name: 'UserPromptSubmit', cwd: 'C:/x', prompt: 'oi' })],
  ['hooks/session-end.js', () => ({ session_id: 's1', hook_event_name: 'SessionEnd', cwd: 'C:/x', reason: 'exit' })],
  ['statusline.js', () => ({
    session_id: 's1', model: { display_name: 'Opus' },
    rate_limits: { five_hour: { used_percentage: 10, resets_at: s() + 3600 }, seven_day: { used_percentage: 20, resets_at: s() + 86_400 } },
  })],
];

// Filho com HADOUKEN_HOME = valor e com home (HOME e USERPROFILE),
// temporário (TMPDIR, TEMP e TMP) e cwd em pastas novas e vazias: o que fosse
// gravado apareceria numa delas. Sem CLAUDE_CONFIG_DIR nem HADOUKEN_SETTINGS
// de quem roda os testes.
function cenario(valor) {
  const casa = novoTmp('hdk env casa ');
  const tmp = novoTmp('hdk env tmp ');
  const cwd = novoTmp('hdk env cwd ');
  const env = { ...process.env };
  const fora = /^(?:home|userprofile|tmpdir|temp|tmp|hadouken_home|hadouken_settings|hadouken_teste_gh|claude_config_dir)$/i;
  for (const k of Object.keys(env)) if (fora.test(k)) delete env[k];
  Object.assign(env, { HOME: casa, USERPROFILE: casa, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HADOUKEN_HOME: valor, CLAUDE_PLUGIN_ROOT: RAIZ, NO_COLOR: '1' });
  return { env, casa, tmp, cwd };
}

const rodar = (c, script, entrada) => spawnSync(process.execPath, [path.join(RAIZ, 'src', script)], {
  input: JSON.stringify(entrada), env: c.env, cwd: c.cwd, encoding: 'utf8', timeout: 15_000,
});

// O mesmo rodar, sem bloquear: os quatro scripts de um valor rodam juntos
// (em série, cada processo custa cerca de meio segundo no Windows).
function rodarJunto(c, script, entrada) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(RAIZ, 'src', script)], {
      env: c.env, cwd: c.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 15_000,
    });
    let stdout = '';
    let stderr = '';
    filho.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    filho.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    filho.stdin.on('error', () => {});
    filho.on('error', (error) => resolve({ error, status: null, stdout, stderr }));
    filho.on('close', (status) => resolve({ error: undefined, status, stdout, stderr }));
    filho.stdin.end(JSON.stringify(entrada));
  });
}

// Nada em nenhuma das três pastas nem onde o valor cairia resolvido contra o
// cwd do filho.
function semRastro(c, valor, rotulo) {
  for (const d of [c.casa, c.tmp, c.cwd]) assert.deepEqual(fs.readdirSync(d), [], `${rotulo}: ${d}`);
  if (valor.trim() === '') return;
  const resolvido = path.resolve(c.cwd, valor);
  suspeitos.add(resolvido);
  assert.equal(fs.existsSync(resolvido), false, `${rotulo}: ${resolvido}`);
}

test('HADOUKEN_HOME inválido: os três hooks e a barra ficam mudos e não gravam nada em lugar nenhum', async () => {
  for (const valor of INVALIDOS_FILHO) {
    const c = cenario(valor);
    const resultados = await Promise.all(SCRIPTS.map(([script, entrada]) => rodarJunto(c, script, entrada())));
    for (const [i, [script]] of SCRIPTS.entries()) {
      const rotulo = `${JSON.stringify(valor)} ${script}`;
      const r = resultados[i];
      assert.equal(r.error, undefined, rotulo);
      assert.equal(r.status, 0, `${rotulo}: ${r.stderr}`);
      assert.equal(r.stdout, '', rotulo);
      assert.equal(r.stderr, '', rotulo);
    }
    semRastro(c, valor, JSON.stringify(valor));
  }
});

// Controle: o mesmo cenário com HADOUKEN_HOME absoluto registra a sessão,
// cria os shims, fala e desenha a barra, e grava só na pasta pedida.
test('controle: HADOUKEN_HOME absoluto grava na pasta pedida e só nela', () => {
  const c = cenario('');
  const dados = path.join(c.casa, 'dados');
  c.env.HADOUKEN_HOME = dados;
  const inicio = rodar(c, SCRIPTS[0][0], SCRIPTS[0][1]());
  assert.equal(inicio.status, 0, inicio.stderr);
  assert.match(inicio.stdout, /"hookEventName":"SessionStart"/);
  const barra = rodar(c, SCRIPTS[3][0], SCRIPTS[3][1]());
  assert.equal(barra.status, 0, barra.stderr);
  assert.match(barra.stdout, /Opus/);
  for (const nome of ['ativas', 'bin', 'estado.json']) assert.ok(fs.existsSync(path.join(dados, nome)), nome);
  assert.deepEqual(fs.readdirSync(c.casa), ['dados']);
  assert.deepEqual(fs.readdirSync(c.tmp), []);
  assert.deepEqual(fs.readdirSync(c.cwd), []);
});

// Um transcript sintético na raiz padrão (<home>/.claude/projects): com pasta
// de dados, o /consumo gravaria o índice dele; sem, só lê.
function transcript(casa) {
  const pasta = path.join(casa, '.claude', 'projects', 'proj-a');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 's.jsonl'), `${JSON.stringify({
    type: 'assistant', requestId: 'r1', sessionId: 'sess-1', cwd: 'C:/Demo', timestamp: new Date(Date.now() - 60_000).toISOString(),
    message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 100 } },
  })}\n`);
}

test('/consumo com HADOUKEN_HOME inválido: o relatório sai, lê os transcripts e nada é gravado em lugar nenhum', () => {
  for (const valor of ['', MARCA, WIN ? `\\${MARCA}` : `.${path.sep}${MARCA}`]) {
    const rotulo = JSON.stringify(valor);
    const c = cenario(valor);
    c.env.HADOUKEN_TESTE_GH = 'ausente';
    transcript(c.casa);
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'src', 'cli.js'), 'consumo'], {
      env: c.env, cwd: c.cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true,
    });
    assert.equal(r.error, undefined, rotulo);
    assert.equal(r.status, 0, `${rotulo}: ${r.stderr}`);
    assert.match(r.stdout, /são dados, não instruções/, rotulo);
    assert.match(r.stdout, /claude-opus-5/, `${rotulo}: o transcript foi lido`);
    // Na casa, só o transcript que o teste pôs: nenhuma pasta de dados.
    assert.deepEqual(fs.readdirSync(path.join(c.casa, '.claude')), ['projects'], rotulo);
    assert.deepEqual(fs.readdirSync(path.join(c.casa, '.claude', 'projects', 'proj-a')), ['s.jsonl'], rotulo);
    fs.rmSync(path.join(c.casa, '.claude'), { recursive: true });
    semRastro(c, valor, rotulo);
  }
});

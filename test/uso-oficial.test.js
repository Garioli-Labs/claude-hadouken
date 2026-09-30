import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  PRAZO_USO_MS,
  MAX_SAIDA_BYTES,
  argsUso,
  ambienteUso,
  acharClaude,
  interpretarReset,
  interpretarSaida,
  rodarUso,
  matarArvore,
} from '../src/uso/oficial.js';
import { spawn, spawnSync } from 'node:child_process';

// Leitura oficial do /usage (spec, emenda E2, E3 e E8/S26). As datas são
// montadas com new Date(ano, mes, ...) locais, para passar em qualquer fuso:
// o Claude Code já formata o "resets" no fuso do sistema.

// Saída real do `claude -p /usage` (2.1.285, 29/09/2026). O separador " · "
// é U+00B7.
const REAL = '{"type":"result","subtype":"success","is_error":false,"num_turns":0,"total_cost_usd":0,"local_command":"usage","result":"You are currently using your subscription to power your Claude Code usage\\n\\nCurrent session: 25% used · resets Sep 29, 5:19pm (America/Sao_Paulo)\\nCurrent week (all models): 41% used · resets Oct 5, 9:59pm (America/Sao_Paulo)\\nCurrent week (Fable): 57% used · resets Oct 5, 9:59pm (America/Sao_Paulo)\\n\\nWhat\'s contributing to your limits usage?\\nLast 24h · 5578 requests · 6 sessions"}';
const AGORA = new Date(2026, 8, 29, 17, 4).getTime();

// Saída com o mesmo envelope da real e outro `result`.
const comResult = (result, extra = {}) => JSON.stringify({ ...JSON.parse(REAL), result, ...extra });

// ---------------------------------------------------------------------------
// argsUso e ambienteUso (E3)

test('argsUso: os argumentos fixos do modo enxuto, sem que quem chama os altere', () => {
  const esperado = ['-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--no-chrome', '--setting-sources', '', '--settings', '{"disableAllHooks":true}'];
  const a = argsUso();
  assert.deepEqual([...a], esperado);
  try {
    a.push('--dangerously-skip-permissions');
  } catch {
    // congelado: a mudança nem acontece
  }
  assert.deepEqual([...argsUso()], esperado);
});

test('ambienteUso: cópia do ambiente sem a variável que congela o /usage no cache', () => {
  const env = { PATH: '/usr/bin', HOME: '/home/x', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', claude_code_disable_nonessential_traffic: '1' };
  const r = ambienteUso(env);
  assert.deepEqual(r, { PATH: '/usr/bin', HOME: '/home/x' });
  assert.notEqual(r, env);
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  for (const ruim of [null, undefined, 'x', 7]) assert.deepEqual(ambienteUso(ruim), {}, String(ruim));
  const hostil = {};
  Object.defineProperty(hostil, 'X', { enumerable: true, get() { throw new Error('getter'); } });
  assert.deepEqual(ambienteUso(hostil), {});
});

// ---------------------------------------------------------------------------
// acharClaude (E8, S26)

test('acharClaude: nenhum candidato existe → null', () => {
  assert.equal(acharClaude({ home: '/home/x', pathEnv: '/usr/bin:/opt/bin', plataforma: 'linux', existe: () => false }), null);
  assert.equal(acharClaude({ home: 'C:\\Users\\x', pathEnv: 'C:\\bin;D:\\npm', plataforma: 'win32', existe: () => false }), null);
});

test('acharClaude: ~/.local/bin vem antes do PATH', () => {
  const vistos = [];
  const existe = (p) => {
    vistos.push(p);
    return true;
  };
  const home = path.win32.join('C:\\Users\\x', '.local', 'bin', 'claude.exe');
  assert.equal(acharClaude({ home: 'C:\\Users\\x', pathEnv: 'C:\\bin', plataforma: 'win32', existe }), home);
  assert.deepEqual(vistos, [home]);
  assert.equal(acharClaude({ home: '/home/x', pathEnv: '/usr/bin', plataforma: 'linux', existe: () => true }), '/home/x/.local/bin/claude');
});

test('acharClaude: no PATH, o primeiro diretório absoluto que tem o executável', () => {
  const tem = new Set(['/opt/bin/claude', '/usr/local/bin/claude']);
  const existe = (p) => tem.has(p);
  assert.equal(acharClaude({ home: '/home/x', pathEnv: 'bin:.::/usr/bin:/opt/bin:/usr/local/bin', plataforma: 'darwin', existe }), '/opt/bin/claude');
  // Entrada relativa nunca conta, mesmo tendo o executável.
  assert.equal(acharClaude({ home: '/home/x', pathEnv: 'bin', plataforma: 'linux', existe: (p) => p === path.posix.join('bin', 'claude') }), null);
});

test('acharClaude: no win32 só claude.exe; .cmd e .bat no PATH são ignorados', () => {
  const vistos = [];
  const tem = new Set(['C:\\npm\\claude.cmd', 'C:\\npm\\claude.bat', 'C:\\npm\\claude']);
  const existe = (p) => {
    vistos.push(p);
    return tem.has(p);
  };
  assert.equal(acharClaude({ home: 'C:\\Users\\x', pathEnv: 'C:\\npm', plataforma: 'win32', existe }), null);
  assert.ok(vistos.every((p) => p.endsWith('claude.exe')), vistos.join(', '));
  tem.add('D:\\ferr\\claude.exe');
  assert.equal(acharClaude({ home: 'C:\\Users\\x', pathEnv: 'C:\\npm;"D:\\ferr"', plataforma: 'win32', existe }), 'D:\\ferr\\claude.exe');
});

test('acharClaude: no win32, entradas sem unidade (\\raiz, C:rel, relativa) ficam de fora', () => {
  const existe = () => true;
  assert.equal(acharClaude({ home: null, pathEnv: '\\bin;C:bin;bin;.', plataforma: 'win32', existe }), null);
});

test('acharClaude: entradas ruins e existe que lança não quebram', () => {
  assert.equal(acharClaude({ home: null, pathEnv: null, plataforma: 'linux', existe: () => true }), null);
  assert.equal(acharClaude({ home: 5, pathEnv: 7, plataforma: 'linux', existe: () => true }), null);
  assert.equal(acharClaude({ home: 'relativo', pathEnv: null, plataforma: 'linux', existe: () => true }), null);
  // Sem opção nenhuma, os padrões do processo: devolve caminho ou null, sem lançar.
  for (const padrao of [acharClaude(), acharClaude(null)]) assert.ok(padrao === null || typeof padrao === 'string');
  assert.equal(acharClaude({ home: '/home/x', pathEnv: '/usr/bin', plataforma: 'linux', existe: () => { throw new Error('x'); } }), null);
  assert.equal(acharClaude({ home: '/home/x', pathEnv: '/usr/bin\0/y', plataforma: 'linux', existe: () => true }), '/home/x/.local/bin/claude');
});

test('acharClaude: existe padrão só aceita arquivo regular', () => {
  // Diretório que existe, mas sem claude: nunca devolve o diretório.
  const r = acharClaude({ home: path.resolve('.'), pathEnv: '', plataforma: process.platform });
  assert.equal(r, null);
});

// ---------------------------------------------------------------------------
// interpretarReset

test('interpretarReset: com mês, o ano corrente, na hora local', () => {
  assert.equal(interpretarReset('resets Sep 29, 5:19pm (America/Sao_Paulo)', AGORA), new Date(2026, 8, 29, 17, 19).getTime());
  assert.equal(interpretarReset('resets Oct 5, 9:59pm (America/Sao_Paulo)', AGORA), new Date(2026, 9, 5, 21, 59).getTime());
  assert.equal(interpretarReset('resets Oct 5, 10pm', AGORA), new Date(2026, 9, 5, 22, 0).getTime());
});

test('interpretarReset: sem mês, hoje; se já passou, amanhã', () => {
  assert.equal(interpretarReset('resets 5:19pm', AGORA), new Date(2026, 8, 29, 17, 19).getTime());
  const depois = new Date(2026, 8, 29, 17, 30).getTime();
  assert.equal(interpretarReset('resets 5:19pm', depois), new Date(2026, 8, 30, 17, 19).getTime());
  // O minuto inteiro ainda é hoje; só depois dele vira amanhã.
  assert.equal(interpretarReset('resets 5:19pm', new Date(2026, 8, 29, 17, 19, 59).getTime()), new Date(2026, 8, 29, 17, 19).getTime());
  assert.equal(interpretarReset('resets 5:19pm', new Date(2026, 8, 29, 17, 20, 0).getTime()), new Date(2026, 8, 30, 17, 19).getTime());
  // Virada de mês.
  assert.equal(interpretarReset('resets 1am', new Date(2026, 8, 30, 23, 0).getTime()), new Date(2026, 9, 1, 1, 0).getTime());
});

test('interpretarReset: 12am é meia-noite e 12pm é meio-dia', () => {
  const cedo = new Date(2026, 8, 29, 0, 0).getTime() - 60_000; // 28/09 23:59
  assert.equal(interpretarReset('resets 12am', cedo), new Date(2026, 8, 29, 0, 0).getTime());
  assert.equal(interpretarReset('resets 12pm', AGORA - 6 * 3600_000), new Date(2026, 8, 29, 12, 0).getTime());
  assert.equal(interpretarReset('resets 12:30am (UTC)', AGORA), new Date(2026, 8, 30, 0, 30).getTime());
});

test('interpretarReset: com mês mais de 1 dia no passado cai no ano seguinte', () => {
  const fimDeAno = new Date(2026, 11, 30, 10, 0).getTime();
  assert.equal(interpretarReset('resets Jan 2, 1pm', fimDeAno), new Date(2027, 0, 2, 13, 0).getTime());
  // Até 1 dia no passado ainda é o ano corrente.
  assert.equal(interpretarReset('resets Sep 29, 8am', AGORA), new Date(2026, 8, 29, 8, 0).getTime());
});

test('interpretarReset: data ou hora inválida dá null', () => {
  for (const t of ['resets Feb 30, 1pm', 'resets 13pm', 'resets 5:60pm', 'resets 0am', 'resets Sep 0, 1pm', 'resets Sep 32, 1pm', 'resets Foo 3, 1pm', 'resets 5:19', 'resets soon', 'reset 5pm', ' resets 5pm', 'resets 5pm ', 'resets 5pm (' + 'x'.repeat(65) + ')']) {
    assert.equal(interpretarReset(t, AGORA), null, t);
  }
});

test('interpretarReset: entrada que não é texto ou agora não finito dá null', () => {
  for (const t of [null, undefined, 5, {}]) assert.equal(interpretarReset(t, AGORA), null, String(t));
  for (const a of [NaN, Infinity, '1', null]) assert.equal(interpretarReset('resets 5pm', a), null, String(a));
});

// ---------------------------------------------------------------------------
// interpretarSaida (E2, S26)

test('interpretarSaida: a saída real dá 25, 41 e 57 com os reinícios em hora local', () => {
  const r = interpretarSaida(REAL, AGORA);
  assert.equal(r.ok, true);
  assert.deepEqual(r.uso, {
    sessao: { pct: 25, resetsAtMs: new Date(2026, 8, 29, 17, 19).getTime() },
    semana: { pct: 41, resetsAtMs: new Date(2026, 9, 5, 21, 59).getTime() },
    modelos: { fable: { pct: 57, resetsAtMs: new Date(2026, 9, 5, 21, 59).getTime() } },
  });
});

test('interpretarSaida: qualquer sinal de modelo chamado dá custo (trava de E2)', () => {
  for (const extra of [{ num_turns: 1 }, { total_cost_usd: 0.01 }, { num_turns: '0' }, { total_cost_usd: null }, { local_command: 'compact', num_turns: 1 }]) {
    const saida = JSON.stringify({ ...JSON.parse(REAL), ...extra });
    assert.deepEqual(interpretarSaida(saida, AGORA), { ok: false, motivo: 'custo' }, JSON.stringify(extra));
  }
  for (const campo of ['num_turns', 'total_cost_usd']) {
    const semCampo = JSON.parse(REAL);
    delete semCampo[campo];
    assert.deepEqual(interpretarSaida(JSON.stringify(semCampo), AGORA), { ok: false, motivo: 'custo' }, campo);
  }
});

test('interpretarSaida: zero turnos e custo zero fora do comando usage é formato, não custo (portão Fable, item 5)', () => {
  const outro = JSON.stringify({ ...JSON.parse(REAL), local_command: 'compact' });
  assert.deepEqual(interpretarSaida(outro, AGORA), { ok: false, motivo: 'formato' });
  const semCampo = JSON.parse(REAL);
  delete semCampo.local_command;
  assert.deepEqual(interpretarSaida(JSON.stringify(semCampo), AGORA), { ok: false, motivo: 'formato' });
});

test('interpretarSaida: JSON inválido, tipo errado ou result ruim dá formato', () => {
  const casos = [
    '',
    'não é json',
    '{"type":"result"',
    'null',
    '[]',
    '"texto"',
    JSON.stringify({ ...JSON.parse(REAL), type: 'assistant' }),
    comResult('nada aqui'),
    comResult(''),
    comResult(42),
    comResult('Current session: 25% used\n'.padEnd(20 * 1024, 'x')),
    comResult('Current session: 101% used · resets 5:19pm'),
    comResult('Current session: 25.5.5% used'),
    comResult('Current session: -5% used'),
    comResult('  Current session: 25% used'),
    comResult('Current session: 25% used · resets agora e sempre'),
  ];
  for (const s of casos.slice(0, -1)) assert.deepEqual(interpretarSaida(s, AGORA), { ok: false, motivo: 'formato' }, s.slice(0, 80));
  for (const s of [undefined, null, 5, {}]) assert.deepEqual(interpretarSaida(s, AGORA), { ok: false, motivo: 'formato' }, String(s));
  // O "resets" que não se interpreta tira só o reinício, nunca o número.
  const r = interpretarSaida(casos.at(-1), AGORA);
  assert.deepEqual(r, { ok: true, uso: { sessao: { pct: 25, resetsAtMs: null }, semana: null, modelos: {} } });
});

test('interpretarSaida: pct fora de 0–100 anula só aquela janela quando outra casou', () => {
  const r = interpretarSaida(comResult('Current session: 101% used · resets 5:19pm\nCurrent week (all models): 41% used'), AGORA);
  assert.deepEqual(r, { ok: true, uso: { sessao: null, semana: { pct: 41, resetsAtMs: null }, modelos: {} } });
});

test('interpretarSaida: só a linha do Fable dá ok com sessão e semana null', () => {
  const r = interpretarSaida(comResult('Current week (Fable): 57% used · resets Oct 5, 9:59pm (America/Sao_Paulo)'), AGORA);
  assert.deepEqual(r, { ok: true, uso: { sessao: null, semana: null, modelos: { fable: { pct: 57, resetsAtMs: new Date(2026, 9, 5, 21, 59).getTime() } } } });
});

test('interpretarSaida: decimais, 0 e 100, ordem trocada e CRLF', () => {
  const r = interpretarSaida(comResult('Current week (Fable): 100% used\r\nCurrent week (all models): 0% used\r\nCurrent session: 12.34% used · resets 5:19pm'), AGORA);
  assert.deepEqual(r, {
    ok: true,
    uso: {
      sessao: { pct: 12.34, resetsAtMs: new Date(2026, 8, 29, 17, 19).getTime() },
      semana: { pct: 0, resetsAtMs: null },
      modelos: { fable: { pct: 100, resetsAtMs: null } },
    },
  });
});

test('interpretarSaida: a mesma linha duas vezes é ambígua e não vira número', () => {
  const r = interpretarSaida(comResult('Current session: 25% used\nCurrent session: 90% used\nCurrent week (all models): 41% used'), AGORA);
  assert.deepEqual(r, { ok: true, uso: { sessao: null, semana: { pct: 41, resetsAtMs: null }, modelos: {} } });
});

test('interpretarSaida: o result tem teto de 16 KiB', () => {
  const linha = 'Current session: 25% used';
  const noLimite = comResult(linha + '\n'.padEnd(16 * 1024 - linha.length, ' '));
  assert.equal(interpretarSaida(noLimite, AGORA).ok, true);
  const acima = comResult(linha + '\n'.padEnd(16 * 1024 - linha.length + 1, ' '));
  assert.deepEqual(interpretarSaida(acima, AGORA), { ok: false, motivo: 'formato' });
});

// ---------------------------------------------------------------------------
// rodarUso (E3, S26)

const EXE = '/home/x/.local/bin/claude';

test('rodarUso: sem executável dá sem-claude, sem rodar nada', async () => {
  let rodou = false;
  const executar = () => {
    rodou = true;
  };
  for (const exe of [null, undefined, '', 5]) {
    assert.deepEqual(await rodarUso({ exe, cwd: '/tmp', agoraMs: AGORA, executar }), { ok: false, motivo: 'sem-claude' });
  }
  assert.equal(rodou, false);
});

test('rodarUso: sucesso repassa a interpretação, com args, prazo, teto e ambiente fixos', async () => {
  let chamada = null;
  const executar = (exe, args, opcoes, cb) => {
    chamada = { exe, args, opcoes };
    cb(null, REAL, '');
  };
  const r = await rodarUso({ exe: EXE, cwd: '/dados/uso-cwd', env: { PATH: '/usr/bin' }, agoraMs: AGORA, executar });
  assert.deepEqual(r, interpretarSaida(REAL, AGORA));
  assert.equal(r.ok, true);
  assert.equal(chamada.exe, EXE);
  assert.deepEqual([...chamada.args], [...argsUso()]);
  assert.equal(chamada.opcoes.cwd, '/dados/uso-cwd');
  assert.equal(chamada.opcoes.timeout, PRAZO_USO_MS + 5_000);
  assert.equal(chamada.opcoes.maxBuffer, MAX_SAIDA_BYTES);
  assert.equal(chamada.opcoes.windowsHide, true);
  assert.equal(chamada.opcoes.encoding, 'utf8');
  assert.equal(chamada.opcoes.env.PATH, '/usr/bin');
  assert.equal(chamada.opcoes.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, undefined);
  assert.equal(PRAZO_USO_MS, 30_000);
  assert.equal(MAX_SAIDA_BYTES, 64 * 1024);
});

test('rodarUso: prazo estourado dá tempo', async () => {
  const erros = [
    Object.assign(new Error('t'), { killed: true, signal: 'SIGTERM' }),
    Object.assign(new Error('t'), { killed: false, signal: 'SIGKILL' }),
    Object.assign(new Error('t'), { code: 'ETIMEDOUT' }),
  ];
  for (const e of erros) {
    const r = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(e, '', '') });
    assert.deepEqual(r, { ok: false, motivo: 'tempo' });
  }
});

test('rodarUso: saída acima do teto dá saida, mesmo com o filho morto', async () => {
  // O execFile mata o filho ao passar do maxBuffer, e o erro vem com killed.
  const e = Object.assign(new Error('max'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' });
  const r = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(e, 'x'.repeat(100), '') });
  assert.deepEqual(r, { ok: false, motivo: 'saida' });
});

test('rodarUso: código diferente de 0 com stdout vazio dá erro; com JSON, interpreta', async () => {
  const e = Object.assign(new Error('exit 1'), { code: 1 });
  assert.deepEqual(await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(e, '', 'falhou') }), { ok: false, motivo: 'erro' });
  const enoent = Object.assign(new Error('spawn'), { code: 'ENOENT' });
  assert.deepEqual(await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(enoent, '', '') }), { ok: false, motivo: 'erro' });
  const r = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(e, REAL, '') });
  assert.equal(r.ok, true);
});

test('rodarUso: executar que lança dá erro, e a promessa nunca rejeita', async () => {
  const r = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: () => { throw new Error('spawn EPERM'); } });
  assert.deepEqual(r, { ok: false, motivo: 'erro' });
  // Callback chamado duas vezes: vale a primeira.
  const r2 = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => { cb(null, REAL, ''); cb(new Error('de novo'), '', ''); } });
  assert.equal(r2.ok, true);
  // stdout que não é texto não quebra.
  const r3 = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(null, Buffer.from(REAL), '') });
  assert.equal(r3.ok, true);
  const r4 = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, executar: (x, a, o, cb) => cb(null, undefined, '') });
  assert.deepEqual(r4, { ok: false, motivo: 'formato' });
});

test('rodarUso: argumentos ruins nunca rejeitam', async () => {
  assert.deepEqual(await rodarUso(), { ok: false, motivo: 'sem-claude' });
  assert.deepEqual(await rodarUso(null), { ok: false, motivo: 'sem-claude' });
});

test('rodarUso: o prazo próprio resolve com tempo sem esperar o close e mata a árvore (portão Fable, item 2)', async () => {
  const filho = { pid: 4242 };
  const mortos = [];
  let cb = null;
  const inicio = Date.now();
  const r = await rodarUso({
    exe: EXE, cwd: '/tmp', agoraMs: AGORA, prazoMs: 50,
    executar: (x, a, o, callback) => { cb = callback; return filho; },
    matar: (f) => mortos.push(f),
  });
  assert.deepEqual(r, { ok: false, motivo: 'tempo' });
  assert.ok(Date.now() - inicio < 5_000);
  assert.deepEqual(mortos, [filho]);
  // O callback tardio não muda nada.
  cb(null, REAL, '');
  // Prazo fora da faixa volta ao padrão (não acelera nem estende).
  let opcoesVistas = null;
  await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, prazoMs: 10 * PRAZO_USO_MS, executar: (x, a, o, c) => { opcoesVistas = o; c(null, REAL, ''); } });
  assert.equal(opcoesVistas.timeout, PRAZO_USO_MS + 5_000);
});

test('rodarUso: resposta antes do prazo não chama matar', async () => {
  const mortos = [];
  const r = await rodarUso({ exe: EXE, cwd: '/tmp', agoraMs: AGORA, prazoMs: 50, executar: (x, a, o, cb) => { cb(null, REAL, ''); return { pid: 1 }; }, matar: (f) => mortos.push(f) });
  assert.equal(r.ok, true);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.deepEqual(mortos, []);
});

test('matarArvore: taskkill do System32 por caminho absoluto no win32; SIGKILL fora dele; pid ruim não faz nada', () => {
  const chamadas = [];
  const executar = (exe, args, opcoes) => chamadas.push({ exe, args, opcoes });
  matarArvore({ pid: 123 }, { plataforma: 'win32', executar, systemRoot: String.raw`D:\Win` });
  assert.deepEqual(chamadas[0].exe, String.raw`D:\Win\System32\taskkill.exe`);
  assert.deepEqual(chamadas[0].args, ['/pid', '123', '/t', '/f']);
  assert.equal(chamadas[0].opcoes.windowsHide, true);
  for (const raiz of [null, '', 'relativo', String.raw`\\srv\share`, `${String.raw`C:\x`}\0y`]) {
    matarArvore({ pid: 7 }, { plataforma: 'win32', executar, systemRoot: raiz });
    assert.equal(chamadas.at(-1).exe, String.raw`C:\Windows\System32\taskkill.exe`, String(raiz));
  }
  const sinais = [];
  matarArvore({ pid: 9, kill: (s) => sinais.push(s) }, { plataforma: 'linux', executar });
  assert.deepEqual(sinais, ['SIGKILL']);
  const antes = chamadas.length;
  for (const f of [null, undefined, {}, { pid: 0 }, { pid: -1 }, { pid: 1.5 }, { pid: '12' }]) matarArvore(f, { plataforma: 'win32', executar });
  assert.equal(chamadas.length, antes);
  assert.doesNotThrow(() => matarArvore({ pid: 5, kill: () => { throw new Error('ESRCH'); } }, { plataforma: 'linux' }));
});

const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('matarArvore: no Windows de verdade, o neto que herdou o stdout também morre', { skip: process.platform !== 'win32' }, async () => {
  // Pai node que abre um neto node com o stdout herdado e imprime o pid dele.
  const neto = 'setInterval(() => {}, 1000)';
  const pai = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(neto)}], { stdio: ['ignore', 'inherit', 'inherit'] }); console.log(c.pid); setInterval(() => {}, 1000);`;
  const filho = spawn(process.execPath, ['-e', pai], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const pidNeto = await new Promise((ok) => filho.stdout.once('data', (d) => ok(Number(String(d).trim()))));
  assert.ok(vivo(pidNeto));
  matarArvore(filho);
  const limite = Date.now() + 10_000;
  while ((vivo(pidNeto) || vivo(filho.pid)) && Date.now() < limite) await new Promise((ok) => setTimeout(ok, 100));
  const sobrou = vivo(pidNeto);
  if (sobrou) spawnSync('taskkill', ['/pid', String(pidNeto), '/f']);
  assert.equal(sobrou, false, 'o neto sobreviveu');
  assert.equal(vivo(filho.pid), false);
});

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reposDaConfig, repoDoOrigin, lerOrigin, gerarRelatorio, codigoErro, periodos, ARQ_CONFIG } from '../src/consumo.js';
import { AVISO_CONFIG, CLAUDE_RAIZ_RECUSADA, CLAUDE_SEM_TRANSCRIPTS, CLAUDE_SEM_RECENTES, formatarMarkdown } from '../src/relatorio.js';
import { ARQ_ESTADO } from '../src/estado.js';

// Pipeline do /consumo (addendum da Task 10, B e D): config.json, origin do
// git, leitura do estado, índice de transcripts e GitHub em paralelo. Tudo em
// pastas temporárias; o gh é sempre um executor falso, nunca o de verdade.

let home, raiz;
const homeOriginal = process.env.HADOUKEN_HOME;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk consumo ç '));
  process.env.HADOUKEN_HOME = path.join(home, 'dados');
  fs.mkdirSync(process.env.HADOUKEN_HOME);
  raiz = path.join(home, 'projects');
});
afterEach(() => {
  if (homeOriginal === undefined) delete process.env.HADOUKEN_HOME;
  else process.env.HADOUKEN_HOME = homeOriginal;
  fs.rmSync(home, { recursive: true, force: true });
});

// Meio-dia local de hoje, fixo: "hoje" começa na meia-noite local de
// `agora`, e com Date.now() uma execução iniciada logo depois da meia-noite
// punha a resposta de `agora - 1 s` no dia anterior. As respostas ficam até
// 12 h à frente do relógio, dentro da tolerância de 1 dia do indexador.
const agora = new Date().setHours(12, 0, 0, 0);
const DIA = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const arqConfig = () => path.join(process.env.HADOUKEN_HOME, ARQ_CONFIG);
const config = (texto) => fs.writeFileSync(arqConfig(), texto);
const linha = (req, { ts = agora - 1000, cwd = 'C:/Projetos DEV/Demo Proj', model = 'claude-opus-5' } = {}) => JSON.stringify({
  type: 'assistant', requestId: req, apiBlockIndex: 0, sessionId: 'sess-1', cwd,
  timestamp: iso(ts), effort: 'high', isSidechain: false,
  message: { id: `msg-${req}`, model, usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } },
});
const transcript = (rel, linhas) => {
  const arq = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, `${linhas.join('\n')}\n`);
  return arq;
};

// ------------------------------------------------------------ config.json

test('config.json ausente: sem repos e sem aviso (o origin decide)', () => {
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [] });
});

test('config.json válido: até 20 repos que passam na regex da Task 9', () => {
  config(JSON.stringify({ repos: ['Garioli-Labs/resonance-pro', 'o/r'] }));
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: ['Garioli-Labs/resonance-pro', 'o/r'], avisos: [] });
  config(`\u{FEFF}${JSON.stringify({ repos: [], outra: 1 })}`);
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: [], avisos: [] }, 'lista vazia é escolha do usuário; BOM aceito');
  const vinte = Array.from({ length: 20 }, (_, i) => `o/r${i}`);
  config(JSON.stringify({ repos: vinte }));
  assert.deepEqual(reposDaConfig(arqConfig()).repos, vinte);
});

test('malicioso: config.json fora do formato é ignorado inteiro, com o aviso fixo', () => {
  const casos = {
    numero: '42',
    nulo: 'null',
    textoNaRaiz: '"o/r"',
    reposNulo: '{"repos": null}',
    reposObjeto: '{"repos": {"0": "o/r", "length": 1}}',
    vinteEUm: JSON.stringify({ repos: Array.from({ length: 21 }, (_, i) => `o/r${i}`) }),
    naoTexto: JSON.stringify({ repos: ['o/r', 42] }),
    injecao: JSON.stringify({ repos: ['a/b; rm -rf ~'] }),
    caminho: JSON.stringify({ repos: ['../../etc/passwd'] }),
    string: JSON.stringify({ repos: 'o/r' }),
    lista: JSON.stringify([{ repos: ['o/r'] }]),
    quebrado: '{ "repos": [',
    grande: JSON.stringify({ repos: ['o/r'], lixo: 'x'.repeat(64 * 1024) }),
  };
  for (const [nome, texto] of Object.entries(casos)) {
    config(texto);
    assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [AVISO_CONFIG] }, nome);
  }
  assert.equal({}.repos, undefined, 'Object.prototype intocado');
  fs.rmSync(arqConfig());
  fs.mkdirSync(arqConfig());
  assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [AVISO_CONFIG] }, 'pasta no lugar do arquivo');
});

// Decisão do controlador (fix round 1): objeto sem `repos` próprio não é
// arquivo quebrado, é config sem repos (pode ter só limiares). O `__proto__`
// do JSON.parse é chave própria comum e nunca é lida.
test('config.json sem `repos` próprio: sem aviso, o origin decide (vazio, só limiares, __proto__)', () => {
  const casos = {
    vazio: '{}',
    soLimiares: JSON.stringify({ limiares: { cinco_horas: 80 } }),
    proto: '{"__proto__": {"repos": ["evil/x"]}}',
    protoEOutra: '{"__proto__": {"repos": ["evil/x"]}, "outra": 1}',
  };
  for (const [nome, texto] of Object.entries(casos)) {
    config(texto);
    assert.deepEqual(reposDaConfig(arqConfig()), { repos: null, avisos: [] }, nome);
  }
  assert.equal({}.repos, undefined, 'Object.prototype intocado');
});

// ------------------------------------------------------------ origin

test('origin: só as três formas do github.com, depois a regex da Task 9', () => {
  const aceitos = {
    'https://github.com/o/r': 'o/r',
    'https://github.com/Garioli-Labs/claude-hadouken.git': 'Garioli-Labs/claude-hadouken',
    'git@github.com:o/r.git': 'o/r',
    'git@github.com:o/r.github.io': 'o/r.github.io',
    'ssh://git@github.com/o/r.git': 'o/r',
  };
  for (const [url, repo] of Object.entries(aceitos)) assert.equal(repoDoOrigin(url), repo, url);
  const recusados = [
    'https://evil.example/github.com/a/b',
    'https://github.com.evil.example/a/b',
    'http://github.com/a/b',
    'https://user:token@github.com/a/b',
    'https://github.com/a/b/',
    'https://github.com/a/b/c',
    'https://github.com/../b',
    'https://github.com/-a/b',
    'https://github.com/a/.git',
    'git@github.com:a/b\nhttps://github.com/c/d',
    'ssh://git@github.com:22/a/b',
    'git@evil.example:a/b',
    'file:///github.com/a/b',
    `https://github.com/a/${'b'.repeat(600)}`,
    '', null, 42,
  ];
  for (const url of recusados) assert.equal(repoDoOrigin(url), null, String(url));
});

const temGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('lerOrigin: repo git com origin do GitHub, pasta sem git e origin estranho', { skip: !temGit && 'git ausente' }, async () => {
  const repo = path.join(home, 'repo ç');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  assert.deepEqual(await lerOrigin(repo), ['o/r']);
  git('remote', 'set-url', 'origin', 'https://evil.example/github.com/a/b');
  assert.deepEqual(await lerOrigin(repo), []);
  const solta = path.join(home, 'solta');
  fs.mkdirSync(solta);
  assert.deepEqual(await lerOrigin(solta), []);
  assert.deepEqual(await lerOrigin(path.join(home, 'nao-existe')), []);
  assert.deepEqual(await lerOrigin(42), await lerOrigin(process.cwd()), 'cwd inválido usa o cwd do processo');
});

// ------------------------------------------------------------ gerarRelatorio

// Executor falso do gh: responde por endpoint e conta as chamadas.
function ghFalso(chamadas, respostas = {}) {
  return async (args) => {
    const ep = args[1];
    chamadas.push(ep);
    if (ep.includes('/actions/runs?')) {
      return { ok: true, stdout: JSON.stringify(respostas.runs ?? { total_count: 1, workflow_runs: [{ id: 101, created_at: iso(agora - 3_600_000), event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { private: true } }] }) };
    }
    if (ep.endsWith('/actions/cache/usage')) return { ok: true, stdout: JSON.stringify({ active_caches_size_in_bytes: 1024 }) };
    if (ep.includes('/jobs?')) {
      return { ok: true, stdout: JSON.stringify({ total_count: 1, jobs: [{ labels: ['ubuntu-latest'], started_at: iso(agora - 3_600_000), completed_at: iso(agora - 3_600_000 + 90_000) }] }) };
    }
    return { ok: false, motivo: 'HTTP 404' };
  };
}

function gravarEstado(extra = {}) {
  const s = Math.floor(agora / 1000);
  fs.writeFileSync(path.join(process.env.HADOUKEN_HOME, ARQ_ESTADO), JSON.stringify({
    versao: 1, at: iso(agora - 60_000),
    five_hour: { used_percentage: 42, resets_at: s + 3600 },
    seven_day: { used_percentage: 48, resets_at: s + 2 * 86_400 },
    sessoes: {}, ...extra,
  }));
}

test('gerarRelatorio junta estado, transcripts e GitHub num relatório versionado', async () => {
  gravarEstado();
  config(JSON.stringify({ repos: ['o/r'] }));
  transcript('proj-a/s1.jsonl', [linha('r1'), linha('r2', { model: 'claude-sonnet-5' })]);
  const chamadas = [];
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso(chamadas), raizTranscripts: raiz, cwd: home });
  assert.equal(r.ok, true);
  const rel = r.relatorio;
  assert.equal(rel.versao, 1);
  assert.equal(rel.limites.seven_day.used_percentage, 48);
  assert.equal(rel.claude.hoje.total.respostas, 2);
  assert.deepEqual(Object.keys(rel.claude.hoje.porProjeto), ['Demo Proj']);
  assert.equal(rel.claude.semana_origem, 'janela_7d');
  assert.equal(rel.claude.semana_desde, iso((Math.floor(agora / 1000) + 2 * 86_400) * 1000 - 7 * DIA));
  assert.equal(rel.claude.arquivos, 1);
  assert.equal(rel.github['o/r'].runs30.total, 1);
  assert.equal(rel.github['o/r'].minutos30.linux, 2);
  assert.equal(rel.github['o/r'].publico, false);
  assert.ok(chamadas.length >= 3 && chamadas.every((ep) => ep.startsWith('repos/o/r')), chamadas.join(' '));
  assert.deepEqual(rel.avisos, []);
});

test('a semana começa no início da janela de 7d: resposta anterior a ela fica de fora', async () => {
  gravarEstado();
  config(JSON.stringify({ repos: [] }));
  transcript('proj-a/s1.jsonl', [linha('dentro', { ts: agora - 2 * DIA }), linha('fora', { ts: agora - 6 * DIA })]);
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home });
  assert.equal(r.relatorio.claude.semana.total.respostas, 1, 'janela começou há 5 dias');
  assert.equal(r.relatorio.claude.hoje.total.respostas, 0);
});

test('sem leitura de 7d: a semana são os últimos 7 dias', async () => {
  config(JSON.stringify({ repos: [] }));
  transcript('proj-a/s1.jsonl', [linha('a', { ts: agora - 6 * DIA }), linha('b', { ts: agora - 8 * DIA })]);
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home });
  assert.equal(r.relatorio.claude.semana_origem, 'ultimos_7_dias');
  assert.equal(r.relatorio.claude.semana.total.respostas, 1);
  assert.equal(r.relatorio.limites, null);
});

// ------------------------------------------------------------ períodos

const meiaNoite = (ms) => new Date(ms).setHours(0, 0, 0, 0);
const estadoCom = (resetS, extra = {}) => ({
  versao: 1, at: iso(agora - 60_000),
  five_hour: { used_percentage: 42, resets_at: Math.floor(agora / 1000) + 3600 },
  seven_day: { used_percentage: 48, resets_at: resetS },
  sessoes: {}, ...extra,
});

test('periodos: hoje na meia-noite local, 7 dias exatos e a janela de 7d ou a reserva', () => {
  const s = Math.floor(agora / 1000);
  const semLeitura = periodos(null, agora);
  const hoje = new Date(semLeitura.hojeMs);
  assert.deepEqual([hoje.getHours(), hoje.getMinutes(), hoje.getSeconds(), hoje.getMilliseconds()], [0, 0, 0, 0]);
  assert.equal(hoje.toDateString(), new Date(agora).toDateString(), 'o mesmo dia do calendário local');
  assert.equal(semLeitura.seteDiasMs, agora - 7 * DIA, 'agora menos 7 × 24 h, sem fuso');
  assert.deepEqual(semLeitura.semana, { desdeMs: agora - 7 * DIA, origem: 'ultimos_7_dias' });
  const janela = periodos(estadoCom(s + 2 * 86_400), agora);
  assert.deepEqual(janela.semana, { desdeMs: (s + 2 * 86_400) * 1000 - 7 * DIA, origem: 'janela_7d' });
  assert.equal(janela.hojeMs, semLeitura.hojeMs);
  // Na meia-noite exata "hoje" começa nela; 1 ms antes, na meia-noite anterior.
  const m = semLeitura.hojeMs;
  assert.equal(periodos(null, m).hojeMs, m);
  assert.equal(periodos(null, m - 1).hojeMs, meiaNoite(m - 1));
  assert.ok(meiaNoite(m - 1) < m && m - meiaNoite(m - 1) <= 25 * 3_600_000);
  // Leitura velha, janela que começaria no futuro ou estado hostil: a reserva.
  const reservas = {
    velha: estadoCom(s + 2 * 86_400, { at: iso(agora - 2 * 3_600_000) }),
    futura: estadoCom(s + 8 * 86_400),
    lixo: estadoCom('amanhã'),
    lanca: { get versao() { throw new Error('C:\\x'); } },
  };
  for (const [nome, estado] of Object.entries(reservas)) {
    assert.deepEqual(periodos(estado, agora).semana, { desdeMs: agora - 7 * DIA, origem: 'ultimos_7_dias' }, nome);
  }
});

// O fuso vem do ambiente: cada caso roda num processo filho com TZ própria.
// America/New_York em 2026-03-08 adianta o relógio (o dia tem 23 h) e em
// 2026-11-01 atrasa (25 h); Asia/Kolkata é UTC+5:30, sem horário de verão.
function periodosNoFuso(tz, agoras) {
  const url = new URL('../src/consumo.js', import.meta.url).href;
  const codigo = `import { periodos } from ${JSON.stringify(url)};
const agoras = ${JSON.stringify(agoras)};
console.log(JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, offsetJan: new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset(), hoje: agoras.map((a) => periodos(null, a).hojeMs) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('periodos: meia-noite local em fusos com e sem horário de verão (processo filho com TZ)', (t) => {
  const Z = (s) => Date.parse(s);
  // Deslocamento de cada fuso em 15/01/2026 (getTimezoneOffset, em minutos):
  // prova que o filho aplicou o fuso, seja qual for o nome que o ICU devolve
  // (Asia/Kolkata sai como Asia/Calcutta em alguns Node).
  const offsetJan = { 'America/New_York': 300, 'Asia/Kolkata': -330, UTC: 0 };
  const casos = {
    'America/New_York': [
      // Dia de 23 h: meia-noite ainda em EST (UTC-5).
      [Z('2026-03-08T15:00:00Z'), Z('2026-03-08T05:00:00Z')],
      [Z('2026-03-08T05:00:00Z'), Z('2026-03-08T05:00:00Z')],
      [Z('2026-03-08T04:59:59.999Z'), Z('2026-03-07T05:00:00Z')],
      // Dia seguinte já em EDT (UTC-4).
      [Z('2026-03-09T12:00:00Z'), Z('2026-03-09T04:00:00Z')],
      // Dia de 25 h: meia-noite ainda em EDT.
      [Z('2026-11-01T23:30:00Z'), Z('2026-11-01T04:00:00Z')],
    ],
    'Asia/Kolkata': [
      [Z('2026-03-08T00:00:00Z'), Z('2026-03-07T18:30:00Z')],
      [Z('2026-03-07T18:30:00Z'), Z('2026-03-07T18:30:00Z')],
      [Z('2026-03-07T18:29:59.999Z'), Z('2026-03-06T18:30:00Z')],
    ],
    UTC: [[Z('2026-03-08T23:59:59.999Z'), Z('2026-03-08T00:00:00Z')]],
  };
  let aplicados = 0;
  for (const [tz, pares] of Object.entries(casos)) {
    const r = periodosNoFuso(tz, pares.map(([a]) => a));
    if (r.offsetJan !== offsetJan[tz]) {
      t.diagnostic(`fuso ${tz} indisponível neste Node (resolvido: ${r.tz})`);
      continue;
    }
    aplicados++;
    assert.deepEqual(r.hoje.map((ms) => new Date(ms).toISOString()), pares.map(([, m]) => new Date(m).toISOString()), tz);
  }
  assert.ok(aplicados > 0, 'nenhum fuso aplicado: o teste não provaria nada');
});

// Linha com sessão e detalhe de cache à escolha.
const linhaUso = (req, { ts = agora - 1000, sessao = 'sess-1', cwd = 'C:/Projetos DEV/Demo Proj', model = 'claude-opus-5', detalhe = null } = {}) => JSON.stringify({
  type: 'assistant', requestId: req, apiBlockIndex: 0, sessionId: sessao, cwd,
  timestamp: iso(ts), effort: 'high', isSidechain: false,
  message: {
    id: `msg-${req}`, model,
    usage: {
      input_tokens: 10, output_tokens: 100, output_tokens_details: { thinking_tokens: 40 }, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500,
      ...(detalhe === null ? {} : { cache_creation: { ephemeral_1h_input_tokens: detalhe[0], ephemeral_5m_input_tokens: detalhe[1] } }),
    },
  },
});

test('limites dos períodos: resposta no instante exato entra, 1 ms antes fica de fora', async () => {
  const s = Math.floor(agora / 1000);
  gravarEstado({ seven_day: { used_percentage: 48, resets_at: s + 2 * 86_400 } });
  config(JSON.stringify({ repos: [] }));
  const hojeMs = meiaNoite(agora);
  const janelaMs = agora - 5 * DIA;
  const seteMs = agora - 7 * DIA;
  transcript('proj-a/s1.jsonl', [
    linhaUso('hoje0', { ts: hojeMs }), linhaUso('hoje1', { ts: hojeMs - 1 }),
    linhaUso('jan0', { ts: janelaMs }), linhaUso('jan1', { ts: janelaMs - 1 }),
    linhaUso('sete0', { ts: seteMs }), linhaUso('sete1', { ts: seteMs - 1 }),
  ]);
  const c = (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home })).relatorio.claude;
  assert.equal(c.hoje.total.respostas, 1, 'só hoje0');
  assert.equal(c.semana.total.respostas, 3, 'hoje0, hoje1 e jan0');
  assert.equal(c.sete_dias.total.respostas, 5, 'todas menos sete1');
  assert.equal(c.hoje_desde, iso(hojeMs));
  assert.equal(c.semana_desde, iso(janelaMs));
  assert.equal(c.semana_origem, 'janela_7d');
  assert.equal(c.sete_dias_desde, iso(seteMs));
});

test('por sessão e cache criado 1 h / 5 min de ponta a ponta, sem pensamento no relatório', async () => {
  config(JSON.stringify({ repos: [] }));
  transcript('proj-a/s1.jsonl', [
    linhaUso('a1', { sessao: 'sess-a', detalhe: [300, 200] }),
    linhaUso('a2', { sessao: 'sess-a', detalhe: [100, 400] }),
    linhaUso('b1', { sessao: 'sess-b', cwd: '/x/Outro', model: 'claude-sonnet-5' }),
    linhaUso('c1', { sessao: 'sess-c', detalhe: [0, 58_716] }),
  ]);
  const r = (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home })).relatorio;
  const hoje = r.claude.hoje;
  assert.deepEqual(Object.keys(hoje.porSessao), ['sess-a', 'sess-b', 'sess-c'], 'em ordem de consumo, empate pelo id');
  const a = hoje.porSessao['sess-a'];
  assert.deepEqual([a.respostas, a.cacheCreate, a.cacheCreate1h, a.cacheCreate5m, a.cacheCreateSemDetalhe], [2, 1000, 400, 600, 0]);
  assert.deepEqual([a.projetos, a.modelos], [['Demo Proj'], ['claude-opus-5']]);
  const b = hoje.porSessao['sess-b'];
  assert.deepEqual([b.cacheCreate1h, b.cacheCreate5m, b.cacheCreateSemDetalhe, b.projetos, b.modelos], [0, 0, 500, ['Outro'], ['claude-sonnet-5']]);
  // Detalhe que não soma o total (caso real): o total vai para sem detalhe.
  const c = hoje.porSessao['sess-c'];
  assert.deepEqual([c.cacheCreate1h, c.cacheCreate5m, c.cacheCreateSemDetalhe], [0, 0, 500]);
  const t = hoje.total;
  assert.deepEqual([t.cacheCreate, t.cacheCreate1h, t.cacheCreate5m, t.cacheCreateSemDetalhe], [2000, 400, 600, 1000]);
  assert.equal(hoje.sessoesOmitidas, 0);
  assert.doesNotMatch(JSON.stringify(r), /thinking/);
  const texto = formatarMarkdown(r);
  assert.match(texto, /^\| `sess-a` \| ▰▰▰▰▱▱▱▱ 50% \| `Demo Proj` \| `Opus 5` \| 2 \| 20 \| 400 \| 600 \| 0 \| 2k \| 200 \| /m);
  assert.match(texto, /cache criado sem detalhe/);
});

test('detalhe incoerente do cache criado de ponta a ponta: contado por período, nota no markdown, nada deduzido', async () => {
  config(JSON.stringify({ repos: [] }));
  transcript('proj-a/s1.jsonl', [
    linhaUso('ok1', { detalhe: [300, 200] }),
    linhaUso('inc1', { detalhe: [0, 58_716] }),
    linhaUso('inc2', { detalhe: [100, 100] }),
    linhaUso('sem1'),
  ]);
  for (const vez of ['frio', 'quente']) {
    const r = (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home })).relatorio;
    for (const p of ['hoje', 'sete_dias', 'semana']) assert.equal(r.claude[p].detalheIncoerente, 2, `${vez} ${p}`);
    const t = r.claude.hoje.total;
    assert.deepEqual([t.cacheCreate, t.cacheCreate1h, t.cacheCreate5m, t.cacheCreateSemDetalhe], [2000, 300, 200, 1500], vez);
    assert.match(formatarMarkdown(r), /^Detalhe incoerente: 2 respostas trazem 1 h \+ 5 min /m, vez);
  }
});

test('config.json inválido: aviso fixo e o origin do cwd no lugar', { skip: !temGit && 'git ausente' }, async () => {
  config('{"repos": ["a/b; rm"]}');
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/r.git'], { cwd: repo });
  const chamadas = [];
  const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso(chamadas), raizTranscripts: raiz, cwd: repo });
  assert.deepEqual(r.relatorio.avisos, [AVISO_CONFIG]);
  assert.deepEqual(Object.keys(r.relatorio.github), ['o/r']);
  assert.ok(chamadas.every((ep) => !ep.includes('rm')));
});

test('config.json sem `repos` próprio: o relatório usa o origin do cwd, sem aviso, e evil/x nunca chega ao gh', { skip: !temGit && 'git ausente' }, async () => {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/r.git'], { cwd: repo });
  const casos = { vazio: '{}', soLimiares: JSON.stringify({ limiares: {} }), proto: '{"__proto__": {"repos": ["evil/x"]}}' };
  for (const [nome, texto] of Object.entries(casos)) {
    config(texto);
    // Sem o cache do GitHub do caso anterior: cada caso chama o gh.
    fs.rmSync(path.join(process.env.HADOUKEN_HOME, 'github-cache.json'), { force: true });
    const chamadas = [];
    const r = await gerarRelatorio({ agoraMs: agora, gh: ghFalso(chamadas), raizTranscripts: raiz, cwd: repo });
    assert.deepEqual(r.relatorio.avisos, [], nome);
    assert.deepEqual(Object.keys(r.relatorio.github), ['o/r'], nome);
    assert.ok(chamadas.length > 0 && chamadas.every((ep) => ep.startsWith('repos/o/r/') && !ep.includes('evil')), `${nome}: ${chamadas.join(' ')}`);
  }
});

test('transcripts: raiz ausente, raiz sem nada recente e raiz ligada (junção ou link) são motivos distintos', async (t) => {
  config(JSON.stringify({ repos: [] }));
  const gerar = async () => (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), raizTranscripts: raiz, cwd: home })).relatorio.claude;
  assert.deepEqual(await gerar(), { indisponivel: CLAUDE_SEM_TRANSCRIPTS });
  const arq = transcript('proj-a/velho.jsonl', [linha('v', { ts: agora - 20 * DIA })]);
  const velho = new Date(agora - 20 * DIA);
  fs.utimesSync(arq, velho, velho);
  assert.deepEqual(await gerar(), { indisponivel: CLAUDE_SEM_RECENTES });
  // A raiz de verdade vira link para uma pasta com transcript recente: o
  // indexador recusa a raiz ligada (D11) e o relatório diz isso, nunca
  // "nenhum transcript".
  const alvo = path.join(home, 'alvo');
  fs.renameSync(raiz, alvo);
  fs.rmSync(raiz, { recursive: true, force: true });
  fs.writeFileSync(path.join(alvo, 'proj-a', 'novo.jsonl'), `${linha('n')}\n`);
  try {
    fs.symlinkSync(alvo, raiz, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    t.skip(`sem link: ${e.code}`);
    return;
  }
  assert.deepEqual(await gerar(), { indisponivel: CLAUDE_RAIZ_RECUSADA });
});

test('raiz padrão: <CLAUDE_CONFIG_DIR>/projects quando absoluto; senão ~/.claude/projects', async () => {
  config(JSON.stringify({ repos: [] }));
  const casa = path.join(home, 'casa');
  const cfg = path.join(home, 'cfg claude');
  const escrever = (dir, linhas) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 's.jsonl'), `${linhas.join('\n')}\n`);
  };
  escrever(path.join(cfg, 'projects', 'proj-a'), [linha('c1')]);
  escrever(path.join(casa, '.claude', 'projects', 'proj-b'), [linha('h1'), linha('h2')]);
  const nomes = ['CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE'];
  const salvo = Object.fromEntries(nomes.map((k) => [k, process.env[k]]));
  const respostas = async () => (await gerarRelatorio({ agoraMs: agora, gh: ghFalso([]), cwd: home })).relatorio.claude.hoje.total.respostas;
  try {
    process.env.HOME = casa;
    process.env.USERPROFILE = casa;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    assert.equal(await respostas(), 1, 'CLAUDE_CONFIG_DIR absoluto');
    process.env.CLAUDE_CONFIG_DIR = path.join('relativo', 'cfg');
    assert.equal(await respostas(), 2, 'relativo: ignorado, vale a home');
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(await respostas(), 2, 'ausente: a home');
  } finally {
    for (const k of nomes) {
      if (salvo[k] === undefined) delete process.env[k];
      else process.env[k] = salvo[k];
    }
  }
});

test('o prazo do GitHub chega ao coletor: gh que nunca responde vira tempo esgotado, e os transcripts saem', async () => {
  config(JSON.stringify({ repos: ['o/r'] }));
  transcript('proj-a/s1.jsonl', [linha('r1')]);
  const inicio = Date.now();
  const r = await gerarRelatorio({ agoraMs: agora, gh: () => new Promise(() => {}), raizTranscripts: raiz, cwd: home, prazoGithubMs: 300 });
  assert.ok(Date.now() - inicio < 5000, `${Date.now() - inicio} ms`);
  assert.deepEqual(r.relatorio.github['o/r'], { indisponivel: 'tempo esgotado' });
  assert.equal(r.relatorio.claude.hoje.total.respostas, 1);
});

test('GitHub e transcripts rodam em paralelo: o gh é chamado antes de o índice terminar', async () => {
  config(JSON.stringify({ repos: ['o/r'] }));
  for (let i = 0; i < 40; i++) transcript(`proj-${i}/s.jsonl`, [linha(`r${i}`)]);
  const abrir = fs.promises.open;
  let abertosAntesDoGh = null;
  let abertos = 0;
  fs.promises.open = async function (...a) { abertos++; return abrir.apply(this, a); };
  const gh = async (args) => {
    if (abertosAntesDoGh === null) abertosAntesDoGh = abertos;
    return ghFalso([])(args);
  };
  let r;
  try {
    r = await gerarRelatorio({ agoraMs: agora, gh, raizTranscripts: raiz, cwd: home });
  } finally {
    fs.promises.open = abrir;
  }
  assert.equal(r.relatorio.claude.arquivos, 40);
  assert.ok(abertosAntesDoGh !== null && abertosAntesDoGh < 40, `transcripts abertos antes do primeiro gh: ${abertosAntesDoGh}`);
});

test('codigoErro: só códigos da lista, senão desconhecido; nunca lança', () => {
  assert.equal(codigoErro(Object.assign(new Error('C:\\Users\\Fulano\\x'), { code: 'EACCES' })), 'EACCES');
  assert.equal(codigoErro(Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' })), 'ERR_MODULE_NOT_FOUND');
  assert.equal(codigoErro(new Error('C:\\Users\\Fulano\\segredo.json')), 'desconhecido');
  assert.equal(codigoErro(Object.assign(new Error('x'), { code: 'C:\\x' })), 'desconhecido');
  assert.equal(codigoErro({ get code() { throw new Error('x'); } }), 'desconhecido');
  assert.equal(codigoErro(null), 'desconhecido');
  assert.equal(codigoErro('ENOENT'), 'desconhecido');
});

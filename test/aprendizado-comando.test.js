import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhos, ligadoExiste } from '../src/aprendizado/arquivos.js';
import { FIXADO } from '../src/aprendizado/baixar.js';
import { caminhoBinario, registrarInstalacao } from '../src/aprendizado/coletor.js';
import { executarComando, interpretarComando } from '../src/aprendizado/comando.js';
import * as msg from '../src/aprendizado/mensagens.js';
import {
  ajustesVazios, gravarAjustes, gravarLigado, gravarSugestoes, lerAjustes, lerEventosApr, lerSugestoes,
} from '../src/aprendizado/registro.js';

// O comando /hadouken:aprender (spec aprendizado §3.2, R4) e o Foco de
// revisão 5: vindo de uma sessão `claude -p` filha (CLAUDE_CODE_ENTRYPOINT
// sdk-*) ou de uma origem que não é o comando digitado (ruling I1 do
// preflight, a mesma lista fechada do liberar.js), nada do aprendizado é
// gravado; só a recusa vira evento, e só com o aprendizado ligado (§11).
// Pasta de dados e settings.json temporários.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOOK = path.join(repo, 'src', 'hooks', 'aprender.js');
const [PLATAFORMA, ARCH] = Object.keys(FIXADO)[0].split('-');
const ORIGEM_OK = Object.freeze({ fonte: 'plugin', expansao: 'slash_command' });
const SETTINGS_INICIAL = '{\n  "model": "opus"\n}\n';
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function cenario({ ligado = false } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aprender ç '));
  tmps.push(raiz);
  const dir = path.join(raiz, 'hadouken');
  const cfg = path.join(raiz, 'cfg');
  fs.mkdirSync(dir);
  fs.mkdirSync(cfg);
  const arquivo = path.join(cfg, 'settings.json');
  fs.writeFileSync(arquivo, SETTINGS_INICIAL);
  const agora = Date.now();
  if (ligado) {
    const em = new Date(agora - 86_400_000).toISOString();
    assert.equal(gravarLigado(dir, { chaves: {}, criouEnv: false }, agora).ok, true);
    const aj = ajustesVazios();
    aj.seq = 1;
    aj.vigentes['guarda.fableTetoPct'] = 80;
    aj.registros.push({ id: 'a1', item: 'guarda.fableTetoPct', antes: null, depois: 80, motivo: 'esgotou-2-de-3', em, origem: 'auto' });
    assert.equal(gravarAjustes(dir, aj).ok, true);
    assert.equal(gravarSugestoes(dir, {
      v: 1, seq: 1, lista: [{ id: 's1', estado: 'pendente', em, tipo: 'afrouxar', item: 'guarda.fableTetoPct', de: 80, para: 85 }],
    }).ok, true);
  }
  return { raiz, dir, cfg, arquivo };
}

// Ligado com uma chave nossa no env, ao lado de uma do usuário.
function cenarioComEnv() {
  const c = cenario();
  fs.writeFileSync(c.arquivo, '{\n  "model": "opus",\n  "env": {\n    "MEU": "x",\n    "CLAUDE_CODE_ENABLE_TELEMETRY": "1"\n  }\n}\n');
  assert.equal(gravarLigado(c.dir, { chaves: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' }, criouEnv: false }, Date.now()).ok, true);
  return c;
}

function fotografar(raiz) {
  const r = {};
  for (const rel of fs.readdirSync(raiz, { recursive: true }).map(String).sort()) {
    const p = path.join(raiz, rel);
    r[rel] = fs.lstatSync(p).isDirectory() ? 'pasta' : fs.readFileSync(p).toString('base64');
  }
  return r;
}

// A foto sem o registro de eventos do aprendizado (o único arquivo que uma
// recusa com o aprendizado ligado pode mudar).
function semEventos(foto) {
  const r = { ...foto };
  delete r[path.join('hadouken', 'aprendizado-eventos.json')];
  return r;
}

function rodarHook(c, args, entrypoint, extra = {}) {
  const env = {
    ...process.env, HADOUKEN_HOME: c.dir, HADOUKEN_SETTINGS: c.arquivo, CLAUDE_CONFIG_DIR: c.cfg, HADOUKEN_SEM_PAINEL: '1',
    CLAUDE_CODE_ENTRYPOINT: entrypoint,
  };
  assert.ok(env.HADOUKEN_HOME.startsWith(os.tmpdir()));
  const entrada = {
    session_id: 'sessao-teste', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_source: 'plugin',
    command_name: 'hadouken:aprender', command_args: args, ...extra,
  };
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete entrada[k];
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('gramática: subcomando, argumento validado, desligar com alcance e código', () => {
  const casos = [
    ['', { sub: 'status', arg: null }],
    ['  STATUS ', { sub: 'status', arg: null }],
    ['ligar', { sub: 'ligar', arg: null }],
    ['ligar AB12cd34', { sub: 'ligar', arg: 'ab12cd34' }],
    ['desligar', { sub: 'desligar', arg: null, codigo: null }],
    ['desligar dados', { sub: 'desligar', arg: 'dados', codigo: null }],
    ['desligar tudo', { sub: 'desligar', arg: 'tudo', codigo: null }],
    ['DESLIGAR Tudo', { sub: 'desligar', arg: 'tudo', codigo: null }],
    ['desligar ab12cd34', { sub: 'desligar', arg: null, codigo: 'ab12cd34' }],
    ['desligar dados 0123abcd', { sub: 'desligar', arg: 'dados', codigo: '0123abcd' }],
    ['desligar   tudo   ffffffff ', { sub: 'desligar', arg: 'tudo', codigo: 'ffffffff' }],
    // O código em maiúsculas vale, como no ligar (rodada 1, Important 2).
    ['desligar AB12CD34', { sub: 'desligar', arg: null, codigo: 'ab12cd34' }],
    ['desligar dados AB12cd34', { sub: 'desligar', arg: 'dados', codigo: 'ab12cd34' }],
    ['desfazer', { sub: 'desfazer', arg: null }],
    ['desfazer a12', { sub: 'desfazer', arg: 'a12' }],
    ['aprovar s1', { sub: 'aprovar', arg: 's1' }],
    ['recusar s999999', { sub: 'recusar', arg: 's999999' }],
  ];
  for (const [texto, esperado] of casos) assert.deepEqual(interpretarComando(texto), esperado, texto);
  for (const ruim of ['status x', 'ligar 123', 'ligar ab12cd345', 'desligar metade', 'desfazer s1', 'aprovar', 'aprovar a1', 'recusar s1 s2',
    'apagar', '__proto__', 'x'.repeat(300), null, 42,
    // desligar: código com tamanho errado ou não hex, fora de ordem, argumento a mais, alcance que não é da gramática.
    'desligar ab12cd3', 'desligar ab12cd345', 'desligar AB12CD3', 'desligar ab12cd34 dados',
    'desligar dados tudo', 'desligar dados ab12cd34 x', 'desligar tudo ab12cd34 ab12cd34', 'desligar nada', 'desligar nada ab12cd34',
    'desligar g1234567', 'desligar dados dados']) {
    assert.equal(interpretarComando(ruim), null, String(ruim));
  }
});

test('Foco de revisão 5: aprovar s1 vindo de sessão -p/SDK é recusado sem gravar nada além do evento da recusa', () => {
  const c = cenario({ ligado: true });
  const antes = fotografar(c.raiz);
  for (const ep of ['sdk-cli', 'sdk-ts', 'SDK-PY']) {
    const r = rodarHook(c, 'aprovar s1', ep);
    assert.deepEqual(r, { decision: 'block', reason: msg.RECUSADO_ENTRYPOINT });
  }
  assert.deepEqual(semEventos(fotografar(c.raiz)), semEventos(antes), 'nenhum outro byte mudou e nenhum outro arquivo apareceu');
  assert.deepEqual(lerEventosApr(c.dir, Date.now()).map((e) => e.tipo), ['comando-recusado', 'comando-recusado', 'comando-recusado']);
  // O mesmo cenário numa sessão interativa aprova: a recusa acima não é por
  // cenário inválido.
  const ok = rodarHook(c, 'aprovar s1', 'cli');
  assert.match(ok.reason, /^hadouken: aprovado\. O teto do Fable na guarda passa de 80% para 85% \(a2\)\./);
  assert.equal(lerAjustes(c.dir, Date.now()).vigentes['guarda.fableTetoPct'], 85);
  assert.deepEqual(lerSugestoes(c.dir, Date.now()).lista, []);
});

test('ruling I1: só o comando digitado (plugin + slash_command) vale; outra origem é recusada e só vira evento', () => {
  const origens = [
    { command_source: 'skill_tool' }, { command_source: 'scheduled_task' }, { command_source: '/loop' }, { command_source: 'queued_prompt' },
    { command_source: 'Plugin' }, { command_source: '' }, { command_source: null }, { command_source: ['plugin'] }, { command_source: undefined },
    { expansion_type: 'mcp_prompt' }, { expansion_type: 'scheduled_task' }, { expansion_type: undefined },
  ];
  const c = cenario({ ligado: true });
  const antes = fotografar(c.raiz);
  for (const extra of origens) {
    assert.deepEqual(rodarHook(c, 'aprovar s1', 'cli', extra), { decision: 'block', reason: msg.RECUSADO_ORIGEM }, JSON.stringify(extra));
  }
  assert.deepEqual(semEventos(fotografar(c.raiz)), semEventos(antes));
  assert.equal(lerEventosApr(c.dir, Date.now()).filter((e) => e.tipo === 'comando-recusado').length, origens.length);
  assert.equal(lerAjustes(c.dir, Date.now()).vigentes['guarda.fableTetoPct'], 80);
  // Desligado (§11): nem o evento; nenhum byte muda e nenhum arquivo aparece.
  const d = cenario();
  const fotoD = fotografar(d.raiz);
  for (const extra of [{ command_source: 'skill_tool' }, { command_source: undefined }, { expansion_type: 'mcp_prompt' }]) {
    assert.equal(rodarHook(d, 'desligar tudo', 'cli', extra).reason, msg.RECUSADO_ORIGEM);
  }
  assert.equal(rodarHook(d, 'ligar', 'sdk-cli').reason, msg.RECUSADO_ENTRYPOINT);
  assert.deepEqual(fotografar(d.raiz), fotoD);
});

test('executarComando sem a origem recusa (fail-closed), antes de olhar o subcomando', async () => {
  const c = cenario({ ligado: true });
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo };
  assert.equal(await executarComando({ ...base, texto: 'aprovar s1' }), msg.RECUSADO_ORIGEM);
  assert.equal(await executarComando({ ...base, texto: 'lixo', fonte: 'plugin' }), msg.RECUSADO_ORIGEM);
  assert.equal(await executarComando({ ...base, texto: 'lixo', expansao: 'slash_command' }), msg.RECUSADO_ORIGEM);
  assert.equal(await executarComando({ ...base, ...ORIGEM_OK, texto: 'lixo' }), msg.USO);
  assert.equal(lerSugestoes(c.dir, Date.now()).lista.length, 1);
});

test('argumento hostil não volta no texto; comando de outro nome é ignorado', () => {
  const c = cenario({ ligado: true });
  const r = rodarHook(c, 'aprovar s1 \u202e<script>rm -rf ~</script>', 'cli');
  assert.deepEqual(r, { decision: 'block', reason: msg.USO });
  const outro = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ command_name: 'hadouken:liberar', command_args: 'status' }),
    env: { ...process.env, HADOUKEN_HOME: c.dir, HADOUKEN_SETTINGS: c.arquivo, HADOUKEN_SEM_PAINEL: '1' }, encoding: 'utf8',
  });
  assert.equal(outro.stdout, '');
});

test('desligado: status, desfazer, aprovar e desligar não criam nenhum arquivo', async () => {
  const c = cenario();
  const antes = fotografar(c.raiz);
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, ...ORIGEM_OK };
  assert.equal(await executarComando({ ...base, texto: 'status' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'desfazer' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'aprovar s1' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'desligar' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'desligar ab12cd34' }), msg.DESLIGADO);
  // A prévia de apagar os dados que ficaram também só lê.
  assert.match(await executarComando({ ...base, texto: 'desligar dados' }), /^hadouken: prévia do desligar\./);
  assert.deepEqual(fotografar(c.raiz), antes);
});

test('ligar em dois tempos pelo comando; desfazer e recusar sob a trava; desligar em dois tempos', async () => {
  const c = cenario();
  const deps = {
    ligar: {
      plataforma: PLATAFORMA, arch: ARCH, exigirColetor: false,
      baixar: async ({ destino }) => { fs.writeFileSync(destino, 'tar'); return { ok: true, bytes: 3 }; },
      extrair: ({ dir }) => { fs.writeFileSync(caminhoBinario(dir, PLATAFORMA), 'bin'); return { ok: registrarInstalacao(dir, PLATAFORMA).ok }; },
    },
    desligar: { parar: () => ({ ok: true, motivo: 'sem-pid' }) },
  };
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, deps, ...ORIGEM_OK };
  const p = await executarComando({ ...base, texto: 'ligar' });
  const codigo = /aprender ligar ([0-9a-f]{8})$/.exec(p)?.[1];
  assert.ok(codigo, p);
  assert.equal(ligadoExiste(c.dir), false);
  const l = await executarComando({ ...base, texto: `ligar ${codigo}` });
  assert.match(l, /^hadouken: aprendizado ligado\./);
  assert.ok(ligadoExiste(c.dir));
  assert.equal(JSON.parse(fs.readFileSync(c.arquivo, 'utf8')).env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:47318');
  assert.match(await executarComando({ ...base, texto: 'status' }), /^hadouken: aprendizado ligado\./);
  assert.match(await executarComando({ ...base, texto: 'desfazer' }), /^hadouken: não há ajuste para desfazer\./);
  assert.equal(await executarComando({ ...base, texto: 'recusar s9' }), msg.SEM_SUGESTAO);
  fs.writeFileSync(caminhos(c.dir).trava, '');
  assert.equal(await executarComando({ ...base, texto: 'desfazer' }), msg.OCUPADO);
  fs.rmSync(caminhos(c.dir).trava);
  // desligar sem código: só a prévia, nada muda.
  const antes = fotografar(c.raiz);
  const pd = await executarComando({ ...base, texto: 'desligar' });
  assert.match(pd, /^hadouken: prévia do desligar\. Nada foi mudado ainda\./);
  assert.match(pd, /^ {3}- OTEL_EXPORTER_OTLP_ENDPOINT$/m);
  assert.match(pd, /sai inteiro/);
  assert.deepEqual(fotografar(c.raiz), antes);
  const cd = /aprender desligar ([0-9a-f]{8})$/.exec(pd)?.[1];
  assert.ok(cd, pd);
  // Outro instante: a cópia do settings.json leva o agoraMs no nome, e a do
  // ligar já usou o da base ('backup-existe').
  const d = await executarComando({ ...base, agoraMs: base.agoraMs + 1, texto: `desligar ${cd}` });
  assert.match(d, /^hadouken: aprendizado desligado\./);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), SETTINGS_INICIAL);
  assert.equal(ligadoExiste(c.dir), false);
});

test('desligar com código errado ou velho é recusado sem efeito; o código da prévia depende do alcance', async () => {
  const c = cenarioComEnv();
  let parou = 0;
  const deps = { desligar: { parar: () => { parou++; return { ok: true, motivo: 'sem-pid' }; } } };
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, deps, ...ORIGEM_OK };
  const pNada = await executarComando({ ...base, texto: 'desligar' });
  const pDados = await executarComando({ ...base, texto: 'desligar dados' });
  const cNada = /aprender desligar ([0-9a-f]{8})$/.exec(pNada)?.[1];
  const cDados = /aprender desligar dados ([0-9a-f]{8})$/.exec(pDados)?.[1];
  assert.ok(cNada && cDados && cNada !== cDados, `${pNada}\n${pDados}`);
  assert.match(pNada, /^ {3}- CLAUDE_CODE_ENABLE_TELEMETRY$/m);
  assert.doesNotMatch(pNada, /MEU|sai inteiro/);
  const antes = fotografar(c.raiz);
  // Código errado, e o código certo de outro alcance.
  const errado = cNada === '00000000' ? '11111111' : '00000000';
  for (const texto of [`desligar ${errado}`, `desligar dados ${cNada}`, `desligar tudo ${cDados}`]) {
    assert.equal(await executarComando({ ...base, texto }), msg.falhaDesligar({ ok: false, motivo: 'codigo' }), texto);
  }
  assert.deepEqual(fotografar(c.raiz), antes);
  assert.equal(parou, 0);
  // Código velho: o settings.json mudou depois da prévia.
  const mudado = fs.readFileSync(c.arquivo, 'utf8').replace('"opus"', '"sonnet"');
  fs.writeFileSync(c.arquivo, mudado);
  const depois = fotografar(c.raiz);
  assert.equal(await executarComando({ ...base, texto: `desligar ${cNada}` }), msg.falhaDesligar({ ok: false, motivo: 'codigo' }));
  assert.deepEqual(fotografar(c.raiz), depois);
  assert.ok(ligadoExiste(c.dir));
  assert.equal(parou, 0);
  // A prévia nova dá o código que vale; com ele, desliga e apaga os dados.
  const p2 = await executarComando({ ...base, texto: 'desligar dados' });
  const c2 = /aprender desligar dados ([0-9a-f]{8})$/.exec(p2)?.[1];
  assert.ok(c2 && c2 !== cDados, p2);
  const d = await executarComando({ ...base, texto: `desligar dados ${c2}` });
  assert.match(d, /^hadouken: aprendizado desligado\. 1 chave saiu do env do settings\.json/);
  assert.match(d, /Os dados do aprendizado foram apagados/);
  assert.equal(parou, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(c.arquivo, 'utf8')), { model: 'sonnet', env: { MEU: 'x' } });
  assert.equal(ligadoExiste(c.dir), false);
  // Já desligado: os dados que sobraram se apagam também em dois tempos.
  const p3 = await executarComando({ ...base, texto: 'desligar tudo' });
  assert.match(p3, /já está desligado: o settings\.json não muda/);
  const c3 = /aprender desligar tudo ([0-9a-f]{8})$/.exec(p3)?.[1];
  assert.match(await executarComando({ ...base, texto: `desligar tudo ${c3}` }), /^hadouken: aprendizado desligado\./);
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
});

test('desligar ocupado e ligar ocupado viram mensagens próprias', async () => {
  const c = cenarioComEnv();
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, deps: { desligar: { parar: () => ({ ok: true, motivo: 'sem-pid' }) } }, ...ORIGEM_OK };
  const cd = /aprender desligar ([0-9a-f]{8})$/.exec(await executarComando({ ...base, texto: 'desligar' }))?.[1];
  fs.writeFileSync(caminhos(c.dir).trava, '');
  const r = await executarComando({ ...base, texto: `desligar ${cd}` });
  assert.equal(r, msg.falhaDesligar({ ok: false, motivo: 'ocupado' }));
  assert.match(r, /ocupado com outra sessão/);
  fs.rmSync(caminhos(c.dir).trava);
  assert.ok(ligadoExiste(c.dir));
});

// Rodada 1 (Minor 2): desfazer que deixaria amarelo ≥ vermelho é recusado
// pelo comando, com o texto de 'conflito' e sem gravar nada.
test('desfazer com conflito de faixas é recusado sem gravar', async () => {
  const c = cenario({ ligado: true });
  const em = new Date(Date.now() - 3_600_000).toISOString();
  const aj = ajustesVazios();
  aj.seq = 2;
  aj.vigentes['painel.amarelo'] = 80;
  aj.vigentes['painel.vermelho'] = 85;
  aj.registros.push(
    { id: 'a1', item: 'painel.amarelo', antes: 85, depois: 80, motivo: 'faixa-historico', em, origem: 'auto' },
    { id: 'a2', item: 'painel.vermelho', antes: 90, depois: 85, motivo: 'faixa-historico', em, origem: 'auto' },
  );
  assert.equal(gravarAjustes(c.dir, aj).ok, true);
  assert.equal(lerAjustes(c.dir, Date.now()).registros.length, 2);
  const antes = fotografar(c.raiz);
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, ...ORIGEM_OK };
  const r = await executarComando({ ...base, texto: 'desfazer a1' });
  assert.equal(r, msg.falhaDesfazer('conflito'));
  assert.match(r, /faixa amarela/);
  assert.deepEqual(fotografar(c.raiz), antes);
  // Sem id, o último (a2, a vermelha) se desfaz normalmente.
  assert.match(await executarComando({ ...base, texto: 'desfazer' }), /^hadouken: desfeito\. A faixa vermelha do painel volta a 90%/);
});

test('hooks.json liga o aprender com timeout de 600 s (R5) e a skill é inerte', () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const grupo = h.UserPromptExpansion.find((g) => g.matcher === 'hadouken:aprender');
  assert.deepEqual(grupo.hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/hooks/aprender.js'], timeout: 600 }]);
  const t = fs.readFileSync(path.join(repo, 'skills', 'aprender', 'SKILL.md'), 'utf8');
  const [, fm, corpo] = t.split(/^---$/m);
  assert.match(fm, /^name: aprender$/m);
  assert.match(fm, /^disable-model-invocation: true$/m);
  assert.match(corpo, /nada foi mudado/);
  assert.doesNotMatch(corpo, /\bnode\b|ligado\.json|ajustes\.json|\$ARGUMENTS|`/);
});

test('o hook não carrega o módulo de rede antes do gate: ligar.js só por import dinâmico', () => {
  const t = fs.readFileSync(path.join(repo, 'src', 'aprendizado', 'comando.js'), 'utf8');
  assert.doesNotMatch(t, /^import [^;]*from '\.\/(?:ligar|baixar|coletor)\.js';$/m);
  assert.match(t, /await import\('\.\/ligar\.js'\)/);
});

// Task 13 da v0.5.3: aprovar a subida grava roteamento.subir no config.json,
// preservando o resto, e mostra o agente substituto. Sem o comando, nada.
test('aprovar subir agente grava roteamento.subir no config.json e cita o substituto', async () => {
  const c = cenario({ ligado: true });
  fs.writeFileSync(path.join(c.dir, 'config.json'), JSON.stringify({ guarda: { teto7d: 80 }, roteamento: { avisos: false } }));
  const em = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(gravarSugestoes(c.dir, {
    v: 1, seq: 2, lista: [{ id: 's2', estado: 'pendente', em, tipo: 'subir-agente', agente: 'hadouken:mecanico', de: 'haiku', para: 'sonnet', retrabalhoPct: 25 }],
  }).ok, true);
  assert.equal(lerSugestoes(c.dir, Date.now()).lista.length, 1, 'a sugestão gravada é lida de volta');
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, ...ORIGEM_OK };
  const t = await executarComando({ ...base, texto: 'aprovar s2' });
  assert.equal(t, 'hadouken: aplicado: use hadouken:executor para tarefas mecânicas (roteamento.subir no config.json). O modelo do hadouken:mecanico não muda; o hadouken nunca troca o modelo sozinho.');
  const cfg = JSON.parse(fs.readFileSync(path.join(c.dir, 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { guarda: { teto7d: 80 }, roteamento: { avisos: false, subir: { 'hadouken:mecanico': 'sonnet' } } });
  assert.deepEqual(lerSugestoes(c.dir, Date.now()).lista, []);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ARQ_CONFIG_BASE, CAMPOS_GUARDA, CONFIG_BASE_MAX, CONFIG_BASE_MAX_BYTES, ILEGIVEL, SETTINGS_MAX_BYTES,
  jsonCanonico, impressaoDe, impressaoDoArquivo, chaveDoArquivo, settingsDaSessao, lerConfigBase, fotografar,
  mudancaNaGuarda, decisaoConfig,
} from '../src/guarda/config-base.js';
import { lerEventos } from '../src/guarda/registros.js';
import * as msg from '../src/guarda/mensagens.js';

// Task 19b (spike S13 (a) da Task 2 da parte 2): o hook ConfigChange segura,
// na sessão em curso, a mudança de disableAllHooks, enabledPlugins ou hooks
// nos settings, comparando a impressão atual com a fotografia que o
// SessionStart tirou. Os testes de hook rodam em processo filho, com HOME e
// USERPROFILE falsos (o ~ do filho), CLAUDE_CONFIG_DIR e HADOUKEN_HOME
// temporários e HADOUKEN_SEM_PAINEL=1. Nenhum teste toca o ~/.claude de
// verdade.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WIN = process.platform === 'win32';
const H = 3_600_000;
const HEX64 = /^[0-9a-f]{64}$/;

const raizes = [];
after(() => { for (const r of raizes) fs.rmSync(r, { recursive: true, force: true }); });
const novaPasta = (nome = 'hdk cfg ç ') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), nome));
  raizes.push(d);
  return d;
};
const escrever = (arq, valor) => {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, typeof valor === 'string' ? valor : JSON.stringify(valor));
};

// --- unidade -------------------------------------------------------------------

test('jsonCanonico: chaves ordenadas em toda profundidade, listas na ordem, sem recursão', () => {
  assert.equal(jsonCanonico({ b: [3, { z: 1, a: null }], a: 'x' }), '{"a":"x","b":[3,{"a":null,"z":1}]}');
  assert.equal(jsonCanonico(null), 'null');
  assert.equal(jsonCanonico([]), '[]');
  assert.equal(jsonCanonico({}), '{}');
  assert.equal(jsonCanonico({ 'é"\\': String.fromCharCode(0x2028) }), JSON.stringify({ 'é"\\': String.fromCharCode(0x2028) }));
  // JSON.parse aceita centenas de milhares de níveis; uma serialização
  // recursiva estouraria a pilha e cairia no fail-open.
  const fundo = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
  assert.equal(jsonCanonico(JSON.parse(fundo)), fundo);
  const objFundo = `${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}`;
  assert.equal(jsonCanonico(JSON.parse(objFundo)), objFundo);
});

test('impressão estável com chaves em outra ordem; a ordem de uma lista conta', () => {
  const d = novaPasta();
  const a = path.join(d, 'a.json');
  const b = path.join(d, 'b.json');
  const c = path.join(d, 'c.json');
  escrever(a, '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}],"Stop":[]},"enabledPlugins":{"b@m":true,"a@m":false},"model":"opus","disableAllHooks":false}');
  escrever(b, '{\n  "disableAllHooks": false,\n  "enabledPlugins": { "a@m": false, "b@m": true },\n  "theme": "dark",\n  "hooks": { "Stop": [], "PreToolUse": [ { "hooks": [ { "command": "x", "type": "command" } ], "matcher": "Bash" } ] }\n}');
  escrever(c, '{"hooks":{"Stop":[],"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}]},"enabledPlugins":{"a@m":false,"b@m":true},"disableAllHooks":false,"extra":[2,1]}');
  const ia = impressaoDoArquivo(a);
  assert.match(ia.impressao, HEX64);
  assert.deepEqual(Object.keys(ia.campos), [...CAMPOS_GUARDA]);
  for (const k of CAMPOS_GUARDA) assert.match(ia.campos[k], HEX64, k);
  assert.deepEqual(impressaoDoArquivo(b), ia);
  assert.deepEqual(impressaoDoArquivo(c), ia);
  assert.deepEqual(impressaoDe(JSON.parse(fs.readFileSync(a, 'utf8'))), ia);
  // Duas entradas de hook trocadas de lugar: outra impressão.
  escrever(c, '{"hooks":{"Stop":[],"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"y"},{"type":"command","command":"x"}]}]}}');
  const ic = impressaoDoArquivo(c);
  escrever(c, '{"hooks":{"Stop":[],"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"},{"type":"command","command":"y"}]}]}}');
  assert.notEqual(impressaoDoArquivo(c).impressao, ic.impressao);
});

test('arquivo ausente, {} e campos null dão a mesma impressão (os três null)', () => {
  const d = novaPasta();
  const ausente = impressaoDoArquivo(path.join(d, 'nao-existe.json'));
  assert.match(ausente.impressao, HEX64);
  assert.deepEqual(ausente, impressaoDe({}));
  assert.deepEqual(ausente, impressaoDe({ disableAllHooks: null, enabledPlugins: null, hooks: null }));
  for (const [nome, texto] of [['vazio.json', '{}'], ['outros.json', '{"model":"opus","permissions":{"allow":[]}}'], ['nulos.json', '{"hooks":null}'], ['bom.json', String.fromCharCode(0xfeff) + '{}']]) {
    escrever(path.join(d, nome), texto);
    assert.deepEqual(impressaoDoArquivo(path.join(d, nome)), ausente, nome);
  }
  // Pasta-mãe ausente também é arquivo ausente.
  assert.deepEqual(impressaoDoArquivo(path.join(d, 'nao', 'existe', 'settings.json')), ausente);
  // Um campo presente muda a impressão inteira e só a dele.
  escrever(path.join(d, 'h.json'), '{"hooks":{}}');
  const h = impressaoDoArquivo(path.join(d, 'h.json'));
  assert.notEqual(h.impressao, ausente.impressao);
  assert.equal(h.campos.disableAllHooks, ausente.campos.disableAllHooks);
  assert.equal(h.campos.enabledPlugins, ausente.campos.enabledPlugins);
  assert.notEqual(h.campos.hooks, ausente.campos.hooks);
});

test('arquivo ilegível: JSON inválido, acima de 1 MiB ou que não é arquivo regular', () => {
  const d = novaPasta();
  const ilegivel = { impressao: ILEGIVEL, campos: null };
  assert.equal(ILEGIVEL, 'ilegivel');
  assert.equal(SETTINGS_MAX_BYTES, 1_048_576);
  escrever(path.join(d, 'quebrado.json'), '{"hooks": {');
  assert.deepEqual(impressaoDoArquivo(path.join(d, 'quebrado.json')), ilegivel);
  const grande = `{"a":"${'x'.repeat(SETTINGS_MAX_BYTES)}"}`;
  escrever(path.join(d, 'grande.json'), grande);
  assert.deepEqual(impressaoDoArquivo(path.join(d, 'grande.json')), ilegivel);
  // No teto exato ainda lê.
  escrever(path.join(d, 'no-teto.json'), `{"a":"${'x'.repeat(SETTINGS_MAX_BYTES - 8)}"}`);
  assert.equal(fs.statSync(path.join(d, 'no-teto.json')).size, SETTINGS_MAX_BYTES);
  assert.deepEqual(impressaoDoArquivo(path.join(d, 'no-teto.json')), impressaoDe({}));
  fs.mkdirSync(path.join(d, 'pasta.json'));
  assert.deepEqual(impressaoDoArquivo(path.join(d, 'pasta.json')), ilegivel);
});

test('chaveDoArquivo: caminho real; no win32, caixa e nome 8.3 casam a mesma chave', () => {
  const d = novaPasta();
  const arq = path.join(d, '.claude', 'settings.json');
  escrever(arq, '{}');
  const chave = chaveDoArquivo(arq);
  assert.ok(typeof chave === 'string' && path.isAbsolute(chave));
  assert.equal(chaveDoArquivo(path.join(d, '.claude', '..', '.claude', 'settings.json')), chave);
  // Arquivo ainda inexistente também tem chave (o ancestral existente mais longo).
  assert.ok(path.isAbsolute(chaveDoArquivo(path.join(d, '.claude', 'settings.local.json'))));
  for (const v of [null, 42, '', 'relativo/settings.json', `/${'a'.repeat(5000)}`]) assert.equal(chaveDoArquivo(v), null, String(v).slice(0, 40));
  if (WIN) {
    assert.equal(chaveDoArquivo(arq.toUpperCase()), chave);
    assert.equal(chave, chave.toLowerCase());
    const longo = fs.realpathSync.native(d);
    assert.equal(chaveDoArquivo(path.join(longo, '.claude', 'settings.json')), chave);
  }
});

test('settingsDaSessao: CLAUDE_CONFIG_DIR absoluto ou ~/.claude, e os dois do projeto', () => {
  const casa = path.join(os.tmpdir(), 'casa-falsa');
  const cfg = path.join(os.tmpdir(), 'cfg-falso');
  const cwd = path.join(os.tmpdir(), 'projeto-falso');
  const projeto = [path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')];
  assert.deepEqual(settingsDaSessao({ cwd, configDir: cfg, casa }), [path.join(cfg, 'settings.json'), ...projeto]);
  for (const configDir of [undefined, '', 'relativo', '.\\cfg']) {
    assert.deepEqual(settingsDaSessao({ cwd, configDir, casa }), [path.join(casa, '.claude', 'settings.json'), ...projeto], String(configDir));
  }
  assert.deepEqual(settingsDaSessao({ cwd: 'relativo', configDir: cfg, casa }), [path.join(cfg, 'settings.json')]);
  assert.deepEqual(settingsDaSessao({ cwd, configDir: undefined, casa: null }), projeto);
  assert.deepEqual(settingsDaSessao({}), []);
});

test('fotografar grava as impressões sob a chave normalizada; lerConfigBase as devolve', () => {
  const dados = novaPasta();
  const cwd = novaPasta();
  const proj = path.join(cwd, '.claude', 'settings.json');
  escrever(proj, { hooks: { Stop: [] }, model: 'x' });
  const local = path.join(cwd, '.claude', 'settings.local.json');
  const agora = Date.now();
  assert.deepEqual(fotografar(dados, [proj, local, 'relativo.json'], agora), { ok: true });
  const base = lerConfigBase(dados, agora);
  assert.deepEqual([...base.keys()], [chaveDoArquivo(proj), chaveDoArquivo(local)]);
  assert.deepEqual(base.get(chaveDoArquivo(proj)), { at: agora, ...impressaoDoArquivo(proj) });
  assert.deepEqual(base.get(chaveDoArquivo(local)), { at: agora, ...impressaoDe({}) });
  // Arquivo da pasta de dados: { v: 1, arquivos: { chave: { at, impressao, campos } } }.
  const cru = JSON.parse(fs.readFileSync(path.join(dados, ARQ_CONFIG_BASE), 'utf8'));
  assert.equal(cru.v, 1);
  assert.deepEqual(cru.arquivos[chaveDoArquivo(proj)], { at: new Date(agora).toISOString(), ...impressaoDoArquivo(proj) });
  // Uma nova fotografia do mesmo arquivo troca a entrada.
  escrever(proj, { disableAllHooks: true });
  assert.deepEqual(fotografar(dados, [proj], agora + 1000), { ok: true });
  assert.deepEqual(lerConfigBase(dados, agora + 1000).get(chaveDoArquivo(proj)), { at: agora + 1000, ...impressaoDoArquivo(proj) });
  assert.equal(lerConfigBase(dados, agora + 1000).size, 2);
  // Pasta de dados ou instante inválidos: nada gravado.
  assert.deepEqual(fotografar(null, [proj], agora), { ok: false });
  assert.deepEqual(fotografar(dados, [proj], Number.NaN), { ok: false });
  // Gravação que falha (o arquivo é uma pasta): ok false, sem lançar.
  const outra = novaPasta();
  fs.mkdirSync(path.join(outra, ARQ_CONFIG_BASE));
  assert.deepEqual(fotografar(outra, [proj], agora), { ok: false });
});

test('lerConfigBase: corrompido vira vazio; entrada fora da forma sai, as outras ficam', () => {
  const dados = novaPasta();
  const agora = Date.now();
  const arq = path.join(dados, ARQ_CONFIG_BASE);
  const boa = { at: new Date(agora - H).toISOString(), ...impressaoDe({ hooks: {} }) };
  const chave = path.join(os.tmpdir(), 'p', '.claude', 'settings.json');
  for (const texto of ['{', '[]', 'null', '{"v":2,"arquivos":{}}', '{"v":1}', '{"v":1,"arquivos":[]}']) {
    fs.writeFileSync(arq, texto);
    assert.equal(lerConfigBase(dados, agora).size, 0, texto);
  }
  fs.writeFileSync(arq, JSON.stringify({ v: 1, arquivos: {
    [chave]: boa,
    'relativo/settings.json': boa,
    [path.join(os.tmpdir(), 'futuro.json')]: { ...boa, at: new Date(agora + 2 * H).toISOString() },
    [path.join(os.tmpdir(), 'sem-at.json')]: { ...boa, at: 'ontem' },
    [path.join(os.tmpdir(), 'hash-ruim.json')]: { ...boa, impressao: 'abc' },
    [path.join(os.tmpdir(), 'campos-ruins.json')]: { ...boa, campos: { ...boa.campos, hooks: 1 } },
    [path.join(os.tmpdir(), 'ilegivel-com-campos.json')]: { ...boa, impressao: ILEGIVEL },
    [path.join(os.tmpdir(), 'ilegivel.json')]: { at: boa.at, impressao: ILEGIVEL, campos: null },
  } }));
  const base = lerConfigBase(dados, agora);
  assert.deepEqual([...base.keys()], [chave, path.join(os.tmpdir(), 'ilegivel.json')]);
  assert.deepEqual(base.get(chave), { at: agora - H, impressao: boa.impressao, campos: boa.campos });
  // Link no lugar do arquivo não é seguido.
  const fora = path.join(novaPasta(), 'fora.json');
  fs.copyFileSync(arq, fora);
  fs.rmSync(arq);
  try {
    fs.symlinkSync(fora, arq, 'file');
  } catch {
    return; // sem permissão de criar link aqui
  }
  assert.equal(lerConfigBase(dados, agora).size, 0);
});

test('a poda guarda os 200 caminhos mais novos pelo at, e o arquivo cabe no teto de leitura', () => {
  const dados = novaPasta();
  const agora = Date.now();
  assert.equal(CONFIG_BASE_MAX, 200);
  assert.equal(CONFIG_BASE_MAX_BYTES, 256 * 1024);
  const imp = impressaoDe({});
  // 205 entradas com o at fora da ordem de inserção.
  const idades = Array.from({ length: 205 }, (_, i) => (i * 37) % 205);
  const arquivos = {};
  for (const i of idades) arquivos[path.join(os.tmpdir(), `p${i}`, 'settings.json')] = { at: new Date(agora - (i + 1) * 60_000).toISOString(), ...imp };
  fs.writeFileSync(path.join(dados, ARQ_CONFIG_BASE), JSON.stringify({ v: 1, arquivos }));
  assert.equal(lerConfigBase(dados, agora).size, 205);
  const novo = path.join(novaPasta(), 'settings.json');
  assert.deepEqual(fotografar(dados, [novo], agora), { ok: true });
  const base = lerConfigBase(dados, agora);
  assert.equal(base.size, 200);
  assert.ok(base.has(chaveDoArquivo(novo)));
  // Saem as 6 mais velhas (idades 199 a 204 minutos).
  for (let i = 0; i < 205; i++) assert.equal(base.has(path.join(os.tmpdir(), `p${i}`, 'settings.json')), i < 199, `p${i}`);
  // Do mais velho para o mais novo.
  const ats = [...base.values()].map((e) => e.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));

  // Caminhos longos: 200 entradas de 3 mil caracteres passariam do teto de
  // leitura (o arquivo seria ilegível na próxima vez); saem as mais velhas
  // até caber, e a fotografia de agora fica.
  const longo = (letra, i) => path.join(os.tmpdir(), `${letra.repeat(3000)}${i}`, 'settings.json');
  const velhos = {};
  for (let i = 0; i < 60; i++) velhos[longo('l', i)] = { at: new Date(agora - (i + 1) * 60_000).toISOString(), ...imp };
  fs.writeFileSync(path.join(dados, ARQ_CONFIG_BASE), JSON.stringify({ v: 1, arquivos: velhos }));
  assert.equal(lerConfigBase(dados, agora).size, 60);
  const muitos = Array.from({ length: 40 }, (_, i) => longo('m', i));
  assert.deepEqual(fotografar(dados, [...muitos, novo], agora), { ok: true });
  assert.ok(fs.statSync(path.join(dados, ARQ_CONFIG_BASE)).size <= CONFIG_BASE_MAX_BYTES);
  const depois = lerConfigBase(dados, agora);
  assert.ok(depois.size > 41 && depois.size < 101, String(depois.size));
  assert.ok(depois.has(chaveDoArquivo(novo)));
  for (const m of muitos) assert.ok(depois.has(chaveDoArquivo(m)));
  // Dos velhos, ficam os mais novos.
  const ficaram = Object.keys(velhos).map((k) => depois.has(k));
  assert.deepEqual(ficaram, ficaram.map((_, i) => i < ficaram.filter(Boolean).length));
});

test('mudancaNaGuarda: o primeiro campo que mudou, na ordem disableAllHooks, enabledPlugins, hooks', () => {
  const dados = novaPasta();
  const cwd = novaPasta();
  const arq = path.join(cwd, '.claude', 'settings.json');
  const agora = Date.now();
  const inicial = { disableAllHooks: false, enabledPlugins: { 'claude-hadouken@m': true }, hooks: { Stop: [] }, model: 'a' };
  escrever(arq, inicial);
  fotografar(dados, [arq], agora);
  assert.equal(mudancaNaGuarda(dados, arq, agora), null);
  escrever(arq, { ...inicial, model: 'b', theme: 'x' });
  assert.equal(mudancaNaGuarda(dados, arq, agora), null);
  escrever(arq, { ...inicial, hooks: {} });
  assert.equal(mudancaNaGuarda(dados, arq, agora), 'hooks');
  escrever(arq, { ...inicial, hooks: {}, enabledPlugins: { 'claude-hadouken@m': false } });
  assert.equal(mudancaNaGuarda(dados, arq, agora), 'enabledPlugins');
  escrever(arq, { ...inicial, hooks: {}, disableAllHooks: true });
  assert.equal(mudancaNaGuarda(dados, arq, agora), 'disableAllHooks');
  escrever(arq, { enabledPlugins: { 'claude-hadouken@m': true }, hooks: { Stop: [] }, model: 'a' });
  assert.equal(mudancaNaGuarda(dados, arq, agora), 'disableAllHooks', 'apagar a chave também é mudar');
  escrever(arq, '{ quebrado');
  assert.equal(mudancaNaGuarda(dados, arq, agora), 'ilegivel');
  // Fotografia ilegível: qualquer arquivo legível difere, com detalhe ilegivel;
  // ilegível dos dois lados não muda.
  fotografar(dados, [arq], agora);
  assert.equal(mudancaNaGuarda(dados, arq, agora), null);
  escrever(arq, inicial);
  assert.equal(mudancaNaGuarda(dados, arq, agora), 'ilegivel');
  // Sem fotografia: compara com o arquivo ausente.
  const outro = path.join(novaPasta(), '.claude', 'settings.local.json');
  assert.equal(mudancaNaGuarda(dados, outro, agora), null);
  escrever(outro, { model: 'x', permissions: {} });
  assert.equal(mudancaNaGuarda(dados, outro, agora), null);
  escrever(outro, { hooks: {} });
  assert.equal(mudancaNaGuarda(dados, outro, agora), 'hooks');
});

test('decisaoConfig: só as três origens; sem file_path, projeto e local bloqueiam (sem-caminho)', () => {
  const dados = novaPasta();
  const arq = path.join(novaPasta(), '.claude', 'settings.json');
  escrever(arq, { disableAllHooks: true });
  const agora = Date.now();
  for (const source of ['policy_settings', 'skills', undefined, null, 42, 'PROJECT_SETTINGS', '']) {
    assert.equal(decisaoConfig(dados, source, arq, agora), null, String(source));
    assert.equal(decisaoConfig(dados, source, undefined, agora), null, String(source));
  }
  for (const source of ['user_settings', 'project_settings', 'local_settings']) assert.equal(decisaoConfig(dados, source, arq, agora), 'disableAllHooks', source);
  for (const fp of [undefined, null, 42, {}, ['a'], '', 'relativo/.claude/settings.json']) {
    assert.equal(decisaoConfig(dados, 'project_settings', fp, agora), 'sem-caminho', JSON.stringify(fp));
    assert.equal(decisaoConfig(dados, 'local_settings', fp, agora), 'sem-caminho', JSON.stringify(fp));
    assert.equal(decisaoConfig(dados, 'user_settings', fp, agora), null, JSON.stringify(fp));
  }
});

// --- hooks em processo filho ---------------------------------------------------

function conferirTemporario(p, rotulo) {
  assert.ok(typeof p === 'string' && path.isAbsolute(p) && p.startsWith(os.tmpdir()), `${rotulo} fora do temporário: ${p}`);
}

// casa: o ~ falso; cfg: o CLAUDE_CONFIG_DIR; dados: o HADOUKEN_HOME; projeto
// e outro: dois repositórios, só o primeiro aberto na sessão.
function cenario() {
  const raiz = novaPasta();
  const c = {
    raiz,
    casa: path.join(raiz, 'casa'),
    cfg: path.join(raiz, 'cfg'),
    dados: path.join(raiz, 'dados'),
    projeto: path.join(raiz, 'projeto'),
    outro: path.join(raiz, 'outro'),
  };
  for (const d of [c.casa, c.cfg, path.join(c.projeto, '.claude'), path.join(c.outro, '.claude')]) fs.mkdirSync(d, { recursive: true });
  c.usuario = path.join(c.cfg, 'settings.json');
  c.proj = path.join(c.projeto, '.claude', 'settings.json');
  c.local = path.join(c.projeto, '.claude', 'settings.local.json');
  return c;
}

const SOBREPOSTAS = ['HOME', 'USERPROFILE', 'HADOUKEN_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_PLUGIN_ROOT', 'HADOUKEN_SEM_PAINEL', 'CLAUDE_EFFORT', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_ENTRYPOINT'];
function ambiente(c) {
  const env = { ...process.env };
  // No Windows o ambiente não diferencia maiúsculas: nenhuma grafia antiga
  // dessas variáveis sobra ao lado da nova.
  for (const k of Object.keys(env)) if (SOBREPOSTAS.includes(k.toUpperCase())) delete env[k];
  Object.assign(env, {
    HOME: c.casa, USERPROFILE: c.casa, HADOUKEN_HOME: c.dados, CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_PLUGIN_ROOT: repo,
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_CODE_ENTRYPOINT: 'cli',
  });
  for (const k of ['HOME', 'USERPROFILE', 'HADOUKEN_HOME', 'CLAUDE_CONFIG_DIR']) conferirTemporario(env[k], k);
  return env;
}

function rodar(c, script, entrada, argsNode = []) {
  return spawnSync(process.execPath, [...argsNode, path.join(repo, 'src', 'hooks', script)], {
    input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada), env: ambiente(c), encoding: 'utf8', timeout: 15_000,
  });
}
const SAIDA_INICIO = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Consumo ainda sem leitura nesta máquina.' } };
function inicio(c, { id = 's1', cwd = c.projeto, argsNode } = {}) {
  const r = rodar(c, 'session-start.js', { session_id: id, hook_event_name: 'SessionStart', source: 'startup', cwd, model: 'claude-opus-5' }, argsNode);
  // A saída do SessionStart não muda com a fotografia.
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(JSON.parse(r.stdout), SAIDA_INICIO);
  return r;
}
// As chaves medidas no S13 (Claude Code 2.1.287).
const mudanca = (c, file_path, { source = 'project_settings', id = 's1' } = {}) => ({
  cwd: c.projeto, file_path, hook_event_name: 'ConfigChange', prompt_id: 'p1', session_id: id, source,
  transcript_path: path.join(c.casa, '.claude', 'projects', 'x', `${id}.jsonl`),
});
const config = (c, entrada, argsNode) => rodar(c, 'guarda-config.js', entrada, argsNode);
const BLOQUEIO = () => ({ decision: 'block', reason: msg.CONFIG_BLOQUEADA_TEXTO });

function bloqueado(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(JSON.parse(r.stdout), BLOQUEIO());
}
function semSaida(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
}
const eventos = (c, tipo) => lerEventos(c.dados, Date.now()).filter((e) => e.tipo === tipo).map((e) => e.detalhe);

test('hook: SessionStart fotografa os três settings; o ConfigChange com os mesmos arquivos passa sem saída', () => {
  const c = cenario();
  escrever(c.usuario, { enabledPlugins: { 'claude-hadouken@hadouken': true }, model: 'opus' });
  escrever(c.proj, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo' }] }] } });
  escrever(c.local, { disableAllHooks: false });
  inicio(c);
  const base = lerConfigBase(c.dados, Date.now());
  assert.deepEqual([...base.keys()].sort(), [chaveDoArquivo(c.usuario), chaveDoArquivo(c.proj), chaveDoArquivo(c.local)].sort());
  assert.deepEqual(base.get(chaveDoArquivo(c.proj)).impressao, impressaoDoArquivo(c.proj).impressao);
  semSaida(config(c, mudanca(c, c.proj)));
  semSaida(config(c, mudanca(c, c.local, { source: 'local_settings' })));
  semSaida(config(c, mudanca(c, c.usuario, { source: 'user_settings' })));
  assert.deepEqual(eventos(c, 'config-bloqueada'), []);
  assert.deepEqual(eventos(c, 'erro'), []);
});

test('hook: disableAllHooks true, enabledPlugins mudado e hooks: {} acrescentado bloqueiam, cada um com o seu detalhe', () => {
  const c = cenario();
  escrever(c.usuario, { enabledPlugins: { 'claude-hadouken@hadouken': true } });
  escrever(c.proj, { model: 'opus' });
  escrever(c.local, { permissions: { allow: [] } });
  inicio(c);
  escrever(c.proj, { model: 'opus', disableAllHooks: true });
  bloqueado(config(c, mudanca(c, c.proj)));
  escrever(c.usuario, { enabledPlugins: { 'claude-hadouken@hadouken': false } });
  bloqueado(config(c, mudanca(c, c.usuario, { source: 'user_settings' })));
  escrever(c.local, { permissions: { allow: [] }, hooks: {} });
  bloqueado(config(c, mudanca(c, c.local, { source: 'local_settings' })));
  assert.deepEqual(eventos(c, 'config-bloqueada'), ['disableAllHooks', 'enabledPlugins', 'hooks']);
  // O arquivo no disco continua mudado (o bloqueio é da sessão): o próximo
  // ConfigChange do mesmo arquivo segue bloqueado, até a próxima fotografia.
  escrever(c.proj, { model: 'sonnet', disableAllHooks: true });
  bloqueado(config(c, mudanca(c, c.proj)));
  inicio(c, { id: 's2' });
  semSaida(config(c, mudanca(c, c.proj, { id: 's2' })));
});

test('hook: mudança só em model passa; policy_settings e skills passam sempre', () => {
  const c = cenario();
  escrever(c.proj, { model: 'opus', hooks: { Stop: [] } });
  inicio(c);
  escrever(c.proj, { model: 'sonnet', hooks: { Stop: [] }, theme: 'dark' });
  semSaida(config(c, mudanca(c, c.proj)));
  escrever(c.proj, { disableAllHooks: true });
  for (const source of ['policy_settings', 'skills', 'outra']) semSaida(config(c, mudanca(c, c.proj, { source })));
  assert.deepEqual(eventos(c, 'config-bloqueada'), []);
});

test('hook: file_path ausente ou não texto bloqueia no projeto e no local (sem-caminho); no usuário passa', () => {
  const c = cenario();
  inicio(c);
  const sem = (source, extra = {}) => {
    const e = mudanca(c, undefined, { source });
    delete e.file_path;
    return { ...e, ...extra };
  };
  bloqueado(config(c, sem('project_settings')));
  bloqueado(config(c, sem('local_settings', { file_path: 42 })));
  semSaida(config(c, sem('user_settings')));
  semSaida(config(c, sem('user_settings', { file_path: null })));
  semSaida(config(c, sem('policy_settings')));
  assert.deepEqual(eventos(c, 'config-bloqueada'), ['sem-caminho', 'sem-caminho']);
});

test('hook: arquivo sem fotografia compara com o ausente: com hooks bloqueia, sem os três campos passa', () => {
  const c = cenario();
  inicio(c);
  const fora = path.join(c.outro, '.claude', 'settings.json');
  escrever(fora, { model: 'opus', permissions: { allow: ['Bash(ls)'] } });
  semSaida(config(c, mudanca(c, fora)));
  escrever(fora, { model: 'opus', hooks: { PreToolUse: [] } });
  bloqueado(config(c, mudanca(c, fora)));
  assert.deepEqual(eventos(c, 'config-bloqueada'), ['hooks']);
});

test('hook: JSON inválido bloqueia (ilegivel)', () => {
  const c = cenario();
  escrever(c.proj, { model: 'opus' });
  inicio(c);
  escrever(c.proj, '{"disableAllHooks": true,');
  bloqueado(config(c, mudanca(c, c.proj)));
  assert.deepEqual(eventos(c, 'config-bloqueada'), ['ilegivel']);
});

test('hook: config-base.json corrompido não derruba: sem fotografia, compara com o ausente', () => {
  const c = cenario();
  escrever(c.proj, { hooks: { Stop: [] } });
  escrever(c.local, { model: 'opus' });
  inicio(c);
  for (const lixo of ['{', '[]', '{"v":1,"arquivos":"x"}', 'x'.repeat(300 * 1024)]) {
    fs.writeFileSync(path.join(c.dados, ARQ_CONFIG_BASE), lixo);
    bloqueado(config(c, mudanca(c, c.proj)));
    semSaida(config(c, mudanca(c, c.local, { source: 'local_settings' })));
  }
  assert.deepEqual(eventos(c, 'config-bloqueada'), ['hooks', 'hooks', 'hooks', 'hooks']);
  assert.deepEqual(eventos(c, 'erro'), []);
});

test('hook: nome 8.3 e caixa diferente casam a mesma fotografia', { skip: !WIN && 'regra do win32' }, () => {
  const c = cenario();
  escrever(c.proj, { hooks: { Stop: [] }, enabledPlugins: { 'claude-hadouken@hadouken': true } });
  inicio(c);
  const longo = path.join(fs.realpathSync.native(c.projeto), '.claude', 'settings.json');
  const variantes = [c.proj.toUpperCase(), longo, longo.toUpperCase(), longo.toLowerCase()];
  for (const v of variantes) semSaida(config(c, mudanca(c, v)));
  // E a fotografia tirada pelo nome longo casa o ConfigChange pelo nome escrito.
  const c2 = cenario();
  escrever(c2.proj, { hooks: { Stop: [] } });
  inicio(c2, { cwd: fs.realpathSync.native(c2.projeto).toUpperCase() });
  semSaida(config(c2, mudanca(c2, c2.proj)));
  assert.deepEqual(eventos(c, 'config-bloqueada'), []);
  assert.deepEqual(eventos(c2, 'config-bloqueada'), []);
});

test('hook: sessão não registrada ou session_id inválido passa sem saída', () => {
  const c = cenario();
  escrever(c.proj, { disableAllHooks: true });
  for (const id of ['nao-registrada', '../x', '__proto__']) semSaida(config(c, mudanca(c, c.proj, { id })));
  semSaida(config(c, { ...mudanca(c, c.proj), session_id: 42 }));
  // stdin que não é JSON: passa.
  semSaida(config(c, 'lixo'));
  assert.deepEqual(eventos(c, 'config-bloqueada'), []);
});

// Pré-carregamento que quebra o sha256: a exceção é inesperada (não é leitura
// do arquivo). No ConfigChange, passa e registra 'erro' P5:config; no
// SessionStart, a saída não muda e o 'erro' é config-foto.
function quebraHash(c) {
  const pre = path.join(c.raiz, 'sem-hash.mjs');
  fs.writeFileSync(pre, "import crypto from 'node:crypto';\ncrypto.createHash = () => { throw new Error('sem hash'); };\n");
  return ['--import', pathToFileURL(pre).href];
}

test('hook: exceção inesperada passa e registra erro P5:config (fail-open visível)', () => {
  const c = cenario();
  escrever(c.proj, { model: 'opus' });
  inicio(c);
  escrever(c.proj, { disableAllHooks: true });
  semSaida(config(c, mudanca(c, c.proj), quebraHash(c)));
  assert.deepEqual(eventos(c, 'erro'), ['P5:config']);
  assert.deepEqual(eventos(c, 'config-bloqueada'), []);
});

test('SessionStart: a fotografia que falha não muda a saída e registra erro config-foto', () => {
  const c = cenario();
  escrever(c.proj, { hooks: {} });
  inicio(c, { argsNode: quebraHash(c) });
  assert.deepEqual(eventos(c, 'erro'), ['config-foto']);
  assert.equal(fs.existsSync(path.join(c.dados, ARQ_CONFIG_BASE)), false);
  // A sessão foi registrada do mesmo jeito: sem fotografia, compara com o ausente.
  bloqueado(config(c, mudanca(c, c.proj)));
  // Gravação que falha (config-base.json é uma pasta): o mesmo erro, a mesma saída.
  const c2 = cenario();
  fs.mkdirSync(path.join(c2.dados, ARQ_CONFIG_BASE), { recursive: true });
  inicio(c2);
  assert.deepEqual(eventos(c2, 'erro'), ['config-foto']);
});

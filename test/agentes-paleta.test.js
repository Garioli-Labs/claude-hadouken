import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import { gravarGuardaLigada } from '../src/guarda/config.js';
import * as mensagens from '../src/guarda/mensagens.js';
import { SUBIR_AGENTE } from '../src/aprendizado/arquivos.js';
import { avaliarRoteamento } from '../src/roteamento/regras.js';
import { PALETA, REMOVIDOS, AGENTES_REVISAO, paletaEfetiva } from '../src/agentes/paleta.js';
import { avaliarPaleta } from '../src/agentes/despacho.js';

// Spec v0.6.0 §4 Fatia 3 (paleta fundida), Tarefa 5 do plano: dez agentes,
// N1/N2/A1/A2 sobre a lista nova e os textos sem os agentes removidos.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dirAgentes = path.join(repo, 'agents');
const lerAgente = (nome) => fs.readFileSync(path.join(dirAgentes, `${nome}.md`), 'utf8');
const cabecalho = (texto) => texto.split('\n---')[0];
const campo = (texto, nome) => new RegExp(`^${nome}:\\s*(.+)$`, 'm').exec(cabecalho(texto))?.[1].trim() ?? null;

const homes = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk paleta ç '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { perguntar: false } }));
  return d;
}
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function ambiente(home, extra = {}) {
  const casa = path.join(home, 'casa');
  const CASA = new Set(['HOME', 'USERPROFILE']);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !CASA.has(k.toUpperCase()))),
    HOME: casa, USERPROFILE: casa,
    HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'),
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_EFFORT: undefined, CLAUDE_CODE_SUBAGENT_MODEL: undefined, CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  assert.ok(env.HADOUKEN_HOME.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${env.HADOUKEN_HOME}`);
  assert.ok(env.HOME.startsWith(os.tmpdir()), 'casa fora do temporário');
  return env;
}
const rodar = (script, entrada, home, extra = {}) => spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', script)], {
  input: JSON.stringify(entrada), env: ambiente(home, extra), encoding: 'utf8', timeout: 15_000,
});

function gravarEstado(home) {
  const agora = Date.now();
  const s = Math.floor(agora / 1000);
  const at = new Date(agora).toISOString();
  fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 20, resets_at: s + 3 * 3600, at },
    seven_day: { used_percentage: 40, resets_at: s + 4 * 86_400, at },
    sessoes: {}, historico: [],
  }));
}
function sessaoArmada() {
  const home = novoHome();
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try { registrarSessao('s1', Date.now()); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
  gravarEstado(home);
  return home;
}
const despacho = (tool_input, extra = {}) => ({
  session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input, cwd: os.tmpdir(), ...extra,
});
const saida = (r) => {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout === '' ? null : JSON.parse(r.stdout);
};
const perfil = (agente, familia, effort, origem, doArquivo = null) => ({ agente, familia, effort, origem, doArquivo });
const config = { negarN1: true, negarN2: true, avisos: true, subir: {} };
const av = (p) => avaliarRoteamento({ config, agoraMs: Date.now(), recentes: [], liberado: false, ...p });

// ---------------------------------------------------------------- frontmatter

const NOMES = ['busca', 'varredor', 'pesquisa', 'mecanico', 'implementador-mecanico', 'implementador', 'revisor', 'auditor', 'e2e', 'redator'];

test('PALETA: as dez linhas da spec, na ordem, com model e effort decididos', () => {
  assert.deepEqual(PALETA.map((p) => [p.nome, p.model, p.effort]), [
    ['busca', 'haiku', 'low'], ['varredor', 'haiku', 'medium'], ['pesquisa', 'sonnet', 'low'], ['mecanico', 'haiku', 'low'],
    ['implementador-mecanico', 'sonnet', 'medium'], ['implementador', 'sonnet', 'high'], ['revisor', 'sonnet', 'high'],
    ['auditor', 'fable', 'high'], ['e2e', 'sonnet', 'high'], ['redator', 'sonnet', 'medium'],
  ]);
  assert.deepEqual(PALETA.map((p) => p.nome), NOMES);
  assert.ok(Object.isFrozen(PALETA));
  for (const p of PALETA) {
    assert.equal(typeof p.uso, 'string', p.nome);
    assert.equal(typeof p.naoUsar, 'string', p.nome);
    assert.ok(p.substituto === null || NOMES.includes(p.substituto), p.nome);
  }
  assert.deepEqual(PALETA.filter((p) => p.substituto === null).map((p) => p.nome), ['pesquisa', 'redator']);
  assert.deepEqual({ ...REMOVIDOS }, { executor: 'implementador', 'revisor-critico': 'auditor' });
  assert.deepEqual([...AGENTES_REVISAO], ['revisor', 'auditor']);
});

test('frontmatter: o conjunto de agents/*.md é a PALETA; name, model, effort e ferramentas batem', () => {
  const arquivos = fs.readdirSync(dirAgentes).filter((a) => a.endsWith('.md')).map((a) => a.replace(/\.md$/, '')).sort();
  assert.deepEqual(arquivos, PALETA.map((p) => p.nome).sort());
  for (const p of PALETA) {
    const t = lerAgente(p.nome);
    assert.equal(campo(t, 'name'), p.nome, p.nome);
    assert.equal(campo(t, 'model'), p.model, p.nome);
    assert.equal(campo(t, 'effort'), p.effort, p.nome);
    assert.match(campo(t, 'description') ?? '', /^.{40,}$/, p.nome);
    if (Array.isArray(p.ferramentas)) {
      assert.equal(campo(t, 'tools'), p.ferramentas.join(', '), p.nome);
      assert.equal(campo(t, 'disallowedTools'), null, p.nome);
    } else if (p.ferramentas === 'todas-menos-escrita') {
      assert.equal(campo(t, 'tools'), null, p.nome);
      assert.equal(campo(t, 'disallowedTools'), 'Write, Edit, NotebookEdit', p.nome);
    } else {
      assert.equal(p.ferramentas, 'todas', p.nome);
      assert.equal(campo(t, 'tools'), null, p.nome);
      assert.equal(campo(t, 'disallowedTools'), null, p.nome);
    }
  }
});

test('conteúdo genérico: nenhum agente cita prefixo de teste, e-mail ou empresa; corpo dos novos até 40 linhas com o relatório', () => {
  for (const nome of NOMES) {
    const t = lerAgente(nome);
    assert.doesNotMatch(t, /ZZE2E|HOMOLOG|educbank|@[a-z0-9-]+\.(com|br)/i, nome);
    assert.doesNotMatch(t, /port[ãa]o|port[õo]es|consome cr[ée]dito|espelho local|hedging|consulta paga/i, nome);
  }
  for (const nome of ['varredor', 'implementador-mecanico', 'implementador', 'auditor', 'e2e', 'redator']) {
    const t = lerAgente(nome);
    const corpo = t.slice(t.indexOf('\n---', 4) + 4).trim().split('\n');
    assert.ok(corpo.length <= 40, `${nome}: ${corpo.length} linhas`);
    for (const item of ['Feito:', 'Evidência:', 'Não feito:', 'Certeza:']) assert.ok(t.includes(item), `${nome} sem ${item}`);
    assert.match(t, /Use para:/, nome);
    assert.match(t, /Não use para:/, nome);
  }
});

// ------------------------------------------------------------------ removidos

test('removidos: avaliarPaleta nega executor e revisor-critico com o substituto; o resto passa', () => {
  const nega = (subagent_type) => avaliarPaleta({ toolName: 'Agent', toolInput: { subagent_type, prompt: 'x' } });
  assert.deepEqual(nega('hadouken:executor'), { acao: 'negar', razao: 'hadouken:executor saiu na 0.6.0; use hadouken:implementador' });
  assert.deepEqual(nega('hadouken:revisor-critico'), { acao: 'negar', razao: 'hadouken:revisor-critico saiu na 0.6.0; use hadouken:auditor' });
  assert.deepEqual(nega('hadouken:auditor'), { acao: 'passa' });
  assert.deepEqual(nega('executor'), { acao: 'passa' }, 'só o nome do plugin');
  assert.deepEqual(avaliarPaleta({ toolName: 'Workflow', toolInput: { subagent_type: 'hadouken:executor' } }), { acao: 'passa' });
  assert.deepEqual(avaliarPaleta({ toolName: 'Agent', toolInput: null }), { acao: 'passa' });
});

for (const [rotulo, ligada] of [['guarda ligada', true], ['guarda desligada', false]]) {
  test(`removidos no hook (${rotulo}): hadouken:executor e hadouken:revisor-critico são negados com o substituto`, () => {
    const home = sessaoArmada();
    if (!ligada) assert.equal(gravarGuardaLigada(home, false).ok, true);
    for (const [velho, novo] of [['executor', 'implementador'], ['revisor-critico', 'auditor']]) {
      const o = saida(rodar('guarda-despacho.js', despacho({ subagent_type: `hadouken:${velho}`, prompt: 'x', description: 'y' }), home));
      assert.equal(o.hookSpecificOutput.permissionDecision, 'deny', velho);
      assert.match(o.hookSpecificOutput.permissionDecisionReason, new RegExp(`use hadouken:${novo}`), velho);
      assert.equal(Object.hasOwn(o, 'continue'), false, 'o turno não para');
    }
  });
}

// ---------------------------------------------------------------------- N1/N2

test('N1/N2: hadouken:varredor com model opus explícito é negado (guarda ligada); com N1 solta, a N2 nega', () => {
  assert.deepEqual(av({ perfil: perfil('hadouken:varredor', 'opus', 'medium', 'parametro', { model: 'haiku', effort: 'medium' }) }), { decisao: 'negar', regra: 'N1' });
  assert.deepEqual(av({ perfil: perfil('hadouken:varredor', 'opus', 'medium', 'parametro'), config: { ...config, negarN1: false } }), { decisao: 'negar', regra: 'N2' });
  assert.equal(av({ perfil: perfil('hadouken:varredor', 'haiku', 'medium', 'frontmatter') }).decisao, 'passar');

  const home = sessaoArmada();
  const o = saida(rodar('guarda-despacho.js', despacho({ subagent_type: 'hadouken:varredor', model: 'opus', prompt: 'x', description: 'y' }), home));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(o.hookSpecificOutput.permissionDecisionReason, mensagens.N1_CLAUDE);
  const h2 = sessaoArmada();
  fs.writeFileSync(path.join(h2, 'config.json'), JSON.stringify({ guarda: { perguntar: false }, roteamento: { negarN1: false } }));
  const o2 = saida(rodar('guarda-despacho.js', despacho({ subagent_type: 'hadouken:varredor', model: 'opus', prompt: 'x', description: 'y' }), h2));
  assert.equal(o2.hookSpecificOutput.permissionDecisionReason, mensagens.N2_CLAUDE);
});

// ------------------------------------------------------------------- A1 e A2

test('A2: hadouken:auditor com descrição de busca não avisa; implementador em opus avisa (controle)', () => {
  assert.equal(av({ perfil: perfil('hadouken:auditor', 'fable', 'high', 'frontmatter', { model: 'fable', effort: 'high' }), descricao: 'Procurar quebras na spec' }).decisao, 'passar');
  assert.deepEqual(av({ perfil: perfil('hadouken:implementador', 'opus', 'high', 'parametro', { model: 'sonnet', effort: 'high' }), descricao: 'Procurar quebras na spec' }), { decisao: 'avisar', regra: 'A2' });

  const home = sessaoArmada();
  const ti = { subagent_type: 'hadouken:auditor', description: 'Procurar quebras na spec', prompt: 'x' };
  const o = saida(rodar('guarda-despacho.js', despacho(ti), home));
  assert.equal(o?.hookSpecificOutput?.additionalContext === mensagens.A2_CLAUDE, false, 'A2 não aparece para o auditor');
  const c = saida(rodar('guarda-despacho.js', despacho({ ...ti, subagent_type: 'hadouken:implementador', model: 'opus' }), home));
  assert.equal(c.hookSpecificOutput.additionalContext, mensagens.A2_CLAUDE);
});

test('A1: revisor em fable explícito não avisa; implementador em fable avisa; o texto nomeia revisor e auditor', () => {
  assert.equal(av({ perfil: perfil('hadouken:revisor', 'fable', 'high', 'parametro', { model: 'sonnet', effort: 'high' }) }).decisao, 'passar');
  assert.equal(av({ perfil: perfil('hadouken:auditor', 'fable', 'max', 'parametro', { model: 'fable', effort: 'high' }) }).decisao, 'passar');
  assert.deepEqual(av({ perfil: perfil('hadouken:implementador', 'fable', 'high', 'parametro', { model: 'sonnet', effort: 'high' }) }), { decisao: 'avisar', regra: 'A1' });

  const home = sessaoArmada();
  const rev = saida(rodar('guarda-despacho.js', despacho({ subagent_type: 'hadouken:revisor', model: 'fable', prompt: 'x', description: 'y' }), home, { CLAUDE_EFFORT: 'high' }));
  assert.equal(rev?.hookSpecificOutput?.additionalContext === mensagens.A1_CLAUDE, false, 'A1 não aparece para o revisor');
  const imp = saida(rodar('guarda-despacho.js', despacho({ subagent_type: 'hadouken:implementador', model: 'fable', prompt: 'x', description: 'y' }), home, { CLAUDE_EFFORT: 'high' }));
  assert.equal(imp.hookSpecificOutput.additionalContext, mensagens.A1_CLAUDE);

  assert.equal(mensagens.A1_CLAUDE, 'hadouken (aviso): despacho em Fable ou effort max fora de hadouken:revisor e hadouken:auditor. Fable só vale para segurança, autenticação, dinheiro e arquitetura; no resto use hadouken:revisor ou hadouken:implementador.');
  assert.doesNotMatch(mensagens.A1_CLAUDE, /revisor-critico|executor/);
});

// ----------------------------------------------------------- textos e varredura

test('textos sem os removidos: N2, aprendizado e varredura de src/ e skills/', () => {
  assert.doesNotMatch(mensagens.N2_CLAUDE, /executor|revisor-critico/);
  assert.match(mensagens.N2_CLAUDE, /hadouken:implementador/);
  assert.equal(SUBIR_AGENTE['hadouken:busca'].substituto, 'hadouken:implementador');
  assert.equal(SUBIR_AGENTE['hadouken:mecanico'].substituto, 'hadouken:implementador');

  const achados = [];
  const varrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) varrer(p);
      else if (/\.(js|mjs|md|json)$/.test(e.name) && /hadouken:(executor|revisor-critico)/.test(fs.readFileSync(p, 'utf8'))) achados.push(path.relative(repo, p));
    }
  };
  varrer(path.join(repo, 'src'));
  varrer(path.join(repo, 'skills'));
  // A negação de src/agentes/ nomeia o removido de propósito (spec Fatia 3).
  assert.deepEqual(achados.filter((a) => !a.startsWith(path.join('src', 'agentes'))), []);
});

// ---------------------------------------------------------------- SessionStart

test('SessionStart: o texto de roteamento sai da paleta (varredor e auditor), sem os removidos', () => {
  const home = novoHome();
  const r = rodar('session-start.js', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: os.tmpdir() }, home);
  assert.equal(r.status, 0, r.stderr);
  const texto = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(texto, /hadouken:varredor/);
  assert.match(texto, /hadouken:auditor/);
  for (const p of PALETA) assert.ok(texto.includes(`hadouken:${p.nome}`), p.nome);
  assert.doesNotMatch(texto, /executor|revisor-critico/);
  assert.match(texto, /hadouken:roteamento/);
});

test('paletaEfetiva sem config: o padrão, uma entrada por agente', () => {
  const e = paletaEfetiva();
  assert.deepEqual(e.map((x) => x.nome), NOMES);
  for (const x of e) assert.deepEqual([x.ativo, x.override], [true, false], x.nome);
  assert.equal(e[7].model, 'fable');
});

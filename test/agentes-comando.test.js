import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarSessao } from '../src/ativas.js';
import * as mensagens from '../src/guarda/mensagens.js';
import * as cfg from '../src/agentes/config.js';
import { PALETA, paletaEfetiva } from '../src/agentes/paleta.js';
import { linhasRegra } from '../src/roteamento/regra.js';

// Tarefa 7 da v0.6.0 (spec §4 "Fatia 4", histórias 3, 4 e 6): o comando
// /hadouken:agentes mostra, grava e remove a chave `agentes` do config.json
// pelo mesmo UserPromptExpansion dos outros comandos digitados, e o texto de
// roteamento do SessionStart sai da paleta efetiva. A namespace `cfg` evita
// que um import ausente derrube o arquivo inteiro antes do primeiro teste.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const NOMES = PALETA.map((p) => p.nome);

const homes = [];
function novoHome(config) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk agcmd ç '));
  homes.push(d);
  fs.mkdirSync(path.join(d, 'cfg', 'agents'), { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(d, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return d;
}
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function ambiente(home, extra = {}) {
  assert.ok(path.isAbsolute(home) && home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
  const casa = path.join(home, 'casa');
  const CASA = new Set(['HOME', 'USERPROFILE']);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !CASA.has(k.toUpperCase()))),
    HOME: casa, USERPROFILE: casa,
    HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CONFIG_DIR: path.join(home, 'cfg'),
    HADOUKEN_SEM_PAINEL: '1', CLAUDE_EFFORT: undefined, CLAUDE_CODE_SUBAGENT_MODEL: undefined, CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
}
const rodarScript = (script, entrada, home, extra = {}) => {
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', script)], {
    input: JSON.stringify(entrada), env: ambiente(home, extra), encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout === '' ? null : JSON.parse(r.stdout);
};

const expansao = (comando, args, entrada = {}) => ({
  session_id: 's1', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
  command_name: `hadouken:${comando}`, command_args: args, command_source: 'plugin', prompt: `/hadouken:${comando} ${args}`,
  ...entrada,
});
const comando = (args, home, { extra = {}, entrada = {} } = {}) => rodarScript('agentes.js', expansao('agentes', args, entrada), home, extra);
const bloqueio = (saida) => {
  assert.ok(saida !== null, 'sem saída do hook');
  assert.equal(saida.decision, 'block');
  assert.equal(typeof saida.reason, 'string');
  return saida.reason;
};
const arqConfig = (home) => path.join(home, 'config.json');
const lerConfig = (home) => JSON.parse(fs.readFileSync(arqConfig(home), 'utf8'));

// ------------------------------------------------------------ lerArgsAgentes

test('lerArgsAgentes: mostrar, gravar com model e effort, off, on e padrao', () => {
  assert.deepEqual(cfg.lerArgsAgentes(''), { acao: 'mostrar' });
  assert.deepEqual(cfg.lerArgsAgentes('   '), { acao: 'mostrar' });
  assert.deepEqual(cfg.lerArgsAgentes(undefined), { acao: 'mostrar' });
  assert.deepEqual(cfg.lerArgsAgentes('revisor opus high'), { acao: 'gravar', nome: 'revisor', valor: { model: 'opus', effort: 'high' } });
  assert.deepEqual(cfg.lerArgsAgentes('revisor opus'), { acao: 'gravar', nome: 'revisor', valor: { model: 'opus' } });
  assert.deepEqual(cfg.lerArgsAgentes('auditor off'), { acao: 'gravar', nome: 'auditor', valor: { ativo: false } });
  assert.deepEqual(cfg.lerArgsAgentes('auditor on'), { acao: 'gravar', nome: 'auditor', valor: { ativo: true } });
  assert.deepEqual(cfg.lerArgsAgentes('revisor padrao'), { acao: 'remover', nome: 'revisor' });
  assert.deepEqual(cfg.lerArgsAgentes('revisor padrão'), { acao: 'remover', nome: 'revisor' });
});

test('lerArgsAgentes: maiúsculas, espaços e NFC; nome com dígito (e2e) e com hífen', () => {
  assert.deepEqual(cfg.lerArgsAgentes('  E2E   Sonnet  XHIGH '), { acao: 'gravar', nome: 'e2e', valor: { model: 'sonnet', effort: 'xhigh' } });
  assert.deepEqual(cfg.lerArgsAgentes('e2e off'), { acao: 'gravar', nome: 'e2e', valor: { ativo: false } });
  assert.deepEqual(cfg.lerArgsAgentes('implementador-mecanico haiku low'), { acao: 'gravar', nome: 'implementador-mecanico', valor: { model: 'haiku', effort: 'low' } });
  // "padrão" decomposto (a + til combinante, como o macOS entrega) vale como "padrão".
  assert.deepEqual(cfg.lerArgsAgentes('revisor padra\u0303o'), { acao: 'remover', nome: 'revisor' });
});

test('lerArgsAgentes: nome desconhecido lista os dez; modelo e effort inválidos; formas fora da gramática', () => {
  const desconhecido = cfg.lerArgsAgentes('xyz opus');
  assert.equal(desconhecido.acao, 'erro');
  assert.ok(desconhecido.msg.includes('agente desconhecido: xyz'), desconhecido.msg);
  for (const n of NOMES) assert.ok(desconhecido.msg.includes(n), n);
  const modelo = cfg.lerArgsAgentes('revisor gpt');
  assert.equal(modelo.acao, 'erro');
  assert.ok(modelo.msg.includes('modelo inválido'), modelo.msg);
  const effort = cfg.lerArgsAgentes('revisor opus extremo');
  assert.equal(effort.acao, 'erro');
  assert.ok(effort.msg.includes('effort inválido'), effort.msg);
  for (const ruim of ['revisor', 'revisor opus high extra', 'revisor off high', 'revisor on x', 'revisor padrao high', 'opus', 'revisor high opus']) {
    assert.equal(cfg.lerArgsAgentes(ruim).acao, 'erro', ruim);
  }
  // Texto enorme ou que não é texto: erro, sem lançar; nome hostil não volta na mensagem.
  assert.equal(cfg.lerArgsAgentes('x'.repeat(500)).acao, 'erro');
  assert.equal(cfg.lerArgsAgentes(42).acao, 'erro');
  const hostil = cfg.lerArgsAgentes('<script>alert(1)</script> opus');
  assert.equal(hostil.acao, 'erro');
  assert.ok(!hostil.msg.includes('script'), hostil.msg);
});

// ------------------------------------------------------------- gravarAgente

test('gravarAgente: troca só agentes.<nome>, preserva o resto e remove agentes quando esvazia', () => {
  const home = novoHome({ guarda: { ligada: false }, janela: { dias: ['seg'], inicio: '09:00', fim: '21:00' }, agentes: { busca: { model: 'opus' } } });
  assert.deepEqual(cfg.gravarAgente(home, 'revisor', { model: 'opus', effort: 'high' }), { ok: true });
  assert.deepEqual(lerConfig(home).agentes, { busca: { model: 'opus' }, revisor: { model: 'opus', effort: 'high' } });
  assert.deepEqual(lerConfig(home).guarda, { ligada: false });
  assert.deepEqual(cfg.gravarAgente(home, 'busca', null), { ok: true });
  assert.deepEqual(lerConfig(home).agentes, { revisor: { model: 'opus', effort: 'high' } });
  assert.deepEqual(cfg.gravarAgente(home, 'revisor', null), { ok: true });
  assert.equal(Object.hasOwn(lerConfig(home), 'agentes'), false);
  assert.deepEqual(Object.keys(lerConfig(home)).sort(), ['guarda', 'janela']);
});

test('gravarAgente: sem config.json cria; remover sem config.json não cria; valor e nome inválidos não gravam', () => {
  const home = novoHome();
  assert.deepEqual(cfg.gravarAgente(home, 'busca', null), { ok: true });
  assert.equal(fs.existsSync(arqConfig(home)), false);
  assert.equal(cfg.gravarAgente(home, 'busca', { model: 'gpt' }).ok, false);
  assert.equal(cfg.gravarAgente(home, 'xyz', { model: 'opus' }).ok, false);
  assert.equal(cfg.gravarAgente(home, '__proto__', { model: 'opus' }).ok, false);
  assert.equal(cfg.gravarAgente(home, 'busca', {}).ok, false);
  assert.equal(fs.existsSync(arqConfig(home)), false);
  assert.deepEqual(cfg.gravarAgente(home, 'e2e', { ativo: false }), { ok: true });
  assert.deepEqual(lerConfig(home), { agentes: { e2e: { ativo: false } } });
  assert.equal(cfg.gravarAgente('', 'busca', { model: 'opus' }).ok, false);
});

test('gravarAgente: config.json ilegível ou fora do formato nunca é sobrescrito', () => {
  const home = novoHome('{ quebrado');
  assert.equal(cfg.gravarAgente(home, 'busca', { model: 'opus' }).ok, false);
  assert.equal(fs.readFileSync(arqConfig(home), 'utf8'), '{ quebrado');
  const lista = novoHome('[1]');
  assert.equal(cfg.gravarAgente(lista, 'busca', { model: 'opus' }).ok, false);
  assert.equal(fs.readFileSync(arqConfig(lista), 'utf8'), '[1]');
  const agentesRuim = novoHome({ agentes: [1] });
  assert.equal(cfg.gravarAgente(agentesRuim, 'busca', { model: 'opus' }).ok, false);
  assert.deepEqual(lerConfig(agentesRuim), { agentes: [1] });
});

// --------------------------------------------------------------- o comando

test('revisor opus high grava {model, effort}, preserva a guarda e responde com a linha efetiva', () => {
  const home = novoHome({ guarda: { ligada: false } });
  const reason = bloqueio(comando('revisor opus high', home));
  assert.ok(reason.includes('revisor') && reason.includes('sonnet·high → opus·high'), reason);
  assert.deepEqual(lerConfig(home).agentes.revisor, { model: 'opus', effort: 'high' });
  assert.deepEqual(lerConfig(home).guarda, { ligada: false });
});

test('auditor off grava {ativo:false}; auditor on tira a chave ativo; revisor padrao remove o agente', () => {
  const home = novoHome();
  assert.ok(bloqueio(comando('auditor off', home)).includes('auditor'));
  assert.deepEqual(lerConfig(home).agentes.auditor, { ativo: false });
  bloqueio(comando('auditor on', home));
  assert.equal(Object.hasOwn(lerConfig(home).agentes?.auditor ?? {}, 'ativo'), false);
  bloqueio(comando('revisor opus', home));
  assert.deepEqual(lerConfig(home).agentes.revisor, { model: 'opus' });
  const reason = bloqueio(comando('revisor padrao', home));
  assert.ok(reason.includes('padrão'), reason);
  assert.equal(Object.hasOwn(lerConfig(home).agentes ?? {}, 'revisor'), false);
});

test('off e model combinam: trocar o modelo de agente desligado não o religa; on não apaga o modelo', () => {
  const home = novoHome();
  bloqueio(comando('auditor off', home));
  bloqueio(comando('auditor opus max', home));
  assert.deepEqual(lerConfig(home).agentes.auditor, { model: 'opus', effort: 'max', ativo: false });
  bloqueio(comando('auditor on', home));
  assert.deepEqual(lerConfig(home).agentes.auditor, { model: 'opus', effort: 'max' });
  // O pedido sem effort tira o effort do override anterior (volta ao padrão do agente).
  bloqueio(comando('auditor sonnet', home));
  assert.deepEqual(lerConfig(home).agentes.auditor, { model: 'sonnet' });
});

test('e2e: nome com dígito grava e aparece na tabela', () => {
  const home = novoHome();
  bloqueio(comando('e2e opus low', home));
  assert.deepEqual(lerConfig(home).agentes.e2e, { model: 'opus', effort: 'low' });
  const linha = bloqueio(comando('', home)).split('\n').find((l) => l.startsWith('e2e'));
  assert.ok(linha.includes('sonnet·high → opus·low'), linha);
});

test('xyz opus: agente desconhecido com a lista dos dez; revisor gpt: modelo inválido; nada gravado', () => {
  const home = novoHome();
  const desconhecido = bloqueio(comando('xyz opus', home));
  assert.ok(desconhecido.includes('agente desconhecido: xyz'), desconhecido);
  for (const n of NOMES) assert.ok(desconhecido.includes(n), n);
  assert.ok(bloqueio(comando('revisor gpt', home)).includes('modelo inválido'));
  assert.equal(fs.existsSync(arqConfig(home)), false);
});

const CABECALHO = 'Paleta efetiva (agente: padrão → config):';
const SINTAXE = 'Mude com /hadouken:agentes <agente> <modelo> [effort], <agente> off|on ou <agente> padrao.';

test('sem argumento: cabeçalho, dez linhas de agente e a sintaxe; o revisor mostra o padrão e o override', () => {
  const home = novoHome({ agentes: { revisor: { model: 'opus' }, auditor: { ativo: false } } });
  const antes = fs.readFileSync(arqConfig(home), 'utf8');
  const linhas = bloqueio(comando('', home)).split('\n');
  assert.equal(linhas.length, 12, linhas.join('\n'));
  assert.equal(linhas[0], CABECALHO);
  assert.equal(linhas[11], SINTAXE);
  const agentes = linhas.slice(1, 11);
  assert.deepEqual(agentes.map((l) => l.split(':')[0]), NOMES);
  assert.equal(agentes.find((l) => l.startsWith('revisor')), 'revisor: sonnet·high → opus·high');
  assert.equal(agentes.find((l) => l.startsWith('busca')), 'busca: haiku·low');
  assert.equal(agentes.find((l) => l.startsWith('auditor')), 'auditor: fable·high (desligado)');
  assert.equal(fs.readFileSync(arqConfig(home), 'utf8'), antes);
});

test('sem argumento: override igual ao padrão mostra a seta; ativo:false com override mostra os dois', () => {
  const home = novoHome({ agentes: { revisor: { model: 'sonnet', effort: 'high' }, busca: { effort: 'low' }, auditor: { model: 'opus', ativo: false } } });
  const agentes = bloqueio(comando('', home)).split('\n').slice(1, 11);
  assert.equal(agentes.find((l) => l.startsWith('revisor')), 'revisor: sonnet·high → sonnet·high');
  assert.equal(agentes.find((l) => l.startsWith('busca')), 'busca: haiku·low → haiku·low');
  assert.equal(agentes.find((l) => l.startsWith('auditor')), 'auditor: fable·high → opus·high (desligado)');
});

test('sem argumento e sem config.json: cabeçalho, dez linhas no padrão e a sintaxe; config com campo inválido acrescenta o aviso depois da sintaxe', () => {
  const home = novoHome();
  const linhas = bloqueio(comando('', home)).split('\n');
  assert.equal(linhas.length, 12);
  assert.equal(linhas[0], CABECALHO);
  assert.equal(linhas[11], SINTAXE);
  assert.ok(!linhas.slice(1, 11).join('\n').includes('→'));
  const ruim = novoHome({ agentes: { xyz: { model: 'opus' } } });
  const reason = bloqueio(comando('', ruim)).split('\n');
  assert.equal(reason.length, 13);
  assert.equal(reason[11], SINTAXE);
  assert.equal(reason[12], 'agentes.xyz inválido; ignorado');
});

test('sem argumento: 4000 chaves inválidas viram cinco avisos e a linha de corte', () => {
  const agentes = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`k${i}`, 1]));
  const home = novoHome({ agentes });
  assert.ok(fs.statSync(arqConfig(home)).size < 64 * 1024);
  const linhas = bloqueio(comando('', home)).split('\n');
  const avisos = linhas.slice(12);
  assert.equal(avisos.length, 6, linhas.slice(12).join('\n'));
  assert.equal(avisos[5], '… e mais 3995 avisos.');
  assert.ok(avisos.join('\n').length < 1500, String(avisos.join('\n').length));
});

test('config.json ilegível nunca é sobrescrito pelo comando', () => {
  const home = novoHome('{ não é json');
  const reason = bloqueio(comando('revisor opus', home));
  assert.ok(reason.includes('nada mudado'), reason);
  assert.equal(fs.readFileSync(arqConfig(home), 'utf8'), '{ não é json');
});

test('recusa -p/SDK e origem que não é o comando digitado, sem gravar', () => {
  const home = novoHome();
  const sdk = bloqueio(comando('revisor opus', home, { extra: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }));
  assert.ok(sdk.includes('nada mudado'), sdk);
  for (const origem of ['skill_tool', 'scheduled_task', 'queued_prompt', undefined]) {
    const reason = bloqueio(comando('revisor opus', home, { entrada: { command_source: origem } }));
    assert.ok(reason.includes('nada mudado'), reason);
  }
  const mcp = bloqueio(comando('revisor opus', home, { entrada: { expansion_type: 'mcp_prompt' } }));
  assert.ok(mcp.includes('nada mudado'), mcp);
  assert.equal(fs.existsSync(arqConfig(home)), false);
});

test('outro comando passa sem saída', () => {
  const home = novoHome();
  assert.equal(rodarScript('agentes.js', expansao('saude', 'revisor opus'), home), null);
  assert.equal(fs.existsSync(arqConfig(home)), false);
});

test('RF3: janela, agentes e liberar off em sequência: nenhum comando apaga a chave do outro', () => {
  const home = novoHome();
  bloqueio(rodarScript('janela.js', expansao('janela', 'seg-sex 9-21'), home));
  bloqueio(comando('revisor opus', home));
  bloqueio(rodarScript('liberar.js', expansao('liberar', 'off'), home));
  const c = lerConfig(home);
  assert.deepEqual(c.janela, { dias: ['seg', 'ter', 'qua', 'qui', 'sex'], inicio: '09:00', fim: '21:00' });
  assert.deepEqual(c.agentes, { revisor: { model: 'opus' } });
  assert.equal(c.guarda.ligada, false);
  // E na ordem inversa: o comando de agentes também preserva as duas.
  bloqueio(comando('auditor off', home));
  bloqueio(comando('revisor padrao', home));
  const d = lerConfig(home);
  assert.deepEqual(Object.keys(d).sort(), ['agentes', 'guarda', 'janela']);
  assert.deepEqual(d.agentes, { auditor: { ativo: false } });
});

test('hooks.json liga o matcher hadouken:agentes ao hook, timeout 10', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
  const e = hooks.hooks.UserPromptExpansion.find((x) => x.matcher === 'hadouken:agentes');
  assert.ok(e, 'sem matcher hadouken:agentes');
  assert.deepEqual(e.hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/hooks/agentes.js'], timeout: 10 }]);
});

test('skill agentes: sem invocação pelo modelo, com a sintaxe na descrição', () => {
  const texto = fs.readFileSync(path.join(repo, 'skills', 'agentes', 'SKILL.md'), 'utf8');
  assert.match(texto, /^---\nname: agentes\n/);
  assert.match(texto, /\ndisable-model-invocation: true\n/);
  assert.match(texto, /\ndescription: .*\/hadouken:agentes .*revisor opus high.*off.*on.*padrao/);
  assert.match(texto, /reiniciar a sessão ou rodar \/reload-plugins/);
});

// --------------------------------------------------------------- SessionStart

function sessionStart(home) {
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', 'session-start.js')], {
    input: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: os.tmpdir() }),
    env: ambiente(home), encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  return { contexto: o.hookSpecificOutput.additionalContext, usuario: o.systemMessage ?? '' };
}

test('SessionStart: com agentes.revisor.model a linha do revisor mostra opus', () => {
  const home = novoHome({ agentes: { revisor: { model: 'opus' } } });
  const linha = sessionStart(home).contexto.split('\n').find((l) => l.startsWith('hadouken:revisor'));
  assert.ok(linha.includes('opus·high'), linha);
  assert.ok(!linha.includes('sonnet'), linha);
});

test('SessionStart: agente com ativo:false não tem linha; os outros nove ficam', () => {
  const home = novoHome({ agentes: { auditor: { ativo: false } } });
  const { contexto } = sessionStart(home);
  assert.ok(!contexto.includes('hadouken:auditor'), contexto);
  for (const n of NOMES.filter((x) => x !== 'auditor')) assert.ok(contexto.includes(`hadouken:${n} (`), n);
});

test('SessionStart: nome inválido em agentes aparece como aviso ao usuário, sem entrar no contexto', () => {
  const home = novoHome({ agentes: { xyz: { model: 'opus' }, revisor: { model: 'gpt' } } });
  const { contexto, usuario } = sessionStart(home);
  assert.ok(usuario.includes('agentes.xyz inválido; ignorado'), usuario);
  assert.ok(usuario.includes('agentes.revisor.model inválido; ignorado'), usuario);
  assert.ok(!contexto.includes('inválido'), contexto);
  // O campo inválido é descartado: o revisor segue no padrão.
  assert.ok(contexto.includes('hadouken:revisor (sonnet·high)'), contexto);
});

test('SessionStart: 4000 chaves inválidas em agentes viram cinco avisos e a linha de corte', () => {
  const agentes = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`k${i}`, 1]));
  const home = novoHome({ agentes });
  assert.ok(fs.statSync(arqConfig(home)).size < 64 * 1024);
  const { usuario } = sessionStart(home);
  const avisos = usuario.split('\n').filter((l) => l.includes('inválido; ignorado') || l.startsWith('… e mais'));
  assert.ok(avisos.length <= 6, `${avisos.length} linhas de aviso`);
  assert.equal(avisos.at(-1), '… e mais 3995 avisos.');
  assert.ok(avisos.join('\n').length < 1500, String(avisos.join('\n').length));
});

test('SessionStart: config.json ilegível avisa e mantém a paleta padrão', () => {
  const home = novoHome('{ quebrado');
  const { contexto, usuario } = sessionStart(home);
  assert.ok(usuario.includes('não consegui ler agentes em config.json'), usuario);
  for (const n of NOMES) assert.ok(contexto.includes(`hadouken:${n} (`), n);
});

test('teto do texto de roteamento: padrão e override em model e effort dos dez agentes, até 1 600 caracteres', () => {
  const casos = [
    ['padrão', {}],
    // Os valores de maior comprimento: sonnet (6) e medium (6).
    ['dez overrides', Object.fromEntries(NOMES.map((n) => [n, { model: 'sonnet', effort: 'medium' }]))],
  ];
  for (const [rotulo, agentes] of casos) {
    const home = novoHome({ agentes });
    const lido = cfg.lerAgentes(home);
    assert.deepEqual(lido.avisos, [], rotulo);
    const texto = linhasRegra(paletaEfetiva(lido.agentes)).join('\n');
    assert.ok(texto.length <= 1600, `${rotulo}: ${texto.length}`);
    assert.equal(texto.split('\n').length, PALETA.length + 2, rotulo);
    // O mesmo texto sai do SessionStart real.
    const { contexto } = sessionStart(home);
    assert.ok(contexto.includes(texto), rotulo);
  }
});

// ------------------------------------------- aprovação em N1/N2 pelo comando

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
// Guarda ligada (padrão), sem pergunta: a negação é um deny, não um ask.
function homeDaGuarda() {
  const home = novoHome({ guarda: { perguntar: false } });
  gravarEstado(home);
  const antes = process.env.HADOUKEN_HOME;
  process.env.HADOUKEN_HOME = home;
  try { registrarSessao('s1', Date.now()); } finally {
    if (antes === undefined) delete process.env.HADOUKEN_HOME;
    else process.env.HADOUKEN_HOME = antes;
  }
  return home;
}
const despachar = (home, agente, extra = {}) => rodarScript('guarda-despacho.js', {
  session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', cwd: os.tmpdir(),
  tool_input: { subagent_type: `hadouken:${agente}`, prompt: 'x', description: 'y', ...extra },
}, home);
const negado = (saida) => {
  assert.equal(saida?.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(saida));
  return saida.hookSpecificOutput.permissionDecisionReason;
};

test('N1 pelo comando: busca sonnet aprova model sonnet no despacho e continua negando opus', () => {
  const home = homeDaGuarda();
  bloqueio(comando('busca sonnet', home));
  assert.equal(despachar(home, 'busca', { model: 'sonnet' }), null);
  assert.equal(negado(despachar(home, 'busca', { model: 'opus' })), mensagens.N1_CLAUDE);
});

test('N2 pelo comando: mecanico opus aprova model opus; mecanico padrao volta a negar', () => {
  const home = homeDaGuarda();
  assert.equal(negado(despachar(home, 'mecanico', { model: 'opus' })), mensagens.N2_CLAUDE);
  bloqueio(comando('mecanico opus', home));
  assert.equal(despachar(home, 'mecanico', { model: 'opus' }), null);
  bloqueio(comando('mecanico padrao', home));
  assert.equal(negado(despachar(home, 'mecanico', { model: 'opus' })), mensagens.N2_CLAUDE);
});

test('agente desligado pelo comando é negado no despacho com o substituto; religado, passa', () => {
  const home = homeDaGuarda();
  bloqueio(comando('busca off', home));
  assert.match(negado(despachar(home, 'busca')), /hadouken:varredor/);
  bloqueio(comando('busca on', home));
  assert.equal(despachar(home, 'busca'), null);
});

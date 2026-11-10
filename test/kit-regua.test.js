import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// v0.6.0, Fatia 7, Tarefa 10 (spec §4 Fatia 7; casos R1 a R5, R8, R9 e R10; plano
// RF8). A régua de desenvolvimento do kit: padrão, global e do repo, com
// saneamento, validação sem eco e injeção no SessionStart. Disco só em pasta
// temporária; CLAUDE_CONFIG_DIR, HADOUKEN_HOME e CLAUDE_PROJECT_DIR sempre de
// fixture, nunca o ~/.claude de quem roda o teste.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLUXO = path.join(repo, 'kit', 'hooks', 'fluxo.js');
const REGUA_JS = path.join(repo, 'kit', 'hooks', 'regua.js');
const regua = () => import(pathToFileURL(REGUA_JS).href);

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hdk regua ç ')));
  pastas.push(d);
  return d;
};
const gravar = (arquivo, conteudo) => {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
};

// Os cinco terceiros do kit instalados e ligados (sem aviso de dependência) e um
// plugin `bom` de fixture: skills ok, solo (só do usuário), tres, quatro e o
// agente `ag`. O hadouken-kit tem de estar no registro (lerRegistro).
const TERCEIROS = ['superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken', 'poka-yoke@claude-hadouken',
  'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken'];
const KIT = 'hadouken-kit@claude-hadouken';
function montarCfg() {
  const cfg = novoTmp();
  const bom = path.join(novoTmp(), 'bom');
  gravar(path.join(bom, '.claude-plugin', 'plugin.json'), { name: 'bom' });
  for (const s of ['ok', 'solo', 'tres', 'quatro']) {
    const extra = s === 'solo' ? 'disable-model-invocation: true\n' : '';
    gravar(path.join(bom, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: fixture\n${extra}---\n\ncorpo\n`);
  }
  gravar(path.join(bom, 'agents', 'ag.md'), '---\nname: ag\ndescription: fixture\n---\n');
  const instalados = { [KIT]: [{ scope: 'user', version: '1.2.0', installPath: null }], 'bom@mkt': [{ scope: 'user', version: '1.0.0', installPath: bom }] };
  for (const id of TERCEIROS) instalados[id] = [{ scope: 'user', version: '1.0.0', installPath: null }];
  gravar(path.join(cfg, 'plugins', 'installed_plugins.json'), { version: 2, plugins: instalados });
  gravar(path.join(cfg, 'settings.json'), { enabledPlugins: Object.fromEntries([KIT, 'bom@mkt', ...TERCEIROS].map((id) => [id, true])) });
  return cfg;
}

function rodar({ cfg = montarCfg(), hadouken = novoTmp(), projeto, cwd = novoTmp() } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HADOUKEN_HOME: hadouken };
  delete env.CLAUDE_PROJECT_DIR;
  if (projeto !== undefined) env.CLAUDE_PROJECT_DIR = projeto;
  const r = spawnSync(process.execPath, [FLUXO], { cwd, input: '', encoding: 'utf8', timeout: 10000, env });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const contexto = j.hookSpecificOutput.additionalContext;
  const linhas = contexto.split('\n');
  return { j, contexto, aviso: j.systemMessage ?? '', linhaRegua: linhas.find((l) => l.startsWith('Régua (')) ?? '' };
}

const reguaDe = (fases, transversais) => (transversais === undefined ? { fases } : { fases, transversais });
const doRepo = (conteudo) => {
  const raiz = novoTmp();
  gravar(path.join(raiz, '.claude', 'hadouken.json'), conteudo);
  return raiz;
};
const doGlobal = (conteudo) => {
  const h = novoTmp();
  gravar(path.join(h, 'regua.json'), conteudo);
  return h;
};
const LINHA_REPO = 'hadouken-kit: a régua deste repositório (.claude/hadouken.json) vale no lugar da sua; /hadouken-kit:regua mostra qual.';

// ------------------------------------------------------------ origens

test('padrão: sem arquivos → Régua (padrão) com as fases da spec, na ordem, e sem aviso', () => {
  const { contexto, aviso, linhaRegua } = rodar();
  assert.match(contexto, /Régua \(padrão\):/);
  const fases = ['Ideia', 'Protótipo', 'Registrar a forma', 'Auditoria da spec', 'Quebrar o trabalho', 'Executar',
    'Teste e bug', 'Revisar', 'Mutação', 'Auditoria do diff'];
  let ate = -1;
  for (const f of fases) {
    const i = linhaRegua.indexOf(`${f} →`, ate + 1);
    assert.ok(i > ate, `${f} fora de ordem ou ausente`);
    ate = i;
  }
  assert.match(linhaRegua, /Auditoria da spec → agente hadouken:auditor/);
  assert.match(linhaRegua, /Mutação → hadouken-kit:mutacao/);
  assert.match(linhaRegua, /Auditoria do diff → agente hadouken:auditor/);
  assert.match(linhaRegua, /Transversais: /);
  assert.equal(aviso, '');
});

test('global: <HADOUKEN_HOME>/regua.json válido → Régua (global)', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'Minha', usar: ['bom:ok'] }]));
  const { linhaRegua, aviso } = rodar({ hadouken });
  assert.match(linhaRegua, /^Régua \(global\): Minha → bom:ok$/);
  assert.doesNotMatch(linhaRegua, /Auditoria da spec/);
  assert.equal(aviso, '');
});

test('repo: <raiz>/.claude/hadouken.json com regua → Régua (repo) e nada da global', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'Global', usar: ['bom:ok'] }]));
  const projeto = doRepo({ outra: 1, regua: reguaDe([{ fase: 'Do repo', usar: ['bom:tres'] }]) });
  const { linhaRegua } = rodar({ hadouken, projeto });
  assert.match(linhaRegua, /^Régua \(repo\): Do repo → bom:tres$/);
  assert.doesNotMatch(linhaRegua, /Global/);
});

test('repo sem a chave regua → vale a global (o arquivo é de outras chaves)', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'Global', usar: ['bom:ok'] }]));
  const projeto = doRepo({ outra: 1 });
  const { linhaRegua, aviso } = rodar({ hadouken, projeto });
  assert.match(linhaRegua, /^Régua \(global\): Global → bom:ok$/);
  assert.equal(aviso, '');
});

test('skill só do usuário vira /nome (catálogo) e a alternativa e o agente seguem o formato', () => {
  const hadouken = doGlobal(reguaDe([
    { fase: 'F', usar: ['bom:ok', 'bom:solo'], alternativas: [{ skill: 'bom:tres', quando: 'tem glossário' }, { skill: 'bom:solo', quando: 'já decidiu' }], agente: 'bom:ag' },
    { fase: 'G', agente: 'Explore' },
  ], [{ skill: 'bom:quatro', quando: 'lentidão' }]));
  const { linhaRegua } = rodar({ hadouken });
  assert.equal(linhaRegua, 'Régua (global): F → bom:ok, /bom:solo (alt.: bom:tres — tem glossário | /bom:solo — já decidiu) · agente bom:ag; G → agente Explore; Transversais: bom:quatro — lentidão');
});

// ------------------------------------------------------------ R1, R2: nível inválido cai para o seguinte

test('R1: repo com JSON inválido → aviso e Régua (global)', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'Global', usar: ['bom:ok'] }]));
  const projeto = novoTmp();
  gravar(path.join(projeto, '.claude', 'hadouken.json'), '{quebrado');
  const { linhaRegua, aviso } = rodar({ hadouken, projeto });
  assert.match(linhaRegua, /^Régua \(global\): /);
  assert.match(aviso, /régua do repositório \(\.claude\/hadouken\.json\) está ilegível ou inválida/);
  assert.ok(!aviso.includes(LINHA_REPO));
});

test('R2: fases vazia no repo → aviso e o nível seguinte (padrão, sem global)', () => {
  const projeto = doRepo({ regua: { fases: [] } });
  const { linhaRegua, aviso } = rodar({ projeto });
  assert.match(linhaRegua, /^Régua \(padrão\): /);
  assert.match(aviso, /régua do repositório .* ilegível ou inválida/);
  assert.ok(!aviso.includes(LINHA_REPO));
});

test('R2: global inválida → aviso e a padrão', () => {
  const hadouken = doGlobal({ fases: 'não é lista' });
  const { linhaRegua, aviso } = rodar({ hadouken });
  assert.match(linhaRegua, /^Régua \(padrão\): /);
  assert.match(aviso, /régua global \(regua\.json\) está ilegível ou inválida/);
});

// ------------------------------------------------------------ R3: desconhecido sem eco

test('R3: skill desconhecida → aviso com a contagem, sem o nome; o resto da fase fica', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'F', usar: ['x:inexistente', 'bom:ok'] }]));
  const { linhaRegua, aviso } = rodar({ hadouken });
  assert.match(aviso, /1 skill desconhecida/);
  assert.ok(!aviso.includes('x:inexistente'));
  assert.equal(linhaRegua, 'Régua (global): F → bom:ok');
  assert.match(aviso, /\/hadouken-kit:regua mostra a régua ativa\./);
});

test('R3: agente desconhecido → aviso com a contagem, sem o nome', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'F', usar: ['bom:ok'], agente: 'x:nao-existe' }]));
  const { linhaRegua, aviso } = rodar({ hadouken });
  assert.match(aviso, /1 agente desconhecido/);
  assert.ok(!aviso.includes('x:nao-existe'));
  assert.ok(!linhaRegua.includes('x:nao-existe'));
  assert.match(linhaRegua, /F → bom:ok/);
});

test('R3: plural e junção das parcelas (N skills e M agentes, só as diferentes de zero)', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'F', usar: ['x:a', 'x:b', 'bom:ok'], agente: 'x:c' }, { fase: 'G', usar: ['bom:ok'], agente: 'x:d' }]));
  const { aviso } = rodar({ hadouken });
  assert.match(aviso, /^hadouken-kit: régua com 2 skills desconhecidas e 2 agentes desconhecidos; \/hadouken-kit:regua mostra a régua ativa\.$/);
});

// ------------------------------------------------------------ R4: limites

test('R4: 60 fases → no máximo 20 entram; texto ≤ 2000 caracteres terminado no ponteiro quando corta', () => {
  const longas = Array.from({ length: 60 }, (_, i) => ({ fase: `Fase ${i}`, usar: ['bom:ok', 'bom:tres', 'bom:quatro', 'bom:solo'], alternativas: [{ skill: 'bom:ok', quando: 'q'.repeat(100) }] }));
  const { linhaRegua, aviso } = rodar({ hadouken: doGlobal(reguaDe(longas)) });
  assert.ok(linhaRegua.length <= 2000, `${linhaRegua.length} caracteres`);
  assert.ok(linhaRegua.endsWith('… (régua completa: /hadouken-kit:regua)'), linhaRegua.slice(-60));
  assert.ok((linhaRegua.match(/ →/g) ?? []).length <= 20);
  assert.match(aviso, /40 item\(ns\) descartado\(s\)/);
});

test('R4: 20 fases curtas cabem sem ponteiro', () => {
  const curtas = Array.from({ length: 30 }, (_, i) => ({ fase: `F${i}`, usar: ['bom:ok'] }));
  const { linhaRegua } = rodar({ hadouken: doGlobal(reguaDe(curtas)) });
  assert.equal((linhaRegua.match(/ →/g) ?? []).length, 20);
  assert.ok(!linhaRegua.includes('régua completa'));
});

// ------------------------------------------------------------ R5 e R10: saneamento

test('R5: `quando` com quebra de linha e 300 caracteres → uma linha, até 120', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'F', usar: ['bom:ok'] }], [{ skill: 'bom:tres', quando: `linha um\nlinha dois ${'q'.repeat(300)}` }]));
  const { contexto, linhaRegua } = rodar({ hadouken });
  const quando = /bom:tres — (.*)$/.exec(linhaRegua)[1];
  assert.ok(quando.length <= 120 && quando.length > 100, `${quando.length}`);
  assert.ok(quando.startsWith('linha um linha dois '));
  assert.equal(contexto.split('\n').length, 3);
});

test('R5: `fase` com quebra, controle e 300 caracteres → até 60, sem \\n nem controle', () => {
  const hadouken = doGlobal(reguaDe([{ fase: `Ini\ncio\u0007fim ${'f'.repeat(300)}`, usar: ['bom:ok'] }]));
  const { linhaRegua } = rodar({ hadouken });
  const fase = /^Régua \(global\): (.*?) → /.exec(linhaRegua)[1];
  assert.ok(fase.length <= 60 && fase.length > 50, `${fase.length}`);
  assert.ok(fase.startsWith('Ini cio fim '));
  assert.doesNotMatch(linhaRegua, /[\u0000-\u001f\u007f]/);
});

test('R5/R10: nomes fora da regex saem e a contagem aparece, sem eco', () => {
  const hadouken = doGlobal(reguaDe([
    { fase: 'F', usar: ['bom:ok', 'x\ny', 'a'.repeat(81), 'com espaço'] },
    { fase: 'G', usar: ['bom:ok'], alternativas: [{ skill: 'a b', quando: 'q' }, { skill: 'bom:tres', quando: 'q' }], agente: 'a b' },
  ], [{ skill: 'ruim\nnome', quando: 'q' }, { skill: 'bom:quatro', quando: '   ' }, { skill: 'bom:quatro', quando: 'ok' }]));
  const { linhaRegua, aviso } = rodar({ hadouken });
  assert.equal(linhaRegua, 'Régua (global): F → bom:ok; G → bom:ok (alt.: bom:tres — q); Transversais: bom:quatro — ok');
  assert.match(aviso, /7 item\(ns\) descartado\(s\)/);
  for (const proibido of ['x\ny', 'com espaço', 'aaaa', 'a b', 'ruim']) assert.ok(!aviso.includes(proibido), proibido);
});

test('R10: 13 itens em usar → 12; 13 alternativas → 12; 41 transversais → 40', () => {
  const hadouken = doGlobal(reguaDe([
    { fase: 'U', usar: Array.from({ length: 13 }, () => 'bom:ok') },
    { fase: 'A', usar: ['bom:ok'], alternativas: Array.from({ length: 13 }, () => ({ skill: 'bom:tres', quando: 'q' })) },
  ], Array.from({ length: 41 }, () => ({ skill: 'bom:quatro', quando: 'q' }))));
  const { linhaRegua, aviso } = rodar({ hadouken });
  const [fases, transversais] = linhaRegua.split('; Transversais: ');
  assert.equal(fases.split('; ')[0].match(/bom:ok/g).length, 12);
  assert.equal(fases.match(/bom:tres/g).length, 12);
  assert.equal(transversais.match(/bom:quatro/g).length, 40);
  assert.match(aviso, /3 item\(ns\) descartado\(s\)/);
});

test('R10: fase sem usar e sem agente depois dos descartes → a fase sai e conta', () => {
  const hadouken = doGlobal(reguaDe([{ fase: 'Vazia', usar: ['x y'] }, { fase: 'Boa', usar: ['bom:ok'] }, { usar: ['bom:ok'] }]));
  const { linhaRegua, aviso } = rodar({ hadouken });
  assert.equal(linhaRegua, 'Régua (global): Boa → bom:ok');
  assert.match(aviso, /3 item\(ns\) descartado\(s\)/);
  assert.ok(!aviso.includes('Vazia'));
});

// ------------------------------------------------------------ R9: a régua do repo vale no lugar da sua

test('R9: régua do repo válida → linha fixa ao usuário, sem eco do arquivo', () => {
  const projeto = doRepo({ regua: reguaDe([{ fase: 'Segredo do repo', usar: ['bom:ok'] }]) });
  const { aviso } = rodar({ projeto });
  assert.equal(aviso, LINHA_REPO);
});

test('R9: origem global ou padrão → sem a linha; repo inválido (R1) → sem a linha', () => {
  assert.ok(!rodar().aviso.includes(LINHA_REPO));
  assert.ok(!rodar({ hadouken: doGlobal(reguaDe([{ fase: 'G', usar: ['bom:ok'] }])) }).aviso.includes(LINHA_REPO));
  assert.ok(!rodar({ projeto: doRepo({ regua: { fases: [] } }) }).aviso.includes(LINHA_REPO));
});

test('R9: a linha do repo e a contagem de desconhecidos juntas, uma por linha', () => {
  const projeto = doRepo({ regua: reguaDe([{ fase: 'F', usar: ['x:fora', 'bom:ok'] }]) });
  const linhas = rodar({ projeto }).aviso.split('\n');
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /1 skill desconhecida/);
  assert.equal(linhas[1], LINHA_REPO);
});

// ------------------------------------------------------------ R8: raiz do projeto

test('R8: CLAUDE_PROJECT_DIR absoluto e existente vale, com o cwd em outra pasta', () => {
  const projeto = doRepo({ regua: reguaDe([{ fase: 'Da A', usar: ['bom:ok'] }]) });
  const cwd = novoTmp();
  gravar(path.join(cwd, '.claude', 'hadouken.json'), { regua: reguaDe([{ fase: 'Da B', usar: ['bom:ok'] }]) });
  assert.match(rodar({ projeto, cwd }).linhaRegua, /^Régua \(repo\): Da A → /);
});

test('R8: sem CLAUDE_PROJECT_DIR, o .git mais próximo do cwd para cima (arquivo .git, como no worktree)', () => {
  const raiz = doRepo({ regua: reguaDe([{ fase: 'Da raiz', usar: ['bom:ok'] }]) });
  fs.writeFileSync(path.join(raiz, '.git'), 'gitdir: /algum/lugar\n');
  const cwd = path.join(raiz, 'sub', 'dir');
  fs.mkdirSync(cwd, { recursive: true });
  assert.match(rodar({ cwd }).linhaRegua, /^Régua \(repo\): Da raiz → /);
});

test('R8: sem CLAUDE_PROJECT_DIR e sem .git, vale o cwd', () => {
  const cwd = doRepo({ regua: reguaDe([{ fase: 'Do cwd', usar: ['bom:ok'] }]) });
  assert.match(rodar({ cwd }).linhaRegua, /^Régua \(repo\): Do cwd → /);
});

test('R8: CLAUDE_PROJECT_DIR relativo ou inexistente é ignorado (vale o .git mais próximo)', () => {
  const raiz = doRepo({ regua: reguaDe([{ fase: 'Da raiz', usar: ['bom:ok'] }]) });
  fs.mkdirSync(path.join(raiz, '.git'));
  gravar(path.join(raiz, 'rel', '.claude', 'hadouken.json'), { regua: reguaDe([{ fase: 'Isca relativa', usar: ['bom:ok'] }]) });
  assert.match(rodar({ cwd: raiz, projeto: 'rel' }).linhaRegua, /^Régua \(repo\): Da raiz → /);
  assert.match(rodar({ cwd: raiz, projeto: path.join(novoTmp(), 'nao-existe') }).linhaRegua, /^Régua \(repo\): Da raiz → /);
});

// ------------------------------------------------------------ interfaces (kit/hooks/regua.js)

test('raizProjeto: comGit false só quando cai no cwd', async () => {
  const { raizProjeto } = await regua();
  const a = novoTmp();
  assert.deepEqual(raizProjeto({ env: { CLAUDE_PROJECT_DIR: a }, cwd: os.tmpdir() }), { raiz: a, comGit: true });
  const g = novoTmp();
  fs.mkdirSync(path.join(g, '.git'));
  const fundo = path.join(g, 'a', 'b');
  fs.mkdirSync(fundo, { recursive: true });
  assert.deepEqual(raizProjeto({ env: {}, cwd: fundo }), { raiz: g, comGit: true });
  const sem = novoTmp();
  assert.deepEqual(raizProjeto({ env: { CLAUDE_PROJECT_DIR: 'relativo' }, cwd: sem }), { raiz: sem, comGit: false });
});

test('dirHadouken: mesma regra de dirDados (HADOUKEN_HOME absoluto; inválido → null; sem a variável → ~/.claude/hadouken)', async () => {
  const { dirHadouken } = await regua();
  const h = novoTmp();
  assert.equal(dirHadouken({ HADOUKEN_HOME: h }), h);
  assert.equal(dirHadouken({ HADOUKEN_HOME: 'relativo' }), null);
  assert.equal(dirHadouken({ HADOUKEN_HOME: '' }), null);
  assert.equal(dirHadouken({}), path.join(os.homedir(), '.claude', 'hadouken'));
});

test('constantes e validarRegua: limites da spec e contagem de descartes', async () => {
  const m = await regua();
  assert.deepEqual([m.LIMITE_FASE, m.LIMITE_QUANDO, m.LIMITE_NOME, m.MAX_FASES, m.MAX_LISTA, m.MAX_TRANSVERSAIS, m.LIMITE_TEXTO],
    [60, 120, 80, 20, 12, 40, 2000]);
  assert.ok(m.NOME_REGUA.test('a:b_c-1') && !m.NOME_REGUA.test('a b') && !m.NOME_REGUA.test('a\n'));
  const ok = m.validarRegua({ fases: [{ fase: 'F', usar: ['a:b'] }] });
  assert.deepEqual(ok, { regua: { fases: [{ fase: 'F', usar: ['a:b'], alternativas: [], agente: null }], transversais: [] }, avisos: [], descartes: 0 });
  for (const invalido of [null, [], 'x', {}, { fases: [] }, { fases: 'x' }, { fases: [{ fase: 'F' }] }, { fases: [{ usar: ['a:b'] }] }]) {
    const r = m.validarRegua(invalido);
    assert.equal(r.regua, null, JSON.stringify(invalido));
    assert.equal(r.avisos.length, 1);
  }
});

test('catalogo: skills de plugin ligado (com só-do-usuário), de ~/.claude/skills e do projeto; agentes e os internos', async () => {
  const { catalogo } = await regua();
  const cfg = montarCfg();
  gravar(path.join(cfg, 'skills', 'minha', 'SKILL.md'), '---\nname: minha\n---\n');
  gravar(path.join(cfg, 'agents', 'meu.md'), '---\nname: meu\n---\n');
  const raiz = novoTmp();
  gravar(path.join(raiz, '.claude', 'skills', 'local', 'SKILL.md'), '---\nname: local\ndisable-model-invocation: true\n---\n');
  gravar(path.join(raiz, '.claude', 'agents', 'ag-local.md'), '---\nname: ag-local\n---\n');
  const c = catalogo({ pastaConfig: cfg, raiz });
  assert.deepEqual(c.skills.get('bom:ok'), { soUsuario: false });
  assert.deepEqual(c.skills.get('bom:solo'), { soUsuario: true });
  assert.deepEqual(c.skills.get('minha'), { soUsuario: false });
  assert.deepEqual(c.skills.get('local'), { soUsuario: true });
  for (const a of ['bom:ag', 'meu', 'ag-local', 'Explore', 'Plan', 'general-purpose']) assert.ok(c.agentes.has(a), a);
  assert.ok(!c.skills.has('bom:inexistente'));
});

test('catalogo: plugin desligado não entra; plugin.json com `skills` aponta as pastas', async () => {
  const { catalogo } = await regua();
  const cfg = montarCfg();
  const fora = path.join(novoTmp(), 'fora');
  gravar(path.join(fora, '.claude-plugin', 'plugin.json'), { name: 'fora', skills: ['./coisas/a'] });
  gravar(path.join(fora, 'coisas', 'a', 'SKILL.md'), '---\nname: a\n---\n');
  gravar(path.join(fora, 'skills', 'padrao', 'SKILL.md'), '---\nname: padrao\n---\n');
  const reg = JSON.parse(fs.readFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), 'utf8'));
  reg.plugins['fora@mkt'] = [{ scope: 'user', version: '1', installPath: fora }];
  gravar(path.join(cfg, 'plugins', 'installed_plugins.json'), reg);
  let c = catalogo({ pastaConfig: cfg, raiz: novoTmp() });
  assert.ok(!c.skills.has('fora:a'), 'sem chave em enabledPlugins = desligado');
  const set = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  set.enabledPlugins['fora@mkt'] = true;
  gravar(path.join(cfg, 'settings.json'), set);
  c = catalogo({ pastaConfig: cfg, raiz: novoTmp() });
  assert.ok(c.skills.has('fora:a'));
  assert.ok(!c.skills.has('fora:padrao'), 'com `skills` no manifesto, vale o que ele aponta');
});

test('avisosDaRegua: texto fixo, só as parcelas diferentes de zero; linha do repo só com origem repo', async () => {
  const { avisosDaRegua } = await regua();
  assert.deepEqual(avisosDaRegua({ origem: 'global', desconhecidos: { skills: 0, agentes: 0 }, descartes: 0 }), []);
  assert.deepEqual(avisosDaRegua({ origem: 'global', desconhecidos: { skills: 1, agentes: 2 }, descartes: 4 }),
    ['hadouken-kit: régua com 1 skill desconhecida e 2 agentes desconhecidos e 4 item(ns) descartado(s); /hadouken-kit:regua mostra a régua ativa.']);
  assert.deepEqual(avisosDaRegua({ origem: 'repo', desconhecidos: { skills: 0, agentes: 0 }, descartes: 0 }), [LINHA_REPO]);
});

test('o ponteiro cabe: corte respeita LIMITE_TEXTO mesmo com uma fase maior que o limite', async () => {
  const { textoRegua, validarRegua, LIMITE_TEXTO } = await regua();
  const r = validarRegua({ fases: [{ fase: 'F', usar: Array.from({ length: 12 }, () => `p:${'n'.repeat(77)}`) }, { fase: 'G', usar: Array.from({ length: 12 }, () => `p:${'n'.repeat(77)}`) }, { fase: 'H', usar: Array.from({ length: 12 }, () => `p:${'n'.repeat(77)}`) }] });
  const t = textoRegua({ regua: r.regua, origem: 'global', catalogo: { skills: new Map(), agentes: new Set() }, validar: false });
  assert.ok(t.texto.length <= LIMITE_TEXTO, `${t.texto.length}`);
  assert.ok(t.texto.endsWith('… (régua completa: /hadouken-kit:regua)'));
});

test('fluxo.js sem regua.js ao lado: a mesma régua padrão (paridade do reserva com o JSON)', () => {
  const normal = rodar().contexto;
  const sozinho = path.join(novoTmp(), 'hooks');
  fs.mkdirSync(sozinho, { recursive: true });
  fs.copyFileSync(FLUXO, path.join(sozinho, 'fluxo.js'));
  fs.copyFileSync(path.join(repo, 'kit', 'package.json'), path.join(sozinho, '..', 'package.json'));
  const r = spawnSync(process.execPath, [path.join(sozinho, 'fluxo.js')], { cwd: novoTmp(), input: '', encoding: 'utf8', timeout: 10000, env: { ...process.env, CLAUDE_CONFIG_DIR: montarCfg(), HADOUKEN_HOME: novoTmp() } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, normal);
});

test('kit autocontido: regua.js só importa node: e arquivos de ./', () => {
  const texto = fs.readFileSync(REGUA_JS, 'utf8');
  const origens = [...texto.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(origens.length >= 3);
  for (const o of origens) assert.ok(o.startsWith('node:') || o.startsWith('./'), o);
  assert.doesNotMatch(texto, /\.\.\/\.\.\/src|from ['"]\.\.\//);
});

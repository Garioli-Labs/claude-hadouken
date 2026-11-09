import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarClaude, DEPENDENCIAS_KIT, ID_KIT, ID_PRINCIPAL, ID_REA, listarPlugins, passoKit, passoPlugin, passoRea } from '../src/instalar/claude-cli.js';
import { TERCEIROS_KIT } from '../src/instalar/dedup.js';
import { codigoDeSaida, formatarResumo, item } from '../src/instalar/itens.js';
import { instalarFalso, rodarFalso } from './dados/instalador/claude-falso.mjs';

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = (prefixo = 'hdk claude x ') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  pastas.push(d);
  return d;
};
function executarFalso(resposta = (cb) => cb(null, '[]', '')) {
  const chamadas = [];
  return { chamadas, executar: (exe, args, opcoes, cb) => { chamadas.push({ exe, args, opcoes }); resposta(cb); } };
}

// ------------------------------------------------------------ itens

test('formatarResumo: um sinal por estado, conserto depois do motivo, e a linha final', () => {
  const itens = [
    item.ok('hadouken-kit', 'instalado (1.1.0)'), item.igual('barra'), item.pulado('aprendizado', 'desligado'),
    item.falhou('graphify', 'erro', 'rode python3 -m pip install --user graphifyy==0.9.25'),
  ];
  assert.equal(formatarResumo(itens), [
    '✓ hadouken-kit: instalado (1.1.0)', '= barra: já estava', '– aprendizado: pulado (desligado)',
    '✗ graphify: falhou (erro; rode python3 -m pip install --user graphifyy==0.9.25)', '', 'Abra uma sessão nova do Claude Code.',
  ].join('\n'));
  assert.equal(codigoDeSaida(itens), 1);
  assert.equal(codigoDeSaida(itens.slice(0, 3)), 0);
});

// ------------------------------------------------------------ criarClaude

test('criarClaude: claude.cmd no Windows vai pelo cmd.exe do System32, com a linha entre aspas', async () => {
  const { chamadas, executar } = executarFalso();
  const exe = 'C:\\Users\\Lucas Garioli\\AppData\\Roaming\\npm\\claude.cmd';
  const rodar = criarClaude({ exe, plataforma: 'win32', executar, systemRoot: 'C:\\Windows', cwd: 'C:\\Users\\Lucas Garioli' });
  assert.deepEqual(await rodar(['plugin', 'list', '--json']), { ok: true, motivo: 'ok', saida: '[]' });
  assert.equal(chamadas[0].exe, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(chamadas[0].args, ['/d', '/s', '/c', '""C:\\Users\\Lucas Garioli\\AppData\\Roaming\\npm\\claude.cmd" plugin list --json"']);
  assert.equal(chamadas[0].opcoes.windowsVerbatimArguments, true);
  assert.equal(chamadas[0].opcoes.windowsHide, true);
  assert.equal(chamadas[0].opcoes.cwd, 'C:\\Users\\Lucas Garioli');
});

test('criarClaude: claude.exe e o claude do POSIX rodam direto', async () => {
  const win = executarFalso();
  await criarClaude({ exe: 'C:\\Users\\Lucas Garioli\\.local\\bin\\claude.exe', plataforma: 'win32', executar: win.executar })(['--version']);
  assert.equal(win.chamadas[0].exe, 'C:\\Users\\Lucas Garioli\\.local\\bin\\claude.exe');
  assert.deepEqual(win.chamadas[0].args, ['--version']);
  assert.equal(win.chamadas[0].opcoes.windowsVerbatimArguments, undefined);
  const mac = executarFalso();
  await criarClaude({ exe: '/Users/Fulano de Tal/.local/bin/claude', plataforma: 'darwin', executar: mac.executar })(['plugin', 'install', ID_KIT]);
  assert.deepEqual(mac.chamadas[0].args, ['plugin', 'install', ID_KIT]);
});

test('criarClaude: recusa exe relativo ou com caractere de shell, e argumento fora da lista', async () => {
  for (const exe of ['claude', 'C:\\a&b\\claude.cmd', '/a"b/claude', undefined]) {
    const { chamadas, executar } = executarFalso();
    const plataforma = typeof exe === 'string' && exe.startsWith('C:') ? 'win32' : 'linux';
    assert.equal((await criarClaude({ exe, plataforma, executar })(['--version'])).motivo, 'claude-invalido', String(exe));
    assert.equal(chamadas.length, 0);
  }
  const { chamadas, executar } = executarFalso();
  const rodar = criarClaude({ exe: '/usr/bin/claude', plataforma: 'linux', executar });
  for (const args of [['a b'], ['x&y'], ['"'], [42], 'plugin']) assert.equal((await rodar(args)).motivo, 'argumentos', String(args));
  assert.equal(chamadas.length, 0);
});

test('criarClaude: erro, prazo e exceção do executar viram motivo', async () => {
  const exe = '/usr/bin/claude';
  const erro = criarClaude({ exe, plataforma: 'linux', executar: (e, a, o, cb) => cb(Object.assign(new Error('x'), { code: 1 }), 'parcial') });
  assert.deepEqual(await erro(['--version']), { ok: false, motivo: 'erro', saida: 'parcial' });
  const tempo = criarClaude({ exe, plataforma: 'linux', executar: (e, a, o, cb) => cb(Object.assign(new Error('x'), { killed: true }), '') });
  assert.equal((await tempo(['--version'])).motivo, 'tempo');
  const lanca = criarClaude({ exe, plataforma: 'linux', executar: () => { throw new Error('x'); } });
  assert.equal((await lanca(['--version'])).motivo, 'erro');
});

test('criarClaude roda de verdade um claude falso numa pasta com espaço', async () => {
  const d = novoTmp();
  const estado = path.join(d, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [{ id: ID_KIT, version: '1.1.0', scope: 'user', enabled: true, installPath: d }], log: [], raiz: d }));
  const rodar = criarClaude({ exe: instalarFalso(d), ambiente: { ...process.env, FALSO_ESTADO: estado } });
  const mapa = await listarPlugins(rodar);
  assert.ok(mapa !== null);
  assert.equal(mapa.get(ID_KIT).version, '1.1.0');
});

// ------------------------------------------------------------ listarPlugins

test('listarPlugins: só escopo user, campos conferidos; saída inválida é null', async () => {
  const lista = [
    { id: ID_KIT, version: '1.1.0', scope: 'project', enabled: false, installPath: '/p' },
    { id: ID_KIT, version: '1.1.0', scope: 'user', enabled: true, installPath: '/u' },
    { id: ID_REA, version: 7, enabled: 'sim' },
    'lixo',
  ];
  const mapa = await listarPlugins(async () => ({ ok: true, motivo: 'ok', saida: JSON.stringify(lista) }));
  assert.deepEqual(mapa.get(ID_KIT), { version: '1.1.0', enabled: true, installPath: '/u' });
  assert.deepEqual(mapa.get(ID_REA), { version: null, enabled: false, installPath: null });
  for (const saida of ['{', '{}', '']) assert.equal(await listarPlugins(async () => ({ ok: true, motivo: 'ok', saida })), null, saida);
  assert.equal(await listarPlugins(async () => ({ ok: false, motivo: 'erro', saida: '[]' })), null);
});

// ------------------------------------------------------------ passos

test('passoPlugin: novo instala; mesma versão é igual; versão nova é atualizado; falha é ✗', async () => {
  const estado = { plugins: [], log: [], raiz: '/r' };
  const rodar = rodarFalso(estado);
  const novo = await passoPlugin(rodar, ID_KIT, 'hadouken-kit');
  assert.deepEqual(novo.item, item.ok('hadouken-kit', 'instalado (1.2.0)'));
  assert.equal(novo.entrada.installPath, '/r/hadouken-kit');
  assert.deepEqual(estado.log, ['plugin list --json', `plugin install ${ID_KIT}`, 'plugin list --json']);
  assert.deepEqual((await passoPlugin(rodar, ID_KIT, 'hadouken-kit')).item, item.igual('hadouken-kit'));
  assert.equal(estado.log.at(-2), `plugin update ${ID_KIT}`);
  estado.plugins[0].version = '1.0.1';
  assert.deepEqual((await passoPlugin(rodar, ID_KIT, 'hadouken-kit')).item, item.ok('hadouken-kit', 'atualizado (1.0.1 → 1.2.0)'));
  const ruim = { plugins: [], log: [], raiz: '/r', falhar: [`install ${ID_PRINCIPAL}`] };
  const r = await passoPlugin(rodarFalso(ruim), ID_PRINCIPAL, 'claude-hadouken');
  assert.equal(r.entrada, null);
  assert.equal(r.item.estado, 'falhou');
  assert.equal(r.item.conserto, `rode claude plugin install ${ID_PRINCIPAL}`);
  const semLista = await passoPlugin(async () => ({ ok: false, motivo: 'erro', saida: '' }), ID_KIT, 'hadouken-kit');
  assert.deepEqual(semLista.item, item.falhou('hadouken-kit', 'claude plugin list falhou', 'rode claude plugin list'));
});

const MATT = 'mattpocock-skills@claude-hadouken';
const MATT_UPSTREAM = 'mattpocock-skills@mattpocock';
const entrada = (id, version, enabled = true) => ({ id, version, scope: 'user', enabled, installPath: `/r/${id.split('@')[0]}` });

test('passoKit: o kit não traz as dependências; cada uma que falta ganha o install dela, e a lista final as tem', async () => {
  const estado = { plugins: [entrada(ID_KIT, '1.0.1'), entrada(ID_PRINCIPAL, '0.5.2')], log: [], raiz: '/r' };
  const r = await passoKit(rodarFalso(estado));
  assert.deepEqual(r.item, item.ok('hadouken-kit', 'atualizado (1.0.1 → 1.2.0); dependências instaladas: superpowers, mattpocock-skills, poka-yoke, fullstack-dev-skills, ui-ux-pro-max'));
  assert.ok(!estado.log.includes(`plugin install ${ID_KIT}`), 'o install do kit não é mais o caminho das dependências');
  for (const d of TERCEIROS_KIT) {
    assert.ok(estado.log.indexOf(`plugin install ${d}`) > estado.log.indexOf(`plugin update ${ID_KIT}`), d);
    assert.equal(r.lista.get(d)?.enabled, true, d);
  }
  assert.deepEqual(r.dedup.map((a) => a.estado), TERCEIROS_KIT.map(() => 'ausente'), 'a avaliação é a de antes dos installs');
});

test('passoKit: dependência que não instala é ✗ com o nome e o install dela; segunda rodada completa é =', async () => {
  const estado = { plugins: [], log: [], raiz: '/r', semDeps: ['poka-yoke@claude-hadouken'] };
  const r = await passoKit(rodarFalso(estado));
  assert.deepEqual(r.item, item.falhou('hadouken-kit', 'instalado (1.2.0); dependências instaladas: superpowers, mattpocock-skills, fullstack-dev-skills, ui-ux-pro-max; faltam dependências: poka-yoke', 'rode claude plugin install poka-yoke@claude-hadouken'));
  assert.equal(r.entrada.installPath, '/r/hadouken-kit', 'o kit em si instalou');
  const bom = { plugins: [], log: [], raiz: '/r' };
  await passoKit(rodarFalso(bom));
  const n = bom.log.length;
  assert.deepEqual((await passoKit(rodarFalso(bom))).item, item.igual('hadouken-kit'));
  assert.ok(!bom.log.slice(n).some((l) => l.startsWith('plugin install')), 'nada falta: sem install a mais');
});

test('passoKit: repos e testado reais entram na avaliação; duplicada por origem (nome diferente) com kit 1.2.0 desliga e confere pela lista', async () => {
  const SKILLS = 'skills@outro';
  const estado = { plugins: [entrada(ID_KIT, '1.2.0'), entrada(MATT, '1.3.2'), entrada(SKILLS, '1.3.1')], log: [], raiz: '/r' };
  const lerTestado = (caminho) => (caminho === '/r/hadouken-kit' ? { [MATT]: '1.3.2' } : {});
  const repos = new Map([[MATT, 'mattpocock/skills'], [SKILLS, 'mattpocock/skills']]);
  const r = await passoKit(rodarFalso(estado), { repos, lerTestado, autos: new Set([MATT]) });
  const matt = r.dedup.find((a) => a.id === MATT);
  assert.deepEqual([matt.estado, matt.equivalente, matt.versao], ['duplicada', SKILLS, { equivalente: '1.3.1', testada: '1.3.2' }]);
  assert.ok(estado.log.includes(`plugin disable ${MATT} --scope user`));
  assert.equal(r.lista.get(MATT).enabled, false);
  assert.match(r.item.detalhe, /mattpocock-skills já instalado via skills@outro; cópia do kit desligada/);
  assert.match(r.item.detalhe, /skills@outro na 1\.3\.1, testada 1\.3\.2/);
  const sem = { plugins: [entrada(ID_KIT, '1.2.0'), entrada(MATT, '1.3.2'), entrada(SKILLS, '1.3.1')], log: [], raiz: '/r' };
  const rSem = await passoKit(rodarFalso(sem));
  assert.equal(rSem.dedup.find((a) => a.id === MATT).estado, 'propria', 'sem repos nem testado, o nome diferente não casa');
  assert.ok(!sem.log.includes(`plugin disable ${MATT}`));
});

test('passoKit: lista nula depois dos install/disable é ✗ "não consegui conferir", sem usar a lista velha', async () => {
  // kit já em 1.2.0: list #1 (antes), update, list #2 (depois do update), installs, list #3 (a conferência)
  const estado = { plugins: [entrada(ID_KIT, '1.2.0')], log: [], raiz: '/r', falharListaNa: 3 };
  const r = await passoKit(rodarFalso(estado));
  assert.deepEqual(r.item, item.falhou('hadouken-kit', 'não consegui conferir a lista de plugins', 'rode claude plugin list'));
  assert.ok(estado.log.includes(`plugin install ${MATT}`), 'os installs rodaram; só a conferência falhou');
  assert.equal(r.lista, null);
  const desliga = { plugins: [entrada(ID_KIT, '1.2.0'), entrada(MATT, '1.3.2'), entrada(MATT_UPSTREAM, '1.3.2'), ...TERCEIROS_KIT.filter((d) => d !== MATT).map((d) => entrada(d, '1.0.0'))], log: [], raiz: '/r', falharListaNa: 3 };
  const d = await passoKit(rodarFalso(desliga), { autos: new Set([MATT]) });
  assert.ok(desliga.log.includes(`plugin disable ${MATT} --scope user`));
  assert.deepEqual(d.item, item.falhou('hadouken-kit', 'não consegui conferir a lista de plugins', 'rode claude plugin list'), 'não afirma "cópia desligada" sem ter conferido');
});

test('passoKit D1: cópia do usuário instalada e desligada, a do kit própria → o detalhe diz qual vale; nada é ligado nem desligado', async () => {
  const outras = TERCEIROS_KIT.filter((d) => d !== MATT).map((d) => entrada(d, '1.0.0'));
  const estado = { plugins: [entrada(ID_KIT, '1.2.0'), entrada(MATT, '1.3.2'), entrada(MATT_UPSTREAM, '1.3.2', false), ...outras], log: [], raiz: '/r' };
  const r = await passoKit(rodarFalso(estado));
  assert.deepEqual(r.item, item.ok('hadouken-kit', `${MATT_UPSTREAM} está desligado; vale a cópia do kit ${MATT}`));
  assert.ok(!estado.log.some((l) => /^plugin (enable|disable|install)/.test(l)), 'só informa');
  assert.equal(estado.plugins.find((x) => x.id === MATT_UPSTREAM).enabled, false);
});

test('passoKit: dependência instalada e desligada pelo usuário, sem equivalente, não é religada; o aviso traz o enable', async () => {
  const estado = { plugins: [entrada(ID_KIT, '1.2.0'), entrada(MATT, '1.3.2', false)], log: [], raiz: '/r' };
  const r = await passoKit(rodarFalso(estado));
  assert.ok(!estado.log.includes(`plugin enable ${MATT}`));
  assert.ok(!estado.log.includes(`plugin install ${MATT}`));
  assert.match(r.item.detalhe, new RegExp(`${MATT} está desligado e não há outra cópia\\. Religue: claude plugin enable ${MATT}`));
  assert.doesNotMatch(r.item.detalhe, /por você/);
});

test('DEPENDENCIAS_KIT é o que o instalador garante (hadouken + terceiros); o manifesto do kit declara só o hadouken', () => {
  const kit = JSON.parse(fs.readFileSync(new URL('../kit/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.deepEqual(DEPENDENCIAS_KIT, ['hadouken@claude-hadouken', ...TERCEIROS_KIT]);
  assert.deepEqual(kit.dependencies, ['hadouken']);
});

test('passoRea: REA já instalado e desligado pelo usuário continua desligado, mesmo com Node aceito', async () => {
  const estado = { plugins: [{ id: ID_REA, version: '1.0.1', scope: 'user', enabled: false, installPath: '/r/hadouken-rea' }], log: [], raiz: '/r' };
  const r = await passoRea(rodarFalso(estado), '24.11.0');
  assert.deepEqual(r, { nome: 'hadouken-rea', estado: 'igual', detalhe: 'desligado por você' });
  assert.ok(!estado.log.includes(`plugin enable ${ID_REA}`), 'não religa');
  assert.equal(estado.plugins[0].enabled, false);
  assert.match(formatarResumo([r]), /^= hadouken-rea: desligado por você$/m);
});

test('passoRea: Node aceito instala e liga; Node 20 deixa desligado (e desliga se estava ligado)', async () => {
  const bom = { plugins: [], log: [], raiz: '/r' };
  assert.deepEqual(await passoRea(rodarFalso(bom), '24.11.0'), item.ok('hadouken-rea', 'instalado (1.0.1), ligado'));
  assert.ok(bom.log.includes(`plugin enable ${ID_REA}`));
  assert.deepEqual(await passoRea(rodarFalso(bom), '24.11.0'), item.igual('hadouken-rea'), 'segunda rodada');
  const velho = { plugins: [], log: [], raiz: '/r' };
  const pulado = await passoRea(rodarFalso(velho), '20.19.0');
  assert.deepEqual(pulado, item.pulado('hadouken-rea', 'Node 20.19.0; o REA pede 22.19+, 24.11+ ou 26+'));
  assert.ok(!velho.log.some((l) => l.startsWith('plugin enable')));
  const ligado = { plugins: [{ id: ID_REA, version: '1.0.1', scope: 'user', enabled: true, installPath: '/r/hadouken-rea' }], log: [], raiz: '/r' };
  assert.equal((await passoRea(rodarFalso(ligado), '20.19.0')).estado, 'pulado');
  assert.ok(ligado.log.includes(`plugin disable ${ID_REA}`));
  assert.equal(ligado.plugins[0].enabled, false);
});

// ------------------------------------------------------------ v0.6.0, achados do auditor (G1, G2, G3)

const OUTRAS = TERCEIROS_KIT.filter((d) => d !== MATT).map((d) => entrada(d, '1.0.0'));
const duplicada = (extra = []) => ({ plugins: [entrada(ID_KIT, '1.2.0'), entrada(MATT, '1.3.2'), entrada(MATT_UPSTREAM, '1.3.2'), ...OUTRAS, ...extra], log: [], raiz: '/r' });
const semDisable = (estado) => assert.ok(!estado.log.some((l) => l.startsWith('plugin disable')), 'nenhum plugin disable');

test('G1: duplicada sem `auto` (o usuário instalou as duas) → nada é desligado; o detalhe diz que fazem o mesmo e traz o comando', async () => {
  const estado = duplicada();
  const r = await passoKit(rodarFalso(estado), { autos: new Set() });
  semDisable(estado);
  assert.equal(estado.plugins.find((x) => x.id === MATT).enabled, true);
  assert.equal(r.item.estado, 'ok');
  assert.match(r.item.detalhe, new RegExp(`mattpocock-skills em dobro com ${MATT_UPSTREAM}; as duas fazem o mesmo\\. Para ficar com uma: claude plugin disable ${MATT} --scope user`));
  assert.doesNotMatch(r.item.detalhe, /cópia do kit desligada/);
  const [matt] = r.dedup.filter((a) => a.id === MATT);
  assert.deepEqual([matt.estado, matt.auto], ['duplicada', false]);
});

test('G1: sem a opção `autos`, nada conta como instalado pelo kit e nada é desligado', async () => {
  const estado = duplicada();
  await passoKit(rodarFalso(estado));
  semDisable(estado);
});

test('G1/G2: duplicada com `auto` → plugin disable com --scope user, conferido pela lista; a segunda rodada é = no kit', async () => {
  const estado = duplicada();
  const autos = new Set([MATT]);
  const r = await passoKit(rodarFalso(estado), { autos });
  assert.ok(estado.log.includes(`plugin disable ${MATT} --scope user`));
  assert.ok(!estado.log.includes(`plugin disable ${MATT}`), 'nunca sem o escopo');
  assert.equal(r.lista.get(MATT).enabled, false);
  assert.match(r.item.detalhe, /mattpocock-skills já instalado via mattpocock-skills@mattpocock; cópia do kit desligada/);
  assert.deepEqual((await passoKit(rodarFalso(estado), { autos })).item, item.igual('hadouken-kit'));
});

test('G2: o disable que não surte efeito é ✗ com o comando que traz --scope user', async () => {
  const estado = { ...duplicada(), falhar: [`disable ${MATT} --scope user`] };
  const r = await passoKit(rodarFalso(estado), { autos: new Set([MATT]) });
  assert.equal(r.item.estado, 'falhou');
  assert.equal(r.item.conserto, `rode claude plugin disable ${MATT} --scope user`);
});

// Manifesto sintético em tmp: <pasta>/.claude-plugin/plugin.json.
function pluginComManifesto(id, conteudo, enabled = true) {
  const pasta = novoTmp('hdk dep ç ');
  fs.mkdirSync(path.join(pasta, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pasta, '.claude-plugin', 'plugin.json'), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return { id, version: '1.0.0', scope: 'user', enabled, installPath: pasta };
}

test('G3: outro plugin ligado depende da cópia do kit (nome solto ou nome@marketplace) → não roda disable; linha informativa nomeia o dependente', async () => {
  for (const dependencies of [[MATT], ['mattpocock-skills'], [{ name: 'mattpocock-skills', version: '^1.3' }], [{ name: 'mattpocock-skills', marketplace: 'claude-hadouken' }]]) {
    const estado = duplicada([pluginComManifesto('app@claude-hadouken', { name: 'app', dependencies })]);
    const r = await passoKit(rodarFalso(estado), { autos: new Set([MATT]) });
    semDisable(estado);
    assert.equal(estado.plugins.find((x) => x.id === MATT).enabled, true, JSON.stringify(dependencies));
    assert.equal(r.item.estado, 'ok', 'informa, não falha');
    assert.match(r.item.detalhe, /mattpocock-skills em dobro com mattpocock-skills@mattpocock; a cópia do kit fica ligada porque app@claude-hadouken depende dela/, JSON.stringify(dependencies));
    assert.deepEqual(r.dedup.find((a) => a.id === MATT).dependentes, ['app@claude-hadouken']);
  }
});

test('G3: dois dependentes são nomeados; dependente desligado, nome solto de outro marketplace e dependência de outro plugin não impedem o disable', async () => {
  const dois = duplicada([pluginComManifesto('b@m', { dependencies: [MATT] }), pluginComManifesto('a@m', { dependencies: [MATT] })]);
  const r = await passoKit(rodarFalso(dois), { autos: new Set([MATT]) });
  semDisable(dois);
  assert.match(r.item.detalhe, /porque a@m e b@m dependem dela/);
  const livre = duplicada([
    pluginComManifesto('app@claude-hadouken', { dependencies: [MATT] }, false),
    pluginComManifesto('app2@outro', { dependencies: ['mattpocock-skills'] }),
    pluginComManifesto('app3@claude-hadouken', { dependencies: ['poka-yoke@outro'] }),
  ]);
  await passoKit(rodarFalso(livre), { autos: new Set([MATT]) });
  assert.ok(livre.log.includes(`plugin disable ${MATT} --scope user`));
});

test('G3: manifesto ilegível, ausente ou de forma errada conta como sem dependências e não lança', async () => {
  for (const conteudo of ['{quebrado', '[]', { dependencies: 'x' }]) {
    const estado = duplicada([pluginComManifesto('app@claude-hadouken', conteudo)]);
    await passoKit(rodarFalso(estado), { autos: new Set([MATT]) });
    assert.ok(estado.log.includes(`plugin disable ${MATT} --scope user`), JSON.stringify(conteudo));
  }
  const estado = duplicada([{ ...pluginComManifesto('app@claude-hadouken', {}), installPath: '/nao/existe' }]);
  await passoKit(rodarFalso(estado), { autos: new Set([MATT]) });
  assert.ok(estado.log.includes(`plugin disable ${MATT} --scope user`));
});

test('G3: o leitor de dependências é injetável e um leitor que lança conta como sem dependências', async () => {
  const estado = duplicada([entrada('app@m', '1.0.0')]);
  const lerDependencias = (caminho, id) => { if (id === 'app@m') throw new Error('x'); return []; };
  await passoKit(rodarFalso(estado), { autos: new Set([MATT]), lerDependencias });
  assert.ok(estado.log.includes(`plugin disable ${MATT} --scope user`));
  const outro = duplicada([entrada('app@m', '1.0.0')]);
  const r = await passoKit(rodarFalso(outro), { autos: new Set([MATT]), lerDependencias: (caminho, id) => (id === 'app@m' ? [MATT] : []) });
  semDisable(outro);
  assert.match(r.item.detalhe, /porque app@m depende dela/);
});

test('G1/G3: kit < 1.2.0 com `auto` e dependente → continua mandando atualizar o kit (o kit antigo é o dependente)', async () => {
  const estado = duplicada();
  estado.plugins[0].version = '1.1.2';
  estado.falhar = [`update ${ID_KIT}`];
  const r = await passoKit(rodarFalso(estado), { autos: new Set([MATT]), lerDependencias: (caminho, id) => (id === ID_KIT ? TERCEIROS_KIT : []) });
  semDisable(estado);
  assert.match(r.item.detalhe, /atualize o hadouken-kit para desligar a cópia em dobro/);
  assert.doesNotMatch(r.item.detalhe, /depende/);
});

test('G1/G3: duplicada sem `auto` e com dependente ligado da cópia do kit → nada é desligado; a linha diz que as duas fazem o mesmo e quem depende', async () => {
  const estado = duplicada([pluginComManifesto('app@claude-hadouken', { dependencies: ['mattpocock-skills'] })]);
  const r = await passoKit(rodarFalso(estado), { autos: new Set() });
  semDisable(estado);
  assert.match(r.item.detalhe, new RegExp(`mattpocock-skills em dobro com ${MATT_UPSTREAM}; as duas fazem o mesmo, e ${MATT} fica ligada porque app@claude-hadouken depende dela`));
  assert.doesNotMatch(r.item.detalhe, /Para ficar com uma/, 'o comando falharia');
});

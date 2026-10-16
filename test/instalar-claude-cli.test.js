import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarClaude, DEPENDENCIAS_KIT, ID_KIT, ID_PRINCIPAL, ID_REA, listarPlugins, passoKit, passoPlugin, passoRea } from '../src/instalar/claude-cli.js';
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
  assert.deepEqual(novo.item, item.ok('hadouken-kit', 'instalado (1.1.0)'));
  assert.equal(novo.entrada.installPath, '/r/hadouken-kit');
  assert.deepEqual(estado.log, ['plugin list --json', `plugin install ${ID_KIT}`, 'plugin list --json']);
  assert.deepEqual((await passoPlugin(rodar, ID_KIT, 'hadouken-kit')).item, item.igual('hadouken-kit'));
  assert.equal(estado.log.at(-2), `plugin update ${ID_KIT}`);
  estado.plugins[0].version = '1.0.1';
  assert.deepEqual((await passoPlugin(rodar, ID_KIT, 'hadouken-kit')).item, item.ok('hadouken-kit', 'atualizado (1.0.1 → 1.1.0)'));
  const ruim = { plugins: [], log: [], raiz: '/r', falhar: [`install ${ID_PRINCIPAL}`] };
  const r = await passoPlugin(rodarFalso(ruim), ID_PRINCIPAL, 'claude-hadouken');
  assert.equal(r.entrada, null);
  assert.equal(r.item.estado, 'falhou');
  assert.equal(r.item.conserto, `rode claude plugin install ${ID_PRINCIPAL}`);
  const semLista = await passoPlugin(async () => ({ ok: false, motivo: 'erro', saida: '' }), ID_KIT, 'hadouken-kit');
  assert.deepEqual(semLista.item, item.falhou('hadouken-kit', 'claude plugin list falhou', 'rode claude plugin list'));
});

test('passoKit: o update do kit é seguido do install, que traz as dependências novas', async () => {
  const kitVelho = { id: ID_KIT, version: '1.0.1', scope: 'user', enabled: true, installPath: '/r/hadouken-kit' };
  const principal = { id: ID_PRINCIPAL, version: '0.5.2', scope: 'user', enabled: true, installPath: '/r/claude-hadouken' };
  const estado = { plugins: [kitVelho, principal], log: [], raiz: '/r' };
  const r = await passoKit(rodarFalso(estado));
  assert.deepEqual(r.item, item.ok('hadouken-kit', 'atualizado (1.0.1 → 1.1.0)'));
  assert.ok(estado.log.indexOf(`plugin install ${ID_KIT}`) > estado.log.indexOf(`plugin update ${ID_KIT}`));
  for (const d of DEPENDENCIAS_KIT) assert.equal(r.lista.get(d)?.enabled, true, d);
});

test('passoKit: dependência que não instala é ✗ com o nome dela; segunda rodada completa é =', async () => {
  const estado = { plugins: [], log: [], raiz: '/r', semDeps: ['poka-yoke@claude-hadouken'] };
  const r = await passoKit(rodarFalso(estado));
  assert.deepEqual(r.item, item.falhou('hadouken-kit', 'faltam dependências: poka-yoke', `rode claude plugin install ${ID_KIT}`));
  assert.equal(r.entrada.installPath, '/r/hadouken-kit', 'o kit em si instalou');
  const bom = { plugins: [], log: [], raiz: '/r' };
  await passoKit(rodarFalso(bom));
  const n = bom.log.length;
  assert.deepEqual((await passoKit(rodarFalso(bom))).item, item.igual('hadouken-kit'));
  assert.ok(!bom.log.slice(n).includes(`plugin install ${ID_KIT}`), 'nada falta: sem install a mais');
});

test('DEPENDENCIAS_KIT casa com o plugin.json do kit', () => {
  const kit = JSON.parse(fs.readFileSync(new URL('../kit/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.deepEqual(DEPENDENCIAS_KIT, kit.dependencies.map((d) => (typeof d === 'string' ? `${d}@claude-hadouken` : `${d.name}@${d.marketplace}`)));
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

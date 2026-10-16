import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aplicarLancar, aplicarMarketplace, aplicarPluginJson, aplicarTestado, aplicarVersaoRea, avisoPip, compararVersoes, decidir, lerSkill, montarRetrato,
  pastasDeSkills, proibidos, subirPatch, TERCEIROS, tituloIssue, tituloRecusa, xyz,
} from '../.github/scripts/kit-atualizar.mjs';
import { ENGINES_REA, VERSAO_REA } from '../rea/lancar.mjs';

// Robô semanal (spec v0.5.2, peça 3): funções puras, sem rede, e o workflow
// conferido pelo texto. As decisões partem de uma cópia congelada do
// testado.json (test/dados/kit-robo): o robô muda o de verdade, e estes testes
// rodam no ramo dele (revisão final, Important 3).

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const testado = JSON.parse(ler('test/dados/kit-robo/testado.json'));
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('TERCEIROS bate com as entradas do marketplace', () => {
  const m = JSON.parse(ler('.claude-plugin/marketplace.json'));
  for (const [nome, t] of Object.entries(TERCEIROS)) {
    const s = m.plugins.find((p) => p.name === nome)?.source;
    assert.ok(s, nome);
    assert.equal(s.source === 'github' ? s.repo : s.url, t.repo, nome);
    assert.equal(t.manifesto, s.path ? `${s.path}/.claude-plugin/plugin.json` : '.claude-plugin/plugin.json', nome);
    assert.ok(Object.hasOwn(testado.dependencias, `${nome}@claude-hadouken`), nome);
  }
});

test('xyz e compararVersoes', () => {
  assert.equal(xyz('1.4.0-beta'), '1.4.0');
  assert.equal(xyz('x'), null);
  assert.equal(compararVersoes('1.3.1', '1.3.1'), 'igual');
  assert.equal(compararVersoes('1.3.1', '1.3.2'), 'menor');
  assert.equal(compararVersoes('1.3.1', '1.4.0'), 'menor');
  assert.equal(compararVersoes('1.3.1', '2.0.0'), 'principal');
  assert.equal(compararVersoes('1.3.1', '1.3.0'), 'anterior');
  assert.equal(compararVersoes('1.3.1', '2.0.0-rc.1'), 'pre-release');
  assert.equal(compararVersoes('1.3.1', null), 'invalida');
});

test('decidir: só versão maior entra (menor ou principal); sha inválido, igual, anterior e pré-release ficam de fora', () => {
  const lidos = {
    terceiros: {
      'mattpocock-skills': { sha: SHA_A, versao: '1.4.0' },
      'poka-yoke': { sha: SHA_B, versao: '1.0.0' },
      'fullstack-dev-skills': { sha: 'curto', versao: '9.9.9' },
      'ui-ux-pro-max': { sha: SHA_A, versao: '2.13.0' },
    },
    rea: '6.1.0',
    reaEngines: ENGINES_REA,
  };
  assert.deepEqual(decidir(testado, lidos), {
    terceiros: [
      { nome: 'mattpocock-skills', de: '1.3.1', para: '1.4.0', sha: SHA_A, tipo: 'menor' },
      { nome: 'poka-yoke', de: '0.2.0', para: '1.0.0', sha: SHA_B, tipo: 'principal' },
    ],
    rea: null,
    recusas: [],
  });
  assert.deepEqual(decidir(testado, { terceiros: {}, rea: '6.2.0', reaEngines: ENGINES_REA }).rea, { de: '6.1.0', para: '6.2.0', tipo: 'menor' });
  assert.deepEqual(decidir(testado, { terceiros: { 'poka-yoke': null }, rea: '7.0.0-beta.1', reaEngines: ENGINES_REA }), { terceiros: [], rea: null, recusas: [] });
});

test('decidir: rea-agents novo que muda o engines é recusado (o instalador liga o REA por essa faixa)', () => {
  const d = decidir(testado, { terceiros: {}, rea: '6.2.0', reaEngines: '>=24.0.0' });
  assert.equal(d.rea, null);
  assert.deepEqual(d.recusas, ['rea-agents 6.2.0 (engines >=24.0.0)']);
  assert.deepEqual(decidir(testado, { terceiros: {}, rea: '6.2.0', reaEngines: null }).recusas, ['rea-agents 6.2.0 (engines ?)']);
  assert.equal(tituloRecusa(d.recusas), 'robô: recusado rea-agents 6.2.0 (engines >=24.0.0)');
});

// ------------------------------------------------------------ trava dos terceiros

const ARVORE = [
  '.claude-plugin/plugin.json', 'skills', 'skills/a', 'skills/a/SKILL.md', 'skills/b', 'skills/b/SKILL.md', 'skills/c/README.md',
  'plugins/p/.claude-plugin/plugin.json', 'plugins/p/skills/x/SKILL.md', 'plugins/p/hooks', 'plugins/p/hooks/hooks.json',
  'plugins/p/.mcp.json', 'plugins/p/bin/ferramenta',
];

test('proibidos: hooks, servidores MCP/LSP e bin na raiz do plugin, pelo arquivo ou pelo plugin.json', () => {
  assert.deepEqual(proibidos({ arvore: ARVORE, raiz: '', manifesto: { name: 'a' } }), []);
  assert.deepEqual(proibidos({ arvore: ARVORE, raiz: 'plugins/p', manifesto: {} }), ['.mcp.json', 'bin/', 'hooks/']);
  assert.deepEqual(proibidos({ arvore: ['.lsp.json'], raiz: '', manifesto: { hooks: './h.json', mcpServers: {}, lspServers: {} } }),
    ['.lsp.json', 'plugin.json hooks', 'plugin.json lspServers', 'plugin.json mcpServers']);
  assert.deepEqual(proibidos({ arvore: [], raiz: '', manifesto: null }), ['sem plugin.json']);
});

test('pastasDeSkills: skills/<x>/ mais o campo skills (pasta da skill ou pasta de skills, texto ou lista); só com SKILL.md', () => {
  assert.deepEqual(pastasDeSkills({ arvore: ARVORE, raiz: '', manifesto: {} }), ['skills/a', 'skills/b']);
  assert.deepEqual(pastasDeSkills({ arvore: [...ARVORE, 'extra/z/SKILL.md'], raiz: '', manifesto: { skills: ['./skills/b', './skills/c', '../fora/x', './extra/z'] } }), ['extra/z', 'skills/a', 'skills/b']);
  const uiux = ['.claude/skills/brand/SKILL.md', '.claude/skills/design/SKILL.md', 'cli/assets/skills/brand/SKILL.md'];
  assert.deepEqual(pastasDeSkills({ arvore: uiux, raiz: '', manifesto: { skills: './.claude/skills/' } }), ['.claude/skills/brand', '.claude/skills/design']);
  assert.deepEqual(pastasDeSkills({ arvore: ARVORE, raiz: 'plugins/p', manifesto: {} }), ['plugins/p/skills/x']);
});

test('lerSkill e montarRetrato: nome do frontmatter (ou da pasta), só do usuário pelo disable-model-invocation', () => {
  assert.deepEqual(lerSkill('---\nname: tdd\ndescription: x\n---\n', 'skills/eng/tdd'), { nome: 'tdd', soUsuario: false });
  assert.deepEqual(lerSkill('---\nname: wayfinder\ndisable-model-invocation: true\n---\n', 'skills/w'), { nome: 'wayfinder', soUsuario: true });
  assert.deepEqual(lerSkill('sem frontmatter', 'skills/eng/pasta'), { nome: 'pasta', soUsuario: false });
  const r = montarRetrato({ repo: 'mattpocock/skills', commit: SHA_A, versao: '1.4.0', skills: [{ nome: 'b', soUsuario: true }, { nome: 'a', soUsuario: false }] });
  assert.deepEqual(r, { fonte: 'github.com/mattpocock/skills', commit: SHA_A, versao: '1.4.0', skills: [{ nome: 'a', soUsuario: false }, { nome: 'b', soUsuario: true }] });
});

test('o retrato guardado do mattpocock-skills tem o formato de montarRetrato', () => {
  const r = JSON.parse(ler('test/dados/mattpocock-skills.json'));
  assert.deepEqual(montarRetrato({ repo: 'mattpocock/skills', commit: r.commit, versao: r.versao, skills: r.skills }), r);
});

test('subirPatch', () => {
  assert.equal(subirPatch('1.1.0'), '1.1.1');
  assert.equal(subirPatch('1.0.9'), '1.0.10');
  assert.throws(() => subirPatch('1.1'));
});

const DECISAO = {
  terceiros: [{ nome: 'mattpocock-skills', de: '1.3.1', para: '1.4.0', sha: SHA_A, tipo: 'menor' }],
  rea: { de: '6.1.0', para: '6.2.0', tipo: 'menor' },
};

test('aplicarMarketplace: troca o sha do terceiro e as versões do kit e do REA; o resto fica', () => {
  const antes = JSON.parse(ler('.claude-plugin/marketplace.json'));
  const depois = JSON.parse(aplicarMarketplace(ler('.claude-plugin/marketplace.json'), DECISAO, { kit: '1.1.1', rea: '1.0.2' }));
  const p = (m, n) => m.plugins.find((x) => x.name === n);
  assert.equal(p(depois, 'mattpocock-skills').source.sha, SHA_A);
  assert.equal(p(depois, 'hadouken-kit').version, '1.1.1');
  assert.equal(p(depois, 'hadouken-rea').version, '1.0.2');
  assert.deepEqual(p(depois, 'poka-yoke'), p(antes, 'poka-yoke'));
  assert.deepEqual(p(depois, 'claude-hadouken'), p(antes, 'claude-hadouken'));
  const semRea = JSON.parse(aplicarMarketplace(ler('.claude-plugin/marketplace.json'), { ...DECISAO, rea: null }, { kit: '1.1.1', rea: null }));
  assert.equal(p(semRea, 'hadouken-rea').version, p(antes, 'hadouken-rea').version);
  assert.throws(() => aplicarMarketplace(ler('.claude-plugin/marketplace.json'), { terceiros: [{ nome: 'nao-existe', sha: SHA_A }], rea: null }, { kit: '1.1.1' }));
});

test('aplicarTestado, aplicarLancar e aplicarPluginJson', () => {
  const t = JSON.parse(aplicarTestado(ler('test/dados/kit-robo/testado.json'), DECISAO));
  assert.equal(t.dependencias['mattpocock-skills@claude-hadouken'], '1.4.0');
  assert.equal(t.dependencias['poka-yoke@claude-hadouken'], '0.2.0');
  assert.equal(t.npm['rea-agents'], '6.2.0');
  assert.equal(t.pip.graphifyy, '0.9.25');
  const lancar = aplicarLancar(ler('rea/lancar.mjs'), '99.0.0');
  assert.match(lancar, /export const VERSAO_REA = '99\.0\.0';/);
  assert.equal(lancar.replace("'99.0.0'", `'${VERSAO_REA}'`), ler('rea/lancar.mjs'), 'só a constante muda');
  assert.throws(() => aplicarLancar('sem a constante', '6.2.0'));
  assert.throws(() => aplicarLancar("export const VERSAO_REA = '1.0.0';\nexport const VERSAO_REA = '1.0.0';", '6.2.0'));
  assert.equal(JSON.parse(aplicarPluginJson(ler('kit/.claude-plugin/plugin.json'), '1.1.1')).version, '1.1.1');
});

test('aplicarVersaoRea: troca rea-agents@x e "rea-agents x" e nada mais', () => {
  const t = 'npx -y rea-agents@6.1.0 mcp; pinned to rea-agents 6.1.0. Outro 6.1.0 e rea-agents@6.1.01 ficam.';
  assert.equal(aplicarVersaoRea(t, '6.1.0', '6.2.0'), 'npx -y rea-agents@6.2.0 mcp; pinned to rea-agents 6.2.0. Outro 6.1.0 e rea-agents@6.1.01 ficam.');
  for (const rel of ['README.md', 'README.en.md', 'SECURITY.md', 'rea/.claude-plugin/plugin.json', 'rea/lancar.mjs']) {
    assert.ok(ler(rel).includes(`rea-agents@${VERSAO_REA}`) || ler(rel).includes(`rea-agents ${VERSAO_REA}`), rel);
  }
});

test('tituloIssue e avisoPip', () => {
  assert.equal(tituloIssue(DECISAO), 'robô: mattpocock-skills 1.3.1 → 1.4.0, rea-agents 6.1.0 → 6.2.0');
  assert.equal(avisoPip(testado, '0.9.25'), null);
  assert.equal(avisoPip(testado, '0.9.26'), 'robô: graphifyy 0.9.26 no pip (o kit testa 0.9.25)');
  assert.equal(avisoPip(testado, null), null);
});

// ------------------------------------------------------------ workflow

const WF = ler('.github/workflows/kit-atualizar.yml');

test('workflow: segunda 09:17, sob demanda, permissões vazias no topo e uma fila só', () => {
  assert.match(WF, /cron: '17 9 \* \* 1'/);
  assert.match(WF, /workflow_dispatch:/);
  assert.match(WF, /^permissions: \{\}$/m);
  assert.match(WF, /^concurrency:\n {2}group: kit-atualizar\n {2}cancel-in-progress: false$/m);
});

test('workflow: cada job declara as próprias permissões, e só o necessário', () => {
  // Só depois de jobs: (o schedule: de on: também tem 2 espaços).
  const jobs = WF.split(/^jobs:$/m)[1].split(/^ {2}(?=[a-z-]+:$)/m).slice(1);
  const perm = Object.fromEntries(jobs.map((j) => [j.split(':')[0], /permissions:\n((?: {6}.+\n)+)/.exec(j)?.[1].trim().split(/\n\s*/) ?? null]));
  assert.deepEqual(perm, {
    preparar: ['contents: write'], testar: ['contents: read'], publicar: ['contents: write'],
    avisar: ['issues: write'], 'avisar-pip': ['issues: write'], 'avisar-recusa': ['issues: write'],
  });
});

test('workflow: ações fixadas por sha, checkout sem credencial guardada, cache do setup-node desligado', () => {
  const usos = [...WF.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(usos.length >= 4);
  for (const u of usos) assert.match(u, /@[0-9a-f]{40}$/, u);
  assert.equal([...WF.matchAll(/actions\/checkout@/g)].length, [...WF.matchAll(/persist-credentials: false/g)].length);
  assert.equal([...WF.matchAll(/actions\/setup-node@/g)].length, [...WF.matchAll(/package-manager-cache: false/g)].length);
});

test('workflow: matriz de 3 sistemas × Node 20, 22 e 24 antes de publicar', () => {
  assert.match(WF, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(WF, /node: \[20, 22, 24\]/);
  assert.match(WF, /publicar:\n(?: {4}.*\n)*? {4}needs: \[preparar, testar\]/);
  assert.match(WF, /needs\.testar\.result == 'success'/);
  assert.match(WF, /merge-base --is-ancestor/);
});

test('workflow: nenhum ${{ }} dentro de run', () => {
  const linhas = WF.split('\n');
  let dentro = -1;
  for (const l of linhas) {
    const recuo = l.length - l.trimStart().length;
    if (dentro >= 0 && l.trim() !== '' && recuo <= dentro) dentro = -1;
    const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(l);
    if (m) {
      assert.ok(!m[2].includes('${{'), l);
      if (m[2] === '|') dentro = m[1].length;
      continue;
    }
    if (dentro >= 0) assert.ok(!l.includes('${{'), l);
  }
});

test('workflow: o ramo leva os retratos e os textos com a versão do REA; recusa vira issue', () => {
  const add = /git add (.+)/.exec(WF)[1];
  for (const a of ['kit/testado.json', 'rea/lancar.mjs', 'README.md', 'README.en.md', 'SECURITY.md', 'test/dados/*.json']) assert.ok(add.split(' ').includes(a), a);
  assert.match(WF, /recusa: \$\{\{ steps\.robo\.outputs\.recusa \}\}/);
  assert.match(WF, /avisar-recusa:\n(?: {4}.*\n)*? {4}if: needs\.preparar\.outputs\.recusa != ''/);
});

test('o aviso semanal antigo saiu', () => {
  for (const rel of ['.github/scripts/kit-versoes.mjs', '.github/workflows/kit-versoes.yml', 'test/kit-versoes.test.js']) {
    assert.equal(fs.existsSync(path.join(repo, rel)), false, rel);
  }
});

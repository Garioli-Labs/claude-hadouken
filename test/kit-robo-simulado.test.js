import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// O robô de ponta a ponta, sem rede (revisão final, Important 3): numa cópia
// do repositório, gravarDecisao aplica uma versão nova do mattpocock-skills e
// do rea-agents, com o retrato regerado no sha novo (mesmas skills), e os
// testes do kit e do REA da cópia têm de passar. Antes, 7 deles fixavam
// versões e sha, e o ramo do robô nunca ficava verde.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pastas = [];
after(() => { for (const d of pastas) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
const FORA = new Set(['.git', 'node_modules', '.superpowers', 'docs']);

test('o ramo do robô passa nos testes do kit e do REA', { timeout: 180_000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk robo '));
  pastas.push(d);
  fs.cpSync(repo, d, { recursive: true, filter: (o) => !FORA.has(path.relative(repo, o).split(path.sep)[0]) });
  const m = await import(pathToFileURL(path.join(d, '.github', 'scripts', 'kit-atualizar.mjs')).href);
  const ler = (rel) => JSON.parse(fs.readFileSync(path.join(d, rel), 'utf8'));
  const sha = 'a'.repeat(40);
  const de = ler('kit/testado.json');
  const reaDe = de.npm['rea-agents'];
  const [x, y] = reaDe.split('.');
  const decisao = {
    terceiros: [{ nome: 'mattpocock-skills', de: de.dependencias['mattpocock-skills@claude-hadouken'], para: '99.0.0', sha, tipo: 'principal' }],
    rea: { de: reaDe, para: `${x}.${Number(y) + 1}.0`, tipo: 'menor' },
    recusas: [],
  };
  const retrato = { ...ler('test/dados/mattpocock-skills.json'), commit: sha, versao: '99.0.0' };
  const versoes = m.gravarDecisao(d, decisao, { 'mattpocock-skills': retrato });
  assert.equal(ler('kit/.claude-plugin/plugin.json').version, versoes.kit);
  assert.match(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), new RegExp(`rea-agents@${decisao.rea.para.replaceAll('.', '\\.')}`));
  const arquivos = fs.readdirSync(path.join(d, 'test')).filter((n) => /^(kit-(?!robo-simulado)|rea-).*\.test\.js$/.test(n)).map((n) => path.join('test', n));
  const r = spawnSync(process.execPath, ['--test', ...arquivos], { cwd: d, encoding: 'utf8', timeout: 170_000 });
  assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => /^(not ok|✖)|message:|expected|actual/.test(l.trim())).join('\n'));
});

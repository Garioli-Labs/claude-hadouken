import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const allow = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'))
  .allowCrossMarketplaceDependenciesOn;

const REPO_DO = {
  'claude-plugins-official': 'anthropics/claude-plugins-official', mattpocock: 'mattpocock/skills',
  'poka-yoke': 'rainmanjam/poka-yoke', 'clean-architecture-skills': 'nathankim0/clean-architecture-skills',
  'fullstack-dev-skills': 'jeffallan/claude-skills', 'ui-ux-pro-max-skill': 'nextlevelbuilder/ui-ux-pro-max-skill',
};

for (const arq of ['README.md', 'README.en.md']) {
  test(`${arq}: um marketplace add para cada marketplace da allowlist, antes do install do kit`, () => {
    const t = fs.readFileSync(path.join(repo, arq), 'utf8');
    const install = t.indexOf('claude plugin install hadouken-kit@claude-hadouken');
    assert.ok(install > 0);
    for (const m of allow) {
      const i = t.indexOf(`claude plugin marketplace add ${REPO_DO[m]}`);
      assert.ok(i > 0 && i < install, m);
    }
    const bloco = t.slice(t.lastIndexOf('```bash', install), install);
    assert.equal(bloco.match(/claude plugin marketplace add /g).length, allow.length, 'nenhum marketplace add sobrando');
    assert.match(t, /claude plugin enable hadouken-rea@claude-hadouken/);
    assert.match(t, /rea-agents@6\.1\.0/);
  });
}

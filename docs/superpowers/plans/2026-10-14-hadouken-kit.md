# hadouken-kit e hadouken-rea — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o marketplace `claude-hadouken` passa a oferecer mais dois plugins: o `hadouken-kit` (instala o conjunto de skills do dia a dia e diz qual usar em cada etapa) e o `hadouken-rea` (o MCP do REA, desligado por padrão).

**Arquitetura:** o kit é um plugin de pacote. O `plugin.json` dele declara `dependencies` em seis plugins de outros marketplaces, liberados pelo `allowCrossMarketplaceDependenciesOn` do `marketplace.json` raiz. Ele leva três skills (`fluxo`, `yu-ux-web-expert` e `graphify`) e um hook `SessionStart` que só imprime uma constante. O `hadouken-rea` é um plugin com `defaultEnabled: false`. Um lançador Node de poucas linhas abre o `npx -y rea-agents@6.1.0 mcp`, porque no Windows o `npx` precisa do `cmd.exe /d /c`. A rede de verificação de versões fica num workflow semanal do GitHub Actions, nunca no plugin.

**Tecnologia:** Node ≥ 20 sem dependências (como o resto do repositório), `node --test`, JSON de manifesto do Claude Code 2.1.300 e GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-09-hadouken-kit-design.md` (branch `hadouken-kit`). O plano argumenta a partir dele: leia os dois.

**Branch e pasta:** `hadouken-kit`, na worktree `C:\Projetos DEV\Claude Hadouken\claude-hadouken-guarda`. A base é `94334d6`, que sai de `ac15238`, a ponta do `v0.4.0-guarda`. O merge na `main` só acontece depois da v0.4.0.

## Restrições globais

- `claude-hadouken` não muda: nenhum arquivo em `src/`, `hooks/`, `skills/`, `vscode/` nem `.claude-plugin/plugin.json`. A única exceção é `.claude-plugin/marketplace.json`, que ganha entradas (spec §2, §10).
- Pastas: `./kit/` (versão `1.0.0`) e `./rea/` (versão `1.0.0`). Os nomes são exatamente `hadouken-kit` e `hadouken-rea`.
- Allowlist, verbatim: `["claude-plugins-official", "mattpocock", "poka-yoke", "clean-architecture-skills", "fullstack-dev-skills", "ui-ux-pro-max-skill"]`.
- Dependências do kit, sem faixa de versão: `claude-hadouken` (mesmo marketplace, string pura) e os pares `{ name, marketplace }` `superpowers`/`claude-plugins-official`, `mattpocock-skills`/`mattpocock`, `poka-yoke`/`poka-yoke`, `clean-architecture`/`clean-architecture-skills`, `fullstack-dev-skills`/`fullstack-dev-skills` e `ui-ux-pro-max`/`ui-ux-pro-max-skill` (conferidos em `installed_plugins.json` em 2026-10-14).
- REA: `rea-agents@6.1.0` com versão exata, nunca `@latest`. Requer Node 22.19+, 24.11+ ou 26+. `defaultEnabled: false`.
- `kit/hooks/fluxo.js` não lê stdin nem arquivos, e não importa `fs`, `child_process`, `net`, `http`, `https` nem `dgram`. Imprime no máximo 5 linhas e 700 caracteres de `additionalContext`.
- graphify: cópia do texto do `graphifyy` 0.9.25, com `LICENSE-MIT` e `NOTICE` do autor (safishamsi/graphify, tag `v0.9.25`). A primeira linha depois do frontmatter avisa que a skill requer `pip install graphifyy==0.9.25`.
- yu-ux-web-expert: vai inteira, mas sem `vendor/node_modules/` e sem `scripts/__pycache__/`. Leva `ATTRIBUTIONS.md`.
- Rede só no workflow do Actions. Nada do kit nem do rea fala com a rede em teste.
- Textos com acento só pela ferramenta Write ou por Python com utf-8 e LF. Commits com pathspec explícito. Comunicação em português; o Sr. Garioli é tratado assim.

## Desvios do spec (para o Sr. Garioli conferir)

1. **Lançador do REA (`rea/lancar.mjs`)**. O spec põe `"command": "npx"` direto no `.mcp.json`. A instalação oficial do REA (docs/installation.md, conferido em 2026-10-14) manda, no Windows nativo, `cmd.exe /d /c npx -y rea-agents@<v> mcp`, porque `npx` é `npx.cmd` e não abre sem shell. Como um `.mcp.json` não varia por sistema, entra um lançador de ~25 linhas. Ele escolhe o comando pela plataforma, com argumentos fixos, e repassa stdio. Custo: o rea passa a ter código próprio (processo filho), coberto por teste.
2. **Marketplaces de terceiros precisam estar adicionados antes**. A documentação oficial (troubleshooting, "Dependency errors") diz que uma dependência cujo marketplace não está registrado fica `is not installed`. O Claude Code não adiciona marketplace sozinho. O README ganha os seis `claude plugin marketplace add` antes do `install` (Task 5).
3. **Versão do REA**: o npm já tem a 6.5.0 (publicada hoje, uma major por dia desde 07/10). Fica a 6.1.0 do spec. O `testado.json` registra `rea-agents` também, para o aviso semanal pegar a deriva.

## Foco da revisão

Cinco entradas que o spec implica e que nenhum teste de tarefa cobriria sozinho, da mais provável à menos:

1. **Windows com caminho com espaço** (`C:\Users\Lucas Garioli\...`): o hook do kit e o lançador do rea precisam funcionar com `${CLAUDE_PLUGIN_ROOT}` com espaço. Usar a forma exec (`command` + `args`) e testar com uma pasta temporária com espaço (Task 2 e Task 1).
2. **Usuário sem um dos marketplaces**: o install do kit completa e o kit fica desligado sem explicação. O README lista os seis `marketplace add`, e um teste confere que a lista do README é a mesma do allowlist (Task 5).
3. **yu-ux rodada a partir de outro cwd**: no kit, `bash scripts/setup.sh` só funciona com o cwd na pasta da skill. O SKILL.md copiado ganha a linha com `${CLAUDE_PLUGIN_ROOT}/skills/yu-ux-web-expert/`, e um teste confere que ela existe (Task 3).
4. **Atualização do kit apaga `vendor/node_modules`**: o `setup.sh` grava dentro de `${CLAUDE_PLUGIN_ROOT}`, que muda a cada versão. Ele é idempotente e reinstala, então a perda é de tempo, não de função. Isso fica declarado no README (Task 5), sem mudar o script.
5. **Nome de skill errado na tabela do fluxo**: uma skill citada que não existe faz o Claude procurar e não achar. Teste contra a lista fixa conferida (Task 2).

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `.claude-plugin/marketplace.json` | 3 entradas + allowlist | 1 |
| `kit/.claude-plugin/plugin.json` | manifesto e dependências do kit | 1 |
| `kit/testado.json` | versão testada de cada dependência e do rea-agents | 1 |
| `rea/.claude-plugin/plugin.json` | manifesto do rea, `defaultEnabled: false` | 1 |
| `rea/.mcp.json` | servidor `rea` → `node ${CLAUDE_PLUGIN_ROOT}/lancar.mjs` | 1 |
| `rea/lancar.mjs` | escolhe `npx`/`cmd.exe` e repassa stdio | 1 |
| `test/kit-manifestos.test.js` | consistência do marketplace, kit, rea e testado.json | 1 |
| `test/rea-lancar.test.js` | comando por plataforma e versão fixa | 1 |
| `kit/hooks/hooks.json` | `SessionStart` → `fluxo.js` | 2 |
| `kit/hooks/fluxo.js` | imprime o JSON fixo | 2 |
| `kit/skills/fluxo/SKILL.md` | a tabela "qual skill agora" | 2 |
| `test/kit-fluxo.test.js` | saída do hook, fronteira e nomes da tabela | 2 |
| `kit/skills/yu-ux-web-expert/**` | cópia da skill pessoal | 3 |
| `kit/skills/graphify/**` | cópia + `LICENSE-MIT` + `NOTICE` | 3 |
| `test/kit-copias.test.js` | licenças, exclusões e linhas de cabeçalho | 3 |
| `.github/scripts/kit-versoes.mjs` | lê versões publicadas e compara com o testado | 4 |
| `.github/workflows/kit-versoes.yml` | agenda semanal + `workflow_dispatch` | 4 |
| `test/kit-versoes.test.js` | comparação pura, sem rede | 4 |
| `README.md`, `README.en.md`, `SECURITY.md` | seção do kit e do rea | 5 |
| `test/kit-readme.test.js` | marketplaces do README = allowlist | 5 |

---

### Task 1: Manifestos, marketplace e lançador do REA

**Arquivos:**
- Modificar: `.claude-plugin/marketplace.json`
- Criar: `kit/.claude-plugin/plugin.json`, `kit/testado.json`, `rea/.claude-plugin/plugin.json`, `rea/.mcp.json`, `rea/lancar.mjs`
- Testes: `test/kit-manifestos.test.js`, `test/rea-lancar.test.js`

**Interfaces:**
- Produz: `rea/lancar.mjs` exporta `VERSAO_REA = '6.1.0'` e `comandoRea(plataforma, env) → { comando: string, args: string[] }`. Ao rodar como programa, ele abre o filho e repassa a saída. `kit/testado.json` tem a forma `{ "dependencias": { "<nome>@<marketplace>": "<versão>" }, "npm": { "rea-agents": "6.1.0" } }`.

- [ ] **Step 1: Escrever os testes que falham**

`test/kit-manifestos.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));

const ALLOW = ['claude-plugins-official', 'mattpocock', 'poka-yoke',
  'clean-architecture-skills', 'fullstack-dev-skills', 'ui-ux-pro-max-skill'];

test('marketplace: três entradas, cada uma aponta para pasta com plugin.json de mesmo nome', () => {
  const m = ler('.claude-plugin/marketplace.json');
  assert.deepEqual(m.plugins.map((p) => p.name).sort(),
    ['claude-hadouken', 'hadouken-kit', 'hadouken-rea']);
  for (const p of m.plugins) {
    const man = ler(path.join(p.source, '.claude-plugin', 'plugin.json'));
    assert.equal(man.name, p.name, p.source);
    assert.equal(man.version, p.version, `${p.name}: versão do marketplace = do plugin.json`);
  }
});

test('marketplace: allowlist exata e toda dependência com marketplace está nela', () => {
  const m = ler('.claude-plugin/marketplace.json');
  assert.deepEqual(m.allowCrossMarketplaceDependenciesOn, ALLOW);
  const kit = ler('kit/.claude-plugin/plugin.json');
  for (const d of kit.dependencies) {
    if (typeof d === 'object' && d.marketplace) assert.ok(ALLOW.includes(d.marketplace), d.name);
  }
});

test('kit: dependências exatas e sem faixa de versão', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.equal(kit.name, 'hadouken-kit');
  assert.equal(kit.version, '1.0.0');
  assert.deepEqual(kit.dependencies, [
    'claude-hadouken',
    { name: 'superpowers', marketplace: 'claude-plugins-official' },
    { name: 'mattpocock-skills', marketplace: 'mattpocock' },
    { name: 'poka-yoke', marketplace: 'poka-yoke' },
    { name: 'clean-architecture', marketplace: 'clean-architecture-skills' },
    { name: 'fullstack-dev-skills', marketplace: 'fullstack-dev-skills' },
    { name: 'ui-ux-pro-max', marketplace: 'ui-ux-pro-max-skill' },
  ]);
  for (const d of kit.dependencies) if (typeof d === 'object') assert.equal(d.version, undefined, d.name);
});

test('kit: o REA não é dependência do kit (dependência sobe sempre ligada)', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.ok(!JSON.stringify(kit.dependencies).includes('rea'));
});

test('testado.json: uma versão para cada dependência, e nenhuma sobrando', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  const t = ler('kit/testado.json');
  const chaves = kit.dependencies.map((d) =>
    typeof d === 'string' ? `${d}@claude-hadouken` : `${d.name}@${d.marketplace}`).sort();
  assert.deepEqual(Object.keys(t.dependencias).sort(), chaves);
  for (const v of Object.values(t.dependencias)) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(t.npm['rea-agents'], '6.1.0');
});

test('rea: desligado por padrão, MIT, e o .mcp.json abre o lançador com node', () => {
  const r = ler('rea/.claude-plugin/plugin.json');
  assert.equal(r.name, 'hadouken-rea');
  assert.equal(r.version, '1.0.0');
  assert.equal(r.defaultEnabled, false);
  assert.equal(r.license, 'MIT');
  assert.match(r.description, /permiss/i);
  const mcp = ler('rea/.mcp.json');
  assert.deepEqual(mcp, { mcpServers: { rea: {
    command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/lancar.mjs'] } } });
});

test('claude-hadouken intocado: plugin.json segue 0.4.0', () => {
  assert.equal(ler('.claude-plugin/plugin.json').version, '0.4.0');
});
```

`test/rea-lancar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { comandoRea, VERSAO_REA } from '../rea/lancar.mjs';

test('versão exata, nunca latest', () => {
  assert.equal(VERSAO_REA, '6.1.0');
  const texto = fs.readFileSync(new URL('../rea/lancar.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(texto, /@latest/);
});

test('Linux e macOS: npx direto', () => {
  for (const pl of ['linux', 'darwin']) {
    assert.deepEqual(comandoRea(pl, {}), {
      comando: 'npx', args: ['-y', 'rea-agents@6.1.0', 'mcp'] });
  }
});

test('Windows: cmd.exe por caminho absoluto, /d /c, mesmos argumentos', () => {
  const r = comandoRea('win32', { SystemRoot: 'C:\\Windows' });
  assert.equal(r.comando, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(r.args, ['/d', '/c', 'npx', '-y', 'rea-agents@6.1.0', 'mcp']);
});

test('Windows sem SystemRoot: cai em C:\\Windows, nunca no cmd do PATH', () => {
  assert.equal(comandoRea('win32', {}).comando, 'C:\\Windows\\System32\\cmd.exe');
});

test('nada do ambiente entra nos argumentos', () => {
  const r = comandoRea('linux', { REA_VERSAO: '9.9.9', npm_config_tag: 'latest' });
  assert.deepEqual(r.args, ['-y', 'rea-agents@6.1.0', 'mcp']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-manifestos.test.js test/rea-lancar.test.js`
Expected: FAIL (arquivos ausentes: `ENOENT` e `Cannot find module '../rea/lancar.mjs'`).

- [ ] **Step 3: Escrever os manifestos**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "claude-hadouken",
  "owner": { "name": "Garioli Labs" },
  "allowCrossMarketplaceDependenciesOn": ["claude-plugins-official", "mattpocock", "poka-yoke", "clean-architecture-skills", "fullstack-dev-skills", "ui-ux-pro-max-skill"],
  "plugins": [
    { "name": "claude-hadouken", "source": "./", "description": "Usage-aware pacing for Claude Code.", "version": "0.4.0" },
    { "name": "hadouken-kit", "source": "./kit", "description": "The daily skill set (superpowers, Matt Pocock, poka-yoke, clean architecture, fullstack, UI/UX) plus a map of which skill to use at each step.", "version": "1.0.0" },
    { "name": "hadouken-rea", "source": "./rea", "description": "REA reverse-engineering MCP server. Off by default; it runs analyzed programs with your permissions.", "version": "1.0.0" }
  ]
}
```

`kit/.claude-plugin/plugin.json`:

```json
{
  "name": "hadouken-kit",
  "displayName": "Hadouken Kit",
  "version": "1.0.0",
  "description": "One install for the daily skill set, plus the hadouken-kit:fluxo map of which skill to use at each step.",
  "author": { "name": "Lucas Garioli", "url": "https://github.com/Garioli-Labs" },
  "homepage": "https://github.com/Garioli-Labs/claude-hadouken",
  "license": "MIT",
  "dependencies": [
    "claude-hadouken",
    { "name": "superpowers", "marketplace": "claude-plugins-official" },
    { "name": "mattpocock-skills", "marketplace": "mattpocock" },
    { "name": "poka-yoke", "marketplace": "poka-yoke" },
    { "name": "clean-architecture", "marketplace": "clean-architecture-skills" },
    { "name": "fullstack-dev-skills", "marketplace": "fullstack-dev-skills" },
    { "name": "ui-ux-pro-max", "marketplace": "ui-ux-pro-max-skill" }
  ]
}
```

`kit/testado.json`, com as versões instaladas e conferidas em 2026-10-14. O hadouken entra como 0.4.0, a versão do branch, e o superpowers como a 6.4.1 do cache:

```json
{
  "dependencias": {
    "claude-hadouken@claude-hadouken": "0.4.0",
    "superpowers@claude-plugins-official": "6.4.1",
    "mattpocock-skills@mattpocock": "1.2.0",
    "poka-yoke@poka-yoke": "0.2.0",
    "clean-architecture@clean-architecture-skills": "1.0.0",
    "fullstack-dev-skills@fullstack-dev-skills": "0.4.16",
    "ui-ux-pro-max@ui-ux-pro-max-skill": "2.13.0"
  },
  "npm": { "rea-agents": "6.1.0" }
}
```

`rea/.claude-plugin/plugin.json`:

```json
{
  "name": "hadouken-rea",
  "displayName": "Hadouken REA",
  "version": "1.0.0",
  "description": "REA (Reverse Engineer Anything) MCP server, pinned to rea-agents 6.1.0. Off by default: REA runs the programs it analyzes with your user's permissions. Needs Node 22.19+, 24.11+ or 26+.",
  "author": { "name": "Lucas Garioli", "url": "https://github.com/Garioli-Labs" },
  "homepage": "https://github.com/Garioli-Labs/claude-hadouken",
  "license": "MIT",
  "defaultEnabled": false
}
```

`rea/.mcp.json`:

```json
{ "mcpServers": { "rea": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/lancar.mjs"] } } }
```

- [ ] **Step 4: Escrever o lançador**

`rea/lancar.mjs`:

```js
// Abre o MCP do REA com versão fixa. No Windows o npx é npx.cmd e só abre
// por cmd.exe (instrução oficial do REA: cmd.exe /d /c npx ...). O cmd.exe vem
// por caminho absoluto, nunca pelo PATH. Argumentos fixos: nada do ambiente
// entra neles. stdio herdado: o protocolo MCP passa direto.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSAO_REA = '6.1.0';
const ARGS = ['-y', `rea-agents@${VERSAO_REA}`, 'mcp'];

export function comandoRea(plataforma, env) {
  if (plataforma === 'win32') {
    const raiz = env.SystemRoot || 'C:\\Windows';
    return { comando: path.win32.join(raiz, 'System32', 'cmd.exe'), args: ['/d', '/c', 'npx', ...ARGS] };
  }
  return { comando: 'npx', args: [...ARGS] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { comando, args } = comandoRea(process.platform, process.env);
  const filho = spawn(comando, args, { stdio: 'inherit', windowsHide: true });
  filho.on('error', (e) => { process.stderr.write(`hadouken-rea: ${e.message}\n`); process.exit(1); });
  filho.on('exit', (codigo, sinal) => process.exit(sinal ? 1 : (codigo ?? 1)));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => filho.kill(s));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/kit-manifestos.test.js test/rea-lancar.test.js`
Expected: PASS, 12 testes.

- [ ] **Step 6: Validar com o CLI e rodar a suíte inteira**

Run: `claude plugin validate ./kit` e `claude plugin validate ./rea`
Expected: `Validation passed` nos dois. No kit, um aviso sobre `skills/` ainda vazio é aceitável até a Task 3. Copie a saída para o relato.

Run: `claude plugin validate .`
Expected: o erro de nome reservado (`Plugin name "claude-hadouken" is reserved`), que já existe antes da mudança: o Claude Code instala e carrega mesmo assim (documentação, campo `name`). Compare com o mesmo comando no `main`. Qualquer erro **novo** (fonte relativa, allowlist, entrada de marketplace): pare e relate.

Run: `node --test`
Expected: PASS, mesmas contagens da v0.4.0 mais os testes novos.

- [ ] **Step 7: Commit**

```bash
git add .claude-plugin/marketplace.json kit/.claude-plugin/plugin.json kit/testado.json rea/.claude-plugin/plugin.json rea/.mcp.json rea/lancar.mjs test/kit-manifestos.test.js test/rea-lancar.test.js
git commit -m "feat(kit): hadouken-kit and hadouken-rea manifests, cross-marketplace allowlist, REA launcher pinned to 6.1.0"
```

---

### Task 2: Skill `fluxo` e hook de início de sessão

**Arquivos:**
- Criar: `kit/hooks/hooks.json`, `kit/hooks/fluxo.js`, `kit/skills/fluxo/SKILL.md`
- Teste: `test/kit-fluxo.test.js`

**Interfaces:**
- Consome: nada da Task 1 além da pasta `kit/`.
- Produz: o `fluxo.js` imprime `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<texto>"}}` e sai 0.

- [ ] **Step 1: Escrever o teste que falha**

`test/kit-fluxo.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FLUXO = path.join(repo, 'kit', 'hooks', 'fluxo.js');

// Lista conferida em 2026-10-14 contra o cache instalado (superpowers 6.4.1,
// mattpocock-skills 1.2.0, poka-yoke 0.2.0) e as skills do próprio kit.
const EXISTENTES = new Set([
  'superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:subagent-driven-development',
  'superpowers:executing-plans', 'superpowers:test-driven-development', 'superpowers:systematic-debugging',
  'superpowers:requesting-code-review',
  'mattpocock-skills:grill-with-docs', 'mattpocock-skills:prototype', 'mattpocock-skills:handoff',
  'mattpocock-skills:to-spec', 'mattpocock-skills:to-tickets', 'mattpocock-skills:wayfinder',
  'mattpocock-skills:diagnosing-bugs', 'mattpocock-skills:code-review',
  'mattpocock-skills:improve-codebase-architecture', 'mattpocock-skills:ask-matt',
  'poka-yoke:retro', 'hadouken-kit:yu-ux-web-expert', 'hadouken-kit:graphify', 'hadouken-kit:fluxo',
]);

function rodar(cwd, input = '') {
  return spawnSync(process.execPath, [FLUXO], { cwd, input, encoding: 'utf8', timeout: 5000 });
}

test('fluxo.js: sai 0 com stdin vazio e imprime JSON de SessionStart', () => {
  const r = rodar(repo);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  const t = j.hookSpecificOutput.additionalContext;
  assert.ok(t.length <= 700, `${t.length} caracteres`);
  assert.ok(t.split('\n').length <= 5);
  assert.match(t, /superpowers:brainstorming/);
  assert.match(t, /hadouken-kit:fluxo/);
});

test('fluxo.js: mesma saída com stdin de verdade e com cwd com espaço', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit fluxo '));
  try {
    const a = rodar(repo).stdout;
    const b = rodar(tmp, JSON.stringify({ session_id: 'x', source: 'startup' })).stdout;
    assert.equal(a, b);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('fluxo.js: fronteira estática (spec §5.2)', () => {
  const texto = fs.readFileSync(FLUXO, 'utf8');
  assert.doesNotMatch(texto, /\b(?:import|require)\b[^\n]*['"](?:node:)?(?:fs|child_process|net|http|https|dgram)(?:\/[^'"]*)?['"]/);
  assert.doesNotMatch(texto, /process\.stdin|readFileSync|process\.env/);
});

test('hooks.json: SessionStart em forma exec com args e timeout 5', () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, 'kit', 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(h.hooks), ['SessionStart']);
  const c = h.hooks.SessionStart[0].hooks[0];
  assert.deepEqual(c, { type: 'command', command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/hooks/fluxo.js'], timeout: 5 });
});

test('SKILL fluxo: todo plugin:skill citado existe', () => {
  const s = fs.readFileSync(path.join(repo, 'kit', 'skills', 'fluxo', 'SKILL.md'), 'utf8');
  const citados = [...s.matchAll(/`([a-z0-9-]+:[a-z0-9-]+)`/g)].map((m) => m[1]);
  assert.ok(citados.length >= 15);
  for (const c of citados) assert.ok(EXISTENTES.has(c) || c.startsWith('poka-yoke:'), c);
});

test('o resumo do hook e a skill citam só nomes existentes', () => {
  const t = JSON.parse(rodar(repo).stdout).hookSpecificOutput.additionalContext;
  for (const m of t.matchAll(/([a-z0-9-]+:[a-z0-9-]+)/g)) assert.ok(EXISTENTES.has(m[1]), m[1]);
});
```

A tabela do spec cita `poka-yoke:*` (curinga). O teste aceita qualquer `poka-yoke:` e `security-review`, que é comando embutido e não aparece entre crases com dois-pontos.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-fluxo.test.js`
Expected: FAIL (`fluxo.js` ausente; `spawnSync` devolve status 1 com `Cannot find module`).

- [ ] **Step 3: Escrever o hook**

`kit/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/fluxo.js"], "timeout": 5 } ] }
    ]
  }
}
```

`kit/hooks/fluxo.js`:

```js
// SessionStart do hadouken-kit (spec §5.2): só imprime uma constante.
// Não lê stdin, arquivo nem ambiente; não importa módulo nenhum.
// ~540 caracteres; o teste exige no máximo 700 e 5 linhas.
const TEXTO = [
  'hadouken-kit: ideia → superpowers:brainstorming; plano → superpowers:writing-plans; execução → superpowers:subagent-driven-development; bug → superpowers:systematic-debugging.',
  'O superpowers cuida do processo; o Matt Pocock só onde ele não cobre (mattpocock-skills:prototype, mattpocock-skills:wayfinder).',
  'Web: hadouken-kit:yu-ux-web-expert. Grafo do código: hadouken-kit:graphify.',
  'Antes de etapa cara (revisor Fable, muitos subagentes, Workflow), leia a linha de consumo do hadouken.',
  'Tabela completa e desempates: skill hadouken-kit:fluxo.',
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: TEXTO },
}));
```

- [ ] **Step 4: Escrever a skill**

`kit/skills/fluxo/SKILL.md` (pela ferramenta Write, utf-8, LF):

```markdown
---
name: fluxo
description: Qual skill usar agora — o mapa do hadouken-kit entre superpowers, Matt Pocock, poka-yoke e as especialidades. Use quando a dúvida for "qual skill/etapa agora", quando duas skills parecerem servir para a mesma coisa, ou ao começar trabalho novo.
---

# Fluxo do hadouken-kit

Regra: o **superpowers** cuida do processo. O **Matt Pocock** entra onde o superpowers não tem equivalente. Cada duplicata tem um dono só.

| Etapa | Use | A outra, só quando |
|---|---|---|
| Ideia nebulosa | `superpowers:brainstorming` | `mattpocock-skills:grill-with-docs` quando o projeto tem glossário/ADRs a atualizar durante a conversa |
| Falar não resolve | `mattpocock-skills:prototype` + `mattpocock-skills:handoff` para uma sessão limpa | — |
| Registrar a forma | spec do brainstorming | `mattpocock-skills:to-spec` quando a conversa já decidiu tudo |
| Quebrar o trabalho | `superpowers:writing-plans` | `mattpocock-skills:to-tickets` quando vai para um tracker; `mattpocock-skills:wayfinder` quando não cabe num plano |
| Executar | `superpowers:subagent-driven-development` | `superpowers:executing-plans` quando o usuário escolhe execução sem subagentes |
| Teste e bug | `superpowers:test-driven-development`, `superpowers:systematic-debugging` | `mattpocock-skills:diagnosing-bugs` só para regressão de desempenho |
| Revisar | `superpowers:requesting-code-review` por tarefa; `mattpocock-skills:code-review` no branch inteiro | — |
| Melhorar o sistema | `mattpocock-skills:improve-codebase-architecture` quando o mesmo atrito se repete; `poka-yoke:retro` depois de incidente | — |
| Especialidades | web: `hadouken-kit:yu-ux-web-expert` (prevalece sobre `ui-ux-pro-max`); segurança: `poka-yoke:audit`, `poka-yoke:authz`, `security-review`; grafo do código: `hadouken-kit:graphify`; binário/APK/firmware: REA (plugin `hadouken-rea`) | — |

## Duas regras a mais

- Antes de etapa cara (revisor Fable, muitos subagentes, `Workflow`), leia a linha de consumo do hadouken. Com alerta de projeção, pergunte ao usuário antes.
- `mattpocock-skills:ask-matt` responde dúvidas só sobre as skills do Matt. Para "qual skill agora", vale esta tabela.

## REA

O REA vem desligado. Para ligar, no terminal: `claude plugin install hadouken-rea@claude-hadouken` e depois `claude plugin enable hadouken-rea@claude-hadouken`; em seguida, abra uma sessão nova. Ele roda os programas analisados com as permissões do usuário. Requer Node 22.19+, 24.11+ ou 26+.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/kit-fluxo.test.js`
Expected: PASS, 6 testes. Se o teste de tamanho falhar, encurte o `TEXTO` mantendo `superpowers:brainstorming` e `hadouken-kit:fluxo`.

- [ ] **Step 6: Validar e rodar a suíte**

Run: `claude plugin validate ./kit` e `node --test`
Expected: `Validation passed` (com aviso ou sem) e suíte PASS.

- [ ] **Step 7: Commit**

```bash
git add kit/hooks/hooks.json kit/hooks/fluxo.js kit/skills/fluxo/SKILL.md test/kit-fluxo.test.js
git commit -m "feat(kit): hadouken-kit:fluxo skill and constant SessionStart summary"
```

---

### Task 3: Cópias das skills `yu-ux-web-expert` e `graphify`

**Arquivos:**
- Criar: `kit/skills/yu-ux-web-expert/**` (cópia de `~/.claude/skills/yu-ux-web-expert`), `kit/skills/graphify/SKILL.md`, `kit/skills/graphify/references/*.md`, `kit/skills/graphify/LICENSE-MIT`, `kit/skills/graphify/NOTICE`
- Teste: `test/kit-copias.test.js`

**Interfaces:**
- Consome: a pasta `kit/` da Task 1. Não depende da Task 2.
- Produz: as skills `hadouken-kit:yu-ux-web-expert` e `hadouken-kit:graphify`, que a Task 2 cita.

- [ ] **Step 1: Escrever o teste que falha**

`test/kit-copias.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const kit = path.join(repo, 'kit', 'skills');

function todos(dir) {
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) r.push(p, ...todos(p)); else r.push(p);
  }
  return r;
}

test('graphify: licença MIT, NOTICE e aviso do pacote 0.9.25 logo depois do frontmatter', () => {
  const g = path.join(kit, 'graphify');
  assert.match(fs.readFileSync(path.join(g, 'LICENSE-MIT'), 'utf8'), /MIT License/);
  assert.ok(fs.statSync(path.join(g, 'NOTICE')).size > 0);
  const s = fs.readFileSync(path.join(g, 'SKILL.md'), 'utf8');
  assert.match(s, /^---\nname: graphify\n/);
  const corpo = s.split('\n---\n')[1].trimStart();
  assert.match(corpo.split('\n')[0], /pip install graphifyy==0\.9\.25/);
  assert.ok(fs.readdirSync(path.join(g, 'references')).length >= 8);
});

test('yu-ux: ATTRIBUTIONS.md, setup.sh e manifestos do vendor, sem node_modules nem __pycache__', () => {
  const y = path.join(kit, 'yu-ux-web-expert');
  for (const f of ['ATTRIBUTIONS.md', 'SKILL.md', 'scripts/setup.sh', 'vendor/package.json', 'vendor/package-lock.json']) {
    assert.ok(fs.existsSync(path.join(y, f)), f);
  }
  for (const p of todos(y)) {
    assert.doesNotMatch(p, /node_modules|__pycache__|\.pyc$|\.python_bin$/, p);
  }
  assert.equal(fs.readdirSync(path.join(y, 'references')).filter((n) => n.endsWith('.md')).length, 12);
});

test('yu-ux: o SKILL.md diz onde a skill mora dentro do plugin', () => {
  const s = fs.readFileSync(path.join(kit, 'yu-ux-web-expert', 'SKILL.md'), 'utf8');
  assert.match(s, /^---\nname: yu-ux-web-expert\n/);
  assert.match(s, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/yu-ux-web-expert\//);
});

test('nenhum arquivo do kit é link simbólico', () => {
  for (const p of todos(path.join(repo, 'kit'))) assert.ok(!fs.lstatSync(p).isSymbolicLink(), p);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-copias.test.js`
Expected: FAIL (`ENOENT` em `kit/skills/graphify/LICENSE-MIT`).

- [ ] **Step 3: Copiar a yu-ux sem os excluídos**

```bash
SRC="$HOME/.claude/skills/yu-ux-web-expert"
DST="kit/skills/yu-ux-web-expert"
mkdir -p "$DST"
tar -C "$SRC" --exclude='node_modules' --exclude='__pycache__' --exclude='*.pyc' --exclude='.python_bin' -cf - . | tar -C "$DST" -xf -
find "$DST" -type l   # esperado: nada
```

Se `~/.claude/skills/yu-ux-web-expert` for um link para `~/.agents/skills/...`, o `tar -C` segue a pasta. Confira com `ls -la "$HOME/.claude/skills" | grep yu-ux`.

- [ ] **Step 4: Inserir a linha de local no SKILL.md da yu-ux**

Com Python (utf-8, LF), insira logo depois do frontmatter de `kit/skills/yu-ux-web-expert/SKILL.md`:

```python
import io
p = 'kit/skills/yu-ux-web-expert/SKILL.md'
t = io.open(p, encoding='utf-8').read()
cab, corpo = t.split('\n---\n', 1)
linha = ('> Nesta cópia do hadouken-kit, os caminhos relativos desta skill (`scripts/`, `references/`, `assets/`, `vendor/`) '
         'ficam em `${CLAUDE_PLUGIN_ROOT}/skills/yu-ux-web-expert/`. Rode, por exemplo, '
         '`bash "${CLAUDE_PLUGIN_ROOT}/skills/yu-ux-web-expert/scripts/setup.sh"`.\n\n')
io.open(p, 'w', encoding='utf-8', newline='\n').write(cab + '\n---\n' + linha + corpo.lstrip('\n'))
```

- [ ] **Step 5: Copiar o graphify e trazer as licenças da tag v0.9.25**

```bash
SRC="$HOME/.claude/skills/graphify"
DST="kit/skills/graphify"
mkdir -p "$DST/references"
cp "$SRC/SKILL.md" "$DST/SKILL.md"
cp "$SRC/references/"*.md "$DST/references/"
gh api -H "Accept: application/vnd.github.raw" "repos/safishamsi/graphify/contents/LICENSE-MIT?ref=v0.9.25" > "$DST/LICENSE-MIT"
gh api -H "Accept: application/vnd.github.raw" "repos/safishamsi/graphify/contents/NOTICE?ref=v0.9.25" > "$DST/NOTICE"
cat "$SRC/.graphify_version"   # esperado: 0.9.25
```

Se o `.graphify_version` não disser 0.9.25, pare e relate: o texto da skill não corresponde à versão do spec.

Depois, insira com Python (utf-8, LF), logo depois do frontmatter de `kit/skills/graphify/SKILL.md`:

```python
import io
p = 'kit/skills/graphify/SKILL.md'
t = io.open(p, encoding='utf-8').read()
cab, corpo = t.split('\n---\n', 1)
linha = ('> Requer `pip install graphifyy==0.9.25` (o texto desta skill corresponde a essa versão do pacote). '
         'Licença: Apache-2.0 ou MIT, de safishamsi/graphify; ver `LICENSE-MIT` e `NOTICE` ao lado.\n\n')
io.open(p, 'w', encoding='utf-8', newline='\n').write(cab + '\n---\n' + linha + corpo.lstrip('\n'))
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test test/kit-copias.test.js`
Expected: PASS, 4 testes.

Run: `claude plugin validate ./kit` e `node --test`
Expected: `Validation passed` e suíte PASS. O `node --test` não pode descobrir nada dentro de `kit/skills` (não há `*.test.js` nem pasta `test/` ali). Confira com `node --test 2>&1 | grep -c kit/skills`, que deve dar `0`.

- [ ] **Step 7: Commit**

```bash
git add kit/skills/yu-ux-web-expert kit/skills/graphify test/kit-copias.test.js
git commit -m "feat(kit): bundle yu-ux-web-expert and graphify 0.9.25 skills with their licenses"
```

---

### Task 4: Aviso semanal de versão nova (GitHub Actions)

**Arquivos:**
- Criar: `.github/scripts/kit-versoes.mjs`, `.github/workflows/kit-versoes.yml`
- Teste: `test/kit-versoes.test.js`

**Interfaces:**
- Consome: `kit/testado.json` e `kit/.claude-plugin/plugin.json` (Task 1).
- Produz: `kit-versoes.mjs` exporta funções puras `compararVersoes(testada, publicada) → 'igual' | 'menor' | 'principal' | 'invalida'` e `relatorio(testado, publicadas) → { principais: [{ chave, testada, publicada }], resumo: string }`. Ao rodar como programa (só no Actions), busca as versões publicadas e grava `principais.json` e o resumo em `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 1: Escrever o teste que falha**

`test/kit-versoes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararVersoes, relatorio, fontes } from '../.github/scripts/kit-versoes.mjs';

test('compararVersoes', () => {
  assert.equal(compararVersoes('1.2.0', '1.2.0'), 'igual');
  assert.equal(compararVersoes('1.2.0', '1.3.5'), 'menor');
  assert.equal(compararVersoes('1.2.0', '1.2.1'), 'menor');
  assert.equal(compararVersoes('1.2.0', '2.0.0'), 'principal');
  assert.equal(compararVersoes('0.4.16', '0.5.0'), 'menor');   // 0.x: só a principal conta
  assert.equal(compararVersoes('6.1.0', '7.0.0'), 'principal');
  assert.equal(compararVersoes('1.2.0', undefined), 'invalida');
  assert.equal(compararVersoes('1.2.0', 'main'), 'invalida');
});

test('relatorio: só principal vira issue; menor e inválida vão para o resumo', () => {
  const r = relatorio(
    { dependencias: { 'a@m': '1.0.0', 'b@m': '1.0.0', 'c@m': '1.0.0' }, npm: { 'rea-agents': '6.1.0' } },
    { 'a@m': '2.0.0', 'b@m': '1.1.0', 'c@m': null, 'npm:rea-agents': '7.0.0' });
  assert.deepEqual(r.principais.map((p) => p.chave), ['a@m', 'npm:rea-agents']);
  assert.match(r.resumo, /b@m.*1\.0\.0.*1\.1\.0/);
  assert.match(r.resumo, /c@m.*não consegui ler/);
});

test('fontes: cada dependência do testado.json tem de onde ler', () => {
  const t = { dependencias: {
    'claude-hadouken@claude-hadouken': '0.4.0', 'superpowers@claude-plugins-official': '6.4.1',
    'mattpocock-skills@mattpocock': '1.2.0', 'poka-yoke@poka-yoke': '0.2.0',
    'clean-architecture@clean-architecture-skills': '1.0.0', 'fullstack-dev-skills@fullstack-dev-skills': '0.4.16',
    'ui-ux-pro-max@ui-ux-pro-max-skill': '2.13.0' } };
  for (const k of Object.keys(t.dependencias)) {
    assert.ok(fontes[k], k);
    assert.match(fontes[k].repo, /^[\w.-]+\/[\w.-]+$/, k);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-versoes.test.js`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Escrever o script**

`.github/scripts/kit-versoes.mjs`:

```js
// Aviso semanal do hadouken-kit (spec §3). Roda só no GitHub Actions: a rede
// fica aqui, nunca no plugin. Compara a versão publicada de cada dependência
// com a de kit/testado.json; versão principal nova vira issue (pelo workflow),
// o resto só aparece no resumo do job.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// De onde ler cada versão publicada. Conferido em 2026-10-14 nos
// marketplace.json de ~/.claude/plugins/marketplaces. O superpowers aponta
// para obra/superpowers por url+sha no marketplace oficial; lemos o
// plugin.json do repositório do autor.
export const fontes = {
  'claude-hadouken@claude-hadouken': { repo: 'Garioli-Labs/claude-hadouken', arquivo: '.claude-plugin/plugin.json' },
  'superpowers@claude-plugins-official': { repo: 'obra/superpowers', arquivo: '.claude-plugin/plugin.json' },
  'mattpocock-skills@mattpocock': { repo: 'mattpocock/skills', arquivo: '.claude-plugin/plugin.json' },
  'poka-yoke@poka-yoke': { repo: 'rainmanjam/poka-yoke', arquivo: 'plugins/poka-yoke/.claude-plugin/plugin.json' },
  'clean-architecture@clean-architecture-skills': { repo: 'nathankim0/clean-architecture-skills', arquivo: 'plugins/clean-architecture/.claude-plugin/plugin.json' },
  'fullstack-dev-skills@fullstack-dev-skills': { repo: 'jeffallan/claude-skills', arquivo: '.claude-plugin/plugin.json' },
  'ui-ux-pro-max@ui-ux-pro-max-skill': { repo: 'nextlevelbuilder/ui-ux-pro-max-skill', arquivo: '.claude-plugin/plugin.json' },
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;

export function compararVersoes(testada, publicada) {
  const a = SEMVER.exec(testada ?? ''); const b = SEMVER.exec(publicada ?? '');
  if (!a || !b) return 'invalida';
  if (a[0] === b[0]) return 'igual';
  return Number(b[1]) > Number(a[1]) ? 'principal' : 'menor';
}

export function relatorio(testado, publicadas) {
  const linhas = ['| Dependência | Testada | Publicada | |', '|---|---|---|---|'];
  const principais = [];
  const pares = [
    ...Object.entries(testado.dependencias).map(([k, v]) => [k, v]),
    ...Object.entries(testado.npm ?? {}).map(([k, v]) => [`npm:${k}`, v]),
  ];
  for (const [chave, testada] of pares) {
    const publicada = publicadas[chave];
    const c = compararVersoes(testada, publicada);
    if (c === 'principal') principais.push({ chave, testada, publicada });
    const nota = c === 'invalida' ? 'não consegui ler' : c;
    linhas.push(`| ${chave} | ${testada} | ${publicada ?? '—'} | ${nota} |`);
  }
  return { principais, resumo: linhas.join('\n') };
}

async function lerPublicada(chave) {
  if (chave === 'npm:rea-agents') {
    const r = await fetch('https://registry.npmjs.org/rea-agents/latest');
    return r.ok ? (await r.json()).version : null;
  }
  const f = fontes[chave];
  const r = await fetch(`https://raw.githubusercontent.com/${f.repo}/HEAD/${f.arquivo}`);
  return r.ok ? (await r.json()).version ?? null : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const testado = JSON.parse(fs.readFileSync(path.join(raiz, 'kit', 'testado.json'), 'utf8'));
  const chaves = [...Object.keys(testado.dependencias), ...Object.keys(testado.npm ?? {}).map((k) => `npm:${k}`)];
  const publicadas = {};
  for (const k of chaves) publicadas[k] = await lerPublicada(k).catch(() => null);
  const r = relatorio(testado, publicadas);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## hadouken-kit: versões\n\n${r.resumo}\n`);
  fs.writeFileSync('principais.json', JSON.stringify(r.principais));
  console.log(r.resumo);
}
```

- [ ] **Step 4: Escrever o workflow**

`.github/workflows/kit-versoes.yml`:

```yaml
name: kit-versoes
on:
  schedule:
    - cron: '17 9 * * 1'   # segunda, 09:17 UTC
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  versoes:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: node .github/scripts/kit-versoes.mjs
      - name: Abrir issue por versão principal nova (sem duplicar)
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          node -e 'for (const p of require("./principais.json")) console.log([p.chave, p.testada, p.publicada].join("\t"))' |
          while IFS=$'\t' read -r chave testada publicada; do
            titulo="kit: ${chave} ${publicada} (testado com ${testada})"
            if gh issue list --state open --search "in:title \"kit: ${chave} \"" --json number --jq 'length' | grep -qx 0; then
              gh issue create --title "$titulo" --body "Versão principal nova de \`${chave}\`: ${publicada}. O kit foi testado com ${testada}. Teste e atualize \`kit/testado.json\`."
            fi
          done
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/kit-versoes.test.js`
Expected: PASS, 3 testes.

Run: `node --test`
Expected: suíte PASS. O teste não chama `fetch`: o bloco de rede só roda como programa.

- [ ] **Step 6: Commit**

```bash
git add .github/scripts/kit-versoes.mjs .github/workflows/kit-versoes.yml test/kit-versoes.test.js
git commit -m "ci(kit): weekly check opens one issue per major bump against kit/testado.json"
```

---

### Task 5: README (PT/EN) e SECURITY

**Arquivos:**
- Modificar: `README.md` (seção nova antes de `## Instalação`), `README.en.md` (a mesma, em inglês), `SECURITY.md` (um item sobre o kit e o rea)
- Teste: `test/kit-readme.test.js`

**Interfaces:**
- Consome: a allowlist da Task 1.

- [ ] **Step 1: Escrever o teste que falha**

`test/kit-readme.test.js`:

```js
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
    assert.match(t, /claude plugin enable hadouken-rea@claude-hadouken/);
    assert.match(t, /rea-agents@6\.1\.0/);
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-readme.test.js`
Expected: FAIL (`install > 0`).

- [ ] **Step 3: Escrever a seção no README.md** (pela ferramenta Write ou Edit, utf-8)

Antes de `## Instalação`, a seção `## hadouken-kit e hadouken-rea (opcionais)` com, nesta ordem:
1. Uma frase: o kit instala de uma vez o conjunto de skills do dia a dia (lista dos sete plugins com o marketplace de cada um) e a skill `hadouken-kit:fluxo`, que diz qual usar em cada etapa. Quem quer só o consumo e a guarda instala só o `claude-hadouken`.
2. O bloco, no terminal (fora de sessão ou com `!`):

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add mattpocock/skills
claude plugin marketplace add rainmanjam/poka-yoke
claude plugin marketplace add nathankim0/clean-architecture-skills
claude plugin marketplace add jeffallan/claude-skills
claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
claude plugin install hadouken-kit@claude-hadouken
```

3. O porquê dos `marketplace add`: o Claude Code só instala uma dependência de um marketplace já registrado; sem ele, o kit instala, mas fica desligado com `Dependency "<nome>" is not installed`.
4. Que instalar ou ligar plugin dentro de uma sessão aberta é segurado pelo hook `ConfigChange` da guarda; por isso, rode no terminal e abra uma sessão nova.
5. Que a cada sessão o kit põe no contexto um resumo de 5 linhas do fluxo (~150 tokens, nenhuma chamada de modelo).
6. Que a `yu-ux-web-expert` instala as dependências dela (`axe-core`, `lighthouse`, Chromium) na pasta do plugin na primeira vez, e de novo depois de cada atualização do kit, porque a pasta muda de versão.
7. O REA: desligado por padrão. Para ligar, `claude plugin install hadouken-rea@claude-hadouken` e `claude plugin enable hadouken-rea@claude-hadouken`. Ele abre `npx -y rea-agents@6.1.0 mcp` (versão exata; no Windows pelo `cmd.exe /d /c`), precisa de Node 22.19+, 24.11+ ou 26+, e **executa os programas analisados com as permissões do seu usuário**.
8. Que um workflow semanal abre issue quando uma dependência lança versão principal nova.

No `README.en.md`, a mesma seção em inglês, `## hadouken-kit and hadouken-rea (optional)`, antes de `## Installation` (confira o título exato com `grep -n "^## " README.en.md`). Ponha um link no Sumário de cada README.

No `SECURITY.md`, um item novo na lista de riscos declarados: o kit não tem código além de `kit/hooks/fluxo.js`, que imprime uma constante. O `hadouken-rea` lança um processo (`rea/lancar.mjs` → `npx`), baixa `rea-agents@6.1.0` do npm na primeira vez e executa o que analisa. A fronteira "rede só em `src/aprendizado/baixar.js`, processo filho só em `src/aprendizado/coletor.js`" vale para `src/` do `claude-hadouken` e segue intacta.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/kit-readme.test.js` e `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md README.en.md SECURITY.md test/kit-readme.test.js
git commit -m "docs(kit): README (PT/EN) and SECURITY for hadouken-kit and hadouken-rea, marketplaces added before install"
```

---

### Task 6: Roteiro manual (controlador)

Quem faz é o controlador, sem implementador. Use um `CLAUDE_CONFIG_DIR` temporário e limpe as variáveis `CLAUDE*` e `OTEL_*` do ambiente antes de abrir o `claude` (nota do roteiro da v0.4.0). Rode com Haiku para gastar pouco.

- [ ] **Step 1:** `claude plugin validate ./kit`, `claude plugin validate ./rea` e `node --test`. Anote as contagens.
- [ ] **Step 2:** `claude --plugin-dir . --plugin-dir ./kit --model haiku -p "Repita literalmente a linha do contexto que começa com hadouken-kit:"`. Esperado: volta a linha `hadouken-kit: ideia → superpowers:brainstorming; ...`.
- [ ] **Step 3:** sessão interativa com `--plugin-dir . --plugin-dir ./kit`. `/hadouken-kit:fluxo` carrega a tabela; `/hadouken-kit:yu-ux-web-expert` e `/hadouken-kit:graphify` aparecem no `/` (só listar, sem rodar).
- [ ] **Step 4:** com `--plugin-dir ./rea` e o rea ligado (`/plugin` → enable, ou `enabledPlugins` no settings do config temporário), `/mcp` lista `rea` conectado. Esperado no Windows: conecta pelo `cmd.exe`. Se o Node da máquina estiver fora da faixa do REA, anote e siga (é requisito declarado).
- [ ] **Step 5:** sem ligar o rea, `/mcp` não lista `rea` (`defaultEnabled: false`).
- [ ] **Step 6:** apague o config temporário. Anote os resultados no registro do plano.

---

### Task 7: Na máquina do Sr. Garioli (depois do merge e do push, decisão dele)

Quem faz é o controlador, com confirmação a cada passo destrutivo.

- [ ] **Step 1:** ele roda no terminal: `claude plugin marketplace update claude-hadouken`, `claude plugin install hadouken-kit@claude-hadouken`, `claude plugin install hadouken-rea@claude-hadouken` e `claude plugin enable hadouken-rea@claude-hadouken`.
- [ ] **Step 2:** antes de apagar, copie `~/.claude/skills/yu-ux-web-expert` para o repositório e compare com `kit/skills/yu-ux-web-expert` (`diff -r`, ignorando `vendor/node_modules`, `__pycache__` e a linha de local). Diferença de conteúdo: pare e pergunte qual versão vale.
- [ ] **Step 3:** liste os links de `~/.claude/skills` que apontam para `~/.agents/skills` e cujo nome está na lista `skills` do `mattpocock-skills` instalado (`ls -la ~/.claude/skills`). Esperado: 22 nomes, e `find-skills` e `karpathy-guidelines` ficam. Mostre a lista a ele e só remova com o OK. Remova também `~/.claude/skills/graphify` e `~/.claude/skills/yu-ux-web-expert`. Se a v0.4.0 estiver instalada e a P5 negar, ele roda os `rm` com `!`.
- [ ] **Step 4:** no `~/.claude/CLAUDE.md`, troque `~/.claude/skills/graphify/SKILL.md` por `hadouken-kit:graphify`, `~/.claude/skills/yu-ux-web-expert/SKILL.md` por `hadouken-kit:yu-ux-web-expert`, e `bash ~/.claude/skills/yu-ux-web-expert/scripts/setup.sh` pela frase "o setup.sh da skill, em `${CLAUDE_PLUGIN_ROOT}/skills/yu-ux-web-expert/scripts/`". Mostre o diff antes de gravar.
- [ ] **Step 5:** ele abre uma sessão nova e confere a linha do fluxo no início e as skills `hadouken-kit:*` na lista.

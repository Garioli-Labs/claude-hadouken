# v0.5.2: instalador de um comando — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um comando (`curl … | bash` no Mac e no Linux, `irm … | iex` no Windows) instala tudo do Hadouken num PC novo (pré-requisitos, os três plugins, barra, item do VS Code, extras), conserta o item do VS Code que não aparecia no Mac e liga a atualização automática do Hadouken e dos terceiros do kit.

**Architecture:** Dois scripts finos na raiz (`install.sh`, `install.ps1`) conferem e instalam os pré-requisitos e o plugin principal pelo `claude plugin`; depois chamam `node <plugin>/src/instalar-tudo.js`, que faz o resto em Node testável (kit, REA, atualização automática, barra, painel, aprendizado, extras) e imprime um resumo de rótulos fixos. Os terceiros do kit passam a ser entradas do marketplace do Hadouken com `sha` fixo, e um robô semanal no GitHub Actions sobe esses `sha`, roda a suíte em 3 sistemas × 3 Nodes e publica sozinho quando tudo passa.

**Tech Stack:** Node ≥ 20 (ESM, zero dependências, `node:test`), bash 3.2+ (o do macOS), Windows PowerShell 5.1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-instalador-unico-design.md` (ler inteira antes de começar).

## Global Constraints

- Comandos: `curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash` e `irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex`.
- Opções: `--sim`, `--substituir-barra`, `--sem-extras`, `--com-aprendizado`; no Windows também pela variável `HADOUKEN_INSTALAR` (opções separadas por espaço).
- Mínimos: Node `20`; `claude` `2.1.251`; REA só com Node `^22.19.0`, `^24.11.0` ou `>=26.0.0` (`nodeServe` de `rea/lancar.mjs`).
- Sem tty e sem `--sim`, toda pergunta vale "não". `--sim` nunca substitui a barra de outro e nunca liga o aprendizado.
- Nenhum `sudo`. Nenhum segredo lido ou gravado. Texto de fora (saída do `claude`, `winget`, `brew`, `pip`) nunca entra no resumo; só rótulos fixos e versões no formato `N.N.N`.
- Resumo: `✓ <item>: <detalhe>`, `= <item>: já estava`, `– <item>: pulado (<motivo>)`, `✗ <item>: falhou (<motivo>; <conserto>)`, e no fim `Abra uma sessão nova do Claude Code.`; algum `✗` → código de saída 1.
- Versões: claude-hadouken `0.5.2` (`.claude-plugin/plugin.json`, `package.json`, `marketplace.json`); hadouken-kit `1.1.0`; hadouken-rea fica `1.0.1`.
- `sha` iniciais dos terceiros: mattpocock-skills `49dd158d1076134a641b33efb035946536778336` (1.3.1); poka-yoke `726a575e3d48d07d908abfcbb192cae09671fff2` (0.2.0); fullstack-dev-skills `882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf` (0.4.16); ui-ux-pro-max `e353a508767c6d39f0e7698b084dbfc8699fffd3` (2.13.0).
- Ações do GitHub fixadas por sha: checkout `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), setup-node `820762786026740c76f36085b0efc47a31fe5020` (v7.0.0), sempre com `package-manager-cache: false`.
- Texto com acento só pelas ferramentas Write/Edit (ou Python com utf-8 e LF). Commits com pathspec explícito, mensagem gravada em `/tmp/msg052` com `printf` e `git commit -q -F /tmp/msg052`, terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A guarda nega comando Bash com "claude" e "hadouken" junto de `$`, `{` ou `*`: comandos assim vão num script no scratchpad, rodado com `bash <script>`.
- Toda função exportada de `src/` nunca lança: falha vira `{ ok: false, motivo }` com motivo de lista fixa.

## Review Focus

1. **`curl | bash` com o script vindo pela entrada:** um comando filho que lê a entrada (o `claude`, o `brew`, o `node`) não pode comer o resto do script, e sem tty nada pode travar esperando resposta. Esperado: o script inteiro fica dentro de `main() { … }; main "$@"` e as perguntas leem `/dev/tty`. Teste na Task 7 (`claude` falso que come a entrada; rodada com `setsid`).
2. **`irm | iex` não pode fechar a janela do PowerShell:** nenhum `exit` quando o script não veio de arquivo. Esperado: o PowerShell continua e `$LASTEXITCODE` tem o código. Teste na Task 8 (`Get-Content -Raw | iex; 'depois'`).
3. **Rodar de novo não muda nada:** a segunda rodada não regrava o settings.json, não cria backup novo e mostra `=` em tudo que já estava. Teste na Task 6 (bytes do settings e lista de backups iguais) e na Task 4.
4. **Caminho com espaço e acento** (`C:\Users\Lucas Garioli`, `/Users/Fulano de Tal`, `José`): o `.app` do VS Code tem espaço no nome; o `claude.cmd` do npm fica em `AppData\Roaming\npm`. Esperado: tudo passa pelo `caminhoSeguro` e roda. Testes nas Tasks 1, 5 e 8 (pastas temporárias com espaço).
5. **`claude.cmd` (instalação pelo npm) no Windows:** o `execFile` não roda `.cmd` sem shell. Esperado: `cmd.exe /d /s /c` do System32 com a linha entre aspas, como o painel já faz. Teste na Task 5 (linha montada e execução real de um `claude.cmd` falso) e na Task 8.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/painel/instalar-painel.js` | Modificar | `acharCode` com os caminhos do Mac; `instalarPainel` grava o `motivo` da falha em `tentativa.json` |
| `src/painel/falha.js` | Criar | `falhaPendente({ dir, raizPlugin })`: o motivo da última falha, se a versão atual não está instalada |
| `src/hooks/linha-estado.js` | Modificar | `MOTIVOS_PAINEL` e `linhaPainel(motivo)` |
| `src/hooks/session-start.js` | Modificar | a linha do painel no contexto |
| `.claude-plugin/marketplace.json`, `kit/.claude-plugin/plugin.json`, `kit/testado.json`, `.claude-plugin/plugin.json`, `package.json` | Modificar | terceiros com `sha`, kit 1.1.0, versões 0.5.2 |
| `src/instalar/atualizacao-auto.js` | Criar | `autoUpdate` no settings e as cópias antigas desligadas |
| `src/instalar/itens.js` | Criar | itens do resumo e a formatação |
| `src/instalar/claude-cli.js` | Criar | rodar o `claude` (inclusive `.cmd`), ler `plugin list --json`, passos do kit e do REA |
| `src/instalar-tudo.js` | Criar | os passos 6 e 7 da spec e o `main` |
| `install.sh`, `install.ps1` | Criar | passos 1 a 5 da spec |
| `test/dados/instalador/claude-falso.mjs` | Criar | `claude` falso dos testes (função pura + modo executável) |
| `.github/scripts/kit-atualizar.mjs`, `.github/workflows/kit-atualizar.yml` | Criar | o robô semanal |
| `.github/scripts/kit-versoes.mjs`, `.github/workflows/kit-versoes.yml`, `test/kit-versoes.test.js` | Apagar | substituídos pelo robô |
| `README.md`, `README.en.md`, `SECURITY.md` | Modificar | comando único, Mac, robô |

---

### Task 1: `acharCode` acha o VS Code do Mac fora do PATH

**Files:**
- Modify: `src/painel/instalar-painel.js:1-13` (import de `os`), `:94-117` (`acharCode`), `:244-249` e `:263` (`instalarPainel` repassa `casa` e `apps`)
- Test: `test/painel-instalar.test.js`

**Interfaces:**
- Produces: `acharCode({ pathEnv, plataforma, existe, casa, apps })` → `string | null`. `casa` (padrão `os.homedir()`) e `apps` (lista de caminhos absolutos; padrão `appsDoMac(casa)` no darwin, `[]` fora dele). `export function appsDoMac(casa)` → `string[]`. `instalarPainel` aceita `casa` e `apps` e os repassa ao `achar`.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/painel-instalar.test.js`, acrescentar `appsDoMac` ao import de `../src/painel/instalar-painel.js` e, logo depois do último teste de `acharCode` (linha ~106), acrescentar:

```js
// v0.5.2: no macOS o VS Code não põe o `code` no PATH. Sem ele no PATH, o
// acharCode tenta o CLI dentro do .app, em /Applications e em ~/Applications.
const APP_FIM = 'Visual Studio Code.app/Contents/Resources/app/bin/code';
const CASA_MAC = '/Users/Fulano de Tal';

test('acharCode darwin: sem code no PATH, acha o .app em /Applications', () => {
  const vistos = [];
  const alvo = `/Applications/${APP_FIM}`;
  const r = acharCode({ pathEnv: '/usr/bin:/bin', plataforma: 'darwin', casa: CASA_MAC, existe: (p) => { vistos.push(p); return p === alvo; } });
  assert.equal(r, alvo);
  assert.deepEqual(vistos, ['/usr/bin/code', '/bin/code', alvo]);
});

test('acharCode darwin: acha o .app em ~/Applications quando não há em /Applications', () => {
  const alvo = `${CASA_MAC}/Applications/${APP_FIM}`;
  assert.equal(acharCode({ pathEnv: '/usr/bin', plataforma: 'darwin', casa: CASA_MAC, existe: (p) => p === alvo }), alvo);
});

test('acharCode darwin: o PATH vence os dois .app, e sem nenhum devolve null', () => {
  const doPath = '/usr/local/bin/code';
  assert.equal(acharCode({ pathEnv: '/usr/local/bin', plataforma: 'darwin', casa: CASA_MAC, existe: () => true }), doPath);
  assert.equal(acharCode({ pathEnv: '/usr/bin', plataforma: 'darwin', casa: CASA_MAC, existe: () => false }), null);
  // PATH ausente no Mac ainda tenta os .app.
  assert.equal(acharCode({ pathEnv: undefined, plataforma: 'darwin', casa: CASA_MAC, existe: (p) => p === `/Applications/${APP_FIM}` }), `/Applications/${APP_FIM}`);
});

test('acharCode win32 e linux: nunca olham /Applications', () => {
  const existe = (p) => p.includes('Applications');
  assert.equal(acharCode({ pathEnv: 'C:\\x', plataforma: 'win32', casa: 'C:\\Users\\Fulano', existe }), null);
  assert.equal(acharCode({ pathEnv: '/usr/bin', plataforma: 'linux', casa: '/home/fulano', existe }), null);
});

test('appsDoMac: casa inválida fica de fora, e os dois caminhos passam no caminhoSeguro', () => {
  assert.deepEqual(appsDoMac(CASA_MAC), [`/Applications/${APP_FIM}`, `${CASA_MAC}/Applications/${APP_FIM}`]);
  for (const ruim of [null, 'relativo', '/a\0b', 42]) assert.deepEqual(appsDoMac(ruim), [`/Applications/${APP_FIM}`], String(ruim));
  for (const p of appsDoMac(CASA_MAC)) assert.equal(caminhoSeguro(p, 'darwin'), true, p);
});

test('instalarPainel repassa casa e apps ao achar', async () => {
  const pedidos = [];
  await instalarPainel({
    dir: novoTmp(), raizPlugin: raizFalsa(), agoraMs: Date.now(), plataforma: 'darwin', pathEnv: '/usr/bin', casa: CASA_MAC, apps: ['/x/code'],
    achar: (o) => { pedidos.push(o); return null; }, executar: () => assert.fail('não roda sem code'),
  });
  assert.equal(pedidos[0].casa, CASA_MAC);
  assert.deepEqual(pedidos[0].apps, ['/x/code']);
});
```

E, nos testes existentes que chamam `acharCode` com a plataforma do processo e esperam `null` (linhas ~100 e ~105), acrescentar `apps: []` às opções, para não acharem um VS Code de verdade em `/Applications` num Mac (ex.: `acharCode({ pathEnv: '.', plataforma: process.platform, apps: [] })`).

No topo do arquivo, depois de `const H = 3_600_000;`:

```js
// Num Mac com o VS Code em /Applications, o acharCode de verdade o acha
// mesmo com o PATH vazio: os testes de processo filho que esperam
// 'sem-vscode' pulam ali.
const MAC_COM_VSCODE = process.platform === 'darwin' && acharCode({ pathEnv: '' }) !== null;
```

e trocar a abertura dos dois testes de processo filho que dependem de `sem-vscode`:

```js
test('filho: cli.js painel instalar sem code no PATH monta o .vsix na pasta de dados e sai 1 com sem-vscode', { skip: MAC_COM_VSCODE && 'VS Code em /Applications' }, () => {
```

```js
test('SessionStart: dispara o instalador em segundo plano; com HADOUKEN_SEM_PAINEL=1 não dispara nada', { skip: MAC_COM_VSCODE && 'VS Code em /Applications' }, async () => {
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/painel-instalar.test.js`
Expected: FAIL — `appsDoMac` não existe (SyntaxError do import).

- [ ] **Step 3: Implementar**

Em `src/painel/instalar-painel.js`, acrescentar `import os from 'node:os';` depois de `import fs from 'node:fs';` e trocar o comentário e a função `acharCode` (linhas 94-117) por:

```js
const casaPadrao = () => {
  try {
    return os.homedir();
  } catch {
    return null;
  }
};

// v0.5.2: no macOS o VS Code não põe o `code` no PATH por padrão (é preciso
// rodar "Shell Command: Install 'code' command in PATH"). Sem ele no PATH, o
// CLI de dentro do .app, em /Applications e em ~/Applications. Casa que não é
// caminho absoluto POSIX sem NUL fica de fora.
export function appsDoMac(casa) {
  const fim = ['Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'];
  const lista = [path.posix.join('/Applications', ...fim)];
  if (typeof casa === 'string' && casa.startsWith('/') && !casa.includes('\0')) lista.push(path.posix.join(casa, 'Applications', ...fim));
  return lista;
}

// Caminho do CLI do VS Code: code.cmd no win32, code fora dele, no primeiro
// diretório do PATH em que `existe` o confirma. Só entram diretórios que são
// caminho absoluto completo pela regra do processo (absolutoCompleto, de
// base.js); vazio, ".", relativo, "C:rel" e "\raiz" ficam de fora, e um par de
// aspas em volta da entrada sai no win32, como o próprio Windows faz. No
// darwin, sem nada no PATH, tenta `apps` (padrão: appsDoMac(casa)), só
// caminhos absolutos. Devolve o caminho ou null. Nunca lança.
export function acharCode({ pathEnv = process.env.PATH, plataforma = process.platform, existe = existePadrao, casa = casaPadrao(), apps } = {}) {
  try {
    if (typeof existe !== 'function') return null;
    const win = plataforma === 'win32';
    const nome = win ? 'code.cmd' : 'code';
    const caminhos = win ? path.win32 : path.posix;
    if (typeof pathEnv === 'string') {
      for (const cru of pathEnv.split(win ? ';' : ':')) {
        let dir = cru;
        if (win && dir.length >= 2 && dir.startsWith('"') && dir.endsWith('"')) dir = dir.slice(1, -1);
        if (dir === '' || dir.includes('\0') || !absolutoCompleto(dir)) continue;
        const candidato = caminhos.join(dir, nome);
        if (existe(candidato) === true) return candidato;
      }
    }
    if (plataforma !== 'darwin') return null;
    for (const candidato of Array.isArray(apps) ? apps : appsDoMac(casa)) {
      if (typeof candidato === 'string' && candidato.startsWith('/') && !candidato.includes('\0') && existe(candidato) === true) return candidato;
    }
    return null;
  } catch {
    return null;
  }
}
```

Atenção: `absolutoCompleto` segue a regra do **processo** (no Windows, `C:\…`); os testes do darwin acima rodam também no Windows, e diretórios `/usr/bin` não passam ali. Por isso os testes do darwin que esperam achar pelo PATH (`'/usr/local/bin/code'`) precisam de `{ skip: process.platform === 'win32' && 'PATH POSIX só fora do Windows' }` — aplicar esse skip ao teste "o PATH vence os dois .app" e, no primeiro teste, comparar `vistos` só fora do Windows:

```js
  if (process.platform !== 'win32') assert.deepEqual(vistos, ['/usr/bin/code', '/bin/code', alvo]);
  else assert.deepEqual(vistos, [alvo]);
```

Em `instalarPainel`, acrescentar `casa, apps` à desestruturação (linha 246-249):

```js
      plataforma = process.platform, pathEnv = process.env.PATH, existe, systemRoot = process.env.SystemRoot, casa, apps,
```

e trocar a linha 263 por:

```js
    const code = achar({ pathEnv, plataforma, existe, casa, apps });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/painel-instalar.test.js`
Expected: PASS (os testes de processo filho pulam só num Mac com VS Code).

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'fix(painel): no Mac, acha o code dentro do .app em /Applications e ~/Applications' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add src/painel/instalar-painel.js test/painel-instalar.test.js
git commit -q -F /tmp/msg052
```

---

### Task 2: o motivo da falha do painel aparece no início de sessão

**Files:**
- Modify: `src/painel/instalar-painel.js:244-281` (`instalarPainel` grava `{ em, motivo }`)
- Create: `src/painel/falha.js`
- Modify: `src/hooks/linha-estado.js` (depois de `linhaSemRegistro`, linha ~104)
- Modify: `src/hooks/session-start.js:139` (a linha nova antes da saída)
- Test: `test/painel-instalar.test.js`

**Interfaces:**
- Consumes: `lerJson(arquivo, maxBytes)` → `{ ok, valor }` (`src/estado.js`); `caminhoDoAmbiente(valor)` → `string | null` (`src/base.js`); `motivoFixo` (interno de `linha-estado.js`).
- Produces: `MOTIVOS_PAINEL: Set<string>` e `linhaPainel(motivo)` → `string` (`src/hooks/linha-estado.js`); `falhaPendente({ dir, raizPlugin })` → motivo de `MOTIVOS_PAINEL` ou `null` (`src/painel/falha.js`). `tentativa.json` passa a ser `{ em, motivo? }`.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/painel-instalar.test.js`, acrescentar os imports:

```js
import { falhaPendente } from '../src/painel/falha.js';
import { linhaPainel, MOTIVOS_PAINEL } from '../src/hooks/linha-estado.js';
```

e os testes (depois dos de `instalarPainel`):

```js
// ------------------------------------------------------------ motivo da falha (v0.5.2)

test('instalarPainel grava o motivo de cada falha em tentativa.json, e nenhum depois de um sucesso', async () => {
  const agora = Date.parse('2026-10-15T12:00:00Z');
  const casos = [
    ['sem-vscode', { achar: () => null }],
    ['caminho-inseguro', { achar: () => (WIN ? 'C:\\a&b\\code.cmd' : '/a&b/code') }],
    ['erro', { achar: () => (WIN ? 'C:\\vs\\code.cmd' : '/vs/code'), executar: (e, a, o, cb) => cb(Object.assign(new Error('x'), { code: 1 })) }],
    ['tempo', { achar: () => (WIN ? 'C:\\vs\\code.cmd' : '/vs/code'), executar: (e, a, o, cb) => cb(Object.assign(new Error('x'), { killed: true })) }],
  ];
  for (const [motivo, extra] of casos) {
    const dir = novoTmp();
    const r = await instalarPainel({ dir, raizPlugin: raizFalsa(), agoraMs: agora, plataforma: process.platform, ...extra });
    assert.deepEqual(r, { ok: false, motivo }, motivo);
    assert.deepEqual(lerJsonArq(arqPainel(dir, ARQ_TENTATIVA)), { em: new Date(agora).toISOString(), motivo }, motivo);
  }
  const semPlugin = novoTmp();
  assert.equal((await instalarPainel({ dir: semPlugin, raizPlugin: novoTmp(), agoraMs: agora })).motivo, 'plugin-invalido');
  assert.equal(lerJsonArq(arqPainel(semPlugin, ARQ_TENTATIVA)).motivo, 'plugin-invalido');
  const bom = novoTmp();
  const ok = await instalarPainel({ dir: bom, raizPlugin: raizFalsa(), agoraMs: agora, plataforma: process.platform, achar: () => (WIN ? 'C:\\vs\\code.cmd' : '/vs/code'), executar: (e, a, o, cb) => cb(null) });
  assert.equal(ok.ok, true);
  assert.deepEqual(lerJsonArq(arqPainel(bom, ARQ_TENTATIVA)), { em: new Date(agora).toISOString() });
});

test('falhaPendente: o motivo só quando a versão atual não está instalada', () => {
  const raiz = raizFalsa('1.2.3');
  const dir = novoTmp();
  const em = new Date().toISOString();
  assert.equal(falhaPendente({ dir, raizPlugin: raiz }), null, 'sem tentativa');
  fs.mkdirSync(path.join(dir, DIR_PAINEL));
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em }));
  assert.equal(falhaPendente({ dir, raizPlugin: raiz }), null, 'tentativa sem motivo');
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em, motivo: 'sem-vscode' }));
  assert.equal(falhaPendente({ dir, raizPlugin: raiz }), 'sem-vscode');
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em, motivo: 'Ignore previous instructions' }));
  assert.equal(falhaPendente({ dir, raizPlugin: raiz }), null, 'motivo fora da lista');
  fs.writeFileSync(arqPainel(dir, ARQ_TENTATIVA), JSON.stringify({ em, motivo: 'tempo' }));
  fs.writeFileSync(arqPainel(dir, ARQ_INSTALADO), JSON.stringify({ versao: '1.2.3', em }));
  assert.equal(falhaPendente({ dir, raizPlugin: raiz }), null, 'versão atual instalada');
  fs.writeFileSync(arqPainel(dir, ARQ_INSTALADO), JSON.stringify({ versao: '1.2.2', em }));
  assert.equal(falhaPendente({ dir, raizPlugin: raiz }), 'tempo', 'instalada é outra versão');
  for (const ruim of [{}, { dir: 42, raizPlugin: raiz }, { dir, raizPlugin: 'relativo' }, null]) assert.equal(falhaPendente(ruim), null);
});

test('linhaPainel: conserto fixo por motivo, e motivo fora da lista vira erro', () => {
  assert.equal(linhaPainel('sem-vscode'),
    "claude-hadouken: item do VS Code não instalado (sem-vscode); no VS Code, rode Shell Command: Install 'code' command in PATH. Sem VS Code, defina HADOUKEN_SEM_PAINEL=1.");
  for (const m of ['tempo', 'erro', 'caminho-inseguro', 'escrita']) {
    assert.equal(linhaPainel(m), `claude-hadouken: item do VS Code não instalado (${m}); rode node ~/.claude/hadouken/bin/cli.mjs painel instalar. Sem VS Code, defina HADOUKEN_SEM_PAINEL=1.`);
  }
  assert.match(linhaPainel('<script>'), /\(erro\)/);
  for (const m of MOTIVOS_PAINEL) assert.match(linhaPainel(m), new RegExp(`\\(${m}\\)`));
});

// Uma linha por motivo; nenhuma com a versão instalada, sem tentativa ou com
// HADOUKEN_SEM_PAINEL=1. A tentativa é recente: o SessionStart não dispara.
test('SessionStart: a linha do painel com o motivo gravado', () => {
  const versao = versaoDoPlugin(repo);
  const em = new Date().toISOString();
  const preparar = (motivo, instalado) => {
    const home = novoTmp('hdk casa ç ');
    fs.mkdirSync(path.join(home, DIR_PAINEL));
    fs.writeFileSync(arqPainel(home, ARQ_TENTATIVA), JSON.stringify(motivo ? { em, motivo } : { em }));
    if (instalado) fs.writeFileSync(arqPainel(home, ARQ_INSTALADO), JSON.stringify({ versao: instalado, em }));
    return home;
  };
  const BASE = 'Consumo ainda sem leitura nesta máquina.';
  for (const m of ['sem-vscode', 'tempo', 'caminho-inseguro']) {
    assert.equal(contextoDe(sessionStart(ambienteIsolado(preparar(m)))), `${BASE}\n${linhaPainel(m)}`, m);
  }
  assert.equal(contextoDe(sessionStart(ambienteIsolado(preparar('sem-vscode', versao)))), BASE, 'instalado');
  assert.equal(contextoDe(sessionStart(ambienteIsolado(preparar(null)))), BASE, 'sem motivo');
  assert.equal(contextoDe(sessionStart(ambienteIsolado(preparar('sem-vscode'), { HADOUKEN_SEM_PAINEL: '1' }))), BASE, 'desligado');
});
```

E, no teste existente "SessionStart: dispara o instalador em segundo plano…", o filho agora grava o motivo `sem-vscode` depois do `.vsix`. Trocar o trecho a partir de `// Segunda sessão no ligado` por:

```js
  // O filho grava o motivo logo depois do .vsix; a segunda sessão já o mostra,
  // e a tentativa recente segura o disparo.
  const fimMotivo = Date.now() + 20_000;
  while (!fs.readFileSync(arqPainel(ligado, ARQ_TENTATIVA), 'utf8').includes('sem-vscode') && Date.now() < fimMotivo) await new Promise((r) => setTimeout(r, 50));
  const tentativa = fs.readFileSync(arqPainel(ligado, ARQ_TENTATIVA), 'utf8');
  assert.match(tentativa, /"motivo":"sem-vscode"/);
  assert.equal(contextoDe(sessionStart(ambienteIsolado(ligado))), `Consumo ainda sem leitura nesta máquina.\n${linhaPainel('sem-vscode')}`);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fs.readFileSync(arqPainel(ligado, ARQ_TENTATIVA), 'utf8'), tentativa);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/painel-instalar.test.js`
Expected: FAIL — `src/painel/falha.js` não existe.

- [ ] **Step 3: Implementar**

Em `src/hooks/linha-estado.js`, depois de `linhaSemRegistro` (linha ~104):

```js
// v0.5.2: a instalação do item do VS Code falhou e a versão atual não está
// instalada (painel/falha.js). Motivos da lista de instalarPainel depois da
// tentativa marcada; o conserto é fixo por motivo.
export const MOTIVOS_PAINEL = new Set(['plugin-invalido', 'extensao-invalida', 'escrita', 'sem-vscode', 'caminho-inseguro', 'tempo', 'erro']);
const CONSERTO_SEM_VSCODE = "no VS Code, rode Shell Command: Install 'code' command in PATH";
const CONSERTO_PAINEL = 'rode node ~/.claude/hadouken/bin/cli.mjs painel instalar';
export function linhaPainel(motivo) {
  const m = motivoFixo(motivo, MOTIVOS_PAINEL);
  return `claude-hadouken: item do VS Code não instalado (${m}); ${m === 'sem-vscode' ? CONSERTO_SEM_VSCODE : CONSERTO_PAINEL}. Sem VS Code, defina HADOUKEN_SEM_PAINEL=1.`;
}
```

Criar `src/painel/falha.js`:

```js
import path from 'node:path';
import { caminhoDoAmbiente } from '../base.js';
import { lerJson } from '../estado.js';
import { MOTIVOS_PAINEL } from '../hooks/linha-estado.js';

// v0.5.2: o motivo da última instalação do item do VS Code que falhou
// (tentativa.json, gravado por instalarPainel), quando a versão do plugin em
// uso ainda não está em instalado.json. Leve de propósito: o SessionStart o
// carrega em toda sessão, e o instalador (vsix, zlib) fica de fora. Só motivo
// da lista fixa; qualquer outra coisa é null. Nunca lança.

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function falhaPendente(opcoes) {
  try {
    const { dir, raizPlugin } = ehObjeto(opcoes) ? opcoes : {};
    const raiz = caminhoDoAmbiente(raizPlugin);
    if (raiz === null || typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
    const plugin = lerJson(path.join(raiz, '.claude-plugin', 'plugin.json'), 64 * 1024);
    const versao = plugin.ok && ehObjeto(plugin.valor) && typeof plugin.valor.version === 'string' ? plugin.valor.version : null;
    if (versao === null) return null;
    const instalado = lerJson(path.join(dir, 'painel', 'instalado.json'), 4096);
    if (instalado.ok && ehObjeto(instalado.valor) && instalado.valor.versao === versao) return null;
    const tentativa = lerJson(path.join(dir, 'painel', 'tentativa.json'), 4096);
    const motivo = tentativa.ok && ehObjeto(tentativa.valor) ? tentativa.valor.motivo : undefined;
    return typeof motivo === 'string' && MOTIVOS_PAINEL.has(motivo) ? motivo : null;
  } catch {
    return null;
  }
}
```

Conferir antes: `caminhoDoAmbiente` recusa `'relativo'` (devolve `null`) — está em `src/base.js:86`.

Em `src/painel/instalar-painel.js`, acrescentar depois de `marcarTentativa`:

```js
// Regrava tentativa.json com o motivo da falha (v0.5.2), para o início de
// sessão mostrar o conserto. Melhor esforço: nunca lança.
function registrarFalha(dir, agoraMs, motivo) {
  try {
    gravarJsonAtomico(path.join(dir, DIR_PAINEL, ARQ_TENTATIVA), { em: new Date(agoraMs).toISOString(), motivo });
  } catch {
    /* fica a tentativa sem motivo */
  }
}
```

e trocar o corpo de `instalarPainel` (linhas 244-281) por:

```js
export async function instalarPainel(opcoes) {
  let registrar = () => {};
  try {
    const {
      dir, raizPlugin, agoraMs = Date.now(), achar = acharCode, executar = executarPadrao,
      plataforma = process.platform, pathEnv = process.env.PATH, existe, systemRoot = process.env.SystemRoot, casa, apps,
    } = ehObjeto(opcoes) ? opcoes : {};
    if (!dirValido(dir)) return falha('sem-pasta');
    if (!agoraValido(agoraMs) || typeof achar !== 'function' || typeof executar !== 'function') return falha('argumentos');
    if (!marcarTentativa({ dir, agoraMs }).ok) return falha('escrita');
    // Daqui em diante, toda falha fica em tentativa.json com o motivo.
    registrar = (motivo) => registrarFalha(dir, agoraMs, motivo);
    const falhou = (motivo) => {
      registrar(motivo);
      return falha(motivo);
    };
    const versao = versaoDoPlugin(raizPlugin);
    if (versao === null) return falhou('plugin-invalido');
    const packageJson = lerFonte(path.join(raizPlugin, 'vscode', 'package.json'));
    const extensionCjs = lerFonte(path.join(raizPlugin, 'vscode', 'extension.cjs'));
    const bytes = packageJson === null || extensionCjs === null ? null : montarVsix({ versao, packageJson, extensionCjs });
    if (bytes === null) return falhou('extensao-invalida');
    const pasta = path.join(dir, DIR_PAINEL);
    const vsix = path.join(pasta, `${ID_EXTENSAO}-${versao}.vsix`);
    if (!gravarBytes(vsix, bytes)) return falhou('escrita');
    varrerTmpVelhos(pasta, (nome) => TMP_VSIX.test(nome));
    const code = achar({ pathEnv, plataforma, existe, casa, apps });
    if (typeof code !== 'string' || code.length === 0) return falhou('sem-vscode');
    // O `code` segue a regra da plataforma pedida; o .vsix, a do processo, que
    // montou o caminho com path.join (as duas são a mesma fora dos testes).
    const caminhos = plataforma === 'win32' ? path.win32 : path.posix;
    if (!caminhos.isAbsolute(code) || !caminhoSeguro(code, plataforma) || !caminhoSeguro(vsix)) return falhou('caminho-inseguro');
    const r = plataforma === 'win32'
      ? await rodar(executar, caminhoCmd(systemRoot), ['/d', '/s', '/c', `""${code}" --install-extension "${vsix}" --force"`], {
        windowsVerbatimArguments: true, windowsHide: true, timeout: PRAZO_INSTALAR_MS, cwd: pasta,
      })
      : await rodar(executar, code, ['--install-extension', vsix, '--force'], { timeout: PRAZO_INSTALAR_MS, cwd: pasta });
    if (r !== 'ok') return falhou(r);
    apagarVsixAntigos(pasta, path.basename(vsix));
    const g = gravarJsonAtomico(path.join(pasta, ARQ_INSTALADO), { versao, em: new Date(agoraMs).toISOString() });
    return g.ok ? { ok: true, motivo: 'ok' } : falhou('escrita');
  } catch {
    registrar('erro');
    return falha('erro');
  }
}
```

(Se a Task 1 já mudou a desestruturação e a linha do `achar`, o trecho acima já as contém.)

Em `src/hooks/session-start.js`, depois de `if (!shims.ok) saida.push(linhas.linhaShimIndisponivel(shims.motivo));` (linha 139):

```js
  // v0.5.2: a instalação do item do VS Code falhou e a versão atual não está
  // instalada: uma linha com o motivo e o conserto (rótulos fixos). Com
  // HADOUKEN_SEM_PAINEL=1, nada. Um import que falha só tira a linha.
  if (process.env.HADOUKEN_SEM_PAINEL !== '1') {
    try {
      const motivo = (await import('../painel/falha.js')).falhaPendente({ dir, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT });
      if (motivo !== null) saida.push(linhas.linhaPainel(motivo));
    } catch { /* sem a linha do painel nesta sessão */ }
  }
```

E atualizar o item 3 do comentário do topo do arquivo: `// 3. injeta uma linha com o consumo atual, mais uma linha fixa para cada passo anterior que falhou e, se a instalação do item do VS Code falhou (v0.5.2), uma com o motivo;`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/painel-instalar.test.js test/hooks.test.js test/custo-hooks.test.js`
Expected: PASS. Se `test/custo-hooks.test.js` medir os imports do SessionStart e reclamar do `falha.js`, acrescentá-lo à lista de imports esperados ali, com o mesmo comentário dos outros.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(painel): motivo da falha em tentativa.json e linha com o conserto no início de sessão' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add src/painel/instalar-painel.js src/painel/falha.js src/hooks/linha-estado.js src/hooks/session-start.js test/painel-instalar.test.js
git commit -q -F /tmp/msg052
```

(Se o Step 4 mexeu em `test/custo-hooks.test.js`, acrescentá-lo ao `git add`.)

---

### Task 3: terceiros no marketplace com `sha` fixo, kit 1.1.0 e versões 0.5.2

**Files:**
- Modify: `.claude-plugin/marketplace.json`, `kit/.claude-plugin/plugin.json`, `kit/testado.json`, `.claude-plugin/plugin.json`, `package.json`
- Test: `test/kit-manifestos.test.js`, `test/kit-fluxo.test.js`

**Interfaces:**
- Produces: entradas `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills`, `ui-ux-pro-max` no marketplace `claude-hadouken`; chaves `<nome>@claude-hadouken` em `kit/testado.json` (a Task 9 lê e reescreve essas chaves e os `sha`).

- [ ] **Step 1: Escrever os testes que falham**

Em `test/kit-manifestos.test.js`, trocar `ALLOW` e os testes de marketplace, kit, testado e versão por:

```js
// v0.5.2: os terceiros do kit são entradas deste marketplace, com sha fixo;
// só o superpowers continua no marketplace oficial.
const ALLOW = ['claude-plugins-official'];
const TERCEIROS = {
  'mattpocock-skills': { source: 'github', repo: 'mattpocock/skills', sha: '49dd158d1076134a641b33efb035946536778336' },
  'poka-yoke': { source: 'git-subdir', url: 'rainmanjam/poka-yoke', path: 'plugins/poka-yoke', sha: '726a575e3d48d07d908abfcbb192cae09671fff2' },
  'fullstack-dev-skills': { source: 'github', repo: 'jeffallan/claude-skills', sha: '882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf' },
  'ui-ux-pro-max': { source: 'github', repo: 'nextlevelbuilder/ui-ux-pro-max-skill', sha: 'e353a508767c6d39f0e7698b084dbfc8699fffd3' },
};

test('marketplace: as três locais apontam para pasta com plugin.json de mesmo nome e versão', () => {
  const m = ler('.claude-plugin/marketplace.json');
  const locais = m.plugins.filter((p) => typeof p.source === 'string');
  assert.deepEqual(locais.map((p) => p.name).sort(), ['claude-hadouken', 'hadouken-kit', 'hadouken-rea']);
  for (const p of locais) {
    const man = ler(path.join(p.source, '.claude-plugin', 'plugin.json'));
    assert.equal(man.name, p.name, p.source);
    assert.equal(man.version, p.version, `${p.name}: versão do marketplace = do plugin.json`);
  }
});

test('marketplace: cada terceiro com fonte github/git-subdir, sha de 40 hex e sem versão própria', () => {
  const m = ler('.claude-plugin/marketplace.json');
  const terceiros = m.plugins.filter((p) => typeof p.source !== 'string');
  assert.deepEqual(terceiros.map((p) => p.name).sort(), Object.keys(TERCEIROS).sort());
  for (const p of terceiros) {
    assert.deepEqual(p.source, TERCEIROS[p.name], p.name);
    assert.match(p.source.sha, /^[0-9a-f]{40}$/, p.name);
    assert.equal(p.version, undefined, `${p.name}: a versão vem do plugin.json do terceiro`);
  }
});

test('marketplace: allowlist só com o oficial', () => {
  const m = ler('.claude-plugin/marketplace.json');
  assert.deepEqual(m.allowCrossMarketplaceDependenciesOn, ALLOW);
  const kit = ler('kit/.claude-plugin/plugin.json');
  for (const d of kit.dependencies) {
    if (typeof d === 'object' && d.marketplace) assert.ok(ALLOW.includes(d.marketplace), d.name);
  }
});

test('kit: 1.1.0, dependências só por nome (menos o superpowers) e sem faixa de versão', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  assert.equal(kit.name, 'hadouken-kit');
  assert.equal(kit.version, '1.1.0');
  assert.deepEqual(kit.dependencies, [
    'claude-hadouken',
    { name: 'superpowers', marketplace: 'claude-plugins-official' },
    'mattpocock-skills',
    'poka-yoke',
    'fullstack-dev-skills',
    'ui-ux-pro-max',
  ]);
  for (const d of kit.dependencies) if (typeof d === 'object') assert.equal(d.version, undefined, d.name);
});

test('testado.json: uma versão para cada dependência, chaves novas e as mesmas versões', () => {
  const kit = ler('kit/.claude-plugin/plugin.json');
  const t = ler('kit/testado.json');
  const chaves = kit.dependencies.map((d) =>
    typeof d === 'string' ? `${d}@claude-hadouken` : `${d.name}@${d.marketplace}`).sort();
  assert.deepEqual(Object.keys(t.dependencias).sort(), chaves);
  for (const v of Object.values(t.dependencias)) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(t.dependencias, {
    'claude-hadouken@claude-hadouken': '0.5.2',
    'superpowers@claude-plugins-official': '6.4.1',
    'mattpocock-skills@claude-hadouken': '1.3.1',
    'poka-yoke@claude-hadouken': '0.2.0',
    'fullstack-dev-skills@claude-hadouken': '0.4.16',
    'ui-ux-pro-max@claude-hadouken': '2.13.0',
  });
  assert.equal(t.npm['rea-agents'], '6.1.0');
});
```

e trocar o último teste por:

```js
test('claude-hadouken: plugin.json, package.json e marketplace em 0.5.2', () => {
  assert.equal(ler('.claude-plugin/plugin.json').version, '0.5.2');
  assert.equal(ler('package.json').version, '0.5.2');
  assert.equal(ler('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'claude-hadouken').version, '0.5.2');
});
```

(O teste do REA, `version` `1.0.1`, fica como está.)

Em `test/kit-fluxo.test.js`, trocar `t.dependencias['mattpocock-skills@mattpocock']` por `t.dependencias['mattpocock-skills@claude-hadouken']`, e o cache do poka-yoke e do mattpocock passa a ter dois lugares possíveis (o antigo e o do marketplace do Hadouken):

```js
// v0.5.2: depois do comando único, o cache dos terceiros fica sob o
// marketplace claude-hadouken; antes, sob o de cada um. Vale o que existir.
const primeiro = (...ps) => ps.find((p) => fs.existsSync(p)) ?? ps[0];
const CACHE_DE = {
  superpowers: path.join(CACHE, 'claude-plugins-official', 'superpowers', '6.4.1'),
  'poka-yoke': primeiro(path.join(CACHE, 'claude-hadouken', 'poka-yoke', '0.2.0'), path.join(CACHE, 'poka-yoke', 'poka-yoke', '0.2.0')),
};
```

e, na definição de `CACHE_MATT` (procurar com Grep `CACHE_MATT =`), o mesmo `primeiro(path.join(CACHE, 'claude-hadouken', 'mattpocock-skills', '1.3.1'), <o caminho de hoje>)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-manifestos.test.js test/kit-fluxo.test.js`
Expected: FAIL — allowlist, dependências, testado e versões ainda antigos.

- [ ] **Step 3: Implementar**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "claude-hadouken",
  "owner": { "name": "Garioli Labs" },
  "allowCrossMarketplaceDependenciesOn": ["claude-plugins-official"],
  "plugins": [
    { "name": "claude-hadouken", "source": "./", "description": "Usage-aware pacing for Claude Code.", "version": "0.5.2" },
    { "name": "hadouken-kit", "source": "./kit", "description": "The daily skill set (superpowers, Matt Pocock, poka-yoke, fullstack, UI/UX) plus a map of which skill to use at each step.", "version": "1.1.0" },
    { "name": "hadouken-rea", "source": "./rea", "description": "REA reverse-engineering MCP server. Off by default; it runs analyzed programs with your permissions.", "version": "1.0.1" },
    { "name": "mattpocock-skills", "source": { "source": "github", "repo": "mattpocock/skills", "sha": "49dd158d1076134a641b33efb035946536778336" }, "description": "Matt Pocock's skills, pinned to the commit the kit was tested with." },
    { "name": "poka-yoke", "source": { "source": "git-subdir", "url": "rainmanjam/poka-yoke", "path": "plugins/poka-yoke", "sha": "726a575e3d48d07d908abfcbb192cae09671fff2" }, "description": "poka-yoke, pinned to the commit the kit was tested with." },
    { "name": "fullstack-dev-skills", "source": { "source": "github", "repo": "jeffallan/claude-skills", "sha": "882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf" }, "description": "Fullstack dev skills, pinned to the commit the kit was tested with." },
    { "name": "ui-ux-pro-max", "source": { "source": "github", "repo": "nextlevelbuilder/ui-ux-pro-max-skill", "sha": "e353a508767c6d39f0e7698b084dbfc8699fffd3" }, "description": "UI/UX Pro Max, pinned to the commit the kit was tested with." }
  ]
}
```

`kit/.claude-plugin/plugin.json`: `"version": "1.1.0"` e

```json
  "dependencies": [
    "claude-hadouken",
    { "name": "superpowers", "marketplace": "claude-plugins-official" },
    "mattpocock-skills",
    "poka-yoke",
    "fullstack-dev-skills",
    "ui-ux-pro-max"
  ]
```

`kit/testado.json`:

```json
{
  "dependencias": {
    "claude-hadouken@claude-hadouken": "0.5.2",
    "superpowers@claude-plugins-official": "6.4.1",
    "mattpocock-skills@claude-hadouken": "1.3.1",
    "poka-yoke@claude-hadouken": "0.2.0",
    "fullstack-dev-skills@claude-hadouken": "0.4.16",
    "ui-ux-pro-max@claude-hadouken": "2.13.0"
  },
  "npm": { "rea-agents": "6.1.0" }
}
```

`.claude-plugin/plugin.json` e `package.json`: `"version": "0.5.2"`.

O `test/kit-versoes.test.js` de hoje confere `fontes` contra as chaves do `testado.json` e vai quebrar; ele sai inteiro na Task 9. Para a suíte ficar verde até lá, apagar agora só o teste `'fontes: cada dependência do testado.json tem de onde ler'` desse arquivo (linhas ~84-95).

- [ ] **Step 4: Validar o marketplace com o próprio Claude Code e rodar a suíte**

Run: `claude plugin validate .` (na raiz do repo; se o subcomando não existir nesta versão, pular e anotar no relatório)
Expected: sem erro de esquema nas entradas novas.

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(kit): terceiros no marketplace do Hadouken com sha fixo; kit 1.1.0; versão 0.5.2' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add .claude-plugin/marketplace.json .claude-plugin/plugin.json package.json kit/.claude-plugin/plugin.json kit/testado.json test/kit-manifestos.test.js test/kit-fluxo.test.js test/kit-versoes.test.js
git commit -q -F /tmp/msg052
```

---

### Task 4: atualização automática no settings do usuário

**Files:**
- Create: `src/instalar/atualizacao-auto.js`
- Test: `test/instalar-atualizacao.test.js`

**Interfaces:**
- Consumes: `lerSettings(arquivo)` → `{ ok, existe, settings, bytes, texto, info, formato }`; `bloqueioDeEscrita(lido)` → falha ou `null`; `gravarSettings(arquivo, lido, valor, agoraMs)` → `{ ok, backup }` (todos de `src/configuracao.js:691`). `lerJson` de `src/estado.js`.
- Produces: `ligarAtualizacao({ arquivo, agoraMs })` → `{ ok: true, acao: 'gravado' | 'ja-estava', desligadas: string[], backup: string | null }` ou `{ ok: false, motivo }` (motivos de `lerSettings`/`bloqueioDeEscrita`/`gravarSettings`, mais `'argumentos'`, `'settings-invalido'`, `'outra-fonte'`, `'erro-interno'`). `marketplaceConhecido(arquivoKnown)` → `'nossa' | 'outra' | 'ausente'`. Constantes `MARKETPLACE`, `FONTE`, `COPIAS_ANTIGAS`.

Decisão de execução (preservar o que existe, spec "Atualização automática" peça 2): uma entrada `claude-hadouken` que já tem `source` de outra fonte (ex.: `directory`, de quem desenvolve o plugin) não é tocada — `'outra-fonte'`, que o instalador mostra como pulado.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/instalar-atualizacao.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COPIAS_ANTIGAS, FONTE, ligarAtualizacao, marketplaceConhecido } from '../src/instalar/atualizacao-auto.js';

// v0.5.2, atualização automática (spec, peça 2): extraKnownMarketplaces com
// autoUpdate e as cópias antigas dos terceiros desligadas, pelo gravador
// seguro da barra. Settings sempre em pasta temporária.

const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk auto ç '));
  pastas.push(d);
  return d;
};
const AGORA = Date.parse('2026-10-15T12:00:00Z');
const lerArq = (a) => JSON.parse(fs.readFileSync(a, 'utf8'));
const backups = (a) => fs.readdirSync(path.dirname(a)).filter((n) => n.startsWith(`${path.basename(a)}.bak-hadouken-`)).sort();
const NOSSA = { source: 'github', repo: 'Garioli-Labs/claude-hadouken' };

test('constantes: a fonte do marketplace e as quatro cópias antigas', () => {
  assert.deepEqual(FONTE, NOSSA);
  assert.deepEqual(COPIAS_ANTIGAS, ['mattpocock-skills@mattpocock', 'poka-yoke@poka-yoke', 'fullstack-dev-skills@fullstack-dev-skills', 'ui-ux-pro-max@ui-ux-pro-max-skill']);
});

test('settings ausente: cria com a entrada do marketplace e autoUpdate', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  assert.deepEqual(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA }), { ok: true, acao: 'gravado', desligadas: [], backup: null });
  assert.deepEqual(lerArq(arq), { extraKnownMarketplaces: { 'claude-hadouken': { source: NOSSA, autoUpdate: true } } });
});

test('preserva as outras chaves do arquivo e da entrada, com backup dos bytes de antes', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  const antes = {
    theme: 'dark',
    extraKnownMarketplaces: { outro: { source: { source: 'github', repo: 'a/b' } }, 'claude-hadouken': { source: NOSSA, extra: 1 } },
  };
  fs.writeFileSync(arq, JSON.stringify(antes, null, 2));
  const bytes = fs.readFileSync(arq);
  const r = ligarAtualizacao({ arquivo: arq, agoraMs: AGORA });
  assert.equal(r.acao, 'gravado');
  assert.deepEqual(lerArq(arq), {
    theme: 'dark',
    extraKnownMarketplaces: { outro: antes.extraKnownMarketplaces.outro, 'claude-hadouken': { source: NOSSA, extra: 1, autoUpdate: true } },
  });
  assert.deepEqual(fs.readFileSync(r.backup), bytes);
});

test('segunda rodada: não regrava nem cria backup', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  fs.writeFileSync(arq, '{ "theme": "dark" }\n');
  assert.equal(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA }).acao, 'gravado');
  const bytes = fs.readFileSync(arq);
  const bk = backups(arq);
  assert.deepEqual(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA + 1000 }), { ok: true, acao: 'ja-estava', desligadas: [], backup: null });
  assert.deepEqual(fs.readFileSync(arq), bytes);
  assert.deepEqual(backups(arq), bk);
});

test('cópias antigas: true vira false; ausente não entra; false fica; outros plugins intactos', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  fs.writeFileSync(arq, JSON.stringify({
    extraKnownMarketplaces: { 'claude-hadouken': { source: NOSSA, autoUpdate: true } },
    enabledPlugins: { 'mattpocock-skills@mattpocock': true, 'poka-yoke@poka-yoke': false, 'outro@x': true },
  }));
  const r = ligarAtualizacao({ arquivo: arq, agoraMs: AGORA });
  assert.equal(r.acao, 'gravado', 'a entrada já estava, mas havia cópia antiga ligada');
  assert.deepEqual(r.desligadas, ['mattpocock-skills@mattpocock']);
  assert.deepEqual(lerArq(arq).enabledPlugins, { 'mattpocock-skills@mattpocock': false, 'poka-yoke@poka-yoke': false, 'outro@x': true });
});

test('entrada de outra fonte (ex.: directory de quem desenvolve) não é tocada', () => {
  const arq = path.join(novoTmp(), 'settings.json');
  fs.writeFileSync(arq, JSON.stringify({ extraKnownMarketplaces: { 'claude-hadouken': { source: { source: 'directory', path: 'C:/dev/claude-hadouken' } } } }));
  const bytes = fs.readFileSync(arq);
  assert.deepEqual(ligarAtualizacao({ arquivo: arq, agoraMs: AGORA }), { ok: false, motivo: 'outra-fonte' });
  assert.deepEqual(fs.readFileSync(arq), bytes);
});

test('recusas do gravador viram motivo, sem tocar no arquivo', (t) => {
  const d = novoTmp();
  const invalido = path.join(d, 'invalido.json');
  fs.writeFileSync(invalido, '{');
  assert.deepEqual(ligarAtualizacao({ arquivo: invalido, agoraMs: AGORA }), { ok: false, motivo: 'settings-invalido' });
  const forma = path.join(d, 'forma.json');
  fs.writeFileSync(forma, JSON.stringify({ extraKnownMarketplaces: [] }));
  assert.deepEqual(ligarAtualizacao({ arquivo: forma, agoraMs: AGORA }), { ok: false, motivo: 'settings-invalido' });
  const leitura = path.join(d, 'leitura.json');
  fs.writeFileSync(leitura, '{}');
  fs.chmodSync(leitura, 0o444);
  if (process.getuid?.() !== 0) assert.deepEqual(ligarAtualizacao({ arquivo: leitura, agoraMs: AGORA }), { ok: false, motivo: 'settings-somente-leitura' });
  fs.chmodSync(leitura, 0o644);
  for (const ruim of [{ arquivo: 'relativo.json', agoraMs: AGORA }, { arquivo: leitura, agoraMs: -1 }, null]) {
    assert.deepEqual(ligarAtualizacao(ruim), { ok: false, motivo: 'argumentos' });
  }
  const alvo = path.join(d, 'alvo.json');
  fs.writeFileSync(alvo, '{}');
  const link = path.join(d, 'link.json');
  try { fs.symlinkSync(alvo, link); } catch { t.diagnostic('sem permissão para criar link: parte do link pulada'); return; }
  assert.deepEqual(ligarAtualizacao({ arquivo: link, agoraMs: AGORA }), { ok: false, motivo: 'settings-link' });
});

test('marketplaceConhecido: ausente, nossa ou outra', () => {
  const d = novoTmp();
  const arq = path.join(d, 'known_marketplaces.json');
  assert.equal(marketplaceConhecido(arq), 'ausente');
  fs.writeFileSync(arq, JSON.stringify({ 'claude-hadouken': { source: NOSSA, installLocation: 'x' } }));
  assert.equal(marketplaceConhecido(arq), 'nossa');
  fs.writeFileSync(arq, JSON.stringify({ 'claude-hadouken': { source: { source: 'git', url: 'https://example.com/x.git' } } }));
  assert.equal(marketplaceConhecido(arq), 'outra');
  fs.writeFileSync(arq, '{');
  assert.equal(marketplaceConhecido(arq), 'ausente');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/instalar-atualizacao.test.js`
Expected: FAIL — módulo `src/instalar/atualizacao-auto.js` não existe.

- [ ] **Step 3: Implementar**

Criar `src/instalar/atualizacao-auto.js`:

```js
import path from 'node:path';
import { bloqueioDeEscrita, gravarSettings, lerSettings } from '../configuracao.js';
import { lerJson } from '../estado.js';

// Atualização automática (spec v0.5.2, "Atualização automática", peça 2).
// Fora de sessão, o instalador grava no settings.json do usuário
// extraKnownMarketplaces["claude-hadouken"] com a fonte do GitHub e
// autoUpdate: true (essa chave vence a de known_marketplaces.json), e põe
// false em enabledPlugins para as cópias antigas dos terceiros que estiverem
// true, para as skills não aparecerem em dobro. Tudo pelo gravador da barra
// (configuracao.js): sem link, teto, UTF-8 estrito, formato do original,
// backup e troca conferida pelo lstat. Preserva o resto do arquivo e da
// entrada; uma entrada com fonte de outro lugar (ex.: directory, de quem
// desenvolve o plugin) não é tocada ('outra-fonte'). Nada é desinstalado:
// desfazer é pôr true de volta. Nunca lança.

export const MARKETPLACE = 'claude-hadouken';
export const FONTE = Object.freeze({ source: 'github', repo: 'Garioli-Labs/claude-hadouken' });
export const COPIAS_ANTIGAS = Object.freeze([
  'mattpocock-skills@mattpocock', 'poka-yoke@poka-yoke', 'fullstack-dev-skills@fullstack-dev-skills', 'ui-ux-pro-max@ui-ux-pro-max-skill',
]);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (motivo) => ({ ok: false, motivo });
const fonteNossa = (s) => ehObjeto(s) && s.source === FONTE.source && s.repo === FONTE.repo;
const arquivoValido = (a) => typeof a === 'string' && a.length > 0 && !a.includes('\0') && path.isAbsolute(a);

export function ligarAtualizacao(opcoes) {
  try {
    const { arquivo, agoraMs } = ehObjeto(opcoes) ? opcoes : {};
    if (!arquivoValido(arquivo) || !Number.isSafeInteger(agoraMs) || agoraMs < 0) return falha('argumentos');
    const lido = lerSettings(arquivo);
    if (!lido.ok) return falha(lido.motivo);
    const s = lido.existe ? lido.settings : {};
    const ekm = s.extraKnownMarketplaces;
    const ep = s.enabledPlugins;
    if ((ekm !== undefined && !ehObjeto(ekm)) || (ep !== undefined && !ehObjeto(ep))) return falha('settings-invalido');
    const atual = ekm !== undefined && Object.hasOwn(ekm, MARKETPLACE) ? ekm[MARKETPLACE] : undefined;
    if (atual !== undefined && !ehObjeto(atual)) return falha('settings-invalido');
    if (atual !== undefined && Object.hasOwn(atual, 'source') && !fonteNossa(atual.source)) return falha('outra-fonte');
    const desligar = COPIAS_ANTIGAS.filter((k) => ep !== undefined && Object.hasOwn(ep, k) && ep[k] === true);
    const pronta = atual !== undefined && fonteNossa(atual.source) && atual.autoUpdate === true;
    if (pronta && desligar.length === 0) return { ok: true, acao: 'ja-estava', desligadas: [], backup: null };
    const bloqueio = bloqueioDeEscrita(lido);
    if (bloqueio !== null) return falha(bloqueio.motivo);
    const entrada = { ...(atual ?? {}), source: atual?.source ?? { ...FONTE }, autoUpdate: true };
    const novo = { ...s, extraKnownMarketplaces: { ...(ekm ?? {}), [MARKETPLACE]: entrada } };
    if (desligar.length > 0) novo.enabledPlugins = { ...ep, ...Object.fromEntries(desligar.map((k) => [k, false])) };
    const g = gravarSettings(arquivo, lido, novo, agoraMs);
    return g.ok ? { ok: true, acao: 'gravado', desligadas: desligar, backup: g.backup } : falha(g.motivo);
  } catch {
    return falha('erro-interno');
  }
}

// O marketplace claude-hadouken em <config>/plugins/known_marketplaces.json
// (onde o `claude plugin marketplace add` o registra): 'nossa' (GitHub
// Garioli-Labs/claude-hadouken), 'outra' (qualquer outra fonte) ou 'ausente'
// (sem arquivo, ilegível ou sem a entrada). Nunca lança.
export function marketplaceConhecido(arquivo) {
  try {
    const r = lerJson(arquivo, 1024 * 1024);
    if (!r.ok || !ehObjeto(r.valor) || !Object.hasOwn(r.valor, MARKETPLACE)) return 'ausente';
    const e = r.valor[MARKETPLACE];
    return ehObjeto(e) && fonteNossa(e.source) ? 'nossa' : 'outra';
  } catch {
    return 'ausente';
  }
}
```

Conferir antes de rodar: o nome do backup é `<arquivo>.bak-hadouken-<agoraMs>` (constante `SUFIXO_BACKUP` em `src/configuracao.js`); se for outro, ajustar o filtro `backups()` do teste.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/instalar-atualizacao.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(instalar): atualização automática do marketplace e cópias antigas desligadas no settings' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add src/instalar/atualizacao-auto.js test/instalar-atualizacao.test.js
git commit -q -F /tmp/msg052
```

---

### Task 5: rodar o `claude`, ler a lista de plugins, passos do kit e do REA

**Files:**
- Create: `src/instalar/itens.js`, `src/instalar/claude-cli.js`, `test/dados/instalador/claude-falso.mjs`
- Test: `test/instalar-claude-cli.test.js`

**Interfaces:**
- Consumes: `caminhoCmd(systemRoot)`, `caminhoSeguro(p, plataforma)` (`src/painel/instalar-painel.js`); `nodeServe(versao)` → `boolean` (`rea/lancar.mjs:20`, que só roda o lançador quando é o processo principal).
- Produces:
  - `item.ok(nome, detalhe)`, `item.igual(nome)`, `item.pulado(nome, motivo)`, `item.falhou(nome, motivo, conserto)` → `{ nome, estado: 'ok'|'igual'|'pulado'|'falhou', detalhe, conserto? }`; `formatarResumo(itens)` → `string`; `codigoDeSaida(itens)` → `0 | 1` (`src/instalar/itens.js`).
  - `criarClaude({ exe, plataforma, executar, systemRoot, ambiente, cwd })` → `rodar(args, prazoMs?)` → `Promise<{ ok, motivo: 'ok'|'erro'|'tempo'|'claude-invalido'|'argumentos', saida }>`; `listarPlugins(rodar)` → `Map<id, { version, enabled, installPath }> | null`; `passoPlugin(rodar, id, nome)` → `{ item, entrada }`; `passoRea(rodar, versaoNode)` → `item`; `ID_PRINCIPAL`, `ID_KIT`, `ID_REA` (`src/instalar/claude-cli.js`).
  - `responder(estado, args)` → `{ codigo, saida }`, `rodarFalso(estado)` → `rodar`, `instalarFalso(pasta)` → caminho do `claude` (ou `claude.cmd`) falso, `CATALOGO` (`test/dados/instalador/claude-falso.mjs`). Estado: `{ plugins: [], log: [], raiz, versao?, falhar?: string[] }`.

- [ ] **Step 1: Criar o `claude` falso (apoio dos testes)**

Criar `test/dados/instalador/claude-falso.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `claude` falso dos testes do instalador (v0.5.2). `responder` é pura sobre
// o estado { plugins, log, raiz, versao?, falhar? }; rodado como programa
// (pelo invólucro de instalarFalso), lê e regrava o estado no arquivo de
// FALSO_ESTADO. Com FALSO_COMER_STDIN=1, lê a entrada inteira antes, como um
// comando que comeria o resto de um `curl | bash`.

export const CATALOGO = Object.freeze({
  'claude-hadouken@claude-hadouken': '0.5.2',
  'hadouken-kit@claude-hadouken': '1.1.0',
  'hadouken-rea@claude-hadouken': '1.0.1',
});
const ARQUIVO = fileURLToPath(import.meta.url);

export function responder(estado, args) {
  estado.log.push(args.join(' '));
  const [a, b, c] = args;
  const nada = (codigo) => ({ codigo, saida: '' });
  if (a === '--version') return { codigo: 0, saida: `${estado.versao ?? '2.1.301'} (Claude Code)\n` };
  if (a === 'update') {
    estado.versao = '2.1.301';
    return nada(0);
  }
  if (a !== 'plugin') return nada(1);
  if ((estado.falhar ?? []).includes(args.slice(1).join(' '))) return nada(1);
  if (b === 'marketplace') return nada(0);
  if (b === 'list') return { codigo: 0, saida: JSON.stringify(estado.plugins) };
  const p = estado.plugins.find((x) => x.id === c);
  if (b === 'install') {
    if (!Object.hasOwn(CATALOGO, c)) return nada(1);
    if (!p) estado.plugins.push({ id: c, version: CATALOGO[c], scope: 'user', enabled: !c.startsWith('hadouken-rea@'), installPath: `${estado.raiz}/${c.split('@')[0]}` });
    return nada(0);
  }
  if (b === 'update') {
    if (p) p.version = CATALOGO[c];
    return nada(p ? 0 : 1);
  }
  if (b === 'enable' || b === 'disable') {
    if (p) p.enabled = b === 'enable';
    return nada(p ? 0 : 1);
  }
  return nada(1);
}

// O `rodar` de criarClaude, em processo, sobre o mesmo estado.
export function rodarFalso(estado) {
  return async (args) => {
    const r = responder(estado, args);
    return { ok: r.codigo === 0, motivo: r.codigo === 0 ? 'ok' : 'erro', saida: r.saida };
  };
}

// Grava o invólucro executável na pasta: claude.cmd no Windows, claude (sh)
// fora dele. Devolve o caminho.
export function instalarFalso(pasta) {
  if (process.platform === 'win32') {
    const alvo = path.join(pasta, 'claude.cmd');
    fs.writeFileSync(alvo, `@"${process.execPath}" "${ARQUIVO}" %*\r\n`);
    return alvo;
  }
  const alvo = path.join(pasta, 'claude');
  fs.writeFileSync(alvo, `#!/bin/sh\nexec "${process.execPath}" "${ARQUIVO}" "$@"\n`, { mode: 0o755 });
  return alvo;
}

let principal = false;
try {
  principal = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(ARQUIVO);
} catch { /* importado */ }
if (principal) {
  if (process.env.FALSO_COMER_STDIN === '1') {
    try { fs.readFileSync(0); } catch { /* sem entrada */ }
  }
  const arq = process.env.FALSO_ESTADO;
  const estado = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const r = responder(estado, process.argv.slice(2));
  fs.writeFileSync(arq, JSON.stringify(estado));
  process.stdout.write(r.saida);
  process.exitCode = r.codigo;
}
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `test/instalar-claude-cli.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarClaude, ID_KIT, ID_PRINCIPAL, ID_REA, listarPlugins, passoPlugin, passoRea } from '../src/instalar/claude-cli.js';
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/instalar-claude-cli.test.js`
Expected: FAIL — `src/instalar/claude-cli.js` não existe.

- [ ] **Step 4: Implementar**

Criar `src/instalar/itens.js`:

```js
// Itens do resumo do instalador (spec v0.5.2 §7). Rótulos fixos deste
// projeto; nenhum texto de fora (saída do claude, winget, brew, pip) entra.
export const item = Object.freeze({
  ok: (nome, detalhe) => ({ nome, estado: 'ok', detalhe }),
  igual: (nome) => ({ nome, estado: 'igual', detalhe: 'já estava' }),
  pulado: (nome, motivo) => ({ nome, estado: 'pulado', detalhe: motivo }),
  falhou: (nome, motivo, conserto) => ({ nome, estado: 'falhou', detalhe: motivo, conserto }),
});

export function formatarResumo(itens) {
  const linhas = itens.map((i) => {
    if (i.estado === 'igual') return `= ${i.nome}: já estava`;
    if (i.estado === 'pulado') return `– ${i.nome}: pulado (${i.detalhe})`;
    if (i.estado === 'falhou') return `✗ ${i.nome}: falhou (${i.detalhe}${i.conserto ? `; ${i.conserto}` : ''})`;
    return `✓ ${i.nome}: ${i.detalhe}`;
  });
  linhas.push('', 'Abra uma sessão nova do Claude Code.');
  return linhas.join('\n');
}

export const codigoDeSaida = (itens) => (itens.some((i) => i.estado === 'falhou') ? 1 : 0);
```

Criar `src/instalar/claude-cli.js`:

```js
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { nodeServe } from '../../rea/lancar.mjs';
import { caminhoCmd, caminhoSeguro } from '../painel/instalar-painel.js';
import { item } from './itens.js';

// O `claude` do instalador (spec v0.5.2 §4 e §6). criarClaude devolve um
// `rodar(args)` que nunca rejeita. O caminho do claude vem do script
// (HADOUKEN_CLAUDE) e passa no caminhoSeguro; cada argumento é constante
// deste projeto e casa com ARG. No Windows, o claude.cmd do npm só roda por
// um shell: cmd.exe /d /s /c do System32 com a linha entre aspas e
// windowsVerbatimArguments, como o painel (instalar-painel.js). O cwd é a
// casa do usuário, nunca o projeto aberto. A verdade de cada passo é o
// `claude plugin list --json` depois dele, nunca o texto da saída.

export const ID_PRINCIPAL = 'claude-hadouken@claude-hadouken';
export const ID_KIT = 'hadouken-kit@claude-hadouken';
export const ID_REA = 'hadouken-rea@claude-hadouken';
export const PRAZO_CLAUDE_MS = 600_000;
const PRAZO_LISTA_MS = 60_000;
const ARG = /^[A-Za-z0-9@._:/=-]+$/;
const VERSAO = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const versao = (v) => (typeof v === 'string' && VERSAO.test(v) ? v : '?');
const casaPadrao = () => {
  try {
    return os.homedir();
  } catch {
    return undefined;
  }
};

export function criarClaude({ exe, plataforma = process.platform, executar = execFile, systemRoot = process.env.SystemRoot, ambiente = process.env, cwd = casaPadrao() } = {}) {
  const win = plataforma === 'win32';
  const caminhos = win ? path.win32 : path.posix;
  const valido = typeof exe === 'string' && caminhos.isAbsolute(exe) && caminhoSeguro(exe, plataforma);
  const viaCmd = valido && win && /\.(cmd|bat)$/i.test(exe);
  return (args, prazoMs = PRAZO_CLAUDE_MS) => new Promise((resolve) => {
    if (!valido) return resolve({ ok: false, motivo: 'claude-invalido', saida: '' });
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && ARG.test(a))) return resolve({ ok: false, motivo: 'argumentos', saida: '' });
    const opcoes = { windowsHide: true, timeout: prazoMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env: ambiente, cwd };
    const [arquivo, lista] = viaCmd ? [caminhoCmd(systemRoot), ['/d', '/s', '/c', `""${exe}" ${args.join(' ')}"`]] : [exe, args];
    if (viaCmd) opcoes.windowsVerbatimArguments = true;
    try {
      executar(arquivo, lista, opcoes, (erro, stdout) => {
        const saida = typeof stdout === 'string' ? stdout : String(stdout ?? '');
        if (!erro) resolve({ ok: true, motivo: 'ok', saida });
        else resolve({ ok: false, motivo: erro.killed === true || typeof erro.signal === 'string' ? 'tempo' : 'erro', saida });
      });
    } catch {
      resolve({ ok: false, motivo: 'erro', saida: '' });
    }
  });
}

// `claude plugin list --json`: id → { version, enabled, installPath }, só
// escopo user (ou sem escopo). Saída que não é uma lista JSON: null.
export async function listarPlugins(rodar) {
  const r = await rodar(['plugin', 'list', '--json'], PRAZO_LISTA_MS);
  if (!r.ok) return null;
  let lista;
  try {
    lista = JSON.parse(r.saida);
  } catch {
    return null;
  }
  if (!Array.isArray(lista)) return null;
  const mapa = new Map();
  for (const p of lista) {
    if (!ehObjeto(p) || typeof p.id !== 'string' || (p.scope !== undefined && p.scope !== 'user')) continue;
    mapa.set(p.id, {
      version: typeof p.version === 'string' ? p.version : null,
      enabled: p.enabled === true,
      installPath: typeof p.installPath === 'string' ? p.installPath : null,
    });
  }
  return mapa;
}

// Instala (ausente) ou atualiza (presente) e confere pela lista.
export async function passoPlugin(rodar, id, nome) {
  const antes = await listarPlugins(rodar);
  if (antes === null) return { item: item.falhou(nome, 'claude plugin list falhou', 'rode claude plugin list'), entrada: null };
  const tinha = antes.get(id);
  await rodar(['plugin', tinha ? 'update' : 'install', id]);
  const e = (await listarPlugins(rodar))?.get(id) ?? null;
  if (e === null) return { item: item.falhou(nome, 'não instalou', `rode claude plugin install ${id}`), entrada: null };
  if (!tinha) return { item: item.ok(nome, `instalado (${versao(e.version)})`), entrada: e };
  if (tinha.version === e.version) return { item: item.igual(nome), entrada: e };
  return { item: item.ok(nome, `atualizado (${versao(tinha.version)} → ${versao(e.version)})`), entrada: e };
}

// O REA: instala ou atualiza; liga com Node aceito pelo rea-agents
// (nodeServe), desliga e marca pulado com Node fora da faixa.
export async function passoRea(rodar, versaoNode) {
  const nome = 'hadouken-rea';
  const p = await passoPlugin(rodar, ID_REA, nome);
  if (p.entrada === null) return p.item;
  const quer = nodeServe(versaoNode);
  const pulado = item.pulado(nome, `Node ${versao(versaoNode)}; o REA pede 22.19+, 24.11+ ou 26+`);
  if (p.entrada.enabled === quer) return quer ? p.item : pulado;
  await rodar(['plugin', quer ? 'enable' : 'disable', ID_REA]);
  const e = (await listarPlugins(rodar))?.get(ID_REA);
  if (!e || e.enabled !== quer) return item.falhou(nome, quer ? 'não ligou' : 'não desligou', `rode claude plugin ${quer ? 'enable' : 'disable'} ${ID_REA}`);
  if (!quer) return pulado;
  return p.item.estado === 'igual' ? item.ok(nome, 'ligado') : item.ok(nome, `${p.item.detalhe}, ligado`);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/instalar-claude-cli.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' 'feat(instalar): claude do instalador (inclusive .cmd), lista de plugins e passos do kit e do REA' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add src/instalar/itens.js src/instalar/claude-cli.js test/dados/instalador/claude-falso.mjs test/instalar-claude-cli.test.js
git commit -q -F /tmp/msg052
```

---

### Task 6: `src/instalar-tudo.js` (passos 6 e 7 da spec)

**Files:**
- Create: `src/instalar-tudo.js`
- Test: `test/instalar-tudo.test.js`

**Interfaces:**
- Consumes: tudo da Task 4 e da Task 5; `arquivoSettings()` → `{ ok, arquivo } | { ok: false, motivo }` e `aplicarStatusline({ arquivo, substituir, agoraMs })` → `{ ok, acao: 'instalar'|'substituir'|'atualizar'|'ja-instalado', backup }` ou `{ ok: false, motivo: 'conflito'|… }` (`src/configuracao.js`); `sincronizarShims(raiz)` → `{ ok: true, alterados: string[] } | { ok: false, motivo }` (`src/shim.js:314`); `instalarPainel({ dir, raizPlugin, agoraMs })` e `versaoDoPlugin(raiz)` (`src/painel/instalar-painel.js`); `dirDados()` (`src/base.js`); `lerJson` (`src/estado.js`); `ligadoExiste(dir)` (`src/aprendizado/arquivos.js:76`); `previa({ dir, arquivo, ambiente })` → `{ ok, plano, assinatura, codigo }` e `ligar({ dir, arquivo, ambiente, codigo, agoraMs })` → `{ ok, motivo? }` (`src/aprendizado/ligar.js:49` e `:192`).
- Produces: `lerOpcoes(argv)` → `{ sim, substituirBarra, semExtras, comAprendizado, desconhecidas }`; `respostaSim(texto, padrao)`; `instalarTudo({ opcoes, rodar, versaoNode, agoraMs, raizPlugin, ambiente, perguntar, plataforma, escrever, deps })` → `Promise<item[]>`; `main(argv, ambiente)` → `Promise<0|1|2>`. Executável: `node src/instalar-tudo.js [opções]` com `HADOUKEN_CLAUDE`; o script da Task 7/8 o chama.

Ordem dos itens no resumo: `hadouken-kit`, `hadouken-rea`, `atualização automática`, `arquivos da barra`, `barra`, `item do VS Code`, `aprendizado`, e, sem `--sem-extras`, `graphify` e `ferramentas da yu-ux`. Três gravações podem tocar o mesmo settings.json no mesmo segundo; o nome do backup leva o `agoraMs`, então cada uma usa um: atualização `agoraMs`, barra `agoraMs + 1`, aprendizado `agoraMs + 2` (senão a segunda dá `backup-existe`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/instalar-tudo.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarTudo, lerOpcoes, respostaSim } from '../src/instalar-tudo.js';
import { ID_KIT, ID_REA } from '../src/instalar/claude-cli.js';
import { versaoDoPlugin } from '../src/painel/instalar-painel.js';
import { instalarFalso, rodarFalso } from './dados/instalador/claude-falso.mjs';

// Instalador, passos 6 e 7 (spec v0.5.2). Tudo em pasta temporária: settings
// por HADOUKEN_SETTINGS, pasta de dados por HADOUKEN_HOME, CLAUDE_CONFIG_DIR
// no `ambiente`; o claude é o falso, o painel e o aprendizado são injetados.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AGORA = Date.parse('2026-10-15T12:00:00Z');
const ENV_ANTES = { HADOUKEN_HOME: process.env.HADOUKEN_HOME, HADOUKEN_SETTINGS: process.env.HADOUKEN_SETTINGS };
const pastas = [];
after(() => {
  for (const [k, v] of Object.entries(ENV_ANTES)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const novoTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk tudo '));
  pastas.push(d);
  return d;
};

function cenario(settings) {
  const casa = novoTmp();
  const arq = path.join(casa, 'settings.json');
  if (settings !== undefined) fs.writeFileSync(arq, JSON.stringify(settings, null, 2));
  process.env.HADOUKEN_HOME = path.join(casa, 'hadouken');
  process.env.HADOUKEN_SETTINGS = arq;
  const estado = { plugins: [], log: [], raiz: casa };
  return { casa, arq, estado, rodar: rodarFalso(estado) };
}
// O painel falso grava instalado.json como o de verdade, para a segunda rodada.
async function painelBom({ dir, raizPlugin }) {
  fs.mkdirSync(path.join(dir, 'painel'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'painel', 'instalado.json'), JSON.stringify({ versao: versaoDoPlugin(raizPlugin), em: new Date(AGORA).toISOString() }));
  return { ok: true, motivo: 'ok' };
}
const naoPergunta = async () => assert.fail('não pergunta');
function rodarTudo(c, { argv = ['--sim', '--sem-extras'], deps = {}, ...resto } = {}) {
  return instalarTudo({
    opcoes: lerOpcoes(argv), rodar: c.rodar, versaoNode: '24.11.0', agoraMs: AGORA, ambiente: { CLAUDE_CONFIG_DIR: c.casa },
    perguntar: naoPergunta, escrever: () => {}, deps: { instalar: painelBom, ...deps }, ...resto,
  });
}
const estados = (itens) => itens.map((i) => [i.nome, i.estado]);
const backups = (arq) => fs.readdirSync(path.dirname(arq)).filter((n) => n.startsWith(`${path.basename(arq)}.bak-hadouken-`)).sort();

test('lerOpcoes e respostaSim', () => {
  assert.deepEqual(lerOpcoes(['--sim', '--com-aprendizado', '--xyz']), { sim: true, substituirBarra: false, semExtras: false, comAprendizado: true, desconhecidas: ['--xyz'] });
  for (const s of ['s', 'S', 'sim', ' y ', 'yes']) assert.equal(respostaSim(s, false), true, s);
  for (const n of ['n', 'não', 'x']) assert.equal(respostaSim(n, true), false, n);
  assert.equal(respostaSim('', true), true);
  assert.equal(respostaSim('', false), false);
  assert.equal(respostaSim(null, true), false, 'sem tty é não');
});

test('instalação nova: cada item, na ordem, e os comandos do claude', async () => {
  const c = cenario();
  const itens = await rodarTudo(c);
  assert.deepEqual(estados(itens), [
    ['hadouken-kit', 'ok'], ['hadouken-rea', 'ok'], ['atualização automática', 'ok'], ['arquivos da barra', 'ok'],
    ['barra', 'ok'], ['item do VS Code', 'ok'], ['aprendizado', 'pulado'],
  ]);
  assert.deepEqual(c.estado.log, [
    'plugin marketplace add anthropics/claude-plugins-official',
    'plugin list --json', `plugin install ${ID_KIT}`, 'plugin list --json',
    'plugin list --json', `plugin install ${ID_REA}`, 'plugin list --json', `plugin enable ${ID_REA}`, 'plugin list --json',
  ]);
  const s = JSON.parse(fs.readFileSync(c.arq, 'utf8'));
  assert.equal(s.extraKnownMarketplaces['claude-hadouken'].autoUpdate, true);
  assert.match(s.statusLine.command, /statusline\.mjs/);
});

test('segunda rodada: = em tudo, settings e backups intocados', async () => {
  const c = cenario({ theme: 'dark' });
  await rodarTudo(c);
  const bytes = fs.readFileSync(c.arq);
  const bk = backups(c.arq);
  const itens = await rodarTudo(c);
  assert.deepEqual(estados(itens), [
    ['hadouken-kit', 'igual'], ['hadouken-rea', 'igual'], ['atualização automática', 'igual'], ['arquivos da barra', 'igual'],
    ['barra', 'igual'], ['item do VS Code', 'igual'], ['aprendizado', 'pulado'],
  ]);
  assert.deepEqual(fs.readFileSync(c.arq), bytes);
  assert.deepEqual(backups(c.arq), bk);
});

test('atualização e barra no mesmo settings: dois backups, um por gravação', async () => {
  const c = cenario({ theme: 'dark' });
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'barra').estado, 'ok');
  assert.equal(backups(c.arq).length, 2);
});

test('outra barra: --sim não troca; --substituir-barra troca; a pergunta decide sem --sim', async () => {
  const outra = { statusLine: { type: 'command', command: 'outra' } };
  let c = cenario(outra);
  assert.deepEqual((await rodarTudo(c)).find((i) => i.nome === 'barra'), { nome: 'barra', estado: 'pulado', detalhe: 'outra barra; rode de novo com --substituir-barra' });
  assert.equal(JSON.parse(fs.readFileSync(c.arq, 'utf8')).statusLine.command, 'outra');
  c = cenario(outra);
  assert.equal((await rodarTudo(c, { argv: ['--sim', '--sem-extras', '--substituir-barra'] })).find((i) => i.nome === 'barra').estado, 'ok');
  assert.match(JSON.parse(fs.readFileSync(c.arq, 'utf8')).statusLine.command, /statusline\.mjs/);
  for (const [resposta, esperado] of [[true, 'ok'], [false, 'pulado']]) {
    c = cenario(outra);
    const perguntas = [];
    const perguntar = async (texto) => { perguntas.push(texto); return texto.includes('barra') ? resposta : false; };
    const itens = await rodarTudo(c, { argv: ['--sem-extras'], perguntar });
    assert.equal(itens.find((i) => i.nome === 'barra').estado, esperado);
    assert.ok(perguntas.some((t) => t.includes('[s/N]') && t.includes('barra')));
  }
});

test('REA com Node 20 fica desligado e pulado', async () => {
  const c = cenario();
  const itens = await rodarTudo(c, { versaoNode: '20.19.0' });
  assert.equal(itens.find((i) => i.nome === 'hadouken-rea').estado, 'pulado');
  assert.equal(c.estado.plugins.find((p) => p.id === ID_REA).enabled, false);
});

test('falha de um passo não derruba os seguintes, e o resumo sai com ✗', async () => {
  const c = cenario();
  c.estado.falhar = [`install ${ID_KIT}`];
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'hadouken-kit').estado, 'falhou');
  assert.equal(itens.length, 7);
  assert.equal(itens.find((i) => i.nome === 'barra').estado, 'ok');
  const lanca = cenario();
  const outros = await rodarTudo(lanca, { deps: { sincronizar: () => { throw new Error('x'); } } });
  assert.deepEqual(outros.find((i) => i.nome === 'arquivos da barra'), { nome: 'arquivos da barra', estado: 'falhou', detalhe: 'erro-interno', conserto: 'rode o comando de instalação de novo' });
  assert.equal(outros.find((i) => i.nome === 'barra').estado, 'ok');
});

test('item do VS Code: sem VS Code é pulado; HADOUKEN_SEM_PAINEL=1 nem tenta; outra falha é ✗', async () => {
  let c = cenario();
  let itens = await rodarTudo(c, { deps: { instalar: async () => ({ ok: false, motivo: 'sem-vscode' }) } });
  assert.equal(itens.find((i) => i.nome === 'item do VS Code').estado, 'pulado');
  c = cenario();
  itens = await rodarTudo(c, { ambiente: { CLAUDE_CONFIG_DIR: c.casa, HADOUKEN_SEM_PAINEL: '1' }, deps: { instalar: async () => assert.fail('não instala') } });
  assert.deepEqual(itens.find((i) => i.nome === 'item do VS Code'), { nome: 'item do VS Code', estado: 'pulado', detalhe: 'HADOUKEN_SEM_PAINEL=1' });
  c = cenario();
  itens = await rodarTudo(c, { deps: { instalar: async () => ({ ok: false, motivo: 'tempo' }) } });
  assert.deepEqual(itens.find((i) => i.nome === 'item do VS Code'), { nome: 'item do VS Code', estado: 'falhou', detalhe: 'tempo', conserto: 'rode node ~/.claude/hadouken/bin/cli.mjs painel instalar' });
});

test('atualização: marketplace registrado de outra fonte é pulado, settings intocado nessa chave', async () => {
  const c = cenario();
  fs.mkdirSync(path.join(c.casa, 'plugins'));
  fs.writeFileSync(path.join(c.casa, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'claude-hadouken': { source: { source: 'directory', path: 'C:/dev' } } }));
  const itens = await rodarTudo(c);
  assert.equal(itens.find((i) => i.nome === 'atualização automática').estado, 'pulado');
  assert.equal(JSON.parse(fs.readFileSync(c.arq, 'utf8')).extraKnownMarketplaces, undefined);
});

// ------------------------------------------------------------ aprendizado

function aprendizadoFalso({ ligado = false, resultado = { ok: true } } = {}) {
  const chamadas = [];
  return {
    chamadas,
    ligadoExiste: () => ligado,
    previa: (o) => { chamadas.push(['previa', o]); return { ok: true, plano: {}, assinatura: 'x', codigo: 'abcd1234' }; },
    ligar: async (o) => { chamadas.push(['ligar', o]); return resultado; },
  };
}
const aprendizadoDe = (itens) => itens.find((i) => i.nome === 'aprendizado');

test('aprendizado: --sim não pergunta e não liga; --com-aprendizado liga com o código da prévia', async () => {
  let apr = aprendizadoFalso();
  let c = cenario();
  assert.equal(aprendizadoDe(await rodarTudo(c, { deps: { aprendizado: apr } })).estado, 'pulado');
  assert.equal(apr.chamadas.length, 0);
  apr = aprendizadoFalso();
  c = cenario();
  assert.deepEqual(aprendizadoDe(await rodarTudo(c, { argv: ['--sim', '--sem-extras', '--com-aprendizado'], deps: { aprendizado: apr } })), { nome: 'aprendizado', estado: 'ok', detalhe: 'ligado' });
  const [, o] = apr.chamadas.find(([k]) => k === 'ligar');
  assert.equal(o.codigo, 'abcd1234');
  assert.equal(o.arquivo, c.arq);
  assert.equal(o.agoraMs, AGORA + 2);
});

test('aprendizado: s liga; n e sem tty deixam desligado; já ligado é igual; falha do ligar é ✗ sem derrubar', async () => {
  for (const [resposta, esperado] of [[true, 'ok'], [false, 'pulado'], [null, 'pulado']]) {
    const apr = aprendizadoFalso();
    const c = cenario();
    const textos = [];
    const perguntar = async (t) => { textos.push(t); return t.includes('aprendizado') ? resposta === true : false; };
    const escritos = [];
    const itens = await rodarTudo(c, { argv: ['--sem-extras'], perguntar, escrever: (t) => escritos.push(t), deps: { aprendizado: apr } });
    assert.equal(aprendizadoDe(itens).estado, esperado, String(resposta));
    assert.ok(textos.includes('Ligar o aprendizado? [s/N] '));
    assert.match(escritos.join(''), /367 MiB/);
  }
  let c = cenario();
  assert.equal(aprendizadoDe(await rodarTudo(c, { deps: { aprendizado: aprendizadoFalso({ ligado: true }) } })).estado, 'igual');
  c = cenario();
  const itens = await rodarTudo(c, { argv: ['--sim', '--sem-extras', '--com-aprendizado'], deps: { aprendizado: aprendizadoFalso({ resultado: { ok: false, motivo: 'download' } }) } });
  assert.deepEqual(aprendizadoDe(itens), { nome: 'aprendizado', estado: 'falhou', detalhe: 'download', conserto: 'rode /claude-hadouken:aprender ligar numa sessão' });
  assert.equal(itens.find((i) => i.nome === 'barra').estado, 'ok');
});

// ------------------------------------------------------------ extras

function executarPip(mostra) {
  const chamadas = [];
  const executar = (exe, args, o, cb) => {
    chamadas.push([exe, ...args]);
    if (args.includes('show')) return mostra ? cb(null, 'Name: graphifyy\nVersion: 0.9.25\n') : cb(Object.assign(new Error('x'), { code: 1 }), '');
    return cb(null, '');
  };
  return { chamadas, executar };
}
function spawnarFalso(codigo = 0) {
  const chamadas = [];
  const spawnar = (exe, args, o) => {
    chamadas.push({ exe, args, o });
    const filho = new EventEmitter();
    filho.kill = () => {};
    setImmediate(() => filho.emit('exit', codigo));
    return filho;
  };
  return { chamadas, spawnar };
}

test('extras: graphify instala, ou é igual com a versão certa, ou pulado sem Python; yu-ux roda o setup.sh do kit', async () => {
  const c = cenario();
  const setup = path.join(c.casa, 'hadouken-kit', 'skills', 'yu-ux-web-expert', 'scripts', 'setup.sh');
  fs.mkdirSync(path.dirname(setup), { recursive: true });
  fs.writeFileSync(setup, '#!/usr/bin/env bash\n');
  const pip = executarPip(false);
  const sp = spawnarFalso();
  const itens = await rodarTudo(c, { argv: ['--sim'], deps: { python: '/usr/bin/python3', bash: '/bin/bash', executar: pip.executar, spawnar: sp.spawnar } });
  assert.deepEqual(itens.slice(-2), [
    { nome: 'graphify', estado: 'ok', detalhe: 'instalado (graphifyy 0.9.25)' },
    { nome: 'ferramentas da yu-ux', estado: 'ok', detalhe: 'conferidas' },
  ]);
  assert.deepEqual(pip.chamadas, [['/usr/bin/python3', '-m', 'pip', 'show', 'graphifyy'], ['/usr/bin/python3', '-m', 'pip', 'install', '--user', 'graphifyy==0.9.25']]);
  assert.equal(sp.chamadas[0].exe, '/bin/bash');
  assert.deepEqual(sp.chamadas[0].args, [process.platform === 'win32' ? setup.replaceAll('\\', '/') : setup]);
  const igual = await rodarTudo(cenario(), { argv: ['--sim'], deps: { python: '/usr/bin/python3', bash: null, executar: executarPip(true).executar } });
  assert.deepEqual(estados(igual).slice(-2), [['graphify', 'igual'], ['ferramentas da yu-ux', 'pulado']]);
  const semPython = await rodarTudo(cenario(), { argv: ['--sim'], deps: { python: null, bash: null } });
  assert.deepEqual(semPython.at(-2), { nome: 'graphify', estado: 'pulado', detalhe: 'sem Python 3' });
  const sem = await rodarTudo(cenario(), { argv: ['--sim', '--sem-extras'], deps: { python: '/x', bash: '/x' } });
  assert.equal(sem.length, 7);
});

// ------------------------------------------------------------ processo

test('main: opção desconhecida e falta de HADOUKEN_CLAUDE saem 2', () => {
  const env = { ...process.env };
  delete env.HADOUKEN_CLAUDE;
  const r1 = spawnSync(process.execPath, [path.join(repo, 'src', 'instalar-tudo.js'), '--xyz'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r1.status, 2);
  const r2 = spawnSync(process.execPath, [path.join(repo, 'src', 'instalar-tudo.js'), '--sim'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /HADOUKEN_CLAUDE/);
});

test('ponta a ponta: o instalar-tudo de verdade com o claude falso, isolado em pasta temporária', () => {
  const casa = novoTmp();
  const estado = path.join(casa, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [], log: [], raiz: casa }));
  const env = {
    ...process.env, HADOUKEN_CLAUDE: instalarFalso(casa), FALSO_ESTADO: estado, HADOUKEN_HOME: path.join(casa, 'hadouken'),
    HADOUKEN_SETTINGS: path.join(casa, 'settings.json'), CLAUDE_CONFIG_DIR: casa, HADOUKEN_SEM_PAINEL: '1',
  };
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'instalar-tudo.js'), '--sim', '--sem-extras'], { env, encoding: 'utf8', timeout: 60_000, input: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ hadouken-kit: instalado \(1\.1\.0\)/);
  assert.match(r.stdout, /– item do VS Code: pulado \(HADOUKEN_SEM_PAINEL=1\)/);
  assert.match(r.stdout, /Abra uma sessão nova do Claude Code\.\n$/);
});

// Fronteira: o instalador não fala com a rede por conta própria; quem baixa
// é o claude, o pip e o setup.sh, que ele só chama.
test('src/instalar e instalar-tudo.js não têm rede', () => {
  const REDE = /node:(?:http2?|https|net|dns|tls|dgram)\b|\bfetch\s*\(|\bWebSocket\b/;
  const arquivos = [path.join(repo, 'src', 'instalar-tudo.js'), ...fs.readdirSync(path.join(repo, 'src', 'instalar')).map((n) => path.join(repo, 'src', 'instalar', n))];
  for (const a of arquivos) assert.doesNotMatch(fs.readFileSync(a, 'utf8'), REDE, a);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/instalar-tudo.test.js`
Expected: FAIL — `src/instalar-tudo.js` não existe.

- [ ] **Step 3: Implementar**

Criar `src/instalar-tudo.js`:

```js
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirDados } from './base.js';
import { aplicarStatusline, arquivoSettings } from './configuracao.js';
import { lerJson } from './estado.js';
import { instalarPainel, versaoDoPlugin } from './painel/instalar-painel.js';
import { sincronizarShims } from './shim.js';
import { ligarAtualizacao, marketplaceConhecido } from './instalar/atualizacao-auto.js';
import { criarClaude, ID_KIT, passoPlugin, passoRea } from './instalar/claude-cli.js';
import { codigoDeSaida, formatarResumo, item } from './instalar/itens.js';

// Instalador de um comando, passos 6 e 7 (spec v0.5.2). O install.sh ou o
// install.ps1 já conferiram o PC, instalaram o claude-hadouken e chamam
// `node <plugin>/src/instalar-tudo.js [opções]` com HADOUKEN_CLAUDE = o
// caminho do claude. Daqui: kit e REA, atualização automática, arquivos da
// barra, barra, item do VS Code, aprendizado e extras (graphify e yu-ux),
// cada um independente (uma exceção vira ✗ daquele item e o resto segue), e
// o resumo de rótulos fixos (itens.js). Perguntas só da barra (outra barra) e
// do aprendizado; sem tty, a resposta é "não". Rodar de novo atualiza e pula
// o que já está certo.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GRAPHIFY = 'graphifyy==0.9.25';
const DE_NOVO = 'rode o comando de instalação de novo';
const CONSERTO_PAINEL = 'rode node ~/.claude/hadouken/bin/cli.mjs painel instalar';
const CONSERTO_BARRA = 'rode /claude-hadouken:instalar numa sessão';
const CONSERTO_APRENDER = 'rode /claude-hadouken:aprender ligar numa sessão';
const SEM_VSCODE = "VS Code não encontrado; no VS Code, rode Shell Command: Install 'code' command in PATH e instale de novo";
const OPCOES = Object.freeze({ '--sim': 'sim', '--substituir-barra': 'substituirBarra', '--sem-extras': 'semExtras', '--com-aprendizado': 'comAprendizado' });
export const CUSTO_APRENDIZADO = [
  'Aprendizado local (OpenTelemetry): o Hadouken aprende o seu ritmo com a telemetria do próprio Claude Code.',
  'Custo: o Collector otelcol-contrib, ~367 MiB em disco e ~108 MiB de memória, um processo por sessão. Nada sai da máquina.',
  '',
].join('\n');

export function lerOpcoes(argv) {
  const o = { sim: false, substituirBarra: false, semExtras: false, comAprendizado: false, desconhecidas: [] };
  for (const a of argv) {
    if (Object.hasOwn(OPCOES, a)) o[OPCOES[a]] = true;
    else o.desconhecidas.push(a);
  }
  return o;
}

// "s", "sim", "y", "yes" (sem caixa) são sim; vazio é o padrão; null (sem
// tty) e qualquer outra coisa são não.
export function respostaSim(texto, padrao) {
  if (typeof texto !== 'string') return false;
  const t = texto.trim().toLowerCase();
  if (t === '') return padrao;
  return ['s', 'sim', 'y', 'yes'].includes(t);
}

// Pergunta no terminal. No POSIX lê do /dev/tty (no `curl | bash` a entrada
// é o script); no Windows, da entrada do console. Sem tty: false.
async function perguntarTty(texto, padrao) {
  let entrada = null;
  try {
    if (process.platform === 'win32') {
      if (!process.stdin.isTTY) return false;
      entrada = process.stdin;
    } else {
      entrada = fs.createReadStream('/dev/tty', { fd: fs.openSync('/dev/tty', 'r') });
    }
    const rl = readline.createInterface({ input: entrada, output: process.stdout, terminal: false });
    try {
      return respostaSim(await rl.question(texto), padrao);
    } finally {
      rl.close();
      entrada.destroy();
    }
  } catch {
    try { entrada?.destroy(); } catch { /* já fechada */ }
    return false;
  }
}

function pastaConfig(ambiente) {
  const c = ambiente.CLAUDE_CONFIG_DIR;
  if (typeof c === 'string') return path.isAbsolute(c) ? c : null;
  try {
    return path.join(os.homedir(), '.claude');
  } catch {
    return null;
  }
}

async function passo(itens, nome, f) {
  try {
    itens.push(await f());
  } catch {
    itens.push(item.falhou(nome, 'erro-interno', DE_NOVO));
  }
}

function passoAtualizacao({ settings, configDir, agoraMs, ligar }) {
  const nome = 'atualização automática';
  const outra = item.pulado(nome, 'marketplace claude-hadouken de outra fonte');
  if (!settings.ok) return item.falhou(nome, settings.motivo, DE_NOVO);
  if (configDir !== null && marketplaceConhecido(path.join(configDir, 'plugins', 'known_marketplaces.json')) === 'outra') return outra;
  const r = ligar({ arquivo: settings.arquivo, agoraMs });
  if (r.ok) {
    if (r.acao === 'ja-estava') return item.igual(nome);
    return item.ok(nome, r.desligadas.length > 0 ? `ligada; ${r.desligadas.length} cópia(s) antiga(s) desligada(s)` : 'ligada');
  }
  return r.motivo === 'outra-fonte' ? outra : item.falhou(nome, r.motivo, DE_NOVO);
}

function passoShims({ raizPlugin, sincronizar }) {
  const nome = 'arquivos da barra';
  const r = sincronizar(raizPlugin);
  if (!r.ok) return item.falhou(nome, r.motivo, DE_NOVO);
  return r.alterados.length === 0 ? item.igual(nome) : item.ok(nome, 'em dia');
}

async function passoBarra({ settings, opcoes, perguntar, agoraMs, aplicar }) {
  const nome = 'barra';
  if (!settings.ok) return item.falhou(nome, settings.motivo, CONSERTO_BARRA);
  const feito = (r) => {
    if (r.acao === 'ja-instalado') return item.igual(nome);
    return item.ok(nome, r.acao === 'substituir' ? 'instalada no lugar da outra (com backup)' : 'instalada');
  };
  const r = aplicar({ arquivo: settings.arquivo, agoraMs, substituir: opcoes.substituirBarra });
  if (r.ok) return feito(r);
  if (r.motivo !== 'conflito') return item.falhou(nome, r.motivo, CONSERTO_BARRA);
  const trocar = !opcoes.sim && (await perguntar('Já existe outra barra (statusLine). Trocar pela barra do claude-hadouken? [s/N] ', false));
  if (!trocar) return item.pulado(nome, 'outra barra; rode de novo com --substituir-barra');
  const r2 = aplicar({ arquivo: settings.arquivo, agoraMs, substituir: true });
  return r2.ok ? feito(r2) : item.falhou(nome, r2.motivo, CONSERTO_BARRA);
}

async function passoPainel({ dir, raizPlugin, agoraMs, ambiente, instalar }) {
  const nome = 'item do VS Code';
  if (ambiente.HADOUKEN_SEM_PAINEL === '1') return item.pulado(nome, 'HADOUKEN_SEM_PAINEL=1');
  if (dir === null) return item.falhou(nome, 'sem-pasta', DE_NOVO);
  const versao = versaoDoPlugin(raizPlugin);
  const instalado = lerJson(path.join(dir, 'painel', 'instalado.json'), 4096);
  if (versao !== null && instalado.ok && instalado.valor?.versao === versao) return item.igual(nome);
  const r = await instalar({ dir, raizPlugin, agoraMs });
  if (r.ok) return item.ok(nome, 'instalado; recarregue a janela do VS Code');
  if (r.motivo === 'sem-vscode') return item.pulado(nome, SEM_VSCODE);
  return item.falhou(nome, r.motivo, CONSERTO_PAINEL);
}

async function passoAprendizado({ dir, settings, opcoes, perguntar, escrever, agoraMs, ambiente, aprendizado }) {
  const nome = 'aprendizado';
  const apr = aprendizado ?? { ...(await import('./aprendizado/arquivos.js')), ...(await import('./aprendizado/ligar.js')) };
  if (dir !== null && apr.ligadoExiste(dir)) return item.igual(nome);
  let quer = opcoes.comAprendizado;
  if (!quer && !opcoes.sim) {
    escrever(CUSTO_APRENDIZADO);
    quer = await perguntar('Ligar o aprendizado? [s/N] ', false);
  }
  if (!quer) return item.pulado(nome, 'desligado; para ligar depois, /claude-hadouken:aprender ligar');
  if (dir === null || !settings.ok) return item.falhou(nome, dir === null ? 'sem-pasta' : settings.motivo, CONSERTO_APRENDER);
  const base = { dir, arquivo: settings.arquivo, ambiente };
  const p = apr.previa(base);
  if (!p.ok) return item.falhou(nome, p.motivo, CONSERTO_APRENDER);
  const r = await apr.ligar({ ...base, codigo: p.codigo, agoraMs });
  return r.ok ? item.ok(nome, 'ligado') : item.falhou(nome, r.motivo, CONSERTO_APRENDER);
}

function rodarSimples(executar, exe, args, prazoMs) {
  return new Promise((resolve) => {
    try {
      executar(exe, args, { windowsHide: true, timeout: prazoMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (erro, stdout) => {
        resolve({ ok: !erro, motivo: !erro ? 'ok' : erro.killed === true ? 'tempo' : 'erro', saida: typeof stdout === 'string' ? stdout : '' });
      });
    } catch {
      resolve({ ok: false, motivo: 'erro', saida: '' });
    }
  });
}

function rodarVisivel(spawnar, exe, args, prazoMs) {
  return new Promise((resolve) => {
    try {
      const filho = spawnar(exe, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
      const prazo = setTimeout(() => {
        try { filho.kill(); } catch { /* já saiu */ }
        resolve('tempo');
      }, prazoMs);
      filho.on('error', () => { clearTimeout(prazo); resolve('erro'); });
      filho.on('exit', (codigo) => { clearTimeout(prazo); resolve(codigo === 0 ? 'ok' : 'erro'); });
    } catch {
      resolve('erro');
    }
  });
}

// Python 3: o que o script achou (HADOUKEN_PYTHON, absoluto) ou python3 /
// python do PATH; vale o primeiro cujo --version diz "Python 3.x".
async function acharPython({ ambiente, plataforma, executar }) {
  const candidatos = [];
  if (typeof ambiente.HADOUKEN_PYTHON === 'string' && path.isAbsolute(ambiente.HADOUKEN_PYTHON)) candidatos.push(ambiente.HADOUKEN_PYTHON);
  candidatos.push(...(plataforma === 'win32' ? ['python'] : ['python3', 'python']));
  for (const c of candidatos) {
    const r = await rodarSimples(executar, c, ['--version'], 30_000);
    if (r.ok && /^Python 3\.\d+/.test(r.saida.trim())) return c;
  }
  return null;
}

// bash para o setup.sh da yu-ux: /bin/bash fora do Windows; no Windows, só o
// do Git (nunca o bash.exe do WSL no System32).
function acharBash({ ambiente, plataforma, existe }) {
  if (plataforma !== 'win32') return existe('/bin/bash') ? '/bin/bash' : null;
  const pf = ambiente.ProgramFiles ?? ambiente.PROGRAMFILES;
  const local = ambiente.LOCALAPPDATA;
  const lista = [
    ambiente.CLAUDE_CODE_GIT_BASH_PATH,
    typeof pf === 'string' ? path.win32.join(pf, 'Git', 'bin', 'bash.exe') : null,
    typeof local === 'string' ? path.win32.join(local, 'Programs', 'Git', 'bin', 'bash.exe') : null,
  ];
  return lista.find((p) => typeof p === 'string' && path.win32.isAbsolute(p) && existe(p)) ?? null;
}

async function passoGraphify({ python, executar }) {
  const nome = 'graphify';
  if (python === null) return item.pulado(nome, 'sem Python 3');
  const mostra = await rodarSimples(executar, python, ['-m', 'pip', 'show', 'graphifyy'], 60_000);
  if (mostra.ok && /^Version: 0\.9\.25$/m.test(mostra.saida)) return item.igual(nome);
  const r = await rodarSimples(executar, python, ['-m', 'pip', 'install', '--user', GRAPHIFY], 900_000);
  return r.ok ? item.ok(nome, 'instalado (graphifyy 0.9.25)') : item.falhou(nome, r.motivo, `rode ${python} -m pip install --user ${GRAPHIFY} (ou pipx install ${GRAPHIFY})`);
}

async function passoYuUx({ bash, kitPath, spawnar, plataforma }) {
  const nome = 'ferramentas da yu-ux';
  if (bash === null) return item.pulado(nome, plataforma === 'win32' ? 'sem o bash do Git' : 'sem bash');
  if (typeof kitPath !== 'string') return item.pulado(nome, 'hadouken-kit não instalado');
  const setup = path.join(kitPath, 'skills', 'yu-ux-web-expert', 'scripts', 'setup.sh');
  if (!fs.existsSync(setup)) return item.falhou(nome, 'sem setup.sh', DE_NOVO);
  // O setup.sh usa dirname no próprio caminho: no Git Bash, só com barras normais.
  const alvo = plataforma === 'win32' ? setup.replaceAll('\\', '/') : setup;
  const r = await rodarVisivel(spawnar, bash, [alvo], 1_800_000);
  return r === 'ok' ? item.ok(nome, 'conferidas') : item.falhou(nome, r, `rode bash "${alvo}"`);
}

export async function instalarTudo(o) {
  const {
    opcoes, rodar, versaoNode = process.versions.node, agoraMs = Date.now(), raizPlugin = RAIZ, ambiente = process.env,
    perguntar = perguntarTty, plataforma = process.platform, escrever = (t) => process.stdout.write(t), deps = {},
  } = o;
  const {
    instalar = instalarPainel, sincronizar = sincronizarShims, aplicar = aplicarStatusline, ligarAuto = ligarAtualizacao,
    aprendizado = null, executar = execFile, spawnar = spawn, existe = (p) => fs.existsSync(p),
  } = deps;
  const itens = [];
  const dir = dirDados();
  const settings = arquivoSettings();
  // O superpowers, dependência do kit, vem do marketplace oficial. Já
  // registrado é falha esperada: a lista depois do install é a verdade.
  await rodar(['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official']);
  let kitPath = null;
  await passo(itens, 'hadouken-kit', async () => {
    const p = await passoPlugin(rodar, ID_KIT, 'hadouken-kit');
    kitPath = p.entrada?.installPath ?? null;
    return p.item;
  });
  await passo(itens, 'hadouken-rea', () => passoRea(rodar, versaoNode));
  await passo(itens, 'atualização automática', () => passoAtualizacao({ settings, configDir: pastaConfig(ambiente), agoraMs, ligar: ligarAuto }));
  await passo(itens, 'arquivos da barra', () => passoShims({ raizPlugin, sincronizar }));
  await passo(itens, 'barra', () => passoBarra({ settings, opcoes, perguntar, agoraMs: agoraMs + 1, aplicar }));
  await passo(itens, 'item do VS Code', () => passoPainel({ dir, raizPlugin, agoraMs, ambiente, instalar }));
  await passo(itens, 'aprendizado', () => passoAprendizado({ dir, settings, opcoes, perguntar, escrever, agoraMs: agoraMs + 2, ambiente, aprendizado }));
  if (!opcoes.semExtras) {
    const python = deps.python !== undefined ? deps.python : await acharPython({ ambiente, plataforma, executar });
    await passo(itens, 'graphify', () => passoGraphify({ python, executar }));
    const bash = deps.bash !== undefined ? deps.bash : acharBash({ ambiente, plataforma, existe });
    await passo(itens, 'ferramentas da yu-ux', () => passoYuUx({ bash, kitPath, spawnar, plataforma }));
  }
  return itens;
}

export async function main(argv = process.argv.slice(2), ambiente = process.env) {
  const opcoes = lerOpcoes(argv);
  if (opcoes.desconhecidas.length > 0) {
    process.stderr.write(`instalar-tudo: opção desconhecida; as opções são ${Object.keys(OPCOES).join(', ')}\n`);
    return 2;
  }
  const exe = ambiente.HADOUKEN_CLAUDE;
  if (typeof exe !== 'string' || !path.isAbsolute(exe)) {
    process.stderr.write('instalar-tudo: rode pelo install.sh ou pelo install.ps1 (falta HADOUKEN_CLAUDE com o caminho do claude)\n');
    return 2;
  }
  const itens = await instalarTudo({ opcoes, rodar: criarClaude({ exe }), ambiente });
  process.stdout.write(`\n${formatarResumo(itens)}\n`);
  return codigoDeSaida(itens);
}

let principal = false;
try {
  principal = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* importado pelos testes */ }
if (principal) {
  main().then((codigo) => { process.exitCode = codigo; }, () => { process.exitCode = 1; });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/instalar-tudo.test.js`
Expected: PASS. Se o teste "segunda rodada" mostrar `arquivos da barra` como `ok`, conferir se o `HADOUKEN_HOME` é o mesmo nas duas rodadas (o `cenario` é um só nesse teste).

Run: `node --test`
Expected: PASS na suíte inteira.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(instalar): instalar-tudo.js com kit, REA, atualização, barra, painel, aprendizado, extras e resumo' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add src/instalar-tudo.js test/instalar-tudo.test.js
git commit -q -F /tmp/msg052
```

---

### Task 7: `install.sh` (Mac e Linux, passos 1 a 5)

**Files:**
- Create: `install.sh` (modo 755 no git: `git update-index --chmod=+x install.sh`)
- Test: `test/instalar-sh.test.js`

**Interfaces:**
- Consumes: `node <installPath>/src/instalar-tudo.js [opções]` com `HADOUKEN_CLAUDE` (absoluto) e `HADOUKEN_PYTHON` (absoluto ou vazio) (Task 6); `instalarFalso` e o estado do `claude-falso.mjs` (Task 5).
- Produces: o comando `curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash` (e `| bash -s -- <opções>`). Código de saída: o do `instalar-tudo.js`; 1 quando para antes; 2 com opção desconhecida.

Regras do bash 3.2 (o do macOS): sem `${x,,}`, sem `mapfile`, sem `declare -A`; array vazio com `set -u` só como `${REPASSE[@]+"${REPASSE[@]}"}`. O script inteiro fica em funções e a última linha é `main "$@"`: no `curl | bash` o bash lê o script pela entrada e só começa a executar depois de ler essa linha, então um comando filho que lê a entrada (o `claude`, o `brew`) não come o resto do script (Review Focus 1). As perguntas leem `/dev/tty`; sem tty, a resposta é "não".

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/instalar-sh.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarFalso } from './dados/instalador/claude-falso.mjs';

// install.sh (spec v0.5.2, passos 1 a 5) com claude, node, git, brew e curl
// falsos num PATH temporário. Não roda no Windows (o install.ps1 tem o teste
// dele). As rodadas usam --sim, menos as de "sem tty", que usam setsid (só
// Linux) para o /dev/tty não existir: sem isso, a pergunta esperaria no
// terminal de quem roda a suíte.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = path.join(repo, 'install.sh');
const pulaWin = process.platform === 'win32' ? 'install.sh não roda no Windows' : false;
const temSetsid = process.platform === 'linux' && spawnSync('setsid', ['--version']).status === 0;
const pastas = [];
after(() => { for (const d of pastas) fs.rmSync(d, { recursive: true, force: true }); });

function montar({ claude = true, versaoClaude, node = true } = {}) {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk sh '));
  pastas.push(casa);
  const bin = path.join(casa, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(casa, 'comandos.log');
  const falso = (nome, corpo) => fs.writeFileSync(path.join(bin, nome), `#!/bin/sh\n${corpo}\n`, { mode: 0o755 });
  falso('git', 'echo "git version 2.0.0"');
  falso('curl', `echo "curl $*" >> "${log}"; exit 1`);
  falso('brew', `echo "brew $*" >> "${log}"; exit 0`);
  if (node) falso('node', `exec "${process.execPath}" "$@"`);
  if (claude) instalarFalso(bin);
  const estado = path.join(casa, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [], log: [], raiz: casa, ...(versaoClaude ? { versao: versaoClaude } : {}) }));
  // O instalar-tudo.js "do plugin instalado" é um stub que grava o que recebeu.
  const stub = path.join(casa, 'claude-hadouken', 'src', 'instalar-tudo.js');
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  const saida = path.join(casa, 'stub.json');
  fs.writeFileSync(stub, "const fs = require('node:fs');\nfs.writeFileSync(process.env.STUB_SAIDA, JSON.stringify({ argv: process.argv.slice(2), claude: process.env.HADOUKEN_CLAUDE || null }));\n");
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: casa, FALSO_ESTADO: estado, STUB_SAIDA: saida, LANG: 'C.UTF-8' };
  const lerEstado = () => JSON.parse(fs.readFileSync(estado, 'utf8'));
  const lerStub = () => (fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, 'utf8')) : null);
  const lerLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  return { casa, bin, env, lerEstado, lerStub, lerLog };
}
const rodar = (m, args, opcoes = {}) => spawnSync('bash', [SCRIPT, ...args], { env: m.env, encoding: 'utf8', timeout: 60_000, ...opcoes });
const rodarSemTty = (m, args) => spawnSync('setsid', ['-w', 'bash', SCRIPT, ...args], { env: m.env, encoding: 'utf8', timeout: 60_000, input: '' });

test('install.sh: sintaxe (bash -n)', { skip: pulaWin }, () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('install.sh: tudo dentro de main, e main "$@" é a última linha', { skip: pulaWin }, () => {
  const linhas = fs.readFileSync(SCRIPT, 'utf8').trimEnd().split('\n');
  assert.equal(linhas.at(-1), 'main "$@"');
  // Fora das funções: só definições de função e constantes sem $ nem (.
  const soltas = linhas.filter((l) => /^[a-z]/i.test(l) && !/^[a-z_]+\(\) \{$/.test(l) && !/^[A-Z_]+=[^$(]*$/.test(l) && l !== 'main "$@"');
  assert.deepEqual(soltas, [], 'fora das funções, só definições');
});

test('install.sh: instalação nova, na ordem, e o instalar-tudo recebe as opções e o claude', { skip: pulaWin }, () => {
  const m = montar();
  const r = rodar(m, ['--sim', '--sem-extras', '--com-aprendizado']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log, [
    '--version', 'plugin marketplace add Garioli-Labs/claude-hadouken', 'plugin marketplace update claude-hadouken',
    'plugin list --json', 'plugin install claude-hadouken@claude-hadouken', 'plugin list --json',
  ]);
  assert.deepEqual(m.lerStub(), { argv: ['--sim', '--sem-extras', '--com-aprendizado'], claude: path.join(m.bin, 'claude') });
  assert.equal(m.lerLog(), '', 'nem curl nem brew');
});

test('install.sh: segunda rodada usa plugin update', { skip: pulaWin }, () => {
  const m = montar();
  rodar(m, ['--sim', '--sem-extras']);
  const r = rodar(m, ['--sim', '--sem-extras']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(m.lerEstado().log.includes('plugin update claude-hadouken@claude-hadouken'));
});

test('install.sh: claude abaixo de 2.1.251 recebe claude update', { skip: pulaWin }, () => {
  const m = montar({ versaoClaude: '2.1.200' });
  const r = rodar(m, ['--sim', '--sem-extras']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log.slice(0, 3), ['--version', 'update', '--version']);
});

test('install.sh: opção desconhecida sai 2 sem rodar nada', { skip: pulaWin }, () => {
  const m = montar();
  const r = rodar(m, ['--xyz']);
  assert.equal(r.status, 2);
  assert.deepEqual(m.lerEstado().log, []);
});

test('install.sh: sem tty, sem claude e sem --sim, para sem chamar o instalador do Claude Code', { skip: pulaWin || !temSetsid }, () => {
  const m = montar({ claude: false });
  const r = rodarSemTty(m, []);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(m.lerLog(), '');
  assert.equal(m.lerStub(), null);
});

test('install.sh: sem tty e com tudo presente, os extras ficam de fora (--sem-extras repassado)', { skip: pulaWin || !temSetsid }, () => {
  const m = montar();
  const r = rodarSemTty(m, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerStub().argv, ['--sem-extras']);
});

// No Mac, com o brew falso, o script pergunta antes de instalar o Node; sem
// setsid, a pergunta só vale "não" quando a suíte não roda num terminal (CI).
const pulaSemNode = pulaWin || fs.existsSync('/usr/bin/node') || fs.existsSync('/bin/node') || (process.platform === 'darwin' && process.stdin.isTTY);
test('install.sh: sem Node, para com o link do nodejs.org', { skip: pulaSemNode }, () => {
  const m = montar({ node: false });
  const r = process.platform === 'linux' && temSetsid ? rodarSemTty(m, []) : rodar(m, [], { input: '' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /nodejs\.org/);
  assert.equal(m.lerStub(), null);
});

test('install.sh: pela entrada (bash -s), com um claude que come a entrada, roda até o fim', { skip: pulaWin }, () => {
  const m = montar();
  const r = spawnSync('bash', ['-s', '--', '--sim', '--sem-extras'], {
    env: { ...m.env, FALSO_COMER_STDIN: '1' }, encoding: 'utf8', timeout: 60_000, input: fs.readFileSync(SCRIPT),
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerStub().argv, ['--sim', '--sem-extras']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/instalar-sh.test.js`
Expected: no Linux e no Mac, FAIL (sem `install.sh`); no Windows, tudo pulado.

- [ ] **Step 3: Implementar**

Criar `install.sh` (LF, sem BOM):

```bash
#!/usr/bin/env bash
# Instalador de um comando do claude-hadouken, Mac e Linux (spec v0.5.2).
#   curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
#   ... | bash -s -- --sim --sem-extras
# Passos 1 a 5: confere Node, git e claude; pergunta uma vez e instala o que
# falta; instala o plugin principal; chama o instalar-tudo.js do plugin. Só
# definições até a última linha: no `curl | bash`, nada roda antes de o bash
# ler o script inteiro. Perguntas pelo /dev/tty; sem tty, "não". Sem sudo.

NODE_MIN=20.0.0
CLAUDE_MIN=2.1.251
ID=claude-hadouken@claude-hadouken

aviso() {
  printf 'claude-hadouken: %s\n' "$1" >&2
}

# pergunta "texto" s|n -> 0 sim, 1 não. --sim responde sim; sem tty, não.
pergunta() {
  local r=""
  if [ "$SIM" = 1 ]; then return 0; fi
  if ! ( : </dev/tty ) 2>/dev/null; then return 1; fi
  printf '%s' "$1" >/dev/tty
  IFS= read -r r </dev/tty || r=""
  r=$(printf '%s' "$r" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  case "$r" in
    s|sim|y|yes) return 0 ;;
    "") [ "$2" = s ] ;;
    *) return 1 ;;
  esac
}

# x.y.z da primeira linha de "<cmd> --version"; vazio se não houver.
versao_de() {
  command -v "$1" >/dev/null 2>&1 || return 0
  "$1" --version 2>/dev/null | head -n 1 | sed -n -E 's/^[^0-9]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p'
}

# ver_ge A B: A >= B (x.y.z decimais).
ver_ge() {
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$1"
  IFS=. read -r b1 b2 b3 <<<"$2"
  [ $((10#$a1)) -ne $((10#$b1)) ] && { [ $((10#$a1)) -gt $((10#$b1)) ]; return; }
  [ $((10#$a2)) -ne $((10#$b2)) ] && { [ $((10#$a2)) -gt $((10#$b2)) ]; return; }
  [ $((10#$a3)) -ge $((10#$b3)) ]
}

node_ok() {
  local v
  v=$(versao_de node)
  [ -n "$v" ] && ver_ge "$v" "$NODE_MIN"
}

claude_estado() {
  local v
  v=$(versao_de claude)
  if [ -z "$v" ]; then echo instalar; elif ver_ge "$v" "$CLAUDE_MIN"; then echo ok; else echo atualizar; fi
}

# brew no PATH ou nos dois lugares de sempre (Apple Silicon e Intel).
achar_brew() {
  command -v brew >/dev/null 2>&1 && return 0
  local b
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then
      eval "$("$b" shellenv)"
      return 0
    fi
  done
  return 1
}

# installPath do plugin principal (escopo user) em `claude plugin list --json`.
pasta_plugin() {
  "$CLAUDE" plugin list --json 2>/dev/null | node -e '
let t = "";
process.stdin.on("data", (d) => { t += d; }).on("end", () => {
  try {
    const p = JSON.parse(t).find((x) => x && x.id === process.argv[1] && (x.scope === undefined || x.scope === "user"));
    if (p && typeof p.installPath === "string") process.stdout.write(p.installPath);
  } catch {}
});' "$ID"
}

main() {
  set -u
  SIM=0
  local sem_extras=0 a
  REPASSE=()
  for a in "$@"; do
    case "$a" in
      --sim) SIM=1; REPASSE+=("$a") ;;
      --sem-extras) sem_extras=1; REPASSE+=("$a") ;;
      --substituir-barra|--com-aprendizado) REPASSE+=("$a") ;;
      *) aviso "opção desconhecida; as opções são --sim, --sem-extras, --com-aprendizado e --substituir-barra"; return 2 ;;
    esac
  done

  local so tem_brew=0
  so=$(uname -s)
  if [ "$so" = Darwin ] && achar_brew; then tem_brew=1; fi
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) PATH="$PATH:$HOME/.local/bin"; export PATH ;;
  esac

  # 1. Confere o PC.
  local falta_node=0 falta_git=0 claude_acao
  node_ok || falta_node=1
  git --version >/dev/null 2>&1 || falta_git=1
  claude_acao=$(claude_estado)

  # 2 e 3. Pergunta uma vez e instala o que falta.
  if [ "$falta_node$falta_git" != 00 ] || [ "$claude_acao" != ok ]; then
    echo "Falta para o claude-hadouken:"
    [ "$falta_node" = 1 ] && echo "  - Node 20 ou mais novo"
    [ "$falta_git" = 1 ] && echo "  - git"
    [ "$claude_acao" = instalar ] && echo "  - Claude Code"
    [ "$claude_acao" = atualizar ] && echo "  - Claude Code $CLAUDE_MIN ou mais novo (claude update)"
    if [ "$falta_node$falta_git" != 00 ] && [ "$tem_brew" = 0 ]; then
      aviso "instale o Node 20+ (https://nodejs.org/) e o git pelo gerenciador do seu sistema e rode o comando de novo"
      return 1
    fi
    if ! pergunta "Instalar agora? [s/N] " n; then
      aviso "nada instalado. Node: https://nodejs.org/ ; Claude Code: curl -fsSL https://claude.ai/install.sh | bash"
      return 1
    fi
    if [ "$falta_node" = 1 ]; then
      brew install node || { aviso "brew install node falhou; rode-o e depois o comando de novo"; return 1; }
    fi
    if [ "$falta_git" = 1 ]; then
      brew install git || { aviso "brew install git falhou; rode-o e depois o comando de novo"; return 1; }
    fi
    if [ "$claude_acao" = instalar ]; then
      curl -fsSL https://claude.ai/install.sh | bash || { aviso "o instalador do Claude Code falhou; rode curl -fsSL https://claude.ai/install.sh | bash"; return 1; }
    elif [ "$claude_acao" = atualizar ]; then
      claude update || { aviso "claude update falhou; rode-o e depois o comando de novo"; return 1; }
    fi
    hash -r
    node_ok || { aviso "o Node 20+ não ficou disponível; abra um terminal novo e rode o comando de novo"; return 1; }
    [ "$(claude_estado)" = ok ] || { aviso "o Claude Code $CLAUDE_MIN+ não ficou disponível; abra um terminal novo e rode o comando de novo"; return 1; }
  fi

  # Extras de pacote (Python e gh); o pip e o setup.sh ficam no instalar-tudo.
  if [ "$sem_extras" = 0 ]; then
    echo "Extras: Python 3 (~100 MiB), graphify (pip), Playwright com Chromium, axe-core e lighthouse da yu-ux (~150 MiB) e o gh."
    if pergunta "Instalar também os extras? [S/n] " s; then
      local pacotes=""
      python3 --version >/dev/null 2>&1 || pacotes="python"
      command -v gh >/dev/null 2>&1 || pacotes="$pacotes gh"
      if [ -n "$pacotes" ]; then
        if [ "$tem_brew" = 1 ]; then
          # shellcheck disable=SC2086
          brew install $pacotes || aviso "brew install$pacotes falhou; os outros extras seguem"
        else
          echo "Para os extras, instale pelo gerenciador do seu sistema:$pacotes (python3 com pip)."
        fi
      fi
    else
      REPASSE+=(--sem-extras)
    fi
  fi

  # 4. O plugin principal.
  CLAUDE=$(command -v claude) || { aviso "claude não encontrado no PATH"; return 1; }
  "$CLAUDE" plugin marketplace add Garioli-Labs/claude-hadouken >/dev/null 2>&1 || true
  "$CLAUDE" plugin marketplace update claude-hadouken >/dev/null 2>&1 || true
  local raiz
  raiz=$(pasta_plugin)
  if [ -n "$raiz" ]; then "$CLAUDE" plugin update "$ID" || true; else "$CLAUDE" plugin install "$ID" || true; fi

  # 5. A pasta do plugin e o resto em Node.
  raiz=$(pasta_plugin)
  if [ -z "$raiz" ] || [ ! -f "$raiz/src/instalar-tudo.js" ]; then
    aviso "o plugin não instalou; rode claude plugin install $ID"
    return 1
  fi
  local py="" codigo
  if python3 --version >/dev/null 2>&1; then py=$(command -v python3); fi
  HADOUKEN_CLAUDE="$CLAUDE" HADOUKEN_PYTHON="$py" node "$raiz/src/instalar-tudo.js" ${REPASSE[@]+"${REPASSE[@]}"}
  codigo=$?
  if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
    echo "Próximo passo, para a seção do GitHub no relatório: gh auth login"
  fi
  echo "Os limites de 5 h e 7 dias aparecem nos planos Pro e Max."
  return "$codigo"
}

main "$@"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/instalar-sh.test.js`
Expected: PASS no Linux e no Mac; pulado no Windows. No Windows, conferir pelo menos a sintaxe com o bash do Git: `bash -n install.sh` (Expected: sem saída, código 0).

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(instalar): install.sh de um comando para Mac e Linux' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add install.sh test/instalar-sh.test.js
git update-index --chmod=+x install.sh
git commit -q -F /tmp/msg052
```

---

### Task 8: `install.ps1` (Windows, passos 1 a 5)

**Files:**
- Create: `install.ps1`
- Test: `test/instalar-ps1.test.js`

**Interfaces:**
- Consumes: o mesmo contrato do `instalar-tudo.js` da Task 7; `instalarFalso` (Task 5), que no Windows grava `claude.cmd`.
- Produces: o comando `irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex`; opções por argumento (`powershell -File install.ps1 --sim`, também `-Sim`) e pela variável `HADOUKEN_INSTALAR`. O código fica em `$LASTEXITCODE`; `exit` só quando rodado como arquivo.

Decisões de execução:
- **Só ASCII no `install.ps1`.** O Windows PowerShell 5.1 lê um `.ps1` sem BOM como ANSI, e o `irm` decide a codificação pelo cabeçalho; um arquivo só ASCII funciona igual nos dois caminhos. As mensagens do script ficam sem acento (o resumo, que vem do Node, tem acento normalmente). Teste abaixo.
- **Tudo dentro de `& { … } @args`.** No `irm | iex`, o script roda na sessão de quem chamou: as funções ficam no escopo do bloco e não sobram na sessão, e nenhum `exit` fecha a janela (Review Focus 2).
- **`plugin list --json` lido pelo `ConvertFrom-Json` do próprio PowerShell**, com `[Console]::OutputEncoding` em UTF-8 durante a leitura. Desvio pequeno da spec (que dizia "com o próprio Node"): no Windows o Node pode ter acabado de ser instalado pelo winget e o PowerShell já está aqui. Anotar no relatório da tarefa.
- A saída do `node instalar-tudo.js` também vai com `[Console]::OutputEncoding` em UTF-8, para os `✓`/`–` aparecerem certos.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/instalar-ps1.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarFalso } from './dados/instalador/claude-falso.mjs';

// install.ps1 (spec v0.5.2) no Windows PowerShell 5.1, com claude.cmd e
// git.cmd falsos numa pasta com espaço. Só roda no win32. A entrada é sempre
// redirecionada (spawnSync), então toda pergunta vale "não" sem --sim.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = path.join(repo, 'install.ps1');
const soWin = process.platform === 'win32' ? false : 'install.ps1 só roda no Windows';
const pastas = [];
after(() => {
  for (const d of pastas) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
  }
});
const SISTEMA = process.env.SystemRoot ?? 'C:\\Windows';

function montar({ claude = true, versaoClaude } = {}) {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk ps1 '));
  pastas.push(casa);
  const bin = path.join(casa, 'bin dir');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git.cmd'), '@echo git version 2.0.0\r\n');
  if (claude) instalarFalso(bin);
  const estado = path.join(casa, 'estado.json');
  fs.writeFileSync(estado, JSON.stringify({ plugins: [], log: [], raiz: casa, ...(versaoClaude ? { versao: versaoClaude } : {}) }));
  const stub = path.join(casa, 'claude-hadouken', 'src', 'instalar-tudo.js');
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  const saida = path.join(casa, 'stub.json');
  fs.writeFileSync(stub, "const fs = require('node:fs');\nfs.writeFileSync(process.env.STUB_SAIDA, JSON.stringify({ argv: process.argv.slice(2), claude: process.env.HADOUKEN_CLAUDE || null }));\n");
  const Path = [bin, path.dirname(process.execPath), path.join(SISTEMA, 'System32'), SISTEMA, path.join(SISTEMA, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
  const env = { Path, SystemRoot: SISTEMA, USERPROFILE: casa, LOCALAPPDATA: path.join(casa, 'local'), FALSO_ESTADO: estado, STUB_SAIDA: saida, TEMP: os.tmpdir(), TMP: os.tmpdir() };
  return {
    bin, env,
    lerEstado: () => JSON.parse(fs.readFileSync(estado, 'utf8')),
    lerStub: () => (fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, 'utf8')) : null),
  };
}
const ps = (env, args) => spawnSync(path.join(SISTEMA, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { env, encoding: 'utf8', timeout: 120_000, input: '' });

test('install.ps1: só ASCII', () => {
  const bytes = fs.readFileSync(SCRIPT);
  assert.ok(bytes.every((b) => b < 0x80), 'byte fora do ASCII');
});

test('install.ps1: o parser do PowerShell não acha erro', { skip: soWin }, () => {
  const cmd = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replaceAll("'", "''")}', [ref]$null, [ref]$e); $e.Count`;
  const r = ps(process.env, ['-Command', cmd]);
  assert.equal(r.stdout.trim(), '0', r.stdout + r.stderr);
});

test('install.ps1 -File: instala o principal e chama o instalar-tudo com as opções', { skip: soWin }, () => {
  const m = montar();
  const r = ps(m.env, ['-File', SCRIPT, '--sim', '-SemExtras']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log, [
    '--version', 'plugin marketplace add Garioli-Labs/claude-hadouken', 'plugin marketplace update claude-hadouken',
    'plugin list --json', 'plugin install claude-hadouken@claude-hadouken', 'plugin list --json',
  ]);
  assert.deepEqual(m.lerStub(), { argv: ['--sim', '--sem-extras'], claude: path.join(m.bin, 'claude.cmd') });
});

test('install.ps1 pelo iex: não fecha o PowerShell e deixa o código em $LASTEXITCODE', { skip: soWin }, () => {
  const m = montar();
  const cmd = `$env:HADOUKEN_INSTALAR = '--sim --sem-extras'; Get-Content -Raw -LiteralPath '${SCRIPT.replaceAll("'", "''")}' | iex; 'depois ' + $LASTEXITCODE; 'sobrou ' + [bool](Get-Variable Repasse, Claude -ErrorAction SilentlyContinue) + ' ' + [bool](Get-Command Hadouken-Principal -ErrorAction SilentlyContinue)`;
  const r = ps(m.env, ['-Command', cmd]);
  assert.match(r.stdout, /depois 0/, r.stdout + r.stderr);
  assert.match(r.stdout, /sobrou False False/, 'nem variável nem função do script na sessão de quem chamou');
  assert.deepEqual(m.lerStub().argv, ['--sim', '--sem-extras']);
});

test('install.ps1: claude abaixo de 2.1.251 recebe claude update', { skip: soWin }, () => {
  const m = montar({ versaoClaude: '2.1.200' });
  const r = ps(m.env, ['-File', SCRIPT, '--sim', '--sem-extras']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(m.lerEstado().log.slice(0, 3), ['--version', 'update', '--version']);
});

test('install.ps1: sem claude e com a entrada redirecionada, sai 1 sem instalar', { skip: soWin }, () => {
  const m = montar({ claude: false });
  const r = ps(m.env, ['-File', SCRIPT]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(m.lerStub(), null);
  assert.match(r.stdout + r.stderr, /claude\.ai\/install\.ps1/);
});

test('install.ps1: opção desconhecida sai 2', { skip: soWin }, () => {
  const m = montar();
  assert.equal(ps(m.env, ['-File', SCRIPT, '--xyz']).status, 2);
  assert.deepEqual(m.lerEstado().log, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/instalar-ps1.test.js`
Expected: FAIL (sem `install.ps1`).

- [ ] **Step 3: Implementar**

Criar `install.ps1` (só ASCII, CRLF ou LF tanto faz):

```powershell
# Instalador de um comando do claude-hadouken, Windows (spec v0.5.2).
#   irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
#   $env:HADOUKEN_INSTALAR = '--sim --sem-extras'; irm ... | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 --sim
# Passos 1 a 5: confere git, Node e claude; pergunta uma vez e instala o que
# falta (winget e o instalador oficial do Claude Code); instala o plugin
# principal; chama o instalar-tudo.js do plugin. Windows PowerShell 5.1.
# Tudo dentro do bloco: no irm | iex o script roda na sessao de quem chamou,
# e as funcoes nao ficam nela; o codigo vai para $LASTEXITCODE e so ha exit
# quando o script roda como arquivo. So ASCII (o 5.1 le .ps1 sem BOM como ANSI).

& {
  $ID = 'claude-hadouken@claude-hadouken'
  $NodeMin = [version]'20.0.0'
  $ClaudeMin = [version]'2.1.251'
  $Opcoes = @{
    '--sim' = '--sim'; '-sim' = '--sim'
    '--sem-extras' = '--sem-extras'; '-semextras' = '--sem-extras'
    '--com-aprendizado' = '--com-aprendizado'; '-comaprendizado' = '--com-aprendizado'
    '--substituir-barra' = '--substituir-barra'; '-substituirbarra' = '--substituir-barra'
  }

  function Hadouken-Parar([string]$texto) {
    Write-Host "claude-hadouken: $texto" -ForegroundColor Red
    throw 'HADOUKEN_PAROU'
  }

  function Hadouken-Pergunta([string]$texto, [bool]$padrao) {
    if ($Repasse -contains '--sim') { return $true }
    if ([Console]::IsInputRedirected) { return $false }
    $r = "$(Read-Host $texto)".Trim().ToLower()
    if ($r -eq '') { return $padrao }
    return @('s', 'sim', 'y', 'yes') -contains $r
  }

  function Hadouken-Exe([string[]]$nomes) {
    $c = Get-Command $nomes -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\WindowsApps\*' } | Select-Object -First 1
    if ($c) { return $c.Source }
    return $null
  }

  function Hadouken-Versao([string]$exe) {
    if (-not $exe) { return $null }
    try { $s = "$(& $exe --version 2>$null | Select-Object -First 1)" } catch { return $null }
    if ($s -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
  }

  function Hadouken-AtualizarPath {
    $partes = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path, "$env:USERPROFILE\.local\bin")
    $env:Path = ($partes | Where-Object { $_ }) -join ';'
  }

  function Hadouken-Utf8([scriptblock]$bloco) {
    $antes = $null
    try { $antes = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
    try { & $bloco } finally { if ($antes) { try { [Console]::OutputEncoding = $antes } catch { } } }
  }

  # installPath do plugin principal (escopo user) em `claude plugin list --json`.
  function Hadouken-PastaPlugin {
    $texto = Hadouken-Utf8 { (& $Claude plugin list --json 2>$null) -join "`n" }
    try { $lista = ConvertFrom-Json -InputObject $texto } catch { return $null }
    foreach ($p in $lista) {
      if ($p.id -eq $ID -and ($null -eq $p.scope -or $p.scope -eq 'user') -and $p.installPath -is [string]) { return $p.installPath }
    }
    return $null
  }

  function Hadouken-Winget([string]$id) {
    & $winget install --id $id -e --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Host
    return ($LASTEXITCODE -eq 0)
  }

  # Devolve o codigo de saida. Toda saida de comando nativo vai para o host
  # (| Out-Host): o que caisse no pipeline viraria parte do valor devolvido.
  # $Repasse vem do bloco; as funcoes chamadas daqui leem $Repasse e $Claude
  # desta funcao (escopo dinamico), e nada fica na sessao de quem chamou.
  function Hadouken-Principal {
    $env:Path = "$env:Path;$env:USERPROFILE\.local\bin"
    $winget = Hadouken-Exe @('winget.exe')
    # winget fica em WindowsApps: procurar de novo sem o filtro.
    if (-not $winget) { $w = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($w) { $winget = $w.Source } }

    # 1. Confere o PC.
    $faltaGit = -not (Hadouken-Exe @('git.exe', 'git.cmd'))
    $vNode = Hadouken-Versao (Hadouken-Exe @('node.exe'))
    $faltaNode = ($null -eq $vNode) -or ($vNode -lt $NodeMin)
    $vClaude = Hadouken-Versao (Hadouken-Exe @('claude.exe', 'claude.cmd'))
    $claudeAcao = if ($null -eq $vClaude) { 'instalar' } elseif ($vClaude -lt $ClaudeMin) { 'atualizar' } else { 'ok' }

    # 2 e 3. Pergunta uma vez e instala o que falta.
    if ($faltaGit -or $faltaNode -or $claudeAcao -ne 'ok') {
      Write-Host 'Falta para o claude-hadouken:'
      if ($faltaGit) { Write-Host '  - git (Git for Windows, que traz o Git Bash)' }
      if ($faltaNode) { Write-Host '  - Node 20 ou mais novo' }
      if ($claudeAcao -eq 'instalar') { Write-Host '  - Claude Code' }
      if ($claudeAcao -eq 'atualizar') { Write-Host "  - Claude Code $ClaudeMin ou mais novo (claude update)" }
      if (($faltaGit -or $faltaNode) -and -not $winget) {
        Hadouken-Parar 'sem winget: instale o Git (https://git-scm.com/) e o Node 20+ (https://nodejs.org/) e rode o comando de novo'
      }
      if (-not (Hadouken-Pergunta 'Instalar agora? [s/N]' $false)) {
        Hadouken-Parar 'nada instalado. Node: https://nodejs.org/ ; Claude Code: irm https://claude.ai/install.ps1 | iex'
      }
      if ($faltaGit -and -not (Hadouken-Winget 'Git.Git')) { Hadouken-Parar 'winget install Git.Git falhou; rode-o e depois o comando de novo' }
      if ($faltaNode -and -not (Hadouken-Winget 'OpenJS.NodeJS.LTS')) { Hadouken-Parar 'winget install OpenJS.NodeJS.LTS falhou; rode-o e depois o comando de novo' }
      if ($claudeAcao -eq 'instalar') {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Host
        if ($LASTEXITCODE -ne 0) { Hadouken-Parar 'o instalador do Claude Code falhou; rode irm https://claude.ai/install.ps1 | iex' }
      } elseif ($claudeAcao -eq 'atualizar') {
        & (Hadouken-Exe @('claude.exe', 'claude.cmd')) update | Out-Host
        if ($LASTEXITCODE -ne 0) { Hadouken-Parar 'claude update falhou; rode-o e depois o comando de novo' }
      }
      if ($faltaGit -or $faltaNode -or $claudeAcao -eq 'instalar') { Hadouken-AtualizarPath }
      $vNode = Hadouken-Versao (Hadouken-Exe @('node.exe'))
      if (($null -eq $vNode) -or ($vNode -lt $NodeMin)) { Hadouken-Parar 'o Node 20+ nao ficou disponivel; abra um PowerShell novo e rode o comando de novo' }
      $vClaude = Hadouken-Versao (Hadouken-Exe @('claude.exe', 'claude.cmd'))
      if (($null -eq $vClaude) -or ($vClaude -lt $ClaudeMin)) { Hadouken-Parar "o Claude Code $ClaudeMin+ nao ficou disponivel; abra um PowerShell novo e rode o comando de novo" }
    }

    # Extras de pacote (Python e gh); o pip e o setup.sh ficam no instalar-tudo.
    if ($Repasse -notcontains '--sem-extras') {
      Write-Host 'Extras: Python 3 (~100 MiB), graphify (pip), Playwright com Chromium, axe-core e lighthouse da yu-ux (~150 MiB) e o gh.'
      if (Hadouken-Pergunta 'Instalar tambem os extras? [S/n]' $true) {
        $mudou = $false
        if (-not (Hadouken-Exe @('python.exe', 'py.exe'))) {
          if ($winget) { if (Hadouken-Winget 'Python.Python.3.12') { $mudou = $true } else { Write-Host 'claude-hadouken: winget install Python.Python.3.12 falhou; os outros extras seguem' } }
        }
        if (-not (Hadouken-Exe @('gh.exe'))) {
          if ($winget) { if (Hadouken-Winget 'GitHub.cli') { $mudou = $true } else { Write-Host 'claude-hadouken: winget install GitHub.cli falhou; os outros extras seguem' } }
        }
        if ($mudou) { Hadouken-AtualizarPath }
      } else {
        $Repasse = @($Repasse) + '--sem-extras'
      }
    }

    # 4. O plugin principal.
    $Claude = Hadouken-Exe @('claude.exe', 'claude.cmd')
    & $Claude plugin marketplace add Garioli-Labs/claude-hadouken *> $null
    & $Claude plugin marketplace update claude-hadouken *> $null
    if (Hadouken-PastaPlugin) { & $Claude plugin update $ID | Out-Host } else { & $Claude plugin install $ID | Out-Host }

    # 5. A pasta do plugin e o resto em Node.
    $raiz = Hadouken-PastaPlugin
    $tudo = if ($raiz) { Join-Path $raiz 'src\instalar-tudo.js' } else { $null }
    if (-not $tudo -or -not (Test-Path -LiteralPath $tudo)) { Hadouken-Parar "o plugin nao instalou; rode claude plugin install $ID" }
    $env:HADOUKEN_CLAUDE = $Claude
    $py = Hadouken-Exe @('python.exe', 'py.exe')
    if ($py) { $env:HADOUKEN_PYTHON = $py }
    try {
      $node = Hadouken-Exe @('node.exe')
      Hadouken-Utf8 { & $node $tudo @Repasse | Out-Host }
      $codigo = $LASTEXITCODE
    } finally {
      Remove-Item Env:HADOUKEN_CLAUDE, Env:HADOUKEN_PYTHON -ErrorAction SilentlyContinue
    }
    $gh = Hadouken-Exe @('gh.exe')
    if ($gh) { & $gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Write-Host 'Proximo passo, para a secao do GitHub no relatorio: gh auth login' } }
    Write-Host 'Os limites de 5 h e 7 dias aparecem nos planos Pro e Max.'
    return $codigo
  }

  # Opcoes: argumentos (-File) e HADOUKEN_INSTALAR (irm | iex).
  $Repasse = @()
  $codigo = 0
  foreach ($a in @($args) + @("$env:HADOUKEN_INSTALAR" -split '\s+' | Where-Object { $_ })) {
    $k = "$a".ToLower()
    if (-not $Opcoes.ContainsKey($k)) {
      Write-Host 'claude-hadouken: opcao desconhecida; as opcoes sao --sim, --sem-extras, --com-aprendizado e --substituir-barra' -ForegroundColor Red
      $codigo = 2
      break
    }
    if ($Repasse -notcontains $Opcoes[$k]) { $Repasse += $Opcoes[$k] }
  }
  if ($codigo -eq 0) {
    try {
      $codigo = Hadouken-Principal
    } catch {
      if ("$_" -ne 'HADOUKEN_PAROU') { Write-Host "claude-hadouken: erro inesperado: $_" -ForegroundColor Red }
      $codigo = 1
    }
  }
  $global:LASTEXITCODE = $codigo
} @args

if ($MyInvocation.MyCommand.CommandType -eq 'ExternalScript' -and $MyInvocation.MyCommand.Name -eq 'install.ps1') { exit $global:LASTEXITCODE }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/instalar-ps1.test.js`
Expected: PASS no Windows; no Linux e no Mac, só o teste de ASCII roda (e passa).

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(instalar): install.ps1 de um comando para Windows (PowerShell 5.1, irm | iex)' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add install.ps1 test/instalar-ps1.test.js
git commit -q -F /tmp/msg052
```

---

### Task 9: o robô semanal (`kit-atualizar`)

**Files:**
- Create: `.github/scripts/kit-atualizar.mjs`, `.github/workflows/kit-atualizar.yml`, `test/kit-atualizar.test.js`
- Modify: `kit/testado.json` (chave `pip`), `test/kit-manifestos.test.js` (confere a chave `pip`)
- Delete: `.github/scripts/kit-versoes.mjs`, `.github/workflows/kit-versoes.yml`, `test/kit-versoes.test.js`

**Interfaces:**
- Consumes: `.claude-plugin/marketplace.json` e `kit/testado.json` no formato da Task 3; `export const VERSAO_REA = 'x.y.z';` em `rea/lancar.mjs:16`; `rea/.claude-plugin/plugin.json` e `kit/.claude-plugin/plugin.json`.
- Produces (`.github/scripts/kit-atualizar.mjs`): `TERCEIROS`; `xyz(v)`; `compararVersoes(testada, publicada)` → `'igual'|'menor'|'principal'|'anterior'|'pre-release'|'invalida'`; `decidir(testado, lidos)` → `{ terceiros: [{ nome, de, para, sha, tipo }], rea: { de, para, tipo } | null }`; `subirPatch(v)`; `aplicarMarketplace(texto, decisao, versoes)`, `aplicarTestado(texto, decisao)`, `aplicarLancar(texto, versao)`, `aplicarPluginJson(texto, versao)` → `string`; `tituloIssue(decisao)`; `avisoPip(testado, publicada)` → `string | null`. Saídas do job: `mudou` (`sim`/`nao`), `titulo`, `versao_kit`, `ramo`, `aviso`.

Regras do workflow (spec, peça 3, e o padrão do `ci.yml`): `permissions: {}` no topo e o mínimo por job; ações fixadas por sha; `persist-credentials: false` em todo checkout (o push vai pela URL com o token, só nos passos que precisam); `${{ }}` só em `env`, `with`, `if`, `outputs`, `runs-on` e `strategy`, nunca dentro de `run` (o texto de fora passa por variável de ambiente). Push na `main` pelo `GITHUB_TOKEN` não dispara outros workflows: o robô roda a suíte ele mesmo antes. Se a `main` tiver proteção de branch que barre o `GITHUB_TOKEN`, o job `publicar` falha e o `avisar` abre a issue (anotar no relatório; a liberação é decisão do Sr. Garioli).

O retrato `test/dados/mattpocock-skills.json` amarra a lista de skills do Matt: versão nova dele que muda a lista quebra a suíte no ramo do robô e vira issue. É a trava pedida ("testado, mas automático").

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/kit-atualizar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aplicarLancar, aplicarMarketplace, aplicarPluginJson, aplicarTestado, avisoPip, compararVersoes, decidir, subirPatch, TERCEIROS, tituloIssue, xyz,
} from '../.github/scripts/kit-atualizar.mjs';

// Robô semanal (spec v0.5.2, peça 3): funções puras, sem rede, e o workflow
// conferido pelo texto.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ler = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const testado = JSON.parse(ler('kit/testado.json'));
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
  };
  assert.deepEqual(decidir(testado, lidos), {
    terceiros: [
      { nome: 'mattpocock-skills', de: '1.3.1', para: '1.4.0', sha: SHA_A, tipo: 'menor' },
      { nome: 'poka-yoke', de: '0.2.0', para: '1.0.0', sha: SHA_B, tipo: 'principal' },
    ],
    rea: null,
  });
  assert.deepEqual(decidir(testado, { terceiros: {}, rea: '6.2.0' }).rea, { de: '6.1.0', para: '6.2.0', tipo: 'menor' });
  assert.deepEqual(decidir(testado, { terceiros: { 'poka-yoke': null }, rea: '7.0.0-beta.1' }), { terceiros: [], rea: null });
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
  const t = JSON.parse(aplicarTestado(ler('kit/testado.json'), DECISAO));
  assert.equal(t.dependencias['mattpocock-skills@claude-hadouken'], '1.4.0');
  assert.equal(t.dependencias['poka-yoke@claude-hadouken'], '0.2.0');
  assert.equal(t.npm['rea-agents'], '6.2.0');
  assert.equal(t.pip.graphifyy, '0.9.25');
  const lancar = aplicarLancar(ler('rea/lancar.mjs'), '6.2.0');
  assert.match(lancar, /export const VERSAO_REA = '6\.2\.0';/);
  assert.equal(lancar.replace("'6.2.0'", "'6.1.0'"), ler('rea/lancar.mjs'), 'só a constante muda');
  assert.throws(() => aplicarLancar('sem a constante', '6.2.0'));
  assert.throws(() => aplicarLancar("export const VERSAO_REA = '1.0.0';\nexport const VERSAO_REA = '1.0.0';", '6.2.0'));
  assert.equal(JSON.parse(aplicarPluginJson(ler('kit/.claude-plugin/plugin.json'), '1.1.1')).version, '1.1.1');
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
  const jobs = WF.split(/^ {2}(?=[a-z-]+:$)/m).slice(1);
  const perm = Object.fromEntries(jobs.map((j) => [j.split(':')[0], /permissions:\n((?: {6}.+\n)+)/.exec(j)?.[1].trim().split(/\n\s*/) ?? null]));
  assert.deepEqual(perm, {
    preparar: ['contents: write'], testar: ['contents: read'], publicar: ['contents: write'],
    avisar: ['issues: write'], 'avisar-pip': ['issues: write'],
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

test('o aviso semanal antigo saiu', () => {
  for (const rel of ['.github/scripts/kit-versoes.mjs', '.github/workflows/kit-versoes.yml', 'test/kit-versoes.test.js']) {
    assert.equal(fs.existsSync(path.join(repo, rel)), false, rel);
  }
});
```

Em `test/kit-manifestos.test.js`, no teste `'testado.json: …'` da Task 3, acrescentar depois da linha do `rea-agents`:

```js
  assert.deepEqual(t.pip, { graphifyy: '0.9.25' });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/kit-atualizar.test.js test/kit-manifestos.test.js`
Expected: FAIL (o script e o workflow não existem; `testado.json` sem `pip`).

- [ ] **Step 3: Implementar**

`kit/testado.json` ganha a chave `pip`:

```json
{
  "dependencias": {
    "claude-hadouken@claude-hadouken": "0.5.2",
    "superpowers@claude-plugins-official": "6.4.1",
    "mattpocock-skills@claude-hadouken": "1.3.1",
    "poka-yoke@claude-hadouken": "0.2.0",
    "fullstack-dev-skills@claude-hadouken": "0.4.16",
    "ui-ux-pro-max@claude-hadouken": "2.13.0"
  },
  "npm": { "rea-agents": "6.1.0" },
  "pip": { "graphifyy": "0.9.25" }
}
```

Criar `.github/scripts/kit-atualizar.mjs`:

```js
// Robô semanal do hadouken-kit (spec v0.5.2, "Atualização automática", peça
// 3). Roda só no GitHub Actions: a rede fica aqui, nunca no plugin. Para cada
// terceiro do marketplace, lê o commit do branch padrão e a versão do
// plugin.json naquele commit; para o rea-agents, a latest do npm. Só versão
// maior que a testada entra (menor ou principal: as duas passam pela suíte);
// commit novo com a mesma versão não chegaria ao usuário. As funções
// aplicar* são puras; o main grava os arquivos e as saídas do job, e o
// workflow testa o ramo antes de publicar. Do texto de fora, só x.y.z e sha
// de 40 hex chegam aos arquivos, ao título e às saídas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TERCEIROS = Object.freeze({
  'mattpocock-skills': { repo: 'mattpocock/skills', manifesto: '.claude-plugin/plugin.json' },
  'poka-yoke': { repo: 'rainmanjam/poka-yoke', manifesto: 'plugins/poka-yoke/.claude-plugin/plugin.json' },
  'fullstack-dev-skills': { repo: 'jeffallan/claude-skills', manifesto: '.claude-plugin/plugin.json' },
  'ui-ux-pro-max': { repo: 'nextlevelbuilder/ui-ux-pro-max-skill', manifesto: '.claude-plugin/plugin.json' },
});
const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;
const PRE = /^\d+\.\d+\.\d+-/;
const MAIOR = new Set(['menor', 'principal']);

export function xyz(v) {
  return SEMVER.exec(typeof v === 'string' ? v : '')?.[0] ?? null;
}

// Pré-release publicada não é versão nova; a final entra quando sair.
export function compararVersoes(testada, publicada) {
  const a = SEMVER.exec(testada ?? '');
  const b = SEMVER.exec(publicada ?? '');
  if (!a || !b) return 'invalida';
  if (PRE.test(publicada)) return 'pre-release';
  for (const i of [1, 2, 3]) {
    if (Number(b[i]) === Number(a[i])) continue;
    if (Number(b[i]) < Number(a[i])) return 'anterior';
    return i === 1 ? 'principal' : 'menor';
  }
  return 'igual';
}

// lidos: { terceiros: { <nome>: { sha, versao } | null }, rea: string | null }
export function decidir(testado, lidos) {
  const terceiros = [];
  for (const nome of Object.keys(TERCEIROS)) {
    const l = lidos.terceiros?.[nome];
    const de = testado.dependencias[`${nome}@claude-hadouken`];
    if (!l || typeof l.sha !== 'string' || !SHA.test(l.sha)) continue;
    const tipo = compararVersoes(de, l.versao);
    if (MAIOR.has(tipo)) terceiros.push({ nome, de, para: xyz(l.versao), sha: l.sha, tipo });
  }
  const deRea = testado.npm['rea-agents'];
  const tipoRea = compararVersoes(deRea, lidos.rea);
  const rea = MAIOR.has(tipoRea) ? { de: deRea, para: xyz(lidos.rea), tipo: tipoRea } : null;
  return { terceiros, rea };
}

export function subirPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`versão inválida: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

const json = (valor) => `${JSON.stringify(valor, null, 2)}\n`;

function entrada(m, nome) {
  const p = Array.isArray(m.plugins) ? m.plugins.find((x) => x?.name === nome) : null;
  if (!p) throw new Error(`entrada ausente no marketplace: ${nome}`);
  return p;
}

export function aplicarMarketplace(texto, { terceiros, rea }, versoes) {
  const m = JSON.parse(texto);
  for (const t of terceiros) {
    const p = entrada(m, t.nome);
    if (typeof p.source !== 'object' || p.source === null) throw new Error(`entrada sem fonte remota: ${t.nome}`);
    p.source.sha = t.sha;
  }
  entrada(m, 'hadouken-kit').version = versoes.kit;
  if (rea) entrada(m, 'hadouken-rea').version = versoes.rea;
  return json(m);
}

export function aplicarTestado(texto, { terceiros, rea }) {
  const t = JSON.parse(texto);
  for (const x of terceiros) t.dependencias[`${x.nome}@claude-hadouken`] = x.para;
  if (rea) t.npm['rea-agents'] = rea.para;
  return json(t);
}

export function aplicarLancar(texto, versao) {
  const re = /export const VERSAO_REA = '\d+\.\d+\.\d+';/g;
  const achados = texto.match(re) ?? [];
  if (achados.length !== 1) throw new Error(`VERSAO_REA aparece ${achados.length} vezes em rea/lancar.mjs`);
  return texto.replace(re, `export const VERSAO_REA = '${versao}';`);
}

export function aplicarPluginJson(texto, versao) {
  const p = JSON.parse(texto);
  p.version = versao;
  return json(p);
}

export function tituloIssue({ terceiros, rea }) {
  const partes = terceiros.map((t) => `${t.nome} ${t.de} → ${t.para}`);
  if (rea) partes.push(`rea-agents ${rea.de} → ${rea.para}`);
  return `robô: ${partes.join(', ')}`;
}

// O graphify empacotado depende do graphifyy do pip: versão nova só avisa.
export function avisoPip(testado, publicada) {
  const de = testado.pip?.graphifyy;
  return MAIOR.has(compararVersoes(de, publicada)) ? `robô: graphifyy ${xyz(publicada)} no pip (o kit testa ${de})` : null;
}

async function pedir(url, aceitar) {
  const cabecalhos = { 'User-Agent': 'claude-hadouken-robo', Accept: aceitar };
  if (url.startsWith('https://api.github.com/') && process.env.GH_TOKEN) cabecalhos.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const r = await fetch(url, { headers: cabecalhos, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function lerTerceiro({ repo, manifesto }) {
  const sha = (await pedir(`https://api.github.com/repos/${repo}/commits/HEAD`, 'application/vnd.github.sha')).trim();
  if (!SHA.test(sha)) return null;
  const m = JSON.parse(await pedir(`https://raw.githubusercontent.com/${repo}/${sha}/${manifesto}`, 'application/json'));
  return { sha, versao: typeof m.version === 'string' ? m.version : null };
}

async function main() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const arq = (rel) => path.join(raiz, rel);
  const lerArq = (rel) => fs.readFileSync(arq(rel), 'utf8');
  const testado = JSON.parse(lerArq('kit/testado.json'));
  const lidos = { terceiros: {}, rea: null };
  const notas = [];
  for (const [nome, t] of Object.entries(TERCEIROS)) {
    lidos.terceiros[nome] = await lerTerceiro(t).catch((e) => { notas.push(`${nome}: ${e.message}`); return null; });
  }
  lidos.rea = await pedir('https://registry.npmjs.org/rea-agents/latest', 'application/json').then((t) => JSON.parse(t).version, () => null);
  const pip = await pedir('https://pypi.org/pypi/graphifyy/json', 'application/json').then((t) => JSON.parse(t).info?.version, () => null);
  const decisao = decidir(testado, lidos);
  const saidas = { mudou: 'nao', titulo: '', versao_kit: '', ramo: '', aviso: avisoPip(testado, pip) ?? '' };
  if (decisao.terceiros.length > 0 || decisao.rea) {
    const kit = JSON.parse(lerArq('kit/.claude-plugin/plugin.json'));
    const versoes = { kit: subirPatch(kit.version), rea: null };
    if (decisao.rea) {
      versoes.rea = subirPatch(JSON.parse(lerArq('rea/.claude-plugin/plugin.json')).version);
      fs.writeFileSync(arq('rea/lancar.mjs'), aplicarLancar(lerArq('rea/lancar.mjs'), decisao.rea.para));
      fs.writeFileSync(arq('rea/.claude-plugin/plugin.json'), aplicarPluginJson(lerArq('rea/.claude-plugin/plugin.json'), versoes.rea));
    }
    fs.writeFileSync(arq('.claude-plugin/marketplace.json'), aplicarMarketplace(lerArq('.claude-plugin/marketplace.json'), decisao, versoes));
    fs.writeFileSync(arq('kit/testado.json'), aplicarTestado(lerArq('kit/testado.json'), decisao));
    fs.writeFileSync(arq('kit/.claude-plugin/plugin.json'), aplicarPluginJson(lerArq('kit/.claude-plugin/plugin.json'), versoes.kit));
    Object.assign(saidas, { mudou: 'sim', titulo: tituloIssue(decisao), versao_kit: versoes.kit, ramo: `robo/kit-${new Date().toISOString().slice(0, 10)}` });
  }
  const resumo = [`## kit-atualizar`, '', saidas.mudou === 'sim' ? saidas.titulo : 'nada novo', ...notas.map((n) => `- não li ${n}`)].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resumo}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(saidas).map(([k, v]) => `${k}=${v}\n`).join(''));
  console.log(resumo);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
```

O primeiro ramo do robô regrava `marketplace.json` e `testado.json` em JSON de 2 espaços (uma chave por linha); é só forma, e os testes leem o JSON, não o texto.

Criar `.github/workflows/kit-atualizar.yml`:

```yaml
name: kit-atualizar

# Robô semanal do hadouken-kit (spec v0.5.2): sobe os sha dos terceiros e a
# versão do rea-agents num ramo, roda a suíte em 3 sistemas x 3 Nodes e, tudo
# verde, publica na main com tag e release. Algum vermelho: issue, nada
# publicado. Push pelo GITHUB_TOKEN não dispara outros workflows, por isso a
# suíte roda aqui. ${{ }} nunca dentro de run: o texto vai por env.
on:
  schedule:
    - cron: '17 9 * * 1'   # segunda, 09:17 UTC
  workflow_dispatch:

permissions: {}

concurrency:
  group: kit-atualizar
  cancel-in-progress: false

jobs:
  preparar:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    outputs:
      mudou: ${{ steps.robo.outputs.mudou }}
      titulo: ${{ steps.robo.outputs.titulo }}
      versao_kit: ${{ steps.robo.outputs.versao_kit }}
      ramo: ${{ steps.robo.outputs.ramo }}
      aviso: ${{ steps.robo.outputs.aviso }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          package-manager-cache: false
      - id: robo
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node .github/scripts/kit-atualizar.mjs
      - name: Empurrar o ramo do robô
        if: steps.robo.outputs.mudou == 'sim'
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          RAMO: ${{ steps.robo.outputs.ramo }}
          TITULO: ${{ steps.robo.outputs.titulo }}
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git switch -c "$RAMO"
          git add .claude-plugin/marketplace.json kit/.claude-plugin/plugin.json kit/testado.json rea/.claude-plugin/plugin.json rea/lancar.mjs
          git commit -q -m "$TITULO"
          git push --force -q "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/$RAMO"

  testar:
    needs: preparar
    if: needs.preparar.outputs.mudou == 'sim'
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [20, 22, 24]
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.preparar.outputs.ramo }}
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: ${{ matrix.node }}
          package-manager-cache: false
      - run: node --test

  publicar:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: [preparar, testar]
    if: needs.preparar.outputs.mudou == 'sim' && needs.testar.result == 'success'
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Merge rápido na main, tag e release
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          RAMO: ${{ needs.preparar.outputs.ramo }}
          VERSAO: ${{ needs.preparar.outputs.versao_kit }}
          TITULO: ${{ needs.preparar.outputs.titulo }}
        run: |
          ORIGEM="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
          git fetch -q origin "refs/heads/$RAMO"
          # A main não andou desde o ramo: senão, nada é publicado.
          git merge-base --is-ancestor HEAD FETCH_HEAD
          git push -q "$ORIGEM" "FETCH_HEAD:refs/heads/main"
          git tag "kit-v$VERSAO" FETCH_HEAD
          git push -q "$ORIGEM" "refs/tags/kit-v$VERSAO"
          gh release create "kit-v$VERSAO" --verify-tag --title "hadouken-kit $VERSAO" --notes "$TITULO"
          git push -q "$ORIGEM" --delete "$RAMO"

  avisar:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: [preparar, testar, publicar]
    if: always() && needs.preparar.outputs.mudou == 'sim' && (needs.testar.result == 'failure' || needs.publicar.result == 'failure')
    permissions:
      issues: write
    steps:
      - name: Abrir issue (sem duplicar uma aberta)
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_REPO: ${{ github.repository }}
          TITULO: ${{ needs.preparar.outputs.titulo }}
          RAMO: ${{ needs.preparar.outputs.ramo }}
        run: |
          n=$(gh issue list --state open --limit 500 --json title --jq '[.[] | select(.title == $ENV.TITULO)] | length')
          if [ "$n" = 0 ]; then
            gh issue create --title "$TITULO" --body "O robô preparou o ramo \`$RAMO\`, mas a suíte ou a publicação falhou, e nada foi publicado. Execução: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
          fi

  avisar-pip:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: preparar
    if: needs.preparar.outputs.aviso != ''
    permissions:
      issues: write
    steps:
      - name: Abrir issue do graphifyy (uma por versão, aberta ou fechada)
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_REPO: ${{ github.repository }}
          AVISO: ${{ needs.preparar.outputs.aviso }}
        run: |
          n=$(gh issue list --state all --limit 500 --json title --jq '[.[] | select(.title == $ENV.AVISO)] | length')
          if [ "$n" = 0 ]; then
            gh issue create --title "$AVISO" --body "Versão nova do graphifyy no pip. O kit e o instalador fixam a testada em \`kit/testado.json\` e em \`src/instalar-tudo.js\` (GRAPHIFY). Teste e atualize os dois."
          fi
```

Apagar os três arquivos antigos:

```bash
git rm -q .github/scripts/kit-versoes.mjs .github/workflows/kit-versoes.yml test/kit-versoes.test.js
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/kit-atualizar.test.js test/kit-manifestos.test.js`
Expected: PASS.

Run: `node --test`
Expected: PASS na suíte inteira.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(kit): robô semanal que sobe os sha dos terceiros, testa em 3x3 e publica; sai o kit-versoes' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add .github/scripts/kit-atualizar.mjs .github/workflows/kit-atualizar.yml test/kit-atualizar.test.js kit/testado.json test/kit-manifestos.test.js
git commit -q -F /tmp/msg052
```

(Os três arquivos apagados já estão no índice pelo `git rm`.)

---

### Task 10: documentação e prova real

**Files:**
- Modify: `README.md`, `README.en.md`, `SECURITY.md`

**Interfaces:**
- Consumes: os comandos e as opções das Global Constraints; o comportamento das Tasks 1 a 9.

Os trechos abaixo são localizados pelo texto (Grep), não pelo número da linha, que muda.

- [ ] **Step 1: README.md**

1. Logo abaixo de `## Instalação`, antes de `### Requisitos`, inserir:

````markdown
### Um comando

No terminal (fora do Claude Code), num PC novo ou para atualizar:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

No Windows, no PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Ele confere o Node (20+), o git e o Claude Code (2.1.251+); se faltar algum, mostra a lista e pergunta uma vez antes de instalar (Node e git pelo winget ou pelo brew, o Claude Code pelo instalador oficial). Depois instala o `claude-hadouken`, o `hadouken-kit` e o `hadouken-rea` (ligado se o Node for 22.19+, 24.11+ ou 26+), põe a barra, instala o item do VS Code, liga a atualização automática e, se você aceitar, os extras (Python, `graphify`, as ferramentas da `yu-ux-web-expert` e o `gh`). O aprendizado local só liga se você responder "s". No fim, um resumo de uma linha por item; rodar de novo atualiza e pula o que já está certo.

Opções (no bash, `| bash -s -- <opções>`; no PowerShell, `$env:HADOUKEN_INSTALAR = '<opções>'` antes do `irm`):

| Opção | Faz |
|---|---|
| `--sim` | responde sim às perguntas; não troca uma barra de outro plugin e não liga o aprendizado |
| `--substituir-barra` | troca uma `statusLine` que não é a do claude-hadouken (com backup) |
| `--sem-extras` | não instala os extras |
| `--com-aprendizado` | liga o aprendizado local sem perguntar |

O passo a passo abaixo é o caminho manual, com os mesmos resultados.
````

2. Em `### Requisitos`, trocar a linha que começa com `- Opcional, para o painel: **VS Code** com o comando` por:

```markdown
- Opcional, para o painel: **VS Code**. O plugin acha o `code` no `PATH` (no Windows, `code.cmd`) e, no Mac, também dentro do `Visual Studio Code.app` em `/Applications` ou `~/Applications`, sem precisar do "Shell Command: Install 'code' command in PATH". Para a leitura do Fable, o executável `claude` em `~/.local/bin` ou no `PATH` (no Windows, `claude.exe`).
```

3. Na seção `### Instalar, desligar e remover` do painel, no item `- **Instalação sozinha.**`, trocar `Precisa do comando \`code\` no \`PATH\` (no Windows, \`code.cmd\`).` por `Precisa do comando \`code\` no \`PATH\` (no Windows, \`code.cmd\`; no Mac, o do \`Visual Studio Code.app\` em \`/Applications\` ou \`~/Applications\` também serve). Se a instalação falhar, o início de sessão seguinte diz o motivo numa linha, com o conserto.`

4. Em `**4. O painel no VS Code se instala sozinho.**`, trocar `Com o comando \`code\` no \`PATH\`,` por `Com o VS Code instalado (o comando \`code\` no \`PATH\`, ou no Mac o app em \`/Applications\`),`.

5. Em `## Limitações conhecidas`, no item `- **O painel precisa do \`code\` e do \`claude\`.**`, trocar `Sem o comando \`code\` no \`PATH\`, a extensão não se instala sozinha.` por `Sem o comando \`code\` no \`PATH\` (no Mac, sem o app em \`/Applications\` ou \`~/Applications\`), a extensão não se instala sozinha, e o início de sessão diz isso numa linha.`

6. No FAQ, na resposta que começa com `Sim. A barra é um comando que o Claude Code roda`, trocar `com Node 20 e 24` por `com Node 20 e 24 (o robô do kit, com 20, 22 e 24)`.

7. Em `## hadouken-kit e hadouken-rea (opcionais)`, trocar o item `- **Versões.**` inteiro por:

```markdown
- **Versões e atualização automática.** Os terceiros do kit (`mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` e `ui-ux-pro-max`) são entradas do marketplace do Hadouken com o commit fixado (`sha`); o `superpowers` segue no marketplace oficial. O instalador de um comando liga `autoUpdate` no marketplace do Hadouken (no seu `settings.json`, com backup) e desliga as cópias antigas dos terceiros, que vinham dos marketplaces de cada um, para as skills não aparecerem em dobro (nada é desinstalado; desfazer é pôr `true` de volta em `enabledPlugins`). Toda segunda, um robô no GitHub Actions confere as versões publicadas: versão nova de um terceiro ou do `rea-agents` vai para um ramo, a suíte roda em Linux, Windows e macOS com Node 20, 22 e 24 e, tudo verde, o robô publica sozinho (tag `kit-v<versão>`); algum vermelho vira issue e nada é publicado. Versão nova do `graphifyy` (pip) só abre issue. O kit só fala com a rede quando o `setup.sh` da yu-ux roda (npm, pip, Playwright) e o REA, quando ligado, no primeiro `npx`.
```

8. Em `### Atualizar`, trocar o primeiro parágrafo (`Marketplaces de terceiros não se atualizam sozinhos por padrão. Para atualizar, use …`) por:

```markdown
Quem instalou pelo comando único tem a atualização automática ligada: o Claude Code atualiza o marketplace e os plugins do Hadouken depois da primeira mensagem de uma sessão, e a versão nova vale na sessão seguinte (`DISABLE_AUTOUPDATER=1` desliga). Para atualizar na hora, rode o comando único de novo, use **Update now** na aba **Installed** do `/plugin`, ou, no terminal:
```

9. Na tabela do Sumário, acrescentar a âncora `- [Um comando](#um-comando)` como primeiro subitem de `[Instalação](#instalação)`, no mesmo recuo dos outros subitens.

- [ ] **Step 2: README.en.md**

Os mesmos nove pontos, em inglês, localizados pelos equivalentes (`## Installation`, `### Requirements`, `- **Automatic install.**`, `**4. `, `## Known limitations`, o FAQ com `Node 20 and 24`, `- **Versions.**`, `### Updating` e o índice). Textos:

```markdown
### One command

In the terminal (outside Claude Code), on a new machine or to update:

    curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash

On Windows, in PowerShell:

    irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex

It checks Node (20+), git and Claude Code (2.1.251+); if any is missing, it lists them and asks once before installing (Node and git through winget or brew, Claude Code through the official installer). Then it installs `claude-hadouken`, `hadouken-kit` and `hadouken-rea` (on if Node is 22.19+, 24.11+ or 26+), sets the bar, installs the VS Code item, turns on automatic updates and, if you accept, the extras (Python, `graphify`, the `yu-ux-web-expert` tools and `gh`). Local learning only turns on if you answer "s". At the end, a one-line summary per item; running it again updates and skips what is already right.

Options (in bash, `| bash -s -- <options>`; in PowerShell, `$env:HADOUKEN_INSTALAR = '<options>'` before `irm`):

| Option | Does |
|---|---|
| `--sim` | answers yes to the questions; does not replace another plugin's bar and does not turn on learning |
| `--substituir-barra` | replaces a `statusLine` that is not claude-hadouken's (with a backup) |
| `--sem-extras` | skips the extras |
| `--com-aprendizado` | turns on local learning without asking |

The steps below are the manual path, with the same result.
```

(Aqui os comandos vão em bloco recuado só para caber no plano; no arquivo, usar blocos com três crases e `bash`/`powershell`, como no README.md.)

- Requirements: `- Optional, for the panel: **VS Code**. The plugin finds \`code\` on \`PATH\` (on Windows, \`code.cmd\`) and, on a Mac, also inside \`Visual Studio Code.app\` in \`/Applications\` or \`~/Applications\`, without "Shell Command: Install 'code' command in PATH". For the Fable reading, the \`claude\` executable in \`~/.local/bin\` or on \`PATH\` (on Windows, \`claude.exe\`).`
- Automatic install: `It needs the \`code\` command on \`PATH\` (on Windows, \`code.cmd\`; on a Mac, the one in \`Visual Studio Code.app\` in \`/Applications\` or \`~/Applications\` also works). If the install fails, the next session start gives the reason in one line, with the fix.`
- Step 4: `With VS Code installed (the \`code\` command on \`PATH\`, or on a Mac the app in \`/Applications\`),`
- Known limitations: `Without the \`code\` command on \`PATH\` (on a Mac, without the app in \`/Applications\` or \`~/Applications\`), the extension does not install itself, and the session start says so in one line.`
- FAQ: `with Node 20 and 24 (the kit robot, with 20, 22 and 24)`
- Versions: `- **Versions and automatic updates.** The kit's third parties (\`mattpocock-skills\`, \`poka-yoke\`, \`fullstack-dev-skills\` and \`ui-ux-pro-max\`) are entries in the hadouken marketplace with a pinned commit (\`sha\`); \`superpowers\` stays in the official marketplace. The one-command installer turns on \`autoUpdate\` for the hadouken marketplace (in your \`settings.json\`, with a backup) and turns off the old copies of the third parties, which came from each one's own marketplace, so skills do not show up twice (nothing is uninstalled; to undo, set \`true\` back in \`enabledPlugins\`). Every Monday, a GitHub Actions robot checks the published versions: a new version of a third party or of \`rea-agents\` goes to a branch, the suite runs on Linux, Windows and macOS with Node 20, 22 and 24 and, all green, the robot publishes by itself (tag \`kit-v<version>\`); any red becomes an issue and nothing is published. A new \`graphifyy\` (pip) version only opens an issue. The kit only touches the network when yu-ux's \`setup.sh\` runs (npm, pip, Playwright) and the REA, when on, on the first \`npx\`.`
- Updating: `If you installed with the one command, automatic updates are on: Claude Code updates the hadouken marketplace and plugins after the first message of a session, and the new version applies in the next session (\`DISABLE_AUTOUPDATER=1\` turns it off). To update now, run the one command again, use **Update now** in the **Installed** tab of \`/plugin\`, or, in the terminal:`

- [ ] **Step 3: SECURITY.md**

1. No item `- **K1, os plugins opcionais …` (pt), trocar a frase `As dependências do kit vêm de marketplaces de terceiros que o próprio usuário registra com \`claude plugin marketplace add\`; o \`allowCrossMarketplaceDependenciesOn\` do marketplace lista só esses cinco.` por:

`Desde a v0.5.2, os terceiros do kit são entradas do próprio marketplace do Hadouken com o commit fixado (\`sha\` de 40 hex): o Claude Code instala exatamente o commit que a suíte testou. O \`allowCrossMarketplaceDependenciesOn\` lista só o \`claude-plugins-official\` (do \`superpowers\`). Quem sobe os \`sha\` é o robô semanal (\`.github/scripts/kit-atualizar.mjs\`, a única rede do repositório fora do plugin): ramo próprio, suíte em 3 sistemas × 3 Nodes, e só então merge rápido na \`main\`, tag e release pelo \`GITHUB_TOKEN\`. **Risco aceito:** o robô publica código de terceiros sem revisão humana; a trava é a suíte (que confere o mapa do fluxo contra as skills de cada terceiro) e o \`sha\` fixo.`

2. No mesmo item, acrescentar no fim:

`O instalador de um comando (\`install.sh\`, \`install.ps1\` e \`src/instalar/\`) roda fora de sessão, pelo usuário no terminal. Ele abre processos filhos com argumentos fixos: o \`claude\` (caminho absoluto conferido pelo \`caminhoSeguro\`; no Windows, o \`claude.cmd\` só pelo \`cmd.exe\` do System32), o \`pip\` do Python do usuário (\`graphifyy==0.9.25\`) e o \`setup.sh\` da yu-ux; o código de \`src/instalar*\` não abre conexão (teste de fronteira). No \`settings.json\`, só pelo gravador da barra (backup, sem link, troca conferida), muda \`extraKnownMarketplaces["claude-hadouken"]\` (\`autoUpdate: true\`) e põe \`false\` nas cópias antigas dos terceiros em \`enabledPlugins\`. Os scripts não usam \`sudo\` e não leem nem gravam segredo; o texto de fora (saída do \`claude\`, do \`winget\`, do \`brew\`, do \`pip\`) não entra no resumo.`

3. Em `## O que o plugin nunca faz`, no item `- **Gravação fora de \`~/.claude/hadouken/\`:**`, depois de `e nesse caso só a chave \`statusLine\` muda.`, acrescentar: `O instalador de um comando também grava ali \`extraKnownMarketplaces["claude-hadouken"]\` e \`false\` nas cópias antigas dos terceiros em \`enabledPlugins\` (K1).`

4. Na parte em inglês, os mesmos três pontos no `- **K1, the optional …`, e em `## What the plugin never does`:

- `Since v0.5.2, the kit's third parties are entries in hadouken's own marketplace with a pinned commit (40-hex \`sha\`): Claude Code installs exactly the commit the suite tested. \`allowCrossMarketplaceDependenciesOn\` lists only \`claude-plugins-official\` (for \`superpowers\`). The \`sha\` values are bumped by the weekly robot (\`.github/scripts/kit-atualizar.mjs\`, the repository's only network code outside the plugin): its own branch, the suite on 3 systems × 3 Node versions, and only then a fast-forward to \`main\`, a tag and a release through \`GITHUB_TOKEN\`. **Accepted risk:** the robot publishes third-party code without human review; the safeguards are the suite (which checks the flow map against each third party's skills) and the pinned \`sha\`.`
- `The one-command installer (\`install.sh\`, \`install.ps1\` and \`src/instalar/\`) runs outside any session, by the user in the terminal. It starts child processes with fixed arguments: \`claude\` (absolute path checked by \`caminhoSeguro\`; on Windows, \`claude.cmd\` only through System32's \`cmd.exe\`), the user's Python \`pip\` (\`graphifyy==0.9.25\`) and yu-ux's \`setup.sh\`; the code in \`src/instalar*\` opens no connection (boundary test). In \`settings.json\`, only through the bar's writer (backup, no links, checked swap), it changes \`extraKnownMarketplaces["claude-hadouken"]\` (\`autoUpdate: true\`) and sets the old third-party copies to \`false\` in \`enabledPlugins\`. The scripts use no \`sudo\` and read or write no secret; outside text (output of \`claude\`, \`winget\`, \`brew\`, \`pip\`) never reaches the summary.`
- `The one-command installer also writes \`extraKnownMarketplaces["claude-hadouken"]\` there and \`false\` for the old third-party copies in \`enabledPlugins\` (K1).`

- [ ] **Step 4: Conferir os links e a suíte**

Run: `node --test`
Expected: PASS (há testes que conferem âncoras e seções dos READMEs; se algum acusar o índice, ajustar a âncora `#um-comando` / `#one-command`).

- [ ] **Step 5: Prova real no Windows, isolada**

Sem tocar no `~/.claude` do Sr. Garioli: settings, pasta de dados e configuração do Claude Code em pastas temporárias, e o item do VS Code desligado. Gravar em `<scratchpad>\prova-instalador.ps1`:

```powershell
$t = Join-Path $env:TEMP ("hdk prova " + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $t | Out-Null
$env:CLAUDE_CONFIG_DIR = Join-Path $t 'config'
$env:HADOUKEN_HOME = Join-Path $t 'hadouken'
$env:HADOUKEN_SETTINGS = Join-Path $t 'config\settings.json'
$env:HADOUKEN_SEM_PAINEL = '1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Projetos DEV\Claude Hadouken\claude-hadouken\install.ps1' --sim --sem-extras
"codigo $LASTEXITCODE"
Get-Content -Raw (Join-Path $t 'config\settings.json')
"pasta $t"
```

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File <scratchpad>\prova-instalador.ps1`
Expected: o resumo com `✓` para `hadouken-kit`, `hadouken-rea`, `atualização automática`, `arquivos da barra` e `barra`; `– item do VS Code: pulado (HADOUKEN_SEM_PAINEL=1)`; `– aprendizado: pulado (…)`; `codigo 0`; o settings temporário com `statusLine` e `extraKnownMarketplaces`. Rodar de novo: `=` em tudo que estava `✓`.

Atenção: o instalador instala o plugin a partir do GitHub (`Garioli-Labs/claude-hadouken`, branch padrão), não do branch `v0.5.2` local. Até o merge, o `installPath` aponta para a 0.5.1, que não tem `src/instalar-tudo.js`, e o script para com "o plugin não instalou". Para provar antes do merge, registrar o marketplace local na config temporária antes de rodar: no mesmo script, antes do `& powershell.exe …`, acrescentar `& claude plugin marketplace add 'C:\Projetos DEV\Claude Hadouken\claude-hadouken'` (com o `CLAUDE_CONFIG_DIR` temporário já definido). Com isso o `marketplace add Garioli-Labs/…` do script falha (nome já registrado, tolerado), o plugin vem do diretório local e a atualização automática fica `– pulado (marketplace claude-hadouken de outra fonte)`, que é o comportamento certo para quem desenvolve o plugin. Anotar no relatório qual dos dois caminhos rodou.

Depois, apagar a pasta temporária (`Remove-Item -Recurse -Force "<pasta>"`, com o caminho que o script imprimiu).

- [ ] **Step 6: Commit**

```bash
printf '%s\n' 'docs: instalador de um comando, VS Code no Mac, atualização automática e o robô do kit' '' 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > /tmp/msg052
git add README.md README.en.md SECURITY.md
git commit -q -F /tmp/msg052
```

---

## Fim

Depois da Task 10: `node --test` verde, `git status` limpo, e o branch `v0.5.2` pronto para a revisão do branch inteiro. Merge, tag `v0.5.2` e push são decisão do Sr. Garioli.

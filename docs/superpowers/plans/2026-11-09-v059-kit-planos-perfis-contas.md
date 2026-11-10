# v0.5.9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline, escolhida pelo Sr. Garioli). Steps use checkbox (`- [ ]`) syntax.

**Goal:** kit enxuto no instalador, planos Pro/Max/Ultra, extensão em todos os perfis do VS Code e uma conta por janela do VS Code.

**Architecture:** quatro frentes independentes, na ordem de menor risco: planos (rótulos + omitir 5 h no Ultra), perfis do VS Code (laço `--profile`), kit (sugerir em vez de instalar) e contas (pasta por conta via `CLAUDE_CONFIG_DIR`, `dirDados()` seguindo a conta, seção na janela do VS Code).

**Tech Stack:** Node 20+/24 ESM, `node:test`, extensão VS Code em CJS sem dependências.

**Spec:** `docs/superpowers/specs/2026-11-09-v059-kit-planos-perfis-contas-design.md`

## Global Constraints

- Testes: `node --test --test-concurrency=2 test/*.test.js`; suíte verde no Windows e no WSL (Node 20 e 24) e CI (ubuntu, windows, macos) antes do push.
- Nunca ler `~/.claude/.credentials.json` nem e-mail; do `.claude.json` só `organizationRateLimitTier`, só pelo coletor.
- Nenhum nome de processo, pid ou caminho no contexto do Claude (hooks/saídas para o modelo).
- Sem chamadas de rede novas.
- Quem tem uma conta só não vê mudança: `~/.claude/hadouken` continua a pasta da Principal.
- Rótulos: `Pro`, `Max`, `Ultra`. Valores do JSON: `pro`, `max`, `ultra`, `desconhecido`.
- Commits com `git commit -F <arquivo>` (a guarda barra "claude" na linha de comando); trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `conta-plano.json` antigo com `max5`/`max20` gravado: vira `max`/`ultra` na leitura, sem esperar 24 h (teste na Task 1).
2. Ultra **com** leitura de 5 h (conta não verificada): a janela aparece e a guarda vale (teste na Task 1).
3. `storage.json` do VS Code ausente, corrompido ou com perfil de nome estranho (aspas, `&`): instala só no Default, sem quebrar e sem injetar no `cmd` (teste na Task 2).
4. Plugin de terceiro instalado de outro marketplace (`superpowers@outro`) ou desligado: conta como instalado, não sugere (teste na Task 3).
5. Nome de conta com `/`, `..`, espaço, acento ou repetido: recusado ou normalizado, nunca sai de `~/.claude-contas` (teste na Task 5).

---

### Task 1: Planos Pro, Max e Ultra

**Files:**
- Modify: `src/conta/plano.js`, `src/uso/painel.js` (texto e pcts), `src/alerta.js` / linha de consumo do SessionStart (onde imprime "5h sem leitura"), `src/relatorio.js` (bloco de limites)
- Test: `test/conta-plano.test.js`, `test/relatorio.test.js`, `test/saude-*.test.js`, `test/uso-painel*.test.js`

**Interfaces — Produces:**
- `ROTULO_PLANO = { pro: 'Pro', max: 'Max', ultra: 'Ultra' }`
- `planoDoClaude(texto) → 'pro'|'max'|'ultra'|null`: `_max_20x` ou contém `ultra` → `ultra`; `_max_5x` ou contém `max` → `max`; contém `pro` → `pro`.
- `planoEfetivo(dir)`: migra `max5`→`max`, `max20`→`ultra` ao ler.
- `semCincoHoras(plano, janela5h) → boolean`: `plano === 'ultra' && janela5h === null`.

- [ ] Testes que falham: `planoDoClaude('{"organizationRateLimitTier":"default_claude_max_20x"}') === 'ultra'`, `..._max_5x` → `max`, `"default_claude_ultra"` → `ultra`; `planoEfetivo` com `{plano:'max20'}` gravado → `ultra`; `textoPlano('ultra') === 'Ultra (do Claude Code)'`; `estadoPainel` com plano ultra e sem 5 h → texto `sem 41% · Fable 57%` e `pcts.h5` ausente; com plano ultra e com 5 h → texto continua com `5h`; linha do SessionStart sem 5 h no Ultra não cita "5h".
- [ ] Rodar e ver falhar.
- [ ] Implementar; `estadoPainel` lê `planoEfetivo(dir)`.
- [ ] Atualizar asserts antigos de `max5`/`max20` nos testes de relatório e saúde.
- [ ] Rodar arquivos tocados e ver passar; commit `feat: planos Pro, Max e Ultra; Ultra sem a janela de 5 h`.

### Task 2: Extensão em todos os perfis do VS Code (issue #7)

**Files:**
- Create: `src/painel/perfis.js`
- Modify: `src/painel/instalar-painel.js:347-356`
- Test: `test/painel-perfis.test.js`, `test/instalar-painel.test.js`

**Interfaces — Produces:**
- `arquivoStorageVscode({ plataforma, casa, appData }) → string|null`: Windows `%APPDATA%\Code\User\globalStorage\storage.json`; macOS `~/Library/Application Support/Code/User/globalStorage/storage.json`; Linux `~/.config/Code/User/globalStorage/storage.json`.
- `perfisDoVscode(texto) → string[]`: nomes de `userDataProfiles[].name`, só os que casam `/^[\p{L}\p{N} ._-]{1,60}$/u`, sem repetidos, teto 20.
- `instalarPainel` roda o install sem `--profile` e depois um por perfil (`--profile "<nome>"`); falha num perfil não derruba o resultado (só registra), falha no Default sim.

- [ ] Testes: Windows/mac/Linux devolvem o caminho certo; JSON com `{"userDataProfiles":[{"name":"Educbank"},{"name":"a\"&b"}]}` → `['Educbank']`; texto inválido → `[]`; `instalarPainel` com executar falso registra 2 chamadas (Default + Educbank) e o argumento do Educbank contém `--profile "Educbank"`.
- [ ] Ver falhar, implementar, ver passar; commit `fix: extensão instalada em todos os perfis do VS Code (#7)`.

### Task 3: Kit enxuto — instala só hadouken e hadouken-kit; terceiros só sugeridos

**Files:**
- Modify: `kit/.claude-plugin/plugin.json` (dependencies → `["hadouken"]`), `src/instalar/claude-cli.js` (`passoKit`, `DEPENDENCIAS_KIT` → `SUGERIDAS`), `src/instalar-tudo.js:309-323` (sem marketplace oficial forçado, sem `passoRea` instalando), `src/instalar/itens.js` (estado `sugerido`), `src/saude/*` (linha Instal.), `kit/skills/fluxo/SKILL.md` (“se estiver instalada”), `.claude-plugin/marketplace.json` (poka-yoke por https se o `git-subdir` aceitar `url` https)
- Test: `test/instalar-tudo.test.js`, `test/claude-cli.test.js`, `test/kit-manifestos.test.js`

**Interfaces — Produces:**
- `SUGERIDAS = [{ nome:'superpowers', comando:'claude plugin install superpowers@claude-plugins-official' }, mattpocock-skills, poka-yoke, fullstack-dev-skills, ui-ux-pro-max (os quatro @claude-hadouken), hadouken-rea@claude-hadouken]`
- `conferirSugeridas({ lista, pastaSkills, existe }) → item[]`: instalado = algum id da lista que começa com `<nome>@` (qualquer marketplace, ligado ou não) **ou** existe `<pastaSkills>/<nome>`; item `igual` com detalhe `já instalado`, ou `sugerido` com `comando`.
- `item.sugerido(nome, comando)`; `formatarResumo` mostra `○ <nome>: sugerido (rode <comando>)`; `sugerido` não conta como falha no código de saída.

- [ ] Testes: kit manifest com dependencies só `hadouken`; lista com `superpowers@outro` → igual; lista vazia + pasta `skills/poka-yoke` → igual; lista vazia → 6 sugeridos e saída 0; `instalarTudo` nunca chama `plugin install` com id de terceiro (rodar falso registra os args).
- [ ] Ver falhar, implementar, ver passar; commit `feat: instalador instala só hadouken e hadouken-kit e sugere os demais`.

### Task 4: Dados do Hadouken por conta

**Files:**
- Modify: `src/base.js:108` (`dirDados`), `vscode/extension.cjs:148` (cópia da regra), `src/configuracao.js:179` (comentário + settings da conta), `src/shim.js` (shims na pasta da conta)
- Test: `test/base.test.js`, `test/extensao.test.js`

**Interfaces — Produces:**
- `dirDados()`: `HADOUKEN_HOME` > `CLAUDE_CONFIG_DIR` absoluto e diferente de `<home>/.claude` (comparação normalizada, sem caixa no win32) → `<CLAUDE_CONFIG_DIR>/hadouken` > `<home>/.claude/hadouken`.
- Extensão: `dirDados(configDir)` recebe o `CLAUDE_CONFIG_DIR` da conta da janela (Task 5), com a mesma regra.

- [ ] Testes: sem variáveis → `~/.claude/hadouken`; `CLAUDE_CONFIG_DIR=<home>/.claude` → igual; `CLAUDE_CONFIG_DIR=<home>/.claude-contas/trabalho` → `.../trabalho/hadouken`; relativo → ignorado; `HADOUKEN_HOME` vence.
- [ ] Ver falhar, implementar, ver passar; commit `feat: dados do Hadouken por conta (CLAUDE_CONFIG_DIR)`.

### Task 5: Conta desta janela (VS Code)

**Files:**
- Create: `src/conta/contas.js`, `vscode/janela/` (seção Conta), comandos `claudeHadouken.novaConta` e `claudeHadouken.trocarConta` em `vscode/extension.cjs` + `vscode/package.json`
- Test: `test/contas.test.js`, `test/extensao.test.js`

**Interfaces — Produces:**
- `RAIZ_CONTAS = <home>/.claude-contas`
- `nomeDeConta(texto) → string|null`: trim, minúsculas, sem acento, espaço→`-`, só `[a-z0-9-]{1,32}`, sem `principal`.
- `listarContas(casa) → [{ nome, pasta }]` (só subpastas válidas).
- `criarConta({ nome, casa, rodarInstalador }) → { ok, pasta, motivo? }`: cria `<raiz>/<nome>`, roda `claude plugin marketplace add Garioli-Labs/claude-hadouken`, `plugin install hadouken@claude-hadouken`, `plugin install hadouken-kit@claude-hadouken` e o `instalar-tudo --sem-extras` com `CLAUDE_CONFIG_DIR=<pasta>`; já existe → `motivo:'existe'`.
- `configDaJanela(pasta|null) → { 'claudeCode.environmentVariables': [...], 'terminal.integrated.env.<so>': {...} }`; `null` (Principal) remove `CLAUDE_CONFIG_DIR` das duas, mantendo outras variáveis do usuário.
- Extensão: lê `claudeCode.environmentVariables` do workspace para achar a conta; seção "Conta desta janela" na janela com a lista e o botão **Nova conta** (pede só o nome via `showInputBox`); grava com `ConfigurationTarget.Workspace`; se `.vscode/settings.json` é rastreado pelo git, `showWarningMessage` modal antes de gravar; depois de criar: mensagem "Abra o terminal desta janela, rode claude e /login uma vez com a conta <Nome>." (o login pela extensão falha com pasta não padrão — issue 84267 do Claude Code; pelo terminal funciona). Tooltip começa com `Conta: <Nome>` quando há mais de uma conta.

- [ ] Testes: `nomeDeConta('Trabalho ')==='trabalho'`, `'../x'`→null, `'Ação 2'`→`'acao-2'`, `'principal'`→null; `criarConta` com rodar falso registra os 4 comandos com `CLAUDE_CONFIG_DIR` e não sai da raiz; `configDaJanela` preserva `FOO=1` do usuário; extensão com env da conta mostra a pasta `<conta>/hadouken` e tooltip `Conta: Trabalho`.
- [ ] Ver falhar, implementar, ver passar; commit `feat: uma conta por janela do VS Code`.

### Task 6: Versão 0.5.9, docs e entrega

- [ ] Versão 0.5.9 em `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `kit/testado.json`, `test/kit-manifestos.test.js`; kit 1.2.0 no `kit/.claude-plugin/plugin.json`.
- [ ] Wiki pt/en: planos (Max/Ultra, `plano` no JSON), instalação (sugeridas), perfis do VS Code, contas por janela; SECURITY (pastas de conta, nunca credenciais).
- [ ] Suíte completa no Windows, WSL Node 20 e 24; push; CI verde nos três sistemas.
- [ ] Script de release para o Sr. Garioli rodar com `!`; comentar e fechar #7 e comentar #2 com o link da versão (só depois do OK dele).

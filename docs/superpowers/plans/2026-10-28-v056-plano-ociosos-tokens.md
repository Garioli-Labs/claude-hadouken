# hadouken v0.5.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline, decidida pelo Sr. Garioli) com mattpocock-skills:tdd por tarefa. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O hadouken passa a saber o plano da conta, aponta sessões do Claude paradas e corta o gasto do vigia noturno, sem nunca bloquear prompt novo.

**Architecture:** Três módulos novos e profundos atrás de interfaces pequenas: `src/conta/plano.js` (plano da conta lido do Claude Code; a conversão tokens↔% caiu na Task 1, decisão 7), `src/saude/ociosas.js` (sessões `claude` paradas, decidido sobre as leituras do coletor) e o prazo `noite` dentro de `guarda/liberacao.js`. A agenda com trava ganha uma linha de contexto em `hooks/guarda-agenda.js`. Os hooks continuam lendo só JSON pequeno; o cálculo pesado fica no coletor (v0.5.5).

**Tech Stack:** Node ≥ 20, ESM, `node:test`, sem dependências.

**Spec:** `docs/superpowers/specs/2026-10-28-v056-plano-ociosos-tokens-design.md`

## Global Constraints

- Nunca ler `~/.claude/.credentials.json` nem outro arquivo com token de conta (spec §2).
- Nunca encerrar sessão `claude` do usuário (spec §2).
- Nenhum aviso repetido: um por episódio, como os da saúde (spec §2; v0.5.5 §6.B).
- Nada de chamada de rede nova (spec §2).
- Sem plano conhecido, tudo funciona como na v0.5.5 (spec §2, anti-objetivo).
- Ao Claude vão só números e rótulos fixos; nome de processo, pid e caminho nunca entram no contexto dele (v0.5.5 §6.B, mantido em spec §4).
- Testes com `--test-concurrency=2`; suíte inteira no Windows e no Linux (WSL, Node 20 e 24) antes de pedir push.
- Merge, tag, push, release e wiki só com autorização do Sr. Garioli, um de cada vez.

## Decisões da escrita do plano (correções à spec, registradas)

1. **Spec §5, leitura repetida: fica fora desta versão.** A spec supôs um PostToolUse de Read "que já existe para a P5"; não existe (`hooks/hooks.json` tem PreToolUse só de Agent/Task/Workflow, Bash, PowerShell, Write, Edit, MultiEdit, NotebookEdit e agenda). Um hook novo em todo Read custaria um `node` (~100–150 ms no Windows) por leitura, o que fere "o hadouken não pode atrapalhar". Volta numa versão futura só se couber sem hook novo (por exemplo, contado no coletor a partir do transcript).
2. **Spec §4, ociosa só pela CPU.** No Windows o `cwd` de outro processo não é legível sem privilégio (spec §8.2), então não há ligação segura processo ↔ transcript. Ociosa = processo de classe `claude`, fora da árvore da sessão atual, com CPU < 1% em todas as leituras de um intervalo contínuo ≥ 30 min. Sem projeto no aviso (a linha de comando não o traz com segurança); vai a contagem e a RAM.
3. **Spec §3, a fonte do plano é o campo `organizationRateLimitTier` do `.claude.json`** (achado na escrita do plano; o Sr. Garioli confirmou: Max 20x, valor `default_claude_max_20x`). É o arquivo de configuração do Claude Code, não o de credenciais, então não fere a spec §2. Caminho: `$CLAUDE_CONFIG_DIR/.claude.json` com a variável definida, senão `~/.claude.json` (na pasta do usuário, não em `~/.claude/`). Só o coletor o lê (nunca um hook), com teto de 8 MB, e só esse campo sai da função: `*_max_20x` → `max20`, `*_max_5x` → `max5`, `*pro*` → `pro`; ausente ou outro valor → `desconhecido` (o comportamento da v0.5.5).
3a. **Revisão do plano (pedido do Sr. Garioli antes da Task 1): saem a inferência por tokens/ponto e o item `conta.plano`.** Com o campo do Claude Code, a inferência só cobriria um formato futuro, e a tabela de config só tem `inteiro` e `booleano` (`src/config/tabela.js`); um tipo novo de escolha mexeria no config inteiro e na janela por um caso que ninguém tem. YAGNI: voltam juntos se o campo sumir. A Task 1 continua, mas só para a conversão tokens → % (a proporção pública 1 : 5 : 20 entre Pro, Max 5x e Max 20x; a unidade vem da conta Max 20x do Sr. Garioli). Todo número em % sai marcado como estimativa.
4. **Spec §3, uso 3 (folga do roteamento): só a conversão para pontos.** O roteamento não tem limiar em tokens hoje (`guarda/config.js`), então não há limiar a "subir". O ganho do plano aparece na mensagem: o custo em % da semana. (Caiu na Task 1, decisão 7: a medida não ficou estável.)
5. **Spec §6.1, aviso único: na agenda, não no prompt.** O gasto da noite do Metrô SP veio de cada volta do `/loop`. A linha vai no `ScheduleWakeup`/`CronCreate` com trava ativa (`guarda-agenda.js`, que já roda nessas ferramentas): diz até quando vale o reset da janela travada e sugere esperar até lá. Nada é negado por isso. Limite aceito: um `CronCreate` recorrente criado antes da trava não passa de novo pela agenda, e cada disparo dele é um prompt comum que o hadouken não distingue do digitado. Por isso, quando a ferramenta é `CronCreate`, o texto sugere trocar o intervalo fixo por um `ScheduleWakeup` depois do reset.
5a. **Spec §6.2, `noite` só pelo comando digitado.** A janela do VS Code não tem botão de liberar, de propósito (a liberação só vale digitada; `guarda/liberacao.js`, cabeçalho). O `noite` entra só como palavra do `/hadouken:liberar`.
5b. **Spec §4, qual é a sessão atual.** O coletor é desanexado e perde a árvore. O hook que o dispara passa `process.ppid` como 2º argumento (`coletor-main.js <dirProjeto> <ppid>`); o coletor sobe pela lista de processos (`ppid` de cada item) a partir dele até o primeiro `claude` e exclui esse pid e os filhos dele. Sem argumento válido, nenhuma sessão é excluída e nenhum aviso de paradas sai naquela coleta (melhor calar que contar a sessão atual).
6. **Spec §7, painel em outro PC: no `/hadouken:saude` e na wiki.** O painel se instala sozinho no SessionStart; não há saída de instalador para o usuário ler. O caminho do `.vsix` (`<dados>/painel/claude-hadouken-painel-<versão>.vsix`) vai na seção Compat do `/hadouken:saude` e nas duas páginas do painel da wiki.

## Decisões da execução (Task 1)

7. **Medida de 2026-10-28 (`node bench/tokens-por-ponto.mjs`, conta Max 20x do Sr. Garioli):** 196 leituras de 7d (`historico.jsonl` + `estado.json`), 36 intervalos com alta ≥ 3 pontos, 35 com respostas nesta máquina. Por ponto de 7d: `saida` mediana 76.222, CV 0,614 (robusto 0,713); `entradaNaoCacheada+saida` mediana 1.335.115, CV 0,525 (robusto 0,593); `pesoCache` mediana 5.308.147, CV 0,423 (robusto 0,367). Nenhuma métrica fica abaixo de 0,35, nem pela dispersão robusta. Causa provável: o limite também desce com uso fora destes transcripts (claude.ai, outro PC) e com a mistura de modelos, que pesam diferente. **Pela regra do Step 3, os relatórios não mostram %:** saem `UNIDADE_PRO_7D`, `pontosDeTokens` e o "% da semana" da economia (Tasks 2 e 6). O plano da conta continua detectado e aparece como linha informativa. A ferramenta fica em `bench/` para medir de novo numa versão futura.

## Review Focus

1. Pid reaproveitado pelo sistema entre duas coletas (sessão fechou, outro `claude` abriu com o mesmo pid): a contagem de ociosa recomeça, não herda o tempo. Teste na Task 3.
2. Relógio voltando (horário de verão, ajuste manual) com `noite`: o prazo nunca passa de 24 h nem cai no passado. Teste na Task 5.
3. `.claude.json` enorme (histórico de projetos de anos), com BOM, ou trocado no meio da leitura: teto de 8 MB, nunca lança, `desconhecido`; e o retorno nunca carrega e-mail ou outro campo. Teste na Task 2.
4. Coletor sem leitura de processos (`fontes.processos` ≠ `ok`, prazo estourado): nenhuma sessão vira ociosa e as contagens em curso não avançam nem zeram. Teste na Task 3.
5. `ScheduleWakeup` com trava ativa e sem `resets_at` válido: a linha sai sem horário, nunca com "NaN:NaN". Teste na Task 4.

---

### Task 1: Medida de referência dos tokens por ponto

**Files:**
- Create: `bench/tokens-por-ponto.mjs` (ferramenta de medida, não entra no pacote: `bench/` já fica fora do peso)
- Modify: este plano, seção "Decisões da execução (Task 1)"

**Interfaces:**
- Consumes: o histórico de `estado.json` (`{ at, h5, d7 }`, via `src/estado.js`) e as respostas do índice dos transcripts (`src/transcripts.js`, `indexarTranscripts`).
- Produces: `UNIDADE_PRO_7D` (tokens por ponto de 7d no Pro) e a métrica escolhida (`'saida'`, `'entradaNaoCacheada+saida'` ou `'pesoCache'`), gravadas como constantes na Task 2.

- [x] **Step 1:** Escreva o script: para cada intervalo do histórico com variação de `d7` ≥ 3 pontos (a semana, que é o que os relatórios mostram), some os tokens das respostas do intervalo por três métricas e divida pela variação. Saída: por métrica, n, mediana e coeficiente de variação.
- [x] **Step 2: Run** `node bench/tokens-por-ponto.mjs` na conta do Sr. Garioli. Expected: n ≥ 5 intervalos.
- [x] **Step 3:** Escolha a métrica de menor coeficiente de variação. O plano de referência é Max 20x (decisão 3); `UNIDADE_PRO_7D = mediana / 20`. Registre n, mediana, CV e a métrica no plano. CV > 0,35 em todas: os relatórios não mostram % (só tokens, como na v0.5.5) e isso fica registrado.
- [x] **Step 4: Commit** `chore(bench): medida de tokens por ponto do limite`.

### Task 2: Plano da conta (`src/conta/plano.js`)

**Files:**
- Create: `src/conta/plano.js`, `test/conta-plano.test.js`
- Modify: `src/saude/coletor-main.js` (lê o `.claude.json` no máximo uma vez por 24 h e grava `conta-plano.json`), `src/saude/reparo.js` (`conta-plano.json` em `ARQUIVOS_ESTADO`)

**Interfaces:**
- Consumes: `dirConfigClaude(env, home)` de `src/guarda/despacho.js` para o `CLAUDE_CONFIG_DIR`.
- Produces:
  - `arquivoClaudeJson(env, home) → string|null` (`$CLAUDE_CONFIG_DIR/.claude.json` ou `<home>/.claude.json`; decisão 3)
  - `planoDoClaude(texto: string) → 'pro'|'max5'|'max20'|null` (só `organizationRateLimitTier`)
  - `planoEfetivo(dir: string) → 'pro'|'max5'|'max20'|'desconhecido'` (lê `conta-plano.json`; nunca lança)
  - `ROTULO_PLANO = { pro: 'Pro', max5: 'Max 5x', max20: 'Max 20x' }`

- [ ] **Step 1: Write failing tests** `test/conta-plano.test.js`:
  - `planoDoClaude` com `"organizationRateLimitTier": "default_claude_max_20x"` → `max20`; `default_claude_max_5x` → `max5`; `default_claude_pro` → `pro`; `"enterprise_x"`, campo ausente, `null`, JSON quebrado, texto com BOM válido → o certo; texto > 8 MB → `null` (Review Focus 3).
  - o resultado de `planoDoClaude` é sempre uma das quatro respostas (nunca objeto, nunca o e-mail do arquivo de teste).
  - `arquivoClaudeJson({ CLAUDE_CONFIG_DIR: '/x' }, '/h')` → `/x/.claude.json`; sem a variável → `/h/.claude.json`; variável relativa → `/h/.claude.json`.
  - `planoEfetivo` sem arquivo, com arquivo corrompido ou com `plano: 'ultra'` → `desconhecido`; com `{ v: 1, plano: 'max20', em }` → `max20`.
  - coletor: com o `.claude.json` de teste (via `HOME`/`CLAUDE_CONFIG_DIR` temporários) grava `conta-plano.json`; numa segunda coleta dentro de 24 h não relê (conta leituras pelo `fs` injetado).
- [ ] **Step 2: Run** `node --test test/conta-plano.test.js`. Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement.** Leitura limitada (`lerTextoSemLink` de `guarda/arquivo.js` com teto de 8 MB), `JSON.parse`, só o campo. `conta-plano.json` = `{ v: 1, plano, em }`, gravado atômico.
- [ ] **Step 4: Run** `node --test --test-concurrency=2 test/conta-plano.test.js test/saude-reparo.test.js test/saude-coletor-main.test.js test/peso-plugin.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(conta): plano da conta lido do Claude Code`.

### Task 3: Sessões paradas (`src/saude/ociosas.js`)

**Files:**
- Create: `src/saude/ociosas.js`, `test/saude-ociosas.test.js`
- Modify: `src/saude/coletor-main.js` (carrega `ociosas` da leitura anterior e grava na nova), `src/saude/avisos.js` (episódio `ociosas`), `src/saude/mensagens.js` (textos), `src/saude/relatorio.js` e `src/saude/janela.js` (lista)

**Interfaces:**
- Consumes: `leitura.processos` (itens com `pid`, `ppid`, `classe`, `cpuPct`, `rssBytes`) e `leitura.fontes.processos`; o `ppid` do hook que disparou o coletor (decisão 5b; `ler.js` passa `process.ppid` no `spawn`, `coletor-main.js` lê `process.argv[3]`).
- Produces:
  - `sessaoAtual(processos, ppidHook) → Set<number>` (o primeiro `claude` acima de `ppidHook` e os descendentes dele; vazio sem `ppidHook` válido)
  - `atualizarOciosas(anteriores: Array<{ pid, desdeMs, rssBytes }>, leitura, agoraMs, excluir: Set<number>) → Array<{ pid, desdeMs, rssBytes }> | null` (vai em `saude.json` como `ociosas`; `null` quando `excluir` está vazio: nenhum aviso naquela coleta)
  - `paradas(lista, agoraMs, { minMs = 30 * 60_000 } = {}) → { n: number, rssBytes: number }`
  - textos: ao usuário `hadouken: N sessões do Claude paradas há mais de 30 min ocupam X GB. Fechar libera memória para esta.` (singular: "1 sessão do Claude parada… ocupa"); ao Claude, só com RAM amarela ou pior: `hadouken: N sessões do Claude paradas ocupam X GB; se o usuário fechar, a RAM folga.`

- [ ] **Step 1: Write failing tests**:
  - `claude` com CPU 0,4% em leituras de 0, 10, 20 e 31 min → `paradas` dá n 1 aos 31 min, n 0 aos 20.
  - CPU 3% numa leitura no meio → `desdeMs` recomeça nela.
  - pid some da lista e volta (Review Focus 1) → recomeça.
  - `fontes.processos: 'prazo'` (Review Focus 4) → devolve `anteriores` sem mudar.
  - processo de classe `vscode` ou `hadouken` nunca entra; `sessaoAtual` com `node` hook → `cmd` → `claude` (ppids encadeados) devolve o pid do `claude` e os filhos dele, que nunca entram.
  - `ppidHook` ausente, não inteiro ou fora da lista → `sessaoAtual` vazio → `atualizarOciosas` devolve `null` e nenhum aviso sai (decisão 5b).
  - mensagens: nunca contêm pid, nome de processo nem caminho (regex `/\d{3,}|\.exe|[\\/]/` só casa a parte "X GB" esperada).
  - `avisos`: o aviso das paradas sai uma vez por episódio; o episódio acaba quando `n` volta a 0.
- [ ] **Step 2: Run** `node --test test/saude-ociosas.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** CPU < 1 conta como parada; teto de 20 itens em `ociosas`.
- [ ] **Step 4: Run** `node --test --test-concurrency=2 test/saude-*.test.js test/hooks-entrada-hostil.test.js test/peso-plugin.test.js`. Expected: PASS; o grafo estático dos hooks não muda (o cálculo fica no coletor).
- [ ] **Step 5: Commit** `feat(saude): sessões do Claude paradas`.

### Task 4: Agenda com trava ativa ganha uma linha de contexto

**Files:**
- Modify: `src/hooks/guarda-agenda.js`, `src/guarda/mensagens.js` (texto `AGENDA_TRAVA`)
- Test: `test/guarda-agenda.test.js` (ou o arquivo onde a agenda já é testada)

**Interfaces:**
- Consumes: a avaliação da guarda que a P1 já usa (`travas` com `five_hour`/`seven_day` e `resets_at` em segundos).
- Produces: com trava ativa e a ferramenta `ScheduleWakeup` ou `CronCreate` permitida, `hookSpecificOutput.additionalContext` = `hadouken: a guarda está travada (janela de 7 dias) até o reset das HH:MM; acordar antes disso não destrava nada. Agende a próxima volta para depois desse horário (ScheduleWakeup aceita até 3600 s; repita a espera).` Sem `resets_at` válido: `… até a janela voltar a ter folga; …` (Review Focus 5). Janela de 5 h: "(janela de 5 horas)". Com `CronCreate`, a última frase vira `Prefira um ScheduleWakeup depois desse horário a um intervalo fixo: cada disparo antes dele gasta cota sem destravar nada.` (decisão 5).

- [ ] **Step 1: Write failing tests**: trava 7d com `resets_at` → a linha com o HH:MM local; `CronCreate` → a frase do intervalo fixo; trava sem `resets_at` → sem "NaN"; sem trava → nenhuma saída (como hoje); pedido de liberação no texto → continua negado (o comportamento antigo vence a linha nova).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** com `import()` dinâmico da avaliação só quando a ferramenta é de agenda permitida; falha de leitura → nenhuma linha (fail-open, como a P2).
- [ ] **Step 4: Run** `node --test --test-concurrency=2 test/guarda-*.test.js test/hooks-entrada-hostil.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(guarda): agenda com trava ativa diz até quando esperar`.

### Task 5: `/hadouken:liberar noite`

**Files:**
- Modify: `src/guarda/liberacao.js` (`lerPedido`, `montarLiberacao`, `detalheEscopo`), `src/guarda/mensagens.js` (texto da confirmação), `skills/liberar/SKILL.md` (ou o arquivo da skill do liberar; a dica de argumentos ganha `noite`). Sem botão na janela (decisão 5a).
- Test: `test/guarda-liberacao.test.js` (ou onde `lerPedido` é testado)

**Interfaces:**
- Produces: `lerPedido('noite', config)` → `{ ok: true, horas: null, janela: false, noite: true, fable: false, caro: false }`; `noite` é prazo, exclusivo com `Nh` e `janela`. `montarLiberacao` com `noite`: `ate` = próximas 07:00 locais depois de `agoraMs`, no máximo `config.liberacaoMaxH` horas; `solta` = a base de sempre; o teto de pontos é o `tetoPontos7d` de sempre. `detalheEscopo` → `noite:<minutos>`.

- [ ] **Step 1: Write failing tests**: 23h50 → até 07:00 do dia seguinte (430 min); 03h00 → 07:00 do mesmo dia; 07h30 → 07:00 do dia seguinte limitado a `liberacaoMaxH`; `noite 2h` e `noite janela` → `{ ok: false }`; `noite fable` aceito; relógio com `agoraMs` qualquer → `ate - agoraMs` sempre em (0, 24 h] (Review Focus 2).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Hora local via `new Date(agoraMs)` e `setHours(7, 0, 0, 0)`.
- [ ] **Step 4: Run** `node --test --test-concurrency=2 test/guarda-*.test.js test/hooks-unidades.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(guarda): liberar noite, até as 7h`.

### Task 6: Plano e pontos nos relatórios; caminho do `.vsix`

**Files:**
- Modify: `src/saude/relatorio.js` (linha "Plano: Max 20x" na seção Economia; caminho do `.vsix` em Compat), `src/relatorio.js` (`/hadouken:limites`: linha do plano), `src/saude/janela.js` e `vscode/` (plano na aba Saúde, só leitura)
- Test: `test/saude-economia.test.js`, `test/saude-relatorio.test.js`, `test/saude-janela.test.js`, `test/relatorio.test.js`

**Interfaces:**
- Consumes: `planoEfetivo` (Task 2).
- Produces: textos — `Plano: Max 20x (do Claude Code)` / `Plano: não identificado (os relatórios mostram só tokens)`; `Painel: ~/.claude/hadouken/painel/claude-hadouken-painel-0.5.6.vsix (outro PC: code --install-extension <esse arquivo>)`.

- [ ] **Step 1: Write failing tests** para os dois textos (plano conhecido e `desconhecido`) e o do `.vsix`; a economia segue sem "%" nenhum (decisão 7).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** os quatro arquivos e `test/painel-*.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: plano da conta nos relatórios; caminho do vsix`.

### Task 7: Documentação, versão e verificação final

**Files:**
- Modify: `wiki/Saude-do-PC.md`, `wiki/PC-health.md` (sessões paradas), `wiki/Guarda-de-consumo.md`, `wiki/Usage-guard.md` (`liberar noite`, linha da agenda), `wiki/Limites.md`, `wiki/Limits.md` (plano da conta), `wiki/Painel-e-janela-do-VS-Code.md`, `wiki/VS-Code-panel-and-window.md` (instalar em outro PC), `wiki/Comandos.md`, `wiki/Commands.md`, `README.md`, `README.en.md`, `SECURITY.md` (entrada nova, pt e en: o coletor lê do `.claude.json` só `organizationRateLimitTier`, com teto de 8 MB, e nunca o arquivo de credenciais; `conta-plano.json` guarda só o plano), `bench/hooks-p95.mjs` (cenário `agenda com trava`), versão `0.5.6` em `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `kit/testado.json`, `test/kit-manifestos.test.js`

- [ ] **Step 1: Write** as páginas, em português e inglês.
- [ ] **Step 2: Bump** para `0.5.6`.
- [ ] **Step 3: Run** a suíte inteira no Windows e no Linux (Node 20 e 24), mais os dois benches comparados com a `main` como na v0.5.5. Expected: 0 falhas; medianas dos hooks dentro de ~10 ms da `main`, salvo `guarda-agenda` com trava.
- [ ] **Step 4: Review** do branch com `mattpocock-skills:code-review` (Sonnet, sem Fable); corrija os achados com teste.
- [ ] **Step 5: Commit** `docs: v0.5.6 na wiki, README e SECURITY; versão 0.5.6` e notas da release no scratchpad. Merge, tag, push, release e wiki só com autorização, um de cada vez.

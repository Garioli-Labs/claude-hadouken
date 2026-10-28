# hadouken v0.5.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline, decidida pelo Sr. Garioli) com mattpocock-skills:tdd por tarefa. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O hadouken passa a saber o plano da conta, aponta sessões do Claude paradas e corta o gasto do vigia noturno, sem nunca bloquear prompt novo.

**Architecture:** Três módulos novos e profundos atrás de interfaces pequenas: `src/conta/plano.js` (tokens por ponto → plano e conversão tokens↔%), `src/saude/ociosas.js` (sessões `claude` paradas, decidido sobre as leituras do coletor) e o prazo `noite` dentro de `guarda/liberacao.js`. A agenda com trava ganha uma linha de contexto em `hooks/guarda-agenda.js`. Os hooks continuam lendo só JSON pequeno; o cálculo pesado fica no coletor (v0.5.5).

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
3. **Spec §3, calibração.** Os limites dos planos seguem a proporção pública 1 : 5 : 20 (Pro, Max 5x, Max 20x). As fronteiras entre faixas ficam nas médias geométricas, √5 ≈ 2,24 e 10 vezes a unidade do Pro. A unidade sai de uma medida de referência na conta do Sr. Garioli (Task 1). Sem medida estável (coeficiente de variação > 0,35 entre janelas), `auto` devolve `desconhecido` e só o valor manual vale.
3a. **Fonte principal do plano: `organizationRateLimitTier` do `~/.claude.json`** (achado na escrita do plano; o Sr. Garioli confirmou: Max 20x, campo `default_claude_max_20x`). É o arquivo de configuração do Claude Code, não o de credenciais, então não fere a spec §2. Só o coletor o lê (nunca um hook), com teto de 8 MB, e só guarda esse campo: mapeia `*_max_20x` → `max20`, `*_max_5x` → `max5`, `*pro*` → `pro`; qualquer outro valor → segue para a inferência. A inferência por tokens/ponto vira o plano B (arquivo ausente, campo ausente, formato novo). Nenhum outro campo do arquivo (e-mail, conta, projetos) é lido para fora da função.
4. **Spec §3, uso 3 (folga do roteamento): só a conversão para pontos.** O roteamento não tem limiar em tokens hoje (`guarda/config.js`), então não há limiar a "subir". O ganho do plano aparece na mensagem: o custo em % da semana.
5. **Spec §6.1, aviso único: na agenda, não no prompt.** O gasto da noite do Metrô SP veio de cada volta do `/loop`. A linha vai no `ScheduleWakeup`/`CronCreate` com trava ativa (`guarda-agenda.js`, que já roda nessas ferramentas): diz até quando vale o reset da janela travada e sugere esperar até lá. Nada é negado por isso.
6. **Spec §7, painel em outro PC: no `/hadouken:saude` e na wiki.** O painel se instala sozinho no SessionStart; não há saída de instalador para o usuário ler. O caminho do `.vsix` (`<dados>/painel/claude-hadouken-painel-<versão>.vsix`) vai na seção Compat do `/hadouken:saude` e nas duas páginas do painel da wiki.

## Review Focus

1. Pid reaproveitado pelo sistema entre duas coletas (sessão fechou, outro `claude` abriu com o mesmo pid): a contagem de ociosa recomeça, não herda o tempo. Teste na Task 3.
2. Relógio voltando (horário de verão, ajuste manual) com `noite`: o prazo nunca passa de 24 h nem cai no passado. Teste na Task 5.
3. Conta trocada de plano no meio da semana (upgrade Pro → Max): a mediana mistura janelas; com dispersão alta, `desconhecido`, nunca um plano errado com cara de certeza. Teste na Task 2.
4. Coletor sem leitura de processos (`fontes.processos` ≠ `ok`, prazo estourado): nenhuma sessão vira ociosa e as contagens em curso não avançam nem zeram. Teste na Task 3.
5. `ScheduleWakeup` com trava ativa e sem `resets_at` válido: a linha sai sem horário, nunca com "NaN:NaN". Teste na Task 4.

---

### Task 1: Medida de referência dos tokens por ponto

**Files:**
- Create: `bench/tokens-por-ponto.mjs` (ferramenta de medida, não entra no pacote: `bench/` já fica fora do peso)
- Modify: este plano, seção "Decisões da execução (Task 1)"

**Interfaces:**
- Consumes: o histórico de `estado.json` (`{ at, h5, d7 }`, via `src/estado.js`) e as respostas do índice dos transcripts (`src/transcripts.js`, `indexarTranscripts`).
- Produces: `UNIDADE_PRO` (tokens por ponto de 7d no Pro) e a métrica escolhida (`'saida'`, `'entradaNaoCacheada+saida'` ou `'pesoCache'`), gravadas como constantes na Task 2.

- [ ] **Step 1:** Escreva o script: para cada janela de 5 h fechada com variação de `h5` ≥ 10 pontos, some os tokens das respostas da janela por três métricas e divida pela variação. Saída: por métrica, n, mediana e coeficiente de variação.
- [ ] **Step 2: Run** `node bench/tokens-por-ponto.mjs` na conta do Sr. Garioli. Expected: n ≥ 3 janelas.
- [ ] **Step 3:** Escolha a métrica de menor coeficiente de variação. O plano de referência é Max 20x (confirmado pelo Sr. Garioli, decisão 3a); derive `UNIDADE_PRO = mediana / 20`. Registre n, mediana, CV e a métrica no plano. Coeficiente > 0,35 em todas: registre e siga com `auto` desligado (decisão 3).
- [ ] **Step 4: Commit** `chore(bench): medida de tokens por ponto do limite`.

### Task 2: Plano da conta (`src/conta/plano.js`) e item `conta.plano`

**Files:**
- Create: `src/conta/plano.js`, `test/conta-plano.test.js`
- Modify: `src/config/tabela.js` (item novo, grupo `saude`), `src/config/ler.js` (expor em `configSaude` como `plano`), `src/saude/coletor-main.js` (inferir uma vez por dia e gravar `conta-plano.json`)

**Interfaces:**
- Consumes: `UNIDADE_PRO` e a métrica da Task 1.
- Produces:
  - `inferirPlano(janelas: Array<{ tokens: number, pontos: number }>) → { plano: 'pro'|'max5'|'max20'|'desconhecido', tokensPorPonto: number|null }`
  - `planoDoClaude(texto: string) → 'pro'|'max5'|'max20'|null` (só o campo `organizationRateLimitTier` do `~/.claude.json`; decisão 3a)
  - `planoEfetivo(dir: string, config) → { plano, fonte: 'manual'|'claude'|'inferido'|null }` (manual vence, depois o do Claude Code, depois a inferência; lê `conta-plano.json`; nunca lança)
  - `pontosDeTokens(tokens: number, plano) → number|null` (pontos de 7d; null com plano desconhecido)
  - item `conta.plano`: enum `auto | pro | max5 | max20`, padrão `auto`, rótulo "Plano da conta".

- [ ] **Step 1: Write failing tests** `test/conta-plano.test.js`:
  - `inferirPlano` com 5 janelas em `UNIDADE_PRO × 20 ± 5%` → `max20`; em `× 5` → `max5`; em `× 1` → `pro`.
  - menos de 3 janelas → `desconhecido`; janelas metade `× 5` e metade `× 20` (troca de plano, Review Focus 3) → `desconhecido`.
  - pontos ≤ 0, tokens não finitos ou negativos saem da conta.
  - `planoEfetivo` com `conta.plano: 'pro'` e arquivo dizendo `max20` → `{ plano: 'pro', fonte: 'manual' }`; com `auto` → `{ plano: 'max20', fonte: 'inferido' }`; arquivo corrompido → `{ plano: 'desconhecido', fonte: null }`.
  - `pontosDeTokens(UNIDADE_PRO * 20, 'max20')` → `1`; plano `desconhecido` → `null`.
  - `planoDoClaude` com `"organizationRateLimitTier": "default_claude_max_20x"` → `max20`; `..._max_5x` → `max5`; valor desconhecido, campo ausente, JSON quebrado ou texto > 8 MB → `null`; o retorno nunca contém outro campo do arquivo.
  - `planoEfetivo` com `conta-plano.json` trazendo `{ plano: 'max20', fonte: 'claude' }` e `auto` → `{ plano: 'max20', fonte: 'claude' }`.
- [ ] **Step 2: Run** `node --test test/conta-plano.test.js`. Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement.** Faixas pela decisão 3; CV > 0,35 → `desconhecido`. `conta-plano.json` = `{ v: 1, plano, tokensPorPonto, em }`, gravado atômico pelo coletor no máximo uma vez por 24 h; inclua-o em `ARQUIVOS_ESTADO` do autorreparo.
- [ ] **Step 4: Run** com a suíte de config: `node --test --test-concurrency=2 test/conta-plano.test.js test/config-*.test.js test/configuracao.test.js test/saude-reparo.test.js test/saude-coletor-main.test.js`. Expected: PASS. Atualize os testes que contam itens.
- [ ] **Step 5: Commit** `feat(conta): plano da conta inferido por tokens por ponto`.

### Task 3: Sessões paradas (`src/saude/ociosas.js`)

**Files:**
- Create: `src/saude/ociosas.js`, `test/saude-ociosas.test.js`
- Modify: `src/saude/coletor-main.js` (carrega `ociosas` da leitura anterior e grava na nova), `src/saude/avisos.js` (episódio `ociosas`), `src/saude/mensagens.js` (textos), `src/saude/relatorio.js` e `src/saude/janela.js` (lista)

**Interfaces:**
- Consumes: `leitura.processos` (itens com `pid`, `classe`, `cpuPct`, `rssBytes`) e `leitura.fontes.processos`; o pid da sessão atual vem como no `sugerirFechar` (`pidSessao`).
- Produces:
  - `atualizarOciosas(anteriores: Array<{ pid, desdeMs, rssBytes }>, leitura, agoraMs) → Array<{ pid, desdeMs, rssBytes }>` (vai em `saude.json` como `ociosas`)
  - `paradas(lista, agoraMs, { minMs = 30 * 60_000 } = {}) → { n: number, rssBytes: number }`
  - textos: ao usuário `hadouken: N sessões do Claude paradas há mais de 30 min ocupam X GB. Fechar libera memória para esta.` (singular: "1 sessão do Claude parada… ocupa"); ao Claude, só com RAM amarela ou pior: `hadouken: N sessões do Claude paradas ocupam X GB; se o usuário fechar, a RAM folga.`

- [ ] **Step 1: Write failing tests**:
  - `claude` com CPU 0,4% em leituras de 0, 10, 20 e 31 min → `paradas` dá n 1 aos 31 min, n 0 aos 20.
  - CPU 3% numa leitura no meio → `desdeMs` recomeça nela.
  - pid some da lista e volta (Review Focus 1) → recomeça.
  - `fontes.processos: 'prazo'` (Review Focus 4) → devolve `anteriores` sem mudar.
  - processo de classe `vscode` ou `hadouken` nunca entra; `pidSessao` nunca entra.
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
- Produces: com trava ativa e a ferramenta `ScheduleWakeup` ou `CronCreate` permitida, `hookSpecificOutput.additionalContext` = `hadouken: a guarda está travada (janela de 7 dias) até o reset das HH:MM; acordar antes disso não destrava nada. Agende a próxima volta para depois desse horário (ScheduleWakeup aceita até 3600 s; repita a espera).` Sem `resets_at` válido: `… até a janela voltar a ter folga; …` (Review Focus 5). Janela de 5 h: "(janela de 5 horas)".

- [ ] **Step 1: Write failing tests**: trava 7d com `resets_at` → a linha com o HH:MM local; trava sem `resets_at` → sem "NaN"; sem trava → nenhuma saída (como hoje); pedido de liberação no texto → continua negado (o comportamento antigo vence a linha nova).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** com `import()` dinâmico da avaliação só quando a ferramenta é de agenda permitida; falha de leitura → nenhuma linha (fail-open, como a P2).
- [ ] **Step 4: Run** `node --test --test-concurrency=2 test/guarda-*.test.js test/hooks-entrada-hostil.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(guarda): agenda com trava ativa diz até quando esperar`.

### Task 5: `/hadouken:liberar noite`

**Files:**
- Modify: `src/guarda/liberacao.js` (`lerPedido`, `montarLiberacao`, `detalheEscopo`), `src/guarda/mensagens.js` (texto da confirmação), `skills/liberar/SKILL.md` (ou o arquivo da skill do liberar), `vscode/` (botão "Liberar até as 7h" ao lado dos de horas)
- Test: `test/guarda-liberacao.test.js` (ou onde `lerPedido` é testado)

**Interfaces:**
- Produces: `lerPedido('noite', config)` → `{ ok: true, horas: null, janela: false, noite: true, fable: false, caro: false }`; `noite` é prazo, exclusivo com `Nh` e `janela`. `montarLiberacao` com `noite`: `ate` = próximas 07:00 locais depois de `agoraMs`, no máximo `config.liberacaoMaxH` horas; `solta` = a base de sempre; o teto de pontos é o `tetoPontos7d` de sempre. `detalheEscopo` → `noite:<minutos>`.

- [ ] **Step 1: Write failing tests**: 23h50 → até 07:00 do dia seguinte (430 min); 03h00 → 07:00 do mesmo dia; 07h30 → 07:00 do dia seguinte limitado a `liberacaoMaxH`; `noite 2h` e `noite janela` → `{ ok: false }`; `noite fable` aceito; relógio com `agoraMs` qualquer → `ate - agoraMs` sempre em (0, 24 h] (Review Focus 2).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Hora local via `new Date(agoraMs)` e `setHours(7, 0, 0, 0)`.
- [ ] **Step 4: Run** `node --test --test-concurrency=2 test/guarda-*.test.js test/extensao.test.js test/painel-*.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(guarda): liberar noite, até as 7h`.

### Task 6: Plano e pontos nos relatórios; caminho do `.vsix`

**Files:**
- Modify: `src/saude/economia.js` (tokens poupados também em % da semana via `pontosDeTokens`), `src/saude/relatorio.js` (linha "Plano: Max 20x (inferido)" na seção Economia; caminho do `.vsix` em Compat), `src/relatorio.js` (`/hadouken:limites`: linha do plano), `src/saude/janela.js` e `vscode/` (plano na aba Saúde, com o seletor de `conta.plano`)
- Test: `test/saude-economia.test.js`, `test/saude-relatorio.test.js`, `test/saude-janela.test.js`, `test/relatorio.test.js`

**Interfaces:**
- Consumes: `planoEfetivo`, `pontosDeTokens` (Task 2).
- Produces: textos — `hadouken na semana (estimativa): …; ~120 mil tokens poupados (~1,2% da semana).`; `Plano: Max 20x (inferido)` / `Plano: Pro (escolhido)` / `Plano: não identificado (o padrão vale)`; `Painel: ~/.claude/hadouken/painel/claude-hadouken-painel-0.5.6.vsix (outro PC: code --install-extension <esse arquivo>)`.

- [ ] **Step 1: Write failing tests** para os três textos, inclusive plano `desconhecido` sem "%" nenhum (anti-objetivo da spec §2).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** os quatro arquivos e `test/painel-*.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: plano da conta e custo em % nos relatórios; caminho do vsix`.

### Task 7: Documentação, versão e verificação final

**Files:**
- Modify: `wiki/Saude-do-PC.md`, `wiki/PC-health.md` (sessões paradas), `wiki/Guarda-de-consumo.md`, `wiki/Usage-guard.md` (`liberar noite`, linha da agenda), `wiki/Limites.md`, `wiki/Limits.md` (plano da conta), `wiki/Painel-e-janela-do-VS-Code.md`, `wiki/VS-Code-panel-and-window.md` (instalar em outro PC), `wiki/Comandos.md`, `wiki/Commands.md`, `README.md`, `README.en.md`, `SECURITY.md` (o plano nunca vem das credenciais), versão `0.5.6` em `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `kit/testado.json`, `test/kit-manifestos.test.js`

- [ ] **Step 1: Write** as páginas, em português e inglês.
- [ ] **Step 2: Bump** para `0.5.6`.
- [ ] **Step 3: Run** a suíte inteira no Windows e no Linux (Node 20 e 24), mais os dois benches comparados com a `main` como na v0.5.5. Expected: 0 falhas; medianas dos hooks dentro de ~10 ms da `main`, salvo `guarda-agenda` com trava.
- [ ] **Step 4: Review** do branch com `mattpocock-skills:code-review` (Sonnet, sem Fable); corrija os achados com teste.
- [ ] **Step 5: Commit** `docs: v0.5.6 na wiki, README e SECURITY; versão 0.5.6` e notas da release no scratchpad. Merge, tag, push, release e wiki só com autorização, um de cada vez.

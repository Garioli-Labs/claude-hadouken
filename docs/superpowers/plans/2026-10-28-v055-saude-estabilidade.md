# hadouken v0.5.5 — saúde do PC, estabilidade e plugin leve — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Cada tarefa segue mattpocock-skills:tdd (teste pela interface primeiro).

**Goal:** Entregar a 0.5.5: coletor de saúde fora dos hooks, avisos de RAM e hardware como orientação, modo leve, `/hadouken:saude`, autorreparo, teto de tempo por hook, compatibilidade, conflitos, limpeza, economia semanal e a seção "PC agora" na janela do VS Code.

**Architecture:** Um módulo novo, `src/saude/`, com módulos fundos e E/S injetada (spec §9.2). Um processo desanexado (`coletor-main.js`) faz todo o trabalho caro e grava `saude.json`. Os hooks só leem esse arquivo, decidem os avisos com uma função pura (`decidirAvisos`) e nunca bloqueiam. A janela recebe a leitura pelo `painel-api.js`, como já recebe o uso.

**Tech Stack:** Node ≥ 20 (ESM), `node:test`, sem dependências; a extensão do VS Code em CJS; a webview em HTML, CSS e JS puros.

**Spec:** `docs/superpowers/specs/2026-10-28-v055-saude-estabilidade-design.md`. Ler §1, §4, §6, §9.1, §9.2 e §6.L antes de cada tarefa.

## Global Constraints

- Nada desta versão bloqueia, nega, atrasa ou reescreve prompt ou ferramenta. A guarda (P1–P5) não muda.
- Hooks: p95 ≤ 150 ms no Linux e no macOS e ≤ 250 ms no Windows (bench). Hooks só **leem** `saude.json`, nunca coletam.
- Erro interno em hook: sai com 0 e sem saída (`falharAberto` / `rodarHook`). Nada lança para fora.
- Gravação atômica pelos helpers existentes (`estado.js`/`base.js`); travas com `wx` e prazo de vencimento.
- Texto ao Claude: só números validados e rótulos fixos de `src/saude/mensagens.js`. Nome de processo nunca entra no contexto do Claude; só vai ao usuário, saneado.
- Aviso: uma vez por episódio. Ao usuário, global no PC; ao Claude, uma vez por sessão e episódio. Episódio novo só depois de 30 min abaixo da faixa.
- Faixas padrão: RAM 85/93%, GPU 85 °C, CPU 90 °C, bateria 15%, disco 5 GB, parte opcional 40 ms (3 de 10 → 24 h), modo leve 4 h, coleta a cada 60 s, prazo do coletor 8 s, trava do coletor vencida em 30 s, "pendurado" = 3× o prazo.
- Aviso ao usuário: ≤ 300 caracteres e no máximo um por hook, o mais grave.
- Prazo interno (watchdog `unref`, 80% do timeout do `hooks.json`) só em session-start, prompt-submit, session-end e statusline. Nunca em `guarda-*` nem em `liberar`.
- Textos em português do Brasil, e no inglês da wiki onde já há par (`*-en`, `Commands.md`…).
- Testes com `--test-concurrency=2`. Antes de pedir push: suíte verde no Windows e no Linux (WSL, Node 20 e 24) e benches sem erro.
- Trabalho no branch `v0.5.5`, saído da main; merge só com autorização.
- Commits com `git commit -F <arquivo>` terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Primeira sessão, sem `saude.json`**: o hook não espera a coleta; dispara e segue, sem aviso. Teste na Task 9 (`prompt sem saude.json: dispara e não emite aviso`).
2. **Várias sessões abrindo juntas**: só um coletor roda, por causa da trava `wx`. Teste na Task 6 (`dois talvezColetar seguidos: um disparo`).
3. **PowerShell ausente, lento ou bloqueado por política**: o coletor grava o que tiver dentro de 8 s, e as leituras faltantes ficam "não disponível". Teste na Task 4 (`executar que estoura o prazo: leitura parcial, na`).
4. **`saude.json` com `em` no futuro ou velho demais (relógio pulou)**: tratado como velho; nenhum aviso sai de leitura com mais de 5 min. Teste na Task 7 (`leitura velha ou do futuro: sem aviso`).
5. **Saída de sistema em outro idioma ou com vírgula decimal** (`nvidia-smi`, `pmset`, nomes de processo com acento ou gigantes): o parser aceita vírgula, satura nomes em 60 caracteres e descarta controle. Teste na Task 4 (`saídas com vírgula, acento e nome gigante`).

---

### Task 1: `compat` como fonte única

**Files:**
- Modify: `package.json` (adicionar `"compat": { "node": ">=20", "claudeCode": "2.1.251" }`)
- Test: `test/compat-fonte.test.js`

**Interfaces:**
- Produces: `package.json#compat.node` e `compat.claudeCode`, lidos pela Task 10.

- [ ] **Step 1: Write the failing test** `compat do package.json bate com engines e instaladores`. Afirma:
  - `pkg.compat.node === pkg.engines.node`;
  - `install.sh` e `install.ps1` contêm `2.1.251`, e esse é `pkg.compat.claudeCode`;
  - o piso de Node dos dois instaladores é `20`.
- [ ] **Step 2: Run** `node --test test/compat-fonte.test.js`. Expected: FAIL (`compat` indefinido).
- [ ] **Step 3: Add `compat`** ao `package.json`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(compat): fonte única das versões suportadas`.

### Task 2: Itens `saude.*` na tabela de limites

**Files:**
- Modify: `src/config/tabela.js` (ITENS, PARES), `src/config/pedido.js` (`GRUPOS_LIMITES` ganha `'saude'`)
- Test: `test/config-tabela.test.js` (se não existir, criar `test/config-saude.test.js`)

**Interfaces:**
- Produces: ids `saude.ligado`, `saude.ram.amarelo` (85, 50–98), `saude.ram.vermelho` (93, 55–99), `saude.liberarProprios`, `saude.gpu.max` (85, 60–105), `saude.cpu.max` (90, 60–105), `saude.bateria.min` (15, 5–50), `saude.disco.minGB` (5, 1–100), `saude.tetoHooks`, `saude.tetoHooks.ms` (40, 10–500), `saude.compat`, `saude.conflitos`, `saude.limpeza`, `saude.limpeza.mb` (50, 10–1000), `saude.economia`.
  - Os booleanos têm padrão `true`. O grupo de todos é `'saude'`.
  - `frouxo`: desligar = `'desligar'` nos booleanos; RAM/GPU/CPU `'maior'`, bateria e disco `'menor'`, `tetoHooks.ms` `'maior'`, `limpeza.mb` `'maior'`.
  - PAR novo: `['saude.ram.amarelo', 'saude.ram.vermelho', true]`.
  - `lerConfigSaude(dir)` → `{ config: { ligado, ram: { amarelo, vermelho }, … } }` em `src/saude/config.js`, montado de `lerConfiguracao` (mesmo padrão de `roteamento/config.js`).

- [ ] **Step 1: Write failing tests**:
  - `itens saude.* existem com padrão, faixa e grupo`: confere os ids e valores acima;
  - `par RAM incoerente volta ao padrão`: amarelo 95 com vermelho 90 → os dois voltam ao padrão;
  - `/hadouken:limites aceita saude.ram.vermelho 90`: `lerPedidoLimites('saude.ram.vermelho 90')` → `acao: 'gravar'`.
- [ ] **Step 2: Run** `node --test test/config-saude.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** os itens, o par, o grupo e `lerConfigSaude`.
- [ ] **Step 4: Run** com a suíte de config: `node --test --test-concurrency=2 test/config-*.test.js test/configuracao.test.js`. Expected: PASS. Atualize os testes que contam itens ou grupos.
- [ ] **Step 5: Commit** `feat(saude): itens de configuração`.

### Task 3: `processos.js` — classes, sugestões e encerráveis (puro)

**Files:**
- Create: `src/saude/processos.js`
- Test: `test/saude-processos.test.js`

**Interfaces:**
- Produces:
  - `classificar(lista)`: `lista` é um array de `{ pid, ppid, nome, cmd, rssBytes, cpuPct }` → devolve os mesmos objetos com `classe` ∈ `'claude'|'hadouken'|'vscode'|'navegador'|'node-dev'|'sistema'|'outro'`.
  - `sugerirFechar(lista, { pidSessao })`: até 5 itens `{ nome, rssBytes }`, das classes `navegador`, `vscode` (exceto a janela com mais RAM), `node-dev` e `outro`, em ordem decrescente de RSS. Fora: `sistema`, `claude`, `hadouken` e a árvore de `pidSessao`. Nomes agregados por aplicativo (soma dos processos do mesmo `nome`).
  - `encerraveis(lista, travas, agoraMs)`: `travas` é `[{ pid, script, inicioMs, prazoMs }]` → pids com classe `hadouken`, `cmd` contendo o `script` da trava e `agoraMs - inicioMs > 3 * prazoMs`.
- A lista de nomes por classe fica no código, por plataforma (`chrome`, `msedge`, `firefox`, `Code`, `code`…), e é testada.

- [ ] **Step 1: Write failing tests**:
  - `classifica navegador, vscode, claude e sistema nas três plataformas`;
  - `sugerirFechar soma por app, tira sistema e a sessão, no máximo 5`;
  - `encerraveis só pega hadouken com trava, cmd batendo e 3× o prazo`: um `outro` com o mesmo pid da trava **não** entra; um hadouken com 2,9× o prazo não entra;
  - `nome com controle ou gigante é saneado em 60`.
- [ ] **Step 2: Run** `node --test test/saude-processos.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(saude): classes de processo e sugestões`.

### Task 4: `coletor.js` — leituras por plataforma com `executar` injetado

**Files:**
- Create: `src/saude/coletor.js`
- Test: `test/saude-coletor.test.js`

**Interfaces:**
- Consumes: `classificar` (Task 3).
- Produces: `coletar({ agoraMs, plataforma, executar, fs, os, dirDados, dirProjeto })` → `Promise<Leitura>`.
  - `Leitura = { versao: 1, em, ram: { totalBytes, livreBytes, usadaPct }, cpu: { cargaPct|null, tempC|null }, gpu: { nome|null, tempC|null, usoPct|null }, bateria: { pct, naTomada }|null, disco: { dadosLivreBytes|null, projetoLivreBytes|null }, processos: [...classificados, ≤ 40 por RSS], fontes: { campo: 'ok'|'na'|'prazo' } }`.
  - `executar(cmd, args, { prazoMs }) → Promise<{ ok, stdout }>` é a costura. O adaptador real fica em `src/saude/executar.js`: `spawn` sem shell, `windowsHide`, mata no prazo e corta o stdout em 2 MB.
- Fontes, cada uma com prazo de 3 s:
  - Windows: um único `powershell -NoProfile -NonInteractive -Command` devolvendo JSON com `Win32_Process`, `Win32_Processor.LoadPercentage`, `Win32_Battery` e `MSAcpi_ThermalZoneTemperature` (este em try; "Acesso negado" vira `na`).
  - posix: `ps -axo pid=,ppid=,rss=,pcpu=,comm=` e `/sys/class/thermal/thermal_zone*/temp` (Linux).
  - Bateria: `/sys/class/power_supply` (Linux) e `pmset -g batt` (macOS).
  - GPU: `nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu --format=csv,noheader,nounits`, no PATH ou em `%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe`.
  - RAM: `os.totalmem`/`os.freemem`. Disco: `fs.statfsSync`.

- [ ] **Step 1: Write failing tests** com `executar` falso por plataforma:
  - `win32: json do powershell vira leitura; térmica negada fica na`;
  - `linux: ps e thermal viram leitura`;
  - `darwin: pmset vira bateria; cpu tempC null`;
  - `executar que estoura o prazo: leitura parcial, na` (Review Focus 3);
  - `saídas com vírgula, acento e nome gigante` (Review Focus 5);
  - `sem nvidia-smi: gpu na`.
- [ ] **Step 2: Run** `node --test test/saude-coletor.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `coletar` e `executar.js`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(saude): coletor por plataforma`.

### Task 5: `reparo.js` e `limpeza.js`

**Files:**
- Create: `src/saude/reparo.js`, `src/saude/limpeza.js`
- Test: `test/saude-reparo.test.js`, `test/saude-limpeza.test.js`

**Interfaces:**
- Produces:
  - `ARQUIVOS_ESTADO`: lista fixa dos JSON de estado do hadouken: `estado.json`, `guarda.json`, `liberacao.json`, `guarda-eventos.json`, `alertas.json`, `projecao.json`, `uso-oficial.json`, `config.json`, `saude-avisos.json`, `tetos.json`, `saude-modo.json`.
  - `repararDados(dir, agoraMs)` → `[{ arquivo, copia }]`:
    - para cada arquivo cujo `lerJson` dá `motivo: 'invalido'` sendo arquivo regular, renomeia para `<nome>.corrompido-<AAAA-MM-DD-HHmm>`, guarda no máximo 3 por arquivo e apaga a mais velha;
    - não recria nada, porque o ausente já é o padrão seguro;
    - registra o evento de guarda `'reparo'` (adicionar a `TIPOS_EVENTO` e a `TIPOS_ATENCAO`) com o detalhe = nome do arquivo.
  - `limparDados(dir, { tetoMb, agoraMs })` → `{ cortes: [{ arquivo, antesBytes, depoisBytes }] }`:
    - `historico.jsonl` > 5 MB: mantém as últimas linhas até 4 MB, em linha inteira;
    - `indice-*.json` > 10 MB: apaga (se reconstrói);
    - `*.corrompido-*` com mais de 30 dias: apaga;
    - o `venv` nunca é tocado;
    - total (sem `venv`) acima de `tetoMb`: corta o histórico primeiro.

- [ ] **Step 1: Write failing tests**:
  - `json inválido vai para quarentena e registra reparo`;
  - `mantém só 3 quarentenas`;
  - `ausente e grande não são reparados`;
  - `config.json inválido também vai para quarentena`;
  - `histórico acima de 5 MB fica em 4 MB em linha inteira`;
  - `índice acima de 10 MB é apagado`;
  - `venv intocado`;
  - `quarentena com mais de 30 dias apagada`.
- [ ] **Step 2: Run** os dois arquivos. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Rode também `test/eventos.test.js` e `test/guarda-registros.test.js`, por causa do tipo novo.
- [ ] **Step 5: Commit** `feat(saude): autorreparo e limpeza dos dados`.

### Task 6: `coletor-main.js`, `ler.js` e travas com pid

**Files:**
- Create: `src/saude/coletor-main.js`, `src/saude/ler.js`
- Modify: o ponto onde o aprender cria a trava ou pid (`src/aprendizado/*`) para gravar `{ pid, script: 'aprender', inicioMs, prazoMs: 600000 }` em `aprender.lock` (ou no arquivo de trava que ele já tem)
- Test: `test/saude-ler.test.js`, `test/saude-coletor-main.test.js`

**Interfaces:**
- Consumes: `coletar` (T4), `repararDados` e `limparDados` (T5), `encerraveis` (T3), `lerConfigSaude` (T2).
- Produces:
  - `ARQ_SAUDE = 'saude.json'`, `ARQ_TRAVA_SAUDE = 'saude.lock'`.
  - `lerSaude(dir, agoraMs)` → `{ leitura: Leitura|null, idadeMs: number|null }`. `em` no futuro ou idade > 5 min dá `leitura: null`.
  - `talvezColetar(dir, agoraMs, { disparar })` → boolean. Dispara se `saude.json` tem mais de 60 s ou está ausente, `saude.ligado` e não há trava viva. `disparar` é um adaptador: o real faz `spawn(process.execPath, [<raiz>/src/saude/coletor-main.js], { detached, stdio: 'ignore', windowsHide, cwd: dir })` + `unref`, como em `dispararPainel`. Não pega a trava; quem pega é o coletor.
  - `coletor-main.js`, na ordem:
    1. trava `saude.lock` com `wx` e `{ pid, script: 'coletor-main', inicioMs, prazoMs: 8000 }` (vencida em 30 s);
    2. `os.setPriority(19)` em try;
    3. `coletar`;
    4. `encerraveis` sobre as travas `saude.lock` e `aprender.lock` e `process.kill` em cada pid, só com `saude.liberarProprios`, registrando o evento `'reparo'` com detalhe `encerrado:<script>`;
    5. `repararDados`;
    6. `limparDados` (com `saude.limpeza`);
    7. grava `saude.json` atômico;
    8. solta a trava.

    Prazo total de 8 s (timer que grava o que tiver e sai).

- [ ] **Step 1: Write failing tests**:
  - `lerSaude: ausente, fresca, velha, do futuro`;
  - `talvezColetar: fresca não dispara; velha dispara; trava viva não dispara`;
  - `dois talvezColetar seguidos: um disparo` (Review Focus 2). O `disparar` falso cria a `saude.lock` viva, como o coletor faria ao subir; o segundo `talvezColetar` vê a trava e não dispara;
  - `coletor-main com coletar falso grava saude.json e solta a trava`;
  - `saude.ligado false: não dispara`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `coletor-main.js` exporta `rodarColetor(deps)` para o teste e só roda sozinho quando é o ponto de entrada.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(saude): coletor desanexado e leitura nos hooks`.

### Task 7: `avisos.js` — decisão pura dos avisos e do modo leve

**Files:**
- Create: `src/saude/avisos.js`, `src/saude/mensagens.js`, `src/saude/modo.js`
- Test: `test/saude-avisos.test.js`, `test/saude-modo.test.js`

**Interfaces:**
- Consumes: `Leitura` (T4), `lerConfigSaude` (T2).
- Produces:
  - `decidirAvisos({ leitura, config, registro, modo, sessao, agoraMs })` → `{ usuario: string|null, claude: string|null, barra: string|null, registro }`.
    - Tipos de episódio: `ram`, `gpu`, `cpu`, `bateria`, `disco`.
    - `registro = { episodios: { [tipo]: { inicioMs, fimAbaixoMs|null, avisadoUsuario: bool, sessoes: [sid8] } }, modoAnunciado: { [sid8]: 'leve'|'normal' } }`, gravado em `saude-avisos.json`.
    - O mais grave primeiro (vermelho > amarelo; ordem ram, gpu, cpu, disco, bateria).
    - `barra`: `PC: RAM 94%`, `PC: GPU 89°C` ou null, e `leve` acrescentado quando o modo está ligado.
  - `mensagens.js`: os textos fixos. Exatos:
    - RAM vermelha ao Claude: `hadouken: RAM do PC em ${pct}%. Até baixar: testes com concorrência 1, sem subagentes em paralelo, sem build em watch; prefira ler trechos a arquivos inteiros.`
    - RAM amarela: `hadouken: RAM do PC em ${pct}%. Prefira testes e subagentes em série enquanto durar.`
    - GPU/CPU: `hadouken: ${peca} a ${t} °C. Evite tarefas pesadas em paralelo (builds, testes e subagentes ao mesmo tempo); faça em série.`
    - Modo leve: `hadouken: modo leve até ${hh:mm}. Um subagente por vez, effort mínimo necessário, Haiku/Sonnet para busca, sem Fable nem Workflow sem pedido explícito, testes com concorrência 1.`
    - Ao usuário: `hadouken: ${resumo}. /hadouken:saude leve alivia o PC por 4 h; /hadouken:saude mostra o que fechar.`, com no máximo 300 caracteres.
  - `modo.js`:
    - `lerModo(dir, agoraMs)` → `{ leve: bool, ateMs|null }`; expira sozinho;
    - `gravarModo(dir, leve, agoraMs)` → `{ ok }`; leve = agora + 4 h, gravado em `saude-modo.json`.

- [ ] **Step 1: Write failing tests**:
  - `RAM 94% na primeira mensagem: usuário e Claude avisados, barra PC: RAM 94%`;
  - `segunda mensagem da mesma sessão: nada`;
  - `outra sessão no mesmo episódio: só o Claude dela, usuário não` (global × por sessão);
  - `RAM cai e volta em menos de 30 min: mesmo episódio; depois de 30 min: episódio novo`;
  - `vários tipos: um aviso ao usuário, o mais grave`;
  - `leitura velha ou do futuro: sem aviso` (Review Focus 4, via `leitura: null`);
  - `modo leve: linha ao Claude só quando muda; expira em 4 h`;
  - `saude.ligado false: tudo null`;
  - `texto ao Claude nunca traz nome de processo`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(saude): decisão dos avisos e modo leve`.

### Task 8: `tetos.js` — orçamento das partes opcionais

**Files:**
- Create: `src/saude/tetos.js`
- Test: `test/saude-tetos.test.js`

**Interfaces:**
- Produces: `abrirTetos(dir, agoraMs, { relogio = performance.now, config })` → `{ rodar(nome, fn): Promise<valor|undefined>, fechar(): void, desligadas(): [{ nome, ateMs }] }`.
  - `rodar` pula `fn` (devolve `undefined`) se a parte estiver desligada. Senão, mede `fn` e anota estouro se passar de `config.tetoHooks.ms`.
  - Com 3 estouros nas últimas 10 execuções: desliga por 24 h e registra o evento `'reparo'` com detalhe `teto:<nome>`.
  - `fechar` grava `tetos.json` uma vez, só se mudou.
  - Nomes fixos: `aprendizado`, `versao`, `painel`, `previsao`, `coletor`, `roteamento-otimizacoes`. Um nome fora da lista lança na hora do teste (erro de programação).
  - Com `saude.tetoHooks` desligado, só roda.

- [ ] **Step 1: Write failing tests** com relógio falso:
  - `3 estouros em 10 desligam por 24 h`;
  - `2 em 10 não`;
  - `volta depois de 24 h`;
  - `fn que lança: rodar devolve undefined e conta como execução`;
  - `fechar sem mudança não grava`;
  - `tetos.json corrompido: começa vazio`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(saude): teto de tempo das partes opcionais`.

### Task 9: Integração nos hooks e na barra

**Files:**
- Modify: `src/hooks/comum.js` (`rodarHook` ganha opção `{ prazoMs }` para o watchdog `unref` que sai com 0 sem saída), `src/hooks/prompt-submit.js`, `src/hooks/session-start.js`, `src/hooks/session-end.js`, `src/statusline.js`, `src/formato.js` (segmento `saude` antes da marca do roteamento)
- Test: `test/saude-hooks.test.js`; atualizar `test/statusline.test.js` e `test/hooks.test.js`

**Interfaces:**
- Consumes: `lerSaude`, `talvezColetar` (T6), `decidirAvisos`, `lerModo` (T7), `abrirTetos` (T8).
- Produces:
  - `formatarBarra({ …, saude })`: `saude` é a string `barra` de `decidirAvisos`, saneada, com no máximo 24 caracteres. Na barra do Claude Code fica antes da marca do roteamento.
  - **prompt-submit:**
    - `talvezColetar` dentro de `tetos.rodar('coletor', …)`;
    - `decidirAvisos`; `claude` entra nas linhas de contexto e `usuario` no `systemMessage`;
    - grava o `registro`;
    - as partes existentes (previsão, aprendizado, otimizações do roteamento) passam por `tetos.rodar` com os nomes da T8;
    - `prazoMs = 8000`.
  - **session-start:**
    - o mesmo, mais a linha do modo leve se estiver ligado, como contexto;
    - `prazoMs = 4000`;
    - o `dispararPainel` passa por `tetos.rodar('painel', …)`.
  - **session-end:** `prazoMs = 4000`. **statusline:** `prazoMs` = 80% do timeout da statusLine (ou 4000 se não houver).
  - Os hooks `guarda-*` e `liberar` **não** recebem `prazoMs`.

- [ ] **Step 1: Write failing tests** rodando os hooks com stdin e dir temporário:
  - `prompt sem saude.json: dispara e não emite aviso` (Review Focus 1; `HADOUKEN_SAUDE_DISPARAR=0` no teste troca o spawn por um marcador em arquivo);
  - `prompt com RAM 94%: contexto traz a orientação e systemMessage traz o aviso; segunda vez nada`;
  - `prompt com saude.ligado false: igual à 0.5.4`;
  - `statusline com saude barra: termina com PC: RAM 94% │ hadouken X`;
  - `watchdog: parte que trava faz o hook sair 0 sem saída antes do timeout`;
  - `guarda-despacho sem watchdog`, conferindo que `rodarHook` não recebe `prazoMs` (por leitura do fonte).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** a suíte inteira com `--test-concurrency=2` e os dois benches (`node bench/statusline-p95.mjs 20`, `node bench/hooks-p95.mjs 20`). Expected: PASS, e o p95 dentro do orçamento. Ajuste a `LINHA_BARRA` do bench só se o cenário dela tiver o segmento.
- [ ] **Step 5: Commit** `feat(saude): avisos nos hooks e na barra, sem bloquear`.

**Decisões da execução (Claude, por ordem do Sr. Garioli):**
- O teto do `coletor` mede só a decisão de disparar; o spawn (20–100 ms num PC carregado) sai depois da saída do hook (`depois()`), fora da medida, para o teto não desligar o coletor justo quando o PC pesa.
- A statusline também dispara o coletor (quando `saude.json` tem mais de 1 min), depois de escrever a barra.
- Separador entre partes do segmento: `, ` (`PC: RAM 94%, leve`); o `·` é glifo da barra e seria removido.
- Amarelo → vermelho no mesmo episódio avisa de novo; vermelho → amarelo não repete nada. Ao usuário, um aviso só (o tipo mais grave); os outros tipos novos ficam marcados.
- Disco em GiB (1024³). `tetos.json` só é gravado quando há estouro ou mudança real.
- Testes: `HADOUKEN_SAUDE_DISPARAR=0` troca o spawn por um marcador; sob `node --test` (`NODE_TEST_CONTEXT`) nenhum coletor real sobe; `=1` força o real.
- O teto `aprendizado` cobre `linhasDoInicio` e o perfil do prompt, nunca `depoisDoInicio`.
- Peso (A/B pareado contra o commit anterior, PC carregado): a primeira versão custava +35 ms no prompt e +48 ms na barra. Ficou em ~+24 ms e ~+16 ms com três cortes:
  - `child_process` só carrega no disparo;
  - a barra tem caminho próprio (`saude/barra.js` + `faixas.js`, folha sem imports);
  - nos hooks, `semNovidade` (faixas.js) pula `avisos.js`/`mensagens.js` quando não há nada a dizer, com teste de equivalência contra `decidirAvisos`.
- `sanearNome` mudou para `faixas.js` (processos.js reexporta).

### Task 10: Compatibilidade e conflitos

**Files:**
- Create: `src/saude/compat.js`
- Modify: `src/hooks/session-start.js` (uma vez a cada 24 h, gravando `conflitos.json`)
- Test: `test/saude-compat.test.js`

**Interfaces:**
- Consumes: `package.json#compat` (T1), `indice-hooks.json` (p95 por plugin, `custo-hooks.js`), `lerAvisos`/registro (T7) para o "uma vez".
- Produces:
  - `conferirCompat({ node, claudeCode, extensao, plugin }, compat)` → `[{ tipo: 'node'|'claudeCode'|'extensao', atual, minimo }]`.
    - A versão do Claude Code vem de `process.env.CLAUDE_CODE_VERSION` ou de `entrada.version`, quando existirem; senão fica fora (spec §10).
    - A da extensão vem de `painel/instalado.json`.
  - `acharConflitos({ statusLineUsuario, pluginsHooks, custos })` → `[{ tipo: 'statusLine'|'permissao'|'lento', plugin|null }]`.
    - `pluginsHooks` são os `hooks.json` lidos dos plugins habilitados (`installed_plugins.json` + `enabledPlugins`), com no máximo 64 KB cada.
    - `permissao` vale para outro plugin com matcher que intersecta os da guarda.
    - `lento` vale para p95 > 500 ms em 7 dias.
    - O rótulo do plugin passa por `ROTULO_PLUGIN`.
  - O aviso ao usuário sai uma vez por combinação (hash em `compat-avisados.json`) pelo `systemMessage`.

- [x] **Step 1: Write failing tests**:
  - `node 18 fora do suportado`;
  - `claudeCode ausente não acusa`;
  - `extensão mais velha que o plugin acusa`;
  - `statusLine de outro`;
  - `outro plugin com PreToolUse Agent acusa permissao`;
  - `p95 600 ms acusa lento`;
  - `rótulo malicioso vira (outros)`;
  - `segunda sessão no mesmo dia não relê`.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Commit** `feat(saude): compatibilidade e conflitos com outros plugins`.

**Decisões da execução (Task 10):**
- **Quem lê o quê.** Os conflitos saem do coletor desanexado (`src/saude/conflitos.js`, `atualizarConflitos`), não do SessionStart. O motivo é o índice de custo dos hooks, que passa de 6 MB e estouraria os 40 ms do hook. O coletor:
  - roda a leitura no máximo uma vez a cada 24 h (`conflitos.json { v: 1, em, itens }`);
  - só lê o `indice-hooks.json` que já existe (`lerItensDoIndice`, novo em `indice-hooks.js`) e nunca indexa transcript; sem índice, não acusa `lento`;
  - roda depois de gravar `saude.json`, para a barra não esperar;
  - respeita `saude.conflitos`.
- **Plugin habilitado** é o que tem `enabledPlugins[chave] !== false` no settings do usuário, olhando só a primeira instalação de cada um.
- **SessionStart.** `src/saude/aviso-compat.js` (leve: só JSON pequenos) roda dentro de `tetos.rodar('versao', …)`. Ele:
  - lê as versões e o `conflitos.json`;
  - avisa uma vez por combinação: `chaveDe` vai para `compat-avisados.json`, até 50 chaves. Arquivo à parte porque `saude-avisos.json` descarta chaves que não conhece. Se a gravação falha, não avisa, para não repetir em toda sessão;
  - manda o texto só ao usuário, pelo `systemMessage`.
- **Versões.**
  - Claude Code: `entrada.version` ou `CLAUDE_CODE_VERSION`; sem nenhum dos dois, fica de fora (§10). O schema de `estado.json` não mudou.
  - Extensão: só acusa com o `plugin.json` atualizado há mais de 24 h (o instalador automático teve tempo), sem falha de instalação pendente (que já tem a linha dela) e com `painel/instalado.json` presente (sem VS Code, nada a dizer).
- `saude.ligado false` desliga o aviso, igual à 0.5.4.

### Task 11: Economia semanal

**Files:**
- Create: `src/saude/economia.js`
- Modify: `src/hooks/session-start.js` (primeiro SessionStart da semana ISO, registrado em `saude-avisos.json`)
- Test: `test/saude-economia.test.js`

**Interfaces:**
- Consumes: eventos da guarda (`lerEventos` de `guarda/registros.js`: `disparo`, `negado`, `perguntado`, `troca-bloqueada`) e `resumoRoteamento7d` (`uso/painel-api.js`, ou a função de `roteamento/registro.js` que ele usa).
- Produces: `resumoEconomia(dir, agoraMs)` → `{ texto, contagens, tokensEstimados|null }`.
  - Texto: `hadouken na semana: ${n} despachos perguntados ou negados, ${m} rebaixamentos do roteamento` e, só com base medida, `; estimativa: ~${k} mil tokens poupados`.
  - Sem nada a contar, `texto: null`.

- [x] **Step 1: Write failing tests**:
  - `conta só eventos dos últimos 7 dias`;
  - `sem base medida: sem tokens`;
  - `com base: texto traz estimativa`;
  - `nada a contar: null`;
  - `segunda sessão da semana não repete`.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Commit** `feat(saude): resumo semanal de economia`.

**Decisões da execução (Task 11):**
- **Interface.** `resumoEconomia({ dir, agoraMs, respostasSubagente })` devolve `{ texto, contagens: { guarda, trocas, rebaixamentos }, tokensEstimados }`, e `linhaDaSemana({ dir, agoraMs, config })` serve o SessionStart.
- **Contagens.**
  - Guarda: `negado` + `perguntado`.
  - Trocas: `troca-bloqueada` sai à parte, como "trocas de modelo seguradas".
  - `disparo` fica fora: é a trava que dispara e se repete nos negados, e contaria a mesma coisa duas vezes.
  - Rebaixamentos do roteamento: `negar` (exigido) + `avisar` (sugerido).
  - Só entram as partes acima de zero, com singular e plural.
- **Texto.** Sempre começa por `hadouken na semana (estimativa): …`, porque a spec manda o texto sempre dizer "estimativa". Os tokens (`; ~k mil tokens poupados`) só aparecem com base medida: o `custoEvitado` do resumo do roteamento (mediana das respostas de Haiku × negados N1/N2, com no mínimo 5 respostas).
- **Base de tokens.** O SessionStart não lê o índice de transcripts, para caber no orçamento, e por isso mostra só as contagens. Quem passa as `respostasSubagente` e mostra a estimativa é o `/hadouken:saude` (Task 12).
- **Uma vez por semana ISO, no fuso local.** O registro fica em `economia-semana.json { v, semana }` e não em `saude-avisos.json`, que descarta chaves desconhecidas. A semana sem nada a contar também conta como vista. Se a gravação falha, não fala.
- **Teto e configuração.** Parte nova `economia` no teto (`PARTES`), com aviso próprio; respeita `saude.ligado` e `saude.economia`.
- **Correção de texto antigo.** O aviso do teto dizia "o aprendizado ficou lenta"; agora a frase é neutra em gênero ("…fica fora por 24 h"), com teste que cobre todas as partes. O rótulo de `versao` passa a "a conferência de versões e conflitos".

### Task 12: `/hadouken:saude`

**Files:**
- Create: `src/saude/relatorio.js`, `src/hooks/saude.js`, `skills/saude/SKILL.md` (como `skills/limites/SKILL.md`)
- Modify: `hooks/hooks.json` (UserPromptExpansion `hadouken:saude`, timeout 10)
- Test: `test/saude-relatorio.test.js`; atualizar `test/hooks.test.js` (lista de hooks)

**Interfaces:**
- Consumes: `lerSaude` (T6), `sugerirFechar` (T3), `abrirTetos(...).desligadas()` (T8), eventos `'reparo'` (T5), `conflitos.json` (T10), `resumoEconomia` (T11), `lerModo`/`gravarModo` (T7), o tamanho dos arquivos de dados.
- Produces:
  - `relatorioSaude(dir, agoraMs)` → texto nas seções da spec §6.D, no formato do terminal do protótipo: rótulos de 6 colunas `PC`, `Modo`, `Hooks`, `Reparo`, `Compat`, `Confl.`, `Dados`, `Semana`.
  - Hook: mesmo portão do `limites.js` (`entrypointSdk`, `digitado`, `decision: 'block'`).
    - Argumentos: vazio mostra o relatório; `leve` grava o modo e responde `hadouken: modo leve até HH:MM. O Claude passa a trabalhar em série; /hadouken:saude normal volta.`; `normal` responde `hadouken: modo normal.`.
    - Qualquer outro argumento devolve a linha de uso `uso: /hadouken:saude [leve | normal]`.

- [x] **Step 1: Write failing tests**:
  - `relatório sem saude.json diz que a primeira leitura vem em instantes`;
  - `relatório com RAM vermelha lista até 5 apps`;
  - `leve grava saude-modo.json e responde com a hora`;
  - `normal desliga`;
  - `argumento estranho: uso, nada gravado`;
  - `origem não digitada: recusado`.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Commit** `feat(saude): /hadouken:saude, leve e normal`.

**Decisões da execução (Task 12):**
- **Interface.** `relatorioSaude({ dir, agoraMs, config, raizPlugin, dirConfig, versaoNode, versaoClaude })` devolve o texto. Cada seção tem seu próprio try: uma parte que falha não derruba o resto do relatório.
- **Leitura dos índices só para ler.** Os p95 por plugin vêm de `lerItensDoIndice` (T10). A base de tokens da economia vem do `respostasSubagenteDoIndice` novo em `transcripts.js`. Nenhum dos dois reconstrói o índice, então o comando não fica pesado.
- **Coletor depois da saída.** Com `saude.json` velho ou ausente, o relatório diz que a leitura "vem em instantes", e o hook dispara o coletor só depois de escrever a resposta. Nos testes, `HADOUKEN_SAUDE_DISPARAR=0` desliga esse disparo.
- **Prazo.** `prazoMs: 8000`, 80% do timeout de 10 s do hooks.json, como nos hooks de sessão.
- **Sugestão de fechar.** Só com RAM vermelha, até 5 apps, e o texto diz "só sugestão; quem fecha é você". O hadouken nunca fecha nada.
- **Formato.** Rótulos de 6 colunas, como no terminal do protótipo. A linha do PC diz o que não dá para ler sem admin, em vez de pedir elevação.
- **Portão.** É o mesmo do `limites.js`: `entrypointSdk` recusa `-p` e SDK, e `digitado` exige origem `plugin` com `slash_command`. Argumentos com mais de 64 caracteres, ou fora de `''`, `leve` e `normal`, recebem a linha de uso e nada é gravado.
- **Exportações.** `ROTULO_PARTE` (mensagens) e `descreverItem` (compat) passam a ser exportadas, para o relatório usar os mesmos textos dos avisos. `medirDados` (limpeza) dá o total e os 3 maiores arquivos.
- **Docs.** README e wiki ficam para a Task 15.

### Task 13: Janela do VS Code — "PC agora" (variante A) e aba Saúde

**Files:**
- Modify: `src/uso/painel-api.js` (`export async function estadoSaude()` → `{ leitura, idadeMs, modo, sugestoes, resumo }`, com `resumo` = uma linha de hooks, reparos, compat e conflitos; e `export async function mudarModo(leve)` → `{ ok }`), `vscode/extension.cjs` (`enviarEstado` inclui `saude`; mensagens `ligarLeve`/`desligarLeve` chamam `mudarModo`; item da barra do VS Code ganha o segmento `barra` de `decidirAvisos` lido pelo `painel-api`), `vscode/janela/index.html` (seção `<section aria-labelledby="t-pc">` depois de Uso), `vscode/janela/janela.js` (`montarSaude(m.saude)` reaproveitando o feixe de `montarFeixes`; `GRUPOS` ganha `['saude', 'Saúde']`), `vscode/janela/janela.css` (`.pill`, `.sugestao`)
- Test: `test/extensao.test.js` (o shim falso ganha `estadoSaude`/`mudarModo`), `test/janela.test.js` (ou o teste da webview que existir)

**Interfaces:**
- Consumes: T6, T7, T12.
- Produces: a mensagem `estado` ganha `saude: { leitura, idadeMs, modo: { leve, ateMs }, sugestoes: [{ nome, rssBytes }], resumo: string }`. A webview mostra:
  - feixes de RAM, GPU, CPU e disco (e bateria, se houver), com urgência `atencao`/`urgente` pelas faixas da config;
  - "não disponível neste PC" para `null`;
  - o quadro "Fechar libera memória" só na faixa vermelha;
  - o botão "Ligar modo leve (4 h)" ou "Voltar ao normal" só com alerta ou modo ligado;
  - a etiqueta `LEVE`;
  - a linha `resumo` no fim.
  - Plugin velho sem `estadoSaude`: a seção some.

- [ ] **Step 1: Write failing tests**:
  - `estado traz saude quando o painel tem estadoSaude; sem ele, sem saude`;
  - `ligarLeve chama mudarModo(true) e reenvia o estado`;
  - `webview: RAM 94% mostra feixe urgente, sugestões e botão; tranquilo sem botão`;
  - `nome de app vindo do estado é texto, nunca HTML` (`textContent`).
- [ ] **Step 2: Run** `node --test --test-concurrency=2 test/extensao.test.js` mais o da webview. Expected: FAIL.
- [ ] **Step 3: Implement**, usando `hadouken-kit:yu-ux-web-expert` para conferir contraste 4,5:1, foco visível, leitores de tela (`role=status` nas mudanças) e movimento reduzido.
- [ ] **Step 4: Run.** Expected: PASS. Abra a janela num servidor local no Chrome e confira os quatro cenários do protótipo.
- [ ] **Step 5: Commit** `feat(vscode): seção PC agora e aba Saúde`.

### Task 14: Robustez e peso

**Files:**
- Create: `test/hooks-entrada-hostil.test.js`, `test/peso-plugin.test.js`
- Modify: `bench/hooks-p95.mjs` (cenários `prompt com saude.json` e `prompt disparando coletor`, este com `HADOUKEN_SAUDE_DISPARAR=0`)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Write failing tests**:
  - `entrada hostil`: cada hook de `hooks/hooks.json` com stdin vazio, `{`, `[]`, `{"session_id":5}` e 1 MB de texto sai com 0. Ou sem saída, ou com a decisão que já dava na 0.5.4 para a mesma entrada (snapshot do comportamento atual, gerado antes de mudar).
  - `peso`: o tamanho do pacote sem `venv`, `node_modules`, `.git`, `test`, `bench`, `docs` e `wiki` fica abaixo de 1,25× o medido no início da tarefa (fixar o número no teste). Os módulos que o `prompt-submit` carrega sem aviso ficam ≤ o medido + 4.
- [ ] **Step 2: Run.** Expected: os de entrada hostil podem já passar; o de peso FAIL até o número ser fixado.
- [ ] **Step 3: Fix** o que a entrada hostil quebrar e fixe os números de peso.
- [ ] **Step 4: Run** a suíte inteira e os benches. Expected: PASS, p95 dentro do orçamento.
- [ ] **Step 5: Commit** `test: entrada hostil nos hooks e orçamento de peso`.

### Task 15: Documentação, versão e verificação final

**Files:**
- Create: `wiki/Saude-do-PC.md`, `wiki/PC-health.md`
- Modify: `wiki/_Sidebar.md`, `wiki/Comandos.md`, `wiki/Commands.md`, `wiki/Limites.md`, `wiki/Limits.md`, `wiki/Painel-e-janela-do-VS-Code.md`, `wiki/VS-Code-panel-and-window.md`, `wiki/pares.json`, `README.md`, `README.en.md`, `SECURITY.md` (entradas novas: saídas de `ps`/PowerShell/`nvidia-smi`, nomes de processo, `hooks.json` de outros plugins; o encerramento restrito aos próprios processos), `.claude-plugin/plugin.json` e `package.json` (versão `0.5.5`), `vscode/package.json` (versão)
- Test: os testes de wiki, README e versões que já existem (`kit-readme`, pares da wiki etc.)

- [ ] **Step 1: Write** as páginas (o que faz, o que nunca faz, comandos, faixas, "não disponível neste PC", modo leve) e atualize os pares.
- [ ] **Step 2: Bump** da versão nos três manifestos.
- [ ] **Step 3: Run** a suíte inteira no Windows (`--test-concurrency=2`) e no Linux (WSL, Node 20 e 24, com o script da sessão), mais os dois benches. Expected: 0 falhas nos três.
- [ ] **Step 4: Review** do branch inteiro com `mattpocock-skills:code-review` antes de pedir merge; corrija os achados com teste.
- [ ] **Step 5: Commit** `docs: v0.5.5 na wiki, README e SECURITY; versão 0.5.5` e escreva as notas da release no scratchpad. Merge, tag, push, release e wiki só com autorização do Sr. Garioli, um de cada vez.

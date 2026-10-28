# hadouken v0.5.5 — saúde do PC, estabilidade e plugin leve

Data: 2026-10-28. Versão alvo do plugin: 0.5.5. Design decidido pelo Claude por ordem do Sr. Garioli ("Pode seguir implementando sem parar até a 0.5.6"); a lista de extras foi apresentada a ele, que escolheu **todas**.

## 1. Intenção

O hadouken existe para o Claude não fazer doideira e não comer a cota à toa. A 0.5.5 estende isso ao computador: o trabalho com IA não pode travar o PC, esquentar o hardware sem aviso nem deixar o plugin pesado ou quebradiço.

Duas frases do Sr. Garioli são a régua de tudo aqui:

- "O hadouken não pode atrapalhar, a função dele é o Claude não fazer doideras e comer a cota a toa."
- "Todas precisam ser funcionais e nunca sabotar qualquer prompt. Pelo contrário, existe com boas práticas do uso de IA para máxima otimização de qlqr processos de desenvolvimento."

Na prática:

1. **Nenhuma peça desta versão bloqueia, nega, atrasa ou reescreve um prompt ou uma ferramenta.** Tudo aqui é aviso, contexto ou relatório. As únicas decisões de bloqueio continuam sendo as da guarda (P1–P5), que esta versão não muda.
2. **Todo aviso para o Claude é uma orientação de boa prática que ele pode seguir já**: "RAM em 92%: rode testes com concorrência 1 e não lance subagentes em paralelo até baixar". Nunca é "pare". O trabalho continua, só que do jeito mais econômico para o PC.
3. **Todo aviso para o usuário traz a ação em um comando** e aparece uma vez por episódio, nunca a cada mensagem.

## 2. Objetivos

| # | Peça | O que entrega |
|---|---|---|
| A | Coletor de saúde | Lê RAM, processos, CPU, GPU, temperatura, bateria e disco **fora do caminho dos hooks**, num processo de fundo de baixa prioridade, e grava `saude.json`. |
| B | RAM inteligente | Avisa cedo quando a memória aperta, considerando todas as janelas e terminais abertos. Libera sozinho só o que é do hadouken e está sobrando. Sugere quais aplicativos fechar. |
| C | Saúde do hardware | Avisa temperatura alta de CPU e GPU, bateria baixa fora da tomada e disco quase cheio. Sugere um **modo leve** de trabalho que o usuário aceita com um comando. |
| D | `/hadouken:saude` | Um comando com tudo: PC, hooks lentos, arquivos reparados, versões, conflitos, tamanho dos dados e economia da semana. |
| E | Autorreparo | Um arquivo de estado corrompido vai para quarentena e é recriado com o padrão seguro, com um aviso único. A sessão nunca quebra por isso. |
| F | Teto de tempo por hook | Cada parte opcional de um hook tem orçamento de tempo. A parte que estoura repetidamente se desliga sozinha por 24 h e avisa. Cada hook tem prazo interno e sai antes do timeout do Claude Code. |
| G | Compatibilidade | Na partida, confere Node, Claude Code e a extensão do VS Code contra o suportado. Avisa uma vez por combinação. |
| H | Conflito com outros plugins | Detecta outro plugin ou configuração disputando a statusLine ou os mesmos ganchos com decisão de permissão. Avisa uma vez. |
| I | Limpeza dos dados | Teto de tamanho para histórico, eventos e índices do hadouken. Apaga o mais antigo primeiro, em segundo plano. |
| J | Resumo semanal de economia | Uma linha por semana com o que o hadouken evitou: despachos perguntados ou negados, rebaixamentos de modelo e de effort. Sempre marcada como estimativa, e só com o que tem base medida. |
| K | Segurança, estabilidade e leveza | Revisão de entradas, testes de entrada hostil nos hooks, orçamento de peso do plugin verificado em teste e suíte rodando no Windows e no Linux antes de cada push. |

## 3. Fora do escopo

- **Agentes ociosos**, plano Pro/Max nas estimativas e o modo noturno ficam para a 0.5.6.
- **Fechar aplicativos do usuário.** O hadouken sugere e nunca encerra um processo que não seja dele.
- **Pedir elevação de administrador** ou instalar driver ou serviço para ler sensores.
- **Mandar qualquer dado do PC para fora da máquina.**
- **Controlar ventoinha, frequência da CPU ou plano de energia.**

## 4. Anti-objetivos

Qualquer um destes é falha, mesmo que o resto funcione:

- Um prompt ou ferramenta que demora mais ou falha por causa desta versão.
- Um hook que passa a gastar mais que o orçamento atual (§9 da spec v0.4.0: p95 ≤ 150 ms no Linux e no macOS, ≤ 250 ms no Windows).
- Um aviso repetido a cada mensagem, ou um aviso que gasta a cota à toa.
- Um processo do usuário encerrado pelo hadouken.
- Uma leitura de sensor que congela o PC ou deixa um processo pendurado.
- Um número estimado apresentado como medido.

## 5. Restrições

- Node ≥ 20 e nenhuma dependência nova, como hoje.
- Windows, macOS e Linux. O que não dá para ler numa plataforma aparece como "não disponível neste PC", nunca como zero.
- Os hooks só **leem** `saude.json`; nunca coletam. A leitura do Windows via CIM leva cerca de 2 s (medido nesta máquina), e mesmo `os.freemem()` exige uma partida de processo.
- Tudo novo tem liga-desliga na tabela de limites (`src/config/tabela.js`), na janela do VS Code (aba nova **Saúde**) e no `/hadouken:limites`.
- Gravação atômica e travas como no resto do plugin. Nada lança para fora de um hook: em qualquer erro interno, o hook sai com 0 e sem saída.

## 6. Como funciona

### 6.A Coletor de saúde

- **Disparo.** O SessionStart e o hook de prompt verificam a idade de `saude.json`. Se tiver mais de 60 s e ninguém estiver coletando, disparam o coletor **desanexado**, sem esperar, e seguem. Custo no hook: um `stat` e, às vezes, um `spawn` desanexado. Medir no bench.
- **Uma coleta por vez,** com trava `saude.lock` (`wx`, velha depois de 30 s). Várias sessões abertas compartilham a mesma coleta.
- **Prioridade baixa:** `os.setPriority` no próprio processo. Prazo total de 8 s; passou disso, grava o que tiver e sai. Cada leitura externa tem o seu próprio prazo e é morta se estourar.
- **O que lê:**

| Leitura | Fonte |
|---|---|
| RAM total, livre e pressão | `os` |
| Processos (pid, pai, nome, RSS, CPU) | Windows: `Get-CimInstance Win32_Process` numa única chamada de PowerShell com `-NoProfile`; posix: `ps -axo pid,ppid,rss,pcpu,comm` |
| GPU NVIDIA | `nvidia-smi` no PATH ou em `%ProgramFiles%\NVIDIA Corporation\NVSMI`; sem ele, "não disponível" |
| Temperatura da CPU | Linux: `/sys/class/thermal`. Windows: `MSAcpi_ThermalZoneTemperature` só se responder sem admin (nesta máquina responde "Acesso negado", então "não disponível"). macOS: não disponível sem sudo, fica de fora |
| Bateria | Windows: `Win32_Battery`. Linux: `/sys/class/power_supply`. macOS: `pmset -g batt` |
| Disco livre na unidade dos dados do hadouken e na do projeto | `fs.statfs` |

- **Saída:** `saude.json` com `em`, as leituras, a origem de cada uma e a lista de processos já classificada (§6.B). Limite de tamanho: os 40 maiores processos.

### 6.B RAM inteligente

- **Classes de processo:**
  - `claude`: as sessões do Claude Code;
  - `hadouken`: processos cuja linha de comando aponta para scripts do plugin;
  - `vscode`, `navegador`, `node-dev` (servidores e builds);
  - `sistema`, que nunca é sugerido;
  - `outro`.
- **Faixas:** amarelo com memória usada ≥ 85%, vermelho com ≥ 93%. Ambas configuráveis.
- **Liberar sozinho:** encerra apenas processos da classe `hadouken` que passaram muito do próprio prazo, como um coletor ou um aprender pendurado. Precisa haver confirmação dupla pela linha de comando e pelo arquivo de trava do próprio hadouken. Fica registrado em evento. Nada mais é encerrado.
- **Sugestão ao usuário:** na faixa vermelha, o `/hadouken:saude` e o aviso único listam até 5 aplicativos que mais ocupam memória e podem ser fechados (classes `navegador`, `vscode` extra, `node-dev`, `outro`). Ficam fora a sessão atual e o sistema. Cada linha mostra o nome e quanto libera. O usuário é quem fecha.
- **Orientação ao Claude:** quando a faixa muda, o prompt recebe uma linha de contexto, uma vez por episódio. Por exemplo: "hadouken: RAM do PC em 93%. Até baixar: testes com concorrência 1, sem subagentes em paralelo, sem build em watch; prefira ler trechos a arquivos inteiros." Na faixa amarela a orientação é mais branda.

### 6.C Saúde do hardware e modo leve

- **Faixas padrão,** todas configuráveis:
  - GPU ≥ 85 °C;
  - CPU ≥ 90 °C;
  - bateria ≤ 15% fora da tomada;
  - disco livre < 5 GB.
- **Aviso:** um segmento curto na barra, como `PC: GPU 88°C`, enquanto durar; um aviso único ao usuário; e uma linha de contexto ao Claude. Episódio novo só depois de 30 min abaixo da faixa.
- **Modo leve:** o usuário aceita a sugestão com `/hadouken:saude leve` e volta com `/hadouken:saude normal`; o modo também acaba sozinho em 4 h.
  - Enquanto ligado, o SessionStart e o prompt passam ao Claude a orientação de trabalho leve: concorrência 1, um subagente por vez, effort no mínimo necessário, nada de Fable nem de Workflow sem pedido explícito, e preferir Haiku ou Sonnet para busca.
  - **Não bloqueia nada;** é só orientação. A barra mostra `leve`.

### 6.D `/hadouken:saude`

UserPromptExpansion, como o `/hadouken:limites`, lendo só arquivos (rápido). Seções:

1. **PC:** RAM, CPU, GPU, temperatura, bateria e disco, com a idade da leitura.
2. **Sugestões:** aplicativos a fechar e o modo leve.
3. **Hooks:** p95 de cada hook do hadouken e dos outros plugins nos últimos 7 dias, a partir do `indice-hooks.json` que já existe, mais as partes desligadas pelo teto (§6.F).
4. **Reparos:** arquivos postos em quarentena (§6.E).
5. **Versões e compatibilidade** (§6.G).
6. **Conflitos** (§6.H).
7. **Dados:** tamanho por arquivo e o teto (§6.I).
8. **Economia da semana** (§6.J).

Subcomandos: `leve`, `normal`. Qualquer outro argumento mostra a linha de uso.

### 6.E Autorreparo

- Um leitor comum de JSON de estado (a partir do `lerJson` que existe) passa a distinguir **ausente** de **corrompido**.
- Um arquivo corrompido é renomeado para `<nome>.corrompido-<data>`; ficam no máximo 3 por arquivo.
- No lugar entra o **padrão seguro já definido para "ausente"** em cada arquivo.
  - Para a guarda, o comportamento continua o de hoje: liberação corrompida não libera e trava ilegível segue a regra atual do `limparTravas`.
- Um evento `reparo` é registrado e há um aviso único ao usuário.
- Não vale para `config.json`: esse vai para a quarentena e a configuração volta ao padrão com aviso explícito, porque o usuário pode querer recuperar o arquivo.

### 6.F Teto de tempo por hook

- Cada hook marca as partes **opcionais**: aprendizado, consulta de versão, painel, previsão, coletor e limpeza. Cada parte opcional tem um orçamento de 40 ms por padrão.
- Uma parte que estoura o orçamento em 3 das últimas 10 execuções é desligada por 24 h. O controle vai em `tetos.json`, com um aviso único e registro no `/hadouken:saude`.
- **Partes centrais nunca se desligam:** as decisões da guarda e a linha da barra. Se elas forem lentas, o hadouken só relata.
- **Prazo interno de cada hook:** 80% do `timeout` do `hooks.json`. Se o prazo chegar, o hook sai sem saída, o que equivale a permitir, exceto nas decisões da guarda, que hoje já terminam bem antes.

### 6.G Compatibilidade

- Na partida, sem processo extra:
  - a versão do Node (`process.version`);
  - a versão do Claude Code, quando o ambiente ou a entrada do hook a trouxer;
  - a versão da extensão do VS Code instalada pelo hadouken.
- Tudo é comparado com `compat` do `package.json` (Node ≥ 20, Claude Code ≥ 2.1.251).
- Fora do suportado, há um aviso único por combinação, com o que fazer.

### 6.H Conflito com outros plugins

- No SessionStart, no máximo uma vez a cada 24 h, gravado em `conflitos.json`:
  - a `statusLine` do usuário que não seja a do hadouken;
  - outros plugins habilitados com hooks em `PreToolUse` nos mesmos matchers que emitem decisão de permissão (lidos do `hooks.json` de cada plugin instalado);
  - hooks de outros plugins com p95 alto no `indice-hooks.json`.
- O aviso é único e só relata. Nada é desativado.

### 6.I Limpeza dos dados

- Fica dentro do coletor (§6.A), nunca num hook.
- **Tetos padrão:**
  - `historico.jsonl` com 5 MB: corta as linhas mais antigas;
  - `guarda-eventos.json` e eventos: o limite que já existe;
  - índices com 10 MB cada: reconstruídos se passarem;
  - quarentenas com 30 dias.
- O `venv` do aprendizado fica fora, porque é gerido pelo aprender.
- Total configurável. O `/hadouken:saude` mostra o tamanho e o teto.

### 6.J Resumo semanal de economia

- Uma vez por semana, no primeiro SessionStart da semana, a linha vai como contexto ao usuário e aparece também no `/hadouken:saude` e na janela do VS Code.
- **Conteúdo:**
  - contagens: despachos perguntados e negados pela guarda, rebaixamentos sugeridos e aceitos pelo roteamento, buscas desviadas para modelo barato;
  - **estimativa** de tokens poupados só onde houver base medida (os tokens médios do mesmo agente ou modelo na própria máquina, do `indice-transcripts`); sem base, só as contagens.
- O texto sempre traz "estimativa".

### 6.K Segurança, estabilidade e leveza

- **Revisão de segurança** de toda entrada nova: saída de `ps`, PowerShell e `nvidia-smi`, nomes de processo e `hooks.json` de outros plugins. Tudo é dado, saneado e com limite de tamanho. Nada disso vira instrução no contexto do Claude: só números e rótulos de uma lista fixa. Nomes de aplicativos só aparecem para o usuário, saneados.
- **Teste de entrada hostil** em todos os hooks: stdin vazio, JSON truncado, campos com tipos errados, texto gigante. Esperado: saída 0, sem saída ou com a decisão de hoje.
- **Orçamento de peso verificado em teste:**
  - tamanho do pacote do plugin sem `venv`, com um teto fixado após a medida;
  - número de módulos carregados por hook;
  - bench com as linhas novas: hook de prompt com `saude.json` presente e com o disparo do coletor.
- **Windows e Linux antes de cada push:** a suíte e os benches no WSL Ubuntu com Node 20 e 24. O macOS fica coberto pela CI.

## 7. Configuração (tabela de limites)

Itens novos, todos com padrão ligado e liga-desliga, na aba **Saúde**:

- `saude.ligado`
- `saude.ram.amarelo` (85) e `saude.ram.vermelho` (93)
- `saude.liberarProprios`
- `saude.gpu.max` (85), `saude.cpu.max` (90), `saude.bateria.min` (15) e `saude.disco.minGB` (5)
- `saude.tetoHooks` e `saude.tetoHooks.ms` (40)
- `saude.compat`
- `saude.conflitos`
- `saude.limpeza` e `saude.limpeza.mb`
- `saude.economia`

## 8. Critérios de aceite

1. Com `saude.json` presente e com o disparo do coletor, os hooks de prompt e de SessionStart continuam dentro do orçamento no bench, no Windows e no Linux.
2. Coletor travado ou lento não afeta nenhum hook (teste com coletor falso que dorme).
3. Arquivo de estado corrompido gera reparo e aviso único, e a sessão segue (teste por arquivo).
4. Parte opcional lenta desliga em 3 de 10, volta em 24 h, e a parte central nunca desliga (teste com relógio falso).
5. Nenhum processo fora da classe `hadouken` é encerrado (teste com lista falsa de processos).
6. Avisos aparecem uma vez por episódio (teste com várias mensagens seguidas).
7. Os fluxos de `/hadouken:saude`, `leve` e `normal` funcionam, junto com os itens da tabela, a janela e o `/hadouken:limites`.
8. Suíte verde no Windows e no Linux (Node 20 e 24) e CI verde, antes de pedir push.
9. Documentação: wiki (Saúde do PC), README curto, SECURITY (entradas novas) e notas da release.

## 9. Escolhas do Claude (para o Sr. Garioli conferir)

- Temperatura só onde dá para ler sem admin; no Windows, quase sempre "não disponível".
- O modo leve é orientação ao Claude, nunca bloqueio, e acaba sozinho em 4 h.
- Os aplicativos a fechar são só sugestão; o hadouken encerra apenas processos dele mesmo.
- As faixas padrão: RAM 85/93%, GPU 85 °C, CPU 90 °C, bateria 15%, disco 5 GB e orçamento de 40 ms por parte opcional.
- A economia semanal mostra só contagens quando não há base medida para estimar tokens.

## 9.1 Respostas à revisão do construtor (escolhas do Claude)

1. **`compat`:** é novo no `package.json`, `{ "node": ">=20", "claudeCode": "2.1.251" }`. Um teste confere que o `install.sh`, o `install.ps1` e o `engines.node` usam os mesmos valores. Passa a ser a fonte única.
2. **"Uma vez por episódio":**
   - O estado do episódio é **global**, em `saude-avisos.json` compartilhado entre sessões, chaveado por tipo e início do episódio. O aviso ao usuário sai uma vez no PC inteiro.
   - A linha de contexto ao Claude sai **uma vez por sessão e episódio**, porque cada sessão precisa saber; o registro fica em `saude-avisos.json`, por sessão.
   - Modo leve: a orientação vai no SessionStart de cada sessão e no prompt **só quando o modo muda** (liga, desliga ou expira). Nunca a cada prompt.
3. **Economia semanal (§6.J):** conta **só o que já é registrado hoje**. Da guarda, os eventos `disparo`, `negado`, `perguntado` e `troca-bloqueada` (`src/guarda/registros.js`). Do roteamento, o que o `src/roteamento/registro.js` grava e o `resumoRoteamento7d` já resume. Não entra evento novo na guarda. O que não tiver registro fica fora da linha.
4. **Orçamento de 40 ms:** medido depois do fato. A parte roda inteira; se estourou, conta para o 3 de 10 e é pulada nas próximas execuções. Sem interrupção no meio. O disparo do coletor (`stat` + `spawn` desanexado) conta como parte opcional.
5. **Processos do hadouken:**
   - O coletor e o aprender passam a gravar `pid`, `inicio` e `prazoMs` no próprio arquivo de trava. Isso é encanamento novo e faz parte do plano.
   - "Muito do prazo" é **3× o prazo** do processo.
   - Só encerra quando o pid da trava ainda existe **e** a linha de comando dele aponta para o script do hadouken correspondente.
6. **Canal do aviso ao usuário:** `systemMessage` do SessionStart e do UserPromptSubmit, que o `session-start.js` já usa, mais o segmento da barra enquanto durar e o item na janela do VS Code. Limite de 300 caracteres por aviso, no máximo um aviso por hook; se houver vários, sai o mais grave e os outros esperam o próximo.
7. **Prazo interno:** é um timer `unref` que sai com 0 e sem saída. Fica **só nos hooks que não decidem nada**: session-start, prompt-submit, session-end e statusline. Os hooks da guarda (`guarda-*`, `liberar`) ficam de fora e mantêm o comportamento de hoje.
8. **Teste no Linux:** já instalado (WSL Ubuntu 26.04, Node 20.20.2 e 24.22.2, com o script da sessão). O repositório tem git. "Antes de pedir push" quer dizer: suíte verde no Windows e no Linux sobre o commit, antes de pedir o push ao Sr. Garioli.

## 10. Fica para quem implementa

- O formato exato de `saude.json`, `tetos.json` e `conflitos.json`.
- Como identificar a versão do Claude Code sem processo extra; se não houver fonte barata, ela fica de fora do §6.G.
- As heurísticas de classe de processo por plataforma, com a lista em código, testada.
- A divisão em tarefas do plano.

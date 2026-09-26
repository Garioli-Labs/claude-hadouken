# claude-hadouken — Subprojeto A: Leitor de consumo (design)

- **Data:** 2026-09-25
- **Decisor:** Sr. Garioli (todas as decisões desta spec foram tomadas por ele na sessão de brainstorming de 2026-09-25)
- **Status:** aprovada pelo Sr. Garioli em 2026-09-25
- **Versão:** este subprojeto sai como v0.1.0; a v1.0.0 é o plugin completo (A + B + C + D), decisão do Sr. Garioli em 2026-09-25
- **Repo:** `Garioli-Labs/claude-hadouken` (público no GitHub); local `E:\Projetos DEV\claude-hadouken`

## 1. Contexto

`claude-hadouken` é um plugin do Claude Code que otimiza o consumo do Claude (tokens, modelo, effort, limites de sessão e semana) e do GitHub (Actions, cache, pushes) sem reduzir a qualidade da entrega. O plugin inteiro divide-se em quatro subprojetos, cada um com spec, plano e execução próprios:

| # | Subprojeto | Depende de |
|---|---|---|
| **A** | **Leitor de consumo** (esta spec) | — |
| B | Roteador: lançador dinâmico, agente principal fixo, agentes por modelo × effort, regras injetadas, checagem de divergência com o projeto | A |
| C | Planejador de sessão e semana a partir do plano do projeto | A, B |
| D | Guardas de GitHub (pushes, CI em mudança só de docs) e sugestões de melhoria | A |

A é a base: B precisa ler os limites para escolher modelo e effort; C precisa do custo medido por tarefa; D precisa dos números do GitHub.

## 2. Objetivo e critérios de sucesso

O Leitor de consumo mede, mostra e anuncia o consumo real, em qualquer projeto, a partir do momento em que o plugin está instalado.

Sucesso significa:

1. A barra de status mostra, em toda sessão, modelo·effort, janela de 5 h, janela de 7 dias com ritmo esperado e modo, contexto e acerto de cache da sessão.
2. O Claude recebe automaticamente uma linha de aviso quando a faixa de 5 h ou o modo semanal mudam, e nunca a mesma linha duas vezes na mesma faixa.
3. `/consumo` produz o relatório de limites, tokens por projeto e por modelo × effort, taxa de acerto de cache e números do GitHub por repo.
4. Nenhuma falha do plugin trava ou atrasa o Claude; todo dado ausente aparece como "indisponível" ou "sem leitura", nunca como zero.
5. As metas de performance da seção 9 são medidas e cumpridas.

## 3. Princípios (decisões do Sr. Garioli, 2026-09-25)

- **Qualidade antes da economia, para evitar retrabalho.** Economia corta volume, paralelismo e releitura; nunca corta testes, review, verificação nem o modelo e effort de implementação e review.
- **Objetivo semanal: ritmo linear, folga em qualidade.** Cada tarefa gasta o mínimo necessário; a folga em relação ao ritmo vai para qualidade (review extra, effort maior em spec e auditoria), nunca para volume.
- **Alertas:** avisar o Sr. Garioli (barra) e informar o Claude (contexto injetado).
- **Apresentação:** barra sempre visível + alertas + `/consumo`.
- **Linguagem:** Node, sem dependências de runtime.
- **Nunca presumir consumo:** dado ausente ou velho é dito como tal.

## 4. Fontes de dados

| Dado | Fonte | Estado |
|---|---|---|
| Janela de 5 h (% usado, reset) | JSON da statusline: `rate_limits.five_hour.used_percentage`, `rate_limits.five_hour.resets_at` (epoch Unix) | Documentado em code.claude.com/docs/en/statusline; verificação V1 |
| Janela de 7 dias | `rate_limits.seven_day.used_percentage`, `rate_limits.seven_day.resets_at` | Documentado; verificação V1 |
| Modelo e effort da sessão | Statusline: `model.display_name`, `effort` | Documentado; verificação V1 |
| Contexto e acerto de cache da sessão | Statusline: `context_window.used_percentage`, `prompt_cache.hit_ratio` (V1: `cost` não traz tokens acumulados; tokens por sessão vêm dos transcripts) | Verificado (V1, 2026-09-25) |
| Tokens por turno, modelo, effort | Transcripts `~/.claude/projects/<projeto>/*.jsonl`: `message.model`, `message.usage` (input, output, cache_read, cache_creation), `effort`, `perTurnEffort`, `cwd`, `sessionId`, `requestId`, `timestamp` | Verificado localmente em 2026-09-25 |
| Execuções do GitHub Actions | `gh api repos/<repo>/actions/runs` e `.../runs/<id>/jobs` | Verificado com o token atual (escopos `repo`, `read:org`) |
| Cache do Actions | `gh api repos/<repo>/actions/cache/usage` | Verificado |
| Minutos faturados da org | API de billing nova, exige escopo `admin:org` | Opcional; fora desta versão (seção 12) |

`rate_limits` só aparece depois da primeira resposta da API e só em contas Pro/Max ou atrás de gateway com limite de gasto.

## 5. Arquitetura

```
statusline (script do plugin) ── JSON oficial ──► desenha a barra ──► grava estado.json
                                                                        │
ritmo (puro): esperado = horas desde (resets_at − 7 d) ÷ 168 × 100      │
              modo = econômico | normal | folga                          │
                                                                        │
hook SessionStart ──► instala/atualiza o shim da statusline; injeta a linha de estado atual
hook UserPromptSubmit ◄── lê estado.json ── injeta 1 linha só quando faixa ou modo mudam
hook SessionEnd ──► anexa a última leitura da sessão a historico.jsonl
/consumo (skill) ──► relatorio ──┬── transcripts (tokens por projeto, sessão, modelo × effort, cache)
                                 └── github (execuções, minutos estimados, cache)
```

Todos os arquivos de estado ficam em `~/.claude/hadouken/`:

| Arquivo | Conteúdo | Escrito por |
|---|---|---|
| `estado.json` | Última leitura da statusline (ver 6.2) | statusline |
| `alertas.json` | Última faixa/modo anunciados, por janela | hook UserPromptSubmit |
| `historico.jsonl` | Uma linha por sessão encerrada | hook SessionEnd |
| `config.json` | Repos do GitHub a observar, limiares (opcional) | Sr. Garioli |
| `indice-transcripts.json` | Cache incremental do parser (ver 7.4) | transcripts |
| `github-cache.json` | Execuções já concluídas (imutáveis) | github |
| `bin/statusline.mjs` | Shim estável chamado pela statusline | hook SessionStart |

## 6. Unidades

Cada unidade é um módulo com um arquivo, uma responsabilidade e testes próprios. Nenhuma unidade lança exceção para fora: todas devolvem `{ ok: true, valor }` ou `{ ok: false, motivo }`.

### 6.1 `ritmo` (puro)

- Entrada: `{ usado7d, resetsAt7d, agora }`.
- `inicioJanela = resetsAt7d − 7 d`; `esperado = clamp(0, 100, (agora − inicioJanela) em horas ÷ 168 × 100)`.
- `desvio = usado7d − esperado`.
- `modo = "economico"` se `desvio > 10`; `"folga"` se `desvio < −10`; senão `"normal"`.
- Saída: `{ esperado, desvio, modo }`, com `esperado` e `desvio` arredondados a uma casa decimal.

### 6.2 `estado` (leitura e gravação do snapshot)

- Formato de `estado.json`:
  ```json
  {
    "versao": 1,
    "at": "2026-09-25T18:02:11Z",
    "five_hour": { "used_percentage": 42, "resets_at": 1790000000 },
    "seven_day": { "used_percentage": 48, "resets_at": 1790400000 },
    "sessoes": {
      "<session_id>": { "at": "...", "model": "Opus 5.5", "effort": "high", "cwd": "...", "context_pct": 31, "cache_hit": 0.975 }
    }
  }
  ```
- `rate_limits` são da conta, então vale a leitura mais recente de qualquer sessão; dados de sessão ficam separados por `session_id`.
- Gravação atômica: escreve em arquivo temporário no mesmo diretório e renomeia. No Windows, rename pode falhar com `EPERM`/`EBUSY` se outro processo estiver lendo: até 3 tentativas com 20 ms de intervalo; se todas falharem, desiste sem erro visível (a próxima atualização grava).
- Leitura: JSON inválido, versão desconhecida ou arquivo ausente → `{ ok: false, motivo }`.
- Sessões com `at` de mais de 24 h são removidas na gravação.
- **Dado velho:** `at` com mais de 1 h → leitores tratam como "sem leitura".

### 6.3 `alerta` (puro)

Entrada: estado lido, `alertas.json` anterior, `agora`. Saída: `{ linha | null, novoAlertas }`.

| Janela | Condição | Faixa | Linha injetada no Claude |
|---|---|---|---|
| 5 h | < 70 % | `ok` | (nada) |
| 5 h | ≥ 70 % | `atencao` | "5h em X% (reset HH:MM): atenção ao ritmo." |
| 5 h | ≥ 80 % | `serializar` | "5h em X%: serializar — sem Workflow nem subagentes em paralelo." |
| 5 h | ≥ 90 % | `fechar` | "5h em X%: fechar a tarefa em curso, não abrir etapa nova, agendar a volta para depois de HH:MM." |
| 7 d | modo `economico` | `economico` | "7d X% vs Y% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação." |
| 7 d | modo `folga` | `folga` | "7d X% vs Y% esperado → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume." |
| 7 d | ≥ 90 % e reset a mais de 24 h | `so-leitura` | "7d em X% com reset em <dia HH:MM>: só leitura; recomendar parar." |

- `so-leitura` tem prioridade sobre o modo semanal.
- Anuncia só quando a faixa muda em relação a `alertas.json` **dentro da mesma janela** (mesmo `resets_at`). Janela nova → estado de alerta zerado.
- Descida de faixa também é anunciada, uma vez ("5h voltou a X%: faixa normal").
- Estado ausente ou velho → uma única linha por sessão: "Consumo sem leitura: rode /usage."
- Horários exibidos no fuso local da máquina.

### 6.4 `statusline` (script)

- Lê o JSON oficial da entrada padrão, chama `ritmo`, grava `estado` e imprime uma linha:
  ```
  Opus 5.5·high │ 5h 42% ↻18:40 │ 7d 58%/41% econ ↻qui 22:00 │ ctx 31% │ cache 97%
  ```
- Cores ANSI por faixa: verde (`ok`/`normal`), amarelo (`atencao`/`economico`), vermelho (`serializar`/`fechar`/`so-leitura`). `folga` em verde com o rótulo `folga`.
- Campo ausente no JSON → o segmento mostra `—`; sem `rate_limits` → `5h —  7d —`.
- Nunca imprime stack trace; em erro interno imprime só o modelo, ou uma linha vazia.
- **Instalação:** a chave `statusLine` só pode ser definida no `settings.json` do usuário (o `settings.json` de plugin aceita apenas `agent` e `subagentStatusLine`). O caminho do plugin muda a cada versão, então a statusline aponta para o shim estável `~/.claude/hadouken/bin/statusline.mjs`, que o hook SessionStart mantém sincronizado com a versão instalada. A configuração de `statusLine` é feita pela skill `/claude-hadouken:instalar`, que mostra a alteração e pede confirmação antes de gravar. Se já existir uma `statusLine` diferente, ela é preservada: a skill mostra a atual e pergunta se deve substituí-la.

### 6.5 Hooks

| Hook | Faz | Tempo máximo |
|---|---|---|
| SessionStart | Sincroniza o shim; injeta a linha de estado atual (ou "sem leitura") | 200 ms |
| UserPromptSubmit | Roda `alerta`; injeta a linha só se houver mudança | 250 ms Windows / 150 ms Linux-macOS |
| SessionEnd | Anexa `{ at, session_id, cwd, model, effort, five_hour, seven_day }` a `historico.jsonl` | 200 ms |

Nenhum hook bloqueia o prompt nem retorna erro ao Claude. Qualquer falha termina com código 0 e saída vazia.

### 6.6 `transcripts` (parser)

- Varre `~/.claude/projects/*/*.jsonl` e os transcripts de subagentes nos subdiretórios.
- Lê linha a linha em streaming; linha inválida é contada e ignorada, nunca interrompe.
- **Deduplicação:** uma mesma resposta da API pode ocupar várias linhas (uma por bloco de conteúdo, campo `apiBlockIndex`) com o mesmo `usage`. Conta cada `requestId` (ou `message.id`, se faltar) uma única vez. Verificação V3.
- Agrega por período (hoje, 7 dias, janela semanal atual), projeto (a partir de `cwd`), sessão, modelo e effort.
- Métricas: tokens de entrada, saída, pensamento, cache lido, cache criado (1 h e 5 min); taxa de acerto de cache = `cache_read ÷ (input + cache_read + cache_creation)`.
- Projeto = nome da pasta de `cwd`; se `cwd` faltar, o nome do diretório do transcript.

### 6.7 `github`

- Repos observados: `config.json` → `repos: ["Garioli-Labs/resonance-pro", ...]`; se ausente, o `origin` do repo git do diretório atual.
- Por repo: execuções dos últimos 7 e 30 dias, por evento (`push`, `schedule`, `pull_request`, outros) e conclusão; minutos por sistema a partir dos jobs (rótulo do runner → Linux, Windows ou macOS); cache ocupado.
- **Minutos estimados:** soma das durações dos jobs, arredondando cada job para cima ao minuto inteiro, com o peso por sistema. Os pesos não entram no código antes da verificação V4 na documentação oficial do GitHub. Repos públicos são mostrados separadamente, pois não consomem o pool da org (também confirmado em V4).
- Execuções concluídas são imutáveis e ficam em `github-cache.json`; só execuções novas ou em andamento são buscadas de novo.
- Sem `gh`, sem login ou sem permissão → a seção do GitHub mostra "indisponível: <motivo>".
- Todas as chamadas passam `MSYS_NO_PATHCONV=1` e endpoints sem barra inicial (no Git Bash do Windows, um endpoint com `/` inicial vira caminho de arquivo — verificado em 2026-09-25).

### 6.8 `relatorio` e skill `/consumo`

- `/consumo` → markdown no chat, em três blocos:
  1. **Limites e ritmo:** "7d X% usado vs Y% esperado; reset <dia HH:MM>", janela de 5 h com reset, modo, idade da leitura.
  2. **Claude:** tabelas de tokens hoje e na semana por projeto e por modelo × effort; taxa de acerto de cache por projeto.
  3. **GitHub:** por repo, execuções 7 e 30 dias, minutos estimados por sistema, cache ocupado vs teto.
- `/consumo --json` → o mesmo conteúdo em JSON estável e versionado (`"versao": 1`), para B, C e D consumirem.
- Sem sugestões nesta versão.

## 7. Casos de borda

| # | Caso | Tratamento |
|---|---|---|
| 1 | Conta sem `rate_limits` (API key, plano sem limites) | Barra `5h — 7d —`; alertas desativados; `/consumo` diz "limites indisponíveis nesta conta" |
| 2 | Primeira atualização antes da primeira resposta da API | Mesmo que 1, até `rate_limits` aparecer |
| 3 | Várias sessões simultâneas | Limites da conta: vence a leitura mais recente; sessões separadas por `session_id`; gravação atômica |
| 4 | Snapshot com mais de 1 h | "sem leitura", nunca o valor antigo como atual |
| 5 | `resets_at` no passado (janela virou sem nova leitura) | Tratado como sem leitura; `alertas.json` zera ao chegar leitura da janela nova |
| 6 | `agora` antes do início da janela (relógio adiantado/atrasado) | `esperado` fica em 0–100 (clamp); desvio calculado normalmente |
| 7 | Transcript gigante ou corrompido | Streaming; linhas inválidas ignoradas e contadas; o relatório mostra quantas |
| 8 | Linhas duplicadas da mesma resposta | Deduplicação por `requestId` |
| 9 | Transcript apagado desde a última indexação | Removido do índice |
| 10 | `gh` ausente, deslogado, sem escopo ou com limite de API | Seção GitHub "indisponível: <motivo>"; o resto do relatório sai normal |
| 11 | `statusLine` já configurada pelo usuário | `/claude-hadouken:instalar` preserva e pergunta antes de substituir |
| 12 | Plugin atualizado (novo caminho) | SessionStart ressincroniza o shim |
| 13 | Caminhos com espaços e acentos (`E:\Projetos DEV\...`, `Lucas Garioli`) | Coberto por teste em Windows |
| 14 | Horário de verão ou fuso diferente | Cálculos em UTC; só a exibição usa o fuso local |
| 15 | Mesmo projeto aberto em worktrees diferentes | Projeto = nome da pasta; worktrees aparecem como projetos distintos (aceito nesta versão) |

## 8. Privacidade (repo público)

- Nenhum dado real vai para o repo: fixtures de teste são sintéticas (sem transcripts reais, caminhos pessoais, e-mails, nomes de clientes ou ids de sessão reais).
- O plugin só lê arquivos locais e o GitHub via `gh`; não envia nada a nenhum serviço.
- `~/.claude/hadouken/` fica fora de qualquer repo.

## 8.1 Segurança contra skills, plugins e conteúdo maliciosos (ordem do Sr. Garioli, 2026-09-25)

**Garantia:** o `claude-hadouken` nunca serve de vetor. Nenhum dado lido por ele (arquivos em `~/.claude/hadouken/`, transcripts, JSON da statusline, stdin dos hooks, respostas do GitHub, argumentos de skill) vira código executado, comando de shell, caminho de API arbitrário, sequência de terminal ou instrução com a autoridade do plugin no contexto do Claude.

**Limite honesto:** uma skill maliciosa que já executa código como o mesmo usuário do sistema pode alterar qualquer arquivo do usuário, inclusive o `settings.json` e o próprio plugin. Nenhum plugin impede isso. O que o plugin garante é não ampliar esse poder e desfazer adulterações dos seus próprios arquivos a cada sessão.

| # | Ameaça | Defesa |
|---|---|---|
| S1 | Arquivo de dados adulterado (`estado.json`, `alertas.json`, `config.json`, `historico.jsonl`, índices) para injetar texto no contexto do Claude via hook | Todo texto injetado é montado só com números finitos validados e rótulos de listas fixas do código; nenhum campo de texto lido de arquivo entra em linha injetada. Arquivo fora do schema = "sem leitura" |
| S2 | Texto malicioso em transcripts, nomes de projeto, modelo, effort, repos ou campos do GitHub exibidos no `/consumo` | Saneamento único (`sanear`): remove caracteres de controle e sequências ANSI/OSC, remove `|`, crases e quebras de linha, limita a 64 caracteres; effort aceito só de lista fixa; o relatório declara que é dado, não instrução |
| S3 | Sequências de terminal (ANSI/OSC, ex.: links ou títulos falsos) chegando à barra por `model.display_name` ou outros campos | `sanear` em todo texto externo antes de imprimir; as únicas sequências ANSI na barra são as cores fixas do próprio código |
| S4 | Injeção de shell pelos argumentos da skill `/claude-hadouken:consumo` | A skill não repassa `$ARGUMENTS`: roda o comando com `--json` somente se o argumento for exatamente `--json`; a CLI ignora qualquer outro argumento |
| S5 | Repo malicioso em `config.json` (ex.: `../../user`, argumentos extras) | Só aceita `dono/repo` casando `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, sem `..`; `gh` chamado por `execFile`, nunca por shell |
| S6 | Shim em `~/.claude/hadouken/bin/` adulterado para executar outro código | O hook SessionStart reescreve os shims a cada sessão a partir do conteúdo esperado; os shims não leem nada de fora |
| S7 | Instalador acionado por outra skill ou pelo modelo sem o usuário saber | `/claude-hadouken:instalar` tem `disable-model-invocation: true` e sempre pede confirmação explícita antes de gravar; só grava a chave `statusLine`, com backup |
| S8 | Cadeia de suprimentos | Zero dependências; CI com `permissions: contents: read` e actions fixadas por SHA |
| S9 | Arquivo gigante ou malformado para travar hook/barra | Leitura com limites de tamanho (arquivos de estado ≤ 1 MB, linha de transcript ≤ 5 MB ignorada acima disso), prazos nos hooks e saída sempre com código 0 |

Cada linha tem teste com entrada maliciosa sintética. A revisão final do branch inclui uma revisão de segurança dedicada.

## 8.2 Ativação só em sessões novas (ordem do Sr. Garioli, 2026-09-25)

Instalar o plugin não interfere em sessões já abertas nem nos agentes que rodam nelas. Sessões e agentes iniciados depois da instalação usam o plugin.

- **Registro de ativação:** o hook `SessionStart` do plugin (em toda origem: startup, resume, clear, compact) cria o arquivo `~/.claude/hadouken/ativas/<session_id>` (id validado; um arquivo por sessão, sem corrida entre sessões que abrem juntas). A barra e os hooks renovam a data do arquivo enquanto a sessão está em uso; arquivos parados há mais de 30 dias são podados. Só sessões que carregaram o plugin ao iniciar passam por esse hook.
- **Barra:** se o `session_id` do stdin não está no registro, o script da statusline imprime vazio, não grava nada e termina com código 0. Uma sessão antiga que recarregue o `settings.json` fica visualmente como estava (sem barra).
- **Hooks:** `UserPromptSubmit` e os demais só injetam contexto para sessões registradas. Se o Claude Code carregar hooks do plugin no meio de uma sessão antiga, eles ficam mudos.
- **Subagentes:** herdam o `session_id` da sessão-mãe, portanto seguem a regra dela: agentes lançados em sessão nova usam o plugin; agentes em sessão antiga, não.
- **Instalador:** grava só a chave `statusLine` (backup antes) e avisa que as sessões abertas não mudam; nada de reiniciar, matar processos ou editar arquivos de sessão.
- **Teste:** statusline e hook com `session_id` não registrado → saída vazia, nenhum arquivo gravado.

## 9. Performance (metas medidas, não assumidas)

| Operação | Meta | Como medir |
|---|---|---|
| statusline (início ao fim do processo) | p95 ≤ 250 ms no Windows e ≤ 150 ms no Linux/macOS (decisão do Sr. Garioli, 2026-09-25: só a partida do Node no Windows desta máquina leva 100–136 ms; a barra roda em segundo plano, sem travar nada) | 100 execuções com fixture sintética do tamanho real (`bench/statusline-p95.mjs`) |
| hook UserPromptSubmit | p95 ≤ 250 ms no Windows e ≤ 150 ms no Linux/macOS (decisão do Sr. Garioli, 2026-09-25) | idem |
| `/consumo` com 7 dias de transcripts, índice quente | ≤ 2 s | tempo de parede, volume desta máquina |
| `/consumo` com índice frio | ≤ 15 s | idem |
| GitHub, 3 repos, cache quente | ≤ 3 s | idem |

Se uma meta não for atingida, o plano registra o número medido e a decisão do Sr. Garioli antes de seguir.

## 10. Testes e CI

- `node:test` e `node:assert`, sem dependências.
- Funções puras (`ritmo`, `alerta`, agregações) com testes de tabela cobrindo todos os limiares e todos os casos de borda da seção 7.
- Unidades de I/O (`estado`, `transcripts`, `github`) testadas com fixtures sintéticas e diretório temporário; `gh` substituído por um executável falso nos testes.
- Teste ponta a ponta: JSON de statusline de exemplo → linha impressa + `estado.json` gravado → hook produz a linha de alerta esperada.
- CI no GitHub Actions: Linux, Windows e macOS a cada push (repo público: sem consumo do pool da org, confirmado em V4 antes de ligar a matriz a cada push).
- Toda fatia do plano passa por review antes do merge.

## 11. Verificações obrigatórias antes de codar

| # | O que verificar | Como |
|---|---|---|
| V1 | `rate_limits`, `effort` e `model` chegam de fato no JSON da statusline nesta conta | Statusline temporária que só grava a entrada em arquivo, instalada com confirmação do Sr. Garioli e removida depois |
| V2 | Hook SessionStart consegue ler `CLAUDE_PLUGIN_ROOT` (ou equivalente) para sincronizar o shim | Docs oficiais + teste com plugin mínimo |
| V3 | Formato de duplicação das linhas de uso nos transcripts (`requestId`, `apiBlockIndex`) | Amostra de transcripts reais, lida localmente; nada copiado para o repo |
| V4 | Pesos de minutos por sistema e isenção de repos públicos no GitHub Actions | Docs oficiais do GitHub, URL citada no plano |
| V5 | Formato de `additionalContext` aceito em UserPromptSubmit e SessionStart | Docs oficiais de hooks |

Resultado divergente em qualquer uma → esta spec é atualizada antes do plano.

## 12. Fora de escopo nesta versão

- Lançador, agente principal, agentes por modelo × effort, checagem de divergência com as regras do projeto (subprojeto B).
- Planejamento de sessão e semana a partir do plano do projeto (C).
- Guardas de push/CI e sugestões de melhoria (D).
- Minutos faturados da org via API de billing (exige `admin:org`).
- Qualquer troca automática de modelo ou effort (impossível no meio da sessão, segundo a documentação oficial).
- **v1.1 (pedido do Sr. Garioli, 2026-09-25): notificações no WhatsApp do usuário** — o Claude envia ao WhatsApp atualizações de push e de tarefas finalizadas. Ganha spec própria depois da v1.0; a spec decide o canal (API oficial WhatsApp Cloud da Meta, Twilio ou outro), a guarda da credencial (fora do repo, nunca em arquivo legível por skills sem necessidade), a opção de ativar por projeto e o conteúdo mínimo das mensagens (sem código, caminhos pessoais ou segredos: sai do computador).

## 13. Estrutura do repo

```
claude-hadouken/
  .claude-plugin/plugin.json        manifesto do plugin
  .claude-plugin/marketplace.json   marketplace de um plugin só
  hooks/hooks.json                  SessionStart, UserPromptSubmit, SessionEnd
  skills/consumo/SKILL.md           /claude-hadouken:consumo
  skills/instalar/SKILL.md          /claude-hadouken:instalar
  src/ritmo.js  src/estado.js  src/alerta.js  src/statusline.js
  src/transcripts.js  src/github.js  src/relatorio.js
  src/hooks/session-start.js  src/hooks/prompt-submit.js  src/hooks/session-end.js
  test/…                            um arquivo por unidade + ponta a ponta
  test/fixtures/…                   só dados sintéticos
  .github/workflows/ci.yml
  README.md  LICENSE                MIT (decisão do Sr. Garioli, 2026-09-25)
```

# claude-hadouken v0.3.0 — guardião de consumo: bloquear e perguntar (design)

Data: 2026-09-29. Base: `main` em `cea690a` (v0.2.0 publicada). Estado: proposta para aprovação do Sr. Garioli. As specs da v0.1.0 (`2026-09-25-leitor-de-consumo-design.md`) e da v0.2.0 (`2026-09-26-barra-bonita-design.md`) continuam valendo em tudo o que esta não muda.

Fontes:

- a pesquisa `.superpowers/sdd/pesquisa-sessoes-2026-09-29.md` (achados B1–B14, propostas 1–16, "NÃO FAZER" 1–11);
- a documentação oficial, baixada em 2026-09-29 de `code.claude.com/docs/en/`: `hooks`, `skills`, `statusline`, `plugins-reference`, `discover-plugins`, `sub-agents`, `headless`, `permission-modes` e `model-config`;
- o binário `claude.exe` 2.1.284 desta máquina, só com busca de texto (`grep -a`). Nada foi executado.

Convenções:

- As ordens do Sr. Garioli (§1.2) são requisito.
- Toda escolha além delas está marcada **PROPOSTA**.
- Capacidade da plataforma só entra com a evidência citada (§3).
- O que ainda falta confirmar na prática é um **spike** (§13). Cada spike tem critério de passa/falha e um plano B escrito antes. Nenhum spike grava valor de entrada de hook, só nomes de chave e booleanos.

## 1. Por que existe e o que precisa garantir

### 1.1 O incidente de 2026-09-28/29

O Sr. Garioli está no plano Max 20x. Em uma noite, uma sessão desacompanhada gastou mais da metade do limite semanal do Fable dele:

- A sessão despachou cerca de 16 subagentes revisores Fable com effort max, cada um com 60 a 170 chamadas e até 300 k de contexto por chamada.
- A sessão ignorou duas vezes o aviso de projeção do hadouken.
- A barra mostrava "7d 39%" com o Fable em 54%. O JSON da statusline só traz `rate_limits.five_hour` e `rate_limits.seven_day`; o limite próprio do Fable não chega ao plugin (§7).

Avisar não bastou: o modelo leu o aviso e seguiu. A v0.3.0 troca aviso por trava onde o gasto começa, que é o despacho de subagente e o uso do Fable.

### 1.2 Ordens do Sr. Garioli (requisitos)

1. "A função desse plugin é garantir que isso não aconteça mais em nenhum prompt passado, presente ou futuramente criado."
2. "Garanta ... que de fato tudo estará funcionando. Que erros como esse não se repitam. Otimização precisa ser a palavra chave do hadouken."
3. **Bloquear e perguntar.** Quando a projeção disser que uma janela acaba antes do reset, ou quando o uso passar de um teto que ele configura, o hadouken bloqueia despacho novo de subagente e uso do Fable. O Claude precisa parar e pedir a liberação a ele. O trabalho que já está rodando termina normalmente.
4. As ordens permanentes continuam valendo:
   - segurança em toda versão (modelo de ameaças, testes com fixture maliciosa, uma revisão de segurança Fable por release);
   - não atrapalhar sessões já abertas;
   - qualidade acima de economia;
   - zero rede: nenhum dado sai da máquina.
5. Pipa e WhatsApp passam para a v0.4.0.

### 1.3 Critérios de sucesso (todos medidos ou testados)

1. **Replay do incidente.** O teste roda uma fixture sintética modelada no incidente: 16 despachos Fable ao longo de uma noite e o 7d subindo 4 pontos por hora. Com os padrões desta spec, a guarda nega o despacho Fable de número 5 (G7, §5.2). Por projeção de 7d, ela nega qualquer despacho assim que houver 2 h de cobertura (G2). A sessão principal para (P1) e fica esperando o usuário.
2. **Nenhum despacho novo passa com a guarda disparada e sem liberação** numa sessão com os hooks da v0.3.0 carregados. Isso vale na thread principal e dentro de subagentes (testes de hook e roteiro manual).
3. **Só o usuário libera.** Não há liberação pela ferramenta Skill, por uma sessão `claude -p` filha, nem por Write/Edit na pasta de dados (testes de ameaça, §12). O que ainda escapa está listado como risco residual, com nome (§6.5).
4. **O trabalho em andamento termina.** Um subagente que já está rodando conclui e entrega o resultado (spike S5 e roteiro manual).
5. As metas de desempenho da §9 são cumpridas e medidas no bench.
6. Zero rede e nenhum texto de conversa gravado. Os arquivos novos guardam só números, horários, ids validados e rótulos fixos.
7. **Compatibilidade.** Hooks da v0.1.0 e da v0.2.0, em sessões abertas antes da atualização, continuam funcionando com os arquivos que a v0.3.0 grava (teste de compatibilidade, §14).
8. A regressão inteira passa em Windows, Linux e macOS com Node 20 e 24, e a revisão final de segurança Fable fecha sem achado aberto.

## 2. Fora de escopo

- Pipa e WhatsApp (v0.4.0).
- Trocar modelo ou effort sozinho. Isso é o "NÃO FAZER" 8, e os hooks nem podem: a guarda bloqueia e pergunta, e quem troca é o usuário.
- Ler o limite por modelo de fonte que não seja oficial e pública. Estão proibidos token OAuth, `/api/oauth/usage` e o pedido de controle `get_usage`, que não está documentado (§7).
- Agendador de volta ("NÃO FAZER" 1) e a skill `/claude-hadouken:volta` (proposta 5.2, subprojeto C).
- Políticas por projeto (15), custo de etapa (11), `subagentStatusLine` (12) e cota do GitHub Actions (16).
- Bloquear a thread principal que não está no Fable. A ordem bloqueia despacho e uso do Fable; a conversa principal em Opus ou Sonnet continua respondendo, só não despacha.
- Defender contra um processo do mesmo usuário que forje arquivos do plugin de propósito. É o limite honesto do `SECURITY.md`; aqui só há mitigação e aviso (§6.5).
- Uso fora do Claude Code desta máquina: claude.ai na web, app desktop, celular e outras máquinas. Esse consumo aparece nas leituras, mas não passa pelos hooks.
- Alterar ou desligar hooks de outros plugins ("NÃO FAZER" 9).

## 3. O que a plataforma permite (evidência)

Todas as citações vêm da documentação baixada em 2026-09-29 ou do binário 2.1.284. O status é **doc** (documentação), **bin** (texto no binário) ou **Sn** (spike pendente; o plano B está na §13).

| # | Capacidade | Evidência | Status |
|---|---|---|---|
| C1 | PreToolUse bloqueia chamada de ferramenta, com matcher no nome | hooks, tabela de eventos: "`PreToolUse` \| Before a tool call executes. Can block it". Seção PreToolUse: "Matches on any tool name ... built-in tools such as `Bash`, `PowerShell`, `Edit`, `Write`, ... `Agent`, `Workflow`, ..." | doc |
| C2 | `Task` virou `Agent` | sub-agents: "In version 2.1.63, the Task tool was renamed to Agent. Existing `Task(...)` references in settings and agent definitions still work as aliases." | doc |
| C3 | Formato da decisão | hooks, controle de decisão da PreToolUse: `hookSpecificOutput.permissionDecision` pode ser `allow`, `deny`, `ask` ou `defer`. `permissionDecisionReason`: "For `"ask"`, shown to the user but not Claude. For `"deny"`, shown to Claude". "When multiple PreToolUse hooks return different decisions, precedence is `deny` > `defer` > `ask` > `allow`." | doc |
| C4 | Hook que estoura o tempo não bloqueia | hooks, timeouts: "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call ... so don't count on a stalled hook to act as a gate." | doc |
| C5 | Parar o turno | hooks, campos universais: `continue` "If `false`, Claude stops processing entirely after the hook runs. Takes precedence over any event-specific decision fields". `stopReason`: "Message shown to the user when `continue` is `false`. It stays in the conversation, so Claude sees it if the conversation continues". O efeito em subagentes que rodam em segundo plano não está documentado. | doc + S5 |
| C6 | Entrada da ferramenta Agent | hooks, entrada do Agent: `prompt`, `description`, `subagent_type` e `model`, "Optional model alias to override the default" | doc |
| C7 | Modelo do subagente | sub-agents, ordem de resolução: (1) o parâmetro `model` da chamada; (2) o `model` do frontmatter, em que `inherit` quer dizer o da conversa principal; (3) `CLAUDE_CODE_SUBAGENT_MODEL`; (4) o modelo da conversa principal. Aliases: `sonnet`, `opus`, `haiku`, `fable`, id completo ou `inherit`. | doc |
| C8 | Hooks dentro de subagentes | hooks: "Hooks from settings files, managed policy settings, and plugins also run inside subagents". `agent_id`: "Present only when the hook fires inside a subagent call. Use this to distinguish subagent hook calls from main-thread calls." | doc + S1 |
| C9 | Modelo da sessão no hook | hooks: "Only `SessionStart` hooks can receive a `model` field, and Claude Code doesn't always include it. `PreModelSwitch` and `PostModelSwitch` hooks receive `from_model` and `to_model`". "There is no `$CLAUDE_MODEL` environment variable." | doc |
| C10 | Bloquear o prompt | hooks, UserPromptSubmit: `decision: "block"` "prevents the prompt from being processed and erases it from context". `reason`: "Shown to the user when `decision` is `"block"`. Not added to context". O timeout descarta a saída e o prompt segue. | doc |
| C11 | Comando digitado pelo usuário | hooks, UserPromptExpansion: "Runs when a user-typed command expands into a prompt". "typing `/skillname` directly bypasses `PreToolUse`. `UserPromptExpansion` fires on that direct path." "Matches on `command_name`." A entrada traz `command_name`, `command_args`, `command_source` e `prompt`. `decision: "block"` "prevents the command from expanding"; `reason` é mostrado ao usuário. | doc + S2 |
| C12 | Barrar troca de modelo | hooks, PreModelSwitch (v2.1.251+): "Can block the switch". Roda para `/model`, os seletores, `/config` e `set_model`, não para o fallback automático nem para a retomada ("Those changes reach PostModelSwitch only"). O matcher usa o nome canônico. "A PreModelSwitch hook that doesn't respond before its timeout blocks the switch." Fora do `/model` interativo, `"ask"` vira recusa. | doc |
| C13 | Limite do Fable atingido | hooks: StopFailure tem matcher `rate_limit` e "Output and exit code are ignored, except `terminalSequence`". No binário, a mensagem "You've reached your Fable limit." sai de `JBn(...)` e entra em `Zo({content:JBn(Le,Fe,...),error:"rate_limit",apiError:"model_requires_usage_credits",errorDetails:e.message})`, com `Fe` verdadeiro quando `rateLimitType==="seven_day_overage_included"`. O binário também tem "requires usage credits" e "now uses usage credits": depois do limite, o Fable pode seguir cobrando créditos de uso. | doc + bin + S4 |
| C14 | Canal só do usuário, só interativo | hooks, "Emit terminal notifications": `terminalSequence` aceita OSC 0/1/2 (título), OSC 9, 99 e 777 (notificação) e BEL. "Claude Code writes the sequence only in an interactive session, and only while its interface is on screen. In non-interactive mode with the `-p` flag and in the Agent SDK, it ignores the field." | doc + S3 |
| C15 | Skill que só o usuário chama | skills: `disable-model-invocation: true` impede o Claude de carregar a skill sozinho; só o usuário a invoca. Precedente no repo: `skills/instalar/SKILL.md` (S7). | doc |
| C16 | Caminho de bypass por `-p` | headless: "User-invoked skills and custom commands work" em `-p`, e `--bare` pula "hooks, skills, ... installed plugins". Uma sessão filha `claude -p` ou `claude --bare` escapa dos hooks da mãe. | doc |
| C17 | Filtro `if` no handler | hooks: é uma regra de permissão, "Only evaluated on tool events". Evita criar processo: "the `if` check would fail and `block-rm.sh` would never run, avoiding the process spawn overhead". Mas "Because the `if` filter is best-effort, use the permission system rather than a hook to enforce a hard allow or deny". | doc |
| C18 | Forma exec | hooks: com `args`, "spawned directly ... with no shell involved". "The `node` plus script-path pattern works on every platform because `node.exe` is a real binary." | doc |
| C19 | Plugin não entrega regra de permissão | plugins-reference: o `settings` do plugin tem "Only `agent` and `subagentStatusLine` take effect". Uma regra deny só vale nas configurações do usuário, e aí "Deny rules block in every mode, including `bypassPermissions`" (permission-modes). | doc |
| C20 | Sessões abertas ficam com a versão velha | discover-plugins: "The running session keeps the versions it already loaded. After an update, you see `Plugin updated: <name> · Run /reload-plugins to apply`, and the next session loads the new versions." | doc |
| C21 | Leituras da statusline | statusline: `rate_limits` tem `five_hour`, `seven_day` e `spend_limit`, "only after the first API response in the session". "Claude Code drops a window once its `resets_at` time passes." `refreshInterval` "re-runs your command every N seconds". "The event-driven triggers can go quiet when the main session is idle". A statusline também roda de novo quando uma janela chega ao `resets_at`. | doc + S7 |
| C22 | Limite por modelo | A statusline não tem campo por modelo (C21). O binário tem `seven_day_opus`, `seven_day_sonnet` e um esquema "Structured /usage data ... Experimental — the shape may change", com `rate_limits.model_scoped[].display_name` ("Server-supplied label for the model bucket (e.g. 'Fable')"). Esse esquema vem de `/api/oauth/usage` pelo pedido `get_usage` do SDK, que não está na documentação pública do SDK. **Não há fonte oficial segura** (§7). | doc + bin |
| C23 | `CLAUDE_CODE_ENTRYPOINT` | No binário, só `cli` é reescrito para `sdk-cli` no modo print; qualquer outro valor vem do ambiente. Dá para falsificar, então serve só como sinal auxiliar. | bin |
| C24 | Custo de retomar | hooks, SessionStart (v2.1.251+): com `source` `resume` ou `fork`, a entrada traz `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired` e `estimated_cache_write_usd`. | doc + S10 |
| C25 | Hooks em paralelo | hooks: "All matching hooks run in parallel." Outro plugin pode devolver `allow` ao mesmo tempo; a precedência de C3 garante que o `deny` do hadouken vence. | doc |

## 4. Mecânica da guarda

### 4.1 Estados

A guarda fica em um destes estados. Cada um aparece na barra (§8.3):

| Estado | Quando | Efeito |
|---|---|---|
| desligada | `guarda.ligada: false` no `config.json` (escolha dele) | nenhum bloqueio; a barra diz "guarda desligada" o tempo todo |
| sem leitura | nenhuma leitura de limite com até 24 h, ou só de janela já resetada | G1–G5 não disparam; G6 e G7 (locais) seguem valendo |
| armada | tudo abaixo dos tetos | nada bloqueia |
| disparada | há ao menos uma trava (§5.3) | bloqueia nos pontos P1–P5 |
| liberada | há uma liberação válida (§6) | os bloqueios ficam suspensos dentro do escopo da liberação |
| sem guarda nesta sessão | sessão sem os hooks da v0.3.0 (aberta antes da atualização, sem `/reload-plugins`) | nada bloqueia nessa sessão; a barra avisa (§11) |

### 4.2 Pontos de bloqueio

**P1: despacho de subagente.** Hook PreToolUse com matcher `Agent|Task|Workflow`. `Task` cobre versões anteriores à 2.1.63 (C2). Com a guarda disparada e sem liberação que cubra a trava, a decisão é `deny` para todo despacho novo, de qualquer modelo, como a ordem manda. A reação depende de onde o hook roda:

- **Thread principal** (entrada sem `agent_id`, C8): `deny`, com o motivo dirigido ao Claude (C3), mais `continue: false` e `stopReason` para o usuário (C5). O turno para, o usuário vê o motivo e o comando de liberação, e o Claude o vê quando a conversa seguir. **PROPOSTA** (D3), condicionada ao spike S5.
- **Dentro de subagente:** só `deny` com o motivo. O subagente termina a própria tarefa sem abrir netos.
- **Workflow:** mesmo tratamento, porque abre vários agentes.

**P2: uso do Fable na conversa principal.** É o hook UserPromptSubmit que já existe; não entra processo novo. O prompt é bloqueado com `decision: "block"` quando três coisas valem juntas:

- a guarda está disparada, ou há a trava Fable G6 ou G7;
- o modelo da sessão é Fable (§4.3);
- não há liberação que cubra a trava.

O `reason` vai só ao usuário (C10) e o prompt sai do contexto. O bloqueio não vale para:

- prompts que começam com `/claude-hadouken:`, para a liberação nunca travar a si mesma;
- turnos automáticos que entregam resultado de trabalho já em andamento, se o spike S6 mostrar como distingui-los. Se não der para distinguir, P2 não bloqueia turno automático nenhum; P1 e P3 continuam valendo.

**P3: troca para o Fable.** Hook novo PreModelSwitch com matcher `.*fable.*` (C12). Com a guarda disparada, a troca é barrada com `permissionDecision: "deny"`, e o motivo vai ao usuário. Como o matcher não cobre nome desconhecido (C12), o hook também confere `to_model` por conta própria. Trocar para longe do Fable nunca é barrado. **PROPOSTA:** usar `deny`, não `ask`. Um `ask` aceito no seletor seria um segundo caminho de liberação, fora do código e sem registro.

**P4 (PROPOSTA): sessão `claude` filha.** Dois handlers PreToolUse, porque o `if` aceita uma regra só (C17): `Bash` com `if: "Bash(claude *)"` e `PowerShell` com `if: "PowerShell(claude *)"`. Eles negam abrir `claude -p`, `claude --bare` ou `claude plugin ...` quando a guarda está disparada ou há um código de liberação pendente (§6). Isso fecha o bypass de C16 no caso comum. O `if` é best-effort (C17): `npx`, `node .../cli.js` e comandos ofuscados escapam, e isso fica declarado como R1.

**P5 (PROPOSTA): arquivos do plugin.** Um handler PreToolUse com matcher `Write|Edit|MultiEdit|NotebookEdit` e `if` na pasta de dados (`~/.claude/hadouken/**`) nega sempre, disparada ou não. As ferramentas de edição do Claude não têm motivo legítimo para gravar ali, e o usuário edita o `config.json` no editor dele.

- **PROPOSTA:** o instalador oferece, com confirmação, como já faz com a statusline, acrescentar a regra deny `Edit(~/.claude/hadouken/**)` ao `settings.json` do usuário. Uma regra de permissão vale em todo modo (C19), e o `if` é só best-effort.

**P6 (spike S8): skills com `context: fork` e `SendMessage`.** Se o subagente de uma skill `fork` não passar pela PreToolUse do `Agent`, o matcher de P1 ganha `Skill`, com checagem do frontmatter da skill feita só quando a guarda está disparada. `SendMessage` para um agente que ainda roda é correção de rumo de trabalho em andamento e **não é bloqueado**. Se ele reabre um agente já concluído, isso é trabalho novo que o hook não distingue: lacuna declarada (R6). Os despachos que esse agente fizer depois continuam caindo em P1.

Esboço do `hooks/hooks.json` (os três hooks atuais não mudam):

```json
"PreToolUse": [
  { "matcher": "Agent|Task|Workflow",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/guarda-despacho.js"], "timeout": 10 } ] },
  { "matcher": "Bash",
    "hooks": [ { "type": "command", "if": "Bash(claude *)", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/guarda-filha.js"], "timeout": 10 } ] },
  { "matcher": "PowerShell",
    "hooks": [ { "type": "command", "if": "PowerShell(claude *)", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/guarda-filha.js"], "timeout": 10 } ] },
  { "matcher": "Write|Edit|MultiEdit|NotebookEdit",
    "hooks": [ { "type": "command", "if": "Edit(~/.claude/hadouken/**)", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/guarda-arquivos.js"], "timeout": 10 } ] }
],
"UserPromptExpansion": [
  { "matcher": "(claude-hadouken:)?liberar",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/liberar.js"], "timeout": 10 } ] }
],
"PreModelSwitch": [
  { "matcher": ".*fable.*",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/guarda-modelo.js"], "timeout": 10 } ] }
],
"PostModelSwitch": [
  { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/modelo-trocado.js"], "timeout": 5 } ] }
],
"StopFailure": [
  { "matcher": "rate_limit",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/limite-atingido.js"], "timeout": 5 } ] }
]
```

Esboço, com estas observações:

- A sintaxe exata do `if` para caminho (`Edit(...)`, `~/`) é conferida no spike S9.
- Os hooks novos usam a forma exec (C18); os três antigos seguem em forma shell na v0.3.0, para não mudar comportamento já medido.
- **PROPOSTA:** timeout de 10 s nos hooks de bloqueio. Hook que estoura o tempo deixa o despacho passar (C4), e a pesquisa mediu SessionStart com p50 de 3,1 s sob contenção no startup (B5). Um timeout maior só atrasa no caso raro.

### 4.3 Como saber se é Fable

Para um **despacho**, a guarda segue a ordem de C7 e compara com a regex `/fable/i`:

1. `tool_input.model`, se veio;
2. senão, o `model` do frontmatter do agente `subagent_type`. A busca vai só em `<cwd>/.claude/agents/<nome>.md` e `~/.claude/agents/<nome>.md`, lendo no máximo 8 KiB, e só quando o dado importa (G6 ou G7 ativos). Os revisores do incidente, `fable-max` e `fable-xhigh`, são agentes do usuário e caem aqui;
3. `inherit` ou ausente: `CLAUDE_CODE_SUBAGENT_MODEL` do ambiente do hook, e depois o modelo da sessão;
4. nome com `:` (agente de outro plugin) ou tipo embutido sem modelo conhecido: "desconhecido". Não conta como Fable, e o `/consumo` mostra quantos houve.

Para a **sessão**:

1. `modelos.json`, arquivo novo gravado por SessionStart (`model`, quando vier) e por PostModelSwitch (`to_model`, qualquer origem, inclusive `auto` e `resume`);
2. senão, `estado.sessoes[id].model`, o `display_name` que a statusline já grava;
3. senão, desconhecido: P2 não bloqueia e a lacuna é declarada. Sem statusline não há leitura, e G1–G5 nem disparam.

### 4.4 O trabalho em andamento termina

- `deny` só afeta a chamada nova. Os subagentes que já rodam seguem; dentro deles, só os netos são negados.
- `continue: false` é usado só na thread principal. O spike S5 confirma que subagentes em segundo plano sobrevivem e entregam o resultado. Se não sobreviverem, P1 na thread principal vira só `deny` (D3, opção B).
- P2 não descarta a entrega de trabalho em andamento (S6).

### 4.5 Falhar de forma visível

- **Erro ao avaliar as condições** (exceção, entrada ilegível): o despacho passa (fail-open), a barra mostra "guarda com erro" e fica um evento em `guarda-eventos.json`. Hook que estoura o tempo também deixa passar (C4), e isso é risco residual R2.
- **Trava existente mas ilegível** (`guarda.json` corrompido): conta como disparada (fail-closed), com o motivo "estado da guarda ilegível". Só a liberação limpa. Apagar ou estragar a trava nunca solta a guarda.
- Os hooks nunca lançam para fora; como na v0.1/v0.2, saem com código 0 e JSON válido, ou em silêncio.

## 5. Condições de disparo

### 5.1 Leituras

- **Fresca:** leitura com até 1 h (`LIMITE_VELHO_MS`, como hoje).
- **Piso:** leitura com mais de 1 h e até 24 h, cujo `resets_at` ainda está no futuro. O uso só sobe dentro de uma janela, então o valor gravado é um mínimo. A barra e as linhas dizem "≥ N% (leitura de X h)" (proposta 1).
- **Sem leitura:** mais de 24 h, ou só janelas já resetadas. A statusline é a única fonte de leitura; sem a statusline do hadouken instalada, só G6 e G7 funcionam, e o `/consumo` diz isso.

### 5.2 Gatilhos

Os valores entre colchetes são padrões **PROPOSTA** (D1) e podem ser mudados no `config.json` (§5.4).

| Gatilho | Condição | Leitura exigida | Trava |
|---|---|---|---|
| G1, projeção de 5h | previsão de 100% antes do reset, daqui a no máximo [90 min]; reset a pelo menos [15 min] (B3) | fresca; regras de pontos da v0.2 (20 min de alcance, 3 pontos, 6 min de cobertura) | `five_hour` |
| G2, projeção de 7d | previsão de 100% antes do reset, daqui a no máximo [24 h] | fresca; cobertura de 2 h, pelo menos 10 pontos e 3 h de alcance (proposta 2, B1) | `seven_day` |
| G3, teto de 5h | 5h ≥ [90]% com o reset a pelo menos [15 min] | fresca ou piso | `five_hour` |
| G4, teto de 7d | 7d ≥ [85]% | fresca ou piso | `seven_day` |
| G5, acima do ritmo | 7d ≥ esperado linear + [20] pontos (o mesmo `calcularRitmo` de `ritmo.js`) | fresca ou piso | `seven_day` |
| G6, limite do Fable atingido | StopFailure `rate_limit` com a mensagem do Fable (C13), ou o plano B pelo fim do transcript (proposta 4, S4) | local | `fable` |
| G7, despachos Fable | o despacho Fable seria o [5º] em [5 h] corridas (D5) | local, contado pelo próprio P1 | `fable-despachos` |

Regras:

- **Sem horizonte, o G2 dispararia sempre.** No ritmo medido de 3 a 4 pontos por hora contra 0,6 sustentável (B6), quase toda sessão ativa projeta 100% antes do reset semanal. O horizonte de 24 h corta isso e ainda pega rajadas como a do incidente.
- **Travas `five_hour` e `seven_day`:** bloqueiam P1 (todo despacho), P2 e P3.
- **Travas `fable` e `fable-despachos`:** bloqueiam só o que é Fable, ou seja, P1 de despacho Fable, P2 e P3. Despacho em outro modelo segue.
- **G6 envolve dinheiro.** Depois do limite, o Fable pode passar a cobrar créditos de uso (C13). Uma liberação comum não solta G6; é preciso o escopo `fable`, dito de propósito (§6.2).

### 5.3 Trava (PROPOSTA, D2)

- Um gatilho que dispara grava a trava da janela dele em `guarda.json` (arquivo novo). A trava fica até uma de duas coisas: uma liberação válida que a cubra, ou o reset da janela (o `resets_at` passa).
- Se a condição some, a trava não cai sozinha: a projeção oscila, e a ordem é que o usuário decide.
- Ao fim de uma liberação, as condições são avaliadas de novo e voltam a travar se ainda valerem, perguntando outra vez.
- A trava é gravada só na transição, por quem avaliar primeiro: statusline, P1, P2 ou P3. Várias sessões gravam fundindo a união das travas, com renomeação atômica. Uma gravação perdida numa corrida volta na avaliação seguinte, porque a condição continua valendo.

Formato:

```json
{ "v": 1,
  "travas": {
    "five_hour": null,
    "seven_day": { "resets_at": 1791248400, "gatilho": "G2", "desde": "2026-09-29T05:54:00.000Z" },
    "fable": null,
    "fable-despachos": null } }
```

### 5.4 Tetos no `config.json`

A chave nova é `guarda`, no mesmo arquivo. Isso é compatível (§14): `reposValidos` da v0.1.0 e da v0.2.0 faz `if (!Object.hasOwn(v, 'repos')) return null;`, e o comentário diz "Outras chaves são ignoradas". Conferido nas tags `v0.1.0` e `v0.2.0`.

```json
{ "repos": ["dono/repo"],
  "guarda": {
    "ligada": true,
    "teto5h": 90, "horizonte5hMin": 90, "margemReset5hMin": 15,
    "teto7d": 85, "margemRitmo7d": 20, "horizonte7dH": 24,
    "fableDespachos": { "max": 4, "horas": 5 },
    "liberacao": { "padraoH": 2, "maxH": 24, "tetoPontos7d": 10 } } }
```

- Cada campo é um inteiro dentro de uma faixa fixa. Campo inválido usa o padrão e gera um aviso fixo ("config.json: guarda.teto7d inválido, usando 85").
- Arquivo ilegível: a guarda usa todos os padrões. Não desliga.
- Afrouxar os tetos com a guarda disparada não solta a trava. Só a liberação solta (T5).
- `ligada: false` é escolha explícita dele e aparece o tempo todo na barra.

### 5.5 Sem leitura, sem mentira

"Sem leitura" nunca quer dizer zero ("NÃO FAZER" 11):

- Com piso, a linha mostra o piso e a idade dele.
- Sem leitura nenhuma, a linha diz desde quando e qual foi o último modo conhecido (§10).
- A guarda sem leitura não dispara G1–G5, e diz isso na barra ("guarda sem leitura").

## 6. Liberação: só o usuário

### 6.1 Fluxo (PROPOSTA de mecanismo; a ordem pede só "liberação dele")

**Passo 1.** O usuário digita `/claude-hadouken:liberar` e pode acrescentar `2h`, `8h`, `janela` ou `fable`.

- A skill tem `disable-model-invocation: true` (C15), então o Claude não consegue carregá-la.
- O hook UserPromptExpansion, com matcher no nome do comando (C11), sempre bloqueia a expansão. Nenhum texto da skill chega ao Claude.
- O hook gera um código de 8 caracteres em base32 Crockford (40 bits, de `crypto.randomBytes`), mostrado como `XXXX-XXXX`.
- Em `codigo-liberacao.json` (arquivo novo) grava só:
  - o hash scrypt do código (N = 2^14, r = 8, p = 1, 16 MiB de memória) e o sal;
  - o `session_id` que pediu;
  - o escopo pedido;
  - o horário de validade, 10 min à frente;
  - o contador de tentativas.
- Um pedido novo substitui o anterior.
- O código só sai por `terminalSequence` (C14): OSC 9 e 777 como notificação, e o título da janela (OSC 2) como apoio, conforme o spike S3.
- O `reason`, que o usuário vê, diz: "hadouken: código de liberação na notificação ou no título do terminal, vale 10 min. Digite /claude-hadouken:liberar <código>." O código nunca aparece em `reason`, `additionalContext`, `systemMessage` nem `stopReason`.

**Passo 2.** O usuário digita `/claude-hadouken:liberar XXXX-XXXX`. O hook confere:

- mesmo `session_id` do pedido;
- dentro da validade;
- no máximo 5 tentativas; na quinta errada, o código é apagado;
- comparação com `crypto.timingSafeEqual`.

Se passar, o hook:

- grava `liberacao.json`;
- apaga o código;
- limpa as travas cobertas;
- registra o evento;
- restaura o título com OSC 2;
- bloqueia a expansão, de novo sem texto ao Claude, com o `reason` "hadouken: liberado até 16:40 (ou +10 pontos de 7d)."

No prompt seguinte, o UserPromptSubmit injeta uma vez uma linha só de números (§8.2), para o Claude saber que pode retomar.

**Corpo da skill (inerte).** O corpo só chega ao Claude se os hooks da v0.3.0 não rodaram. O texto é: "O hook de liberação do hadouken não rodou nesta sessão: nada foi liberado. Diga ao usuário para reiniciar a sessão ou rodar /reload-plugins. Não crie, não edite e não apague arquivos do hadouken."

**Sessão não interativa.** Se `CLAUDE_CODE_ENTRYPOINT` indicar SDK ou print (C23), o passo 1 recusa sem gerar código. Esse sinal pode ser falsificado; a defesa principal é C14.

### 6.2 Escopo e validade (padrões PROPOSTA, D4)

| Escopo | Validade | Solta |
|---|---|---|
| sem argumento ou `2h` | 2 h | `five_hour`, `seven_day`, `fable-despachos` |
| `Nh` (N de 1 a 24) | N h | as mesmas |
| `janela` | até o reset da janela que travou, com no máximo 24 h | as mesmas |
| `fable` | 2 h | também `fable` (G6), com o aviso "pode consumir créditos de uso" |

Toda liberação acaba antes do prazo quando o 7d sobe [10] pontos acima do valor do momento da liberação. É um teto de gasto, não só de tempo.

- A liberação é global: vale para todas as sessões, porque o limite é da conta.
- A barra mostra a liberação ativa com o prazo e a origem (pedida às HH:MM, com o horário no mesmo formato de §10).
- Liberação antecipada, antes de qualquer disparo, é permitida pelo mesmo fluxo, para quem já sabe que vai rodar uma revisão pesada.

### 6.3 Por que o modelo não libera

| Caminho | Por que falha |
|---|---|
| Carregar a skill pela ferramenta Skill | `disable-model-invocation: true` (C15) |
| `claude -p "/claude-hadouken:liberar"` numa sessão filha | o código só sai por `terminalSequence`, que é ignorado em `-p` e no SDK (C14); P4 nega `claude *` com a guarda disparada ou código pendente; o código fica preso à sessão que o pediu |
| Adivinhar o código pelo hook | 40 bits, 5 tentativas, 10 min |
| Ler `codigo-liberacao.json` e quebrar o hash fora do hook | scrypt a cerca de 30–50 ms por tentativa × 2^40 não cabe em 10 min |
| Gravar `liberacao.json` pelas ferramentas Write/Edit | P5; e, se o usuário aceitar, a regra deny nas configurações dele (C19) |
| Afrouxar o `config.json` | a trava não cai por mudança de config (§5.4) |

### 6.4 Arquivos da liberação

`liberacao.json`:

```json
{ "v": 1, "id": "b3f0c2d1", "criadaEm": "2026-09-29T14:40:00.000Z", "ate": "2026-09-29T16:40:00.000Z",
  "escopo": "horas", "solta": ["five_hour", "seven_day", "fable-despachos"],
  "base7d": 84, "tetoPontos7d": 10, "janelaResetsAt": null, "sessao": "<id validado>" }
```

`codigo-liberacao.json`:

```json
{ "v": 1, "hash": "<hex>", "sal": "<hex>", "sessao": "<id validado>", "escopo": "2h", "validoAte": "…", "tentativas": 0 }
```

Os dois passam por validação estrita, com teto de bytes e `lstat` (sem link simbólico). Arquivo inválido quer dizer "sem liberação".

### 6.5 Risco residual (declarado, sem maquiagem)

- **R1, forja pelo shell.** Um modelo decidido a burlar pode gravar `liberacao.json`, apagar `guarda.json` ou desligar a guarda no `config.json` por Bash, PowerShell ou `node -e`. Também pode desativar o plugin. Um processo do mesmo usuário escreve onde o usuário escreve, que é o limite honesto do `SECURITY.md`. Mitigações:
  - P4 e P5;
  - o texto do bloqueio proíbe isso explicitamente;
  - a barra mostra toda liberação, com prazo e origem, e diz "guarda desligada" quando for o caso;
  - `guarda-eventos.json` registra cada liberação feita pelo fluxo; uma liberação sem evento correspondente aparece na barra como "liberação sem origem". Os dois arquivos também podem ser forjados; isso não é prova, é sinal visível.
- **R2, timeout.** Hook que estoura o tempo deixa o despacho passar (C4). Mitigações: caminho rápido medido (§9) e timeout de 10 s.
- **R3, sessões sem guarda.** Continuam desprotegidas as sessões:
  - com hooks antigos;
  - `--bare` ou com plugins desligados;
  - de outras máquinas, do claude.ai e do app desktop.

  A barra diz "sem guarda nesta sessão" onde ela consegue rodar (§11).
- **R4, título legível.** O título da janela pode ser lido por outro processo do mesmo usuário (no Windows, `MainWindowTitle`). Por isso o título é só apoio da notificação. O código vale 10 min, uma vez só e numa sessão só.
- **R5, limite do Fable invisível.** A guarda não prevê o limite semanal do Fable (§7). Ela só trava depois que ele é atingido (G6) e pela contagem de despachos (G7).
- **R6, subagente reaberto.** `SendMessage` que reabre um agente concluído (S8).

## 7. A lacuna por modelo (Fable)

- **O que existe.** A statusline oficial não traz o limite por modelo (C21). A única fonte do limite semanal do Fable que o binário conhece é a experimental `model_scoped` de `/api/oauth/usage`, pelo `get_usage` do SDK, que não está documentado (C22).
- **O que a v0.3.0 faz com isso.**
  1. Não usa essa fonte. Ela exige endpoint privado ou OAuth, proibidos pela ordem e pelo `SECURITY.md`.
  2. Diz a lacuna em voz alta:
     - numa sessão Fable, a barra mostra "Fable: sem leitura oficial";
     - o `/consumo` explica que o limite do Fable não chega ao plugin e que a porcentagem de 7d da barra não é a do Fable;
     - o README diz o mesmo.
  3. Cobre o que dá para cobrir localmente. G6 trava depois que o limite é atingido, o que evita as 30 tentativas inúteis e a parada de 13,5 h de B8. G7 conta os despachos Fable (D5), o que teria cortado o incidente no quinto revisor.
  4. Revisa a lacuna a cada release. Se a documentação pública passar a trazer o campo, a v0.x seguinte o adota, pela statusline ou por um campo documentado.
- **PROPOSTA opcional (D5, opção C):** leitura digitada pelo usuário. O usuário copia a porcentagem do Fable que vê em `/usage` para `/claude-hadouken:fable 54`, uma skill só do usuário tratada no UserPromptExpansion. O valor vira piso com idade, como em §5.1, e pode alimentar um teto Fable. Fica fora da recomendação: depende de disciplina manual, e o piso envelhece.

## 8. Mensagens

### 8.1 Regras

1. **Texto fixo e números.** Todo texto ao Claude sai de modelos fixos, preenchidos só com números validados, horários formatados (§10) e rótulos do código. Nenhum texto lido de arquivo, transcript ou entrada é repetido (S1 e S2 da v0.1).
2. **Não passar por cima do usuário.** O bloqueio é a decisão dele, pela ordem. O texto nunca manda mudar o plano; manda parar e perguntar. O aviso de projeção da v0.2 ganha a frase "se isso conflitar com uma decisão explícita do usuário, pergunte antes de mudar o plano" (proposta 2, B1).
3. **Nada injetado em subagente.** A guarda não usa `additionalContext` dentro de subagente e não usa SubagentStart. O `deny` dentro de subagente é só o resultado da própria chamada dele. O SessionStart:compact dentro de subagente fica mudo (proposta 3, B4). A detecção é por `agent_id`, confirmada no spike S1; na falta dele, `transcript_path` com `/subagents/` ou `\subagents\`.
4. **Uma linha, sem repetir.** Cada motivo sai uma vez por disparo e por sessão na thread principal. O `deny` de P1 repete o motivo a cada tentativa, porque é a resposta da ferramenta.

### 8.2 Textos (modelos fixos; os números são exemplos)

- **Motivos**, um por trava, com o horário no formato de §10:
  - "7d chega a 100% amanhã 13:30, antes do reset seg 05/10 22:00"
  - "5h chega a 100% às 14:40, antes do reset das 15:30"
  - "7d em 86%, teto 85%"
  - "7d em 64% contra 40% esperado, margem 20"
  - "7d ≥ 86% (leitura de 3 h)"
  - "limite do Fable atingido hoje 02:10"
  - "5 despachos Fable em 5 h, teto 4"
- **P1, thread principal, `permissionDecisionReason` (vai ao Claude):** "hadouken: guarda ativa: {motivo}. Despacho de subagente bloqueado. Pare e pergunte ao usuário se ele libera; só ele libera, digitando /claude-hadouken:liberar. Não mude o plano dele por conta própria, não repita o despacho e não mexa nos arquivos do hadouken."
- **P1, `stopReason` (vai ao usuário e fica na conversa):** "hadouken parou o turno: {motivo}. Para seguir, digite /claude-hadouken:liberar."
- **P1 dentro de subagente:** "hadouken: guarda ativa: {motivo}. Novo despacho bloqueado. Termine sua tarefa sem abrir subagentes e relate o bloqueio."
- **P2, `reason` (só ao usuário):** "hadouken: guarda ativa: {motivo}. Esta sessão está no Fable. Troque com /model ou libere com /claude-hadouken:liberar."
- **P3, motivo (só ao usuário):** "hadouken: guarda ativa: {motivo}. Troca para o Fable bloqueada; libere com /claude-hadouken:liberar."
- **P4 e P5, motivo (vai ao Claude):** "hadouken: bloqueado: sessões claude filhas ficam fechadas com a guarda ativa" ou "hadouken: bloqueado: arquivos do hadouken só o usuário edita."
- **Depois da liberação, uma vez só, no prompt seguinte (vai ao Claude):** "hadouken: o usuário liberou a guarda até 16:40 ou até 7d 94%."

### 8.3 Barra (PROPOSTA de texto; o layout da v0.2 não muda)

A barra ganha um segmento que só aparece quando há algo a dizer:

- "guarda: 7d" (disparada, com a janela ou "Fable");
- "liberada até 16:40";
- "guarda desligada";
- "guarda sem leitura";
- "guarda com erro";
- "sem guarda nesta sessão";
- numa sessão Fable, "Fable 3/4 em 5h · sem leitura oficial".

Com a guarda armada e tudo bem, o segmento não aparece. Todo texto passa por `sanear` (S3).

## 9. Otimização e desempenho

### 9.1 Metas (medidas no bench, pior caso: histórico de 90 pontos, 50 sessões, `config.json` com `guarda`, liberação ativa, 200 eventos, busca de frontmatter)

| Caminho | Meta p95 | Como mede |
|---|---|---|
| PreToolUse `Agent\|Task\|Workflow` (P1), armada ou disparada | ≤ 250 ms no Windows, ≤ 150 ms no Linux e no macOS (mesma régua da v0.1/v0.2) | `bench/hooks-p95.mjs`, com casos novos |
| PreModelSwitch e UserPromptExpansion | as mesmas | idem |
| UserPromptExpansion no passo 2 (scrypt) | ≤ 400 ms no Windows (raro, só na liberação) | idem |
| UserPromptSubmit (P2 e linha de liberação) | nenhum processo novo; diferença A/B de p95 ≤ +3 ms contra a v0.2.0 | `bench/ab-raizes.mjs` |
| Statusline (avaliação e trava) | as metas da v0.2 inalteradas; diferença A/B ≤ +5 ms | `bench/statusline-p95.mjs` |
| `/consumo` com as seções novas | quente ≤ 2 s, frio ≤ 15 s (inalterado) | `bench/consumo.mjs` |

### 9.2 Custo por caminho

- **P1** só roda nas ferramentas do matcher. Despacho é raro: o incidente teve 16 numa noite, ou seja, ≤ 4 s de hook contra horas de subagente.
- **P1, caminho rápido:**
  - gate de ativação (um `lstat`, ~23 µs medidos na v0.2);
  - `guarda.json`, `liberacao.json`, `config.json` e `estado.json` (os quatro já com teto de bytes);
  - avaliação pura (regressão de até 90 pontos).
- **P1, frontmatter:** só com G6 ou G7 ligados e sem `model` na chamada. Até 2 arquivos, 8 KiB cada.
- **P4 e P5:** o `if` evita criar processo fora dos casos alvo (C17). Em uso normal, nunca rodam.
- **P2 no caminho do prompt:**
  - o `estado.json` e a previsão já são lidos e calculados hoje, e o modelo da sessão já está em `estado.sessoes`;
  - sessão fora do Fable: só a leitura pequena de `liberacao.json` para a linha pós-liberação;
  - sessão Fable: mais `guarda.json` e `config.json`.
- **PostModelSwitch** só roda em troca de modelo, que é rara. **StopFailure** só roda em erro de API.
- **Sem `refreshInterval` enquanto o spike S7 não passar** (§10, item 8). Com ele, o custo é 1 processo Node por minuto por terminal, cerca de 135 ms no bench (a pesquisa mede mais em uso real, B5). Esse número vai para a documentação com a opção.

### 9.3 O que a guarda economiza (estimativa, dita como tal)

- **Pelo próprio incidente:** mais de 50% da semana do Fable em cerca de 16 revisores dá cerca de 3 pontos da semana Fable por revisor. Com G7 no padrão, os revisores 5 a 16 teriam pedido liberação: cerca de 36 pontos Fable poupados, se ele não liberasse.
- **Pela calibração agregada de B10** (um ponto de 7d ≈ 0,53 M de cache_creation + 21,5 M de cache_read): um revisor de 60 a 170 chamadas com contexto médio de ~150 k lê de 9 M a 25 M de cache, cerca de 0,4 a 1,2 ponto do 7d agregado por revisor.
- Os números são ordem de grandeza, porque a calibração é da mistura de modelos da conta. O `/consumo` passa a mostrar, por semana, os despachos negados e os prompts bloqueados. A economia real é medida, não assumida.

### 9.4 `/consumo`: o custo do próprio hadouken (proposta 10)

Seção nova, lida dos transcripts que o `/consumo` já varre, só com tamanhos e durações:

- por plugin, o hadouken incluído: injeções, caracteres injetados, p50 e p95 da duração dos hooks, compactações por sessão e por subagente;
- nunca guarda nem mostra o texto injetado ou o stdout de hook;
- identifica o plugin pelo nome da pasta, sem o caminho;
- não sugere desligar nada.

Mais a seção "Guarda (7 dias)", tirada de `guarda-eventos.json`:

- disparos por gatilho;
- despachos negados;
- prompts e trocas bloqueados;
- liberações, com escopo e prazo;
- despachos de modelo desconhecido.

## 10. Correções da v0.2.x incluídas

Todas as propostas v0.2.x da pesquisa, mais as correções do pedido:

| # | Correção | Onde | Teste |
|---|---|---|---|
| 1 | Leitura velha vira piso (proposta 1). Janela com mais de 1 h e até 24 h, com `resets_at` no futuro, vira "≥ N% (leitura de X h)" e a faixa é avaliada com o piso. `LINHA_SEM_LEITURA` sai; entra "Consumo sem leitura nova desde {quando}; trate como o último modo conhecido ({modo})", ou, sem histórico, "Consumo ainda sem leitura nesta máquina.". Nunca "sem leitura" e uma faixa no mesmo prompt | `estado.js` (`limitesValidos` ganha a idade), `alerta.js`, `hooks/linha-estado.js` | relógio fixo nas idades 59 min, 61 min, 23 h e 25 h; reset passado; dedupe |
| 2 | `COBERTURA_MIN_MS` por janela (proposta 2): 5h fica com 6 min e 3 pontos; 7d passa a 2 h e 10 pontos. O aviso de projeção ganha a frase de §8.1, regra 2 | `previsao.js`, `alerta.js` | a fixture de B1 (26 min) não projeta; 2 h projeta |
| 3 | SessionStart:compact mudo em subagente (proposta 3) | `hooks/session-start.js` | entrada com `agent_id`; caminho com `/subagents/` e `\subagents\` |
| 4 | Linha "fechar" com o reset exato e `/rate-limit-options`; se houver cron, o minuto sugerido é reset + 2 min (proposta 5.1) | `alerta.js` | texto fixo |
| 5 | Linhas de 5h cientes do reset (proposta 6): "atenção" e "serializar" dizem "reset em N min"; com menos de 15 min, "reset em N min: sem mudança de ritmo"; "fechar" continua valendo | `alerta.js` | 14 min (B3), 16 min |
| 6 | Número concreto na linha econômica (proposta 7): "ritmo 3,3 pt/h, sustentável 0,6 pt/h; nesse ritmo acaba {quando}". Sem as 2 h de cobertura, a parte do ritmo não aparece | `alerta.js`, `ritmo.js` | com e sem cobertura |
| 7 | **Dia da semana ambíguo:** todo horário de 7d (previsão, reset, piso, eventos) passa a ser "hoje 13:31", "amanhã 13:31", "ontem 23:50" ou "qui 02/10 13:31" (dia da semana e data). Nunca só o dia da semana. `diaHora` dá lugar a `quandoLocal(epochS, agoraMs)` | `util.js`, `alerta.js`, `formato.js`, `relatorio.js` | virada de dia, mesmo dia da semana 7 dias à frente, fuso, sem ICU (`sem-icu.test.js`) |
| 8 | **`refreshInterval: 60` como padrão do instalador** (proposta 8), com confirmação, só depois de o spike S7 passar e com a regra de frescor: valores iguais com o mesmo `resets_at` não renovam `at` e não acrescentam ponto ao histórico. Hoje `atualizarEstado` carimba `at: agoraIso` em toda janela que entra (`else novas[k] = nova === null ? null : { ...nova, at: agoraIso };`). Com o timer, um stdin parado pareceria leitura fresca para `mantemGuardada` e `limitesValidos`, e pontos planos repetidos puxariam a inclinação para baixo | `estado.js`, `skills/instalar`, `configuracao.js` | teste: o mesmo stdin repetido 60 vezes em 60 min não renova `at` e não cria ponto; valor novo renova |
| 9 | Tabela de latência real no README e no bench (proposta 9) | README, `bench/` | docs |
| 10 | Seção de custo dos hooks no `/consumo` (proposta 10, §9.4) | `relatorio.js`, `transcripts.js` | fixture com injeções de 3 plugins; texto injetado ausente da saída |
| 11 | **PROPOSTA:** custo ao retomar sessão parada (proposta 13): uma linha ao usuário por `systemMessage` no SessionStart `resume` com cache expirado, "retomar reescreve ~182 k tokens de cache". Condicionada ao spike S10 | `hooks/session-start.js` | fixture com os 4 campos (C24) |

Consequência do item 8: sem `refreshInterval`, a regra de frescor não muda nada do que acontece hoje, porque cada execução da statusline vem de um evento. Por isso ela entra na v0.3.0 mesmo que o spike S7 reprove a adoção.

## 11. Passado, presente e futuro

A garantia está no **ponto de despacho**, não no texto do prompt. Por isso ela vale para qualquer prompt, plano, skill ou cron, escrito antes ou depois, desde que rode numa sessão com os hooks da v0.3.0 carregados. O que a plataforma permite, sessão por sessão:

| Sessão | O que vale | Por quê |
|---|---|---|
| Aberta antes da atualização, sem `/reload-plugins` | **sem guarda.** Seguem os hooks v0.2; a barra mostra "sem guarda nesta sessão" assim que a statusline v0.3 rodar nela | A sessão aberta fica com a versão que carregou (C20). O hadouken nunca recarrega plugins nem reinicia sessões sozinho (não atrapalhar sessões abertas) |
| Aberta antes, com `/reload-plugins` feito pelo usuário | guarda ativa a partir do próximo hook, se a sessão estava registrada no gate de ativação da v0.2 | A marca `guarda-sessoes/<hex id>` é gravada pelo primeiro hook v0.3 que roda. O gate continua mandando: sessão não registrada (aberta antes da própria instalação) fica como está e a barra diz "reinicie" |
| Aberta depois da atualização | guarda ativa desde o SessionStart | registro e marca no SessionStart |
| Futuras | idem | idem |
| Cron ou loop criados no passado | guardados se a sessão onde disparam tem os hooks v0.3 | o gatilho é P1/P2/P3, na hora do disparo |
| `--bare`, plugins desligados, outra máquina, claude.ai, app desktop | **sem guarda** (R3) | C16; fora do Claude Code desta máquina |

A mensagem de atualização do README e do CHANGELOG diz, com todas as letras: "sessões abertas só ganham a guarda depois de /reload-plugins ou de reiniciar".

A statusline passa a rodar o código v0.3 em sessões antigas no próximo SessionStart de qualquer sessão, pelos shims (comportamento da v0.2). Por isso ela precisa distinguir "sem guarda nesta sessão", pela marca, de "guarda armada".

## 12. Modelo de ameaças

Continua a numeração do `SECURITY.md`.

| # | Ameaça | Defesa | Teste |
|---|---|---|---|
| S10 | O modelo carrega `/claude-hadouken:liberar` pela ferramenta Skill | `disable-model-invocation: true`; corpo inerte; toda liberação acontece no hook, nunca no corpo | teste de frontmatter (como o de S7); o corpo não tem instrução de gravar |
| S11 | O modelo roda `claude -p "/claude-hadouken:liberar"` para obter o código | código só por `terminalSequence` (C14); recusa por `CLAUDE_CODE_ENTRYPOINT` (auxiliar); P4 nega `claude *` com a guarda disparada ou código pendente; código preso à sessão | unidade: o código nunca aparece em `reason`, `additionalContext`, `systemMessage` nem `stopReason`, e só aparece em `terminalSequence`; hook com entrypoint `sdk-cli` recusa; P4 nega com e sem pendência |
| S12 | Adivinhar ou quebrar o código | 40 bits; 5 tentativas; 10 min; scrypt; `timingSafeEqual`; uso único; sessão fixa | sexta tentativa recusada; código expirado; código de outra sessão; reuso após sucesso |
| S13 | Forjar `liberacao.json` ou apagar `guarda.json` por Write/Edit | P5 (`deny` sempre); regra deny opcional nas configurações do usuário (C19) | hook nega caminhos da pasta de dados, inclusive variações (maiúsculas, `..`, `\`, nome curto 8.3 do Windows) |
| S14 | Forjar pelo shell (R1) | limite honesto; P4; proibição no texto; barra mostra toda liberação, a origem e "guarda desligada"; eventos | liberação sem evento aparece como "sem origem"; `ligada: false` sempre visível |
| S15 | Afrouxar o `config.json` para soltar a trava | a trava não cai por mudança de config; só a liberação solta | trava + config afrouxado = continua disparada |
| S16 | JSON hostil ou gigante nos arquivos novos (`__proto__`, tipos trocados, 10 MB, link simbólico, pasta no lugar de arquivo) | `lerJson` com teto de bytes, `lstat`, esquema estrito, reconstrução só dos campos conhecidos; trava ilegível = disparada; liberação ilegível = nenhuma | fixtures maliciosas por arquivo novo |
| S17 | Texto hostil chegando ao Claude pelas mensagens da guarda (`display_name`, nome de agente, texto do limite) | modelos fixos só com números e rótulos (§8.1); o texto do StopFailure é só classificado (tipo e horário), nunca repetido | fixture com texto hostil em cada campo; a saída não o contém |
| S18 | Sequência de terminal forjada pelo `terminalSequence` | o hook monta só OSC 2, 9 e 777 com o código em base32 e texto fixo; nada externo entra | a saída casa com uma regex estrita |
| S19 | O código vaza para o transcript ou para o log de depuração, e o modelo o lê | spike S3; se vazar, D4 opção B com o risco declarado | varredura do spike (só presença, sem valores) |
| S20 | Hook estoura o tempo e o despacho passa (R2) | caminho rápido; timeout de 10 s; bench | p95 medido; teste de que não há rede nem espera |
| S21 | Corrida entre sessões gravando a trava | união na fusão; renomeação atômica; condição reavaliada | duas gravações simultâneas não perdem trava |
| S22 | A liberação trava a si mesma (P2 bloqueando `/claude-hadouken:liberar`) | isenção de prefixo em P2; o comando é tratado em UserPromptExpansion | P2 com sessão Fable disparada deixa passar `/claude-hadouken:liberar` |
| S23 | Perda de resultado de trabalho em andamento (P2 bloqueando entrega automática) | S6; na dúvida, não bloquear turno automático | fixture de turno automático |
| S24 | Privacidade: dado sai da máquina ou texto de conversa é gravado | zero rede (sem `fetch`, `http`, `net`, `dns` nos módulos novos, conferido por teste de import); arquivos novos só com números, horários, ids validados e rótulos | teste de "sem rede" já existente, estendido aos módulos novos; esquema dos arquivos novos |
| S25 | Gasto de dinheiro por créditos de uso depois do limite do Fable | G6 só solta com escopo `fable` explícito, com o aviso | liberação `2h` não solta G6 |

## 13. Spikes (antes do código que depende deles)

| # | Pergunta | Passa se | Plano B |
|---|---|---|---|
| S1 | SessionStart:compact e PreToolUse dentro de subagente trazem `agent_id`? O `session_id` é o da sessão mãe? (grava só nomes de chave e um booleano de igualdade) | `agent_id` presente e mesmo `session_id` | caminho `/subagents/`; se o `session_id` for outro, o gate aceita subagente pela sessão mãe lida do caminho |
| S2 | `/claude-hadouken:liberar` dispara UserPromptExpansion? Com qual `command_name`? O UserPromptSubmit também dispara, e em que ordem? O bloqueio mantém o texto fora do contexto? E em `-p`? | dispara com nome reconhecível e o bloqueio mantém o texto fora | UserPromptSubmit com prefixo `/claude-hadouken:liberar` no `prompt` |
| S3 | `terminalSequence` com OSC 9, OSC 777 e OSC 2 aparece no Windows Terminal e no terminal do VS Code desta máquina? O Claude Code sobrescreve o título, e em quanto tempo? O código aparece em algum arquivo da sessão (transcript, log)? | ao menos um canal visível e o código ausente de todo arquivo | D4 |
| S4 | StopFailure `rate_limit` dispara com "You've reached your Fable limit." na thread principal e em subagente, e `last_assistant_message` traz o texto? | observado uma vez (o hook registra só o tipo) | fim do transcript lido no SessionStart e em P1 com o teto de bytes da v0.2, procurando só mensagens `<synthetic>` (proposta 4) |
| S5 | `continue: false` na PreToolUse da thread principal, com subagente em segundo plano rodando: o subagente termina e entrega? O `stopReason` aparece? | sim nos dois | D3, opção B (só `deny`) |
| S6 | Turnos automáticos (aviso de tarefa em segundo plano, disparo de cron, `/loop`) passam pelo UserPromptSubmit? Há campo que os distinga? | há campo documentado ou estável | P2 não bloqueia turno automático |
| S7 | Com `refreshInterval`, o stdin da statusline muda enquanto a sessão principal está ociosa e os subagentes consomem? Os valores repetem? `cost.total_api_duration_ms` fica igual? | a regra de frescor (§10, item 8) se sustenta nos dados | não adotar `refreshInterval`; a regra de frescor fica |
| S8 | Skill com `context: fork` e agentes de Workflow passam pela PreToolUse `Agent`? `SendMessage` a um agente concluído o reabre, e com que entrada? | cobertos por P1 | matcher com `Skill`; R6 declarado |
| S9 | `if: "Bash(claude *)"` casa `claude -p`, `cd x && claude …` e prefixo de variável de ambiente? `PowerShell(claude *)` casa `& claude`? `Edit(~/.claude/hadouken/**)` casa o caminho curto 8.3 e o absoluto? | casos-alvo casados | handler sem `if` para Write/Edit só se o custo medido couber na §9; senão, R1 com os casos listados |
| S10 | Os campos de retomada (C24) chegam na 2.1.284? | presentes | o item 11 da §10 sai |
| S11 | Uma versão do Claude Code sem PreModelSwitch ou UserPromptExpansion rejeita o `hooks.json` inteiro? | eventos desconhecidos são ignorados | README declara a versão mínima 2.1.251; o SessionStart avisa uma vez quando `PreModelSwitch` nunca rodou numa troca observada pelo PostModelSwitch |

Os spikes S1, S2, S3, S5 e S9 bloqueiam o plano de implementação: sem eles, a mecânica de P1 e da liberação não fecha.

## 14. Arquivos novos e compatibilidade

A regra de compatibilidade do `SECURITY.md` continua: dado novo só em **arquivo novo**, nunca chave nova num arquivo que a v0.1 ou a v0.2 valida com rigor. `estado.json`, `alertas.json` e `projecao.json` não ganham chave. A regra de frescor (§10, item 8) muda só lógica.

| Arquivo (em `~/.claude/hadouken/`) | Conteúdo | Quem grava | Teto |
|---|---|---|---|
| `guarda.json` | travas por janela (§5.3) | statusline, P1, P2, P3, StopFailure | 16 KiB |
| `liberacao.json` | liberação ativa (§6.4) | UserPromptExpansion | 4 KiB |
| `codigo-liberacao.json` | hash scrypt, sal, sessão, escopo, validade, tentativas | UserPromptExpansion | 4 KiB |
| `modelos.json` | sessão → id de modelo validado (regex), até 50 | SessionStart, PostModelSwitch | 16 KiB |
| `limites-atingidos.json` | tipo (`fable`, `5h`, `7d`, `outro`), horário e reset, se houver; até 50 | StopFailure (ou o plano B de S4) | 16 KiB |
| `despachos-fable.json` | horários dos despachos Fable permitidos nas últimas 24 h; até 200 | P1 | 16 KiB |
| `guarda-eventos.json` | anel de 200 eventos: tipo, horário, janela, gatilho, escopo | todos os hooks da guarda | 64 KiB |
| `guarda-sessoes/<hex id>` | arquivo vazio, marca de sessão com hooks v0.3 (como `ativas/`) | primeiro hook v0.3 da sessão | — |
| `config.json`, chave `guarda` | tetos (§5.4) | o usuário, no editor | 64 KiB (o `CONFIG_MAX_BYTES` atual) |

- **`config.json` com `guarda` e sem `repos`:** `reposDaConfig` devolve `repos: null`, sem aviso, e o origin decide. Comportamento idêntico ao da v0.1 e da v0.2, conferido no código das duas tags. Um teste fixa esse comportamento.
- **Teste de compatibilidade:** as fixtures da v0.1 e da v0.2 continuam passando com os arquivos novos presentes na pasta. Os leitores da v0.2 (`validarEstado`, `alertas-gravados.js`, `projecao.json`) aceitam o `estado.json` gravado pela v0.3.
- Todo arquivo novo usa gravação atômica, `lstat`, teto de bytes e validação que reconstrói só os campos conhecidos. Nenhum guarda texto de prompt, caminho de projeto ou conteúdo de conversa.

## 15. Testes

- **Unidade:**
  - previsão com cobertura por janela;
  - gatilhos G1–G7 com relógio fixo (bordas: 89,9/90, 84,9/85, margem 19/20, horizonte 23 h 59 min / 24 h 01 min, reset a 14 e 16 min);
  - piso por idade;
  - trava (união, reset, liberação);
  - liberação (código, scrypt, tentativas, validade, escopos, teto de pontos, escopo `fable`);
  - `quandoLocal`;
  - identificação de Fable (parâmetro, frontmatter, `inherit`, variável de ambiente, desconhecido).
- **Hooks:** stdin de fixture → JSON de saída exato para P1 a P5, P2, PreModelSwitch, PostModelSwitch, StopFailure e UserPromptExpansion, na thread principal e em subagente. Mais: sessão sem registro não faz nada (gate), e sessão sem marca aparece como "sem guarda nesta sessão".
- **Ameaças:** uma fixture maliciosa por linha da §12 (S10–S25).
- **Compatibilidade:** §14.
- **Replay do incidente:** o critério 1 de §1.3.
- **Bench:** os casos novos de §9.1, com o pior caso.
- **Roteiro manual (Windows, com evidência na revisão):**
  - disparar a guarda com fixture;
  - ver o turno parar;
  - receber o código;
  - liberar;
  - ver o subagente em andamento terminar;
  - `claude -p "/claude-hadouken:liberar"` não obtém código;
  - `/reload-plugins` numa sessão antiga ativa a guarda.
- **Regressão inteira** em Windows, Linux e macOS com Node 20 e 24.

## 16. Definição de pronto

1. Os spikes S1–S11 rodados, com resultado e decisão anotados nesta spec (emenda datada).
2. As decisões D1–D5 respondidas pelo Sr. Garioli e registradas aqui.
3. Os critérios 1–8 da §1.3 cumpridos, com evidência (comando e saída) no registro do plano.
4. As metas da §9.1 medidas: Windows nesta máquina parada; Linux e macOS no job `bench` do CI.
5. `SECURITY.md` atualizado com S10–S25 e os riscos residuais R1–R6. README (PT e EN) com:
   - a guarda e como liberar;
   - a lacuna do Fable;
   - a tabela de latência real;
   - "sessões abertas só ganham a guarda depois de /reload-plugins ou de reiniciar".
6. As correções 1–11 da §10 entregues, cada uma com o teste dela.
7. Zero dependências, zero rede, nenhum texto de conversa gravado em arquivo.
8. Revisão final de qualidade e de segurança Fable sem achado aberto; o gate de segurança da release passou.

## 17. Decisões em aberto (para o Sr. Garioli)

**D1. Tetos e horizontes padrão.**

- A: margem de ritmo +10 (a mesma do modo econômico), `teto7d` 85, horizonte 7d de 24 h.
- B: margem +20, `teto7d` 85, horizonte 7d de 24 h, `teto5h` 90, horizonte 5h de 90 min.
- C: sem margem de ritmo, só projeção e tetos absolutos.

**Recomendo B.** Pelos dados (B6, B7), ele fica acima do ritmo quase toda semana. Com +10, a guarda dispararia praticamente sempre, e liberar viraria hábito, o que mata a guarda. A projeção de 24 h já pega rajadas como a do incidente.

**D2. A trava cai sozinha?**

- A: fica até a liberação ou o reset.
- B: cai se a condição sumir por 30 min.

**Recomendo A.** A projeção oscila, e "bloquear e perguntar" quer dizer que ele decide.

**D3. Na thread principal, parar o turno?**

- A: `deny` + `continue: false` (o turno para de verdade).
- B: só `deny`, com o texto "pare e pergunte".

**Recomendo A, se o spike S5 passar.** A sessão do incidente ignorou o aviso duas vezes; a opção B depende de obediência.

**D4. Liberação: escopo e canal do código.**

- Escopos: padrão 2 h, máximo 24 h, `janela`, teto de +10 pontos de 7d, e o escopo `fable` para G6.
- Canal do código:
  - A: só `terminalSequence`; onde ele não aparecer, a liberação é feita num terminal onde apareça;
  - B: se o spike S3 falhar, mandar o código no `reason` da interface, aceitando que uma sessão `claude -p` filha consiga um código (P4 continua de pé);
  - C: sem código, liberação de um passo.

**Recomendo A com esses escopos.**

**D5. A lacuna do Fable.**

- A: só dizer "sem leitura oficial", mais G6 (trava depois do limite).
- B: A mais G7, o teto local de despachos Fable (4 por 5 h).
- C: B mais a leitura digitada `/claude-hadouken:fable N`.

**Recomendo B.** É contagem exata, local e sem fonte privada, e teria parado o incidente no quinto revisor. C fica para depois, se B não bastar.

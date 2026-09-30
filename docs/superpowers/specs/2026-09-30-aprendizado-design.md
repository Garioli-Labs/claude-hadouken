# claude-hadouken v0.4.0: aprendizado local (design)

Data: 2026-09-30. Versão alvo: v0.4.0, junto com a guarda (partes 1 e 2). A v0.5.0 fica para a integração com o Pipa e o WhatsApp.
Pedido do Sr. Garioli: "o hadouken aprende como que acontece nos terminais pra se melhorar e se auto-otimizar, recolhendo dados não sensíveis e dados de telemetria. Pode usar até mesmo o open telemetry."

## 1. Decisões do Sr. Garioli (requisitos)

| Tema | Decisão |
|---|---|
| Para onde vão os dados | Só para esta máquina. Nada sai dela, e a função custa 0 tokens. |
| Autonomia | Conforto se ajusta sozinho. A segurança só aperta sozinha; afrouxar vira uma sugestão que o Sr. Garioli aprova. Tudo fica registrado e pode ser desfeito. |
| Fonte | O OpenTelemetry do Claude Code, mais os dados que os hooks do hadouken já gravam. |
| Receptor | O Collector oficial (`otelcol-contrib`) em 127.0.0.1. Ele filtra os dados e grava num JSON local. |
| Sugestão de modelo | Sim. Ele sugere trocar o modelo·effort quando uma opção mais barata dá o mesmo resultado no uso real. Nunca aplica sozinho. |
| Vida do Collector | Sobe e desce com as sessões. Não é um serviço permanente. |

### 1.1 Critérios de sucesso (todos testados)
- Nenhum campo sensível (§5.1) chega a um arquivo do hadouken, nem quando o Claude Code os manda.
- Nenhum ajuste automático afrouxa uma trava da guarda. Isso é provado por um teste de propriedade (§8).
- Cada ajuste tem registro com antes, depois, motivo e data. `desfazer` volta ao valor anterior.
- Sem Collector ou sem OTel, nada quebra: o aprendizado usa só os dados dos hooks e avisa uma vez.
- O passo de aprendizado roda em até 300 ms no pior caso do bench (§7) e nunca bloqueia um hook.
- Nenhuma chamada de modelo ou de API. A única rede é o download do Collector, feito uma vez pelo `ligar` e com permissão.

## 2. Fora de escopo
- Enviar qualquer dado para fora da máquina, incluindo servidores OTLP remotos, dashboards e a nuvem.
- Ler conteúdo: prompts, respostas, argumentos de ferramenta e corpo da API. As chaves de conteúdo do OTel ficam desligadas (§5.2).
- Traces (beta no Claude Code). Só entram métricas e eventos (logs).
- Afrouxar a guarda sem aprovação, e trocar modelo sozinho.
- Integração com o Pipa e o WhatsApp (v0.5.0).

## 3. Arquitetura e fluxo

```
Claude Code ──OTLP http/json──▶ Collector (127.0.0.1:47318)
                                  │  memory_limiter → attributes/resource (apaga §5.1) → batch
                                  ▼
                   ~/.claude/hadouken/otel/telemetria.jsonl  (rotação, teto)
                                  │
hooks do hadouken (estado, histórico, guarda) ──┐
                                  ▼             ▼
                     aprendizado (Node puro, local, 0 tokens)
                     roda no SessionStart e no SessionEnd
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
        aprendizado.json     ajustes.json        sugestoes.json
        (agregados)          (histórico, undo)   (aguardando aprovação)
                                  │
            painel (intervalo, faixas) · previsão (ritmo por hora) · guarda (só aperta)
```

### 3.1 Módulos novos
- `src/aprendizado/otlp.js`: lê o `telemetria.jsonl` de forma incremental, com cursor de byte, e reconstrói só os campos conhecidos (§5.3). É puro, sem rede e sem processo filho.
- `src/aprendizado/agregar.js`: junta os dados em agregados por modelo·effort, hora do dia e origem (sessão principal ou subagente). É puro.
- `src/aprendizado/ajustar.js`: decide os ajustes e as sugestões dentro dos limites (§4). É puro e recebe o relógio por parâmetro.
- `src/aprendizado/registro.js`: grava `aprendizado.json`, `ajustes.json` e `sugestoes.json` com `gravarJsonAtomico`, `lstat` antes de ler, teto de bytes e reconstrução dos campos.
- `src/aprendizado/coletor.js`: sobe, confere e para o Collector (arquivo de PID, porta, processo filho). É o único módulo do aprendizado com `child_process`.
- `src/aprendizado/baixar.js`: baixa o Collector do release oficial no GitHub e confere o SHA-256 fixado no código. É o único módulo com rede, e só o comando `ligar` o chama.
- `src/hooks/aprender.js` e `skills/aprender/SKILL.md`: o comando `/claude-hadouken:aprender`.
- `src/guarda/**` continua sem rede e sem processo filho. A guarda só ganha a leitura do aperto aprendido (§4.4).

### 3.2 Ligar e desligar
`/claude-hadouken:aprender ligar` faz, nesta ordem, parando no primeiro passo recusado:
1. Mostra o que será feito: o download (URL, versão, tamanho), a porta, a pasta e o diff do `env` do `~/.claude/settings.json`. Pede confirmação no chat.
2. Baixa o `otelcol-contrib` fixado (versão e SHA-256 no código, por plataforma: win-amd64, linux-amd64, linux-arm64, darwin-amd64, darwin-arm64). Confere o hash e extrai com o `tar` do sistema. No Windows usa o caminho absoluto `System32\tar.exe`, como já é feito com o `cmd.exe`. O binário vai para `~/.claude/hadouken/otel/bin/`.
3. Grava a configuração do Collector (§5.1), gerada pelo hadouken e não editável pelo usuário.
4. Faz uma cópia do `settings.json` (`settings.json.hadouken-bak`) e acrescenta ao `env`, sem tocar em mais nada:
   - `CLAUDE_CODE_ENABLE_TELEMETRY=1`
   - `OTEL_METRICS_EXPORTER=otlp` e `OTEL_LOGS_EXPORTER=otlp`
   - `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`
   - `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:47318`
   - as chaves `OTEL_METRICS_INCLUDE_*` que tiram a conta das métricas, confirmadas no spike A1.

   O `env` vai no `~/.claude/settings.json` porque o Claude Code ignora os exportadores `OTEL_*` nas configurações de projeto.
5. Recusa ligar se `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` ou `OTEL_LOG_RAW_API_BODIES` estiverem ligados, ou se já houver outro `OTEL_EXPORTER_OTLP_ENDPOINT` no `env`. Nesse caso mostra o motivo e não sobrescreve a telemetria que já existe.
6. Avisa que a telemetria vale a partir da próxima sessão.

`desligar` tira do `env` só as chaves que o `ligar` pôs (as que ainda têm o valor gravado por ele), para o Collector e pergunta se apaga a pasta `otel/`. O binário fica, a não ser que o usuário peça para apagar.

Outros subcomandos:
- `status`: mostra se está ligado, os dias de dados, os ajustes ativos e as sugestões pendentes.
- `desfazer [id]`: sem id, desfaz o último ajuste.
- `aprovar <id>` e `recusar <id>`: respondem a uma sugestão.

Mensagens só de modelos fixos, como na guarda (§8 da spec da guarda).

### 3.3 Vida do Collector
- **SessionStart:** se o aprendizado estiver ligado e o Collector não estiver vivo, o Collector sobe em segundo plano (desanexado, sem janela). A verificação usa o arquivo de PID mais o nome do processo, e o hook não espera.
- **Porta ocupada por outro processo:** o Collector não sobe. Fica registrado o evento `porta-ocupada`, e o aviso aparece uma vez por dia.
- **SessionEnd:** se não houver outra sessão ativa nos últimos 5 minutos (mesmo critério do painel, `ativas.js`), o Collector é parado. Antes de parar, o PID é conferido pelo nome do processo, e o `taskkill.exe` é chamado pelo caminho absoluto no Windows.
- **Proteção contra resto:** o SessionStart também encerra um Collector órfão que tenha ficado vivo sem sessão por mais de 30 minutos.
- **Pouca RAM:** com menos de 1,5 GiB livres, o Collector não sobe, pela mesma regra do painel. O `memory_limiter` limita o Collector a 64 MiB.
- **Integridade:** o hash é conferido na instalação. A cada subida, o tamanho e o mtime do binário são comparados; se mudarem, o hash é conferido de novo, e um hash diferente bloqueia a subida e registra o evento.

## 4. O que ele aprende e o que ajusta

### 4.1 Sinais (agregados, nunca eventos crus guardados em `aprendizado.json`)
| Sinal | Fonte | Chave de agregação |
|---|---|---|
| Custo (USD estimado pelo Claude Code) e tokens (entrada, saída, cache de leitura e de escrita) | `claude_code.cost.usage`, `claude_code.token.usage`, evento `api_request` | modelo·effort, hora do dia, origem (principal ou subagente, via `query_source`/`agent.name`) |
| Taxa de cache | tokens de cache de leitura ÷ entrada total | modelo·effort |
| Latência (ttft e duração) | evento `api_request` | modelo·effort, hora |
| Taxa de erro e de nova tentativa | eventos `api_error` e `api_request` | modelo·effort, origem |
| Sucesso de ferramenta | evento `tool_result` (só nome da ferramenta e sucesso, sem argumentos) | modelo·effort, origem |
| Horas ativas | `active_time` e as sessões marcadas pelos hooks | dia da semana × hora |
| Ritmo das janelas (5h, 7d, Fable) | leituras que o hadouken já grava (`estado.json`, histórico) | hora do dia |
| Disparos da guarda | eventos da guarda | gatilho, semana |

Sem OTel, só as três últimas linhas existem, e os ajustes que dependem das outras ficam parados (§6).

### 4.2 Piso de dados
Nenhum ajuste nem sugestão antes de 7 dias corridos com dados e 20 sessões. Para cada sugestão de modelo (§4.5), cada lado da comparação precisa de pelo menos 20 amostras.

### 4.3 Ajustes automáticos de conforto (com limites fixos no código)
| Ajuste | Padrão | Limites | Regra |
|---|---|---|---|
| Intervalo de leitura do painel | 30 s | 30 a 300 s | Nas horas em que o senhor costuma estar ativo, 30 s. Fora delas, até 120 s. A leitura já só acontece com sessão ativa. |
| Faixas de cor e alerta do painel | 75 / 90 | amarelo de 60 a 85, vermelho de 85 a 95, sempre amarelo < vermelho | A faixa vai para o ponto em que, no seu histórico, ainda sobra tempo para reagir: a mediana de minutos entre cruzar a faixa e esgotar precisa ficar ≥ 45 min na 5h e ≥ 24 h na 7d. |
| Previsão de esgotamento | ritmo recente | peso do perfil por hora de 0 a 0,5 | Mistura o ritmo atual com o ritmo típico daquela hora do dia. |

No máximo um ajuste por item a cada 24 h, com passo máximo de 5 pontos ou do dobro/metade do intervalo.

### 4.4 Guarda: só aperta sozinha
| Teto (`config.json`, `guarda`) | Aperto automático | Sugestão de afrouxar |
|---|---|---|
| `fableTetoPct` (padrão 90) | −5, piso 70, se a semana do Fable esgotou antes do reset em 2 das últimas 3 semanas | +5, até o valor do `config.json`, se nas últimas 4 semanas sobrou > 30% e a trava nunca disparou |
| Tetos de despacho caro e de 7d | −5 pontos, mesmo critério de esgotamento | +5, mesmo critério de sobra |

O aperto é gravado em `ajustes.json`. A guarda passa a ler `min(config.json, aperto aprendido)`, e só esse mínimo. Se o `ajustes.json` estiver ausente, inválido ou for um link, a guarda usa o `config.json` puro, que é a linha de base que o próprio usuário escolheu. Esse limite fica registrado no SECURITY.md.

Um afrouxamento só entra depois de `aprovar <id>`, e mesmo assim só até o valor do `config.json`. Acima disso é o usuário quem edita o `config.json`.

### 4.5 Sugestão de modelo (nunca aplicada)
Compara, na mesma origem (por exemplo o mesmo `agent.name` de subagente, ou a sessão principal), dois modelo·effort usados de verdade:
- custo por pedido ≤ metade;
- taxa de erro de API e de falha de ferramenta até 2 pontos pior;
- pelo menos 20 amostras de cada lado.

O texto é fixo e diz que a medida é indireta: "No seu uso, revisões com Sonnet 5.5·high custaram 3× menos que Opus 5.5·high, com erros parecidos (2% contra 1,5%). É um indício pelo custo e pelos erros, não uma medida de qualidade."

### 4.6 Onde o senhor vê
- Uma linha no SessionStart, no máximo uma vez por dia e só quando há novidade: "Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /claude-hadouken:aprender status)."
- O `status` lista tudo.
- A barra de status não muda.

### 4.7 Registro e desfazer
Cada ajuste é gravado assim:
```json
{"id":"a7","item":"painel.intervaloS","antes":30,"depois":60,"motivo":"fora-do-horario","em":"2026-10-08T22:00:00Z","origem":"auto"}
```
- `origem` é `auto` ou `aprovado`.
- `desfazer` grava um registro novo com `origem: "desfeito"` e bloqueia o mesmo item por 7 dias, para ele não voltar sozinho.
- O teto do `ajustes.json` é de 64 KiB; passando disso, os registros mais antigos saem.

## 5. Privacidade

### 5.1 Filtro no Collector (primeira barreira)
A configuração é gerada e fixa:
- **Receptor:** `otlp` só com `http` em `127.0.0.1:47318`, sem gRPC.
- **Processadores:** `memory_limiter`, depois `resource` e `attributes` com `delete` em `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` e em todo `vcs.*` (por padrão de chave). Por fim, `batch`.
- **Exportador:** `file` em `~/.claude/hadouken/otel/telemetria.jsonl`, com rotação de 5 MB, 3 arquivos antigos e 30 dias.
- **Telemetria própria do Collector:** desligada. Não há extensões nem outro exportador.

### 5.2 Conteúdo desligado
`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` e `OTEL_LOG_RAW_API_BODIES` nunca são ligados pelo hadouken, e o `ligar` recusa se algum deles estiver ligado (§3.2). O evento `user_prompt` só traz `prompt_length`, que é o único campo dele que o hadouken lê.

### 5.3 Leitor do hadouken (segunda barreira)
- `otlp.js` monta cada registro do zero, só com os campos listados em §4.1. Qualquer outro atributo é descartado, inclusive um sensível que tenha escapado do filtro.
- Os limites são: 1 MiB por linha, 20 MB no total, `lstat` antes de ler (link é inválido), e o cursor é validado contra o tamanho do arquivo.
- `session.id` só serve para contar sessões e não é copiado para `aprendizado.json`.

### 5.4 Retenção
- Dados brutos: a rotação do Collector (≈ 20 MB, 30 dias).
- Agregados: 26 semanas.
- `desligar` pergunta se apaga tudo.

## 6. Falhas (nada bloqueia sessão nem hook)
| Situação | Comportamento |
|---|---|
| Download recusado, sem rede ou hash diferente | `ligar` para e não altera o `settings.json`; o binário baixado é apagado. |
| Collector não sobe, porta ocupada ou pouca RAM | Segue só com os dados dos hooks, com um aviso por dia no SessionStart. |
| `telemetria.jsonl` corrompido ou maior que o teto | A linha ou o arquivo é ignorado, o cursor avança e nenhum ajuste sai daquela leitura. |
| `aprendizado.json`, `ajustes.json` ou `sugestoes.json` inválidos | São reconstruídos vazios. Os ajustes voltam aos padrões e a guarda volta ao `config.json`. |
| Ajuste calculado fora dos limites | É descartado e gera o evento `ajuste-fora`. |
| Exceção no passo de aprendizado | É registrada como evento `erro` e o hook segue. O aprendizado roda depois da parte do hook que importa. |
| `settings.json` mudou entre o diff e a gravação | `ligar`/`desligar` recusa e pede para rodar de novo. |

## 7. Desempenho
- **Passo de aprendizado:** leitura incremental a partir do cursor. Meta de ≤ 300 ms com 20 MB de dados novos e 26 semanas de agregados, e de ≤ 30 ms no caso comum (poucos KB novos). Roda depois da saída do SessionStart e do SessionEnd, sem atrasar a linha.
- **Collector:** medir no spike A2 a RAM parada e a RAM em uso, o tempo de subida e o tamanho do download. Se passar de 120 MiB de RAM parado, o spike volta para o Sr. Garioli decidir antes de seguir.
- **Custo em tokens:** 0.

## 8. Testes
- **Filtro:** um OTLP JSON de exemplo com todos os campos de §5.1, tanto no recurso quanto nos atributos. Testa que:
  - a configuração gerada contém cada `delete`;
  - `otlp.js` descarta esses campos mesmo quando eles chegam no arquivo.
- **Teste de propriedade:** para entradas aleatórias de agregados (gerador com semente fixa, 1.000 casos), `ajustar` nunca devolve aperto > valor do `config.json`, nunca devolve afrouxamento automático, e todo ajuste de conforto fica dentro dos limites de §4.3.
- **Relógio falso:** o piso de 7 dias e 20 sessões, o limite de um ajuste por item a cada 24 h, e o bloqueio de 7 dias depois de `desfazer`.
- **Ligar e desligar:**
  - um `settings.json` temporário prova que o diff só acrescenta e só remove as chaves do hadouken;
  - a cópia de segurança existe;
  - há recusa com os interruptores de conteúdo ligados e com outro endpoint;
  - há recusa se o arquivo mudou.
- **Guarda:** `min(config, aperto)` com um `ajustes.json` ausente, inválido, com link ou válido.
- **Coletor:** um processo falso no lugar do binário, cobrindo o arquivo de PID, a porta ocupada, o órfão, o nome de processo diferente (não mata) e a pouca RAM.
- **Download:** um servidor HTTP local em teste com hash certo e errado. O teste não usa a rede de verdade.
- **Regras de sempre:**
  - todo teste usa `HADOUKEN_HOME` temporário e `HADOUKEN_SEM_PAINEL: '1'`;
  - nenhum teste toca `~/.claude/hadouken` nem o `~/.claude/settings.json` de verdade;
  - o bench cobre o pior caso de §7.
- **Roteiro manual:** Collector de verdade, uma sessão real e a conferência de que `telemetria.jsonl` não tem nenhum campo de §5.1.

## 9. Spikes (antes do código que depende deles)
- **A1:** rodar uma sessão real com um Collector temporário (exportador `debug` em arquivo temporário) para confirmar:
  - os nomes exatos das métricas, dos eventos e dos atributos (`query_source`, `agent.name`, `effort`);
  - as chaves `OTEL_METRICS_INCLUDE_*`;
  - o intervalo de exportação necessário para sessões curtas.

  Rodar via Node `execFile` ou PowerShell, nunca pelo Git Bash.
- **A2:** medir a RAM, o tempo de subida e o tamanho do `otelcol-contrib` fixado no Windows. Confirmar a rotação do exportador `file` na versão fixada.
- **A3:** ver o que o Claude Code faz com o endpoint fora do ar: se há erro no terminal e se há atraso por pedido. Se atrapalhar, o `ligar` passa a exigir o Collector vivo, e o SessionEnd não o para enquanto houver sessão com telemetria.

## 10. Modelo de ameaças
| Ameaça | Defesa |
|---|---|
| Processo local manda OTLP forjado para a porta | Só pode apertar a guarda ou mexer no conforto dentro dos limites; afrouxar exige aprovação. Os textos são fixos e não ecoam nada do arquivo. |
| Binário do Collector trocado | Hash fixado no código, conferido na instalação e sempre que o tamanho ou o mtime mudarem. |
| Vazamento de identidade para arquivo | Filtro no Collector mais a reconstrução de campos no leitor (duas barreiras). |
| Porta exposta na rede | Escuta só em 127.0.0.1, sem gRPC. |
| `settings.json` corrompido pelo `ligar` | Cópia de segurança, diff mostrado antes, gravação atômica e recusa se o arquivo mudou no meio. |
| Apagar `ajustes.json` para soltar um aperto aprendido | Volta ao `config.json`, que o próprio usuário escolheu. Registrado no SECURITY.md como limite. |

## 11. Arquivos novos e compatibilidade
- Em `~/.claude/hadouken/`: `otel/` (com `bin/`, `config.yaml`, `telemetria.jsonl*` e `coletor.pid`), `aprendizado.json` (256 KiB), `ajustes.json` (64 KiB), `sugestoes.json` (16 KiB) e `aprendizado-cursor.json` (4 KiB).
- `estado.json`, `alertas.json` e `projecao.json` não ganham nenhuma chave nova.
- O painel lê o intervalo e as faixas do `ajustes.json`. Sem ele, usa os valores de hoje.
- Desligado, que é o padrão, o hadouken se comporta exatamente como na guarda sem aprendizado.
- A ordem de implementação vem depois da parte 2 da guarda, porque §4.4 lê o `config.js` da guarda.

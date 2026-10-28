# Aprendizado

[English](Learning)

## Aprendizado local

Ligado por padrão desde a v0.5.4: o instalador o liga, a não ser que você use `--sem-aprender` ou já o tenha desligado antes. Desligue a qualquer momento na janela do VS Code (aba Aprendizado) ou com `/hadouken:aprender desligar`. Ligado, o hadouken aprende só nesta máquina, sem gastar tokens, com duas fontes: o OpenTelemetry do próprio Claude Code, recebido por um Collector oficial (`otelcol-contrib`) que escuta só em `127.0.0.1:47318`, e os dados que os hooks já gravam. Com isso ele ajusta sozinho o conforto, dentro de limites fixos no código, e só **aperta** a guarda sozinho. Afrouxar a guarda e trocar de modelo ficam como sugestões que o senhor aprova.

### Ligar, em dois tempos

1. `/hadouken:aprender ligar` mostra o plano, sem mudar nada: a versão do Collector, o endereço do download no GitHub, o tamanho máximo, a pasta (`~/.claude/hadouken/otel/`), as chaves que entram no `env` do `settings.json` e um código de 8 caracteres.
2. `/hadouken:aprender ligar <código>` executa: baixa o Collector uma vez, confere o SHA-256 fixado no código (fora do hash, o arquivo é apagado e nada muda), extrai com o `tar` do sistema, grava a configuração e só então acrescenta as chaves ao `env` do `settings.json`, com cópia de segurança. Se o `settings.json` mudou entre os dois tempos, o código não confere e nada é feito.

O `ligar` recusa se `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` ou `OTEL_LOG_RAW_API_BODIES` estiver ligado (no `env` do `settings.json` ou no ambiente, com o nome em qualquer caixa, como o Windows o lê), ou se já houver outro endpoint OTLP configurado. A telemetria vale a partir da sessão seguinte. O comando é um hook que roda antes do modelo: não gasta tokens, e uma sessão `claude -p` ou do SDK (um script) é recusada; uma tarefa agendada, um `/loop` ou uma rotina com o comando no texto é negada antes de ser criada. Se outra sessão estiver no meio de um `ligar`, de um `desligar` ou do passo de aprendizado, a resposta é que o aprendizado está ocupado, e o `settings.json` não muda.

O binário extraído ocupa cerca de 367 MiB em disco; o `.tar.gz` do download (uns 100 MiB) é apagado depois da extração. Medido no Windows, o Collector usa uns 108 MiB de memória parado e chegou a 131 MiB no pico.

O Collector sobe no início de cada sessão (sem janela, sem esperar), não sobe com menos de 1,5 GiB de memória livre e para no fim da última sessão aberta.

### O que ele ajusta sozinho

Só depois de 7 dias corridos com dados **e** 20 sessões, e no máximo um ajuste por item a cada 24 h:

| Item | Limites | Quando muda |
|---|---|---|
| Intervalo do painel fora das horas ativas | 30 a 120 s | Nas suas horas ativas o painel lê a cada 30 s; fora delas, a cada 60 e depois 120 s. |
| Faixa amarela do painel | 60 a 85% | Pela antecedência, no seu histórico, entre cruzar a faixa e esgotar a janela. |
| Faixa vermelha do painel | 85 a 95% | Idem. |
| Peso do ritmo por hora na previsão | 0 a 0,5 | Sobe de 0,1 em 0,1 quando o ritmo por hora cobre 80% das suas horas ativas; desce de 0,1 em 0,1 de volta a 0 quando a cobertura cai. Vale para os avisos ao Claude; a guarda continua com o ritmo atual. |
| Teto do Fable e teto de 7 dias da guarda | Só para baixo, 5 pontos por vez, nunca abaixo de 70% | Quando a janela esgotou em 2 das 3 últimas semanas. |

As faixas aprendidas mudam só a cor do painel do VS Code; os avisos ao Claude seguem as faixas de sempre.

**Limite:** as faixas aprendem com o histórico curto do `estado.json`, que cobre 3 h, e o passo de aprendizado roda só no início e no fim de cada sessão. Numa sessão de mais de 3 h, os pontos mais antigos saem do histórico antes de serem lidos, e as faixas aprendidas pendem para o fim dessas sessões.

### Sugestões, nunca aplicadas sozinhas

- **Afrouxar a guarda**, depois de um aperto aprendido, até no máximo o valor do seu `config.json`, quando sobrou mais de 30% em 4 semanas seguidas sem a janela esgotar.
- **Trocar de modelo ou effort** numa origem (a sessão principal ou um subagente), quando o outro custou no máximo metade por pedido nas últimas 4 semanas, com erros até 2 pontos piores e pelo menos 20 pedidos de cada lado. A medida é indireta (custo e erros, não qualidade), e a troca nunca é feita pelo hadouken. Na medição com o Claude Code 2.1.287 (feita só com o Haiku), o effort não veio na telemetria; enquanto faltar, a comparação é só entre modelos, com o effort como `-`.

### Comandos

| Comando | O que faz |
|---|---|
| `/hadouken:aprender` ou `… status` | O estado, os ajustes em vigor, as sugestões e os últimos eventos. |
| `… ligar`, `… ligar <código>` | A prévia e a execução, acima. |
| `… desligar`, `… desligar <código>` | Também em dois tempos: a prévia mostra as chaves que saem do `env` e o que será apagado, com um código de 8 caracteres; com o código, para o Collector e tira do `env` só as chaves com o valor que o `ligar` pôs. Se o `settings.json` mudou entre os dois tempos, nada é feito. Os dados ficam; `desligar dados` apaga os dados aprendidos (o binário fica), e `desligar tudo` apaga também a pasta `otel/`, com o binário, cada um com o seu código (`desligar dados <código>`, `desligar tudo <código>`). |
| `… desfazer`, `… desfazer aN` | Volta o último ajuste (ou o `aN`) e bloqueia o item por 7 dias. |
| `… aprovar sN`, `… recusar sN` | Aplica ou descarta uma sugestão; recusar bloqueia a mesma sugestão por 7 dias. |

No início da sessão, no máximo uma vez por dia e só quando há novidade, aparece só para o senhor, fora do contexto do Claude, uma linha como:

```
Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /hadouken:aprender status).
```

Também avisa, uma vez por dia por tipo, quando o Collector não sobe, não para ou ainda não recebeu telemetria.

### Privacidade do aprendizado

- **Primeira barreira, no Collector:** apaga `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` e todo `vcs.*` antes de gravar; recebe só OTLP/HTTP em 127.0.0.1, sem gRPC, sem extensões e sem outro exportador.
- **Segunda barreira, no leitor:** cada registro é montado do zero, só com modelo, effort, origem, custo, tokens, duração e resultado; o resto, inclusive `session.id`, é descartado.
- **Conteúdo, nunca:** prompts, detalhes de ferramenta e corpos de API ficam desligados, e o `ligar` recusa se algum estiver ligado.
- **Retenção:** o arquivo bruto gira em 5 MB, com 3 antigos e 30 dias; os agregados guardam 26 semanas.
- **Nada sai da máquina:** a única rede é o download do Collector, uma vez, pelo `ligar <código>`.

---

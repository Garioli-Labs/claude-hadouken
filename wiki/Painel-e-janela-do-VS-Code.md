# Painel e janela do VS Code

[English](VS-Code-panel-and-window)

## O painel no VS Code

Os limites da conta (sessão de 5 horas, semana e Fable) são os mesmos em todas as sessões, então aparecem **uma vez só**, num item à direita da barra de status do VS Code:

```text
5h 42% · sem 59% · Fable 71%
```

| Trecho | O que quer dizer | Na aba Uso do claude.ai |
|---|---|---|
| `5h 42%` | Você usou **42 %** da sessão de 5 horas. | Sessão atual |
| `sem 59%` | Você usou **59 %** da semana, somando todos os modelos. | Semana (todos os modelos) |
| `Fable 71%` | Você usou **71 %** do limite semanal próprio do Fable. | Semana (Fable) |

- **Percentuais arredondados para baixo.** Janela sem leitura confiável aparece como `—` (por exemplo, `Fable —` antes da primeira leitura oficial); sem nenhuma, o item diz `Hadouken: sem leitura`.
- **A cor segue a pior janela:** sem cor abaixo de 75 %, fundo de aviso (amarelo) de 75 % a 89 % e fundo de erro (vermelho) de 90 % em diante. Essas faixas são só do painel; os avisos ao Claude seguem as deles (veja [Os avisos que o Claude recebe](Avisos-e-alertas#os-avisos-que-o-claude-recebe)).
- **Clique** no item, ou rode o comando `Claude Hadouken: atualizar uso agora`, para ler na hora. A leitura manual respeita a trava entre janelas, a pausa por RAM e o bloqueio por custo (veja [Sem gastar tokens, com pouca RAM](#sem-gastar-tokens-com-pouca-ram)).

![Seis estados do item do painel na barra de status do VS Code: 5h 42% · sem 59% · Fable 71%, sem cor; 5h 78% · sem 59% · Fable 71%, com fundo amarelo; 5h 42% · sem 59% · Fable 92%, com fundo vermelho; 5h 42% · sem 59% · Fable —, antes da primeira leitura oficial; Hadouken: sem leitura; e Hadouken: abra uma sessão do Claude Code, quando nenhuma sessão abriu com o plugin nesta máquina](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/painel-estados.svg)

**De onde vem cada número.**

- **5 h e semana:** a leitura mais nova entre a statusline do Claude Code (que a barra grava em `estado.json` a cada atualização) e o `/usage` (gravado em `uso-oficial.json`). O reinício vem da statusline, que o traz exato.
- **Fable:** só do `/usage`, porque a statusline não traz limite por modelo. O reinício sai do texto do `/usage` (`resets Oct 5, 10pm`), lido na hora local.
- Leitura com mais de 1 hora, ou cujo reinício já passou, não aparece: a janela fica em `—`.

### A dica

Passe o mouse no item para ver a dica (a imagem de [Em 30 segundos](Home#em-30-segundos) mostra uma). Ela tem, em ordem:

| Linha | O que diz |
|---|---|
| **Sessão (5h):**, **Semana (todos os modelos):** e **Semana (Fable):** | A porcentagem, quando a janela reinicia (`reinicia 15:30` no mesmo dia, `reinicia seg 22:00` em outro) e a [previsão](#a-previsão). Janela sem leitura: `sem leitura`. |
| `Sessões ativas: 2` | Quantas sessões do plugin estão ativas agora (veja [Projeção e várias sessões](Avisos-e-alertas#projeção-e-várias-sessões)). |
| `Leitura oficial: há 12 s` | A idade da última leitura do `/usage`; antes da primeira, `Sem leitura oficial ainda`. |
| estado da leitura | Só quando algo impede a leitura: `Leitura pausada: pouca RAM livre.`, `Leitura bloqueada por 24 h: o /usage passou a ter custo.`, `claude não encontrado em ~/.local/bin nem no PATH.`, `Leitura desligada (HADOUKEN_SEM_PAINEL=1).`, `Última leitura passou de 30 s; a próxima em 15 min.`, `Última leitura passou do teto de saída; a próxima em 15 min.` ou `Última leitura falhou (motivo).`, com o motivo de uma lista fixa (`formato`, `erro`, `sem-pasta`). |
| `Fonte: statusline do Claude Code e claude /usage, sem tokens.` | Sempre, no fim. |

A dica só tem rótulos fixos e números: nenhum texto lido de arquivo entra nela.

### A previsão

A frase é a mesma do claude.ai, feita com o ritmo médio da janela inteira até agora:

- ritmo = uso ÷ tempo decorrido na janela (de 5 horas ou de 7 dias);
- esgota = agora + (100 − uso) ÷ ritmo.

| Situação | Frase |
|---|---|
| esgota antes do reinício | `Nesse ritmo, esgota <quando>, antes do reinício <reinício>.` |
| esgota depois do reinício | `Nesse ritmo, não esgota antes do reinício <reinício>.` |
| uso em 100 % | `Limite atingido; reinicia <reinício>.` |
| menos de 30 minutos decorridos, ou uso zero | (nenhuma frase) |

- **`<quando>`** é `por volta das 14:04` quando falta menos de 6 horas. Mais longe, é `hoje`, `amanhã` ou o dia da semana (até 6 dias), com o período: `de madrugada` (0 h a 5 h), `de manhã` (6 h a 11 h), `à tarde` (12 h a 17 h) ou `à noite` (18 h a 23 h). Depois de 6 dias, `em 05/10`.
- **`<reinício>`** é `das 15:30` no mesmo dia e `de 28/09 às 22:00` em outro.

Na imagem, às 12:00, a sessão de 5 horas está em 42 % e reinicia às 15:30. Ela começou às 10:30, então passou 1,5 h: o ritmo é 42 ÷ 1,5 = 28 % por hora. Faltam 58 %, que acabam em 58 ÷ 28 = 2,07 h, perto das 14:04, antes das 15:30. Daí `Nesse ritmo, esgota por volta das 14:04, antes do reinício das 15:30.`

Essa frase não é a projeção dos avisos ao Claude. A projeção usa o ritmo dos últimos minutos (veja [Projeção e várias sessões](Avisos-e-alertas#projeção-e-várias-sessões)); a frase, a média da janela inteira, como o claude.ai. A linha do início de sessão usa a frase da semana.

### Sem gastar tokens, com pouca RAM

- **Sem tokens.** O Fable vem do comando oficial `claude -p /usage`. O `/usage` é comando local do Claude Code: não chama o modelo. Cada leitura confere o resultado: `num_turns` 0, custo 0 e `local_command` igual a `usage`. Se turnos ou custo vierem diferentes de 0, o painel entende que o comando passou a ter custo, para de ler por 24 h e diz isso na dica; um resultado sem custo que não seja o do `/usage` conta como falha de formato. Quem consulta a Anthropic é o próprio Claude Code, com a sua sessão; o plugin não lê credencial nem chama endpoint nenhum.
- **Modo enxuto.** A leitura roda sem plugins, MCP, hooks, Chrome nem histórico de sessão (`--no-session-persistence --strict-mcp-config --no-chrome --setting-sources "" --settings {"disableAllHooks":true}`), numa pasta vazia da pasta de dados (`uso-cwd/`), para o Claude Code não indexar nada. Medido na máquina Windows do autor:

  | Modo | Tempo | Pico de RAM | Processos |
  |---|---|---|---|
  | `claude -p /usage` comum | 15 s | 972 MB | 28 (MCP, hooks, plugins) |
  | enxuto, o do painel | 5 s | 270 MB | 2 a 4 |

- **Só quando serve.** Uma leitura a cada 30 s, só com alguma sessão do Claude Code ativa nos últimos 5 minutos, e uma por vez entre todas as janelas do VS Code: uma trava de arquivo (`uso-oficial.lock`) só é dada como abandonada depois de 90 s, e uma leitura de menos de 25 s dispensa a próxima. Depois de uma leitura que estourou o prazo ou o teto de saída, veio num formato inesperado ou falhou, a próxima espera 15 min; o 5 h e a semana seguem vindo da statusline nesse meio-tempo. Na média, uns 45 MB, com picos de 270 MB por 5 s.
- **Pausa por memória.** Com menos de 1,5 GiB de RAM livre, a leitura é pulada, mesmo a manual, e a dica diz `Leitura pausada: pouca RAM livre.`
- **O resto é leitura de arquivo.** A cada 5 s, a extensão redesenha o item lendo `estado.json` e `uso-oficial.json`. Sem webview e sem dependências; a lógica mora no plugin (`src/uso/painel.js`), carregada por um script estável da pasta de dados (`bin/painel.mjs`).

### Instalar, desligar e remover

- **Instalação sozinha.** Quando uma sessão começa com uma versão do plugin que ainda não está instalada no VS Code, o início de sessão monta a extensão (um `.vsix`, em `<pasta de dados>/painel/`) e roda, em segundo plano, `code --install-extension <vsix> --force`. Precisa do comando `code` no `PATH` (no Windows, `code.cmd`; no Mac, o do `Visual Studio Code.app` em `/Applications` ou `~/Applications` também serve). Se a instalação falhar, o início de sessão seguinte diz o motivo numa linha, com o conserto. É uma tentativa por hora, dê certo ou não, e nada disso entra no contexto do Claude.
- **Instalação à mão:** `node "$HOME/.claude/hadouken/bin/cli.mjs" painel instalar`.
- Se o item não aparecer numa janela do VS Code que já estava aberta, recarregue-a (comando `Developer: Reload Window`). Enquanto nenhuma sessão do Claude Code tiver aberto com o plugin nesta máquina, o item diz `Hadouken: abra uma sessão do Claude Code`.
- **Remover (o jeito de desligar agora):** rode `code --uninstall-extension gariolilabs.claude-hadouken-painel` e recarregue cada janela aberta do VS Code (`Developer: Reload Window`): o item continua rodando nelas até a recarga. Defina também `HADOUKEN_SEM_PAINEL=1` no ambiente do Claude Code; sem ela, um início de sessão instala a extensão de novo, na próxima versão do plugin.
- **`HADOUKEN_SEM_PAINEL=1`** faz o início de sessão parar de instalar e de atualizar a extensão. Para uma extensão já instalada parar de ler o `/usage`, a variável precisa estar no ambiente do próprio VS Code: defina-a como variável de usuário (no Windows) ou no perfil do shell, e feche e abra o VS Code por inteiro. Uma variável definida só num terminal não chega à extensão.
- **`HADOUKEN_HOME`** segue a mesma regra: se você troca a pasta de dados, a extensão só a enxerga com a variável no ambiente do VS Code.
- **A barra com a sessão parada.** Desde a v0.4.0, o instalador grava `refreshInterval: 60`: a barra se redesenha a cada minuto também com a sessão parada, e a idade da leitura continua certa (uma leitura repetida sem conversa nova não conta como nova). Custo: um processo Node por minuto em cada terminal aberto. Quem já tinha a barra da v0.3.0 vê a ação `atualizar`, que só acrescenta essa chave, com backup. Medido no Claude Code: com a sessão ociosa, a barra rodou a cada 60 s exatos.

## A janela do hadouken

Clique no logo do hadouken na barra de status do VS Code, ou rode o comando `Claude Hadouken: abrir a janela`, para abrir a janela de configuração. Tudo o que o hadouken deixa mudar está nela, sem editar arquivo nenhum:

| Aba | O que muda |
|---|---|
| Guarda | Liga e desliga a guarda e muda os tetos (veja [Guarda de consumo](Guarda-de-consumo)). |
| Barra | As faixas de cor do contexto e do cache na barra de status. |
| Alertas | Com quanta antecedência os avisos de projeção chegam. |
| Aprendizado | Liga e desliga o [aprendizado local](Aprendizado). |
| Painel | O aviso de versão nova e a animação do logo. |
| Roteamento | As regras do [roteamento de modelo e effort](Guarda-de-consumo#roteamento-de-modelo-e-effort). |
| Proteções | Os quatro bloqueios que o senhor pode desligar (veja [Proteções](Limites#proteções)). |

- **Salvar** só liga quando há mudança válida; desligado, ele diz por quê. Um número fora da faixa é avisado ao sair do campo.
- **Desfazer:** depois de salvar, uma barra oferece desfazer por 15 segundos.
- **Afrouxar** a guarda ou desligar uma proteção mostra, junto do campo, o que passa a valer.
- **Mudou em outro lugar:** se a configuração mudou enquanto a janela estava aberta (pelo `/hadouken:limites`, por outra janela), os valores novos são carregados e o seu rascunho fica.
- **Versão nova:** quando sai uma versão do hadouken, o VS Code avisa uma vez, com o botão **Atualizar**, que abre um terminal com o comando de atualização. Desligue na aba Painel.
- **Movimento:** o logo anima ao abrir; com "reduzir movimento" no sistema, ou com a animação desligada na aba Painel, ele fica parado.

---

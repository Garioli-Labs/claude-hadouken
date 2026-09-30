<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-escuro.svg">
    <img src="assets/logo-claro.svg" alt="hadouken" width="420">
  </picture>
</p>

# claude-hadouken

[English](README.en.md) · **Português**

[![CI](https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml/badge.svg)](https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/github/license/Garioli-Labs/claude-hadouken)](LICENSE)

**Seu consumo do Claude Code na tela, com referência de ritmo, e o Claude sabendo disso também.**

`claude-hadouken` é um plugin do Claude Code que mede o consumo real e o mostra onde você trabalha:

- os limites da sua conta, **sessão de 5 horas**, **semana** e **semana do Fable**, com os mesmos números da aba Uso do claude.ai;
- **contexto** e **acerto de cache** de prompt de cada sessão;
- **tokens** por projeto, por modelo·effort, por sessão e por agente principal × subagentes;
- **minutos e cache do GitHub Actions** dos seus repositórios.

Tudo aparece numa barra de status no rodapé do Claude Code, num item da barra de status do VS Code, num relatório sob demanda e em avisos curtos que o próprio Claude recebe quando é hora de mudar de marcha.

Esta é a **v0.3.0** do primeiro subprojeto do plugin, o **Leitor de consumo**. A barra do Claude Code passa a mostrar só o que é da sessão: modelo, effort, contexto e cache. Os limites da conta, que são os mesmos em todas as sessões, aparecem uma vez só, num item da barra de status do VS Code, com o Fable lido pelo `/usage` oficial sem gastar tokens e a previsão na mesma frase do claude.ai. Zero dependências, só Node.js.

> [!NOTE]
> A interface do plugin (barra, painel, avisos e relatório) está em português do Brasil.

## Sumário

- [Por que existe](#por-que-existe)
- [Em 30 segundos](#em-30-segundos)
- [A barra de status, segmento por segmento](#a-barra-de-status-segmento-por-segmento)
  - [Contexto e cache](#2-contexto-ctx)
  - [Quando aparece `—`, e quando a barra fica vazia](#quando-aparece--e-quando-a-barra-fica-vazia)
- [O painel no VS Code](#o-painel-no-vs-code)
  - [A dica](#a-dica)
  - [A previsão](#a-previsão)
  - [Sem gastar tokens, com pouca RAM](#sem-gastar-tokens-com-pouca-ram)
  - [Instalar, desligar e remover](#instalar-desligar-e-remover)
- [Os avisos que o Claude recebe](#os-avisos-que-o-claude-recebe)
  - [Janela de 5 horas: as faixas](#janela-de-5-horas-as-faixas)
  - [Janela de 7 dias: o ritmo esperado e os modos](#janela-de-7-dias-o-ritmo-esperado-e-os-modos)
  - [Projeção e várias sessões](#projeção-e-várias-sessões)
- [O relatório `/claude-hadouken:consumo`](#o-relatório-claude-hadoukenconsumo)
  - [Sessões abertas (última hora)](#sessões-abertas-última-hora)
  - [Glossário das colunas](#glossário-das-colunas)
  - [Cache de 1 h e de 5 min: o que é TTL](#cache-de-1-h-e-de-5-min-o-que-é-ttl)
  - [GitHub Actions](#github-actions)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Performance](#performance)
- [Limitações conhecidas](#limitações-conhecidas)
- [Desinstalação](#desinstalação)
- [Perguntas frequentes](#perguntas-frequentes)
- [Roteiro](#roteiro)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

---

## Por que existe

O Claude Code mostra os limites quando você pede (`/usage`). No resto do tempo você trabalha às cegas: descobre que a janela de 5 horas acabou quando ela acaba, e que a semana foi embora na quarta-feira.

Faltam duas coisas:

1. **Referência de ritmo.** "58 % da semana usada" é muito ou pouco? Depende de quantas horas da semana já passaram. O plugin calcula quanto você *deveria* ter usado num ritmo linear e compara.
2. **O Claude saber.** Se o Claude sabe que a janela de 5 horas está em 83 %, ele para de abrir subagentes em paralelo. Em 91 %, fecha a tarefa em curso em vez de começar outra.

O princípio que guia tudo: **qualidade antes da economia**. Economizar corta volume, paralelismo e releitura; nunca corta testes, review, verificação, nem o modelo e o effort de implementação. Quando sobra folga na semana, ela vai para qualidade (review extra, effort maior em spec e auditoria), não para volume.

---

## Em 30 segundos

O plugin faz quatro coisas:

1. **Uma barra de status**, sempre no rodapé do Claude Code. Ela diz, numa linha, em números e em barrinhas, o modelo e o effort desta sessão, quanto do contexto já está ocupado e quanto do que vai ao modelo sai do cache.

   ![Barra de status do claude-hadouken: Opus 5.5·high; contexto em 37% e acerto de cache em 92%, cada um com a sua barrinha, os dois em verde](docs/imagens/barra-calma.svg)

2. **Um item na barra de status do VS Code**, com os limites da conta: a sessão de 5 horas, a semana e a semana do Fable, com os números da aba Uso do claude.ai. Passe o mouse para ver quando cada janela reinicia e a previsão, na mesma frase do claude.ai.

   ![Item do claude-hadouken na barra de status do VS Code, com o mouse em cima: 5h 42% · sem 59% · Fable 71%. A dica mostra, por janela, a porcentagem, o reinício e a previsão: sessão de 5h em 42%, reinicia às 15:30 e, nesse ritmo, esgota por volta das 14:04; semana de todos os modelos em 59%, não esgota antes do reinício de segunda às 22:00; semana do Fable em 71%, esgota segunda de manhã. Depois, 2 sessões ativas, a idade da leitura oficial (12 s) e a fonte: statusline do Claude Code e claude /usage, sem tokens](docs/imagens/painel.svg)

3. **Avisos curtos para o Claude.** Quando uma janela muda de faixa (por exemplo, a de 5 horas passa de 80 %), ou quando o ritmo atual a leva a 100 % antes do reset, o Claude recebe uma linha no contexto e ajusta o jeito de trabalhar.
4. **Um relatório sob demanda**, `/claude-hadouken:consumo`: para onde foram os tokens (por projeto, modelo, subagentes e sessão, e quanto pesou cada sessão aberta na última hora) e os minutos do GitHub Actions.

> [!TIP]
> Todas as imagens e exemplos deste README são a saída real do código do plugin, rodado sobre **dados sintéticos** (projetos `meu-projeto` e `outro-projeto`, sessões inventadas). O relógio dos exemplos está parado num **sábado, 12:00**; a semana da conta começou na segunda anterior às 22:00. As imagens são refeitas com `node docs/imagens/gerar.mjs`.

---

## A barra de status, segmento por segmento

A barra mostra só o que é **desta sessão**, numa linha dividida em três pedaços separados por `│`:

```text
Opus 5.5·high │ ctx ▰▰▰▱▱▱▱▱ 37% │ cache ▰▰▰▰▰▰▰▱ 92%
└─────┬─────┘   └──────┬───────┘   └───────┬────────┘
      1                2                   3
```

| # | Segmento | O que quer dizer | De onde vem o número | Cor | O que fazer |
|---|---|---|---|---|---|
| 1 | `Opus 5.5·high` | Modelo e nível de effort **desta sessão**. | O Claude Code manda para a barra a cada atualização. | Sem cor. | Confira antes de uma tarefa grande: é o modelo e o effort que você queria? |
| 2 | `ctx ▰▰▰▱▱▱▱▱ 37%` | **37 %** da janela de contexto desta sessão está ocupada (3 de 8 quadradinhos). | O Claude Code manda para a barra. | Verde abaixo de 70 %, amarelo de 70 % a 84 %, vermelho de 85 % em diante. | Amarelo ou vermelho e vai mudar de assunto? Uma sessão nova (ou `/compact`) começa mais leve. |
| 3 | `cache ▰▰▰▰▰▰▰▱ 92%` | **92 %** do que foi enviado ao modelo nesta sessão veio do cache de prompt. | O Claude Code manda para a barra. | Verde de 80 % em diante, amarelo de 50 % a 79 %, vermelho abaixo de 50 %. | Alto é bom: você reaproveita contexto em vez de pagar por ele de novo. Baixo logo no começo da sessão é normal. |

Os limites da conta (5 horas, semana e Fable) não ficam na barra: são os mesmos em todas as sessões e aparecem uma vez só, no [painel do VS Code](#o-painel-no-vs-code). A barra continua gravando, a cada atualização, a leitura de 5 horas e 7 dias que o Claude Code manda junto: é dela que saem o painel, os avisos ao Claude e o relatório.

### As barrinhas

Os dois percentuais vêm também numa barrinha de 8 quadradinhos: `▰` é uma casa cheia, `▱` uma vazia, e cada casa vale 12,5 pontos.

- A conta arredonda para a casa mais perto, com duas travas: uso de 1 % ou mais nunca aparece vazio (fica pelo menos uma casa), e a barrinha só enche de todo com 100 %.
- A barrinha é o mesmo número em outra forma: o percentual continua escrito ao lado, e a cor sai do número, nunca da barrinha.
- Indicador sem dado confiável mostra `—`, sem barrinha.

### 1. Modelo·effort

- O nome é o que o Claude Code mostra para o modelo (até 40 caracteres).
- O effort aparece depois do `·` só quando é um dos cinco níveis conhecidos: `low`, `medium`, `high`, `xhigh` ou `max`. Sem effort reconhecido, a barra mostra só o nome do modelo.
- Modelo, effort, contexto e cache são sempre **da sessão onde a barra aparece**. Duas sessões abertas podem mostrar modelos diferentes.

### 2. Contexto (`ctx`)

A janela de contexto é quanto de conversa, arquivos e resultados de ferramentas o modelo consegue considerar de uma vez. `ctx 37%` quer dizer que 37 % dela está ocupada nesta sessão. O número vem do próprio Claude Code. Quanto mais cheio, mais cada resposta carrega; ao mudar de assunto, uma sessão nova costuma sair mais barata.

A cor avisa quando o contexto enche (as faixas de ctx e cache são só visuais: não mandam aviso ao Claude):

| Uso | Cor |
|---|---|
| abaixo de 70 % | verde |
| 70 % a 84 % | amarelo |
| 85 % ou mais | vermelho |

### 3. Cache (`cache`)

A cada resposta, o Claude Code reenvia a conversa inteira ao modelo. O **cache de prompt** guarda o começo dessa conversa por um tempo, e as respostas seguintes o reaproveitam em vez de processar tudo de novo. Ler do cache custa uma fração do preço normal de entrada.

`cache 92%` é a taxa de acerto do cache nesta sessão, como o Claude Code a informa: quanto mais alto, mais contexto foi reaproveitado. Em sessões longas, 90 % ou mais é comum. O número cai no começo de uma sessão, depois de uma pausa maior que a validade do cache e depois de trocar de modelo (o cache é de cada modelo). O relatório mostra o mesmo indicador por projeto, modelo e sessão; veja [Cache de 1 h e de 5 min](#cache-de-1-h-e-de-5-min-o-que-é-ttl).

A cor segue o acerto:

| Acerto de cache | Cor |
|---|---|
| 80 % ou mais | verde |
| 50 % a 79 % | amarelo |
| abaixo de 50 % | vermelho |

Vermelho no começo de uma sessão, ou logo depois de trocar de modelo, é normal: o cache ainda está sendo criado.

### A barra em outras situações

![Seis estados da barra: ctx 76% em amarelo; ctx 88% em vermelho; cache 64% em amarelo; cache 31% em vermelho, com ctx 4%, no começo de uma sessão; um effort desconhecido, com só o nome do modelo; e uma sessão sem dado ainda, com travessões e sem barrinha](docs/imagens/barra-estados.svg)

### Quando aparece `—`, e quando a barra fica vazia

**`—` quer dizer "sem dado confiável agora", nunca zero.** Na barra, ele aparece em `ctx` ou em `cache` quando:

- o Claude Code ainda não mandou o número, como numa sessão nova antes da primeira resposta;
- o valor recebido está fora do formato esperado (por exemplo, um percentual fora de 0 a 100).

**Barra vazia é outra coisa.** Numa sessão aberta **antes** da instalação do plugin, o comando da barra não imprime nada, de propósito: o plugin só age em sessões que começaram depois dele. Abra uma sessão nova. Veja [Instalação](#instalação).

### Regras que valem para a barra toda

- **Só a sessão.** Modelo, effort, contexto e cache são de cada sessão: duas sessões abertas mostram, cada uma, os seus. O que é da conta fica no [painel do VS Code](#o-painel-no-vs-code).
- **Percentuais arredondados para baixo.** 89,6 % aparece como `89%`, e a cor sai desse mesmo inteiro, então o número e a cor nunca discordam.
- **Cores só em `ctx` e `cache`**, e só estas: verde, amarelo e vermelho. A cor vale para o segmento inteiro, barrinha incluída; o modelo fica sem cor. A variável [`NO_COLOR`](https://no-color.org/) (definida e não vazia) desliga as cores; as barrinhas continuam.
- **Largura.** A linha do exemplo tem 53 colunas; um nome de modelo longo (até 40 caracteres) a deixa maior. A barra não se corta para caber: veja [Limitações conhecidas](#limitações-conhecidas).

---

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
- **A cor segue a pior janela:** sem cor abaixo de 75 %, fundo de aviso (amarelo) de 75 % a 89 % e fundo de erro (vermelho) de 90 % em diante. Essas faixas são só do painel; os avisos ao Claude seguem as deles (veja [Os avisos que o Claude recebe](#os-avisos-que-o-claude-recebe)).
- **Clique** no item, ou rode o comando `Claude Hadouken: atualizar uso agora`, para ler na hora. A leitura manual respeita a trava entre janelas, a pausa por RAM e o bloqueio por custo (veja [Sem gastar tokens, com pouca RAM](#sem-gastar-tokens-com-pouca-ram)).

![Seis estados do item do painel na barra de status do VS Code: 5h 42% · sem 59% · Fable 71%, sem cor; 5h 78% · sem 59% · Fable 71%, com fundo amarelo; 5h 42% · sem 59% · Fable 92%, com fundo vermelho; 5h 42% · sem 59% · Fable —, antes da primeira leitura oficial; Hadouken: sem leitura; e Hadouken: abra uma sessão do Claude Code, quando nenhuma sessão abriu com o plugin nesta máquina](docs/imagens/painel-estados.svg)

**De onde vem cada número.**

- **5 h e semana:** a leitura mais nova entre a statusline do Claude Code (que a barra grava em `estado.json` a cada atualização) e o `/usage` (gravado em `uso-oficial.json`). O reinício vem da statusline, que o traz exato.
- **Fable:** só do `/usage`, porque a statusline não traz limite por modelo. O reinício sai do texto do `/usage` (`resets Oct 5, 10pm`), lido na hora local.
- Leitura com mais de 1 hora, ou cujo reinício já passou, não aparece: a janela fica em `—`.

### A dica

Passe o mouse no item para ver a dica (a imagem de [Em 30 segundos](#em-30-segundos) mostra uma). Ela tem, em ordem:

| Linha | O que diz |
|---|---|
| **Sessão (5h):**, **Semana (todos os modelos):** e **Semana (Fable):** | A porcentagem, quando a janela reinicia (`reinicia 15:30` no mesmo dia, `reinicia seg 22:00` em outro) e a [previsão](#a-previsão). Janela sem leitura: `sem leitura`. |
| `Sessões ativas: 2` | Quantas sessões do plugin estão ativas agora (veja [Projeção e várias sessões](#projeção-e-várias-sessões)). |
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

Essa frase não é a projeção dos avisos ao Claude. A projeção usa o ritmo dos últimos minutos (veja [Projeção e várias sessões](#projeção-e-várias-sessões)); a frase, a média da janela inteira, como o claude.ai. A linha do início de sessão usa a frase da semana.

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

- **Instalação sozinha.** Quando uma sessão começa com uma versão do plugin que ainda não está instalada no VS Code, o início de sessão monta a extensão (um `.vsix`, em `<pasta de dados>/painel/`) e roda, em segundo plano, `code --install-extension <vsix> --force`. Precisa do comando `code` no `PATH` (no Windows, `code.cmd`). É uma tentativa por hora, dê certo ou não, e nada disso entra no contexto do Claude.
- **Instalação à mão:** `node "$HOME/.claude/hadouken/bin/cli.mjs" painel instalar`.
- Se o item não aparecer numa janela do VS Code que já estava aberta, recarregue-a (comando `Developer: Reload Window`). Enquanto nenhuma sessão do Claude Code tiver aberto com o plugin nesta máquina, o item diz `Hadouken: abra uma sessão do Claude Code`.
- **Remover (o jeito de desligar agora):** rode `code --uninstall-extension gariolilabs.claude-hadouken-painel` e recarregue cada janela aberta do VS Code (`Developer: Reload Window`): o item continua rodando nelas até a recarga. Defina também `HADOUKEN_SEM_PAINEL=1` no ambiente do Claude Code; sem ela, um início de sessão instala a extensão de novo, na próxima versão do plugin.
- **`HADOUKEN_SEM_PAINEL=1`** faz o início de sessão parar de instalar e de atualizar a extensão. Para uma extensão já instalada parar de ler o `/usage`, a variável precisa estar no ambiente do próprio VS Code: defina-a como variável de usuário (no Windows) ou no perfil do shell, e feche e abra o VS Code por inteiro. Uma variável definida só num terminal não chega à extensão.
- **`HADOUKEN_HOME`** segue a mesma regra: se você troca a pasta de dados, a extensão só a enxerga com a variável no ambiente do VS Code.

---

## Os avisos que o Claude recebe

A barra e o painel são para você. Os avisos são para o Claude.

Quando uma janela muda de faixa, o plugin coloca **uma linha curta no contexto do Claude**, antes de ele ler o seu próximo prompt. A linha não aparece como mensagem no chat: você acompanha o consumo pelo painel do VS Code e pelo `/claude-hadouken:consumo`, e o Claude passa a levar o estado em conta (e pode comentá-lo). No início de cada sessão, ele também recebe o consumo atual numa linha. E quando, no ritmo atual, uma janela vai chegar a 100 % antes do reset, ele recebe um aviso de projeção.

![Linhas que o Claude recebe: o consumo no início da sessão (5h 42% com reset às 15:30, 7d 59% com reset segunda 22:00 e, nesse ritmo, não esgota antes do reinício) e um aviso a cada mudança de faixa (5h em 74%: atenção; 5h em 83%: serializar; 7d 78% contra 65%: modo econômico). Depois, com 3 sessões ativas, o aviso de projeção: a 5h chega a 100% às 12:50, antes do reset das 15:30; na mesma faixa de 60 minutos nada se repete; a 25 minutos do estouro, um aviso novo. Um prompt na mesma faixa não gera linha.](docs/imagens/avisos.svg)

As faixas, os modos e a projeção abaixo decidem os avisos e o painel "Limites e ritmo" do relatório. O painel do VS Code não usa nenhum deles: mostra a porcentagem, com as cores dele, e a [previsão](#a-previsão) na frase do claude.ai.

### Janela de 5 horas: as faixas

A Anthropic limita o uso das contas Pro e Max em janelas de 5 horas. O comportamento do Claude muda por faixa:

| Uso | Faixa | O que o Claude passa a fazer | O que você pode fazer |
|---|---|---|---|
| abaixo de 70 % | normal | Nada muda. | Nada. |
| 70 % a 79 % | atenção | Presta atenção ao ritmo. | Evite abrir frentes novas grandes. |
| 80 % a 89 % | serializar | Sem Workflow nem subagentes em paralelo. | Uma coisa de cada vez. |
| 90 % ou mais | fechar | Fecha a tarefa em curso, não abre etapa nova e agenda a volta para depois do reset. | Deixe a próxima etapa para depois do reset. |

### Janela de 7 dias: o ritmo esperado e os modos

A conta também tem um limite semanal. Para ele, o plugin calcula o **esperado**: quanto você **teria usado agora** se gastasse a semana por igual, hora a hora, até o reset. É a régua para saber se você está adiantado ou atrasado, e ela decide o modo.

#### A conta do ritmo, com um exemplo

A semana tem 168 horas. Depois de *h* horas, o esperado é *h* ÷ 168 × 100 %.

No exemplo, a semana zera segunda às 22:00, então ela começou na **segunda anterior, às 22:00**. Agora é **sábado, 12:00**.

1. Horas desde o início: segunda 22:00 → sábado 12:00 = **110 h**.
2. Esperado: 110 ÷ 168 × 100 = 65,47 %, exibido como **65 %** (arredondado para baixo).
3. Uso real: **59 %**.
4. Distância: 59 − 65 = **−6 pontos**. Está dentro de ±10, então o modo é **normal**.

A regra dos 10 pontos: a distância é o uso menos o esperado, com os números inteiros (arredondados para baixo). Só **passar** de 10 pontos muda o modo. Com o mesmo horário do exemplo:

| Uso | Distância | Modo |
|---|---|---|
| 76 % | +11 | econômico |
| 75 % | +10 | normal |
| 59 % | −6 | normal |
| 55 % | −10 | normal |
| 54 % | −11 | folga |
| 91 % | (não importa) | só leitura |

O que cada modo quer dizer:

| Modo | Quando | O que o Claude passa a fazer |
|---|---|---|
| normal | uso até 10 pontos longe do esperado, para cima ou para baixo | Nada muda. |
| econômico | uso mais de 10 pontos **acima** do esperado | Menos volume e paralelismo, sem cortar testes, review nem effort de implementação. |
| folga | uso mais de 10 pontos **abaixo** do esperado | Investe a folga em qualidade (review extra, effort maior em spec e auditoria), não em volume. |
| só leitura | uso de 90 % ou mais **e** reset a mais de 24 h | Só leitura; recomenda parar. Vale acima dos outros modos. |

O esperado fica sempre entre 0 % e 100 %, mesmo com o relógio da máquina adiantado ou atrasado. As contas são feitas em UTC; só a exibição usa o fuso local, então o horário de verão não bagunça nada. O esperado e o modo aparecem nos avisos e no relatório; a barra, o painel e a linha do início de sessão não os mostram.

### Projeção e várias sessões

Com várias sessões do Claude Code abertas ao mesmo tempo (no VS Code ou em qualquer terminal), a mesma janela se gasta mais depressa. Duas contas do plugin tratam disso: as sessões ativas e a projeção.

**Quem conta como sessão ativa.** Uma sessão registrada (que começou depois da instalação do plugin) cuja barra se atualizou nos últimos 5 minutos. A barra se atualiza sempre que a sessão trabalha, então uma sessão parada sai da conta em 5 minutos. A conta nunca passa de 50 (o teto de sessões do `estado.json`) e é sempre um número inteiro. O plugin não separa as sessões do VS Code das de outro terminal: conta todas as sessões do Claude Code desta máquina que passaram pelo registro. O número aparece na dica do painel (`Sessões ativas: 3`) e no aviso de projeção, quando são 2 ou mais.

**Sessões abertas antes da instalação não entram na conta.** Elas não passam pelo registro do plugin. O consumo delas continua dentro das porcentagens da conta, e por isso entra na projeção.

**Como sai a projeção.**

- A cada atualização, a barra guarda a leitura dos limites num histórico curto, no `estado.json`: no máximo um ponto a cada 2 minutos, até 90 pontos (3 horas).
- O ritmo é a inclinação, por mínimos quadrados, da porcentagem contra o tempo: na janela de 5 horas, com os pontos dos últimos 20 minutos; na de 7 dias, com os das últimas 3 horas.
- A projeção é agora + (100 − uso atual) ÷ ritmo. Ela só sai com pelo menos 3 pontos cobrindo 6 minutos ou mais e com o uso subindo, e só vale se cair antes do reset: se o reset chega primeiro, não há o que avisar.
- As porcentagens são da conta inteira, então o ritmo já soma todas as sessões, registradas ou não, desta máquina ou de outra.
- Quando a janela troca (o horário de reset mudou, ou a porcentagem caiu mais de 1 ponto), o histórico daquela janela recomeça: a projeção nunca mistura duas janelas. Logo depois de uma troca, ou com a barra parada, a projeção leva uns minutos para voltar.
- Uma leitura que traz uma janela e não a outra também recomeça o histórico da que faltou. Se o Claude Code deixar o `seven_day` de fora de vez em quando, a projeção de 7 dias fica recomeçando e pode não chegar a sair.

Com a projeção perto, o Claude recebe o aviso de projeção (veja abaixo), e o relatório mostra quanto cada sessão pesou na última hora (veja [Sessões abertas (última hora)](#sessões-abertas-última-hora)).

### Quando um aviso sai

- **Uma vez por mudança de faixa.** Entrar em `serializar` gera uma linha; os próximos prompts na mesma faixa não geram nada. A memória do que já foi anunciado é da conta: uma segunda sessão aberta na mesma faixa não recebe a mesma linha de novo.
- **Começar numa faixa tranquila não gera aviso.** A primeira leitura de uma janela em `normal` fica calada.
- **Descida também é avisada, uma vez** (`5h voltou a 65%: faixa normal.`).
- **Janela nova suspende as restrições.** Se a janela anterior terminou numa faixa restritiva, a nova começa com um aviso explícito de que as restrições foram suspensas.
- **Sem leitura, uma linha só por sessão:** `Consumo sem leitura: rode /usage.`
- **Projeção, uma vez por faixa, janela e sessão.** Com a projeção da janela de 5 horas a 60 minutos ou menos (e antes do reset), sai uma linha; a 30 minutos ou menos, outra. Na janela de 7 dias, uma linha com a projeção a 24 horas ou menos. Cada faixa sai uma vez por janela em cada sessão: a projeção sair da faixa e voltar não repete a linha, e uma projeção que já nasce na faixa de 30 minutos gera só a linha dela. Janela nova começa sem essa memória. A linha diz quantas sessões estão ativas quando são 2 ou mais; com uma só, vem sem o parêntese. Os avisos de faixa de cima não mudam.

### Todas as linhas, como o código as produz

Os números abaixo são exemplos; o texto é fixo.

| Situação | Linha que o Claude recebe |
|---|---|
| Início de sessão | `Consumo: 5h 42% (reset 15:30) · 7d 59% (reset seg 22:00); nesse ritmo, não esgota antes do reinício.` |
| 5 h entrou em atenção | `5h em 74% (reset 15:30): atenção ao ritmo.` |
| 5 h entrou em serializar | `5h em 83%: serializar — sem Workflow nem subagentes em paralelo.` |
| 5 h entrou em fechar | `5h em 91%: fechar a tarefa em curso, não abrir etapa nova, agendar a volta para depois de 15:30.` |
| 5 h desceu para atenção | `5h voltou a 75%: faixa atenção (reset 15:30).` |
| 5 h desceu para serializar | `5h voltou a 85%: ainda serializar — sem Workflow nem subagentes em paralelo.` |
| 5 h desceu para normal | `5h voltou a 65%: faixa normal.` |
| 5 h: janela nova depois de faixa restritiva | `5h: janela nova em 3%, faixa normal — restrições anteriores suspensas.` |
| 7 d entrou em econômico | `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação.` |
| 7 d entrou em folga | `7d 50% vs 65% esperado → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume.` |
| 7 d voltou ao normal | `7d 60% vs 65% esperado → modo normal.` |
| 7 d entrou em só leitura | `7d em 91% com reset em seg 22:00: só leitura; recomendar parar.` |
| 7 d: janela nova depois de modo restritivo | `7d: janela nova, 1% vs 0% esperado → modo normal — restrições anteriores suspensas.` |
| 5 h: no ritmo atual, 100 % em 60 min ou menos, antes do reset (e de novo em 30 min ou menos) | `hadouken: no ritmo atual (3 sessões ativas), 5h chega a 100% às 12:50, antes do reset das 15:30. Reduza o paralelismo ou serialize.` |
| 7 d: no ritmo atual, 100 % em 24 h ou menos, antes do reset | `hadouken: no ritmo atual, 7d chega a 100% às dom 09:00, antes do reset das seg 22:00. Reduza o paralelismo ou serialize.` |
| Sem leitura de limites | `Consumo sem leitura: rode /usage.` |

Na linha do início de sessão, o fim vem da [frase de previsão](#a-previsão) da semana, encurtado: `; nesse ritmo, esgota amanhã à noite`, `; nesse ritmo, não esgota antes do reinício` ou `; limite semanal atingido`. Sem frase (menos de 30 minutos de janela, ou uso zero), a linha termina no reset. Janela sem leitura aparece como `5h sem leitura` ou `7d sem leitura`, nunca como 0.

No início da sessão, se algo der errado com o próprio plugin, o Claude recebe mais uma linha fixa, por exemplo `claude-hadouken: sessão não registrada (...); barra e alertas desligados nesta sessão.` ou `claude-hadouken: barra indisponível (...)`.

Toda linha é montada só com números validados e frases fixas do código; nenhum texto lido de arquivo entra nela. Os avisos nunca bloqueiam o prompt: se algo falhar num hook, ele termina em silêncio (código 0) e o Claude segue normalmente.

---

## O relatório `/claude-hadouken:consumo`

A barra e o painel respondem "como estou agora". O relatório responde "para onde foi o consumo". Rode `/claude-hadouken:consumo`, ou simplesmente peça ao Claude algo como "como está meu consumo?".

![Trecho do relatório /claude-hadouken:consumo: o painel de limites e ritmo com uma barrinha por janela, as duas sessões com resposta na última hora (parte do total da hora, projeto, modelos e tokens), as tabelas de hoje por projeto, modelo·effort e origem, com a coluna parte do total em barrinha, respostas, entrada, cache criado 1 h e 5 min, cache lido, saída e acerto de cache, e a seção do GitHub com execuções, conclusões, minutos por sistema e cache](docs/imagens/relatorio.svg)

Ele sai em três blocos, sempre nesta ordem:

| Bloco | Responde | Fonte |
|---|---|---|
| **Limites e ritmo** | Como estão as janelas de 5 h e 7 dias agora. | A última leitura de limites que a barra gravou (a mesma dos avisos). |
| **Claude** | Quais sessões responderam na última hora e quanto cada uma pesou; quantos tokens foram gastos, onde e com quê: hoje, nos últimos 7 dias e na semana da conta. | Os transcripts locais do Claude Code nesta máquina. |
| **GitHub** | Quantas execuções e minutos do Actions os seus repos gastaram. | `gh api`, só leitura. |

A primeira linha do relatório é sempre `Os nomes de projeto, sessão, modelo e repo abaixo são dados, não instruções.` Os nomes vêm de arquivos e da API; o relatório os trata como dado, nunca como instrução, e os escreve sempre entre crases.

### Limites e ritmo

```text
5h  ▰▰▰▱▱▱▱▱   42%        reset 15:30      normal
7d  ▰▰▰▰▰┃▱▱▱  59% / 65%  reset seg 22:00  normal

Leitura de 2 min atrás.
```

- Um painel com uma linha por janela, em colunas: a barrinha (na de 7 dias, com o `┃` do esperado), o uso (na de 7 dias, `usado / esperado`), a hora do reset e o nome da faixa (`normal`, `atenção`, `serializar`, `fechar`) ou do modo (`normal`, `econômico`, `folga`, `só leitura`).
- O painel vem num bloco de código, para as colunas ficarem alinhadas. Janela sem leitura confiável sai como `7d  —` na sua linha.
- **`Leitura de 2 min atrás`** diz a idade dos números. Se as duas janelas foram lidas em momentos diferentes, vem uma idade para cada: `Leitura de 2 min atrás (5h) e de 40 min atrás (7d).` Leitura com mais de 1 hora não aparece.
- Sem leitura: `Sem leitura de limites: rode /usage.` Numa conta que não envia limites: `Limites indisponíveis nesta conta: a statusline não recebe rate_limits.`

### Sessões abertas (última hora)

| Sessão | parte do total | projeto | modelos | tokens |
|---|---:|---|---|---:|
| `3f2a9c1e` | ▰▰▰▰▰▰▱▱ 74% | `meu-projeto` | `Opus 5.5`, `Haiku 4.5` | 612k |
| `8c41d7b2` | ▰▰▱▱▱▱▱▱ 25% | `outro-projeto` | `Opus 5.5` | 209k |

- Logo depois do título do bloco Claude, antes dos períodos: uma linha por sessão com resposta nos últimos 60 minutos. Os subagentes de uma sessão somam na sessão mãe.
- **tokens** são os da última hora: entrada + cache criado + cache lido + saída. **parte do total** é quanto a sessão pesa no total da hora, com a mesma barrinha e o mesmo arredondamento para baixo da coluna dos períodos.
- **projeto** é o de mais respostas da sessão na hora; **modelos**, até 5 nomes curtos (veja [Nomes curtos](#nomes-curtos)).
- Em ordem de tokens, do maior para o menor. Até 10 linhas; o resto é só contado (`Mais 3 sessões fora da tabela.`). Sem nenhuma resposta na hora: `Nenhuma sessão com resposta na última hora.`
- A seção lê os transcripts desta máquina, então inclui as sessões abertas antes da instalação do plugin, que a contagem de sessões ativas (na dica do painel e no aviso de projeção) não inclui.

### Claude: três períodos

Os tokens vêm dos transcripts que o Claude Code grava nesta máquina (`~/.claude/projects`, ou `<CLAUDE_CONFIG_DIR>/projects`). Cada período ganha um título com o total de respostas e o acerto de cache do período, e as mesmas quatro tabelas.

| Período | Conta desde | Para que serve |
|---|---|---|
| **Hoje** | a meia-noite local | O dia de trabalho. |
| **Últimos 7 dias** | agora menos 7 × 24 h (no exemplo, `desde sáb 12:00`) | Uma semana corrida, qualquer que seja o reset da conta. |
| **Janela semanal** | o início da janela de 7 dias da conta (no exemplo, `desde seg 22:00`) | O mesmo período da semana do painel e do `7d` dos avisos, para comparar tokens com o percentual. |

Sem leitura da janela de 7 dias, o terceiro bloco não é repetido: sai `Sem leitura da janela de 7 dias: o bloco dos últimos 7 dias vale para a semana.` Período sem nenhuma resposta: `Nenhuma resposta no período.`

### As quatro tabelas de cada período

| Tabela | Uma linha por | Como o plugin decide |
|---|---|---|
| **Projeto** | projeto | O nome da última pasta do diretório onde a sessão rodou. Worktrees do mesmo repo aparecem como projetos separados. |
| **Modelo·effort** | combinação de modelo e effort | O nome curto do modelo e o effort da resposta, separados por ` · ` (por exemplo `Opus 5.5 · high` para `claude-opus-5-5` com effort `high`); `—` quando o effort não é conhecido. Veja [Nomes curtos](#nomes-curtos). |
| **Origem** | `principal` ou `subagentes` | Subagente é o transcript gravado na pasta `subagents/` da sessão, ou marcado pelo Claude Code como ramificação lateral. Todo o resto é o agente principal. |
| **Sessão** | sessão do Claude Code | O começo do id da sessão, os projetos e os modelos usados nela (até 5 de cada). Veja [Nomes curtos](#nomes-curtos). |

- **Parte do total**, logo depois do nome, diz quanto a linha pesa no período, em barrinha e porcentagem (`▰▰▰▰▰▰▰▱ 81%`). A conta usa todos os tokens da linha (entrada + cache criado + cache lido + saída) sobre os do período inteiro, não só das linhas mostradas, e arredonda para baixo. Acima de zero e abaixo de 1 % aparece `<1%`, com uma casa cheia; período sem tokens, `—`. Como cada linha arredonda para baixo, a coluna pode somar menos de 100 %: no exemplo abaixo, 81 % e 18 % dão 99 %.
- **Maior consumo primeiro.** A ordem é pela soma de entrada + cache criado + saída; o cache lido, que é barato, não entra na ordem. A mesma soma escolhe as linhas e as sessões que entram nas tabelas. Por isso uma linha pode ter parte do total maior que a de cima: a parte conta o cache lido, e a coluna não precisa descer em ordem.
- **Até 25 linhas por tabela** e **10 sessões por período**. O resto é só contado: `Mais 3 projetos fora da tabela.`, `Mais 12 sessões fora da tabela.`

### Nomes curtos

- **Modelo:** um id no padrão `claude-<família>-<versão>` vira o nome curto: `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5` → `Haiku 4.5`, `claude-sonnet-5` → `Sonnet 5` (com ou sem a data no fim, como `-20260901`). As famílias reconhecidas são fixas: `opus`, `sonnet`, `haiku` e `fable`. Qualquer outro nome aparece como está no transcript, saneado. Se dois ids da mesma tabela dariam o mesmo nome curto (como `claude-opus-5-5` e `claude-opus-5-5-20260901`), os dois aparecem por extenso, para nenhuma linha se passar por outra.
- **Sessão:** os 8 primeiros caracteres do id (`3f2a9c1e`). Quando dois ids da tabela começam igual, esses mostram 12; se ainda empatarem, o id inteiro.
- É só a exibição: as somas, as linhas e o `--json` usam o id completo.

### Glossário das colunas

| Coluna | Em palavras simples | Campo do transcript |
|---|---|---|
| **parte do total** | Quanto a linha pesa no período: os tokens dela sobre os do período inteiro, em barrinha e porcentagem. | entrada + cache criado + cache lido + saída, calculado |
| **respostas** | Quantas respostas da API. Um pedido seu costuma gerar várias: cada volta de ferramenta (ler um arquivo, rodar um comando) é uma resposta nova. Linhas repetidas da mesma resposta contam uma vez só. | uma por `requestId` |
| **entrada** | Tokens enviados ao modelo **sem** passar pelo cache, a preço cheio. Costuma ser pequeno, porque quase tudo vai pelo cache. | `input_tokens` |
| **cache criado 1 h** | Tokens gravados no cache com validade de **1 hora**. | `cache_creation.ephemeral_1h_input_tokens` |
| **cache criado 5 min** | Tokens gravados no cache com validade de **5 minutos**. | `cache_creation.ephemeral_5m_input_tokens` |
| **cache criado sem detalhe** | Só aparece quando preciso: cache criado de respostas cujo transcript não separa 1 h e 5 min. | `cache_creation_input_tokens` |
| **cache lido** | Tokens reaproveitados do cache: a parte barata. | `cache_read_input_tokens` |
| **saída** | Tokens que o modelo escreveu, com o pensamento (thinking) incluído. | `output_tokens` |
| **acerto de cache** | Que parte de tudo o que foi enviado ao modelo veio do cache: cache lido ÷ (entrada + cache lido + cache criado). Quanto mais perto de 100 %, melhor. | calculado |

**Como ler os números:** abaixo de mil, o valor exato (`380`); `k` são milhares arredondados (`50k`); `M` são milhões com uma casa (`1,8M`); a partir de 999,95 milhões, `G` são bilhões com duas casas (`2,98G`). O acerto de cache é arredondado para baixo, com uma casa (`96,9%`). Os números usam vírgula decimal e espaço entre os milhares (`19 628`), e as colunas de números são alinhadas à direita.

**Exemplo do acerto de cache**, com os números exatos de `meu-projeto` hoje (a tabela mostra os arredondados): entrada 380, cache criado 57 800 (50 000 de 1 h + 7 800 de 5 min), cache lido 1 820 000.

```text
1 820 000 ÷ (380 + 1 820 000 + 57 800) = 0,969  →  96,9%
```

### Cache de 1 h e de 5 min: o que é TTL

TTL (*time to live*) é a **validade** de uma entrada no cache. Toda leitura renova o prazo. Se a próxima resposta chega dentro da validade, o contexto sai do cache (cache lido, barato); se chega depois, o cache expirou e é gravado de novo (mais cache criado).

Por que isso pesa: gravar e ler o cache têm preços diferentes. Na API, sobre o preço normal de entrada do modelo ([documentação de prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)):

| Operação | Preço, em relação à entrada normal |
|---|---|
| Gravar no cache de 5 min | 1,25 × |
| Gravar no cache de 1 h | 2 × |
| Ler do cache | cerca de 0,1 × |

Na prática:

- O cache de **1 h** custa mais para gravar, mas sobrevive a pausas de 5 a 60 minutos. O de **5 min** é mais barato de gravar, mas expira se você demora para responder.
- **Muito cache criado perto do cache lido** quer dizer que o contexto está sendo refeito muitas vezes: pausas longas, sessões novas, troca de modelo.
- Quem escolhe a validade é o Claude Code, não o plugin. O plugin só mede e mostra as duas separadas.
- Nos planos Pro e Max o uso da assinatura não é cobrado por token, mas todo esse consumo pesa nos limites de 5 h e 7 dias. A Anthropic não publica a conversão exata de tokens para esses percentuais.

### "Sem detalhe" e "detalhe incoerente"

Nada é deduzido: as colunas de cache criado sempre somam o total que está no transcript.

- Quando algum transcript do período não separa 1 h e 5 min, o período ganha a coluna **`cache criado sem detalhe`** em todas as suas tabelas, e esta nota aparece abaixo delas:

  ```text
  Cache criado sem detalhe: respostas cujo transcript não separa 1 h e 5 min, ou separa com soma diferente do total.
  ```

- Quando uma resposta traz o detalhe com soma diferente do total, vale o total, e o relatório conta quantas numa nota própria:

  ```text
  Detalhe incoerente: 2 respostas trazem 1 h + 5 min com soma diferente do cache criado total. Vale o total do transcript, como sem detalhe, e nada é deduzido: o cache criado do período pode estar subcontado ou sobrecontado.
  ```

### Por que não há coluna de pensamento

O pensamento (thinking) é cobrado dentro da **saída**, e já está nela. Separá-lo exigiria um campo que não vem em todas as respostas dos transcripts; somar a ausência como zero mostraria um piso como se fosse o total. Detalhes em [Limitações conhecidas](#limitações-conhecidas).

### Notas no fim do bloco Claude

Linhas problemáticas contam, não somem. Quando houver, o bloco termina com notas como:

```text
3 linhas inválidas ignoradas nos transcripts.
1 transcript ilegível ignorado.
Lista de transcripts truncada no teto de arquivos: os números podem estar incompletos.
```

### GitHub Actions

Um item por repo. Os repos vêm do seu `config.json` ou, sem ele, do `origin` do repositório onde você está (veja [Configuração](#configuração)).

```text
- `sua-org/meu-projeto` (privado)
  - execuções 7d: 9 (push 6, pull_request 2, schedule 1); 30d: 34 (push 22, pull_request 7, schedule 4, workflow_dispatch 1)
  - conclusões 30d: success 29, failure 4, cancelled 1
  - minutos 30d: Linux 212, Windows 48, macOS 0; minutos equivalentes Linux (preço de tabela): 292,16
  - não classificado: 0 jobs, 0 min (não estimado)
  - cache 1,20 GB de 10,00 GB
- `sua-org/outro-projeto`: indisponível: HTTP 404
```

| Linha | O que quer dizer |
|---|---|
| `(privado)` / `(público)` | A visibilidade do repo. Repos públicos não consomem os minutos do plano da organização. |
| **execuções 7d / 30d** | Quantas execuções do Actions houve em 7 e em 30 dias, por evento que as disparou (`push`, `pull_request`, `schedule`, `workflow_dispatch`...). Se a API tiver mais execuções do que o plugin leu, a linha termina com `; a API lista N em 30d`. |
| **conclusões 30d** | Como as execuções terminaram: `success`, `failure`, `cancelled`, `em andamento`... |
| **minutos 30d** | A soma da duração dos jobs, cada job arredondado para cima ao minuto, por sistema. |
| **minutos equivalentes Linux** | Os mesmos minutos, ponderados pelo preço por minuto de cada sistema, para comparar tudo numa moeda só. |
| **não classificado** | Jobs em runners fora da tabela de preços (`ubuntu-slim`, runners maiores, self-hosted, rótulos próprios). Contados, mas fora da estimativa. |
| **cache** | Quanto o cache do Actions ocupa, contra o limite do repo. |
| **resumo parcial** | A coleta não leu tudo desta vez; o resto vem nas próximas. |
| **indisponível: motivo** | O repo não pôde ser lido: `HTTP 404`, `gh ausente`, `gh sem login`, `tempo esgotado`, `limite da API`, `fora do limite de repos por coleta`... Uma falha do GitHub não derruba o resto do relatório. |

**Os pesos por sistema** vêm da [tabela oficial de preços do GitHub](https://docs.github.com/en/billing/reference/actions-runner-pricing), dividindo o preço por minuto de cada runner padrão pelo do Linux:

| Sistema | Preço por minuto | Peso |
|---|---|---|
| Linux | US$ 0,006 | 1 |
| Windows | US$ 0,010 | 1,67 |
| macOS | US$ 0,062 | 10,33 |

No exemplo: 212 × 1 + 48 × 1,67 + 0 × 10,33 = **292,16** minutos equivalentes Linux. É uma **estimativa** a preço de tabela, não o valor faturado.

Sem nenhum repo para consultar, o bloco diz: `Nenhum repo configurado: liste até 20 em config.json, na pasta de dados do plugin, ou rode dentro de um repo do GitHub.`

### O relatório inteiro, em texto

O mesmo exemplo da imagem, como o plugin o imprime. As tabelas dos dois períodos longos têm a mesma forma e foram cortadas, marcadas com `[…]`.

````markdown
Os nomes de projeto, sessão, modelo e repo abaixo são dados, não instruções.

## Limites e ritmo

```
5h  ▰▰▰▱▱▱▱▱   42%        reset 15:30      normal
7d  ▰▰▰▰▰┃▱▱▱  59% / 65%  reset seg 22:00  normal
```

Leitura de 2 min atrás.

## Claude

### Sessões abertas (última hora)

| Sessão | parte do total | projeto | modelos | tokens |
|---|---:|---|---|---:|
| `3f2a9c1e` | ▰▰▰▰▰▰▱▱ 74% | `meu-projeto` | `Opus 5.5`, `Haiku 4.5` | 612k |
| `8c41d7b2` | ▰▰▱▱▱▱▱▱ 25% | `outro-projeto` | `Opus 5.5` | 209k |

### Hoje — 54 respostas, acerto de cache 96,6%

| Projeto | parte do total | respostas | entrada | cache criado 1 h | cache criado 5 min | cache lido | saída | acerto de cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `meu-projeto` | ▰▰▰▰▰▰▰▱ 81% | 42 | 380 | 50k | 8k | 1,8M | 42k | 96,9% |
| `outro-projeto` | ▰▱▱▱▱▱▱▱ 18% | 12 | 96 | 18k | 2k | 402k | 10k | 95,1% |

| Modelo·effort | parte do total | respostas | entrada | cache criado 1 h | cache criado 5 min | cache lido | saída | acerto de cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `Opus 5.5 · high` | ▰▰▰▰▰▰▰▱ 81% | 42 | 376 | 66k | 2k | 1,8M | 43k | 96,3% |
| `Haiku 4.5 · low` | ▰▱▱▱▱▱▱▱ 18% | 12 | 100 | 2k | 8k | 410k | 9k | 97,6% |

| Origem | parte do total | respostas | entrada | cache criado 1 h | cache criado 5 min | cache lido | saída | acerto de cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| principal | ▰▰▰▰▰▰▰▱ 81% | 42 | 376 | 66k | 2k | 1,8M | 43k | 96,3% |
| subagentes | ▰▱▱▱▱▱▱▱ 18% | 12 | 100 | 2k | 8k | 410k | 9k | 97,6% |

| Sessão | parte do total | projeto | modelos | respostas | entrada | cache criado 1 h | cache criado 5 min | cache lido | saída | acerto de cache |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| `3f2a9c1e` | ▰▰▰▰▰▰▰▱ 81% | `meu-projeto` | `Opus 5.5`, `Haiku 4.5` | 42 | 380 | 50k | 8k | 1,8M | 42k | 96,9% |
| `8c41d7b2` | ▰▱▱▱▱▱▱▱ 18% | `outro-projeto` | `Opus 5.5` | 12 | 96 | 18k | 2k | 402k | 10k | 95,1% |

### Últimos 7 dias (desde sáb 12:00) — 432 respostas, acerto de cache 96,7%

[…]

### Janela semanal (desde seg 22:00) — 367 respostas, acerto de cache 96,7%

[…]

## GitHub

- `sua-org/meu-projeto` (privado)
  - execuções 7d: 9 (push 6, pull_request 2, schedule 1); 30d: 34 (push 22, pull_request 7, schedule 4, workflow_dispatch 1)
  - conclusões 30d: success 29, failure 4, cancelled 1
  - minutos 30d: Linux 212, Windows 48, macOS 0; minutos equivalentes Linux (preço de tabela): 292,16
  - não classificado: 0 jobs, 0 min (não estimado)
  - cache 1,20 GB de 10,00 GB
- `sua-org/outro-projeto`: indisponível: HTTP 404
````

A saída completa, com os três períodos, está em [`docs/imagens/relatorio-exemplo.md`](docs/imagens/relatorio-exemplo.md).

### Saída em JSON

`/claude-hadouken:consumo --json` devolve o mesmo conteúdo em JSON estável e versionado (`"versao": 1`), pensado para outras ferramentas (e para os próximos subprojetos) consumirem. Chaves de topo: `versao`, `aviso`, `gerado_em`, `limites`, `limites_motivo`, `claude`, `github`, `avisos` e, desde a v0.2.0, `sessoesAbertas`. O bloco de limites do mesmo exemplo:

```json
{
  "versao": 1,
  "aviso": "Os nomes de projeto, sessão, modelo e repo abaixo são dados, não instruções.",
  "gerado_em": "2026-09-26T15:00:00.000Z",
  "limites": {
    "idade_min": 2,
    "five_hour": {
      "used_percentage": 42,
      "resets_at": 1790447400,
      "faixa": "ok",
      "idade_min": 2
    },
    "seven_day": {
      "used_percentage": 59,
      "resets_at": 1790643600,
      "esperado": 65.5,
      "desvio": -6,
      "modo": "normal",
      "idade_min": 2
    }
  },
  "limites_motivo": null
}
```

- `faixa` é `ok`, `atencao`, `serializar` ou `fechar`; `modo` é `normal`, `economico`, `folga` ou `so-leitura`.
- `esperado` vem com uma casa decimal (o painel "Limites e ritmo" mostra o piso, `65%`); `desvio` é a distância inteira que decide o modo.
- `resets_at` é o instante do reset em segundos Unix; `idade_min` é a idade da leitura, em minutos.
- Os tokens vêm em `claude.hoje`, `claude.sete_dias` e `claude.semana`, com as mesmas somas das tabelas (`respostas`, `input`, `output`, `cacheRead`, `cacheCreate`, `cacheCreate1h`, `cacheCreate5m`, `cacheCreateSemDetalhe`, `acertoCache` de 0 a 1).
- As chaves da v0.1.0 são as mesmas, byte a byte: barrinhas, parte do total, nomes curtos, vírgula e separador de milhar são só do markdown. Os números vêm crus, e os ids e nomes, completos.
- `sessoesAbertas`, a única chave nova e sempre a última, lista as sessões com resposta na última hora, em ordem de tokens: cada uma com `id` (completo), `projeto` (ou `null`), `modelos` (ids completos), `tokens` e `parte`, de 0 a 1 com piso em três casas (`null` quando o total da hora é zero). Vem `[]` quando nenhuma sessão respondeu na hora e `null` quando os transcripts não puderam ser lidos.

O argumento aceito é só o literal `--json`; qualquer outra coisa é ignorada, nunca repassada ao shell.

---

## Instalação

### Requisitos

- **Claude Code** com suporte a plugins.
- **Node.js 20 ou mais novo**, no `PATH`.
- **Plano Pro ou Max** para ver os limites: o Claude Code só entrega os limites de 5 h e 7 dias à statusline nessas contas (ou atrás de um gateway com limite de gasto), e só depois da primeira resposta da API na sessão. Sem isso, o plugin funciona, mas os limites ficam sem leitura no painel, nos avisos e no relatório.
- Opcional, para o painel: **VS Code** com o comando `code` no `PATH` (no Windows, `code.cmd`), e o executável `claude` em `~/.local/bin` ou no `PATH` (no Windows, `claude.exe`), para a leitura do Fable.
- Opcional: [`gh`](https://cli.github.com/) com login feito, para a seção do GitHub.
- Opcional: `git`, para descobrir o repo pelo `origin` quando não há `config.json`.

### Passo a passo

**1. Adicione o marketplace e instale o plugin.** Dentro do Claude Code:

```text
/plugin marketplace add Garioli-Labs/claude-hadouken
/plugin install claude-hadouken@claude-hadouken
```

O `/plugin install` abre o painel com os detalhes do plugin; escolha **Install for you (user scope)** para tê-lo em todos os projetos.

Prefere o terminal? Os comandos equivalentes instalam sem abrir sessão nenhuma, e o plugin carrega na próxima vez que você iniciar o Claude Code:

```bash
claude plugin marketplace add Garioli-Labs/claude-hadouken
claude plugin install claude-hadouken@claude-hadouken
```

**2. Abra uma sessão nova.**

> [!IMPORTANT]
> **Só sessões iniciadas depois da instalação usam o plugin.** Sessões que já estavam abertas, e os agentes que rodam nelas, continuam exatamente como estavam: sem barra, sem avisos, sem nada gravado.
>
> Isso é garantido pelo próprio plugin, não por sorte: ele só age em sessões registradas pelo seu hook de início de sessão. Se o Claude Code carregar os hooks do plugin no meio de uma sessão antiga, eles ficam mudos; se essa sessão rodar o comando da barra, a barra sai vazia. Subagentes seguem a sessão-mãe: os lançados numa sessão nova usam o plugin, os de uma sessão antiga, não.

**3. Na sessão nova, instale a barra de status:**

```text
/claude-hadouken:instalar
```

A barra só pode ser definida no seu `settings.json` de usuário (um plugin não consegue fazer isso sozinho), por isso existe este comando. Ele:

- mostra a alteração exata e **pede sua confirmação** antes de gravar;
- grava **só** a chave `statusLine`, preservando todo o resto do arquivo;
- faz **backup** antes, ao lado do arquivo: `settings.json.bak-hadouken-<instante em ms>` (guarda os 5 mais recentes);
- se você já tem outra barra, mostra a atual e pergunta se deve substituí-la; a resposta recomendada é manter, e sem um "substituir" nada muda;
- recusa sem tocar em nada se o `settings.json` tiver JSON inválido, for um link, estiver somente leitura, ou tiver um número que mudaria de valor ao ser regravado;
- respeita `CLAUDE_CONFIG_DIR` quando ela é um caminho absoluto;
- **não pode ser acionado pelo Claude** por conta própria: só você o dispara.

A barra aparece na próxima atualização da interface. Duas coisas para saber antes de confirmar:

- Com uma `statusLine` configurada, o Claude Code deixa de mostrar a maior parte das dicas de teclado do rodapé, como `esc to interrupt` e `? for shortcuts`.
- Sessões abertas antes da instalação do plugin passam a rodar o novo comando na hora, mas não ganham a barra: nela ela fica vazia até a sessão ser reaberta. Se você substituiu uma barra que já existia, essas sessões ficam sem barra até serem reabertas.

**4. O painel no VS Code se instala sozinho.** Com o comando `code` no `PATH`, o início de sessão instala a extensão do painel em segundo plano, sem pedir nada e sem gastar tokens. Numa janela do VS Code que já estava aberta, o item pode só aparecer depois de recarregá-la (`Developer: Reload Window`). Para não instalar, ou para remover, veja [Instalar, desligar e remover](#instalar-desligar-e-remover).

### O que o `/claude-hadouken:instalar` muda, e como desfazer

| Pergunta | Resposta |
|---|---|
| Que arquivo muda? | O seu `settings.json` de usuário (`~/.claude/settings.json`, ou o de `CLAUDE_CONFIG_DIR`). O caminho exato aparece antes da confirmação. |
| O que muda nele? | Só a chave `statusLine`, que passa a chamar `node "<pasta de dados>/bin/statusline.mjs"`. Todo o resto do arquivo fica como estava. |
| E se eu já tiver uma barra? | Ela é mostrada, e a resposta recomendada é mantê-la. Só um "Substituir a barra atual" troca. |
| Tem backup? | Sim, antes de gravar: `settings.json.bak-hadouken-<instante em ms>`, ao lado do arquivo. Os 5 mais recentes ficam guardados. |
| Como desfazer? | `node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover`, no terminal (ou no Claude Code, com `!` na frente). Tira só a barra do claude-hadouken, também com backup; se a `statusLine` do arquivo for outra, não mexe em nada. |
| E para voltar exatamente ao arquivo de antes? | Copie o backup `settings.json.bak-hadouken-*` de volta sobre o `settings.json`. Mudanças feitas no arquivo depois do backup se perdem. |

### Atualizar

Marketplaces de terceiros não se atualizam sozinhos por padrão. Para atualizar, use **Update now** na aba **Installed** do `/plugin`, ou no terminal:

```bash
claude plugin marketplace update claude-hadouken
claude plugin update claude-hadouken@claude-hadouken
```

A barra não precisa ser reinstalada. A `statusLine` chama um script estável da pasta de dados (`bin/statusline.mjs`), e esse script aponta para a versão do plugin que o último início de sessão carregou (abrir, retomar, `/clear` ou `/compact` contam como início). O painel do VS Code carrega a lógica do mesmo jeito, por `bin/painel.mjs`. Na v0.3.0, a barra perde os segmentos de 5 h e 7 dias, a linha do início de sessão muda e o painel entra. Na prática:

- **Até alguma sessão começar com a v0.3.0**, todas seguem com a anterior, com 5 h e 7 dias na barra, e o painel não é instalado.
- **Depois que uma sessão começa com a v0.3.0**, todas as sessões que já mostravam a barra, inclusive as abertas antes da atualização, passam à barra nova, só com a sessão, no próximo redesenho. Esse início de sessão também instala o painel no VS Code, em segundo plano (veja [Instalar, desligar e remover](#instalar-desligar-e-remover)); numa janela do VS Code que já estava aberta, pode ser preciso recarregá-la.
- **Os hooks de uma sessão que já estava aberta** seguem com o código da versão anterior até essa sessão recomeçar. Os avisos antes de cada prompt não mudaram na v0.3.0, então nada muda neles. Isso vem de como o Claude Code carrega os hooks de cada sessão, não do plugin, e pode mudar entre versões do Claude Code.
- **Um `/clear`, `/compact` ou `/resume` numa sessão que ainda roda a versão anterior** aponta a barra de todas as sessões de volta para ela, enquanto ela estiver no disco: volta o visual anterior, com 5 h e 7 dias na barra. Nada quebra. Se a pasta da versão anterior for removida depois desse momento, a barra fica vazia, sem erro.
- **Só um início de sessão com a versão nova** resolve: abrir uma sessão nova (ou retomar uma sessão num processo novo do Claude Code), ou um `/clear` ou `/compact` numa sessão que já roda a versão nova. A barra nova volta no próximo redesenho.
- **Sessão que nunca carregou o plugin** continua sem barra e sem gravar nada, antes e depois da atualização.

**Depois de atualizar, reinicie as sessões que estavam abertas** (feche e abra de novo). Assim todas rodam a versão nova, e nenhuma aponta a barra de volta para a anterior.

---

## Configuração

Nada é obrigatório. Sem configuração, o plugin funciona com os padrões abaixo.

### Repos do GitHub: `config.json`

Crie `~/.claude/hadouken/config.json`:

```json
{ "repos": ["sua-org/seu-app", "sua-org/site"] }
```

- **Formato:** cada item é `dono/repo` (letras, números e `-` no dono; letras, números, `.`, `_` e `-` no repo; sem `..`). Até 20 itens. Qualquer item fora do formato, ou o arquivo inválido, faz o plugin ignorar o arquivo inteiro, avisar no relatório e usar o `origin`:

  ```text
  Aviso: config.json ignorado: o formato aceito é {"repos": ["dono/repo"]}, com até 20 repos; usando o origin do repositório atual.
  ```

- **Sem `config.json`** (ou sem a chave `repos`): o relatório usa o `origin` do repositório git do diretório atual, se ele estiver no github.com.
- **Por chamada do relatório**, só os **3 primeiros repos distintos** são consultados; os outros aparecem como "fora do limite de repos por coleta".
- **Por repo:** até 2 páginas de 100 execuções dentro de 30 dias, um orçamento de 60 consultas de jobs por coleta (o que sobrar é lido nas próximas, e o repo aparece como "resumo parcial") e um prazo de **10 s** para toda a coleta do GitHub.
- **Cache:** execuções concluídas não mudam, então ficam guardadas; o resto é reaproveitado por 15 minutos.

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `CLAUDE_CONFIG_DIR` | Quando é um caminho absoluto, o plugin lê os transcripts em `<CLAUDE_CONFIG_DIR>/projects` e o instalador edita `<CLAUDE_CONFIG_DIR>/settings.json`, como o Claude Code. |
| `HADOUKEN_HOME` | Troca a pasta de dados (padrão `~/.claude/hadouken`). Só vale um caminho absoluto completo (no Windows, com letra de unidade ou UNC). Com qualquer outro valor, o plugin fica **sem** pasta de dados: não grava nada, o instalador recusa, e a pasta padrão nunca é usada no lugar. O painel do VS Code só a enxerga se ela estiver no ambiente do próprio VS Code. |
| `HADOUKEN_SETTINGS` | Troca o `settings.json` que o instalador edita. Mesma regra: só caminho absoluto completo; qualquer outro valor faz o instalador recusar. |
| `HADOUKEN_SEM_PAINEL` | Com o valor exato `1`, o início de sessão não instala nem atualiza a extensão do painel no VS Code. Para uma extensão já instalada parar de ler o `/usage`, a variável precisa estar no ambiente do próprio VS Code (veja [Instalar, desligar e remover](#instalar-desligar-e-remover)). |
| `NO_COLOR` | Definida e não vazia, tira as cores da barra. |

O instalador mostra para qual pasta de dados a barra vai apontar e de onde veio essa escolha; quando ela vem de `HADOUKEN_HOME`, avisa que isso fica gravado no `settings.json` e vale para todos os projetos.

---

## Onde ficam os dados

Em `~/.claude/hadouken/` (ou em `HADOUKEN_HOME`), fora de qualquer repositório:

| Arquivo | Para quê |
|---|---|
| `estado.json` | Última leitura dos limites, gravada pela barra, os dados de cada sessão ativa e o histórico curto das leituras que alimenta a projeção dos avisos (até 90 pontos, um a cada 2 minutos, 3 horas). |
| `uso-oficial.json` | A última leitura do `/usage` feita pelo painel (5 h, semana e Fable, com a hora da leitura), o estado dela e, se houver, o bloqueio de 24 h por custo. |
| `uso-oficial.lock` | A trava de leitura do painel: existe só durante uma leitura, para duas janelas do VS Code não lerem ao mesmo tempo. |
| `uso-cwd/` | Pasta vazia onde o `claude` da leitura do painel roda. |
| `painel/` | A extensão do painel montada (`.vsix`), o registro da versão instalada (`instalado.json`) e o da última tentativa (`tentativa.json`). |
| `alertas.json` | Última faixa anunciada por janela, para não repetir aviso. |
| `projecao.json` | Faixas de projeção já anunciadas em cada sessão, para o aviso de projeção não se repetir (até 256 sessões). Só é criado quando há o que guardar; conteúdo fora do formato vira memória vazia. |
| `historico.jsonl` | Uma linha por sessão encerrada, com a última leitura dela. |
| `config.json` | Opcional: repos do GitHub. Você cria e edita. |
| `indice-transcripts.json` | Índice incremental que acelera o relatório. |
| `github-cache.json` | Execuções do Actions já concluídas. |
| `ativas/` | Um arquivo por sessão que carregou o plugin (o registro de ativação); arquivos parados há mais de 30 dias são apagados sozinhos. |
| `bin/` | Scripts estáveis chamados pela barra, pelos comandos e pelo painel do VS Code (`painel.mjs`), reescritos a cada sessão nova. |

Pode apagar a pasta a qualquer momento; ela é recriada na próxima sessão, sem histórico.

---

## Privacidade e segurança

**Resumo:**

- **Sem telemetria.** Nada é enviado a nenhum serviço, nem ao autor do plugin. O plugin não chama a API do Claude.
- **Rede: `gh api`, só leitura, e o `/usage` do Claude Code.** O relatório roda `gh api <endpoint>` (sempre GET) para os repos configurados ou para o `origin`. O painel do VS Code roda o comando oficial `claude -p /usage`: quem consulta a Anthropic é o próprio Claude Code, com a sua sessão, sem chamar o modelo. O plugin não abre conexão própria.
- **Nenhum token.** O plugin não lê, não pede e não guarda token ou credencial. O login do GitHub é do `gh`. Os "tokens" do relatório são contagens de uso.
- **Transcripts: só números.** Dos transcripts, o índice guarda caminhos relativos, ids de sessão e de requisição, números, datas, modelo, effort e o nome do projeto. Nenhum conteúdo de conversa.
- **Onde grava:** só na pasta de dados. As exceções são a chave `statusLine` do seu `settings.json`, pelo instalador, com confirmação e backup, e a extensão do painel, que o CLI do VS Code instala na pasta de extensões dele (desligável com `HADOUKEN_SEM_PAINEL=1`).

**A garantia:** nada que o plugin lê (arquivos de estado, transcripts, a entrada da barra, respostas do GitHub, argumentos de comando) vira código executado, comando de shell, caminho arbitrário, sequência de terminal ou instrução com a autoridade do plugin no contexto do Claude. Cada ameaça do modelo (S1 a S9: arquivo adulterado, texto malicioso, sequências de terminal, injeção pelos argumentos, repo malicioso, script adulterado, instalador acionado sem você saber, cadeia de suprimentos, arquivo gigante; e, do painel, S26 a S28: o painel executa o `claude`, o instalador executa o CLI do VS Code, `uso-oficial.json` adulterado) tem uma defesa e um teste com entrada maliciosa sintética.

**O limite honesto:** nenhum plugin impede código que **já roda como o seu usuário do sistema**. Uma skill maliciosa que chegou a esse ponto pode alterar qualquer arquivo seu, inclusive o `settings.json` e o próprio plugin. O que o `claude-hadouken` garante é não ampliar esse poder e restaurar os próprios scripts a cada sessão nova.

O modelo de ameaças completo, as variáveis de ambiente e como relatar uma vulnerabilidade de forma privada estão no [SECURITY.md](SECURITY.md). Não abra issue pública para vulnerabilidades.

---

## Performance

Nenhuma falha ou lentidão do plugin pode travar o Claude. As metas são medidas, não presumidas, com os benchmarks de `bench/` (`node bench/rodar-todos.mjs`):

| Operação | Meta | Medido |
|---|---|---|
| Barra de status (processo inteiro), Windows | p95 ≤ 250 ms | 135 ms |
| Barra de status (processo inteiro), Linux/macOS | p95 ≤ 150 ms | Linux 49 ms · macOS 48 ms |
| Hook antes de cada prompt, Windows | p95 ≤ 250 ms | 168 ms |
| Hook antes de cada prompt, Linux/macOS | p95 ≤ 150 ms | Linux 56 ms · macOS 50 ms |
| Hook de início de sessão, Windows | p95 ≤ 250 ms | 166 ms |
| Hook de início de sessão, Linux/macOS | p95 ≤ 150 ms | Linux 57 ms · macOS 51 ms |
| Hook de fim de sessão, Windows | p95 ≤ 250 ms | 143 ms |
| Hook de fim de sessão, Linux/macOS | p95 ≤ 150 ms | Linux 46 ms · macOS 44 ms |
| `/claude-hadouken:consumo`, índice já montado | ≤ 2 s | Windows 411 ms · Linux 207 ms · macOS 169 ms |
| `/claude-hadouken:consumo`, índice do zero | ≤ 15 s | Windows 1,95 s · Linux 834 ms · macOS 623 ms |

- Medido em 27/09/2026, p95 do pior cenário de cada linha: Windows num Intel Core i7-7700HQ (8 núcleos lógicos, Node 24) com a máquina parada; Linux e macOS nos runners do GitHub Actions (`ubuntu-latest` e `macos-latest`, Node 24), job `bench` do CI.
- A barra e os hooks são medidos em 100 execuções, do início ao fim do processo, com o disco no pior caso: 1 000 sessões registradas, o estado no teto de 50 sessões e o histórico de leituras cheio (90 pontos); nos hooks, também as duas memórias de avisos cheias (`alertas.json` e `projecao.json`, esta com as projeções de 256 sessões). O pior caso é refeito antes de cada rodada, para valer a medição inteira.
- O relatório é medido sobre 500 MB de transcripts sintéticos (216 arquivos), com o mesmo estado cheio, e um repo respondido pelo `gh` falso, sem rede.
- A meta do Windows é maior porque só a partida do Node, sem script nenhum, já leva 72 ms (p50) e 89 ms (p95) na mesma máquina Windows. A barra roda em segundo plano e não trava a digitação.
- A v0.2.0 custa um pouco mais que a v0.1.0 nos caminhos de sessão registrada: +5,0 a +6,8 ms no p50 da barra e do hook de prompt, em A/B pareado de 200 pares com as duas versões na mesma pasta (`bench/ab-raizes.mjs`). É o trabalho das várias sessões ao mesmo tempo (histórico, previsão, contagem de sessões ativas e aviso de projeção). Nos caminhos de sessão não registrada ficou igual ou até 3 ms mais rápida. Os p95 continuam bem dentro da meta.
- Os hooks de início e fim de sessão rodam uma vez por sessão e têm a mesma meta da barra e do hook de prompt. Além da meta, todo hook tem um teto de 5 s no `hooks.json`.
- Os números da tabela foram medidos na v0.2.0. A v0.3.0 tira da barra o texto de 5 h e 7 dias, mas ela continua gravando as mesmas leituras e o mesmo histórico.
- O painel do VS Code não entra nessas metas: ele roda fora do Claude Code, e a instalação dele sai do início de sessão em segundo plano, sem o hook esperar. O custo dele é o da leitura enxuta do `/usage`, medido à parte: 5 s e 270 MB de pico por leitura, a cada 30 s e só com sessão ativa (veja [Sem gastar tokens, com pouca RAM](#sem-gastar-tokens-com-pouca-ram)).

Por que o relatório é rápido na segunda vez: o índice dos transcripts é incremental e só relê o que mudou; execuções do GitHub já concluídas ficam em cache.

---

## Limitações conhecidas

- **Sem coluna de pensamento (thinking).** A API cobra o pensamento dentro dos tokens de saída, mas o campo que o separa não vem em todas as respostas dos transcripts do Claude Code: numa amostra local, veio em quase todas as respostas das sessões principais e em só 13 % das de subagentes, e às vezes maior que a própria saída. Somar a ausência como zero mostraria um piso como se fosse o total. Fica para uma versão seguinte, com a mesma regra do cache criado ("sem detalhe", nunca deduzido).
- **Minutos do GitHub são estimativa** a preço de tabela, não o valor faturado. A API de faturamento exige o escopo `admin:org` e está fora desta versão.
- **Só github.com.** O `origin` só é reconhecido nas formas `https://github.com/…`, `git@github.com:…` e `ssh://git@github.com/…`.
- **Pastas com caracteres fora da lista do instalador.** O comando da barra leva o caminho da pasta de dados, e esse caminho passa por um shell (sh; no Windows, Git Bash ou, sem ele, PowerShell). Para nenhum shell ler um caractere de outro jeito, o instalador só aceita nele letras de A a Z, as letras latinas de U+00C0 a U+024F (como é, ç, ñ, ğ e ß; fora os sinais de multiplicação e divisão), algarismos, espaço e `/ : . _ - ( ) + , @ ~`. Com uma pasta pessoal em outro alfabeto (cirílico, CJK) ou com `'`, `&`, `$` ou `%`, o instalador recusa (`caminho-inseguro`), não altera nada e mostra a chave para acrescentar à mão:

  ```json
  "statusLine": { "type": "command", "command": "node \"<pasta de dados>/bin/statusline.mjs\"", "padding": 0 }
  ```

  Troque `<pasta de dados>` pelo caminho completo, com barras `/`, e confira que o seu shell lê esse caminho entre aspas duplas sem interpretar nada.
- **Windows e PowerShell.** Os comandos das skills são os mesmos em sh, bash, zsh e PowerShell (todos expandem `$HOME`). O `git` e o `gh` só são usados como `.exe` achado numa entrada absoluta do `PATH`, nunca na pasta atual; `.cmd` e `.bat` não servem.
- **Node sem ICU.** Num Node compilado sem ICU (`--with-intl=none`), o plugin continua funcionando com uma limpeza de texto mais estrita: nomes em alfabetos não latinos (e emoji) somem da barra e saem escapados na saída JSON.
- **`HADOUKEN_HOME` e as skills.** As skills chamam sempre `node "$HOME/.claude/hadouken/bin/cli.mjs"`. Com `HADOUKEN_HOME`, o comando fica em `$HADOUKEN_HOME/bin/cli.mjs` e as skills não o acham; rode-o direto, por exemplo `node "$HADOUKEN_HOME/bin/cli.mjs" consumo`.
- **A barra não se ajusta à largura do terminal.** O Claude Code entrega a saída da barra por um pipe, sem dizer a largura, então a barra não sabe quanto cabe e não corta nada. Na v0.3.0 a linha ficou curta, 53 colunas no exemplo (mais, com nome de modelo longo); num terminal mais estreito que isso, o fim some ou quebra, conforme o terminal. Os glifos `▰`, `▱` e `│` ocupam uma coluna; em terminais ou fontes que desenham caracteres de largura ambígua em duas colunas (comum com configuração CJK), a linha fica mais larga.
- **Sessões abertas antes da instalação não entram nas sessões ativas.** Elas não passam pelo registro do plugin, então ficam fora do `Sessões ativas` do painel e do número do aviso de projeção. O consumo delas está nas porcentagens da conta, e por isso na projeção e na previsão, e a seção "Sessões abertas (última hora)" do relatório as mostra, porque lê os transcripts.
- **A projeção dos avisos é uma reta.** Ela projeta o ritmo dos últimos minutos (20 na janela de 5 horas, 3 horas na de 7 dias) como se ele continuasse igual: uma pausa ou uma rajada muda a projeção na leitura seguinte. Ela precisa de pelo menos 3 leituras cobrindo 6 minutos, então não sai logo no começo de uma janela nem com a barra parada. A previsão do painel usa outra conta, o ritmo médio da janela inteira, e por isso reage devagar a uma rajada.
- **Uma conta por vez.** As leituras não são separadas por conta: com duas contas no mesmo usuário do sistema, o painel, os avisos e o relatório usam a leitura mais recente, de qualquer uma, e o `/usage` do painel lê a conta em que o `claude` está logado. O histórico da projeção também é um só; como as duas contas têm resets diferentes, alternar entre elas recomeça o histórico a cada troca, e a projeção some até juntar pontos de novo.
- **O Fable depende do texto do `/usage`.** O painel lê as linhas em inglês do `/usage` (`Current session`, `Current week (all models)`, `Current week (Fable)`) com regras fixas. Se uma versão do Claude Code mudar esse texto, o Fable fica em `—` ou a dica mostra `Última leitura falhou (formato).`; 5 h e semana continuam vindo da statusline.
- **O painel precisa do `code` e do `claude`.** Sem o comando `code` no `PATH`, a extensão não se instala sozinha. Sem o `claude` em `~/.local/bin` ou no `PATH` (no Windows, só `claude.exe`, nunca `.cmd`), o Fable fica sem leitura e a dica diz `claude não encontrado em ~/.local/bin nem no PATH.`
- **Worktrees** do mesmo projeto aparecem como projetos distintos (o projeto é o nome da pasta).
- **O plugin não troca modelo nem effort.** A documentação oficial não permite trocar de modelo no meio de uma sessão por fora, e trocar no meio desperdiça o cache. O plugin mede e avisa; a decisão é sua.

---

## Desinstalação

**1. Tire a barra, antes de desinstalar o plugin.** No terminal (ou dentro do Claude Code, com `!` na frente):

```bash
node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover
```

Ele tira **só** a barra do claude-hadouken, com backup. Se a `statusLine` do arquivo for outra, ele não mexe em nada. Esse comando depende do plugin instalado, por isso vem primeiro; o `/claude-hadouken:instalar` também o lembra ao terminar. Se você instalou a barra à mão (caso `caminho-inseguro`), apague a chave `statusLine` à mão.

**2. Tire o painel do VS Code.** No terminal:

```bash
code --uninstall-extension gariolilabs.claude-hadouken-painel
```

Depois recarregue cada janela aberta do VS Code (`Developer: Reload Window`): o item continua nelas até a recarga.

**3. Desinstale o plugin e, se quiser, remova o marketplace:**

```text
/plugin uninstall claude-hadouken@claude-hadouken
/plugin marketplace remove claude-hadouken
```

No terminal: `claude plugin uninstall claude-hadouken@claude-hadouken` e `claude plugin marketplace remove claude-hadouken`.

**4. Apague os dados, se quiser:**

```bash
rm -rf ~/.claude/hadouken
```

No PowerShell: `Remove-Item -Recurse -Force "$HOME\.claude\hadouken"`. Os backups `settings.json.bak-hadouken-*` ficam ao lado do seu `settings.json`; apague-os também, se não precisar mais deles.

Pulou o passo 1? Sem o plugin, a barra só fica vazia, sem mensagens de erro. Tire a chave `statusLine` do `settings.json` à mão. Pulou o passo 2? Sem o plugin, o item do VS Code fica em `Hadouken: abra uma sessão do Claude Code` e não lê mais nada; rode o comando do passo 2 quando quiser.

---

## Perguntas frequentes

**O que quer dizer "sem leitura"?**
Que o plugin não tem um número confiável agora e prefere dizer isso a mostrar um valor velho como atual. Acontece quando a última leitura tem mais de 1 hora, quando o reset já passou sem leitura nova, quando o arquivo de estado está fora do formato, ou antes da primeira resposta da API. A barra recebe os limites junto com as respostas da API, e o painel também lê o `/usage` a cada 30 s com uma sessão ativa: basta seguir trabalhando, ou clicar no item do painel.

**Por que o painel mostra `Hadouken: sem leitura` o tempo todo?**
Sua conta não envia limites à statusline (chave de API, ou plano sem limites), e o `/usage` não traz as linhas de uso. O resto (barra, relatório de tokens) funciona normalmente, e o relatório diz "Limites indisponíveis nesta conta". Se só o Fable fica em `—`, a dica diz por quê: ainda não houve leitura oficial, o `claude` não foi achado, ou a leitura está pausada ou bloqueada.

**Onde foram parar o 5h e o 7d da barra?**
Para o painel do VS Code, desde a v0.3.0. Eles são da conta, iguais em todas as sessões, e a barra ficou só com o que é de cada sessão. Veja [O painel no VS Code](#o-painel-no-vs-code).

**Minha sessão aberta não mostra a barra. Está quebrado?**
Não, é de propósito: só sessões iniciadas depois da instalação usam o plugin. Numa sessão antiga, o comando da barra não imprime nada e os hooks ficam mudos, para não mudar o comportamento de um trabalho que já estava em andamento. Abra uma sessão nova. (Barra vazia é isso; `—` num segmento é outra coisa: a sessão é do plugin, mas aquele dado ainda não chegou.)

**Por que os números podem ser diferentes do `/usage` ou do console da Anthropic?**

- **Limites:** o painel usa a leitura mais nova entre a statusline e o `/usage` (lido a cada 30 s), arredondada para baixo, então deve bater com a aba Uso do claude.ai, com até uns 30 s de atraso. Os avisos e o relatório usam a leitura da statusline, a última que chegou (até 1 hora de idade).
- **Tokens:** o relatório só enxerga os transcripts do Claude Code **desta máquina**. Uso no claude.ai, no app, em outra máquina ou direto pela API não aparece nas tabelas, mas conta nos limites da conta. Transcripts que o próprio Claude Code já apagou também saem da conta.
- **Console da Anthropic:** ele mostra o uso de chaves de API da organização, que é outra coisa: nos planos Pro e Max, o uso da assinatura não passa por ele.
- **Minutos do GitHub:** são estimativa a preço de tabela, não o valor faturado.

**Que dados saem da minha máquina?**
Nenhum, exceto as consultas `gh api` (sempre GET, só leitura) que o relatório faz aos repos configurados, ou ao `origin`, usando o login do seu `gh`, e a consulta de uso que o próprio Claude Code faz quando o painel roda `claude -p /usage`. Sem telemetria, sem chamadas à API do Claude. Detalhes em [Privacidade e segurança](#privacidade-e-segurança).

**Como desinstalar?**
Em quatro passos: tire a barra (`node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover`), tire o painel (`code --uninstall-extension gariolilabs.claude-hadouken-painel`), desinstale o plugin (`/plugin uninstall claude-hadouken@claude-hadouken`) e, se quiser, apague `~/.claude/hadouken`. O passo a passo completo está em [Desinstalação](#desinstalação).

**O relatório diz "plugin files not found - open a new session".**
O plugin foi atualizado e a versão antiga saiu do disco. A próxima sessão reaponta os scripts para a versão em uso.

**Funciona no Windows? E no terminal do VS Code?**
Sim. A barra é um comando que o Claude Code roda onde quer que ele esteja aberto, inclusive no terminal integrado do VS Code. O painel é uma extensão do VS Code; no Windows, ela precisa do `code.cmd` no `PATH` para se instalar e do `claude.exe` para ler o Fable. A CI roda os testes em Linux, Windows e macOS, com Node 20 e 24, e caminhos com espaços e acentos são cobertos por teste.

**Tenho várias sessões abertas no VS Code. O plugin considera todas?**
Sim, de dois jeitos. As porcentagens de 5 h, semana e Fable já são da conta inteira, somando todas as sessões (do VS Code, de outro terminal ou de outra máquina), e o painel as mostra uma vez só, com a previsão e a projeção saindo delas. A dica do painel também mostra quantas sessões do plugin estão ativas agora (`Sessões ativas: 3`), e o aviso de projeção leva esse número ao Claude, que pode reduzir o paralelismo. O plugin não distingue sessões do VS Code das de outro terminal: conta todas as sessões do Claude Code desta máquina que começaram depois da instalação. Veja [Projeção e várias sessões](#projeção-e-várias-sessões).

**Quanto custa?**
O plugin é gratuito e de código aberto (MIT). Ele não chama a API do Claude; o custo em tokens são as linhas curtas injetadas no contexto: a do início de sessão e as dos avisos, só quando uma faixa ou modo muda ou quando a projeção entra numa faixa. O painel não gasta tokens: o `/usage` é comando local, e cada leitura confere `num_turns` 0 e custo 0. As chamadas ao GitHub são leituras da API e não gastam minutos do Actions.

---

## Roteiro

O plugin completo tem quatro subprojetos, cada um com spec, plano e revisão próprios:

| Subprojeto | O que faz | Status |
|---|---|---|
| **A. Leitor de consumo** | Barra, painel no VS Code, avisos e relatório. | **v0.3.0** (este) |
| B. Roteador | Lançador dinâmico de sessão, agente principal fixo, agentes por modelo × effort, regras injetadas e checagem de divergência com as regras do projeto. | Planejado |
| C. Planejador | Planejamento de sessão e de semana a partir do plano do projeto e do custo medido por tarefa. | Planejado |
| D. Guardas do GitHub | Guardas de pushes e de CI em mudança só de documentação, e sugestões de melhoria. | Planejado |

- **v0.2.0** = barra mais bonita: as porcentagens também em quadradinhos (`▰▰▰▱▱▱▱▱`), a marca do ritmo semanal na barrinha de 7 dias, cores para ctx e cache e um `/consumo` mais fácil de ler (painel com barrinhas, coluna parte do total, nomes curtos, vírgula decimal e milhar); e, para várias sessões ao mesmo tempo, o número de sessões ativas na barra, a previsão de estouro de cada janela (`→100% 13:10`), o aviso de projeção ao Claude e a seção "Sessões abertas (última hora)" no `/consumo`.
- **v0.3.0** (esta) = painel no VS Code: 5 h, semana e Fable num item da barra de status, com o Fable lido do `/usage` oficial sem gastar tokens, a previsão na mesma frase do claude.ai e uma leitura enxuta, para gastar pouca RAM. A barra do terminal fica só com a sessão (modelo·effort, ctx e cache), e a linha do início de sessão troca o esperado e o modo pela frase de previsão da semana.
- **v0.4.0** = a guarda: em vez de só avisar, segurar o despacho de subagentes e o uso do Fable quando o consumo passa do ponto, com a liberação só pelo usuário. Em spec.
- **Depois** = avisos no [Pipa](https://github.com/LucasGarioli/pipa-vscode-remote) (prioridade), no WhatsApp ou nos dois, à escolha do usuário (pushes e tarefas concluídas). Ganha spec própria, e a segurança é pré-condição: a credencial fica fora do repo, a ativação é por projeto e as mensagens levam o mínimo, sem código, caminhos pessoais nem segredos.
- **v1.0** = A + B + C + D.

---

## Contribuindo

Contribuições são bem-vindas. Regras da casa:

- **Zero dependências**, de runtime e de desenvolvimento. Só a biblioteca padrão do Node (20+), módulos ES.
- **Testes:** `node --test`, na raiz do repo. Toda mudança vem com teste; toda defesa de segurança vem com um teste de entrada maliciosa.
- **Benchmarks:** `node bench/rodar-todos.mjs` (só relatam; não falham por lentidão).
- **Fixtures só sintéticas:** nada de transcripts reais, caminhos pessoais, e-mails ou ids de sessão reais.
- **Textos da interface em português do Brasil**; **commits em inglês**, com prefixo por área (`core:`, `installer:`, `ci:`, `docs:`).
- **Dado ausente nunca vira zero:** `—`, `indisponível: <motivo>` ou "sem leitura".
- **Imagens do README:** `node docs/imagens/gerar.mjs` refaz as imagens de `docs/imagens/` a partir da saída real do código, sobre dados sintéticos. Rode de novo quando mudar a barra, o painel, os avisos ou o relatório.
- Vulnerabilidades: pelo [SECURITY.md](SECURITY.md), nunca por issue pública.

## Licença

[MIT](LICENSE) © 2026 Lucas Garioli.

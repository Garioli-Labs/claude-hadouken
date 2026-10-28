# hadouken

[English](Home-en)

Plugin do Claude Code que mostra o consumo real (sessão de 5 horas, semana, semana do Fable, contexto e cache), avisa o Claude quando é hora de mudar de marcha e segura o despacho caro quando o consumo passa do ponto.

## Sumário

- [Barra de status](Barra-de-status)
- [Painel e janela do VS Code](Painel-e-janela-do-VS-Code)
- [Avisos e alertas](Avisos-e-alertas)
- [Guarda de consumo](Guarda-de-consumo), com as proteções que você liga e desliga e o roteamento
- [Relatório `/hadouken:consumo`](Relatorio-de-consumo)
- [Aprendizado](Aprendizado)
- [Limites e configuração](Limites)
- [hadouken-kit](Kit) e [hadouken-rea](REA)
- [Comandos](Comandos)
- [Problemas comuns](Problemas-comuns), incluindo "atualizei e o plugin sumiu"
- Nesta página: [Instalação](#instalação), [Roteiro](#roteiro), [Contribuindo](#contribuindo) e [Licença](#licença)

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

   ![Barra de status do hadouken: Opus 5.5·high; contexto em 37% e acerto de cache em 92%, cada um com a sua barrinha, os dois em verde](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/barra-calma.svg)

2. **Um item na barra de status do VS Code**, com os limites da conta: a sessão de 5 horas, a semana e a semana do Fable, com os números da aba Uso do claude.ai. Passe o mouse para ver quando cada janela reinicia e a previsão, na mesma frase do claude.ai.

   ![Item do hadouken na barra de status do VS Code, com o mouse em cima: 5h 42% · sem 59% · Fable 71%. A dica mostra, por janela, a porcentagem, o reinício e a previsão: sessão de 5h em 42%, reinicia às 15:30 e, nesse ritmo, esgota por volta das 14:04; semana de todos os modelos em 59%, não esgota antes do reinício de segunda às 22:00; semana do Fable em 71%, esgota segunda de manhã. Depois, 2 sessões ativas, a idade da leitura oficial (12 s) e a fonte: statusline do Claude Code e claude /usage, sem tokens](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/painel.svg)

3. **Avisos curtos para o Claude.** Quando uma janela muda de faixa (por exemplo, a de 5 horas passa de 80 %), ou quando o ritmo atual a leva a 100 % antes do reset, o Claude recebe uma linha no contexto e ajusta o jeito de trabalhar.
4. **Um relatório sob demanda**, `/hadouken:consumo`: para onde foram os tokens (por projeto, modelo, subagentes e sessão, e quanto pesou cada sessão aberta na última hora) e os minutos do GitHub Actions.

> [!TIP]
> Todas as imagens e exemplos deste README são a saída real do código do plugin, rodado sobre **dados sintéticos** (projetos `meu-projeto` e `outro-projeto`, sessões inventadas). O relógio dos exemplos está parado num **sábado, 12:00**; a semana da conta começou na segunda anterior às 22:00. As imagens são refeitas com `node docs/imagens/gerar.mjs`.

---

## Instalação

### Um comando

No terminal (fora do Claude Code), num PC novo ou para atualizar:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

No Windows, no PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Ele confere o Node (20+), o git e o Claude Code (2.1.251+); se faltar algum, mostra a lista e pergunta uma vez antes de instalar (Node e git pelo winget ou pelo brew, o Claude Code pelo instalador oficial). Depois instala o `hadouken`, o `hadouken-kit` e o `hadouken-rea` (ligado na primeira instalação se o Node for 22.19+, 24.11+ ou 26+; se você o desligar, rodar de novo não o religa), põe a barra, instala o item do VS Code, liga a atualização automática e, se você aceitar, os extras (Python, o `graphify` num venv próprio em `~/.claude/hadouken/venv`, com Python 3.10+, as ferramentas da `yu-ux-web-expert` e o `gh`). O aprendizado local liga por padrão; para ficar sem ele, use `--sem-aprender` ou desligue depois na janela, e quem já o desligou continua desligado. No fim, um resumo de uma linha por item; rodar de novo atualiza e pula o que já está certo.

Opções (no bash, `| bash -s -- <opções>`; no PowerShell, `$env:HADOUKEN_INSTALAR = '<opções>'` antes do `irm`):

| Opção | Faz |
|---|---|
| `--sim` | responde sim às perguntas; não troca uma barra de outro plugin |
| `--substituir-barra` | troca uma `statusLine` que não é a do hadouken (com backup) |
| `--sem-extras` | não instala os extras |
| `--sem-aprender` | não liga o aprendizado local (no PowerShell, também `-SemAprender`) |

O `--com-aprendizado` das versões anteriores continua aceito e não muda nada.

O item do VS Code não está na loja: o instalador monta o pacote em `~/.claude/hadouken/painel/claude-hadouken-painel-<versão>.vsix`. Para instalar em outro PC sem rodar o comando único, copie esse arquivo e rode `code --install-extension <arquivo>.vsix`.

O passo a passo abaixo é o caminho manual, com os mesmos resultados.

### Requisitos

- **Claude Code 2.1.251 ou mais novo.** A guarda precisa dele. Em versões anteriores, a troca de modelo (P3) e a liberação pelo `/hadouken:liberar` não existem, e o plugin não funciona: nenhum hook carrega e, sem o registro do SessionStart, a barra também fica vazia. Na 2.1.250, o Claude Code recusa os eventos de troca de modelo do `hooks.json` e não registra nenhum hook do plugin. Ficam sem a guarda, sem a linha de consumo do início de sessão, sem os avisos, sem a P1 a P5 e sem a barra. A mínima é 2.1.251; a 2.1.250 falhou, e a 2.1.251 não foi testada isoladamente.
- **Node.js 20 ou mais novo**, no `PATH`.
- **Plano Pro ou Max** para ver os limites: o Claude Code só entrega os limites de 5 h e 7 dias à statusline nessas contas (ou atrás de um gateway com limite de gasto), e só depois da primeira resposta da API na sessão. Sem isso, o plugin funciona, mas os limites ficam sem leitura no painel, nos avisos e no relatório.
- Opcional, para o painel: **VS Code**. O plugin acha o `code` no `PATH` (no Windows, `code.cmd`) e, no Mac, também dentro do `Visual Studio Code.app` em `/Applications` ou `~/Applications`, sem precisar do "Shell Command: Install 'code' command in PATH". Para a leitura do Fable, o executável `claude` em `~/.local/bin` ou no `PATH` (no Windows, `claude.exe`).
- Opcional: [`gh`](https://cli.github.com/) com login feito, para a seção do GitHub.
- Opcional: `git`, para descobrir o repo pelo `origin` quando não há `config.json`.

### Passo a passo

**1. Adicione o marketplace e instale o plugin.** Dentro do Claude Code:

```text
/plugin marketplace add Garioli-Labs/claude-hadouken
/plugin install hadouken@claude-hadouken
```

O `/plugin install` abre o painel com os detalhes do plugin; escolha **Install for you (user scope)** para tê-lo em todos os projetos.

Prefere o terminal? Os comandos equivalentes instalam sem abrir sessão nenhuma, e o plugin carrega na próxima vez que você iniciar o Claude Code:

```bash
claude plugin marketplace add Garioli-Labs/claude-hadouken
claude plugin install hadouken@claude-hadouken
```

**2. Abra uma sessão nova.**

> [!IMPORTANT]
> **Só sessões iniciadas depois da instalação usam o plugin.** Sessões que já estavam abertas, e os agentes que rodam nelas, continuam exatamente como estavam: sem barra, sem avisos, sem nada gravado.
>
> Isso é garantido pelo próprio plugin, não por sorte: ele só age em sessões registradas pelo seu hook de início de sessão. Se o Claude Code carregar os hooks do plugin no meio de uma sessão antiga, eles ficam mudos; se essa sessão rodar o comando da barra, a barra sai vazia. Subagentes seguem a sessão-mãe: os lançados numa sessão nova usam o plugin, os de uma sessão antiga, não.

**3. Na sessão nova, instale a barra de status:**

```text
/hadouken:instalar
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

**4. O painel no VS Code se instala sozinho.** Com o VS Code instalado (o comando `code` no `PATH`, ou no Mac o app em `/Applications`), o início de sessão instala a extensão do painel em segundo plano, sem pedir nada e sem gastar tokens. Numa janela do VS Code que já estava aberta, o item pode só aparecer depois de recarregá-la (`Developer: Reload Window`). Para não instalar, ou para remover, veja [Instalar, desligar e remover](Painel-e-janela-do-VS-Code#instalar-desligar-e-remover).

### O que o `/hadouken:instalar` muda, e como desfazer

| Pergunta | Resposta |
|---|---|
| Que arquivo muda? | O seu `settings.json` de usuário (`~/.claude/settings.json`, ou o de `CLAUDE_CONFIG_DIR`). O caminho exato aparece antes da confirmação. |
| O que muda nele? | Só a chave `statusLine`, que passa a chamar `node "<pasta de dados>/bin/statusline.mjs"`. Todo o resto do arquivo fica como estava. |
| E se eu já tiver uma barra? | Ela é mostrada, e a resposta recomendada é mantê-la. Só um "Substituir a barra atual" troca. |
| Tem backup? | Sim, antes de gravar: `settings.json.bak-hadouken-<instante em ms>`, ao lado do arquivo. Os 5 mais recentes ficam guardados. |
| Como desfazer? | `node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover`, no terminal (ou no Claude Code, com `!` na frente). Tira só a barra do hadouken, também com backup; se a `statusLine` do arquivo for outra, não mexe em nada. |
| E para voltar exatamente ao arquivo de antes? | Copie o backup `settings.json.bak-hadouken-*` de volta sobre o `settings.json`. Mudanças feitas no arquivo depois do backup se perdem. |

### Atualizar

Quem instalou pelo comando único tem a atualização automática ligada: o Claude Code atualiza o marketplace e os plugins do Hadouken depois da primeira mensagem de uma sessão, e a versão nova vale na sessão seguinte (`DISABLE_AUTOUPDATER=1` desliga). Para atualizar na hora, rode o comando único de novo, use **Update now** na aba **Installed** do `/plugin`, ou, no terminal:

```bash
claude plugin marketplace update claude-hadouken
claude plugin update hadouken@claude-hadouken
```

**Quem instalou antes da v0.5.2:** o plugin trocou de nome, de `claude-hadouken` para `hadouken` (o Claude Code reserva os nomes que começam com `claude-`). O marketplace leva o seu `enabledPlugins` para o nome novo, mas o plugin precisa ser instalado uma vez com ele: rode o comando único de novo ou, no terminal, `claude plugin install hadouken@claude-hadouken`. Os comandos passam a ser `/hadouken:liberar`, `/hadouken:aprender`, `/hadouken:consumo` e os demais.

A barra não precisa ser reinstalada. A `statusLine` chama um script estável da pasta de dados (`bin/statusline.mjs`), e esse script aponta para a versão do plugin que o último início de sessão carregou (abrir, retomar, `/clear` ou `/compact` contam como início). O painel do VS Code carrega a lógica do mesmo jeito, por `bin/painel.mjs`. Na v0.3.0, a barra perde os segmentos de 5 h e 7 dias, a linha do início de sessão muda e o painel entra. Na prática:

- **Até alguma sessão começar com a v0.3.0**, todas seguem com a anterior, com 5 h e 7 dias na barra, e o painel não é instalado.
- **Depois que uma sessão começa com a v0.3.0**, todas as sessões que já mostravam a barra, inclusive as abertas antes da atualização, passam à barra nova, só com a sessão, no próximo redesenho. Esse início de sessão também instala o painel no VS Code, em segundo plano (veja [Instalar, desligar e remover](Painel-e-janela-do-VS-Code#instalar-desligar-e-remover)); numa janela do VS Code que já estava aberta, pode ser preciso recarregá-la.
- **Os hooks de uma sessão que já estava aberta** seguem com o código da versão anterior até essa sessão recomeçar. Os avisos antes de cada prompt não mudaram na v0.3.0, então nada muda neles. Isso vem de como o Claude Code carrega os hooks de cada sessão, não do plugin, e pode mudar entre versões do Claude Code.
- **Um `/clear`, `/compact` ou `/resume` numa sessão que ainda roda a versão anterior** aponta a barra de todas as sessões de volta para ela, enquanto ela estiver no disco: volta o visual anterior, com 5 h e 7 dias na barra. Nada quebra. Se a pasta da versão anterior for removida depois desse momento, a barra fica vazia, sem erro.
- **Só um início de sessão com a versão nova** resolve: abrir uma sessão nova (ou retomar uma sessão num processo novo do Claude Code), ou um `/clear` ou `/compact` numa sessão que já roda a versão nova. A barra nova volta no próximo redesenho.
- **Sessão que nunca carregou o plugin** continua sem barra e sem gravar nada, antes e depois da atualização.

**Depois de atualizar, reinicie as sessões que estavam abertas** (feche e abra de novo). Assim todas rodam a versão nova, e nenhuma aponta a barra de volta para a anterior.

---

## Roteiro

O plugin completo tem quatro subprojetos, cada um com spec, plano e revisão próprios:

| Subprojeto | O que faz | Status |
|---|---|---|
| **A. Leitor de consumo** | Barra, painel no VS Code, avisos, guarda e relatório. | **v0.5.4** (este) |
| B. Roteador | Lançador dinâmico de sessão, agente principal fixo, agentes por modelo × effort, regras injetadas e checagem de divergência com as regras do projeto. | Planejado |
| C. Planejador | Planejamento de sessão e de semana a partir do plano do projeto e do custo medido por tarefa. | Planejado |
| D. Guardas do GitHub | Guardas de pushes e de CI em mudança só de documentação, e sugestões de melhoria. | Planejado |

- **v0.2.0** = barra mais bonita: as porcentagens também em quadradinhos (`▰▰▰▱▱▱▱▱`), a marca do ritmo semanal na barrinha de 7 dias, cores para ctx e cache e um `/consumo` mais fácil de ler (painel com barrinhas, coluna parte do total, nomes curtos, vírgula decimal e milhar); e, para várias sessões ao mesmo tempo, o número de sessões ativas na barra, a previsão de estouro de cada janela (`→100% 13:10`), o aviso de projeção ao Claude e a seção "Sessões abertas (última hora)" no `/consumo`.
- **v0.3.0** = painel no VS Code: 5 h, semana e Fable num item da barra de status, com o Fable lido do `/usage` oficial sem gastar tokens, a previsão na mesma frase do claude.ai e uma leitura enxuta, para gastar pouca RAM. A barra do terminal fica só com a sessão (modelo·effort, ctx e cache), e a linha do início de sessão troca o esperado e o modo pela frase de previsão da semana.
- **v0.4.0** = a guarda: em vez de só avisar, segurar o despacho de subagentes, o uso do Fable e o despacho caro quando o consumo passa do ponto, com a liberação só pelo usuário (`/hadouken:liberar`), e proteger os arquivos do plugin e os campos dos settings que desligariam a guarda. O `/consumo` ganha "Guarda (7 dias)" e "Custo dos hooks (7 dias)"; os avisos ganham a leitura-piso, o reset em minutos, o horário da volta e o ritmo da semana; a barra se redesenha a cada minuto com a sessão parada; e a retomada de uma sessão parada mostra os tokens de cache a reescrever. E o aprendizado local, opcional: o hadouken aprende com o OpenTelemetry do Claude Code, só nesta máquina e sem tokens, ajusta o conforto dentro de limites fixos, só aperta a guarda sozinho e deixa afrouxar e trocar de modelo como sugestão.
- **v0.5.0** = o hadouken-kit e o hadouken-rea, opcionais no mesmo marketplace: o kit instala e fixa as skills do fluxo (superpowers, Matt Pocock, yu-ux-web-expert, graphify e outras), diz ao Claude o momento de cada uma e avisa quando uma dependência lança versão principal nova; o REA liga o servidor MCP de engenharia reversa. E os ajustes menores da revisão da v0.4.0.
- **v0.5.1** = acompanha o mattpocock-skills 1.3.1 (27 skills), faz o REA subir sob junção ou link e avisar quando o Node não serve, e deixa o aviso semanal ler o superpowers que o marketplace oficial instala, sem reabrir issue nem repassar texto de terceiro.
- **v0.5.2** = o instalador de um comando (Windows, Mac e Linux), os terceiros do kit fixados no próprio marketplace com atualização automática, o robô semanal do kit e o plugin renomeado para `hadouken`.
- **v0.5.4** (esta) = a janela do hadouken no VS Code, com todas as configurações, Salvar e Desfazer; o `/hadouken:limites`; o roteamento de modelo e effort, com os agentes prontos e as otimizações; quatro proteções que o usuário pode desligar e o fim do bloqueio por engano de comandos que citam a pasta do projeto; o aviso de versão nova com o botão Atualizar; o aprendizado local ligado por padrão (`--sem-aprender` para ficar sem); e a documentação nesta wiki.
- **v0.5.5** = segurança, estabilidade, compatibilidade e uso de RAM.
- **v0.5.6** = o plano Pro ou Max nas estimativas, agentes ociosos e menos tokens por sessão.
- **v0.6.0** = avisos no [Pipa](https://github.com/LucasGarioli/pipa-vscode-remote) (prioridade), no WhatsApp ou nos dois, à escolha do usuário (pushes e tarefas concluídas). Ganha spec própria, e a segurança é pré-condição: a credencial fica fora do repo, a ativação é por projeto e as mensagens levam o mínimo, sem código, caminhos pessoais nem segredos.
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
- Vulnerabilidades: pelo [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md), nunca por issue pública.

## Licença

[MIT](https://github.com/Garioli-Labs/claude-hadouken/blob/main/LICENSE) © 2026 Lucas Garioli.

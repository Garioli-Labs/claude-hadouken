# Saúde do PC (/hadouken:saude)

[English](PC-health)

Desde a v0.5.5, o hadouken acompanha a RAM, as temperaturas, a bateria e o disco do PC. Quando o PC aperta, ele avisa o senhor e orienta o Claude a trabalhar mais leve. O hadouken também confere a si mesmo: se os seus hooks ficaram lentos, se algum arquivo dele se corrompeu, se as versões são compatíveis e se algum outro plugin briga com ele.

## O que faz

- **Lê o PC num processo à parte.** Um coletor roda solto, em prioridade baixa, no máximo uma vez por minuto, e grava `saude.json` na pasta de dados. Os hooks só leem esse arquivo, nunca coletam nem esperam. Várias sessões abertas compartilham a mesma coleta.
- **Avisa uma vez por episódio.** Quando uma medida entra na faixa, aparecem três coisas: um segmento curto na barra (por exemplo `PC: GPU 88°C`) enquanto durar, um aviso único ao senhor e uma linha de contexto ao Claude. Um episódio novo da mesma medida só começa depois de 30 min abaixo da faixa.
- **Orienta o Claude, sem bloquear.** Com a RAM alta, o Claude recebe uma linha do tipo "testes com concorrência 1, sem subagentes em paralelo, sem build em watch". Nada é negado por causa da saúde do PC.
- **Sugere o que fechar.** Na faixa vermelha da RAM, o aviso e o `/hadouken:saude` listam até 5 aplicativos que mais ocupam memória, com quanto cada um libera. Ficam de fora a sessão atual e o sistema. **Quem fecha é o senhor.**
- **Aponta sessões do Claude paradas.** O coletor guarda o tempo de CPU de cada sessão do Claude Code. Uma sessão cuja CPU quase não sobe há 30 min conta como parada: o senhor recebe um aviso único por episódio, com quantas são e quanta memória ocupam, e o `/hadouken:saude` e a janela mostram a contagem. O Claude só recebe uma linha quando a RAM já está na faixa, e só número e GB, nunca nome nem pid. **Quem fecha é o senhor.**
- **Mostra tudo num comando,** o `/hadouken:saude`, e na seção "PC agora" da [janela do VS Code](Painel-e-janela-do-VS-Code#pc-agora).

## O que nunca faz

- Nunca fecha um aplicativo seu. O único processo que o hadouken encerra é um processo **dele mesmo** que passou muito do próprio prazo, como um coletor ou um aprender pendurado. Ele só faz isso depois de duas conferências, pela linha de comando e pelo arquivo de trava do próprio hadouken, e registra cada encerramento em evento. Isso pode ser desligado com `saude.liberarProprios`.
- Nunca coleta dentro de um hook nem atrasa o seu prompt para medir o PC.
- Nunca põe nome de aplicativo no contexto do Claude. O Claude recebe só números e rótulos de uma lista fixa; os nomes aparecem só para o senhor, saneados.
- Nunca desativa outro plugin. Um conflito é só relatado.

## Faixas

Todas mudam na aba Saúde da janela ou com o [`/hadouken:limites`](Limites#o-comando-hadoukenlimites).

| Medida | Faixa padrão | Item |
|---|---|---|
| RAM usada | aviso a partir de 85%; vermelho (sugestões e modo leve) a partir de 93% | `saude.ram.amarelo`, `saude.ram.vermelho` |
| Temperatura da GPU (NVIDIA) | a partir de 85 °C | `saude.gpu.max` |
| Temperatura da CPU | a partir de 90 °C | `saude.cpu.max` |
| Bateria fora da tomada | 15% ou menos | `saude.bateria.min` |
| Disco livre (pasta de dados e projeto) | menos de 5 GB | `saude.disco.minGB` |

### Não disponível neste PC

Nem todo PC entrega todas as medidas. Sem `nvidia-smi`, a GPU fica sem leitura. No Windows, a temperatura da CPU só aparece quando o sistema a entrega sem administrador, o que é raro. No macOS, ela não aparece. Uma medida sem leitura aparece como "não disponível neste PC" e nunca gera aviso.

## Modo leve

Quando algo está em alerta, o hadouken sugere o modo leve.

- `/hadouken:saude leve` liga o modo por 4 h. `/hadouken:saude normal` volta antes disso.
- Enquanto ele está ligado, cada início de sessão e cada prompt levam ao Claude a orientação de trabalho leve: concorrência 1, um subagente por vez, effort no mínimo necessário, nada de Fable nem de Workflow sem pedido explícito, e Haiku ou Sonnet para busca.
- O modo leve não bloqueia nada. A barra mostra `leve` enquanto ele vale.
- Na janela do VS Code, o botão "Ligar modo leve (4 h)" faz o mesmo.

## O comando /hadouken:saude

Responde por um hook, antes do modelo, e não gasta tokens. Só lê arquivos, por isso é rápido.

| Comando | O que faz |
|---|---|
| `/hadouken:saude` | Mostra o relatório. |
| `/hadouken:saude leve` | Liga o modo leve por 4 h. |
| `/hadouken:saude normal` | Desliga o modo leve. |

O relatório tem estas seções:

1. **PC:** RAM, CPU, GPU, bateria e disco, com a idade da leitura.
2. **Sugestões:** os aplicativos que liberam mais memória e o modo leve.
3. **Hooks:** o p95 de cada hook do hadouken e dos outros plugins nos últimos 7 dias, e as partes desligadas pelo teto de tempo.
4. **Reparos:** os arquivos postos em quarentena.
5. **Versões e compatibilidade.** Quando o `.vsix` do painel está na pasta de dados, a linha `Painel` mostra o caminho dele, para instalar em outro PC com `code --install-extension <esse arquivo>`.
6. **Conflitos** com outros plugins.
7. **Dados:** o tamanho de cada arquivo da pasta de dados e o teto.
8. **Economia da semana.**
9. **Plano** da conta, como o Claude Code o informa (Pro, Max 5x ou Max 20x), ou "não identificado".

## Cuidados do hadouken consigo mesmo

### Teto de tempo dos hooks

As partes opcionais de cada hook têm um orçamento de 40 ms (`saude.tetoHooks.ms`): aprendizado, consulta de versão, painel, previsão, coletor, otimizações do roteamento e economia. Uma parte que estoura o orçamento em 3 das últimas 10 execuções fica desligada por 24 h, com um aviso único. As partes centrais nunca se desligam: as decisões da guarda e a linha da barra.

### Autorreparo

Um arquivo de estado corrompido vai para a quarentena, com o nome `<nome>.corrompido-<data>` e no máximo 3 por arquivo. No lugar entra o padrão seguro de "arquivo ausente", e o senhor recebe um aviso único. Uma liberação corrompida não libera a guarda. Um `config.json` corrompido também vai para a quarentena, e a configuração volta ao padrão com aviso explícito, para o senhor recuperar o arquivo se quiser.

### Compatibilidade e conflitos

No início da sessão, o hadouken compara a versão do Node, a do Claude Code e a da extensão do VS Code com o mínimo suportado (Node 20, Claude Code 2.1.251). Fora disso, há um aviso único por combinação, dizendo o que fazer. Uma vez por dia, ele procura uma `statusLine` que não seja a dele, plugins com hooks de permissão nos mesmos pontos que os da guarda e hooks de outros plugins com p95 alto. Tudo é só relatado.

### Limpeza dos dados

Dentro do coletor, nunca num hook, o hadouken mantém a pasta de dados dentro de um teto total de 50 MB (`saude.limpeza.mb`). O histórico corta as linhas mais antigas, os índices grandes são reconstruídos e as quarentenas saem depois de 30 dias. O `venv` do aprendizado fica de fora.

### Economia da semana

No primeiro início de sessão da semana, o hadouken mostra uma linha com o que a guarda e o roteamento fizeram: despachos perguntados e negados, rebaixamentos sugeridos e aceitos, buscas desviadas para modelo barato. Quando há base medida na própria máquina, a linha traz também uma **estimativa** de tokens poupados.

## Desligar

- Tudo: `/hadouken:limites saude.ligado desliga`.
- Cada peça tem o seu liga-desliga: `saude.liberarProprios`, `saude.tetoHooks`, `saude.compat`, `saude.conflitos`, `saude.limpeza` e `saude.economia`.

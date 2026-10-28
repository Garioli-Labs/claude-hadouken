# Avisos e alertas

[English](Warnings-and-alerts)

## Os avisos que o Claude recebe

A barra e o painel são para você. Os avisos são para o Claude.

Quando uma janela muda de faixa, o plugin coloca **uma linha curta no contexto do Claude**, antes de ele ler o seu próximo prompt. A linha não aparece como mensagem no chat: você acompanha o consumo pelo painel do VS Code e pelo `/hadouken:consumo`, e o Claude passa a levar o estado em conta (e pode comentá-lo). No início de cada sessão, ele também recebe o consumo atual numa linha. E quando, no ritmo atual, uma janela vai chegar a 100 % antes do reset, ele recebe um aviso de projeção.

![Linhas que o Claude recebe: o consumo no início da sessão (5h 42% com reset às 15:30, 7d 59% com reset segunda, 28/09, às 22:00 e, nesse ritmo, não esgota antes do reinício) e um aviso a cada mudança de faixa: 5h em 74%, reset em 210 min: atenção; 5h em 83%, reset em 210 min: serializar; 7d 78% contra 65% esperado: modo econômico, com o ritmo de 1,5 ponto por hora, o sustentável de 0,4 ponto por hora e, nesse ritmo, o fim amanhã às 02:40. Depois, com 3 sessões ativas, o aviso de projeção: a 5h chega a 100% às 12:50, antes do reset das 15:30, com a frase de perguntar ao usuário antes de mudar um plano que ele decidiu. Por fim, 5h em 91%: fechar a tarefa em curso, reset às 15:30, e, se agendar a volta, marcar 15:32. Um prompt na mesma faixa não gera linha.](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/avisos.svg)

### O que mudou nos avisos na v0.4.0

Os exemplos são de um sábado, 26/09, ao meio-dia, com a janela de 5 horas zerando às 15:30 e a semana na segunda, 28/09, às 22:00.

- **Leitura velha vira piso, e sem leitura não há números velhos.** A leitura da statusline vale como atual por até 1 hora. De 1 a 24 horas, com o reset ainda à frente, ela vira um piso, marcado com a idade: `5h em ≥ 83% (leitura de 3 h; reset em 210 min): serializar — sem Workflow nem subagentes em paralelo.` Sem leitura atual nem piso, o Claude recebe, uma vez por sessão, desde quando não há leitura e o último modo conhecido, em vez de números velhos: `Consumo sem leitura nova desde qui 24/09 18:40; trate como o último modo conhecido (econômico).` Antes da primeira leitura nesta máquina: `Consumo ainda sem leitura nesta máquina.`
- **Reset em minutos.** As linhas de atenção e de serializar dizem quanto falta para o reset: `5h em 74% (reset em 210 min): atenção ao ritmo.` Com menos de 15 minutos, a mudança de ritmo não rende antes do reset, e a linha diz isso: `5h em 74% (reset em 10 min): sem mudança de ritmo.`
- **Fechar, com o horário da volta.** A faixa de 90 % dá o horário exato do reset e, para quem agenda a volta, o reset mais 2 minutos, para ela cair na janela nova: `5h em 91%: fechar a tarefa em curso e não abrir etapa nova; reset às 15:30 (o usuário vê as opções em /rate-limit-options). Se agendar a volta, marque 15:32.`
- **Datas sem ambiguidade.** Fora da janela de 5 horas, os horários saem como `hoje 15:30`, `amanhã 09:00`, `ontem 20:15` ou, a partir de dois dias, com o dia e a data, `seg 28/09 22:00`. Vale também para a linha do início da sessão: `Consumo: 5h 42% (reset 15:30) · 7d 59% (reset seg 28/09 22:00); nesse ritmo, não esgota antes do reinício.`
- **Modo econômico com o ritmo.** Com pelo menos 2 horas de leituras, a linha do modo econômico diz o ritmo da semana agora e o sustentável até o reset, em pontos por hora, e quando a semana acaba nesse ritmo: `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação; ritmo 1,5 pt/h, sustentável 0,4 pt/h; nesse ritmo acaba amanhã 02:40.`
- **Retomar uma sessão parada.** Ao retomar (`resume`) uma sessão cujo cache provavelmente expirou, com 20 mil tokens de contexto ou mais, **você** (não o Claude) vê quantos tokens o Claude Code vai gravar de novo no cache: `hadouken: retomar reescreve ~35 k tokens de cache.` A linha vai como mensagem ao usuário, fora do contexto do Claude, sem valor em dólar (a assinatura não cobra por token). Um `fork` não a mostra.
- **Subagentes ficam quietos.** O início de sessão dentro de um subagente não gera linha, não registra nada e não muda o modelo gravado da sessão mãe.

As faixas, os modos e a projeção abaixo decidem os avisos e o painel "Limites e ritmo" do relatório. O painel do VS Code não usa nenhum deles: mostra a porcentagem, com as cores dele, e a [previsão](Painel-e-janela-do-VS-Code#a-previsão) na frase do claude.ai.

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

**Quem conta como sessão ativa.** Uma sessão registrada (que começou depois da instalação do plugin) que trabalhou nos últimos 5 minutos: a barra se atualizou e o transcript da sessão foi escrito desde a atualização anterior. A barra também se redesenha com o terminal parado; sem escrita no transcript, isso não conta, e uma sessão parada sai da conta em 5 minutos. Um comando longo que não escreve no transcript por mais de 5 minutos conta como parado até a próxima escrita. A conta nunca passa de 50 (o teto de sessões do `estado.json`) e é sempre um número inteiro. O plugin não separa as sessões do VS Code das de outro terminal: conta todas as sessões do Claude Code desta máquina que passaram pelo registro. O número aparece na dica do painel (`Sessões ativas: 3`) e no aviso de projeção, quando são 2 ou mais.

**Sessões abertas antes da instalação não entram na conta.** Elas não passam pelo registro do plugin. O consumo delas continua dentro das porcentagens da conta, e por isso entra na projeção.

**Como sai a projeção.**

- A cada atualização, a barra guarda a leitura dos limites num histórico curto, no `estado.json`: no máximo um ponto a cada 2 minutos, até 90 pontos (3 horas).
- O ritmo é a inclinação, por mínimos quadrados, da porcentagem contra o tempo: na janela de 5 horas, com os pontos dos últimos 20 minutos; na de 7 dias, com os das últimas 3 horas.
- A projeção é agora + (100 − uso atual) ÷ ritmo. Ela só sai com pelo menos 3 pontos cobrindo 6 minutos ou mais e com o uso subindo, e só vale se cair antes do reset: se o reset chega primeiro, não há o que avisar.
- As porcentagens são da conta inteira, então o ritmo já soma todas as sessões, registradas ou não, desta máquina ou de outra.
- Quando a janela troca (o horário de reset mudou, ou a porcentagem caiu mais de 1 ponto), o histórico daquela janela recomeça: a projeção nunca mistura duas janelas. Logo depois de uma troca, ou com a barra parada, a projeção leva uns minutos para voltar.
- Uma leitura que traz uma janela e não a outra também recomeça o histórico da que faltou. Se o Claude Code deixar o `seven_day` de fora de vez em quando, a projeção de 7 dias fica recomeçando e pode não chegar a sair.

Com a projeção perto, o Claude recebe o aviso de projeção (veja abaixo), e o relatório mostra quanto cada sessão pesou na última hora (veja [Sessões abertas (última hora)](Relatorio-de-consumo#sessões-abertas-última-hora)).

### Quando um aviso sai

- **Uma vez por mudança de faixa.** Entrar em `serializar` gera uma linha; os próximos prompts na mesma faixa não geram nada. A memória do que já foi anunciado é da conta: uma segunda sessão aberta na mesma faixa não recebe a mesma linha de novo.
- **Começar numa faixa tranquila não gera aviso.** A primeira leitura de uma janela em `normal` fica calada.
- **Descida também é avisada, uma vez** (`5h voltou a 65%: faixa normal.`).
- **Janela nova suspende as restrições.** Se a janela anterior terminou numa faixa restritiva, a nova começa com um aviso explícito de que as restrições foram suspensas.
- **Sem leitura nova, uma linha só por sessão:** `Consumo sem leitura nova desde qui 24/09 18:40; trate como o último modo conhecido (econômico).` Nesse prompt, nenhuma linha de faixa.
- **Projeção, uma vez por faixa, janela e sessão.** Com a projeção da janela de 5 horas a 60 minutos ou menos (e antes do reset), sai uma linha; a 30 minutos ou menos, outra. Na janela de 7 dias, uma linha com a projeção a 24 horas ou menos. Cada faixa sai uma vez por janela em cada sessão: a projeção sair da faixa e voltar não repete a linha, e uma projeção que já nasce na faixa de 30 minutos gera só a linha dela. Janela nova começa sem essa memória. A linha diz quantas sessões estão ativas quando são 2 ou mais; com uma só, vem sem o parêntese. Os avisos de faixa de cima não mudam.

### Todas as linhas, como o código as produz

Os números abaixo são exemplos; o texto é fixo.

| Situação | Linha que o Claude recebe |
|---|---|
| Início de sessão | `Consumo: 5h 42% (reset 15:30) · 7d 59% (reset seg 28/09 22:00); nesse ritmo, não esgota antes do reinício.` |
| Início de sessão, com a 5 h lida há 3 horas | `Consumo: 5h ≥ 42% (leitura de 3 h; reset 15:30) · 7d 59% (reset seg 28/09 22:00); nesse ritmo, não esgota antes do reinício.` |
| 5 h entrou em atenção | `5h em 74% (reset em 210 min): atenção ao ritmo.` |
| 5 h entrou em serializar | `5h em 83% (reset em 210 min): serializar — sem Workflow nem subagentes em paralelo.` |
| 5 h entrou em serializar, com a leitura de 3 horas atrás | `5h em ≥ 83% (leitura de 3 h; reset em 210 min): serializar — sem Workflow nem subagentes em paralelo.` |
| 5 h entrou em atenção ou serializar a menos de 15 min do reset | `5h em 74% (reset em 10 min): sem mudança de ritmo.` |
| 5 h entrou em fechar | `5h em 91%: fechar a tarefa em curso e não abrir etapa nova; reset às 15:30 (o usuário vê as opções em /rate-limit-options). Se agendar a volta, marque 15:32.` |
| 5 h desceu para atenção | `5h voltou a 75% (reset em 210 min): faixa atenção.` |
| 5 h desceu para serializar | `5h voltou a 85% (reset em 210 min): ainda serializar — sem Workflow nem subagentes em paralelo.` |
| 5 h desceu para atenção ou serializar a menos de 15 min do reset | `5h voltou a 75% (reset em 10 min): sem mudança de ritmo.` |
| 5 h desceu para normal | `5h voltou a 65%: faixa normal.` |
| 5 h: janela nova depois de faixa restritiva | `5h: janela nova em 3%, faixa normal — restrições anteriores suspensas.` |
| 7 d entrou em econômico, com menos de 2 h de leituras | `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação.` |
| 7 d entrou em econômico, com 2 h de leituras ou mais | `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação; ritmo 1,5 pt/h, sustentável 0,4 pt/h; nesse ritmo acaba amanhã 02:40.` |
| 7 d entrou em folga | `7d 50% vs 65% esperado → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume.` |
| 7 d voltou ao normal | `7d 60% vs 65% esperado → modo normal.` |
| 7 d entrou em só leitura | `7d em 91% com reset seg 28/09 22:00: só leitura; recomendar parar.` |
| 7 d: janela nova depois de modo restritivo | `7d: janela nova, 1% vs 0% esperado → modo normal — restrições anteriores suspensas.` |
| 5 h: no ritmo atual, 100 % em 60 min ou menos, antes do reset (e de novo em 30 min ou menos) | `hadouken: no ritmo atual (3 sessões ativas), 5h chega a 100% às 12:50, antes do reset das 15:30. Reduza o paralelismo ou serialize. Se isso conflitar com uma decisão explícita do usuário, pergunte antes de mudar o plano.` |
| 7 d: no ritmo atual, 100 % em 24 h ou menos, antes do reset | `hadouken: no ritmo atual, 7d chega a 100% amanhã 09:00, antes do reset seg 28/09 22:00. Reduza o paralelismo ou serialize. Se isso conflitar com uma decisão explícita do usuário, pergunte antes de mudar o plano.` |
| Sem leitura nova (nem atual, nem piso) | `Consumo sem leitura nova desde qui 24/09 18:40; trate como o último modo conhecido (econômico).` |
| Nenhuma leitura nesta máquina | `Consumo ainda sem leitura nesta máquina.` |
| Retomada de sessão parada, com o cache expirado (vai ao usuário, não ao Claude) | `hadouken: retomar reescreve ~35 k tokens de cache.` |

Na linha do início de sessão, o fim vem da [frase de previsão](Painel-e-janela-do-VS-Code#a-previsão) da semana, encurtado: `; nesse ritmo, esgota amanhã à noite`, `; nesse ritmo, não esgota antes do reinício` ou `; limite semanal atingido`. Sem frase (menos de 30 minutos de janela, ou uso zero), a linha termina no reset. Janela sem leitura aparece como `5h sem leitura` ou `7d sem leitura`, nunca como 0; sem leitura nas duas, a linha do início é a de sem leitura nova.

Na linha do modo econômico, quando o ritmo não esgota a semana antes do reset, o fim é `nesse ritmo não acaba antes do reset`. O ritmo não aparece com a semana num piso.

No início da sessão, se algo der errado com o próprio plugin, o Claude recebe mais uma linha fixa, por exemplo `hadouken: sessão não registrada (...); barra e alertas desligados nesta sessão.` ou `hadouken: barra indisponível (...)`.

Toda linha é montada só com números validados e frases fixas do código; nenhum texto lido de arquivo entra nela. Os avisos nunca bloqueiam o prompt: se algo falhar num hook, ele termina em silêncio (código 0) e o Claude segue normalmente. A guarda é outra coisa: enquanto ela está disparada, pode bloquear o prompt digitado numa sessão Fable (veja [A guarda de consumo](Guarda-de-consumo#a-guarda-de-consumo)).

---

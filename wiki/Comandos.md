# Comandos

[English](Commands)

## Comandos que o senhor digita

Todos respondem por um hook, antes do modelo: não gastam tokens. Os que mudam alguma coisa só aceitam o comando digitado; o Claude, uma sessão `claude -p` ou uma tarefa agendada não os usam.

| Comando | O que faz | Detalhes |
|---|---|---|
| `/hadouken:consumo` | Relatório de consumo: limites de 5 h e 7 dias com ritmo, tokens por projeto e por modelo·effort, cache e o GitHub Actions. O Claude também o chama quando o senhor pede. | [Relatório de consumo](Relatorio-de-consumo) |
| `/hadouken:liberar [Nh \| janela] [fable] [caro]` | Libera a guarda por um tempo; `off` e `on` desligam e religam a guarda. | [Como liberar](Guarda-de-consumo#como-liberar) |
| `/hadouken:limites [item valor \| item padrao \| padrao]` | Mostra e muda os limites da guarda, da barra, dos alertas, das proteções e da saúde do PC. | [O comando /hadouken:limites](Limites#o-comando-hadoukenlimites) |
| `/hadouken:saude [leve \| normal]` | A saúde do PC e a do próprio hadouken: RAM, temperaturas, bateria, disco, hooks, reparos, compatibilidade, conflitos, dados e economia. `leve` e `normal` ligam (por 4 h) e desligam o modo leve. | [Saúde do PC](Saude-do-PC#o-comando-hadoukensaude) |
| `/hadouken:aprender [status \| ligar \| desligar \| desfazer \| aprovar \| recusar]` | O aprendizado local. | [Aprendizado](Aprendizado#comandos) |
| `/hadouken:instalar` | Põe a barra de status no `settings.json`, mostrando a mudança e pedindo confirmação. | [Home](Home#o-que-o-hadoukeninstalar-muda-e-como-desfazer) |

## No VS Code

| Comando | O que faz |
|---|---|
| `Claude Hadouken: abrir a janela` | Abre a [janela do hadouken](Painel-e-janela-do-VS-Code#a-janela-do-hadouken), com todas as configurações. O clique no logo da barra de status faz o mesmo. |
| `Claude Hadouken: atualizar uso agora` | Lê o `/usage` na hora. O clique no item de uso faz o mesmo. |

## Agentes que o Claude usa

O hadouken traz agentes prontos, cada um com o modelo e o effort mais baratos que dão conta do serviço. A skill `roteamento` diz ao Claude qual escolher, e o [roteamento](Guarda-de-consumo#roteamento-de-modelo-e-effort) confere o despacho.

| Agente | Modelo · effort | Para quê |
|---|---|---|
| `hadouken:busca` | Haiku · low | Achar arquivos e símbolos, ler e resumir trechos; só leitura. |
| `hadouken:mecanico` | Haiku · low | Edição mecânica com instrução exata. |
| `hadouken:pesquisa` | Sonnet · low | Conferir doc, API ou versão na web, com a fonte. |
| `hadouken:executor` | Sonnet · medium | Implementar uma tarefa bem especificada, com testes. |
| `hadouken:revisor` | Opus · high | Revisar diff ou plano; só leitura. |
| `hadouken:revisor-critico` | Fable · xhigh | Segurança, autenticação, dinheiro e decisões caras de desfazer. |

---

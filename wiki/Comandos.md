# Comandos

[English](Commands)

## Comandos que o senhor digita

Todos respondem por um hook, antes do modelo: não gastam tokens. Os que mudam alguma coisa só aceitam o comando digitado; o Claude, uma sessão `claude -p` ou uma tarefa agendada não os usam.

| Comando | O que faz | Detalhes |
|---|---|---|
| `/hadouken:consumo` | Relatório de consumo: limites de 5 h e 7 dias com ritmo, tokens por projeto e por modelo·effort, cache e o GitHub Actions. O Claude também o chama quando o senhor pede. | [Relatório de consumo](Relatorio-de-consumo) |
| `/hadouken:liberar [Nh \| janela \| noite] [fable] [caro]` | Libera a guarda por um tempo (`noite`: até as 7h); `off` e `on` desligam e religam a guarda. | [Como liberar](Guarda-de-consumo#como-liberar) |
| `/hadouken:limites [item valor \| item padrao \| padrao]` | Mostra e muda os limites da guarda, da barra, dos alertas, das proteções e da saúde do PC. | [O comando /hadouken:limites](Limites#o-comando-hadoukenlimites) |
| `/hadouken:agentes [<agente> <modelo> [effort] \| <agente> off \| <agente> on \| <agente> padrao]` | Sem argumento, mostra a paleta efetiva: cada agente com o padrão e o que a sua config mudou. `revisor opus high` troca modelo e effort, `auditor off` e `auditor on` desligam e religam, `revisor padrao` volta ao padrão. Grava só `agentes.<agente>` do `config.json`. | [Agentes que o Claude usa](#agentes-que-o-claude-usa) |
| `/hadouken:janela [seg-sex 9-21 \| seg,qua,sex 08:30-18:00 \| off]` | Sem argumento, mostra a janela de trabalho. Com dias e horário, grava a janela; `off` a remove e o ritmo volta às 168 horas. | [A janela de trabalho](Guarda-de-consumo#a-janela-de-trabalho) |
| `/hadouken:saude [leve \| normal]` | A saúde do PC e a do próprio hadouken: RAM, temperaturas, bateria, disco, hooks, reparos, compatibilidade, conflitos, dados e economia. `leve` e `normal` ligam (por 4 h) e desligam o modo leve. | [Saúde do PC](Saude-do-PC#o-comando-hadoukensaude) |
| `/hadouken:aprender [status \| ligar \| desligar \| desfazer \| aprovar \| recusar]` | O aprendizado local. | [Aprendizado](Aprendizado#comandos) |
| `/hadouken:instalar` | Põe a barra de status no `settings.json`, mostrando a mudança e pedindo confirmação. | [Home](Home#o-que-o-hadoukeninstalar-muda-e-como-desfazer) |

## No VS Code

| Comando | O que faz |
|---|---|
| `Claude Hadouken: abrir a janela` | Abre a [janela do hadouken](Painel-e-janela-do-VS-Code#a-janela-do-hadouken), com todas as configurações. O clique no logo da barra de status faz o mesmo. |
| `Claude Hadouken: atualizar uso agora` | Lê o `/usage` na hora. O clique no item de uso faz o mesmo. |

## Agentes que o Claude usa

O hadouken traz dez agentes prontos, cada um com o modelo e o effort mais baratos que dão conta do serviço. A skill `roteamento` diz ao Claude qual escolher, e o [roteamento](Guarda-de-consumo#roteamento-de-modelo-e-effort) confere o despacho. O modelo e o effort da tabela são o padrão do arquivo de cada agente; o `/hadouken:agentes` muda.

| Agente | Modelo · effort | Para quê |
|---|---|---|
| `hadouken:busca` | Haiku · low | Achar arquivos e símbolos, ler e resumir trechos; só leitura. |
| `hadouken:varredor` | Haiku · medium | Varredura do repositório, inventário e número de fonte primária (consulta só de leitura, API); não edita. |
| `hadouken:pesquisa` | Sonnet · low | Conferir doc, API ou versão na web, com a fonte. |
| `hadouken:mecanico` | Haiku · low | Edição mecânica com instrução exata. |
| `hadouken:implementador-mecanico` | Sonnet · medium | Fatia mecânica provada por teste, sem decisão de negócio ou de arquitetura. |
| `hadouken:implementador` | Sonnet · high | Uma fatia com spec e plano fechados, com o teste primeiro. |
| `hadouken:revisor` | Sonnet · high | Revisar uma fatia contra a spec, o plano e as convenções; só leitura, devolve o defeito com `arquivo:linha`. |
| `hadouken:auditor` | Fable · high | Auditoria adversarial contra o código vivo; só leitura. |
| `hadouken:e2e` | Sonnet · high | O e2e onde o usuário vê e tarefas de operação; só cria artefato com o prefixo de teste do projeto e apaga ao final. |
| `hadouken:redator` | Sonnet · medium | Texto para terceiros, devolvido sem publicar. |

### Mudar a paleta

A chave `agentes` do `config.json` guarda a sua escolha, por agente (sem o prefixo `hadouken:`): `{"revisor": {"model": "opus", "effort": "high"}, "auditor": {"ativo": false}}`. Modelo: `haiku`, `sonnet`, `opus` ou `fable`; effort: `low`, `medium`, `high`, `xhigh` ou `max`; `ativo`: `true` ou `false`. Agente desconhecido, valor fora da lista ou tipo errado: o campo é ignorado e o início da sessão avisa. Só o senhor grava, pelo `/hadouken:agentes` ou à mão.

- **Quem vale.** O parâmetro explícito do despacho vence a sua config, e a sua config vence o arquivo do agente. A config vale para despachos `hadouken:<agente>`. Um despacho que o Claude lança sem `model` ou sem `effort` recebe os da config; o `fork` ignora os dois e não recebe nada.
- **Subir é decisão sua.** O que a sua config ou o `roteamento.subir` já aprovam passa em [N1 e N2](Guarda-de-consumo#roteamento-de-modelo-e-effort): `agentes.busca.model = "opus"` e um despacho `hadouken:busca` com `model: "opus"` passam; com `model: "fable"`, N1 nega. N1, N2 e A1 a A3 avaliam o despacho como o Claude o escreveu, sem o que a paleta injeta.
- **Desligado.** Com `ativo: false`, o despacho é negado e a mensagem aponta o substituto (`busca` → `varredor`, `varredor` → `busca`, `mecanico` → `implementador-mecanico`, `implementador-mecanico` → `implementador`, `implementador` → `implementador-mecanico`, `revisor` → `auditor`, `auditor` → `revisor`, `e2e` → `implementador`; `pesquisa` e `redator` não têm: "faça direto"); se o substituto também está desligado, "faça direto". Vale também com um `model` explícito no despacho, e com a guarda desligada.
- **Quando vale.** A paleta vale nos próximos despachos; o texto do início da sessão reflete a config de quando ela abriu e só muda na próxima.
- **`executor` e `revisor-critico` saíram na 0.6.0.** Um despacho para eles é negado com o substituto (`implementador` e `auditor`); isso só alcança a sessão aberta antes da atualização, porque depois dela o tipo some. Veja as [notas de quebra](Home#notas-de-quebra-da-060).
- **Agente local de mesmo nome.** Um agente seu com o mesmo nome em `~/.claude/agents` vence o do plugin no nome curto (`revisor`); a paleta vale para `hadouken:<nome>`. Remova as cópias locais dos nomes da paleta para não ficar com dois.
- **Outro plugin no despacho.** Outro plugin que também devolve `updatedInput` no Agent tem comportamento não documentado: o resultado entre os dois não é garantido.

---

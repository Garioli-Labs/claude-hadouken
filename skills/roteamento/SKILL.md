---
name: roteamento
description: Escolhe modelo, effort e se lança agente ou faz direto. Carregue antes de lançar qualquer agente.
---

# Roteamento: modelo, effort e agente

Use o mais barato que dá conta sem errar. Cada degrau acima só quando a tarefa pede julgamento.

## Agentes prontos

| Agente | Modelo · effort | Para quê |
|---|---|---|
| `hadouken:busca` | Haiku · low | Achar arquivos e símbolos, ler e resumir trechos, listar. Só leitura. |
| `hadouken:mecanico` | Haiku · low | Edição mecânica com instrução exata: renomear, aplicar mudança já escrita, trocar textos. |
| `hadouken:executor` | Sonnet · medium | Implementar uma tarefa bem especificada, com testes. |
| `hadouken:pesquisa` | Sonnet · low | Conferir doc, API ou versão e trazer a resposta com a fonte. |
| `hadouken:revisor` | Opus · high | Revisar diff ou plano: correção e casos de borda. Só leitura. |
| `hadouken:revisor-critico` | Fable · xhigh | Só segurança, autenticação, dinheiro e arquitetura cara de desfazer. Só leitura. |

O effort de cada agente é o da tabela. Mudar o effort de um despacho só com o motivo escrito no próprio prompt.

## Fazer direto

- A tarefa cabe em poucas chamadas sobre arquivos já conhecidos.
- O contexto necessário já está na conversa.
- A tarefa pede idas e vindas com o usuário.
- Escrever o brief custaria mais do que fazer.

## Lançar agente

- Busca ampla da qual só interessa a conclusão (protege o contexto principal).
- Trabalhos independentes que podem correr em paralelo.
- Tarefa longa e bem especificada que um modelo mais barato faz sem errar.
- Revisão que precisa de olhos frescos.

**Escolher o mais barato que dá conta.** Um degrau acima só quando a tarefa pede julgamento: decidir entre abordagens, lidar com spec ambígua ou mexer em segurança.

**Modelo principal mais barato.** Com a sessão em Sonnet ou Haiku, só sobe o que pede julgamento: `hadouken:revisor` ou `hadouken:revisor-critico`.

## Brief

Todo despacho para `hadouken:busca`, `hadouken:mecanico`, `hadouken:executor` ou `hadouken:pesquisa` leva os 5 itens:

```text
Objetivo: <uma frase>
Arquivos: <caminhos; trechos ou assinaturas que importam>
Não mexer: <lista>
Pronto quando: <teste, comando ou saída esperada>
Relatório: Feito / Arquivos / Não feito / Certeza
```

- Confira o resultado (diff, testes ou fontes) sem refazer o trabalho.
- Se o agente falhar ou relatar certeza baixa, faça você mesmo ou suba **um** degrau, nunca em loop.
- Não mande a um agente barato uma tarefa que exija adivinhar o que o brief não diz. Se o brief não fecha, a tarefa fica com você.

## O que a guarda barra

- Busca (`Explore` ou `hadouken:busca`) em Opus ou Fable, ou com effort `xhigh` ou `max`: relance com `hadouken:busca`.
- `hadouken:busca` ou `hadouken:mecanico` com o modelo trocado para Opus ou Fable: use `hadouken:executor` ou `hadouken:revisor`.

Só o usuário solta essas negações, com /hadouken:liberar.

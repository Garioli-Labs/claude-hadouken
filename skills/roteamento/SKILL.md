---
name: roteamento
description: Escolhe modelo, effort e se lança agente ou faz direto. Carregue antes de lançar qualquer agente.
---

# Roteamento: modelo, effort e agente

Instrução do usuário (CLAUDE.md do usuário ou do projeto) prevalece sobre esta skill.

## Fazer direto

Faça direto quando a tarefa cabe em até 3 chamadas de ferramenta e ~50 linhas de saída somadas. Acima disso, lance agente.

## Lançar agente

- Busca ampla da qual só interessa a conclusão (protege o contexto principal).
- Trabalhos independentes que correm em paralelo.
- Tarefa longa e bem especificada que um modelo mais barato faz sem errar.
- Revisão que precisa de olhos frescos.

## Paleta

O modelo·effort efetivo de cada agente vem da linha de roteamento do SessionStart e de `/hadouken:agentes`, que também muda ou desliga um agente (só o usuário grava). O frontmatter do agente e a config são o padrão; o principal sobe ou desce o padrão num despacho com motivo de uma linha.

| Agente | Para quê |
|---|---|
| `hadouken:busca` | Achar arquivo e símbolo, ler e resumir trecho. Só leitura. |
| `hadouken:varredor` | Varredura do repo, inventário, número de fonte primária. Só leitura. |
| `hadouken:pesquisa` | Conferir doc, API ou versão na web, com URL. |
| `hadouken:mecanico` | Edição com instrução exata: renomear, trocar texto, aplicar mudança já escrita. |
| `hadouken:implementador-mecanico` | Fatia mecânica provada por teste existente ou trivial. |
| `hadouken:implementador` | Fatia com spec e plano fechados, teste primeiro. |
| `hadouken:revisor` | Review de fatia pronta contra spec, plano e convenções, com `arquivo:linha`. Só leitura. |
| `hadouken:auditor` | Auditoria adversarial contra código vivo. Só leitura. |
| `hadouken:e2e` | e2e onde o usuário vê e tarefas de operação. |
| `hadouken:redator` | Texto para terceiros, devolvido sem publicar. |

Agente desativado: a guarda nega o despacho e indica o substituto; sem substituto, faça direto.

## Critério de modelo

Em ordem:
1. Acerto domina quando o erro custa caro: produção, dinheiro, autenticação, dado real, ação irreversível.
2. Senão, o modelo mais barato que acerta de primeira. Retrabalho conta no custo.
3. Empate: o mais rápido.

Escada: Haiku → Sonnet → Opus → Fable. Falha ou certeza baixa: suba um degrau, uma vez, nunca em laço.

## Effort

Decida por despacho pela mesma regra, no parâmetro `effort` do Agent. `max` só com ok do usuário.

## Faixa de consumo

O usuário vê o ritmo da semana na linha `7d X% vs Y% esperado → modo …` que o hadouken injeta, e em `/hadouken:consumo` (seção "Limites e ritmo"). O esperado conta só a janela de trabalho (`/hadouken:janela`).

- `modo econômico` (adiantado mais de 10 pontos): o padrão desce um degrau, exceto no critério 1.
- `modo folga` (atrasado mais de 10 pontos): o padrão sobe um degrau.

## Linha por despacho

Antes de cada despacho, uma linha: `tipo → modelo·effort — motivo`. O motivo só aparece quando o valor difere da paleta.

## Brief

Todo despacho leva: Tarefa / Objetivo / Arquivos / Não mexer / Pronto quando / Relatório.

```text
Tarefa: <nome curto ou card, ou "sem card">
Objetivo: <uma frase>
Arquivos: <caminhos; trechos ou assinaturas que importam>
Não mexer: <lista>
Pronto quando: <teste, comando ou saída esperada>
Relatório: Feito / Evidência / Não feito / Certeza, até 40 linhas
```

Se o brief não fecha sem adivinhar, a tarefa fica com você, não com um agente barato.

## Relatório do subagente

Até 40 linhas: Feito / Evidência (comando literal, saída cortada e `arquivo:linha`; sem despejo de arquivo) / Não feito / Certeza (com o motivo). Antes de dizer "pronto", re-rode uma checagem final de aceite (teste, comando ou leitura do diff).

## O que a guarda barra

N1 nega `Explore`, `hadouken:busca` ou `hadouken:varredor` em Opus ou Fable, ou com effort `xhigh` ou `max` pedido no despacho. N2 nega `hadouken:busca`, `hadouken:varredor` ou `hadouken:mecanico` com o modelo trocado para Opus ou Fable. Só o usuário solta: `/hadouken:liberar` por um tempo, ou `/hadouken:agentes`, que grava o modelo ou o effort como padrão do agente.

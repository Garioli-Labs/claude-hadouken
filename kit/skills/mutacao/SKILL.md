---
name: mutacao
description: Teste de mutação no fim de uma frente, antes do PR, só nas linhas alteradas no branch. Use quando a implementação e os testes estão prontos e falta provar que os testes pegam erro de verdade; não use no meio da frente nem sobre o código inteiro.
---

# Mutação

Mutação altera o código de propósito (troca `>` por `>=`, remove uma chamada) e roda os testes. Teste que continua verde com o código alterado não prova aquela linha: o mutante **sobrevive**.

## Quando

Fim da frente, antes do PR. Nunca no meio do trabalho.

## O que mutar

Só as linhas alteradas no branch. Tire as faixas de `git diff -U0 <base>...HEAD`, em cada arquivo de código (não teste, não doc), e passe só essas faixas à ferramenta.

## Ferramenta por stack

| Stack | Ferramenta |
|---|---|
| JS/TS | StrykerJS, rodado por `npx` (não vira dependência do projeto) |
| Python | mutmut |
| .NET | Stryker.NET |
| JVM | PIT |
| Outras | Não há ferramenta conhecida: diga isso ao usuário e peça a escolha; não invente uma |

Config temporária fora do repo; nada de config ou dependência nova commitada.

## Cada sobrevivente

Todo sobrevivente em linha alterada tem um destino:

1. **Morto com teste**: escreva o teste que falha com o mutante e passa com o código real.
2. **Justificado no PR**: uma linha dizendo por que o mutante é equivalente ou irrelevante (por exemplo, não muda o comportamento observável).

Sobrevivente sem destino bloqueia o PR.

## Sem nota percentual

Não existe nota mínima de mutação. O critério é cada sobrevivente nas linhas alteradas ter destino, não um número.

---
name: regua
description: Mostra, monta e grava a régua de desenvolvimento do hadouken-kit (a fase de cada skill). Só o usuário digita /hadouken-kit:regua [editar | aplicar [--projeto] | padrao [--projeto]]; sem argumento mostra a régua ativa e a origem.
disable-model-invocation: true
---

Argumento recebido: `$ARGUMENTS`

Só `editar` chega até aqui: os outros argumentos o hook do comando responde sozinho. Se o argumento não for `editar`, o hook não rodou nesta sessão: nada foi mudado; diga ao usuário para reiniciar a sessão ou rodar /reload-plugins, e pare.

## editar

Monte a régua com o usuário, fase a fase. Nada vale até ele digitar `/hadouken-kit:regua aplicar` (ou `aplicar --projeto`).

1. Liste as skills instaladas e habilitadas (as da lista de skills desta sessão) e os agentes disponíveis, para ele escolher. Skill só do usuário (`disable-model-invocation`) vai com `/` na lista; no JSON o nome vai sem `/`.
2. Pergunte uma fase de cada vez: nome da fase, skills em `usar`, `alternativas` (`skill` e `quando`), e `agente` se a fase delega a um subagente. Depois as `transversais` (`skill` e `quando`). Uma pergunta por mensagem; nada de supor.
3. Mostre o JSON inteiro ao usuário e peça o ok.
4. Com o ok, grave o JSON com a ferramenta Write no caminho que o hook informou no contexto desta expansão ("grave o rascunho da régua exatamente em ..."). Não grave em nenhum outro lugar, nem em `~/.claude`, nem em `.claude/` do projeto. Sem esse caminho no contexto, o hook não rodou: diga ao usuário para reiniciar a sessão ou rodar /reload-plugins, e pare.
5. Diga: o rascunho está pronto; `/hadouken-kit:regua aplicar` grava para o usuário todo e `/hadouken-kit:regua aplicar --projeto` grava só para este repositório (a régua do repo substitui a do usuário por inteiro); `/hadouken-kit:regua padrao` volta à régua padrão.

Formato (o arquivo é a própria régua, sem chave `regua`):

```json
{"fases": [
   {"fase": "Ideia", "usar": ["superpowers:brainstorming"],
    "alternativas": [{"skill": "mattpocock-skills:grill-with-docs", "quando": "projeto tem glossário/ADRs"}]},
   {"fase": "Auditoria da spec", "agente": "hadouken:auditor"}],
 "transversais": [{"skill": "mattpocock-skills:diagnosing-bugs", "quando": "lentidão ou regressão"}]}
```

Limites (o `aplicar` descarta o que passar): nomes de skill e de agente só com letras, números, `_`, `:` e `-`, até 80 caracteres; `fase` até 60 e `quando` até 120 caracteres, em uma linha; até 20 fases, 12 itens em cada `usar`, 12 `alternativas` por fase e 40 transversais; a fase precisa de `usar` ou de `agente`.

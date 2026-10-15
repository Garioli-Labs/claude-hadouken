---
name: fluxo
description: Qual skill usar agora — o mapa do hadouken-kit entre superpowers, Matt Pocock, poka-yoke e as especialidades, com o momento de cada uma. Use quando a dúvida for "qual skill/etapa agora", quando duas skills parecerem servir para a mesma coisa, ou ao começar trabalho novo.
---

# Fluxo do hadouken-kit

Regra: o **superpowers** cuida do processo. O **Matt Pocock** entra onde o superpowers não tem equivalente. Cada duplicata tem um dono só.

Acione cada skill **sozinho, no momento dela**, sem esperar o usuário pedir pelo nome. Se o momento chegou no meio de outra etapa, termine o passo em andamento e acione a skill antes do próximo.

As citadas com `/` (`/mattpocock-skills:...`) têm `disable-model-invocation` no autor: o modelo não as aciona. No momento delas, sugira ao usuário digitar o comando, com uma linha dizendo por quê; não leia o SKILL.md à mão para contornar a escolha do autor.

## Processo

| Etapa | Use | A outra, só quando |
|---|---|---|
| Ideia nebulosa | `superpowers:brainstorming` | `/mattpocock-skills:grill-with-docs` quando o projeto tem glossário/ADRs a atualizar durante a conversa |
| Falar não resolve | `mattpocock-skills:prototype` + `/mattpocock-skills:handoff` para uma sessão limpa | — |
| Registrar a forma | spec do brainstorming | `/mattpocock-skills:to-spec` quando a conversa já decidiu tudo |
| Quebrar o trabalho | `superpowers:writing-plans` | `/mattpocock-skills:to-tickets` quando vai para um tracker; `/mattpocock-skills:wayfinder` quando não cabe num plano |
| Executar | `superpowers:subagent-driven-development` | `superpowers:executing-plans` quando o usuário escolhe execução sem subagentes; `/mattpocock-skills:implement` quando o trabalho já está em tickets do tracker; `/mattpocock-skills:implement-spec` para implementar de uma vez, em paralelo, todos os tickets de uma spec |
| Teste e bug | `superpowers:test-driven-development`, `superpowers:systematic-debugging` | `mattpocock-skills:tdd` quando o usuário pede testes de integração; `mattpocock-skills:diagnosing-bugs` para lentidão e regressão de desempenho |
| Revisar | `superpowers:requesting-code-review` por tarefa; `mattpocock-skills:code-review` no branch inteiro, antes do merge | `mattpocock-skills:pr` ao escrever o corpo do PR |
| Melhorar o sistema | `/mattpocock-skills:improve-codebase-architecture` quando o mesmo atrito se repete; `poka-yoke:retro` depois de incidente | `/mattpocock-skills:retro` no fim de uma sessão de código, para ajustar o ambiente do agente (não o código) |
| Especialidades | web: `hadouken-kit:yu-ux-web-expert` (prevalece sobre `ui-ux-pro-max`); segurança: `poka-yoke:audit`, `poka-yoke:authz`, `security-review`; grafo do código: `hadouken-kit:graphify`; binário/APK/firmware: REA (plugin `hadouken-rea`) | — |

## Os momentos do Matt Pocock

Todas as skills que o `mattpocock-skills` registra, com o momento em que entram sem pedido:

| Momento | Skill |
|---|---|
| O usuário traz um plano, decisão ou ideia já formada e ela precisa de prova antes de virar trabalho | `mattpocock-skills:grilling` (a mesma entrevista em `/mattpocock-skills:grill-me`; com glossário/ADRs no projeto, `/mattpocock-skills:grill-with-docs`) |
| Uma pergunta de forma (estado, lógica, tela) não se resolve conversando | `mattpocock-skills:prototype` |
| A conversa já decidiu tudo e falta escrever | `/mattpocock-skills:to-spec` |
| O trabalho vai para o tracker do projeto | `/mattpocock-skills:to-tickets`; depois, `/mattpocock-skills:implement` executa os tickets um a um, ou `/mattpocock-skills:implement-spec` todos em paralelo |
| O trabalho é maior que uma sessão | `/mattpocock-skills:wayfinder` |
| Primeiro uso de `to-spec`, `to-tickets`, `triage` ou `wayfinder` num repositório sem tracker configurado | `/mattpocock-skills:setup-matt-pocock-skills`, uma vez |
| Issues ou PRs de fora esperando classificação | `/mattpocock-skills:triage` |
| Contexto longo, compactação perto ou troca para uma sessão limpa | `/mattpocock-skills:handoff` |
| Lentidão ou regressão de desempenho | `mattpocock-skills:diagnosing-bugs` |
| Testes de integração pedidos pelo usuário | `mattpocock-skills:tdd` (o ciclo de teste do dia a dia é do `superpowers:test-driven-development`) |
| Antes do merge, revisão do branch inteiro contra os padrões do repo e o spec | `mattpocock-skills:code-review` |
| Escrever o corpo de um PR | `mattpocock-skills:pr` |
| Um passo que só o usuário pode fazer (credencial, painel de terceiro, segredo de CI, migração manual) | `mattpocock-skills:wizard` |
| Desenhar a interface de um módulo ou decidir onde fica uma costura | `mattpocock-skills:codebase-design` |
| O mesmo atrito aparece pela segunda vez | `/mattpocock-skills:improve-codebase-architecture` |
| Surge um termo de domínio novo ou uma decisão de arquitetura que precisa de registro | `mattpocock-skills:domain-modeling` |
| Um fato de documentação ou de API precisa de fonte primária antes de virar código | `mattpocock-skills:research` |
| O usuário quer aprender um conceito, não só ver o trabalho feito | `/mattpocock-skills:teach` |
| Uma decisão que só outra pessoa pode responder | `/mattpocock-skills:to-questionnaire` |
| O usuário diz que a última mensagem não ficou clara | `/mattpocock-skills:wait-what` |
| Fim de uma sessão de código: o que mudar no ambiente do agente | `/mattpocock-skills:retro` (incidente: `poka-yoke:retro`) |
| Escrever ou editar uma skill, o AGENTS.md ou o CLAUDE.md | `superpowers:writing-skills` para o processo de uma skill; `mattpocock-skills:writing-for-agents` como referência |
| Dúvida sobre qual skill do Matt serve | `/mattpocock-skills:ask-matt` (para "qual skill agora" no geral, vale esta página) |

## Duas regras a mais

- Antes de etapa cara (revisor Fable, muitos subagentes, `Workflow`), leia a linha de consumo do hadouken. Com alerta de projeção, pergunte ao usuário antes.
- Acionar sozinho não passa por cima do usuário: uma skill que publica (tracker, issue, PR) ou que gasta muito mostra o que vai fazer e pede a confirmação antes.

## REA

O REA vem desligado. Para ligar, no terminal: `claude plugin install hadouken-rea@claude-hadouken` e depois `claude plugin enable hadouken-rea@claude-hadouken`; em seguida, abra uma sessão nova. Ele roda os programas analisados com as permissões do usuário. Requer Node 22.19+, 24.11+ ou 26+.

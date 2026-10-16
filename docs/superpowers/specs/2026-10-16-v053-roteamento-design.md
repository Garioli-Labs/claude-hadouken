# v0.5.3, parte roteamento: modelo, effort e agente certos para cada tarefa

Data: 2026-10-16. Status: desenho aprovado em conversa, parte por parte. Esta spec aguarda a revisão do Sr. Garioli.

Esta é a segunda spec da v0.5.3. A primeira é `2026-10-16-v053-vscode-limites-design.md`, que ganha a aba Roteamento descrita na §6.

## 1. O que o Sr. Garioli pediu

- Haiku, Sonnet, Opus e Fable, cada um "no melhor momento", com o effort "realmente necessário".
- "Não pode ficar jogando effort alto à toa ou modelo caro à toa."
- Com Opus ou Fable como modelo principal, eles passam para Haiku ou Sonnet o que esses fazem sem errar. O que os modelos fortes entregam a eles é um trabalho que Haiku ou Sonnet conseguem fazer sem cometer erros.
- Avaliar se é melhor lançar um agente ou não, "focando em qualidade da entrega e economia de tokens".

Decisões dele:
- **Firmeza:** orientar e **barrar o óbvio**. O resto passa, com aviso.
- **Sessão principal:** **sugerir com moderação** a troca de modelo ou effort, que só ele pode fazer.

### Critérios de sucesso

- Busca e exploração nunca rodam em Opus ou Fable, nem com effort `xhigh` ou `max`.
- Trabalho mecânico e bem especificado vai para Haiku ou Sonnet, com um brief que basta.
- Um agente só é lançado quando compensa. O resto é feito direto.
- Nenhum trabalho legítimo fica travado: o que é negado volta com a indicação exata de como relançar, e o `/hadouken:liberar` solta as negações.
- O senhor vê, no `/hadouken:consumo`, quanto o roteamento economizou e onde houve retrabalho.

## 2. Onde mora a regra

O caminho escolhido junta uma regra curta sempre presente a uma skill completa, carregada na hora de usar.

- **Regra curta no SessionStart:** no máximo 6 linhas, em `src/hooks/session-start.js`, no mesmo bloco do contexto de hoje.
  - "Antes de lançar um agente, carregue `hadouken:roteamento`."
  - "Busca: `hadouken:busca`."
  - "Mecânico com instrução exata: `hadouken:mecanico`."
  - "Tarefa especificada: `hadouken:executor`."
  - "Revisão: `hadouken:revisor`; Fable só para segurança, autenticação, dinheiro e arquitetura."
  - "Cabe em poucas chamadas sobre arquivos conhecidos: faça direto."
- **Skill `hadouken:roteamento`** (`skills/roteamento/SKILL.md`) traz a tabela completa (§3), as regras de fazer direto ou lançar agente (§4) e o modelo de brief (§5).
  - Ela pode ser acionada pelo modelo, ou seja, não leva `disable-model-invocation`.
  - Ela fica abaixo de ~2 mil tokens.
- **Tudo no plugin principal**, não no kit: quem nega é a guarda, e ela não pode apontar para um agente que só existiria no kit.
- A skill `fluxo` do kit ganha uma linha: "modelo, effort e agente: `hadouken:roteamento`".

## 3. Agentes prontos

Os agentes ficam em `agents/` do plugin, e o nome de cada um ganha o prefixo `hadouken:`.

| Agente | `model` | `effort` | `tools` | Para quê |
|---|---|---|---|---|
| `hadouken:busca` | haiku | low | Read, Grep, Glob | Achar arquivos e símbolos, ler e resumir trechos, listar. Só leitura. |
| `hadouken:mecanico` | haiku | low | Read, Edit, Write, Grep, Glob | Edição mecânica com instrução exata: renomear, aplicar uma mudança já escrita, trocar textos. |
| `hadouken:executor` | sonnet | medium | todas | Implementar uma tarefa bem especificada, com testes. |
| `hadouken:pesquisa` | sonnet | low | WebSearch, WebFetch, Read | Conferir doc, API ou versão e trazer a resposta com a fonte. |
| `hadouken:revisor` | opus | high | Read, Grep, Glob, Bash | Revisar um diff ou plano: correção e casos de borda. Só leitura. |
| `hadouken:revisor-critico` | fable | xhigh | Read, Grep, Glob, Bash | Só segurança, autenticação, dinheiro e decisões de arquitetura caras de desfazer. Só leitura. |

- **A descrição de cada agente** diz quando usá-lo e quando não usá-lo. É ela que o Claude Code mostra ao escolher.
- **O corpo de cada agente** traz o contrato de relatório:
  - o que foi feito;
  - os arquivos tocados;
  - o que não foi possível fazer;
  - a certeza (`alta` ou `baixa`, com o motivo).
- **`hadouken:busca` e os revisores não editam.** A ferramenta `Bash` dos revisores serve para rodar testes e `git diff`. Os comandos que escrevem continuam vigiados pela guarda de hoje.

## 4. Fazer direto ou lançar agente

**Fazer direto quando:**
- a tarefa cabe em poucas chamadas sobre arquivos já conhecidos;
- o contexto necessário já está na conversa;
- a tarefa pede idas e vindas com o usuário;
- escrever o brief custaria mais do que fazer.

**Lançar agente quando:**
- for uma busca ampla da qual só interessa a conclusão, o que protege o contexto principal;
- houver trabalhos independentes que podem correr em paralelo;
- for uma tarefa longa e bem especificada que um modelo mais barato faz sem errar;
- for uma revisão que precisa de olhos frescos.

**Escolher o mais barato que dá conta.** Um degrau acima só quando a tarefa pede julgamento: decidir entre abordagens, lidar com uma spec ambígua ou mexer em segurança.

**Modelo principal mais barato.** Com a sessão em Sonnet ou Haiku, a regra só manda para cima o que pede julgamento, ou seja, para `hadouken:revisor` ou `hadouken:revisor-critico`.

**Effort.** O effort de cada agente é o da tabela. Mudar o effort de um despacho só vale com motivo escrito no próprio prompt.

## 5. O brief para Haiku e Sonnet

Todo despacho para `hadouken:busca`, `hadouken:mecanico`, `hadouken:executor` ou `hadouken:pesquisa` leva:

1. **Objetivo:** uma frase.
2. **Arquivos exatos:** caminhos, e trechos ou assinaturas quando importam.
3. **O que não pode ser mexido.**
4. **Pronto quando:** o critério verificável, como um teste, um comando ou uma saída esperada.
5. **Formato do relatório:** o contrato da §3.

- **O modelo principal confere** o resultado, lendo o diff, os testes ou as fontes, mas não refaz o trabalho.
- **Se o agente falhar ou relatar certeza baixa,** o modelo principal faz ele mesmo ou sobe **um** degrau, nunca em loop.
- Um agente barato não recebe uma tarefa que exija adivinhar algo que o brief não diz. Se o brief não consegue ser fechado, a tarefa fica com o modelo principal.

## 6. A guarda: negar o óbvio, avisar o resto

As regras novas ficam em `src/guarda/despacho.js` e são usadas pelo hook `guarda-despacho.js`, que já vigia `Agent`, `Task` e `Workflow`.

- **Negar** só usa os campos estruturados: o tipo de agente, o modelo e o effort, resolvidos por `perfilDoDespacho`.
- **Avisar** pode usar uma heurística sobre o texto da descrição.
- As respostas usam textos fixos em `src/guarda/mensagens.js`. O texto do despacho nunca volta na resposta.

### 6.1 Negados

- **N1.** Um agente de busca (`subagent_type` ∈ `Explore`, `hadouken:busca`) resolvido para Opus ou Fable, ou com effort `xhigh` ou `max`. A resposta é: "hadouken: busca não usa Opus/Fable nem effort alto. Relance com hadouken:busca."
- **N2.** `hadouken:busca` ou `hadouken:mecanico` com `model` trocado no despacho para Opus ou Fable. A resposta é: "hadouken: este agente existe para ser barato. Use hadouken:executor ou hadouken:revisor se a tarefa pede mais."

### 6.2 Passam com aviso ao modelo

O aviso vai como `additionalContext`, e o caso fica registrado.

- **A1.** Um agente resolvido para Fable, ou com effort `max`, que não seja o `hadouken:revisor-critico` nem um agente cujo **arquivo** (frontmatter) já declare esse modelo ou esse effort. Os agentes do usuário, como `fable-max` e `fable-xhigh`, passam sem aviso.
- **A2.** Um agente resolvido para Opus ou Fable cuja descrição bate com o padrão de busca. O padrão é uma lista fixa de verbos e expressões no começo da descrição: `encontr`, `procur`, `list`, `localiz`, `onde fica`, `find`, `search`, `locate`. O prefixo `list` vale nas duas línguas. O aviso sugere usar `hadouken:busca`.
- **A3.** Mais de 5 despachos em 10 minutos na mesma sessão, cada um com um prompt de menos de 400 caracteres. A sugestão é fazer direto ou juntar tudo num agente só.

### 6.3 Afrouxar

- O `/hadouken:liberar` de hoje também solta N1 e N2 enquanto a liberação durar. A1 a A3 continuam só avisando.
- **Config:** uma chave nova `roteamento` no `config.json`, com o padrão abaixo. A janela do VS Code (aba Roteamento) e o `src/config/` da outra spec cuidam da leitura e da gravação.

```json
{ "roteamento": { "negarN1": true, "negarN2": true, "avisos": true, "sugerirSessao": true } }
```
- Um valor inválido usa o padrão e gera um aviso de texto fixo, como a `guarda` faz hoje.

## 7. Sugestão para a sessão principal

A sugestão roda no hook `UserPromptSubmit`, que já existe (`src/hooks/prompt-submit.js`), lendo só o transcript, com os limites de leitura de hoje (`src/transcripts.js`).

- **Para baixo:**
  - **Quando:** o modelo da sessão é Opus ou Fable, ou o effort é `high` ou acima, e nas **últimas 15 respostas** pelo menos 80% foram trabalho simples.
  - **Resposta simples:** só usa Read, Grep, Glob, Edit ou Write, com menos de 40 linhas mudadas, sem `Agent`/`Task`/`Workflow` e sem bloco de pensamento acima de ~2 mil tokens.
  - **Sugestão:** `/effort medium`. Se a sessão já estiver em `medium` ou abaixo e o modelo for Fable ou Opus, a sugestão é `/model sonnet`.
- **Para cima:**
  - **Quando:** o effort da sessão é `low` ou `medium` e, nas últimas 15 respostas, há sinais de dificuldade.
  - **Sinais:** o mesmo comando de teste falhou 3 vezes, ou o mesmo arquivo foi editado e voltou ao conteúdo anterior.
  - **Sugestão:** `/effort high`.
- **Como chega:**
  - uma marca na barra do terminal e no item do VS Code, `↓ effort medium` ou `↑ effort high`;
  - uma linha curta em `additionalContext` para o modelo repassar ao usuário.
- **Frequência:** no máximo **uma vez a cada 30 minutos por sessão**, e só quando a sugestão muda. Com `roteamento.sugerirSessao` = `false`, ela não roda.
- **Sem custo de modelo:** a análise é feita pelo próprio hook, sem chamar nenhum modelo.

## 8. Medição

- **Novos campos no registro de despacho que a guarda já grava:**
  - o agente, o modelo e o effort resolvidos;
  - a regra que se aplicou (N1, N2, A1, A2, A3 ou nenhuma);
  - depois, pelos transcripts dos subagentes, os tokens e a duração.
- **Retrabalho:** em até 15 minutos depois do agente, a mesma sessão relança uma tarefa com uma descrição parecida num modelo mais forte, ou o modelo principal reescreve mais da metade das linhas que o agente mudou.
  - "Descrição parecida" quer dizer mesmas palavras, ignorando a ordem, com pelo menos 60% em comum.
- **No `/hadouken:consumo`, a tabela Roteamento** (7 dias):
  - despachos por agente e por modelo;
  - quantos foram negados e quantos foram avisados, por regra;
  - o retrabalho por agente;
  - a estimativa de custo evitado, isto é, o custo do despacho negado ou avisado comparado com o custo do agente sugerido, pela tabela de preços que o relatório já usa.

  A mesma tabela sai também na saída em JSON.
- **O aprendizado só sugere,** como as sugestões de hoje (`src/aprendizado/ajustar.js`, a parte das sugestões). Exemplo: "hadouken:mecanico teve 25% de retrabalho em 7 dias; subir para Sonnet?". O usuário aplica pelo `/hadouken:aprender` ou na janela. **O roteamento nunca muda sozinho.**

## 9. Ordem de execução

1. Os agentes em `agents/` e a validação deles pelo `claude plugin validate`.
2. A skill `hadouken:roteamento` e a regra curta no SessionStart.
3. N1, N2 e A1 a A3 na guarda, a chave `roteamento` e a liberação.
4. A sugestão para a sessão principal e a marca na barra.
5. A medição, a tabela no relatório e as sugestões do aprendizado.

A aba Roteamento da janela entra junto da janela, na outra spec.

## 10. Testes

- **Agentes:**
  - o frontmatter de cada um tem o `model`, o `effort` e as `tools` da tabela;
  - `hadouken:busca` e os revisores não têm Edit nem Write;
  - o `claude plugin validate .` passa.
- **SessionStart:** a regra curta tem no máximo 6 linhas e cita só agentes que existem.
- **Skill:** fica abaixo do teto de tamanho, e todo agente citado nela existe.
- **Guarda:**
  - N1 e N2 com despachos falsos: modelo pelo parâmetro, pelo frontmatter, pela variável de ambiente e pela sessão;
  - A1 respeita o frontmatter do usuário;
  - A2 com os verbos, em português e em inglês, e sem falso positivo em "listar os riscos da arquitetura" num revisor Opus. Esse caso só gera aviso, nunca negação;
  - A3 com a janela de 10 minutos;
  - a liberação solta N1 e N2;
  - cada chave de `roteamento` desligando a sua regra;
  - config inválida usa os padrões;
  - o texto do despacho nunca volta na resposta.
- **Sessão:**
  - transcripts de exemplo: simples em Fable e `high` sugere `medium`; difícil em `medium` sugere `high`; misto não sugere nada;
  - o limite de 30 minutos;
  - só sugere quando a sugestão muda;
  - transcript ilegível não sugere e não quebra o hook;
  - o hook fica dentro do tempo de hoje.
- **Medição:**
  - retrabalho por relançamento e por reescrita;
  - a semelhança de descrições;
  - a tabela no relatório e no JSON;
  - a sugestão do aprendizado e nenhuma mudança automática.
- **Suíte inteira verde.**

## 11. Fora desta spec

- Trocar o modelo ou o effort da sessão principal sozinho: o Claude Code não permite isso a um hook, e a decisão é do usuário.
- Classificar a tarefa pelo texto do prompt para **negar**: só aviso.
- As otimizações gerais de consumo que não são roteamento: ficam para uma lista a apresentar ao Sr. Garioli antes do plano.
- A revisão de segurança, estabilidade, compatibilidade, RAM, hardware e peso do plugin: v0.5.4.

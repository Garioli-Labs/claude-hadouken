# hadouken 0.6.0 — agentes fundidos, janela de trabalho, paleta configurável, dedup de dependências e régua de desenvolvimento

- Data: 2026-11-09 · Decisões: fgarioli (grill de 09/11/2026) · Branch: `feat/v060-agentes-janela-dedup` (base `a73e458`)
- Versões: `hadouken` 0.5.8 → **0.6.0** (quebra) · `hadouken-kit` 1.1.2 → **1.2.0**
- Um PR, sete fatias, um commit por fatia com `node --test` verde.

## 0. Estado atual verificado (HEAD `a73e458`)

Leitura por `grep`/`sed` no clone e por `ls` no cache instalado (`~/.claude/plugins/cache/claude-hadouken/`).

| Tema | Onde | O que há |
|---|---|---|
| Dependências do kit | `kit/.claude-plugin/plugin.json:12-22` | `hadouken`, `superpowers@claude-plugins-official`, `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills`, `ui-ux-pro-max` |
| Ids das dependências | `src/instalar/claude-cli.js:21-24` | `DEPENDENCIAS_KIT`: as seis acima como `nome@marketplace`; quatro são `@claude-hadouken` de terceiros |
| Catálogo de terceiros | `.claude-plugin/marketplace.json:30-35` e seguintes | `mattpocock-skills` (github mattpocock/skills, sha `4ae2317`), `poka-yoke` (rainmanjam/poka-yoke, subdir), `fullstack-dev-skills` (jeffallan/claude-skills), `ui-ux-pro-max` (nextlevelbuilder/ui-ux-pro-max-skill), todos com sha fixo |
| Versões testadas | `kit/testado.json:2-9` | versão por id de dependência (`mattpocock-skills@claude-hadouken` 1.3.2 em `:5`) |
| Instalação | `install.sh:181` → `src/instalar-tudo.js:317` → `passoKit` em `src/instalar/claude-cli.js:106`; `plugin install\|update` em `:92`, kit em `:113`; `listarPlugins` em `:65` (`claude plugin list --json` → `id`, `version`, `scope`, `enabled`, `installPath`) | compara só por id `nome@marketplace`; dependência que falta chega pelo `plugin install hadouken-kit` (`:113`), que a traz pelo manifesto |
| Ligar/desligar plugin | `src/instalar/claude-cli.js:134-136` (REA): `claude plugin enable\|disable <nome>@<marketplace>`, conferido pela lista | — |
| Registro de plugins | `~/.claude/plugins/installed_plugins.json` `version: 2`, `plugins[id] = [{scope, installPath, version, gitCommitSha, auto?}]` (sem estado ligado); `auto: true` marca o plugin que o claude instalou como dependência de outro, e a entrada que o usuário instalou não tem a chave (`claude plugin list --json` não traz `auto`: o instalador lê o registro); ligado = `settings.json` `enabledPlugins[id]`; `known_marketplaces.json[m] = {source: {source: "github", repo}, installLocation}`; `marketplace.json` de cada marketplace em `<installLocation>/.claude-plugin/marketplace.json`, `plugins[].source` = `"./"` (relativo) ou `{source: "url"\|"git-subdir"\|"github", url\|repo, sha}` | leitura feita em 09/11/2026 na máquina do mantenedor |
| Cópias antigas | `src/instalar/atualizacao-auto.js:22` (`COPIAS_ANTIGAS` = `mattpocock-skills@mattpocock`, `poka-yoke@poka-yoke`, `fullstack-dev-skills@fullstack-dev-skills`, `ui-ux-pro-max@ui-ux-pro-max-skill`), uso `:46`; `ligarAtualizacao({arquivo, agoraMs, prontas})` `:32` lê `enabledPlugins` `:41`, escreve `:55`; chamada por `src/instalar-tudo.js:323` | desliga as cópias de outro marketplace quando as do kit estão prontas: a cópia do kit vence; nunca desinstala |
| Renames | `src/instalacao.js:126-128` | loop sobre `renames` do marketplace |
| Leituras de registro | `installed_plugins.json`: `src/instalacao.js:58,125`, `src/indice-hooks.js:254`; `known_marketplaces.json`: `src/instalar/atualizacao-auto.js:67-69` (`marketplaceConhecido`) | — |
| Robô de terceiros | `.github/scripts/kit-atualizar.mjs:79,87,143-148,203` | veta terceiro que ganha `hooks/`, `bin/`, `.mcp.json`, `.lsp.json`; sobe sha |
| Ritmo | `src/ritmo.js:2` `JANELA_H = 168`; `:18` início; `:20` esperado = horas ÷ 168 × 100 | sem noção de dia útil |
| Projeções | `src/uso/frase.js:87-93` ("esgota"); `src/previsao.js:148` (instante); `src/guarda/mensagens.js:35` e `src/alerta.js:217,30` (texto "chega a 100%") | projeção em horas corridas |
| Config | `src/guarda/config.js:32` padrão; `:56` `guardaDaConfig`; `:63-66` valor inválido → aviso + padrão; `:126` `gravarGuardaLigada` → `gravarJsonAtomico` (`src/estado.js:152`, tmp + `renameSync` `:169`) | — |
| Agentes do plugin | `agents/*.md` (`name :2`, `model :4`, `effort :5`) | busca haiku·low; mecanico haiku·low; executor sonnet·medium; pesquisa sonnet·low; revisor opus·high; revisor-critico fable·xhigh |
| Regras N1/N2 | `src/roteamento/regras.js:22,25` | N1 nega Explore/`hadouken:busca` em opus/fable ou xhigh/max; N2 nega `hadouken:busca`/`mecanico` com model opus/fable |
| Texto de roteamento | `src/roteamento/regra.js:4-10` (`LINHAS_REGRA`), consumido em `src/hooks/session-start.js:196` | texto fixo |
| Perfil do despacho | `src/guarda/despacho.js:40,63,77` | model/effort lidos do frontmatter |
| Hook de despacho | `src/hooks/guarda-despacho.js:55` (`return` com guarda desligada), roteamento `:94`; matcher `Agent\|Task\|Workflow` em `hooks/hooks.json:13` | nada roda com guarda desligada |
| Skill roteamento | `skills/roteamento/SKILL.md` (62 linhas; seções `:10,23,30,41,57`) | tabela de agentes fixa |
| Comandos | `skills/*` (aprender, consumo, instalar, liberar, limites, roteamento, saude); CLI `node "$HOME/.claude/hadouken/bin/cli.mjs"` (`skills/consumo/SKILL.md:11,15`, shim `src/comandos.js:9`); não há `commands/` nem `bin/` no repo | — |
| Gravação por comando | `hooks/hooks.json:75-77` `UserPromptExpansion` `hadouken:liberar` → `src/hooks/liberar.js:73,81,115` (lê `command_name`, `command_args`) → `:76` `gravarGuardaLigada` | só o usuário, ao digitar, grava config |
| Fluxo do kit | `kit/hooks/fluxo.js:10` (texto do SessionStart, 19 linhas, não lê stdin/arquivo/ambiente); `kit/skills/fluxo/SKILL.md:14-26` (Processo), `:28-56` (momentos Matt Pocock), `:58` | régua fixa |
| Teste do fluxo | `test/kit-fluxo.test.js:15-22,28-30,47,77-86` | exige nomes de skill e texto do SessionStart |
| Cache do kit | `~/.claude/plugins/cache/claude-hadouken/hadouken-kit/1.1.2/` = `hooks/ skills/ testado.json` | o kit instalado não tem `src/`: código do kit é autocontido em `kit/` |
| Glossário/ADR | `test -e CONTEXT.md GLOSSARY.md docs/adr` → ausentes | — |
| Testes/CI | `package.json:8` `node --test`, sem devDependencies; `.github/workflows/ci.yml:45`, ignora `*.md` e `docs/**` (`:10-16`) | — |

Fatos da doc oficial do Claude Code (plugins/dependencies, troubleshooting, loading, hooks, sub-agents), consultados em 09/11/2026:

- Dependência sem `@` resolve no marketplace do plugin que a declara; dependência **desabilitada deixa o plugin dependente desabilitado** (`Dependency "<dep>" is disabled`).
- Dois plugins habilitados com o mesmo nome vindos de marketplaces diferentes: os dois aparecem, os hooks de um não rodam; qual skill carrega não é documentado.
- Agente de mesmo nome em `~/.claude/agents` vence o agente de plugin; `model` passado no despacho vence o frontmatter.

Fato medido em Claude Code 2.1.321 (experimento `claude -p`, transcript do subagente):

- PreToolUse com `updatedInput` no tool Agent troca o modelo (pedido `haiku` → hook `sonnet` → `message.model` = `claude-sonnet-5-5`) e o effort (hook `low` → `agent-*.meta.json` `"effort":"low"`) do subagente.
- O `tool_input` que o principal manda não traz `effort`; o stdin do hook traz o effort da sessão num campo de topo `effort`.

## 1. Problema

Quem usa o hadouken:

1. Tem dois conjuntos de agentes que se sobrepõem (os do plugin e os que escreveu em `~/.claude/agents`), com modelos fixos no frontmatter e sem jeito de trocar sem editar arquivo.
2. Vê o ritmo de consumo contra 168 horas corridas, embora trabalhe só em dias e horas úteis: o "esperado" e as projeções ("esgota", "chega a 100%") mentem no fim de semana e à noite.
3. Recebe cópias duplicadas de skills de terceiros quando já tinha o mesmo plugin instalado de outro marketplace (ex.: `mattpocock-skills@mattpocock` e `mattpocock-skills@claude-hadouken`, 38 skills em dobro, commits diferentes da mesma 1.3.2).
4. Não pode montar o próprio processo de desenvolvimento: a sequência de fases e skills é fixa no kit e não muda por repositório.
5. Não tem, no processo padrão, auditoria adversarial nem teste de mutação.

## 2. Solução

- **Paleta única de dez agentes** no plugin, com model·effort padrão por agente e override por usuário em `config.json`, aplicado por hook no despacho.
- **Janela de trabalho configurável** (dias e horário): o ritmo e as projeções contam só minutos úteis.
- **Dedup das dependências do kit**: a cópia que o usuário já tem vence; o kit não instala a dele e desliga a dele quando as duas existem e a do kit foi instalada como dependência (`auto: true`); o que o usuário instalou nunca é desligado; nunca desinstala.
- **Régua de desenvolvimento configurável**: fases com skills e agente, mais gatilhos transversais; global, substituível por uma régua do repositório; a padrão traz Auditoria e Mutação.
- **Skill roteamento reescrita**: critério de escolha de modelo, faixa de consumo, "faça direto", brief e relatório padronizados.

## 3. Histórias de usuário

Agentes e paleta

1. Como dev, quero uma paleta única de agentes no plugin, para não manter cópias locais que divergem.
2. Como dev, quero que cada agente tenha model·effort padrão sensato, para não escolher a cada despacho.
3. Como dev, quero trocar o modelo de um agente com `/hadouken:agentes revisor opus high`, para ajustar custo e qualidade sem editar arquivo.
4. Como dev, quero desligar um agente com `/hadouken:agentes auditor off`, para que o Claude use outro no lugar.
5. Como dev, quero que o despacho que já traz `model` ou `effort` explícito seja respeitado, para que o contexto principal possa subir ou descer um degrau com motivo.
6. Como dev, quero ver a paleta efetiva (padrão + override + ativo) com `/hadouken:agentes`, para saber o que roda.
7. Como dev, quero que o override valha mesmo com a guarda desligada, para usar a paleta sem a guarda.
8. Como dev, quero que um despacho para agente desligado seja negado com o substituto nomeado, para o Claude corrigir sozinho.
9. Como dev que usava `hadouken:executor` ou `hadouken:revisor-critico`, quero um aviso com o nome novo, para migrar sem caçar no README.
10. Como dev, quero que só eu, digitando o comando, mude a paleta, para o Claude não trocar modelo por conta própria.
11. Como dev, quero que o texto de roteamento do SessionStart mostre a paleta efetiva, para o Claude escolher com base no que está configurado.
12. Como dev, quero que um erro no hook de despacho nunca bloqueie o despacho, para um bug do plugin não parar meu trabalho.

Janela de trabalho

13. Como dev, quero declarar minha janela com `/hadouken:janela seg-sex 9-21`, para o ritmo refletir quando eu trabalho.
14. Como dev, quero que o "% esperado" do limite semanal conte só minutos úteis, para não parecer adiantado na sexta à noite nem atrasado na segunda cedo.
15. Como dev, quero que "esgota" e "chega a 100%" projetem só sobre minutos úteis, para a previsão cair num horário em que estarei trabalhando.
16. Como dev, quero `/hadouken:janela off`, para voltar ao cálculo de 168 horas.
17. Como dev, quero ver a janela atual com `/hadouken:janela`, para conferir o que está valendo.
18. Como dev sem janela configurada, quero exatamente o comportamento de hoje, para a atualização não mudar meus números.
19. Como dev que digitou uma janela inválida, quero um aviso claro e o cálculo de 168 horas, para não ficar com número errado em silêncio.
20. Como dev, quero que o limite de 5 horas continue igual, porque ele é janela móvel e não depende do meu expediente.

Dedup das dependências

21. Como dev que já tinha `mattpocock-skills` de outro marketplace, quero que o kit não instale outra cópia, para não ter skills em dobro.
22. Como dev numa máquina que já tem as duas cópias, quero que o instalador desligue a cópia que o kit instalou como dependência e me avise, para ficar com uma só sem perder a minha; se as duas foram instaladas por mim, quero só o aviso.
23. Como dev, quero que nada seja desinstalado, para poder voltar atrás religando a cópia.
24. Como dev, quero que o instalador me avise quando a minha cópia tem versão diferente da que o hadouken testou, para saber do risco. O aviso de versão sai só no instalador; o SessionStart não compara versão.
25. Como dev que instalou o kit só por `/plugin install`, quero um aviso no início da sessão com o comando exato quando uma dependência falta, para completar a instalação.
26. Como dev, quero um aviso no início da sessão quando as duas cópias seguem habilitadas, com o comando que resolve, porque a atualização automática não roda o instalador.
27. Como dev, quero que a regra valha para todas as dependências de terceiros do kit (mattpocock, poka-yoke, fullstack-dev-skills, ui-ux-pro-max, superpowers), para a dedup não depender de qual plugin eu já tinha.
28. Como mantenedor, quero que a cópia do kit continue com sha fixo e veto do robô, para quem a recebe ter a versão testada.

Régua de desenvolvimento

29. Como dev, quero montar minha régua (fases, skills de cada fase, alternativas com "quando", agente da fase), para o Claude seguir o meu processo.
30. Como dev, quero gatilhos transversais (skill + quando), para momentos que não pertencem a uma fase.
31. Como time, quero versionar a régua do repositório em `.claude/hadouken.json`, para todos seguirem o mesmo processo naquele repo.
32. Como dev, quero que a régua do repositório substitua a global por inteiro, para o resultado ser previsível.
33. Como dev sem régua, quero a régua padrão (o fluxo de hoje mais Auditoria e Mutação), para começar sem configurar.
34. Como dev, quero `/hadouken-kit:regua` para ver a régua ativa e de onde ela vem (repo, global ou padrão).
35. Como dev, quero `/hadouken-kit:regua editar`, para o Claude montar a régua comigo fase a fase, oferecendo as skills instaladas.
36. Como dev, quero aplicar o rascunho só quando eu digitar `/hadouken-kit:regua aplicar` (ou `aplicar --projeto`), para o Claude não mudar meu processo sozinho.
37. Como dev, quero `/hadouken-kit:regua padrao` (ou `padrao --projeto`), para voltar à padrão.
38. Como dev, quero aviso de uma linha quando a régua cita skill ou agente que não existe, para corrigir sem perder o resto.
39. Como dev, quero que skills só-do-usuário (`disable-model-invocation`) apareçam com `/`, para o Claude sugerir em vez de tentar acionar.
40. Como dev, quero que a régua só oriente e nunca bloqueie, para poder pular fase quando fizer sentido.
41. Como dev, quero que o texto injetado da régua tenha tamanho limitado, para não pagar contexto a cada sessão.

Auditoria e mutação

42. Como dev, quero uma fase de Auditoria com o agente `hadouken:auditor` quando a mudança toca produção, dinheiro, autenticação, dado real, algo irreversível ou contrato público, para achar quebra antes do merge.
43. Como dev, quero a auditoria na saída da spec e no diff final, com segunda rodada só se a spec mudou materialmente.
44. Como dev, quero teste de mutação no fim da frente, só nas linhas alteradas, para provar que os testes novos pegam erro.
45. Como dev, quero que cada mutante sobrevivente em linha alterada seja morto com teste ou justificado no PR, sem nota percentual fixa.
46. Como dev de qualquer stack, quero que a skill de mutação indique a ferramenta da minha stack, para não depender de JS.

Roteamento

47. Como dev, quero que o Claude faça direto o que cabe em até 3 chamadas de ferramenta e ~50 linhas de saída, e delegue o resto, para manter o contexto principal pequeno.
48. Como dev, quero a escolha de modelo por critério explícito (acerto quando o erro custa caro; senão o mais barato que acerta de primeira; empate → o mais rápido), para equilibrar token, velocidade e acerto.
49. Como dev, quero que a faixa de consumo mova o padrão um degrau (econômico desce, folga sobe), sem rebaixar tarefa de erro caro, para gastar o limite sem estourar.
50. Como dev, quero uma linha por despacho (`tipo → modelo·effort — motivo`), para auditar a escolha.
51. Como dev, quero brief e relatório de subagente padronizados, para não perder contexto nas duas pontas.
52. Como dev, quero que minhas instruções (CLAUDE.md) prevaleçam sobre a tabela da skill, para adaptar ao meu ambiente.

## 4. Decisões de implementação

### Fatia 1 — Dedup das dependências do kit

- `hadouken-kit` declara só `hadouken` em `dependencies`. As cinco dependências de terceiros (`superpowers`, `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills`, `ui-ux-pro-max`) saem do manifesto, porque dependência desabilitada derruba o kit. As entradas de terceiros do marketplace do hadouken ficam, com sha fixo e veto do robô.
- `DEPENDENCIAS_KIT` continua sendo a lista do que o instalador garante.
- `COPIAS_ANTIGAS` sai: `ligarAtualizacao` só liga a atualização automática do marketplace e não desliga plugin nenhum. Quem teve a cópia upstream desligada por versões anteriores fica como está (caso D1: cópia do usuário desabilitada não conta como equivalente).
- **Equivalência.** Uma dependência `D` (id `nome@marketplace`) está satisfeita por outra cópia quando existe plugin **habilitado** no escopo do usuário, de marketplace diferente do de `D`, com **mesmo nome** de plugin **ou mesma origem** (mesmo repo **e** mesma subpasta dentro dele). Habilitado: no instalador, `enabled: true` e `scope: "user"` em `claude plugin list --json`; no SessionStart do kit, `installed_plugins.json` com entrada `scope: "user"` e `enabledPlugins[id] === true` no `settings.json` do usuário (ausente conta como desligado). Origem, normalizada para `dono/repo[/subpasta]` em minúsculas, sem `./` e sem `/` no fim:
  - `source` relativo `./<sub>` → o repo do marketplace em `known_marketplaces.json` mais `<sub>`; `"./"` → só o repo;
  - `{source: "github", repo}` → `repo`;
  - `{source: "url", url}` de `github.com` → `dono/repo` sem `.git`;
  - `{source: "git-subdir", url, path}` → `dono/repo/<path>`; `git-subdir` sem `path` → sem origem;
  - a `url` de `github.com` vale em `https://github.com/dono/repo`, `https://www.github.com/dono/repo` e SSH `git@github.com:dono/repo`, com ou sem `.git`;
  - `source` relativo sem `./` (`plugins/x`) vale o mesmo que `./plugins/x`;
  - qualquer outro → sem origem (só o nome vale).
  - Leitura do registro em formato inesperado (`plugins[id]` que não é lista, ou registro sem o `hadouken-kit` no escopo do usuário) → trata como leitura falha.
- **Módulo de dedup** (novo, em `src/instalar/`): função pura `avaliarDependencias({deps, plugins, repos, testado}) → [{id, estado: 'propria'|'equivalente'|'duplicada'|'ausente', equivalente?, instalada, versaoEquivalente?, versaoTestada?, auto, dependentes}]`, alimentada pelos registros lidos do disco. `plugins[id]` leva `auto` (do registro) e `dependencias` (os ids que o `plugin.json` do plugin ligado declara em `dependencies`). `auto` é o `auto === true` da cópia do kit; `dependentes` são os plugins ligados, no escopo do usuário, que dependem da cópia do kit. Usada pelo instalador e pelo SessionStart do kit (cópia autocontida em `kit/`, ver abaixo). `deps` = as cinco dependências de terceiros de `DEPENDENCIAS_KIT` (o `hadouken` fica fora).
- **Dependentes.** `dependencies` do `plugin.json` aceita `"nome"` (resolve no marketplace do próprio plugin), `"nome@marketplace"` e `{name, marketplace?, version?}` (doc oficial, plugins-reference e plugins/dependencies). A leitura é `<installPath>/.claude-plugin/plugin.json` de cada plugin ligado no escopo do usuário; manifesto ausente, ilegível ou de forma errada conta como sem dependências. O `claude plugin disable` falha quando outro plugin habilitado depende do alvo (doc oficial, plugins/cli-reference), então a cópia do kit com dependente ligado nunca é alvo de `disable`.
- **Instalador** (`passoKit`): para cada `D`, `equivalente` → não instala; `duplicada` (cópia do kit e equivalente habilitadas) com a cópia do kit `auto: true`, sem dependente ligado e o kit ≥ 1.2.0 → `claude plugin disable <D> --scope user` (escopo explícito do usuário; doc oficial: `-s, --scope <scope>`, `user`, `project` ou `local`), conferido pela lista, e avisa "`<D>` já instalado via `<equivalente>`; cópia do kit desligada"; `ausente` e não instalada → `claude plugin install <D>` (o `plugin install` do kit deixa de trazer dependências); `ausente` e instalada desligada → não religa (foi o usuário quem desligou) e avisa com `claude plugin enable <D>`. Abaixo de 1.2.0, avisa e não mexe. `duplicada` sem `auto` (o usuário instalou as duas) → não desliga: avisa que as duas fazem o mesmo e mostra `claude plugin disable <D> --scope user` para ele rodar se quiser. `duplicada` com dependente ligado → não desliga: a linha informativa nomeia o dependente. Nunca desinstala.
- **Aviso de versão**: só no instalador. Versão da cópia equivalente ≠ versão de `D` em `kit/testado.json` → o aviso diz as duas versões. O SessionStart não lê `testado.json` e não compara versão.
- **SessionStart do kit**: avalia as dependências a cada sessão e mostra ao usuário (`systemMessage`) uma linha por problema: `duplicada` com a cópia do kit `auto: true` → `claude plugin disable <D> --scope user`; `duplicada` sem `auto` → as duas fazem o mesmo, com o mesmo comando para o usuário desligar uma se quiser; `duplicada` com dependente ligado → sem linha (o comando falharia); `ausente` não instalada → `claude plugin install <D>`; `ausente` instalada desligada → `claude plugin enable <D>`. Todo comando é dito para o terminal ("no terminal: claude plugin …"), porque com a guarda ligada o Claude não roda `claude` na sessão. Não escreve em `settings.json`. Leitura falhou → silêncio (sem aviso falso).
- O kit é autocontido: a avaliação usada no SessionStart mora em `kit/` (o cache do kit não tem `src/`). Um teste de paridade garante que as duas cópias da função dão o mesmo resultado para as mesmas fixtures.

### Fatia 2 — Janela de trabalho

- Chave `janela` em `~/.claude/hadouken/config.json`: `{"dias": ["seg","ter","qua","qui","sex"], "inicio": "09:00", "fim": "21:00"}`. Dias ∈ `dom seg ter qua qui sex sab` (aceita `sáb`); `inicio < fim` no mesmo dia; granularidade de minuto; hora local da máquina.
- Sem a chave → cálculo de 168 horas idêntico ao de hoje. Valor inválido (dias vazio, dia desconhecido, `inicio >= fim`, formato) → aviso "janela inválida; usando 168 h" e cálculo de 168 horas.
- **Minutos úteis** `U(t1, t2)`: minutos de `[t1, t2]` dentro da janela, dia a dia em hora local (DST incluído).
- **% esperado** do limite de 7 dias = `U(início_7d, agora) ÷ U(início_7d, reset) × 100`, com `início_7d = reset − 168 h`.
- **Projeções** ("esgota", "chega a 100%", instante em `previsao.js`): a taxa é consumo por minuto útil; o tempo restante avança só em minutos úteis e é convertido para relógio pela janela; fora da janela o consumo projetado é zero. A projeção de 7 dias exige 2 h úteis na amostra e a frase "esgota" exige 2 h úteis decorridas (J7, J8). Se o instante projetado passa do reset, a frase diz que não esgota antes do reset.
- Limite de 5 horas: sem mudança.
- **Comando** `/hadouken:janela` (skill + `UserPromptExpansion`, padrão do `liberar`): sem argumento mostra a janela; `seg-sex 9-21`, `seg,qua,sex 08:30-18:00` grava; `off` remove a chave. Gravação atômica por `gravarJsonAtomico`, preservando as outras chaves.

### Fatia 3 — Paleta fundida

Dez agentes em `agents/`, conteúdo genérico (sem prefixo de teste, e-mail, empresa ou portão de um ambiente específico):

| Agente | model·effort | Ferramentas | Use para | Não use para | Substituto se inativo |
|---|---|---|---|---|---|
| busca | haiku·low | Read, Grep, Glob | achar arquivo e símbolo, ler e resumir trecho | decidir, revisar, editar | varredor |
| varredor | haiku·medium | todas menos escrita | varredura do repo, inventário, número de fonte primária (query só leitura, API) | editar, decidir | busca |
| pesquisa | sonnet·low | WebSearch, WebFetch, Read | doc, API, versão na web com URL | opinião, arquitetura | (faça direto) |
| mecanico | haiku·low | Read, Edit, Write, Grep, Glob | edição com instrução exata | escolher abordagem | implementador-mecanico |
| implementador-mecanico | sonnet·medium | todas | fatia mecânica provada por teste | julgamento de negócio ou arquitetura | implementador |
| implementador | sonnet·high | todas | fatia com spec e plano fechados, teste primeiro | arquitetura | implementador-mecanico |
| revisor | sonnet·high | Read, Grep, Glob, Bash | review de fatia contra spec, plano e convenções; devolve defeito com `arquivo:linha` | estilo | auditor |
| auditor | fable·high | todas menos escrita | auditoria adversarial (critério da fatia 7) contra código vivo | estilo, review comum | revisor |
| e2e | sonnet·high | todas | e2e onde o usuário vê e operação; artefatos com o prefixo de teste do projeto, limpos ao final | implementar | implementador |
| redator | sonnet·medium | Read, Grep, Glob | texto para terceiros, devolvido sem publicar | decidir | (faça direto) |

- Saem `executor` (→ `implementador`) e `revisor-critico` (→ `auditor`). `revisor` desce de opus para sonnet.
- N1 e N2 incluem `hadouken:varredor` nas listas de agente barato; referências a `executor` e `revisor-critico` saem. N1/N2 avaliam os parâmetros **explícitos** do despacho, não os injetados pela config (a escolha do usuário na config não é negada).
- Despacho para `hadouken:executor` ou `hadouken:revisor-critico` → negado com "saiu na 0.6.0; use `hadouken:<novo>`".
- `LINHAS_REGRA` vira texto gerado da paleta efetiva (padrão + config) no SessionStart.

### Fatia 4 — Paleta configurável

- Chave `agentes` em `config.json`: `{"<nome>": {"model": "haiku|sonnet|opus|fable", "effort": "low|medium|high|xhigh|max", "ativo": true|false}}`. `<nome>` é o agente do plugin sem prefixo e vale para despachos `hadouken:<nome>`. Nome desconhecido, valor fora do enum ou tipo errado → campo ignorado + aviso no SessionStart.
- **Hook de despacho** (o mesmo PreToolUse de `src/hooks/guarda-despacho.js`, para haver um só `updatedInput` por chamada): a aplicação da paleta roda **antes** do `return` da guarda desligada; só para `Agent`/`Task` (não `Workflow`).
  1. `ativo: false` → `deny` com o substituto da tabela (se o substituto também estiver inativo, "faça direto").
  2. `model` ausente no `tool_input` e presente na config → injeta; idem `effort`. Campo explícito no despacho nunca é sobrescrito.
  3. `subagent_type: "fork"` → não injeta (o fork ignora model/effort).
  4. Saída: `updatedInput` com o `tool_input` original inteiro mais os campos injetados.
  5. Com guarda ligada, as regras de hoje (travas, G5, N1/N2) rodam depois e um `deny` delas prevalece.
  6. Exceção no código da paleta → passa adiante sem injetar nem negar, e registra o erro.
- A config é lida a cada despacho (mudança vale na hora); o texto do SessionStart reflete a config do início da sessão.
- **Comando** `/hadouken:agentes` (skill + `UserPromptExpansion`): sem argumento mostra a tabela (agente, padrão, override, ativo); `<nome> <model> [effort]`, `<nome> off`, `<nome> on`, `<nome> padrao` gravam. Só o usuário grava.

### Fatia 5 — Skill roteamento

Reescrita de `skills/roteamento/SKILL.md`, prescritiva:

- **Prevalência**: instrução do usuário (CLAUDE.md do usuário ou do projeto) prevalece sobre esta skill.
- **Faça direto** quando a tarefa cabe em até 3 chamadas de ferramenta e ~50 linhas de saída somadas; acima disso, agente.
- **Paleta**: aponta `/hadouken:agentes` para a efetiva; frontmatter/config é o padrão; o principal sobe ou desce com motivo de uma linha.
- **Critério, em ordem**: (1) acerto domina quando o erro custa caro (produção, dinheiro, autenticação, dado real, irreversível); (2) senão, o modelo mais barato que acerta de primeira (retrabalho conta no custo); (3) empate → o mais rápido. Escada Haiku → Sonnet → Opus → Fable; falha ou certeza baixa → sobe um degrau uma vez, nunca em laço.
- **Effort** por despacho pela mesma regra, via parâmetro `effort` do Agent; `max` só com ok do usuário.
- **Faixa de consumo** (ritmo da janela da fatia 2): econômico (adiantado > 10 pontos) → padrão desce um degrau, exceto critério 1; folga (atrasado > 10 pontos) → padrão sobe um degrau.
- **Linha por despacho**: `tipo → modelo·effort — motivo` (motivo só quando difere da paleta).
- **Brief**: Tarefa / Objetivo / Arquivos / Não mexer / Pronto quando / Relatório.
- **Relatório do subagente**: até 40 linhas, Feito / Evidência (comando literal + saída cortada + `arquivo:linha`) / Não feito / Certeza; sem despejo de arquivo. Antes de dizer "pronto", o principal re-roda uma checagem final de aceite.

### Fatia 6 — Versão, README, notas de quebra

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (hadouken 0.6.0, kit 1.2.0), `kit/.claude-plugin/plugin.json`, `kit/testado.json` (hadouken 0.6.0).
- README: paleta e `/hadouken:agentes`, janela e `/hadouken:janela`, dedup, régua e `/hadouken-kit:regua`, auditoria e mutação.
- Notas de quebra: agentes renomeados ou removidos; `revisor` em sonnet; kit sem dependências de terceiros no manifesto; o hook de despacho atua com a guarda desligada.

### Fatia 7 — Régua de desenvolvimento

- **Formato** (chave `regua`):
  ```json
  {"fases": [
     {"fase": "Ideia", "usar": ["superpowers:brainstorming"],
      "alternativas": [{"skill": "mattpocock-skills:grill-with-docs", "quando": "projeto tem glossário/ADRs"}]},
     {"fase": "Auditoria da spec", "agente": "hadouken:auditor"}],
   "transversais": [{"skill": "mattpocock-skills:diagnosing-bugs", "quando": "lentidão ou regressão"}]}
  ```
  Fase: `fase` (obrigatório), `usar` (lista), `alternativas` (lista de `{skill, quando}`), `agente` (opcional, um). Fase sem `usar` nem `agente` é inválida.
- **Origem e precedência**: `<cwd da sessão>/.claude/hadouken.json` chave `regua` → senão `~/.claude/hadouken/regua.json` → senão a padrão. A de maior precedência substitui a outra por inteiro. Arquivo ilegível ou inválido → aviso e cai para o nível seguinte. A global fica em arquivo próprio, porque quem grava é o kit e `config.json` é do hadouken (evita dois plugins gravando o mesmo arquivo).
- **Régua padrão** (em `kit/`): fases da tabela Processo de hoje mais Auditoria e Mutação, na ordem Ideia → Protótipo → Registrar a forma → Auditoria da spec → Quebrar o trabalho → Executar → Teste e bug → Revisar → Mutação → Auditoria do diff; transversais = momentos do Matt Pocock, Melhorar o sistema e Especialidades. Os textos e nomes de hoje se preservam (os testes de `test/kit-fluxo.test.js` seguem válidos).
- **Auditoria** (fases "Auditoria da spec" e "Auditoria do diff"): roda quando a mudança cai no critério 1 da escolha de modelo ou muda contrato público (API, schema, config do usuário, hook, formato de arquivo); fora: doc, rename, fatia mecânica; segunda rodada só se a spec mudou materialmente.
- **Mutação**: skill nova `hadouken-kit:mutacao`. Fim da frente, antes do PR; só linhas alteradas no branch; cada sobrevivente em linha alterada é morto com teste ou justificado no PR; sem nota percentual fixa. Ferramenta por stack: JS/TS → StrykerJS via `npx` (sem virar dependência do projeto), Python → mutmut, .NET → Stryker.NET, JVM → PIT; outras → a skill diz que não há ferramenta conhecida e pede a escolha.
- **Validação**: nomes de skill conferidos contra as skills instaladas e habilitadas (plugins habilitados no cache, `~/.claude/skills`, `.claude/skills` do projeto), lendo `name` e `disable-model-invocation` do frontmatter; agente conferido contra agentes de plugin e de `~/.claude/agents`. Desconhecido → aviso de uma linha; o resto vale.
- **Injeção** (SessionStart do kit): "Régua (<repo|global|padrão>): Fase → skills; …; Transversais: …"; skills só-do-usuário com `/`; campos `quando` sem quebra de linha e com até 120 caracteres; texto total até 2 000 caracteres, com "… (régua completa: /hadouken-kit:regua)" quando corta. A régua só orienta.
- **Skill `fluxo`**: aponta para a régua ativa no texto do SessionStart e mantém a tabela da padrão como referência.
- **Comando** `/hadouken-kit:regua` (skill + `UserPromptExpansion` no `kit/hooks/hooks.json`):
  - sem argumento → régua ativa e origem;
  - `editar` → o Claude monta com o usuário, fase a fase, oferecendo as skills instaladas, mostra o JSON e grava o rascunho em `<tmp do SO>/hadouken/regua-rascunho.json`; nada vale até o `aplicar`;
  - `aplicar` / `aplicar --projeto` → o hook valida o rascunho, grava atomicamente (`~/.claude/hadouken/regua.json` ou a chave `regua` de `<cwd>/.claude/hadouken.json`, preservando outras chaves), apaga o rascunho e responde com o resumo e os avisos;
  - `padrao` / `padrao --projeto` → remove a régua do nível.

## 5. Casos de borda

| # | Caso | Tratamento |
|---|---|---|
| D1 | Cópia do usuário instalada mas **desabilitada** | Não conta como equivalente; o kit instala a dele e avisa que a do usuário está desligada |
| D2 | Duas cópias habilitadas e kit instalado < 1.2.0 | Não desliga (derrubaria o kit); avisa para atualizar o kit |
| D3 | Mesmo nome, repo diferente (homônimo) | Conta como equivalente (namespace de skill colide de qualquer forma); o aviso diz qual cópia ficou |
| D4 | Mesma origem (repo e subpasta), nome diferente | Conta como equivalente pela origem |
| D11 | Marketplace monorepo: plugins irmãos no mesmo repo, em subpastas diferentes | Não são equivalentes entre si |
| D12 | `installed_plugins.json` v1 (`plugins[id]` objeto), `plugins: {}` ou sem o `hadouken-kit` no escopo do usuário | Leitura tratada como falha: SessionStart em silêncio |
| D13 | `duplicada` e a cópia do kit sem `auto` (o usuário instalou as duas), ou `installed_plugins.json` sem `auto` legível no instalador | Nada é desligado. O instalador e o SessionStart avisam que as duas fazem o mesmo e mostram `claude plugin disable <D> --scope user` para o usuário rodar se quiser |
| D14 | Desligar a cópia do kit | Sempre `claude plugin disable <D> --scope user`, no instalador, no comando do conserto (D7) e nos avisos do SessionStart; nunca sem o escopo |
| D15 | `duplicada` com plugin ligado que depende da cópia do kit (`dependencies` do manifesto, nos três formatos) | A cópia do kit fica ligada. O instalador mostra linha informativa que nomeia o dependente; o SessionStart não mostra linha. Manifesto ausente ou ilegível = sem dependências |
| D16 | Formas de origem | Valem como origem: `url` de `github.com` em `https`, `https://www.` ou SSH `git@github.com:`, com ou sem `.git`; `source` relativo com ou sem `./`. `git-subdir` sem `path` não tem origem |
| D17 | `prune` | Com o kit 1.2.0 sem dependências de terceiros no manifesto, as dependências que o kit instalou com `auto: true` ficam órfãs, e `claude plugin prune` as remove. O SessionStart avisa `falta <D>` com `claude plugin install <D>`, e o instalador as instala de novo. Comportamento previsto |
| D5 | Plugin habilitado só no escopo de projeto | Fora da avaliação (só escopo do usuário); sem aviso |
| D6 | `installed_plugins.json` ausente ou ilegível | Nenhuma equivalência; instalação como hoje; SessionStart em silêncio |
| D7 | `claude plugin disable` falha ou a lista seguinte mostra a cópia do kit ainda ligada | Item ✗ com `rode claude plugin disable <D> --scope user`; nada mais muda. No SessionStart do kit, `settings.json` ilegível → silêncio |
| D8 | Usuário remove a própria cópia depois | SessionStart avisa `ausente` com o comando de instalar (ou de religar a cópia do kit, se instalada e desligada) |
| D9 | Mesma versão, commit diferente (1.3.2 × 1.3.2) | Sem aviso de versão (`testado.json` guarda versão, não commit) |
| D10 | `superpowers` de outro marketplace | Mesma regra das demais |
| J1 | Agora fora da janela | Esperado congela; projeção começa no próximo início de janela |
| J2 | Uso no fim de semana com janela seg–sex | Consumo conta, esperado não cresce → aparece adiantado (correto) |
| J3 | `U(início_7d, agora) = 0` (início da semana fora da janela) | Sem taxa → sem projeção; frase de ritmo mostra só o % usado |
| J4 | Dia de troca de horário (DST) | `U` calculado por dia em hora local |
| J5 | Janela que cruza meia-noite (`22:00-06:00`) | Inválida nesta versão (aviso + 168 h) |
| J6 | Reset dentro ou fora da janela | `U` usa os limites reais; sem caso especial |
| J7 | Poucos minutos úteis na amostra da projeção de 7 dias (ex.: histórico da noite e 30 s de janela aberta) | A projeção de 7 dias exige 2 h úteis na amostra (`REGRAS_JANELA.seven_day.coberturaMinMs`, em minutos úteis); abaixo disso, sem projeção e sem G2 |
| J8 | Poucos minutos úteis decorridos desde o início da semana (ex.: segunda 09:30) | A frase "esgota" com janela exige 120 min úteis decorridos (a mesma constante de J7); abaixo disso, sem frase. Sem janela, o mínimo continua 30 min corridos |
| J9 | Uso fora da janela (noite, fim de semana) | Conta como adiantamento no ritmo: `calcularRitmo` não muda e o esperado congela; 12 % às 09:30 de segunda é econômico |
| J10 | `/hadouken:janela` em prompt agendado (`CronCreate`, `ScheduleWakeup`, `RemoteTrigger`, scheduler MCP) | O comando só vale digitado: o hook da agenda nega todo texto que contenha `hadouken:janela` ou `/janela` (como palavra) e o texto do deny pede para tirá-lo do prompt. A palavra solta "janela" ("janela de 5 h") não é vigiada |
| J11 | Container ou sessão SSH em outro fuso que o do usuário | A janela usa o fuso do sistema (hora local do processo); outro fuso desloca a janela |
| J12 | Fim da janela às `24:00` | Inválido (aviso + 168 h): o fim máximo é `23:59` |
| A1 | Despacho com `model` explícito e config com outro | Explícito vence |
| A2 | `ativo:false` com `model` explícito | Nega (agente inativo) com substituto |
| A3 | Config dá `opus` a `busca` com guarda ligada | N2 avalia só o explícito; não nega |
| A4 | Outro plugin também devolve `updatedInput` no Agent | Comportamento não documentado; e2e registra o que acontece; README avisa |
| A5 | `effort` em haiku | Injeta; Claude Code aceitou `low` em haiku no experimento |
| A6 | Agente local de mesmo nome em `~/.claude/agents` | Vence o do plugin no nome curto; a paleta vale para `hadouken:<nome>`; README orienta remover as cópias locais |
| A7 | Despacho `Workflow` | Paleta não se aplica |
| A8 | Erro de leitura da config | Passa adiante sem injetar; aviso no SessionStart |
| R1 | Régua do repo com JSON inválido | Aviso; cai para a global (ou padrão) |
| R2 | Régua com zero fases | Inválida → nível seguinte + aviso |
| R3 | Skill citada não instalada | Aviso de uma linha; fase segue com o resto |
| R4 | Régua longa | Corte em 2 000 caracteres com ponteiro para o comando |
| R5 | Texto de régua de repo de terceiro injetado no contexto | Mesmo nível de confiança do CLAUDE.md do projeto; campos com limite e sem quebra de linha; origem rotulada "régua do repo" |
| R6 | `aplicar` sem rascunho | Mensagem "sem rascunho; rode /hadouken-kit:regua editar" |
| R7 | `aplicar --projeto` fora de um repo git | Grava em `<cwd>/.claude/hadouken.json` e avisa que não há repo |
| R8 | Sessão aberta em subpasta do repo | Usa `<cwd>/.claude/hadouken.json`; se não existe, a global |

## 6. Decisões de teste

- **Bom teste** exercita a superfície pública do plugin e confere o efeito observável (stdout do hook, arquivo gravado, chamada ao CLI falso); não testa função privada.
- **Costuras** (as existentes; nenhuma nova):
  1. **Hooks** — JSON no stdin → JSON no stdout, HOME temporário com fixtures: SessionStart do hadouken (ritmo com janela, texto de paleta) e do kit (régua, avisos de dedup); PreToolUse do despacho (injeção, explícito vence, `ativo:false`, fork, Workflow, guarda desligada, N1/N2 com explícito); `UserPromptExpansion` de `janela`, `agentes`, `regua`. Prior art: `test/hooks.test.js:694` (`rodarEspiado`, stdin em `:706`), `test/kit-fluxo.test.js:77-86`.
  2. **Instalador** — `instalar-tudo` com CLI falso (`HADOUKEN_CLAUDE`) e HOME com `known_marketplaces.json` e `marketplace.json` de fixture: não instala com equivalente, `plugin disable <D> --scope user` no log do falso com duplicata e `auto: true` no `installed_plugins.json` de fixture (sem `auto` ou com dependente ligado: nenhum `disable`), `plugin install <D>` com ausente, nunca `uninstall`, aviso de versão, kit < 1.2.0. Prior art: `test/instalar-tudo.test.js:30,328`, `test/dados/instalador/claude-falso.mjs:74`.
  3. **Config** — gravação atômica preservando chaves, valor inválido. Prior art: `test/config-gravar.test.js:19-20`, `test/configuracao.test.js:42-45`.
- Paridade: a avaliação de dependências do kit e a do hadouken dão o mesmo resultado para o mesmo conjunto de fixtures.
- Regressão: a suíte inteira passa; mudam só os testes que afirmam agentes removidos, a lista de dependências do manifesto e o texto fixo de `LINHAS_REGRA`.
- **Mutação** no fim, antes do PR: StrykerJS via `npx`, runner de comando `node --test`, `mutate` = faixas de linha de `git diff -U0` do branch contra `main` em `src/` e `kit/`. Cada sobrevivente em linha alterada: teste novo ou justificativa no corpo do PR.

## 7. Fora do escopo

- Duplicatas que o hadouken não criou (skills em `~/.agents`, skills sincronizadas do claude.ai, plugins de outros marketplaces sem relação com o kit).
- Desinstalar qualquer plugin.
- Feriados e janelas diferentes por dia; janela que cruza meia-noite.
- Régua que bloqueia fase, portão de aprovação por fase, ordem obrigatória.
- Override de paleta por projeto (a paleta é global).
- Atualizar o CLAUDE.md pessoal do mantenedor e remover agentes locais (feito fora do repo, depois do merge).

## 8. Perguntas abertas (fato a medir no início da fatia indicada)

1. (Fatia 4) `updatedInput` com `permissionDecision: "allow"` contorna regra `deny`/`ask` do usuário para o Agent? E sem `permissionDecision`, a injeção vale nos modos padrão e auto? A fatia usa a variante que respeita as regras do usuário.
2. (Fatia 4) `updatedInput` vence o `model` do frontmatter de um agente de plugin? (A doc diz que o parâmetro por invocação vence o frontmatter; falta medir quando ele vem do hook.)
3. (e2e) Com `--plugin-dir` apontando para o branch e o mesmo plugin instalado do marketplace, quais hooks rodam?

## 9. e2e passo a passo

Artefatos com prefixo `ZZE2E`; cópia de `~/.claude/hadouken/config.json` antes e restauração no fim.

1. **Baseline**: `node --test` em `a73e458` → registrar total e falhas.
2. **Cada fatia**: `node --test` verde; diff resumido.
3. **Dedup (máquina real, com ok do mantenedor — muda `settings.json`)**: mostrar a tabela do que muda; `node src/instalar-tudo.js` do branch → `enabledPlugins["mattpocock-skills@claude-hadouken"] = false`, `mattpocock-skills@mattpocock` intacto, nenhum `uninstall` no log; nova sessão → nenhum aviso de duplicata; lista de skills com uma cópia de cada `mattpocock-skills:*`.
4. **Janela**: `/hadouken:janela seg-sex 9-21` → chave gravada; SessionStart mostra esperado igual ao cálculo manual de `U` para o instante; `/hadouken:janela off` → número igual ao da baseline.
5. **Agentes** (guarda desligada): `/hadouken:agentes revisor opus high`; despacho `hadouken:revisor` sem model → transcript do subagente `message.model` = opus, `meta.json` effort `high`; despacho com `model: sonnet` → sonnet; `/hadouken:agentes auditor off` → despacho negado com "use hadouken:revisor"; `fork` sem injeção; `padrao` restaura.
6. **Régua**: `/hadouken-kit:regua` → padrão; `editar` → rascunho; `aplicar` → nova sessão mostra "Régua (global)"; repo `ZZE2E-regua` com `.claude/hadouken.json` → "Régua (repo)"; skill inexistente → aviso; `padrao` restaura.
7. **Mutação**: relatório do StrykerJS nas linhas alteradas; sobreviventes tratados.
8. **Auditoria**: rodada do `auditor` no diff final.
9. **Resíduo zero**: apagar diretórios e transcripts `ZZE2E`, restaurar `config.json`, conferir por `ls`/`jq`.

# hadouken 0.6.0 — plano de implementação

> **Para agentes:** execução por subagente `implementador`, uma tarefa por vez (superpowers:subagent-driven-development). Passos com checkbox (`- [ ]`).

**Objetivo:** entregar a 0.6.0 do hadouken e a 1.2.0 do kit: dedup das dependências de terceiros, janela de trabalho no ritmo, paleta de dez agentes configurável por hook, skill de roteamento reescrita e régua de desenvolvimento configurável com auditoria e mutação.

**Arquitetura:** cada regra nova é um módulo puro (`src/instalar/dedup.js`, `src/janela.js`, `src/agentes/*.js`, `kit/hooks/regua.js`), exercitado pelas costuras que já existem: hook (JSON no stdin → JSON no stdout), instalador com CLI falso e gravação de config. Comandos do usuário seguem o padrão do `liberar` (`UserPromptExpansion` → `{decision:'block', reason}`). O kit continua autocontido: nada em `kit/` importa de `src/`.

**Stack:** Node ≥ 20, ESM, `node:test`, sem dependência nova. StrykerJS só via `npx` na tarefa final.

**Spec:** `docs/superpowers/specs/2026-11-09-v060-agentes-janela-dedup-design.md`. O implementador lê a seção da fatia dele e os casos de borda (§5) que ela cita.

## Restrições globais

- Baseline em `ac076b0`: `node --test` → 2029 testes, 1997 passam, 0 falham, 32 pulados. Toda tarefa termina com 0 falhas.
- Sem `dependencies`/`devDependencies` novas em `package.json`.
- Hook nunca lança e sempre sai com código 0 (`rodarHook`, `src/hooks/comum.js:116`). Erro interno → passa adiante sem negar.
- Config do usuário só é gravada por comando que ele digita (`UserPromptExpansion`), por `gravarJsonAtomico` (`src/estado.js:152`), preservando as outras chaves.
- Nunca `claude plugin uninstall`.
- Textos para o usuário em pt-BR. `README.md` e `README.en.md` andam juntos.
- Agentes em `agents/` sem nada de um ambiente específico: sem prefixo de teste fixo, e-mail, empresa ou portão.
- Commit por tarefa, `tipo(escopo): descrição` em pt-BR (padrão do `git log`), com o trailer `Co-Authored-By` da sessão. Push, PR e merge não são do subagente.

## Foco de revisão

Entradas que a spec implica e nenhum teste de tarefa cobria. Cada uma tem teste na tarefa dona:

1. **RF1** — plugin em `installed_plugins.json` sem chave em `enabledPlugins` → conta como desligado: não vira equivalente, nem dispara desligamento. Teste na Tarefa 2.
2. **RF2** — o mesmo id com duas entradas em `installed_plugins.json` (`scope: "project"` e `"user"`) → só a de usuário conta. Teste na Tarefa 2.
3. **RF3** — `config.json` com `guarda`, `janela` e `agentes` gravados por comandos diferentes, em sequência → nenhum comando apaga a chave do outro. Teste na Tarefa 7.
4. **RF4** — despacho `Agent` sem `subagent_type` (vai para o general-purpose) ou com nome de outro plugin → a paleta não injeta nem nega, e o perfil efetivo fica `desconhecido` (sem G5, G6 nem G7 por plugin alheio). Testes nas Tarefas 6a (sem deny) e 6b (sem injeção).
5. **RF5** — com janela de trabalho: uso já ≥ 100 %, ou taxa ≤ 0 (o uso caiu entre amostras) → projeção `null`, sem exceção. Teste na Tarefa 3.
6. **RF6** — a paleta (injeção e negação de agente removido) roda antes dos portões da guarda: guarda desligada, `session_id` inválido, sessão inativa e status `erro` não a impedem. Testes nas Tarefas 6a (negação) e 6b (injeção).
7. **RF7** — G5, G6 e G7 enxergam o perfil efetivo (parâmetro > config > frontmatter local ou de plugin): `hadouken:auditor` sem `model` é Fable; N1 e N2 continuam avaliando o `tool_input` original e aprovam o parâmetro explícito igual a `agentes.<nome>` ou a `roteamento.subir`. Testes nas Tarefas 6a, 6b e 7.
8. **RF8** — régua: nome fora da regex, texto longo, lista acima do limite e nome desconhecido nunca chegam crus ao `systemMessage`; a régua do repo avisa que vale no lugar da do usuário; a raiz do projeto é `CLAUDE_PROJECT_DIR` → `.git` → cwd. Testes nas Tarefas 10 e 11.
9. **RF9** — o teto de `test/kit-fluxo.test.js:87-88` muda para 2400 caracteres com a régua padrão; o kit 1.2.0 declara o `hadouken` com `version: ">=0.6.0"`. Testes nas Tarefas 9 e 10.

## Revisão por fatia

Ao fim de cada fatia (depois das Tarefas 2, 4, 5, 7, 8, 9 e 12), o agente `revisor` revisa o diff da fatia contra este plano e a spec. Defeito apontado → corrigido antes da próxima tarefa.

---

## Fatia 1 — Dedup

### Tarefa 1: avaliação de dependências e instalador

**Arquivos:**
- Criar: `src/instalar/dedup.js`, `test/dedup.test.js`
- Modificar: `src/instalar/claude-cli.js:106-119` (`passoKit`), `src/instalar/atualizacao-auto.js:22,32-63`, `src/instalar-tudo.js:108-129,316-323`, `test/dados/instalador/claude-falso.mjs` (o `install` do kit deixa de trazer as dependências em `:49`; `CATALOGO` do kit = `1.2.0`)
- Testes que mudam: os que citam `COPIAS_ANTIGAS`, `prontas`, `desligadas` ou `mantidas` (`grep -rln 'COPIAS_ANTIGAS\|mantidas' test`), `test/instalar-claude-cli.test.js`, `test/instalar-tudo.test.js`

**Interfaces produzidas:**
- `TERCEIROS_KIT`: `['superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken', 'poka-yoke@claude-hadouken', 'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken']`
- `repoDeOrigem(source, repoMarketplace) → string | null`, com as regras da spec §4 Fatia 1 ("Repo de origem")
- `lerRepos(pastaPlugins) → Map<id, string|null>`: lê `known_marketplaces.json` e o `marketplace.json` de cada `installLocation`. Nunca lança; com falha devolve `Map` vazio.
- `avaliarDependencias({deps, plugins, repos, testado}) → Avaliacao[]`
  - `plugins`: `Map<id, {version, enabled, scope}>`; `repos`: `Map<id, string|null>`; `testado`: `Record<id, string>`.
  - `Avaliacao = {id, nome, estado: 'propria'|'equivalente'|'duplicada'|'ausente', instalada: boolean, equivalente: string|null, versao: {equivalente: string, testada: string} | null}`.
  - O equivalente é o primeiro id em ordem alfabética que satisfaz a regra de equivalência.
- `passoKit(rodar, {repos = new Map(), lerTestado = () => ({})} = {}) → {item, entrada, lista, dedup: Avaliacao[]}`
- `ligarAtualizacao({arquivo, agoraMs}) → {ok, acao: 'gravado'|'ja-estava', backup} | {ok: false, motivo}`, sem `prontas`, `desligadas` nem `mantidas`.

- [x] **Passo 1 — testes puros que falham** (`test/dedup.test.js`). Fixture `p(version, enabled, scope='user')`:
  ```js
  test('duplicada por nome', () => {
    const r = avaliarDependencias({ deps: ['mattpocock-skills@claude-hadouken'], repos: new Map(), testado: {},
      plugins: new Map([['mattpocock-skills@claude-hadouken', p('1.3.2', true)], ['mattpocock-skills@mattpocock', p('1.3.2', true)]]) });
    assert.deepEqual(r[0], { id: 'mattpocock-skills@claude-hadouken', nome: 'mattpocock-skills', estado: 'duplicada', instalada: true, equivalente: 'mattpocock-skills@mattpocock', versao: null });
  });
  ```
  Demais casos, uma asserção de `estado`/`equivalente`/`versao` cada:
  - equivalente por repo, com outro nome (D4): `skills@x`, repo `mattpocock/skills` → `equivalente`;
  - homônimo de repo diferente (D3) → `equivalente`;
  - cópia do usuário desligada (D1) → `propria`; sem cópia do kit → `ausente`, `instalada: false`;
  - escopo `project` (D5) → ignorado;
  - cópia do kit instalada e desligada, sem equivalente → `ausente`, `instalada: true`;
  - versão 1.3.1 contra `testado` 1.3.2 → `versao: {equivalente: '1.3.1', testada: '1.3.2'}`;
  - mesma versão (D9) → `versao: null`.

  Para `repoDeOrigem`:
  - `'./'` com `'mattpocock/skills'` → `'mattpocock/skills'`;
  - `{source:'github', repo:'A/B'}` → `'a/b'`;
  - `{source:'url', url:'https://github.com/jeffallan/claude-skills.git'}` → `'jeffallan/claude-skills'`;
  - `{source:'git-subdir', url:'https://github.com/rainmanjam/poka-yoke.git', path:'plugins/poka-yoke'}` → `'rainmanjam/poka-yoke'`;
  - `{source:'url', url:'https://gitlab.com/x/y.git'}` → `null`.
- [x] **Passo 2** — `node --test test/dedup.test.js` → FAIL (módulo ausente).
- [x] **Passo 3** — implementar `src/instalar/dedup.js`.
- [x] **Passo 4 — testes do instalador que falham** (`test/instalar-tudo.test.js`, CLI falso). HOME com `plugins/known_marketplaces.json` (`mattpocock` → repo `mattpocock/skills`, `installLocation` na fixture) e `marketplaces/mattpocock/.claude-plugin/marketplace.json` (`source: "./"`):
  - **duplicada**: estado do falso com as duas cópias ligadas e kit `1.2.0` → o log do falso contém `plugin disable mattpocock-skills@claude-hadouken` e não contém `uninstall`; o resumo contém `mattpocock-skills já instalado via mattpocock-skills@mattpocock; cópia do kit desligada`.
  - **equivalente**: só `mattpocock-skills@mattpocock` ligado → nenhum `plugin install mattpocock-skills@claude-hadouken` no log.
  - **ausente**: `poka-yoke` nenhum → `plugin install poka-yoke@claude-hadouken` no log.
  - **versão**: equivalente `mattpocock-skills@mattpocock` 1.3.1 e `testado.json` do kit com 1.3.2 → o resumo contém `1.3.1` e `testada 1.3.2`.
  - **kit < 1.2.0 (D2)**: kit `1.1.2` com duplicata → sem `disable`; o resumo contém `atualize o hadouken-kit para desligar a cópia em dobro`.
  - **disable sem efeito (D7)**: `falhar: ['plugin disable mattpocock-skills@claude-hadouken']` → item ✗ com `rode claude plugin disable mattpocock-skills@claude-hadouken`.
  - **settings preservado**: `settings.json` com `"mattpocock-skills@mattpocock": true` → continua `true` depois da instalação, porque `ligarAtualizacao` não toca `enabledPlugins`.
- [x] **Passo 5** — `node --test test/instalar-tudo.test.js test/instalar-claude-cli.test.js` → FAIL.
- [x] **Passo 6** — implementar:
  - `passoKit` segue a ordem da spec §4 Fatia 1 ("Instalador"). O desligamento passa pelo mesmo `rodar(['plugin','disable',id])` do REA (`claude-cli.js:134`) e é conferido pela lista.
  - `instalar-tudo` passa `repos = lerRepos(path.join(pastaConfig(ambiente), 'plugins'))` e `lerTestado = (installPath) => <testado.json do kit>`.
  - `ligarAtualizacao` perde `COPIAS_ANTIGAS`, e `passoAtualizacao` perde `prontas`.
  - O texto do item de atualização fica `ligada` / `já estava`.
- [x] **Passo 7** — `node --test` → 0 falhas. Os testes antigos de `COPIAS_ANTIGAS` são removidos ou reescritos para afirmar que nada em `enabledPlugins` muda.
- [x] **Passo 8** — commit `feat(dedup): instalador não duplica dependência que o usuário já tem`.

### Tarefa 2: kit sem dependências de terceiros e aviso no SessionStart

**Arquivos:**
- Criar: `kit/hooks/dependencias.js`, `test/kit-dependencias.test.js`
- Modificar: `kit/.claude-plugin/plugin.json:12-22` → `"dependencies": ["hadouken"]`; `kit/hooks/fluxo.js:9-19`; `test/kit-manifestos.test.js`

**Interfaces:**
- Consome a semântica de `avaliarDependencias`, `repoDeOrigem` e `lerRepos` (Tarefa 1). As três ganham cópia em `kit/hooks/dependencias.js`, sem import de `src/`.
- Produz:
  - `lerRegistro(pastaConfig) → {plugins, repos} | null`. `plugins` vem de `installed_plugins.json` (só entradas `scope: "user"`) cruzado com `settings.json`; `enabled` só quando `enabledPlugins[id] === true`. Qualquer leitura falha → `null`.
  - `linhasAviso(avaliacao) → string[]`.
- `pastaConfig` = `CLAUDE_CONFIG_DIR` absoluto, senão `~/.claude`.

- [x] **Passo 1 — testes que falham:**
  - **paridade**: as fixtures da Tarefa 1 (mesmos `deps`, `plugins`, `repos`, `testado`) passam por `src/instalar/dedup.js` e por `kit/hooks/dependencias.js` → `deepStrictEqual`. Idem para `repoDeOrigem` e `lerRepos`, numa pasta de fixture. `TERCEIROS_KIT` igual nas duas cópias.
  - **hook**: `rodar(cwd, input)` de `test/kit-fluxo.test.js:72` com `CLAUDE_CONFIG_DIR` de fixture:
    - duplicada → `systemMessage` = `hadouken-kit: mattpocock-skills em dobro (mattpocock-skills@mattpocock e mattpocock-skills@claude-hadouken). Desligue a cópia do kit: claude plugin disable mattpocock-skills@claude-hadouken`;
    - ausente não instalada → `hadouken-kit: falta poka-yoke. Instale: claude plugin install poka-yoke@claude-hadouken`;
    - ausente instalada e desligada (D8) → `hadouken-kit: poka-yoke@claude-hadouken está desligado e não há outra cópia. Religue: claude plugin enable poka-yoke@claude-hadouken`;
    - tudo `propria` → sem `systemMessage`;
    - `installed_plugins.json` ausente (D6) ou `settings.json` inválido (D7) → sem `systemMessage`, `additionalContext` igual ao de hoje.
  - **RF1**: `mattpocock-skills@mattpocock` instalado sem chave em `enabledPlugins` e cópia do kit ligada → sem linha "em dobro".
  - **RF2**: `plugins["mattpocock-skills@mattpocock"] = [{scope:'project'}, {scope:'user'}]`, ligado → conta como usuário. Só `[{scope:'project'}]` → não conta.
  - **manifesto**: `kit/.claude-plugin/plugin.json` `dependencies` deepEqual `['hadouken']`.
- [x] **Passo 2** — `node --test test/kit-dependencias.test.js test/kit-manifestos.test.js` → FAIL.
- [x] **Passo 3** — implementar:
  - `fluxo.js` mantém o `additionalContext` de hoje e acrescenta `systemMessage` (linhas unidas por `\n`) só quando há aviso.
  - Exceção em qualquer ponto → só o `additionalContext`.
- [x] **Passo 4** — `node --test` → 0 falhas.
- [x] **Passo 5** — commit `feat(kit): kit sem dependências de terceiros no manifesto e aviso de cópia em dobro`.
- [x] **Passo 6** — `revisor` na fatia 1 (diff `ac076b0..HEAD` sem `docs/`).

## Fatia 2 — Janela de trabalho

### Tarefa 3: minutos úteis no ritmo e nas projeções

**Arquivos:**
- Criar: `src/janela.js`, `test/janela.test.js`, `test/janela-dst.test.js`
- Modificar:
  - `src/ritmo.js:17-25`, `src/uso/frase.js:70-93`, `src/previsao.js:156` (só `seven_day`);
  - chamadores que passam `trabalho`: `src/alerta.js:74`, `src/hooks/prompt-submit.js:95`, `src/guarda/avaliar.js:80`, `src/uso/painel.js:344`, `src/hooks/linha-estado.js:30`;
  - aviso de janela inválida: `src/hooks/session-start.js`.

**Interfaces produzidas:**
- `DIAS = ['dom','seg','ter','qua','qui','sex','sab']`
- `Janela = {dias: number[] (0=dom), inicioMin: number, fimMin: number}`
- `validarJanela(valor) → {janela: Janela|null, aviso: string|null}`. Aceita `sáb`. Inválido → `{janela: null, aviso: 'janela inválida; usando 168 h'}`. Ausente (`undefined`) → `{null, null}`.
- `lerJanela(dir) → {janela, aviso}`: chave `janela` de `<dir>/config.json`; leitura falhou → `{null, null}`.
- `minutosUteis(janela, t1Ms, t2Ms) → number`: dia a dia em hora local. Com `janela` null → `(t2Ms − t1Ms) / 60000`.
- `avancarUteis(janela, t0Ms, minutos) → number`: instante de relógio depois de avançar `minutos` úteis a partir de `t0Ms`. Com `janela` null → `t0Ms + minutos * 60000`.
- Parâmetro novo `trabalho = null` (Janela) nas funções abaixo. O nome evita colisão com `janelaMs`, que já existe:
  - `calcularRitmo({usado7d, resetsAt7d, agoraMs, trabalho})`
  - `fraseEsgota({usado, resetsAtMs, janelaMs, agoraMs, trabalho})`, aplicado só quando `janelaMs` = 7 dias
  - `preverEstouro({historico, limites, agoraMs, perfil, trabalho})`

- [x] **Passo 1 — testes que falham** (`test/janela.test.js`; datas por `new Date(2026, 10, d, h, m).getTime()`, `J = {dias:[1,2,3,4,5], inicioMin:540, fimMin:1260}`):
  - `validarJanela({dias:['seg','ter','qua','qui','sex'], inicio:'09:00', fim:'21:00'})` → `{janela: J, aviso: null}`.
  - Inválidas, cada uma → aviso `'janela inválida; usando 168 h'`:
    - `{dias:[], …}`;
    - `{dias:['xyz'], …}`;
    - `inicio:'22:00', fim:'06:00'` (J5);
    - `inicio:'9h'`.
  - `minutosUteis(J, sex 13 20:00, seg 16 10:00)` → `120`.
  - `avancarUteis(J, sex 13 20:30, 60)` → seg 16 09:30.
  - `avancarUteis(J, sáb 14 12:00, 30)` → seg 16 09:30 (J1).
  - `calcularRitmo({usado7d: 30, resetsAt7d: dom 15 19:00, agoraMs: seg 9 21:00, trabalho: J}).esperado` → `20`. Sem `trabalho` → o valor de hoje (`26/168×100`).
  - J3: `agoraMs` = dom 8 23:00 → `esperado` `0` e `preverEstouro(...).seven_day` `null`.
  - Projeção com `trabalho: J` e `perfil: null`:
    - histórico com +1 % em 60 min dentro da janela, uso 95 % na sex 13 às 20:00, reset ter 17 19:00 → `seven_day` = seg 16 13:00;
    - o mesmo cenário com reset dom 15 19:00 → `null` (passa do reset).
  - **RF5**: uso 100 % → `null`. Histórico com uso caindo → `null`. Nenhum dos dois lança.
  - SessionStart (costura de hook) com `config.json` `janela: {dias: []}` → a saída contém `janela inválida; usando 168 h` (história 19).
- [x] **Passo 2** — `test/janela-dst.test.js`, com `process.env.TZ = 'America/New_York'` na 1ª linha: `minutosUteis({dias:[0], inicioMin:0, fimMin:720}, dom 1/11/2026 00:00, dom 1/11/2026 12:00)` → `780` (J4).
- [x] **Passo 3** — `node --test test/janela.test.js test/janela-dst.test.js` → FAIL.
- [x] **Passo 4** — implementar:
  - Taxa da projeção de 7 dias = Δuso ÷ `minutosUteis(trabalho, início da amostra, agora)`; instante = `avancarUteis(trabalho, agora, restante ÷ taxa)`.
  - Os textos de `alerta.js:212` e `guarda/mensagens.js:28` recebem o instante já ajustado e não mudam.
  - Cada chamador lê `lerJanela(dir)` uma vez.
  - SessionStart mostra o `aviso` quando não é `null`.
- [x] **Passo 5** — `node --test` → 0 falhas. Sem `janela` na config, nenhum teste existente muda (história 18).
- [x] **Passo 6** — commit `feat(janela): ritmo e projeções contam só minutos úteis`.

### Tarefa 4: comando `/hadouken:janela`

**Arquivos:**
- Criar: `skills/janela/SKILL.md` (frontmatter `name: janela`, `description` com a sintaxe, `disable-model-invocation: true`; corpo igual ao fallback de `skills/liberar/SKILL.md:6`), `src/hooks/janela.js`, `test/janela-comando.test.js`
- Modificar: `hooks/hooks.json` (`UserPromptExpansion`: matcher `hadouken:janela` → `src/hooks/janela.js`, timeout 10), `src/janela.js`

**Interfaces produzidas** (em `src/janela.js`):
- `lerArgsJanela(texto) → {acao:'mostrar'} | {acao:'remover'} | {acao:'gravar', valor:{dias:string[], inicio, fim}} | {acao:'erro', msg}`
  - Aceita `seg-sex 9-21`, `seg,qua,sex 08:30-18:00` e `off`.
  - Intervalo de dias `a-b` só com `a ≤ b` na ordem de `DIAS`.
  - A hora aceita `H`, `HH` ou `HH:MM`.
- `gravarJanela(dir, valor | null) → {ok, motivo?}`: lê com `lerJson`, troca só a chave `janela` e grava com `gravarJsonAtomico`.
- `descreverJanela(janela) → string`, ex.: `'seg–sex 09:00–21:00'`.

- [x] **Passo 1 — testes que falham** (costura de hook, `rodar` de `test/hooks.test.js:61`). stdin `{hook_event_name:'UserPromptExpansion', command_name:'hadouken:janela', command_args, session_id}`:
  - `'seg-sex 9-21'`:
    - stdout `decision: 'block'`, `reason` contém `seg–sex 09:00–21:00`;
    - `config.json` `janela` deepEqual `{dias:['seg','ter','qua','qui','sex'], inicio:'09:00', fim:'21:00'}`;
    - a chave `guarda` pré-existente fica intacta.
  - `'seg,qua,sex 08:30-18:00'` → `dias:['seg','qua','sex']`.
  - `''` com janela gravada → `reason` contém `seg–sex 09:00–21:00`. Sem janela → `reason` contém `sem janela: ritmo em 168 h`.
  - `'off'` → chave removida.
  - `'22-6'` e `'sex-seg 9-21'` → `reason` contém `janela inválida` e `config.json` byte a byte igual.
  - `hooks/hooks.json` tem o matcher `hadouken:janela`.
- [x] **Passo 2** — `node --test test/janela-comando.test.js` → FAIL.
- [x] **Passo 3** — implementar `src/hooks/janela.js` pelo molde de `src/hooks/liberar.js:52,128`. O diretório vem de `dirDados()`.
- [x] **Passo 4** — `node --test` → 0 falhas.
- [x] **Passo 5** — commit `feat(janela): comando /hadouken:janela`.
- [x] **Passo 6** — `revisor` na fatia 2.

## Fatia 3 — Paleta fundida

### Tarefa 5: dez agentes, N1/N2 e texto de roteamento gerado

**Arquivos:**
- Criar:
  - `agents/varredor.md`, `agents/implementador-mecanico.md`, `agents/implementador.md`, `agents/auditor.md`, `agents/e2e.md`, `agents/redator.md`;
  - `src/agentes/paleta.js`, `src/agentes/despacho.js`, `test/agentes-paleta.test.js`.
- Modificar:
  - `agents/busca.md`, `agents/mecanico.md`, `agents/pesquisa.md`, `agents/revisor.md` (→ `sonnet`/`high`);
  - `src/roteamento/regras.js:22,25` (listas de agente barato com `hadouken:varredor`) e `:30,32` (A1 e A2 pela lista `AGENTES_REVISAO`);
  - `src/guarda/mensagens.js:86,88` (`N2_CLAUDE` e `A1_CLAUDE` sem `executor` nem `revisor-critico`);
  - `src/aprendizado/arquivos.js:72,73` (`substituto: 'hadouken:implementador'`);
  - `src/roteamento/regra.js:4-10` (`LINHAS_REGRA` → `linhasRegra(efetiva)`);
  - `src/hooks/session-start.js:195-197`;
  - `src/hooks/guarda-despacho.js` (bloco da paleta antes do `return` de `:55`);
  - em `skills/roteamento/SKILL.md` (`:16,19,39,43,60`), só trocar `executor` → `implementador` e `revisor-critico` → `auditor` (a reescrita é a Tarefa 8).
- Testes que mudam: `grep -rlE "hadouken:(executor|revisor-critico)" test` (`test/roteamento-agentes.test.js`, `test/roteamento-regras.test.js`, `test/aprendizado-comando.test.js` e os que citam `A1_CLAUDE`/`N2_CLAUDE`).
- Apagar: `agents/executor.md`, `agents/revisor-critico.md`.

**Interfaces produzidas:**
- `PALETA`: lista congelada de `{nome, model, effort, ferramentas, substituto: string|null, uso, naoUsar}`, as dez linhas da tabela da spec §4 Fatia 3, na ordem dela. "(faça direto)" → `substituto: null`.
- `REMOVIDOS = {executor: 'implementador', 'revisor-critico': 'auditor'}`.
- `AGENTES_REVISAO = Object.freeze(['revisor', 'auditor'])`: a lista que A1 e A2 usam. `A1_CLAUDE` é montado dela: `hadouken (aviso): despacho em Fable ou effort max fora de hadouken:revisor e hadouken:auditor. Fable só vale para segurança, autenticação, dinheiro e arquitetura; no resto use hadouken:revisor ou hadouken:implementador.`
- `paletaEfetiva(agentes = {}) → [{nome, model, effort, ativo, override}]`. Nesta tarefa, sempre o padrão (`ativo: true`, `override: false`).
- `linhasRegra(efetiva) → string[]`: uma linha por agente ativo, com `hadouken:<nome>`, `model·effort` e o "use para".
- `avaliarPaleta({toolName, toolInput, agentes = {}}) → {acao:'passa'} | {acao:'negar', razao} | {acao:'injetar', updatedInput}`. Nesta tarefa:
  - nega `hadouken:executor` e `hadouken:revisor-critico` com `hadouken:<nome> saiu na 0.6.0; use hadouken:<novo>`;
  - no resto, `passa`.

- [ ] **Passo 1 — testes que falham** (`test/agentes-paleta.test.js`):
  - **frontmatter**: o conjunto de `agents/*.md` é igual ao de `PALETA.map(p => p.nome)`. O `name`, o `model` e o `effort` de cada arquivo batem com a `PALETA`.
  - **conteúdo genérico**: nenhum `agents/*.md` casa com `/ZZE2E|HOMOLOG|educbank|@[a-z0-9-]+\.(com|br)/i`.
  - **removidos**: hook com guarda ligada e com guarda desligada (`gravarGuardaLigada(dir, false)`); `tool_input.subagent_type: 'hadouken:executor'` → `permissionDecision: 'deny'`, razão contém `use hadouken:implementador`.
  - **N1/N2**: `hadouken:varredor` com `model: 'opus'` explícito e guarda ligada → `deny` pela regra N2 (a mesma de `busca`).
  - **SessionStart**: o texto de roteamento contém `hadouken:varredor` e `hadouken:auditor`, e não contém `executor` nem `revisor-critico`.
  - **A2 (`regras.js:32`)**: guarda ligada, `hadouken:auditor` com `description: 'Procurar quebras na spec'` → saída sem o texto A2 (`A2_CLAUDE`). Vermelho: `avaliarRoteamento` devolve `{decisao:'avisar', regra:'A2'}` para esse perfil (`src/roteamento/regras.js:32` só isenta `hadouken:revisor*`). Controle: `hadouken:implementador` com `model: 'opus'` explícito e a mesma `description` → avisa A2.
  - **A1 (`regras.js:30`)**: `hadouken:revisor` com `model: 'fable'` explícito → sem aviso A1; `hadouken:implementador` com `model: 'fable'` explícito → avisa A1; `A1_CLAUDE` contém `hadouken:revisor` e `hadouken:auditor` e não contém `revisor-critico` nem `executor`.
  - **Textos sem os removidos**: `N2_CLAUDE` não contém `executor` e contém `hadouken:implementador`; o `substituto` de `hadouken:busca` e de `hadouken:mecanico` em `src/aprendizado/arquivos.js` é `hadouken:implementador`; varredura de `src/` e `skills/`: nenhum arquivo contém `hadouken:executor` nem `hadouken:revisor-critico`.
- [ ] **Passo 2** — `node --test test/agentes-paleta.test.js` → FAIL.
- [ ] **Passo 3** — implementar:
  - Cada agente novo recebe um corpo de até 40 linhas com o "use para", o "não use para" e a forma do relatório (Feito / Evidência / Não feito / Certeza, até 40 linhas), conforme a tabela da spec.
  - Referência de forma: os agentes de `~/.claude/agents/` da máquina do mantenedor. Leia só a estrutura; nada específico de ambiente entra no repo.
  - `regras.js:30` isenta `AGENTES_REVISAO` (no lugar de `revisor-critico`); `regras.js:32` isenta `hadouken:<nome>` de `AGENTES_REVISAO` (no lugar de `startsWith('hadouken:revisor')`); `regras.js` importa a lista de `src/agentes/paleta.js`.
- [ ] **Passo 4** — `node --test` → 0 falhas. Testes que afirmam os agentes removidos ou o texto fixo de `LINHAS_REGRA` passam a afirmar o novo.
- [ ] **Passo 5** — commit `feat(agentes)!: paleta de dez agentes; saem executor e revisor-critico`.
- [ ] **Passo 6** — `revisor` na fatia 3.

## Fatia 4 — Paleta configurável

### Tarefa 6a: config `agentes`, paleta antes dos portões e perfil efetivo

Sem injeção: nenhuma saída leva `updatedInput` (é a Tarefa 6b). Não depende do passo 0 da 6b.

**Arquivos:**
- Criar: `src/agentes/config.js`, `test/agentes-config.test.js`
- Modificar:
  - `src/agentes/paleta.js` (`paletaEfetiva` com override), `src/agentes/despacho.js` (negação de agente com `ativo: false`);
  - `src/guarda/despacho.js` (perfil efetivo: `perfilDoDespacho` com `raizPlugin` e o frontmatter do plugin; `DO_PLUGIN` aceita dígito, como em `hadouken:e2e`);
  - `src/roteamento/regras.js:22-25` (aprovação por `agentes.<nome>` e por `subir` em N1 e N2);
  - `src/hooks/guarda-despacho.js` (a paleta roda antes de `idValido`, de `sessaoAtiva`, do status `erro` e do `return` da guarda desligada).

**Interfaces:**
- Consome `PALETA`, `REMOVIDOS`, `AGENTES_REVISAO`, `paletaEfetiva` e `avaliarPaleta` (Tarefa 5).
- Produz:
  - `validarAgentes(valor) → {agentes: Record<nome, {model?, effort?, ativo?}>, avisos: string[]}`. Nome fora da `PALETA`, `model ∉ {haiku,sonnet,opus,fable}`, `effort ∉ {low,medium,high,xhigh,max}` ou `ativo` não booleano → campo descartado e aviso `agentes.<nome>.<campo> inválido; ignorado`.
  - `lerAgentes(dir) → {agentes, avisos}`. Leitura falhou (A8) → `{agentes: {}, avisos: ['não consegui ler agentes em config.json']}`.
  - `paletaEfetiva(agentes)` aplica o override (`override: true` quando a config muda `model` ou `effort`).
  - `avaliarPaleta`: remoção e `ativo: false` → `deny` (substituto da tabela; se também inativo, "faça direto"), na ordem da spec §4 Fatia 4.
  - `perfilDoDespacho({..., raizPlugin})`: `model` = parâmetro > frontmatter; `effort` = parâmetro > frontmatter > `CLAUDE_EFFORT`. O frontmatter vem de `<cwd>/.claude/agents`, de `<dirCfg>/agents` ou, para `hadouken:<nome>`, de `<raizPlugin>/agents/<nome>.md` (`DO_PLUGIN`, a busca de `perfilRoteamento`).
  - `avaliarRoteamento({..., agentes = {}})`: N1 e N2 não negam o parâmetro explícito aprovado: `config.subir[agente] === familia` ou `agentes[<nome sem prefixo>].model === familia` (e `effort` explícito igual a `agentes[<nome>].effort`).

- [x] **Passo 1 — testes que falham** (costura de hook, guarda desligada salvo quando indicado; `ti = {subagent_type:'hadouken:revisor', prompt:'x', description:'y'}`):
  - **config e paleta efetiva** (unidade): `validarAgentes` e `lerAgentes` conforme as Interfaces (campo e nome inválidos, chave hostil fora do aviso, config ilegível); `paletaEfetiva` com override, `ativo: false` e `override` só quando o valor difere do padrão.
  - **negação**:
    - `{auditor:{ativo:false}}` → `deny`, razão contém `hadouken:revisor`;
    - `{auditor:{ativo:false}, revisor:{ativo:false}}` → razão contém `faça direto`;
    - inativo com `model` explícito (A2) → `deny`.
  - **config** (guarda de regressão): `config.json` inválido → sem saída (passa).
  - **RF4**: sem `subagent_type`, ou com `outro-plugin:revisor` → sem `deny` da paleta.
  - **paleta antes dos portões (A10)**:
    - config `{guarda:{ligada:false}}` com `ti.subagent_type: 'hadouken:executor'` → `deny` com `use hadouken:implementador`;
    - a mesma config com `session_id` inválido (`'../x'`) → `deny`;
    - sessão não registrada em `ativas/` → `deny`;
    - `avaliarGuarda` com `status: 'erro'` (`src/guarda/avaliar.js:74,141`; molde `test/guarda-despacho-erro.test.js`) → `deny`;
    - `dirDados()` nulo → a remoção ainda nega.
  - **aprovação em N1/N2** (guarda ligada):
    - `{busca:{model:'opus'}}`, `ti` de `hadouken:busca` com `model:'opus'` explícito → passa (vermelho: N1 nega sem a implementação);
    - `{mecanico:{model:'opus'}}`, `ti` de `hadouken:mecanico` com `model:'opus'` → passa (vermelho: N2 nega sem a implementação);
    - `{busca:{model:'sonnet'}}` e `hadouken:busca` com `model:'sonnet'` → passa; com `model:'opus'` → nega N1 (os dois são guarda de regressão: passam sem a implementação);
    - `{busca:{effort:'xhigh'}}` e `hadouken:busca` com `effort:'xhigh'` explícito → passa; sem a config → nega N1;
    - `roteamento.subir = {'hadouken:busca':'opus'}` e `hadouken:busca` com `model:'opus'` → passa (vermelho: `regras.js:22` ignora `subir`); `hadouken:mecanico` com `subir` `opus` e `model:'opus'` → passa (já passa);
    - N2 negando um `model:'opus'` explícito, sem config → só `deny`, sem `updatedInput`.
  - **perfil efetivo (G5, G6, G7)**, guarda ligada:
    - `hadouken:auditor` sem `model`, config vazia, trava do Fable ativa (molde `test/guarda-hooks.test.js:1067`) → `deny` (G6 enxerga fable; vermelho: o perfil é `desconhecido`);
    - o quinto despacho de `hadouken:auditor` sem `model` em 5 h é negado (molde `test/guarda-hooks.test.js:207`, G7) e os quatro primeiros contam como Fable;
    - agente desconhecido (`outro-plugin:x`, `hadouken:inexistente`) → perfil `desconhecido` (sem G5/G6/G7), como `test/guarda-despacho.test.js:58-62`;
    - `perfilDoDespacho` direto: precedência parâmetro > frontmatter para `model` e para `effort`; `hadouken:auditor` → `{modelo:'fable', effort:'high', origem:'frontmatter'}`; `hadouken:e2e` → `{modelo:'outro', effort:'high', origem:'frontmatter'}`;
    - `perfilRoteamento` de `hadouken:e2e` acha o frontmatter do plugin (`DO_PLUGIN` com dígito).
- [x] **Passo 2** — `node --test test/agentes-config.test.js` → FAIL.
- [x] **Passo 3** — implementar:
  - O hook calcula a paleta logo depois de `dirDados()` e antes de `idValido`, `sessaoAtiva`, do status `erro` e do `return` da guarda desligada (`src/hooks/guarda-despacho.js`), dentro de `falharAberto` (erro → passa e registro pelo log do hook). Só despacho `Agent`/`Task` de `hadouken:*` carrega os módulos da paleta.
  - `lerAgentes(dir)` roda a cada despacho.
  - N1, N2 e A1–A3 recebem o `tool_input` original; N1 e N2 recebem também `agentes`. G5, G6 e G7 recebem o perfil efetivo (`perfilDoDespacho` com `raizPlugin: process.env.CLAUDE_PLUGIN_ROOT`).
- [x] **Passo 4** — `node --test` → 0 falhas.
- [x] **Passo 5** — commit `feat(agentes): guarda enxerga o perfil efetivo; paleta antes dos portões`.

### Tarefa 6b: injeção de model/effort no despacho

Depende da 6a.

**Passo 0 (medido em 10/11/2026, Claude Code 2.1.322):** saída e decisão na spec §0, bloco "Medido no passo 0". A saída com injeção leva só `updatedInput`, sem `permissionDecision` (variante A, decisão do Fernando); nenhuma saída do hook devolve `"allow"`. Haiku aceita `effort`: `lerArgsAgentes` e `validarAgentes` não mudam.

**Arquivos:**
- Modificar:
  - `src/agentes/despacho.js` (`avaliarPaleta` completo: injeção e fork);
  - `src/guarda/despacho.js` (`perfilDoDespacho` com a camada `agentes` da config);
  - `src/hooks/guarda-despacho.js` (as saídas de passar, de avisar e de perguntar levam `updatedInput`);
  - `test/agentes-config.test.js`.

**Interfaces:**
- Consome o que a Tarefa 6a produz.
- Produz:
  - `avaliarPaleta` completo, na ordem da spec §4 Fatia 4 (remoção, `ativo`, injeção, fork).
  - `perfilDoDespacho({..., agentes = {}, raizPlugin})` com a precedência da spec §4 Fatia 4: `model` = parâmetro > `agentes[<nome>].model` > frontmatter; `effort` = parâmetro > `agentes[<nome>].effort` > frontmatter > `CLAUDE_EFFORT`; `origem: 'config'` quando a config decide.

- [ ] **Passo 1 — testes que falham** (costura de hook, guarda desligada salvo quando indicado; `ti = {subagent_type:'hadouken:revisor', prompt:'x', description:'y'}`):
  - **injeção**:
    - config `{agentes:{revisor:{model:'opus', effort:'high'}}}` → `hookSpecificOutput.updatedInput` deepEqual `{...ti, model:'opus', effort:'high'}`;
    - `ti` com `model:'sonnet'` (A1) → `updatedInput.model === 'sonnet'` e `effort === 'high'`.
  - **fork, Workflow**:
    - `subagent_type:'fork'` → sem `updatedInput`;
    - `tool_name:'Workflow'` (A7) → sem saída.
  - **injeção antes dos portões (A10)**:
    - config `{guarda:{ligada:false}, agentes:{revisor:{model:'opus'}}}` → `updatedInput.model === 'opus'`;
    - `session_id` inválido (`'../x'`) → injeta;
    - sessão não registrada em `ativas/` → injeta;
    - `avaliarGuarda` com `status: 'erro'` (`src/guarda/avaliar.js:74,141`; molde `test/guarda-despacho-erro.test.js`) → injeta.
  - **A3** (guarda ligada):
    - `{busca:{model:'opus'}}`, `ti` de `hadouken:busca` sem `model` → injeta `opus` e não nega (N1 e N2 veem o `tool_input` original).
  - **perfil efetivo (G5)**, guarda ligada:
    - config `{revisor:{model:'fable', effort:'max'}}`, `hadouken:revisor` sem parâmetro → G5 enxerga fable·max (`deny` ou `ask` de G5, sem liberação `despacho-caro`);
    - `perfilDoDespacho` direto: precedência parâmetro > config > frontmatter para `model` e para `effort`; `origem: 'config'` quando a config decide.
  - **saída final**:
    - `guarda.perguntar` ligado e injeção pendente → `permissionDecision: 'ask'` com `updatedInput`;
    - `deny` da guarda (trava) com injeção pendente → só `deny`, sem `updatedInput`;
    - aviso A1–A3 com injeção pendente → `additionalContext` e `updatedInput` na mesma saída;
    - injeção sem aviso nem `ask` → `updatedInput` e nenhum `permissionDecision` na saída (variante A); nenhuma saída de `src/hooks/guarda-despacho.js` traz `permissionDecision: 'allow'`.
- [ ] **Passo 2** — `node --test test/agentes-config.test.js` → FAIL.
- [ ] **Passo 3** — implementar:
  - `avaliarPaleta` devolve `{acao: 'injetar', updatedInput}` quando falta `model` ou `effort` no despacho e a config os define (campo explícito nunca é sobrescrito; `fork` e `Workflow` não recebem). O hook guarda a injeção e a aplica na saída final.
  - `deny` da guarda prevalece; nos outros casos, a saída final leva `updatedInput`, sem `permissionDecision` (passo 0), mais o `additionalContext` que já existia; com `ask` da guarda, `permissionDecision: 'ask'` e `updatedInput` juntos.
- [ ] **Passo 4** — `node --test` → 0 falhas.
- [ ] **Passo 5** — commit `feat(agentes): paleta configurável aplicada no despacho`.

### Tarefa 7: comando `/hadouken:agentes` e paleta efetiva no SessionStart

**Arquivos:**
- Criar: `skills/agentes/SKILL.md` (mesmo molde da Tarefa 4), `src/hooks/agentes.js`, `test/agentes-comando.test.js`
- Modificar:
  - `hooks/hooks.json` (matcher `hadouken:agentes`);
  - `src/agentes/config.js`;
  - `src/hooks/session-start.js`: `linhasRegra(paletaEfetiva(lerAgentes(dir).agentes))` mais os avisos;
  - `src/hooks/guarda-agenda.js`, `src/guarda/caminho.js` (`pedeLiberacao`) e `src/guarda/mensagens.js` (`AGENDA_LIBERAR_TEXTO`): prompt agendado com `/hadouken:agentes` ou `/agentes` é negado; a palavra solta "agentes" passa (spec Fatia 4: só o usuário grava). Teste em `test/guarda-hooks.test.js`, no molde da janela.

**Interfaces produzidas:**
- `lerArgsAgentes(texto) → {acao:'mostrar'} | {acao:'gravar', nome, valor:{model?, effort?, ativo?}} | {acao:'remover', nome} | {acao:'erro', msg}`, para `revisor opus high`, `revisor opus`, `auditor off`, `auditor on` e `revisor padrao`.
- `gravarAgente(dir, nome, valor | null) → {ok, motivo?}`. Troca só `agentes.<nome>`. Com `null`, remove o nome, e remove `agentes` quando fica vazio.

- [ ] **Passo 1 — testes que falham:**
  - `'revisor opus high'` → `agentes.revisor` deepEqual `{model:'opus', effort:'high'}`.
  - `'auditor off'` → `{ativo:false}`; depois `'auditor on'` → a chave `ativo` sai.
  - `'revisor padrao'` → `revisor` sai.
  - `'xyz opus'` → `reason` contém `agente desconhecido: xyz` e a lista dos dez.
  - `'revisor gpt'` → `reason` contém `modelo inválido`.
  - `''` → `reason` tem cabeçalho, dez linhas de agente e a linha de sintaxe; a do revisor contém `sonnet·high → opus·high`.
  - **RF3**: em sequência, `/hadouken:janela seg-sex 9-21`, `/hadouken:agentes revisor opus` e `/hadouken:liberar off` → `config.json` tem `janela`, `agentes` e a chave da guarda.
  - **SessionStart**: com `{revisor:{model:'opus'}}` a linha do revisor contém `opus`; com `{auditor:{ativo:false}}` não há linha do auditor; com nome inválido aparece o aviso.
  - **Aprovação em N1/N2 pelo comando** (guarda ligada, hook de despacho depois do comando):
    - `/hadouken:agentes busca sonnet`, despacho `hadouken:busca` com `model:'sonnet'` → passa; com `model:'opus'` → nega N1 (os dois passam sem a implementação da tarefa: guarda de regressão da Tarefa 6a);
    - `/hadouken:agentes mecanico opus`, despacho `hadouken:mecanico` com `model:'opus'` → passa (a config gravada pelo comando é a aprovação);
    - `/hadouken:agentes mecanico padrao`, o mesmo despacho → nega N2.
- [ ] **Passo 2** — `node --test test/agentes-comando.test.js` → FAIL.
- [ ] **Passo 3** — implementar pelo molde da Tarefa 4.
- [ ] **Passo 4** — `node --test` → 0 falhas.
- [ ] **Passo 5** — commit `feat(agentes): comando /hadouken:agentes`.
- [ ] **Passo 6** — `revisor` na fatia 4.

## Fatia 5 — Skill roteamento

### Tarefa 8: reescrita de `skills/roteamento/SKILL.md`

**Arquivos:**
- Modificar: `skills/roteamento/SKILL.md` (reescrita prescritiva, conteúdo da spec §4 Fatia 5, até 90 linhas)
- Teste: os existentes que leem a skill (`grep -rln 'roteamento/SKILL' test`) e `test/roteamento-skill.test.js` (novo)

- [ ] **Passo 1 — teste que falha:**
  - O texto contém os dez `hadouken:<nome>`.
  - Contém, literalmente:
    - `3 chamadas de ferramenta`;
    - `~50 linhas`;
    - `Haiku → Sonnet → Opus → Fable`;
    - `tipo → modelo·effort — motivo`;
    - `Tarefa / Objetivo / Arquivos / Não mexer / Pronto quando / Relatório`;
    - `até 40 linhas`;
    - `/hadouken:agentes`.
  - Não contém `executor` nem `revisor-critico`.
  - Tem ≤ 90 linhas.
- [ ] **Passo 2** — `node --test test/roteamento-skill.test.js` → FAIL.
- [ ] **Passo 3** — reescrever a skill.
- [ ] **Passo 4** — `node --test` → 0 falhas.
- [ ] **Passo 5** — commit `docs(roteamento): critério de modelo, faça direto, brief e relatório`.
- [ ] **Passo 6** — `revisor` na fatia 5.

## Fatia 6 — Versão, README, notas de quebra

### Tarefa 9

**Arquivos:**
- Versões:
  - `package.json`, `.claude-plugin/plugin.json` e `kit/testado.json` (hadouken) → `0.6.0`;
  - `.claude-plugin/marketplace.json` → hadouken `0.6.0`, kit `1.2.0`;
  - `kit/.claude-plugin/plugin.json` → `1.2.0` e `dependencies` = `[{"name": "hadouken", "version": ">=0.6.0"}]` (spec §4 Fatia 1 e Fatia 6; doc: https://code.claude.com/docs/en/plugins/dependencies.md).
- `README.md` e `README.en.md`:
  - seções para a paleta e `/hadouken:agentes`, a janela e `/hadouken:janela` e o dedup;
  - aviso A4 (outro plugin com `updatedInput` no Agent) e A6 (agente local de mesmo nome vence; remova as cópias locais);
  - seção "Notas de quebra da 0.6.0", com a lista da spec §4 Fatia 6 e a linha "o `hadouken-kit` 1.2.0 exige o `hadouken` ≥ 0.6.0; com um `hadouken` menor o kit fica desabilitado".
- Testes de versão: `grep -rln '0\.5\.8\|1\.1\.2' test`.
- Teste do manifesto: `test/kit-manifestos.test.js:79-80` (`:79-80` afirmam `['hadouken']` e proíbem `version` na entrada).

- [ ] **Passo 1** — atualizar os testes de versão para `0.6.0`/`1.2.0` e o do manifesto → `node --test` → FAIL:
  - `kit: dependências = o objeto {name:'hadouken', version:'>=0.6.0'}`: `deepEqual(kit.dependencies, [{name: 'hadouken', version: '>=0.6.0'}])` (troca as linhas `:79-80`, que afirmavam `['hadouken']` e proibiam `version`);
  - `kit: a faixa do hadouken é satisfeita pela versão do plugin`: a versão de `.claude-plugin/plugin.json` é ≥ 0.6.0 (comparação numérica por partes, sem biblioteca) e o `name` da dependência é o `name` desse manifesto;
  - `kit: o REA não é dependência` (`:91-93`) segue afirmando que nenhuma entrada cita `rea`.
- [ ] **Passo 2** — trocar as versões e escrever os READMEs.
- [ ] **Passo 3** — `node --test` → 0 falhas; `grep -rn '0\.5\.8' --include=*.json .` → vazio.
- [ ] **Passo 4** — commit `chore(release): hadouken 0.6.0 e kit 1.2.0`.
- [ ] **Passo 5** — `revisor` na fatia 6.

O README da régua e da mutação fica na Tarefa 12, porque a fatia 7 vem depois desta pela ordem decidida (Q34).

## Fatia 7 — Régua de desenvolvimento

### Tarefa 10: régua padrão, leitura, validação e injeção

**Arquivos:**
- Criar: `kit/regua-padrao.json`, `kit/hooks/regua.js`, `test/kit-regua.test.js`
- Modificar: `kit/hooks/fluxo.js` (as linhas de processo e de momentos vêm de `textoRegua`), `kit/skills/fluxo/SKILL.md:14-58` (aponta para a régua ativa; mantém a tabela da padrão como referência), `test/kit-fluxo.test.js:87-88` (teto de caracteres)

**Interfaces produzidas** (em `kit/hooks/regua.js`):
- `dirHadouken(env) → string | null`: mesma regra de `dirDados()` (`src/base.js:108-113`), reescrita no kit.
- `raizProjeto({env, cwd}) → {raiz: string, comGit: boolean}`: `CLAUDE_PROJECT_DIR` (absoluto e existente) → senão o diretório mais próximo, do `cwd` para cima (até 64 níveis), que contém `.git` (diretório ou arquivo) → senão o `cwd` com `comGit: false`. Não executa `git`.
- Constantes: `LIMITE_FASE = 60`, `LIMITE_QUANDO = 120`, `LIMITE_NOME = 80`, `MAX_FASES = 20`, `MAX_LISTA = 12`, `MAX_TRANSVERSAIS = 40`, `LIMITE_TEXTO = 2000`, `NOME_REGUA = /^[A-Za-z0-9_:-]{1,80}$/`.
- `validarRegua(valor) → {regua: {fases, transversais} | null, avisos: string[], descartes: number}`. Formato da spec §4 Fatia 7, com o saneamento e os limites dela: nome fora de `NOME_REGUA` → item descartado; `fase` e `quando` saneados (controle e quebra de linha viram espaço, corte nos limites); excedente de lista descartado. Fase sem `fase` ou sem `usar` nem `agente` (depois dos descartes) sai e conta como descarte; zero fases válidas → `null` e aviso. `descartes` conta os itens descartados. O `regua.json` global é a própria régua (`{fases, transversais}`); no repo, a chave `regua` de `.claude/hadouken.json`.
- `carregarRegua({raiz, dirHadouken, padrao}) → {regua, origem: 'repo'|'global'|'padrão', avisos, descartes}`. Precedência: `<raiz>/.claude/hadouken.json` (chave `regua`) → `<dirHadouken>/regua.json` → `padrao`. Nível inválido → aviso e nível seguinte.
- `catalogo({pastaConfig, raiz}) → {skills: Map<nome, {soUsuario: boolean}>, agentes: Set<string>}`.
  - Skills de plugin habilitado (mesma leitura de `lerRegistro`): caminhos de `plugin.json` `skills` quando existem, senão `skills/*/SKILL.md`; nome `<plugin>:<name do frontmatter>`.
  - Também `~/.claude/skills/*` e `<raiz>/.claude/skills/*`.
  - Agentes: `agents/*.md` de plugin (`<plugin>:<name>`), `~/.claude/agents`, `<raiz>/.claude/agents`, mais `Explore`, `Plan` e `general-purpose`.
- `textoRegua({regua, origem, catalogo, validar}) → {texto, avisos, desconhecidos: {skills: number, agentes: number}}`.
  - Formato `Régua (<origem>): <Fase> → <skills>[ (alt.: <skill> — <quando>)][ · agente <agente>]; …; Transversais: <skill> — <quando>; …`.
  - Skill só-do-usuário vira `/<nome>`; sem entrada no catálogo, vale a lista `SO_USUARIO_PADRAO` (as 16 de `test/kit-fluxo.test.js:23-27`).
  - Texto: até `LIMITE_TEXTO` (2 000 caracteres, prefixo incluído), terminando em `… (régua completa: /hadouken-kit:regua)` quando corta.
  - `validar: false` para a padrão (as dependências dela já têm o aviso da Tarefa 2).
- `avisosDaRegua({origem, desconhecidos, descartes}) → string[]`, texto fixo e contagem, nunca nome nem texto da régua:
  - `hadouken-kit: régua com N skill(s) e M agente(s) desconhecido(s) e K item(ns) descartado(s); /hadouken-kit:regua mostra a régua ativa.` (só as parcelas diferentes de zero);
  - com `origem === 'repo'`: `hadouken-kit: a régua deste repositório (.claude/hadouken.json) vale no lugar da sua; /hadouken-kit:regua mostra qual.`
- `kit/regua-padrao.json`, com as fases da spec §4 Fatia 7 na ordem dela:
  - "Auditoria da spec" e "Auditoria do diff" com `agente: "hadouken:auditor"`;
  - "Mutação" com `usar: ["hadouken-kit:mutacao"]`;
  - transversais com os momentos da tabela em `kit/skills/fluxo/SKILL.md:28-56`.

- [ ] **Passo 1 — testes que falham** (`test/kit-regua.test.js`, `CLAUDE_CONFIG_DIR`/`HADOUKEN_HOME` de fixture):
  - **padrão**: sem arquivos → `additionalContext` contém `Régua (padrão):`, `Auditoria da spec` e `hadouken-kit:mutacao`. Os testes de nomes de `test/kit-fluxo.test.js` (POCOCK e SO_USUARIO com `/`) passam sem mudar; asserção de formato literal antigo, se houver, passa a afirmar o formato novo.
  - **global**: `<HADOUKEN_HOME>/regua.json` válido → `Régua (global):`.
  - **repo**: mais `<raiz>/.claude/hadouken.json` com `regua` → `Régua (repo):` e nada da global.
  - **R1**: repo com JSON inválido → `systemMessage` com aviso e `Régua (global):`.
  - **R2**: `fases: []` → aviso e nível seguinte.
  - **R3 sem eco**: skill `x:inexistente` → `systemMessage` contém `1 skill desconhecida` e não contém `x:inexistente`; o texto injetado mantém o resto da fase. Com `agente: 'x:nao-existe'` → contém `1 agente desconhecido` e não contém `x:nao-existe`.
  - **R4**: 60 fases → no máximo 20 entram, texto ≤ 2000 caracteres, terminado no ponteiro quando corta.
  - **R5 e R10, saneamento (a)**:
    - `quando` com `\n` e 300 caracteres → sem `\n`, ≤ 120;
    - `fase` com `\n`, caractere de controle (`\u0007`) e 300 caracteres → sem `\n` nem controle, ≤ 60;
    - `usar: ['bom:ok', 'x\ny', 'a'.repeat(81), 'com espaço']` → só `bom:ok` entra; `systemMessage` contém `3 item(ns) descartado(s)` e não contém `x\ny`, `com espaço` nem `aaaa`;
    - `alternativas[].skill` inválida → a alternativa sai; `agente: 'a b'` → o campo sai, a fase fica se tem `usar`;
    - 13 itens em `usar` → 12; 13 `alternativas` → 12; 41 transversais → 40;
    - fase sem `usar` e sem `agente` depois dos descartes → fase inválida (aviso de contagem);
    - nenhum `systemMessage` do arquivo contém um nome desconhecido ou inválido das fixtures.
  - **R9, aviso do repo no lugar da global (b)**:
    - régua do repo válida → `systemMessage` contém a linha fixa `hadouken-kit: a régua deste repositório (.claude/hadouken.json) vale no lugar da sua; /hadouken-kit:regua mostra qual.`;
    - origem global ou padrão → sem essa linha; régua do repo inválida (R1) → sem essa linha.
  - **R8, raiz do projeto (c)**:
    - `CLAUDE_PROJECT_DIR` = pasta A com `.claude/hadouken.json` e cwd em outra pasta B → `Régua (repo):` com o conteúdo de A;
    - sem `CLAUDE_PROJECT_DIR`, cwd = `<repo>/sub/dir`, `.git` em `<repo>` e `.claude/hadouken.json` em `<repo>` → `Régua (repo):`;
    - sem `CLAUDE_PROJECT_DIR` e sem `.git` do cwd para cima, `.claude/hadouken.json` no cwd → `Régua (repo):`;
    - `CLAUDE_PROJECT_DIR` relativo ou inexistente → ignorado (vale o `.git` mais próximo);
    - `raizProjeto` devolve `comGit: false` só no último caso.
  - **teto do SessionStart**: `test/kit-fluxo.test.js:87-88` afirma `additionalContext` ≤ 2400 caracteres e ≤ 5 linhas (spec §4 Fatia 7).
- [ ] **Passo 2** — `node --test test/kit-regua.test.js test/kit-fluxo.test.js` → FAIL.
- [ ] **Passo 3** — implementar. `fluxo.js` mantém a linha de abertura (`hadouken-kit: acione as skills sozinho…`, até antes de ` Processo:`) e a linha final de Web/Grafo/consumo, e troca as linhas de processo e de momentos pelo `texto`. Os avisos (inclusive o do repo) se juntam aos da Tarefa 2 no `systemMessage`, um por linha. A raiz do projeto vem de `raizProjeto({env: process.env, cwd: process.cwd()})`.
- [ ] **Passo 4** — `node --test test/kit-fluxo.test.js` com o teto antigo (`1600`) no arquivo → o teste do teto falha com a régua padrão (o texto passa de 1 600 caracteres); só então o teto de `:87` vira `2400`. `node --test` → 0 falhas.
- [ ] **Passo 5** — commit `feat(kit): régua de desenvolvimento configurável`.

### Tarefa 11: comando `/hadouken-kit:regua`

**Arquivos:**
- Criar:
  - `kit/skills/regua/SKILL.md` (`disable-model-invocation: true`). O corpo guia o `editar`: listar as skills do catálogo, montar fase a fase com o usuário, mostrar o JSON e gravar com Write em `${TMPDIR:-/tmp}/hadouken/regua-rascunho.json`, lembrando que nada vale até `/hadouken-kit:regua aplicar`.
  - `kit/hooks/regua-comando.js`, `test/kit-regua-comando.test.js`.
- Modificar: `kit/hooks/hooks.json` (`UserPromptExpansion`, matcher `hadouken-kit:regua` → `regua-comando.js`, timeout 10), `kit/hooks/regua.js`

**Interfaces produzidas:**
- `gravarJson(arquivo, valor) → {ok, motivo?}`: tmp + `renameSync`, cópia mínima de `gravarJsonAtomico`.
- `decidirRegua(entrada, {dirHadouken, tmpDir, env, cwd}) → saída | null`. `null` deixa o prompt seguir para a skill (caso `editar`). A raiz vem de `raizProjeto({env, cwd})` (Tarefa 10).

- [ ] **Passo 1 — testes que falham:**
  - `''` → `block`, `reason` com a origem e o texto da régua ativa e, se houver, a lista dos nomes desconhecidos que passaram pela regex.
  - `'editar'` → sem saída.
  - `'aplicar'` com rascunho válido em `tmpDir` → `<dirHadouken>/regua.json` igual ao rascunho, rascunho apagado, `reason` com o resumo.
  - **aplicar saneia (a)**: rascunho com `usar: ['ok:a', 'x y']` e `fase` de 300 caracteres → o arquivo gravado só tem `ok:a` e a `fase` cortada em 60; `reason` contém `1 item descartado` e não contém `x y`.
  - **aplicar --projeto na raiz (c)**:
    - `CLAUDE_PROJECT_DIR` = A → chave `regua` em `A/.claude/hadouken.json`, as outras chaves preservadas;
    - sem `CLAUDE_PROJECT_DIR`, cwd = `<repo>/sub` com `.git` em `<repo>` → grava em `<repo>/.claude/hadouken.json`.
  - **R7**: sem `CLAUDE_PROJECT_DIR` e sem `.git` do cwd para cima → grava em `<cwd>/.claude/hadouken.json` e `reason` contém `sem repositório git`.
  - **R6**: `'aplicar'` sem rascunho → `sem rascunho; rode /hadouken-kit:regua editar`.
  - Rascunho inválido → avisos, nada gravado, rascunho mantido.
  - `'padrao'` → `regua.json` apagado. `'padrao --projeto'` → só a chave `regua` sai, na mesma raiz de `aplicar --projeto`.
- [ ] **Passo 2** — `node --test test/kit-regua-comando.test.js` → FAIL.
- [ ] **Passo 3** — implementar. `tmpDir` = `os.tmpdir()`. O caminho no SKILL.md bate com `path.join(os.tmpdir(), 'hadouken', 'regua-rascunho.json')` no macOS e no Linux.
- [ ] **Passo 4** — `node --test` → 0 falhas.
- [ ] **Passo 5** — commit `feat(kit): comando /hadouken-kit:regua`.

### Tarefa 12: skill `hadouken-kit:mutacao` e README da régua

**Arquivos:**
- Criar: `kit/skills/mutacao/SKILL.md`, `test/kit-mutacao.test.js`
- Modificar: `README.md`, `README.en.md` (régua, `/hadouken-kit:regua`, critério da auditoria, mutação), `wiki/Kit.md`, `wiki/Kit-en.md`

- [ ] **Passo 1 — teste que falha.** O texto da skill contém `StrykerJS`, `npx`, `git diff -U0`, `mutmut`, `Stryker.NET`, `PIT` e `sobrevivente`. Não contém meta percentual (`/\d+\s*%/`). Frontmatter com `name: mutacao`.
- [ ] **Passo 2** — `node --test test/kit-mutacao.test.js` → FAIL.
- [ ] **Passo 3** — escrever a skill com o conteúdo da spec §4 Fatia 7 ("Mutação") a seção da régua em `wiki/Kit.md` e `wiki/Kit-en.md` e uma linha em "Recursos" dos dois READMEs (até 60 linhas). A wiki também diz que a régua do repo (`<raiz do projeto>/.claude/hadouken.json`) substitui a do usuário por inteiro, com a linha de aviso no SessionStart, e que a raiz é `CLAUDE_PROJECT_DIR`, senão o `.git` mais próximo, senão o cwd.
- [ ] **Passo 4** — `node --test` → 0 falhas.
- [ ] **Passo 5** — commit `feat(kit): skill de teste de mutação`.
- [ ] **Passo 6** — `revisor` na fatia 7.

## Fechamento

### Tarefa 13: mutação, auditoria do diff, e2e

- [ ] **Mutação**:
  - `npx -y @stryker-mutator/core run` com config temporária fora do repo, `testRunner: "command"` e `commandRunner.command` = `node --test` sobre os testes das Tarefas 1–12.
  - `mutate` = faixas `arquivo:início-fim` de `git diff -U0 main...HEAD -- src kit` (só `.js`/`.mjs`).
  - Cada sobrevivente vira teste novo (commit `test(mutação): …`) ou uma linha de justificativa guardada para o corpo do PR.
- [ ] **Auditoria do diff**: `auditor` sobre `main...HEAD` com o foco da spec §5. Achado confirmado → correção com teste.
- [ ] **e2e**:
  - Agente `e2e`, seção 9 da spec, passos 1–9.
  - Passo 3, além do descrito na spec: depois do `plugin install <D>` do instalador, conferir o campo `auto` da entrada em `installed_plugins.json` (D18; se vier sem `auto`, registrar na spec §8.1 como fato medido e no corpo do PR); conferir `claude plugin list` com o `hadouken-kit` 1.2.0 habilitado e sem a linha `Requires "hadouken@claude-hadouken"` (faixa `>=0.6.0`).
  - Passo 5, em `permissions.defaultMode: "auto"`: o despacho com injeção roda sem a negação `a hook changed this call's input after auto mode reviewed it`.
  - Portões do Fernando:
    - `/hadouken:liberar` para sessões `claude` filhas (passos 5–6);
    - ok com a tabela do que muda no `settings.json` real (passo 3).
  - Resíduo zero conferido por `ls`/`jq`.
- [ ] **PR**:
  - corpo por `mattpocock-skills:pr`, com as justificativas da mutação;
  - texto mostrado ao Fernando antes de publicar;
  - push e PR só com o ok dele.

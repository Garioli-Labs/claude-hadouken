# hadouken-kit e hadouken-rea — design

Data: 2026-10-09. Branch: `hadouken-kit` (a partir de `ac15238`, ponta do `v0.4.0-guarda`). Decisões do Sr. Garioli nesta conversa; o que é suposição está marcado.

## 1. Objetivo

Quem instala pelo marketplace do hadouken recebe, com um comando, o conjunto de skills e plugins que usamos no dia a dia, mais um mapa de qual usar em cada etapa (as sugestões do curso "AI Skills" de Matt Pocock, juntas com o superpowers sem conflito). O `claude-hadouken` continua sendo só consumo, guarda e aprendizado: quem quer só ele, instala só ele.

Sucesso:
- `claude plugin install hadouken-kit` deixa instalados e ligados o hadouken, o superpowers, o mattpocock-skills, o poka-yoke, o clean-architecture, o fullstack-dev-skills e o ui-ux-pro-max, mais as skills do próprio kit.
- Em toda sessão, o Claude recebe um resumo curto do fluxo, e a skill `hadouken-kit:fluxo` responde "qual skill agora?" sem ambiguidade entre superpowers e Matt.
- O REA (engenharia reversa) está a um comando de distância e nunca sobe ligado sem o usuário pedir — exceto na máquina do Sr. Garioli, onde fica sempre ligado.
- Nada no `claude-hadouken` muda; o portão da v0.4.0 não é afetado.

## 2. Estrutura no repositório

O repositório `Garioli-Labs/claude-hadouken` já é um marketplace (`.claude-plugin/marketplace.json`, uma entrada com `source: "./"`). Passa a ter três entradas:

| Plugin | Pasta | Versão | Conteúdo |
|---|---|---|---|
| `claude-hadouken` | `./` | 0.4.0 (sem mudança) | o de hoje |
| `hadouken-kit` | `./kit/` | 1.0.0 | `plugin.json` com `dependencies`, `hooks/hooks.json` + `hooks/fluxo.js`, `skills/fluxo`, `skills/yu-ux-web-expert`, `skills/graphify` |
| `hadouken-rea` | `./rea/` | 1.0.0 | `plugin.json` com `defaultEnabled: false` e `.mcp.json` do REA |

O `marketplace.json` ganha `allowCrossMarketplaceDependenciesOn: ["claude-plugins-official", "mattpocock", "poka-yoke", "clean-architecture-skills", "fullstack-dev-skills", "ui-ux-pro-max-skill"]`. Sem isso o Claude Code instala o kit sem as dependências e o kit não carrega (documentação oficial, "Plugin dependencies").

Os nomes dos marketplaces são os que o Claude Code registra hoje (`known_marketplaces.json`): `claude-plugins-official` (anthropics/claude-plugins-official), `mattpocock` (mattpocock/skills), `poka-yoke` (rainmanjam/poka-yoke), `clean-architecture-skills` (nathankim0/clean-architecture-skills), `fullstack-dev-skills` (jeffallan/claude-skills), `ui-ux-pro-max-skill` (nextlevelbuilder/ui-ux-pro-max-skill). Suposição a conferir no plano: o nome de cada plugin dentro do marketplace dele é o que aparece em `installed_plugins.json` (`superpowers`, `mattpocock-skills`, `poka-yoke`, `clean-architecture`, `fullstack-dev-skills`, `ui-ux-pro-max`).

## 3. Dependências do kit

`kit/.claude-plugin/plugin.json`:

- `claude-hadouken` (mesmo marketplace, sem faixa de versão). Sem faixa porque uma faixa resolve por tag `claude-hadouken--v<versão>` e o `claude plugin tag` recusa nomes que começam com `claude-`; o hadouken já fixa a própria versão pelo `version` do manifesto.
- `{ name: "superpowers", marketplace: "claude-plugins-official" }`, `{ name: "mattpocock-skills", marketplace: "mattpocock" }`, `{ name: "poka-yoke", marketplace: "poka-yoke" }`, `{ name: "clean-architecture", marketplace: "clean-architecture-skills" }`, `{ name: "fullstack-dev-skills", marketplace: "fullstack-dev-skills" }`, `{ name: "ui-ux-pro-max", marketplace: "ui-ux-pro-max-skill" }`.

Sem faixa de versão nas de terceiros na 1.0.0: não sabemos se esses autores publicam tags `<plugin>--v<versão>`, e uma faixa sem tag falha a instalação ("has no git tag satisfying"). Custo: uma versão nova de um terceiro chega sem teste nosso. O plano confere as tags de cada um; onde houver, a 1.1.0 passa a fixar `^major`.

Google Cloud e Cloudflare ficam fora (específicos de projeto).

Uma dependência de plugin ligado sobe sempre ligada (documentação: "A plugin that an enabled plugin depends on starts enabled regardless"). Por isso o REA não é dependência do kit (seção 6).

## 4. Skills copiadas para o kit

Só as que não existem em marketplace nenhum:

- **`yu-ux-web-expert`** — autoria do Sr. Garioli. Vai inteira (`SKILL.md`, `references/`, `scripts/`, `assets/`, `vendor/package.json` e `package-lock.json`, `ATTRIBUTIONS.md`). Licença: MIT do hadouken; o `ATTRIBUTIONS.md` já carrega o aviso MIT do poka-yoke. As dependências npm do `vendor/` não são copiadas (só o manifesto e o lock); o `scripts/setup.sh` as instala, como hoje.
- **`graphify`** — de safishamsi/graphify, licença dupla Apache-2.0/MIT. Vai o `SKILL.md` e `references/` gerados pelo `graphifyy` 0.9.25, com `LICENSE-MIT` e `NOTICE` do autor ao lado. O `SKILL.md` ganha no topo uma linha: requer `pip install graphifyy==0.9.25` (o texto da skill corresponde a essa versão do pacote).

No caminho da cópia, as skills passam a se chamar `hadouken-kit:yu-ux-web-expert` e `hadouken-kit:graphify`.

## 5. `hadouken-kit:fluxo` e o hook de início de sessão

### 5.1 A skill

Regra: o superpowers cuida do processo; o Matt entra onde o superpowers não tem equivalente; cada duplicata tem um dono só.

| Etapa | Use | A outra, só quando |
|---|---|---|
| Ideia nebulosa | `superpowers:brainstorming` | `mattpocock-skills:grill-with-docs` quando o projeto tem glossário/ADRs a atualizar durante a conversa |
| Falar não resolve | `mattpocock-skills:prototype` + `mattpocock-skills:handoff` para uma sessão limpa | — |
| Registrar a forma | spec do brainstorming | `mattpocock-skills:to-spec` quando a conversa já decidiu tudo |
| Quebrar o trabalho | `superpowers:writing-plans` | `mattpocock-skills:to-tickets` quando vai para um tracker; `mattpocock-skills:wayfinder` quando não cabe num plano |
| Executar | `superpowers:subagent-driven-development` | `superpowers:executing-plans` quando o usuário escolhe execução sem subagentes |
| Teste e bug | `superpowers:test-driven-development`, `superpowers:systematic-debugging` | `mattpocock-skills:diagnosing-bugs` só para regressão de desempenho |
| Revisar | `superpowers:requesting-code-review` por tarefa; `mattpocock-skills:code-review` no branch inteiro | — |
| Melhorar o sistema | `mattpocock-skills:improve-codebase-architecture` quando o mesmo atrito se repete; `poka-yoke:retro` depois de incidente | — |
| Especialidades | web: `hadouken-kit:yu-ux-web-expert` (prevalece sobre `ui-ux-pro-max`); segurança: `poka-yoke:*`, `security-review`; grafo do código: `hadouken-kit:graphify`; binário/APK/firmware: REA (plugin `hadouken-rea`) | — |

Mais duas regras na skill:
- Antes de etapa cara (revisor Fable, muitos subagentes, `Workflow`), ler a linha de consumo do hadouken; com alerta de projeção, perguntar ao usuário antes.
- `mattpocock-skills:ask-matt` responde dúvidas só sobre as skills do Matt; para "qual skill agora", vale esta tabela.

### 5.2 O hook

`kit/hooks/hooks.json` registra `SessionStart` → `node ${CLAUDE_PLUGIN_ROOT}/hooks/fluxo.js` (forma exec, `args`, timeout 5 s). O script imprime um JSON fixo com `hookSpecificOutput.additionalContext` de no máximo 5 linhas / 700 caracteres: a ordem das etapas, "superpowers cuida do processo, Matt onde o superpowers não cobre", e "detalhes: skill hadouken-kit:fluxo".

Fronteira: o `fluxo.js` não lê stdin, não lê arquivos, não importa `fs`, `child_process`, `net`, `http`, `https` nem `dgram`; só escreve uma constante no stdout. Custo: o texto entra no contexto de cada sessão (~150 tokens); nenhuma chamada de modelo.

Por que hook e não só a skill: o superpowers injeta "use brainstorming" em toda sessão; uma skill que só carrega quando invocada não compete com isso. O resumo do kit põe brainstorming em primeiro, então os dois textos concordam.

## 6. `hadouken-rea`

- `rea/.claude-plugin/plugin.json`: `name: "hadouken-rea"`, `version: "1.0.0"`, `defaultEnabled: false`, `license: "MIT"`, descrição dizendo que o REA executa os programas analisados com as permissões do usuário.
- `rea/.mcp.json`: `{ "mcpServers": { "rea": { "command": "npx", "args": ["-y", "rea-agents@6.1.0", "mcp"] } } }` — versão exata (rea-agents 6.1.0, MIT, conferida no npm em 2026-10-09), como a documentação do REA manda para registros persistentes. Nunca `@latest`.
- Ligar: `claude plugin install hadouken-rea` e `claude plugin enable hadouken-rea`. A skill de fluxo e o README dizem isso.
- Requisitos do REA: Node 22.19+, 24.11+ ou 26+; Hopper/Ghidra/IDA só para análise nativa.
- O kit não instala o `setup` do REA (que edita configuração de agentes); só o MCP.

## 7. Interação com a guarda do hadouken

- Instalar ou ligar plugin muda `enabledPlugins`; o hook `ConfigChange` do hadouken segura a mudança na sessão aberta. Instalação documentada: no terminal (fora de sessão, ou pelo `!` do Claude Code), depois abrir sessão nova.
- O kit não toca `~/.claude/hadouken/`, `settings.json` nem os arquivos do hadouken; não tem `bin/`.
- O `hadouken-rea` lança processo (o `npx`), mas pelo Claude Code, como qualquer MCP — não é código do hadouken; a fronteira "rede só em `baixar.js`, processo filho só em `coletor.js`" vale para `src/` do `claude-hadouken` e segue intacta.

## 8. Na máquina do Sr. Garioli

Depois do merge e do push (decisão dele), ele roda no terminal:
1. `claude plugin marketplace update claude-hadouken`, `claude plugin install hadouken-kit`, `claude plugin install hadouken-rea`, `claude plugin enable hadouken-rea`.
2. Com confirmação dele, o controlador remove as duplicatas: os 22 links de `~/.claude/skills` que apontam para `~/.agents/skills` e cujo nome está na lista `skills` do `mattpocock-skills` 1.2.0 (cópias do `npx skills`, já cobertas pelo plugin; conferido em 2026-10-09: todas menos `find-skills`, que não é do Matt e fica), e `~/.claude/skills/graphify` e `~/.claude/skills/yu-ux-web-expert` (passam a vir do kit; a pasta pessoal da yu-ux é copiada antes para o repositório, que vira a fonte).
3. O `~/.claude/CLAUDE.md` troca os caminhos `~/.claude/skills/graphify/SKILL.md` e `~/.claude/skills/yu-ux-web-expert/SKILL.md` por `hadouken-kit:graphify` e `hadouken-kit:yu-ux-web-expert` (o `scripts/setup.sh` da yu-ux passa a ser `${CLAUDE_PLUGIN_ROOT}`).

## 9. Testes

- `claude plugin validate ./kit` e `./rea` sem erro (o nome `hadouken-kit` não esbarra na regra de nomes reservados).
- Teste do `marketplace.json`: cada dependência com `marketplace` está no `allowCrossMarketplaceDependenciesOn`, e cada entrada aponta para pasta existente com `plugin.json` de mesmo nome.
- Teste do `fluxo.js`: rodado com stdin vazio, sai 0 e imprime JSON válido com `additionalContext` ≤ 700 caracteres; leitura estática prova que não importa os módulos da seção 5.2 (no estilo de `test/aprendizado-fronteiras.test.js`).
- Teste da skill `fluxo`: todo nome `plugin:skill` citado na tabela existe numa lista fixa conferida no plano (pega erro de digitação).
- Teste das cópias: `kit/skills/graphify` tem `LICENSE-MIT`; `kit/skills/yu-ux-web-expert` tem `ATTRIBUTIONS.md`.
- `node --test` inteiro do repositório segue passando.
- Roteiro manual (controlador, com `--plugin-dir ./kit --plugin-dir ./rea` e `CLAUDE_CONFIG_DIR` temporário quando der): a sessão mostra o resumo do fluxo; `/hadouken-kit:fluxo` carrega; com o rea ligado, `/mcp` lista `rea`.

## 10. Fora do escopo

- Sandcastle e agentes AFK.
- Faixas de versão nas dependências de terceiros (1.1.0, depois de conferir as tags).
- Mudança no `claude-hadouken` ou na v0.4.0.

## 11. Ordem de entrega

O branch `hadouken-kit` sai de `ac15238`. Merge na `main` depois da v0.4.0 (portão, segunda 2026-10-12 depois das 22:00). Push e tags: decisão do Sr. Garioli.

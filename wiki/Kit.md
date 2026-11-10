# hadouken-kit e hadouken-rea

[English](Kit-en)

## hadouken-kit e hadouken-rea (opcionais)

O marketplace `claude-hadouken` traz mais dois plugins, separados do consumo e da guarda. O **hadouken-kit** instala de uma vez o conjunto de skills do dia a dia: `hadouken`, `superpowers` (`claude-plugins-official`), `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` e `ui-ux-pro-max` (estes quatro como entradas do próprio marketplace `claude-hadouken`, com o commit fixado). Leva também a skill `hadouken-kit:fluxo`, que diz qual usar em cada etapa, e cópias da `yu-ux-web-expert` e da `graphify`. Quem quer só o consumo e a guarda instala só o `hadouken`.

No terminal (fora de sessão, ou com `!` dentro dela):

```bash
claude plugin marketplace add Garioli-Labs/claude-hadouken
claude plugin marketplace update claude-hadouken
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install hadouken-kit@claude-hadouken
```

- **Por que os `marketplace add` antes.** O primeiro registra o marketplace do hadouken (quem já tem a v0.4.0 vê "already" e segue; o `update` traz a entrada do kit). O Claude Code só instala uma dependência de um marketplace já registrado. Sem ele, o kit instala com o aviso `dependency "<nome>" was not installed (no marketplace you have added lists it)` e não carrega.
- **Fora de sessão.** Instalar ou ligar plugin dentro de uma sessão aberta é segurado pelo hook `ConfigChange` da guarda. Rode os comandos no terminal e abra uma sessão nova.
- **As skills na hora certa.** A cada sessão, o kit põe no contexto um resumo de 5 linhas (uns 400 tokens, nenhuma chamada de modelo) com o momento de cada skill: o `superpowers` cuida do processo e as do Matt Pocock entram nos momentos delas (pôr um plano à prova, protótipo, spec, tickets, handoff, revisão do branch, corpo de PR, passos que só você pode fazer, desenho de módulo, domínio, pesquisa, triagem, ensino). O Claude aciona sozinho as que o autor deixa o modelo acionar; as outras 16 (`to-spec`, `to-tickets`, `handoff`, `triage`, `teach` e mais) têm `disable-model-invocation`, e no momento delas o Claude sugere que você digite o comando (`/mattpocock-skills:handoff`, por exemplo). A tabela completa, com as 27 skills do Matt (mattpocock-skills 1.3.1), está em `/hadouken-kit:fluxo`.
- **Já tinha o `mattpocock-skills`?** O mapa segue a 1.3.1 (27 skills). Quem o instalou antes continua na versão do cache até atualizar; na 1.2.0, `pr` e `wizard` não existem e o Claude não as acha. Desde a v0.5.2, o kit traz a cópia do marketplace `claude-hadouken`; rode o comando único (que desliga a cópia antiga, `mattpocock-skills@mattpocock`) ou, no terminal, `claude plugin marketplace update claude-hadouken` e `claude plugin update mattpocock-skills@claude-hadouken`, e abra uma sessão nova.
- **clean-architecture fora do kit.** Desde 2026-10-14 o `plugin.json` dele é um link simbólico. No Windows, o git clona o link como texto e a instalação falha com `JSON parse error: Unexpected token '.'`; como dependência, derrubaria o kit inteiro. No Linux e no macOS ele instala à parte: `claude plugin marketplace add nathankim0/clean-architecture-skills` e `claude plugin install clean-architecture@clean-architecture-skills`.
- **yu-ux-web-expert.** Na primeira vez, o `setup.sh` dela instala `axe-core` e `lighthouse` (pelo `package-lock.json` do kit) na pasta do plugin, o `playwright` no Python do usuário e o Chromium no cache do Playwright; o `axe-core` e o `lighthouse` voltam a ser instalados depois de cada atualização do kit, porque a pasta muda de versão. A cópia do kit não libera Bash, Write, Edit nem WebFetch sem pergunta (`allowed-tools: Read Grep Glob`): ela lê páginas de terceiros, e cada comando passa pela sua permissão.
- **REA, desligado por padrão quando instalado à mão.** O instalador de um comando o liga só na primeira instalação, se o Node servir; desligado por você, continua desligado. Para ligar à mão: `claude plugin install hadouken-rea@claude-hadouken` e `claude plugin enable hadouken-rea@claude-hadouken`. Ele abre `npx -y rea-agents@6.1.0 mcp` (versão exata; no Windows, pelo `cmd.exe /d /c`) com o cwd na pasta do plugin, nunca no projeto aberto (um `node_modules` ou `.npmrc` do repositório não entra); passe caminhos absolutos ao REA. Precisa de Node 22.19+, 24.11+ ou 26+ e **executa os programas analisados com as permissões do seu usuário**. Na primeira vez, o `npx` baixa o pacote (uns 20 a 30 s) e o `/mcp` pode acusar tempo esgotado; com o pacote no cache, conecta em segundos (reconecte pelo `/mcp` ou abra uma sessão nova).
- **Versões e atualização automática.** Os terceiros do kit (`mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` e `ui-ux-pro-max`) são entradas do marketplace do Hadouken com o commit fixado (`sha`); o `superpowers` segue no marketplace oficial. O instalador de um comando liga `autoUpdate` no marketplace do Hadouken (no seu `settings.json`, com backup) e desliga as cópias antigas dos terceiros, que vinham dos marketplaces de cada um, para as skills não aparecerem em dobro (nada é desinstalado; desfazer é pôr `true` de volta em `enabledPlugins`). Toda segunda, um robô no GitHub Actions confere as versões publicadas: versão nova de um terceiro ou do `rea-agents` vai para um ramo, a suíte roda em Linux, Windows e macOS com Node 20, 22 e 24 e, tudo verde, o robô publica sozinho (tag `kit-v<versão>`); algum vermelho vira issue e nada é publicado. Versão nova do `graphifyy` (pip) só abre issue. O kit só fala com a rede quando o `setup.sh` da yu-ux roda (npm, pip, Playwright) e o REA, quando ligado, no primeiro `npx`.

## Régua de desenvolvimento

O `hadouken-kit` injeta no início da sessão a **régua**: a lista de fases do trabalho (ideia, protótipo, spec, auditoria, execução, teste, revisão, mutação...) com a skill de cada uma. Ela só orienta; quem decide é você. `/hadouken-kit:regua` mostra e muda a régua:

| Comando | Faz |
|---|---|
| `/hadouken-kit:regua` | Mostra a régua ativa e de onde ela vem (repo, global ou padrão). |
| `/hadouken-kit:regua editar` | O Claude monta a régua com você, fase a fase, e grava um rascunho em `<tmp do SO>/hadouken/regua-rascunho.json`. Nada vale até o `aplicar`. |
| `/hadouken-kit:regua aplicar [--projeto]` | Valida o rascunho e grava: sem `--projeto`, em `~/.claude/hadouken/regua.json` (global); com `--projeto`, na chave `regua` de `<raiz do projeto>/.claude/hadouken.json`. |
| `/hadouken-kit:regua padrao [--projeto]` | Remove a régua do nível e volta à seguinte. |

**Precedência**: régua do repo, senão a global, senão a padrão. A de maior precedência substitui a outra **por inteiro**, sem mesclar. Quando a do repo vale no lugar da sua, o SessionStart mostra uma linha de aviso. Arquivo ilegível ou inválido → aviso e cai para o nível seguinte.

**Raiz do projeto**: `CLAUDE_PROJECT_DIR`; senão o `.git` mais próximo, subindo do diretório atual; senão o próprio diretório atual.

**Auditoria**: as fases "Auditoria da spec" e "Auditoria do diff" (agente `hadouken:auditor`) rodam quando a mudança custa caro se errar (produção, dinheiro, autenticação, dado real, irreversível) ou muda contrato público (API, schema, config do usuário, hook, formato de arquivo). Ficam de fora doc, rename e fatia mecânica. A segunda rodada só vale se a spec mudou materialmente.

**Mutação** (`hadouken-kit:mutacao`): no fim da frente, antes do PR, roda teste de mutação só nas linhas alteradas no branch. Cada sobrevivente em linha alterada é morto com um teste ou justificado no PR; não há nota percentual fixa. Ferramenta por stack: StrykerJS via `npx` (JS/TS, sem virar dependência do projeto), mutmut (Python), Stryker.NET (.NET) e PIT (JVM); para outras, a skill avisa que não há ferramenta conhecida e pede a escolha.

---

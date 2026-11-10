# hadouken-kit e hadouken-rea

[English](Kit-en)

## hadouken-kit e hadouken-rea (opcionais)

O marketplace `claude-hadouken` traz mais dois plugins, separados do consumo e da guarda. O **hadouken-kit** (1.3.0) instala só as skills do Garioli: `hadouken` (dependência), `yu-ux-web-expert`, `graphify` e `fluxo`, que diz qual skill usar em cada etapa. As de terceiros (`superpowers` de `claude-plugins-official`, `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` e `ui-ux-pro-max`, estas do marketplace `claude-hadouken`, e o `hadouken-rea`) não são mais instaladas pelo kit: o instalador confere se já estão instaladas (plugin instalado ou pasta em `<config>/skills/<nome>`) e, se não, mostra `○ <nome>: sugerido (rode <comando>)`. O `/hadouken:saude` (ou a conferência da instalação) lista as "sugeridas não instaladas". O `fluxo` só usa skill de terceiro se ela estiver instalada. Se um kit antigo instalou uma delas como dependência e você tem outra cópia equivalente ligada, o instalador desliga a cópia do kit (veja [Dependências e cópias em dobro](#dependências-e-cópias-em-dobro)). Quem quer só o consumo e a guarda instala só o `hadouken`.

No terminal (fora de sessão, ou com `!` dentro dela), este comando instala só o kit e o `hadouken`:

```bash
claude plugin marketplace add Garioli-Labs/claude-hadouken
claude plugin marketplace update claude-hadouken
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install hadouken-kit@claude-hadouken
```

- **Instalar uma sugerida.** Rode o comando que o instalador mostra, por exemplo `claude plugin install superpowers@claude-plugins-official` (o `marketplace add anthropics/claude-plugins-official` acima registra esse marketplace), e abra uma sessão nova.
- **Por que os `marketplace add` antes.** O primeiro registra o marketplace do hadouken (quem já tem a v0.4.0 vê "already" e segue; o `update` traz a entrada do kit). O Claude Code só instala uma dependência de um marketplace já registrado. Sem ele, o kit instala com o aviso `dependency "<nome>" was not installed (no marketplace you have added lists it)` e não carrega.
- **Fora de sessão.** Instalar ou ligar plugin dentro de uma sessão aberta é segurado pelo hook `ConfigChange` da guarda. Rode os comandos no terminal e abra uma sessão nova.
- **As skills na hora certa.** A cada sessão, o kit põe no contexto um resumo de 5 linhas (uns 400 tokens, nenhuma chamada de modelo) com o momento de cada skill: o `superpowers` cuida do processo e as do Matt Pocock entram nos momentos delas (pôr um plano à prova, protótipo, spec, tickets, handoff, revisão do branch, corpo de PR, passos que só você pode fazer, desenho de módulo, domínio, pesquisa, triagem, ensino). O Claude aciona sozinho as que o autor deixa o modelo acionar; as outras 16 (`to-spec`, `to-tickets`, `handoff`, `triage`, `teach` e mais) têm `disable-model-invocation`, e no momento delas o Claude sugere que você digite o comando (`/mattpocock-skills:handoff`, por exemplo). A tabela completa, com as 27 skills do Matt (mattpocock-skills 1.3.1), está em `/hadouken-kit:fluxo`.
- **Já tinha o `mattpocock-skills`?** O mapa segue a 1.3.1 (27 skills). Quem o instalou antes continua na versão do cache até atualizar; na 1.2.0, `pr` e `wizard` não existem e o Claude não as acha. Desde a v0.5.2, a cópia pinada é a do marketplace `claude-hadouken`; o kit 1.2.0 ou mais novo não a instala, e o instalador de um comando só a sugere. Se você tem as duas (a do kit, instalada por um kit antigo, e `mattpocock-skills@mattpocock`), o instalador desliga a do kit (veja [Dependências e cópias em dobro](#dependências-e-cópias-em-dobro)). Para atualizar a pinada, no terminal: `claude plugin marketplace update claude-hadouken` e `claude plugin update mattpocock-skills@claude-hadouken`, e abra uma sessão nova.
- **clean-architecture fora do kit.** Desde 2026-10-14 o `plugin.json` dele é um link simbólico. No Windows, o git clona o link como texto e a instalação falha com `JSON parse error: Unexpected token '.'`; como dependência, derrubaria o kit inteiro. No Linux e no macOS ele instala à parte: `claude plugin marketplace add nathankim0/clean-architecture-skills` e `claude plugin install clean-architecture@clean-architecture-skills`.
- **yu-ux-web-expert.** Na primeira vez, o `setup.sh` dela instala `axe-core` e `lighthouse` (pelo `package-lock.json` do kit) na pasta do plugin, o `playwright` no Python do usuário e o Chromium no cache do Playwright; o `axe-core` e o `lighthouse` voltam a ser instalados depois de cada atualização do kit, porque a pasta muda de versão. A cópia do kit não libera Bash, Write, Edit nem WebFetch sem pergunta (`allowed-tools: Read Grep Glob`): ela lê páginas de terceiros, e cada comando passa pela sua permissão.
- **REA, desligado por padrão quando instalado à mão.** O instalador de um comando o liga só na primeira instalação, se o Node servir; desligado por você, continua desligado. Para ligar à mão: `claude plugin install hadouken-rea@claude-hadouken` e `claude plugin enable hadouken-rea@claude-hadouken`. Ele abre `npx -y rea-agents@6.1.0 mcp` (versão exata; no Windows, pelo `cmd.exe /d /c`) com o cwd na pasta do plugin, nunca no projeto aberto (um `node_modules` ou `.npmrc` do repositório não entra); passe caminhos absolutos ao REA. Precisa de Node 22.19+, 24.11+ ou 26+ e **executa os programas analisados com as permissões do seu usuário**. Na primeira vez, o `npx` baixa o pacote (uns 20 a 30 s) e o `/mcp` pode acusar tempo esgotado; com o pacote no cache, conecta em segundos (reconecte pelo `/mcp` ou abra uma sessão nova).
- **Versões e atualização automática.** Os terceiros sugeridos (`mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` e `ui-ux-pro-max`) são entradas do marketplace do Hadouken com o commit fixado (`sha`); o `superpowers` segue no marketplace oficial. O kit não os instala, mas o marketplace segue os fixando. O instalador de um comando liga `autoUpdate` no marketplace do Hadouken (no seu `settings.json`, com backup) e desliga só a cópia em dobro que o kit instalou, para as skills não aparecerem duas vezes (veja [Dependências e cópias em dobro](#dependências-e-cópias-em-dobro); nada é desinstalado, e o instalador não mexe no `enabledPlugins`). Toda segunda, um robô no GitHub Actions confere as versões publicadas: versão nova de um terceiro ou do `rea-agents` vai para um ramo, a suíte roda em Linux, Windows e macOS com Node 20, 22 e 24 e, tudo verde, o robô publica sozinho (tag `kit-v<versão>`); algum vermelho vira issue e nada é publicado. Versão nova do `graphifyy` (pip) só abre issue. O kit só fala com a rede quando o `setup.sh` da yu-ux roda (npm, pip, Playwright) e o REA, quando ligado, no primeiro `npx`.

## Dependências e cópias em dobro

O `plugin.json` do `hadouken-kit` (1.3.0) declara uma só dependência: o `hadouken` na versão `>=0.6.0`; com um `hadouken` menor o kit fica desabilitado. Os cinco terceiros (`superpowers`, `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` e `ui-ux-pro-max`) estão fora do manifesto desde o kit 1.2.0, porque uma dependência desabilitada derruba o kit. O instalador de um comando só sugere os que faltam (`○ <nome>: sugerido (rode <comando>)`) e nunca instala nem liga um deles. Só uma coisa ele muda: a cópia em dobro que um kit antigo instalou.

- **Cópia equivalente.** Um plugin ligado no seu escopo de usuário, de outro marketplace, com o mesmo nome ou a mesma origem (mesmo repositório e mesma subpasta). Cópia desligada não conta.
- **O instalador** (`curl … | bash`, `irm … | iex`), depois de instalar ou atualizar o kit, para cada um dos cinco:
  - a cópia do kit e a equivalente estão ligadas, a do kit veio como dependência de um kit antigo (`auto: true` no `installed_plugins.json`), nada mais depende dela e o kit é 1.2.0 ou mais novo → `claude plugin disable <plugin> --scope user`, conferido pela lista, com o aviso "<plugin> já instalado via <equivalente>; cópia do kit desligada";
  - as duas ligadas, mas você instalou a do kit → não desliga: avisa que as duas fazem o mesmo e mostra o comando para você rodar se quiser;
  - outro plugin ligado depende da cópia do kit → não desliga, porque o `disable` falharia; o aviso nomeia quem depende;
  - kit abaixo de 1.2.0 → "atualize o hadouken-kit para desligar a cópia em dobro" e não mexe;
  - o `disable` não surtiu efeito → item ✗ com o comando para você rodar;
  - qualquer outro caso (sem cópia equivalente, cópia desligada) → nada além da sugestão.

  Nunca desinstala, nem instala ou liga terceiro, nem escreve em `enabledPlugins`. Se a versão da cópia equivalente difere da testada com o kit (`kit/testado.json`), o aviso diz as duas.
- **A cada sessão**, o `hadouken-kit` confere o mesmo e mostra uma linha por cópia em dobro, com o comando para o terminal (`no terminal: claude plugin …`): com a guarda ligada, o Claude não roda `claude` dentro da sessão. Terceiro que falta não gera linha (é sugerido, não exigido). Se não conseguir ler o registro dos plugins, fica em silêncio, sem aviso falso. Não escreve no `settings.json` e não compara versão.
- **Quem teve a cópia original desligada por uma versão anterior** (a 0.5.9 desligava `mattpocock-skills@mattpocock` e outras no `enabledPlugins`) fica como está: a v0.6.0 não religa nem desliga nada por conta disso.
- **Cópias órfãs.** Os kits 1.2.0 e 1.3.0 não declaram terceiros, então as cópias que kits antigos instalaram ficam órfãs; `claude plugin prune` as remove.

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

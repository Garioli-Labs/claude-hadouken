# v0.5.9 — kit enxuto, planos Max e Ultra, perfis do VS Code e duas contas

Pedido do Sr. Garioli em 09/11/2026. Regra que vale para tudo: **o mais simples possível para o usuário**.

## 1. Instalação: só as skills do Sr. Garioli; as outras, conferidas e sugeridas

**Por quê:** o instalador instala skills de terceiros que o usuário pode já ter (de outro marketplace) ou não querer, e uma delas quebrou no Mac do Fernando (issue #2: clone do poka-yoke por SSH sem a chave do github.com).

- **Instalados sempre:** `hadouken` e `hadouken-kit` (com a `yu-ux-web-expert`, o `fluxo` e a cópia do graphify que já vive no kit). Já instalados: atualiza, não reinstala.
- **Só conferidos e sugeridos:** superpowers, mattpocock-skills, poka-yoke, fullstack-dev-skills, ui-ux-pro-max e hadouken-rea.
  - Conta como "já instalado" o plugin com o mesmo nome em **qualquer** marketplace (ex.: superpowers do oficial ou de outro), e a skill solta com o mesmo nome em `~/.claude/skills/`.
  - Instalado: o resumo diz "já instalado" e não mexe.
  - Faltando: o resumo diz "sugerido" com o comando exato para instalar. Nunca instala sozinho.
- O `kit/.claude-plugin/plugin.json` deixa de declarar os terceiros como dependência (fica só `hadouken`); senão o Claude Code os instalaria junto com o kit.
- **Quem já tem tudo instalado:** nada é desinstalado; a atualização automática segue para os que estão instalados.
- O `hadouken-kit:fluxo` e o roteamento continuam citando as skills de terceiros, mas só como "se estiver instalada"; sem ela, seguem sem.
- A linha `Instal.` do `/hadouken:saude` mostra quantas sugeridas faltam ("3 skills sugeridas não instaladas: rode …").

## 2. Planos: Pro, Max e Ultra

Fonte: página oficial de preços (claude.com/pricing, lida em 09/11/2026). O Sr. Garioli disse que o Ultra não tem limite semanal; a página oficial diz que ele **não tem o de 5 horas** e mantém o semanal. Vale a página.

| Plano | Antes | 5 horas | Semana | Fable |
|---|---|---|---|---|
| Pro | Pro | sim | sim | pago com créditos de uso |
| Max | Max 5x | sim (5× Pro) | sim (5× Pro) | até metade da semana |
| Ultra | Max 20x | **não** (conta verificada) | sim (10× Pro) | até metade da semana |

- Rótulos novos `Max` e `Ultra` em todo lugar (relatório, saúde, janela, wiki). O campo `organizationRateLimitTier` continua a única fonte; `_max_5x` ou nome com `max` vira Max, `_max_20x` ou nome com `ultra` vira Ultra. Tier desconhecido: sem plano, como hoje.
- **Ultra:** a janela de 5 h sai da barra do Claude Code, do item do VS Code, dos avisos e da guarda (nada trava nem avisa por 5 h). Semana e Fable seguem iguais.
- **Exceção:** se a leitura oficial do uso ainda trouxer a janela de 5 h (conta não verificada), ela aparece e vale. Nada some sem motivo.
- `plano` no JSON do `/hadouken:consumo` passa a valer `pro`, `max` ou `ultra`; quem lia `max5`/`max20` recebe os nomes novos (anotar na wiki).

## 3. O que o Fernando reportou (issues do repositório)

- **#7 — barra do VS Code não aparece (Mac, perfil Educbank).** O instalador roda `code --install-extension` sem `--profile`, e a extensão cai só no perfil Default. **Correção:** instalar no perfil Default e em **todos** os perfis do VS Code (lidos de `userDataProfiles` no `storage.json` do VS Code, nos caminhos de Windows, Linux e macOS), com `--profile <nome>`. A cada versão nova, de novo em todos. Fechar a #7 com o link da versão.
- **#2 — poka-yoke não instala (clone por SSH).** Resolvido pelo item 1 (passa a ser só sugerido). Conferir se o `git-subdir` do marketplace pode ir por https; se puder, trocar. Comentar na #2.
- Issues do robô do kit (#3 a #10, PR #1 do dependabot): fora do escopo; ficam como estão.

## 4. Duas contas, uma em cada janela do VS Code, sem uma atrapalhar a outra

**Por quê:** hoje o Sr. Garioli troca de conta com `/login`. A credencial e os dados do Hadouken ficam num lugar só (`~/.claude` e `~/.claude/hadouken`), então as duas janelas leem a mesma conta, e leituras, guarda e avisos se misturam.

**Como fica (o mais simples possível):**
1. Na janela do Hadouken (clique na barra), uma seção **Conta desta janela** com uma lista: `Principal` (a de hoje) e as contas criadas, e o botão **Nova conta**.
2. **Nova conta:** pede só um nome (ex.: "Trabalho"). O Hadouken cria a pasta da conta (`~/.claude-contas/<nome>/`), instala o `hadouken` e o `hadouken-kit` nela e liga a janela atual a essa conta. Depois, uma linha: "Abra o Claude Code nesta janela e rode /login uma vez com a conta Trabalho."
3. **Trocar a conta da janela:** escolher outra na lista. Vale para aquela janela (aquele projeto); as outras janelas seguem cada uma na sua.
4. Cada conta tem os próprios dados do Hadouken (`<pasta da conta>/hadouken/`): leituras, guarda, avisos, aprendizado e configuração. A Principal continua em `~/.claude/hadouken`, sem mudar nada para quem só tem uma conta.
5. O item da barra do VS Code mostra os limites da conta da janela e, quando há mais de uma conta, o nome dela no começo do texto da dica (tooltip).

**Como a janela fica presa à conta:** a variável `CLAUDE_CONFIG_DIR` com a pasta da conta, gravada nas configurações daquele projeto no VS Code, no ponto que o Claude Code do VS Code e o terminal integrado leem (o builder confere o nome exato da configuração da extensão do Claude Code; o terminal usa `terminal.integrated.env.<so>`). A Principal é a ausência da variável. A extensão do Hadouken lê a mesma configuração para saber qual pasta de dados mostrar.

**Regras:**
- O `dirDados()` passa a seguir o `CLAUDE_CONFIG_DIR` quando ele aponta para uma pasta que não é a padrão (`<CLAUDE_CONFIG_DIR>/hadouken`). `HADOUKEN_HOME` continua vencendo tudo.
- Os atalhos de `bin/`, a statusline e os hooks de cada conta apontam para a pasta da própria conta.
- Nunca ler credenciais nem e-mail da conta: a conta é identificada só pela pasta e pelo nome que o usuário deu.
- Se a configuração do projeto estiver num arquivo versionado pelo git (`.vscode/settings.json` rastreado), avisar antes de gravar, porque o caminho leva o nome do usuário.
- `/login` continua funcionando como hoje dentro de cada conta.

## Fora de escopo

WhatsApp (v0.6.0), trocar de conta no meio de uma sessão aberta, mais de um VS Code (Insiders, Cursor).

## Restrições de sempre

Testes com `--test-concurrency=2`, suíte no Windows e no Linux (WSL, Node 20 e 24) e o CI de instalação em macOS, Linux e Windows verde antes do push no `main`. Sem chamadas de rede novas além do que o instalador já faz. Nenhum nome de processo, pid ou caminho no contexto do Claude. Wiki pt/en e SECURITY atualizados. Tag, release e wiki só com o OK do Sr. Garioli.

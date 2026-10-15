# v0.5.2: instalador de um comando, correções do Mac e atualização automática

Data: 2026-10-15. Branch: `v0.5.2`.

## Por quê

O irmão do Sr. Garioli instalou o claude-hadouken no VS Code de um Mac e o
item dos limites não apareceu no rodapé do VS Code. Pelo código, três causas
possíveis, nenhuma visível para o usuário:

1. O instalador do painel procura o `code` só no `PATH`
   (`src/painel/instalar-painel.js`, `acharCode`). No macOS o VS Code não põe
   o `code` no `PATH` por padrão; a instalação falha com `sem-vscode` em
   silêncio e só tenta de novo depois de 1 h.
2. A barra do Claude Code só aparece depois do `/claude-hadouken:instalar`,
   passo fácil de pular.
3. Sem Node no `PATH`, nenhum hook roda, e o plugin não tem como avisar.

Além disso, instalar num PC novo hoje são umas dez linhas de comando, mais o
`/claude-hadouken:instalar` dentro de uma sessão. O pedido do Sr. Garioli:
"Faz a instalação em outro PC ser mais fácil. Um comando único instala tudo já."

## Decisões dele

- **Escopo:** tudo: claude-hadouken, hadouken-kit (com as dependências),
  hadouken-rea já ligado, a barra e o item do VS Code.
- **Forma:** um script por sistema (`install.sh` e `install.ps1`), baixado e
  executado numa linha. Funciona sem Node instalado.
- **Pré-requisitos que faltam:** o instalador mostra a lista e pergunta s/N
  uma vez; instala o que der (Node pelo winget ou brew, Claude Code pelo
  instalador oficial); sem winget nem brew, para e explica.
- **Abordagem A:** scripts finos e a lógica comum em Node, dentro do plugin.

## Os comandos

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Opções (no bash, `| bash -s -- <opções>`; no PowerShell, o script baixado
aceita os mesmos nomes como parâmetros, e a variável `HADOUKEN_INSTALAR` com
as opções separadas por espaço serve ao `irm | iex`, que não passa argumentos):

- `--sim`: responde sim a todas as perguntas (CI, testes, uso sem ninguém na
  frente). Não substitui uma barra de outro plugin.
- `--com-aprendizado`: liga o aprendizado local (OpenTelemetry) sem
  perguntar.
- `--substituir-barra`: troca uma `statusLine` existente que não é a do
  claude-hadouken (com backup, como o `instalar --aplicar --substituir`).

Rodar de novo é o jeito de atualizar: o que já está certo é pulado.

## O que o comando faz, em ordem

1. **Confere o PC:** Node ≥ 20, `claude` ≥ 2.1.251, `git`, e (opcional) o
   VS Code. Mostra o que falta.
2. **Pergunta s/N uma vez** se faltar Node ou `claude`. Não: para, com o
   comando de cada um.
3. **Instala o que falta:**
   - Node: `winget install OpenJS.NodeJS.LTS` no Windows; `brew install node`
     no Mac. No Linux, e sem winget/brew, para e mostra o link do nodejs.org.
   - Claude Code: o instalador oficial (`curl -fsSL https://claude.ai/install.sh | bash`
     ou `irm https://claude.ai/install.ps1 | iex`).
   - Depois de instalar, acrescenta o caminho deles ao `PATH` do próprio
     processo, para seguir sem abrir outro terminal.
   - `claude` presente mas abaixo de 2.1.251: roda `claude update` (dentro da
     mesma confirmação).
4. **O plugin principal** (no script): `claude plugin marketplace add
   Garioli-Labs/claude-hadouken` e `claude plugin marketplace update
   claude-hadouken` (os dois tolerados quando falham: "já registrado"), depois
   `claude plugin install claude-hadouken@claude-hadouken`, ou
   `claude plugin update` quando `claude plugin list --json` já o lista.
5. **Acha a pasta do plugin** pelo `installPath` da entrada
   `claude-hadouken@claude-hadouken` em `claude plugin list --json` (lido com
   o próprio Node) e roda `node <pasta>/src/instalar-tudo.js` com as opções e
   com `HADOUKEN_CLAUDE` = caminho do `claude` achado pelo script. Sem a
   entrada: para ("o plugin não instalou").
6. **`instalar-tudo.js`** (Node, testado com a suíte):
   - registra o marketplace oficial (`claude plugin marketplace add
     anthropics/claude-plugins-official`, tolerado), instala ou atualiza
     `hadouken-kit@claude-hadouken` e `hadouken-rea@claude-hadouken`, e liga
     o REA (`claude plugin enable`); a verdade de cada passo é o `claude
     plugin list --json` depois dele, nunca o texto de saída;
   - REA: com Node fora de 22.19+, 24.11+ e 26+, roda `claude plugin disable
     hadouken-rea@claude-hadouken` e marca como pulado, com o motivo;
   - atualização automática: ver a seção abaixo;
   - arquivos estáveis da barra e do painel (`sincronizarShims`, o mesmo do
     início de sessão), para a barra funcionar já na primeira sessão;
   - barra: o `aplicarStatusline` de hoje; com outra barra, pergunta
     "substituir?" com "não" como padrão (`--sim` responde não; só
     `--substituir-barra` troca);
   - item do VS Code: `instalarPainel` de hoje, já com o `acharCode` novo;
   - aprendizado (OpenTelemetry), decisão do Sr. Garioli: "Pergunta s/N,
     padrão não". Já ligado: `= já estava`. Senão, mostra o custo (Collector
     `otelcol-contrib` de ~367 MiB em disco, ~108 MiB de memória, um processo
     por sessão, nada sai da máquina) e pergunta "Ligar o aprendizado? [s/N]";
     `--sim` responde não, e só `--com-aprendizado` liga sem perguntar. Sim:
     o mesmo `previa` + `ligar` de `src/aprendizado/ligar.js`, com o código
     que a própria `previa` devolve (a confirmação do instalador faz o papel
     do código de 8 caracteres, porque quem responde é a pessoa no terminal,
     fora de sessão). Falha: `✗` com o motivo da lista do `ligar`; o resto da
     instalação não muda;
   - imprime o resumo.
7. **Resumo**, uma linha por item: `✓ instalado`, `= já estava`,
   `– pulado (motivo)`, `✗ falhou (motivo; conserto)`, e no fim "Abra uma
   sessão nova do Claude Code". Algum `✗`: código de saída 1.

Tudo roda fora de sessão: a guarda segura mudança de plugin dentro de uma
sessão aberta, e o README já manda instalar pelo terminal.

## As peças

| Peça | Onde | Responsabilidade |
|---|---|---|
| `install.sh` | raiz | Mac e Linux. Passos 1 a 5. Lê respostas de `/dev/tty` (no `curl \| bash` a entrada é o script); sem tty e sem `--sim`, trata como "não". |
| `install.ps1` | raiz | Windows. Passos 1 a 5, com `Read-Host`. Compatível com Windows PowerShell 5.1. |
| `src/instalar-tudo.js` | plugin | Passos 6 e 7. Não pergunta nada que o script já perguntou; a única pergunta dele é a da barra. Executor (`execFile`), sistema de arquivos, `process.versions.node` e a entrada injetáveis para teste. |
| `acharCode` | `src/painel/instalar-painel.js` | No `darwin`, sem `code` no `PATH`, tenta `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code` e `~/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. Os dois caminhos passam no `caminhoSeguro` (espaço e `.` já são aceitos). |
| registro da falha | `src/painel/instalar-painel.js` | `tentativa.json` passa a guardar também `motivo` (da lista fixa) quando a instalação falha; sucesso grava `instalado.json` como hoje. |
| linha do início de sessão | `src/hooks/session-start.js` | Se `tentativa.json` tem `motivo` e `instalado.json` não tem a versão atual, uma linha: `claude-hadouken: item do VS Code não instalado (<motivo>); <conserto>.` Consertos fixos por motivo: `sem-vscode` → "no VS Code, rode Shell Command: Install 'code' command in PATH"; `tempo`/`erro` → "rode node ~/.claude/hadouken/bin/cli.mjs painel instalar". Com `HADOUKEN_SEM_PAINEL=1`, nenhuma linha. |
| README (pt e en) | raiz | Os dois comandos no topo da Instalação; a seção manual fica como alternativa; o requisito do `code` diz que no Mac o plugin acha o VS Code em `/Applications` sozinho. A linha 1273 (v0.6.0 = avisos no Pipa) fica para a spec da v0.6.0. |

Não entra: criar o link `/usr/local/bin/code` no Mac (pediria `sudo` nos Macs
com chip Apple e o `acharCode` novo dispensa); instalar o VS Code; publicar no
npm.

## Atualização automática

Pedido do Sr. Garioli: "Garanta que o plugin sempre mantenha atualizados
tudo o que faz parte dele (inclusive as skills) automaticamente." Decisões
dele: "testado, mas automático"; os terceiros passam a ser listados no
marketplace do Hadouken com `sha` fixo; o robô semanal faz merge e tag
sozinho quando a suíte passa.

Fatos do Claude Code (docs de plugins, conferidos em 2026-10-15):

- Um marketplace de terceiros não se atualiza sozinho por padrão. Liga com
  `autoUpdate: true` na entrada dele em `extraKnownMarketplaces` de um
  settings (essa chave vence a de `known_marketplaces.json`). Com ela, depois
  da primeira mensagem de uma sessão interativa, o Claude Code atualiza o
  marketplace e os plugins dele; a versão nova vale na sessão seguinte.
- A versão de um plugin é a do `plugin.json` dele; sem ela, a da entrada;
  sem as duas, o commit (12 caracteres) de uma fonte `github` ou
  `git-subdir`. Entrada `github`/`git-subdir` aceita `sha` (40 hex
  minúsculos), que o Claude Code usa no checkout.
- `DISABLE_AUTOUPDATER=1`, `DISABLE_UPDATES=1` ou
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` desligam a passada inteira.

### As peças

1. **`marketplace.json` do Hadouken lista os terceiros**, sem copiar nada:

   | Entrada | Fonte |
   |---|---|
   | `mattpocock-skills` | `{"source":"github","repo":"mattpocock/skills","sha":"<40 hex>"}` |
   | `poka-yoke` | `{"source":"git-subdir","url":"rainmanjam/poka-yoke","path":"plugins/poka-yoke","sha":"<40 hex>"}` |
   | `fullstack-dev-skills` | `{"source":"github","repo":"jeffallan/claude-skills","sha":"<40 hex>"}` |
   | `ui-ux-pro-max` | `{"source":"github","repo":"nextlevelbuilder/ui-ux-pro-max-skill","sha":"<40 hex>"}` |

   Os `sha` iniciais são os que o Sr. Garioli já usa (as versões de
   `kit/testado.json`). As dependências do `hadouken-kit` passam a ser só
   nomes (`"mattpocock-skills"` etc., resolvidos no próprio marketplace),
   menos o `superpowers`, que segue em `claude-plugins-official`;
   `allowCrossMarketplaceDependenciesOn` fica só com
   `claude-plugins-official`. `kit/testado.json` passa a usar as chaves
   novas (`mattpocock-skills@claude-hadouken`...).
2. **O instalador liga a atualização** (fora de sessão, sem esbarrar na
   guarda): grava `extraKnownMarketplaces["claude-hadouken"]` com
   `source {"source":"github","repo":"Garioli-Labs/claude-hadouken"}` e
   `autoUpdate: true` no `settings.json` do usuário, com backup, pelo mesmo
   gravador seguro da barra (`configuracao.js`), preservando o que já existe
   na entrada. No mesmo arquivo, põe `false` em `enabledPlugins` para as
   cópias antigas que estiverem `true` (`mattpocock-skills@mattpocock`,
   `poka-yoke@poka-yoke`, `fullstack-dev-skills@fullstack-dev-skills`,
   `ui-ux-pro-max@ui-ux-pro-max-skill`), para as skills não aparecerem em
   dobro. Não desinstala nada: desfazer é pôr `true` de volta. Quem já tem o
   Hadouken migra rodando o comando único uma vez.
3. **O robô semanal** (`.github/workflows/kit-atualizar.yml`, no lugar do
   `kit-versoes.yml`), segunda 09:17 UTC e sob demanda:
   1. para cada terceiro, lê o commit do branch padrão e a versão do
      `plugin.json` naquele commit; muda alguma coisa só quando a versão
      sobe (commit novo com a mesma versão não chegaria ao usuário);
   2. para o `rea-agents`, a versão `latest` do npm;
   3. com algo novo, num branch `robo/kit-<data>`: troca os `sha` no
      `marketplace.json`, a versão em `rea/lancar.mjs`, atualiza
      `kit/testado.json`, sobe o patch do `hadouken-kit` (e do
      `hadouken-rea`, se o REA mudou) em `plugin.json` e `marketplace.json`;
   4. roda `node --test` no Node 20, 22 e 24 (ubuntu, windows e macos);
   5. tudo verde: merge rápido na `main`, tag `kit-v<versão>` e release, pelo
      `GITHUB_TOKEN` com `contents: write`; algum vermelho: issue com o
      título `robô: <o que mudou>` (sem duplicar) e nada publicado;
   6. versão principal nova de um terceiro também passa pelo teste; a
      issue só aparece se falhar;
   7. o robô só mexe nesses arquivos; o código do `claude-hadouken` nunca.
4. **Ficam de fora:** o `superpowers` (o marketplace oficial já se atualiza
   sozinho e fixa o commit), o próprio Claude Code, os outros marketplaces do
   usuário, o `yu-ux-web-expert` (é do Sr. Garioli, sem fonte externa) e o
   `graphify` empacotado, que depende do pacote `graphifyy==0.9.25` do pip:
   versão nova dele continua só abrindo issue.

### Riscos aceitos

- O robô publica código de terceiros sem revisão humana. A trava é a suíte
  (que confere o mapa do fluxo contra as skills de cada terceiro) e o `sha`
  fixo: o que chega ao usuário é exatamente o commit testado. Vai para o
  SECURITY.md.
- Push na `main` pelo `GITHUB_TOKEN` não dispara outros workflows; por isso
  o robô roda a suíte ele mesmo antes do merge.

## Falhas

- Cada passo é independente: sem VS Code, o item fica de fora e o resto
  instala; REA com Node antigo fica desligado e o resumo diz por quê.
- Param tudo, com a mensagem e o comando para resolver: Node ausente sem
  winget/brew (ou recusado), `claude` que não instala, `claude plugin install
  claude-hadouken` que falha, pasta do plugin não encontrada no cache.
- O texto que vem de fora (saída do `claude`, do `winget`, do `brew`) não é
  repetido no resumo; o resumo usa rótulos fixos e o código de saída.
- Nenhum segredo é lido ou gravado. O script não usa `sudo`.

## Testes

- `test/instalar-tudo.test.js`: instalação nova; segunda rodada sem
  mudança (`= já estava` em tudo); outra barra, com e sem
  `--substituir-barra`; sem `code`; REA com Node 20 (desliga e marca
  pulado); falha de um passo não derruba os seguintes; código de saída.
- `acharCode`: `.app` em `/Applications`, em `~/Applications`, nenhum, e o
  `PATH` vencendo os dois; no win32 nada muda.
- `instalar-painel`: o `motivo` em `tentativa.json` para cada falha, e
  nenhum `motivo` depois de um sucesso.
- início de sessão: uma linha por motivo; nenhuma com sucesso, sem
  tentativa, ou com `HADOUKEN_SEM_PAINEL=1`.
- scripts: `bash -n install.sh` e o parser do PowerShell
  (`[System.Management.Automation.Language.Parser]::ParseFile`) na suíte; o
  `install.sh` com `claude`, `node`, `brew` e `git` falsos num `PATH`
  temporário, conferindo a ordem dos comandos, o `--sim` e a parada sem
  Node; o `install.ps1` com o mesmo teste, rodado só no win32 (CI do
  Windows).
- aprendizado: não perguntado com `--sim`; ligado com `--com-aprendizado`
  ou com "s" (o `ligar` falso recebe o código da `previa`); "n" e sem tty
  deixam desligado; já ligado é `= já estava`; falha do `ligar` vira `✗`
  sem derrubar os outros itens.
- atualização automática: `extraKnownMarketplaces` gravado com
  `autoUpdate: true` e backup, preservando outras chaves da entrada e do
  arquivo; segunda rodada não regrava; cópias antigas `true` viram `false`,
  as ausentes não entram, as já `false` ficam; recusas do gravador
  (settings inválido, link, somente leitura) viram `✗` com o motivo.
- marketplace: cada terceiro com fonte `github`/`git-subdir` e `sha` de 40
  hex; dependências do kit só por nome, menos o `superpowers`;
  `allowCrossMarketplaceDependenciesOn` igual a `["claude-plugins-official"]`;
  `kit/testado.json` com as chaves novas e as mesmas versões.
- robô: as funções puras do script (decidir o que mudou a partir de
  versões lidas, reescrever `marketplace.json`, `testado.json`,
  `rea/lancar.mjs` e as versões, título da issue) com `node:test`, sem rede;
  o workflow conferido por texto (permissões mínimas por job, ações fixadas
  por sha, matriz de três sistemas e três Nodes antes do job de merge).
- prova real: o `install.ps1 --sim` na máquina do Sr. Garioli com
  `CLAUDE_CONFIG_DIR` numa pasta vazia, sem tocar no `~/.claude` dele. O
  Mac fica com o irmão rodando o comando.

## Versões

claude-hadouken 0.5.2 (`plugin.json`, `package.json`, `marketplace.json`);
hadouken-kit 1.1.0 (dependências novas). REA não muda.

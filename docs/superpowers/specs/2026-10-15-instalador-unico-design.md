# v0.5.2: instalador de um comando e correções do Mac

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
4. **Marketplaces e plugins**, os mesmos comandos do README de hoje:
   `claude plugin marketplace add` do Garioli-Labs/claude-hadouken (e
   `update`), dos cinco marketplaces das dependências do kit, e
   `claude plugin install` de claude-hadouken, hadouken-kit e hadouken-rea,
   mais `claude plugin enable hadouken-rea@claude-hadouken`. Já instalado:
   `claude plugin update` no lugar do install.
5. **Acha a pasta do plugin** no cache do Claude Code
   (`<CLAUDE_CONFIG_DIR ou ~/.claude>/plugins/cache/claude-hadouken/claude-hadouken/<versão>/`,
   a maior versão N.N.N) e roda `node <pasta>/src/instalar-tudo.js` com as
   opções.
6. **`instalar-tudo.js`:**
   - barra: o `instalar --aplicar` de hoje (`instalar-cli.js`); com outra
     barra, pergunta "substituir?" com "não" como padrão (`--sim` responde
     não; só `--substituir-barra` troca);
   - item do VS Code: `instalarPainel` de hoje, já com o `acharCode` novo;
   - REA: com Node abaixo de 22.19 (e fora de 24.11+ e 26+), roda
     `claude plugin disable hadouken-rea@claude-hadouken` e marca como
     pulado, com o motivo;
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
- prova real: o `install.ps1 --sim` na máquina do Sr. Garioli com
  `CLAUDE_CONFIG_DIR` numa pasta vazia, sem tocar no `~/.claude` dele. O
  Mac fica com o irmão rodando o comando.

## Versões

claude-hadouken 0.5.2 (`plugin.json`, `package.json`, `marketplace.json`).
Kit e REA não mudam.

# Política de segurança

*English version below.*

## Versões com suporte

Só a versão mais recente, a última release publicada, recebe correções de segurança. Atualize para ela antes de relatar.

| Versão | Suporte |
|---|---|
| Última release | sim |
| Qualquer versão anterior | não |

## Como relatar uma vulnerabilidade

Use o relato privado de vulnerabilidades do GitHub: aba **Security** deste repositório → **Report a vulnerability**. Nunca relate uma vulnerabilidade por issue, pull request ou discussão pública.

Ajuda incluir a versão do plugin, o sistema operacional, a versão do Node, os passos para reproduzir e o impacto. Use só dados sintéticos: não anexe transcripts reais, caminhos pessoais, credenciais nem tokens de acesso.

## Prazo de resposta

Confirmamos o recebimento em até 7 dias.

## Escopo

O código do plugin neste repositório: `src/`, `hooks/`, `skills/`, `.claude-plugin/`, `bench/` e `.github/`. O Claude Code, o `gh`, o Node.js e o GitHub têm canais próprios e ficam fora deste escopo.

A garantia do plugin (spec, seção 8.1): nenhum dado lido por ele vira código executado, comando de shell, caminho de API arbitrário, sequência de terminal ou instrução com a autoridade do plugin no contexto do Claude. Isso vale para os arquivos em `~/.claude/hadouken/`, os transcripts, o JSON da statusline, o stdin dos hooks, as respostas do GitHub e os argumentos de skill.

Resumo do modelo de ameaças:

- **S1, arquivo de dados adulterado** (`estado.json`, `alertas.json`, `config.json`, `historico.jsonl`, índices) para injetar texto no contexto do Claude pelos hooks. O texto injetado é montado só com números finitos validados e rótulos de listas fixas do código. Arquivo fora do schema vira "sem leitura".
- **S2, texto malicioso** em transcripts, nomes de projeto, modelo, effort, repos ou campos do GitHub mostrados no `/consumo`. Um saneamento único (`sanear`) remove caracteres de controle, sequências ANSI/OSC, `|`, crases e quebras de linha, e limita o texto a 64 caracteres. O effort só é aceito de uma lista fixa, e o relatório declara que esses campos são dado, não instrução.
- **S3, sequências de terminal** (ANSI/OSC, como links ou títulos falsos) chegando à barra por `model.display_name` ou outro campo. Todo texto externo passa por `sanear` antes de ser impresso; as únicas sequências ANSI da barra são as cores fixas do código.
- **S4, injeção de shell pelos argumentos de `/claude-hadouken:consumo`.** A skill nunca repassa `$ARGUMENTS`: roda um de dois comandos fixos, com ou sem `--json`, e a CLI ignora qualquer outro argumento.
- **S5, repo malicioso em `config.json`** (por exemplo `../../user` ou argumentos extras). Só é aceito `dono/repo` que case `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, sem `..`. O `gh` é chamado por `execFile`, nunca por um shell.
- **S6, shim adulterado** em `~/.claude/hadouken/bin/` para executar outro código. O hook SessionStart reescreve os shims a cada sessão a partir do conteúdo esperado, e os shims não leem nada de fora.
- **S7, instalador acionado por outra skill ou pelo modelo** sem o usuário saber. `/claude-hadouken:instalar` tem `disable-model-invocation: true`, pede confirmação explícita antes de gravar e grava só a chave `statusLine`, com backup.
- **S8, cadeia de suprimentos.** Zero dependências; CI com `permissions: contents: read`, actions fixadas por SHA de commit e Dependabot semanal.
- **S9, arquivo gigante ou malformado** para travar um hook ou a barra. A leitura tem limites de tamanho (arquivos de estado até 1 MB; linha de transcript acima de 5 MB é ignorada), os hooks têm prazo e sempre terminam com código 0.

**Limite honesto:** uma skill ou um programa malicioso que já executa código como o mesmo usuário do sistema pode alterar qualquer arquivo desse usuário, inclusive o `settings.json` e o próprio plugin. Nenhum plugin impede isso. O que este plugin garante é não ampliar esse poder e desfazer, a cada sessão, adulterações dos seus shims.

## O que o plugin nunca faz

- **Rede:** o plugin não abre conexão própria. A única saída para a rede é `gh api` somente leitura: o comando é sempre `gh api <endpoint>`, sem `-f`, `-F`, `--input` nem `--method`, portanto sempre GET. Quem o chama é o relatório `/claude-hadouken:consumo`, para os repos listados em `~/.claude/hadouken/config.json`. Se nenhum repo estiver configurado ali, ele usa o repo do remoto `origin` da pasta atual, lido localmente com `git remote get-url origin`, que não acessa a rede. São no máximo 3 repos por chamada, com cache de 15 minutos.
- **Telemetria:** nenhuma. Nada é enviado a nenhum serviço, nem ao autor do plugin.
- **Tokens e credenciais:** o plugin não lê, não registra e não guarda token ou credencial de acesso. O login do GitHub pertence ao `gh`, e o ambiente do processo passa ao `gh` sem que o plugin examine os valores das variáveis. Os "tokens" do relatório são contagens de uso lidas dos transcripts. Dos transcripts, o índice guarda só o caminho relativo de cada arquivo, ids de sessão e de requisição, números, datas, modelo, effort e o nome do projeto.
- **Gravação fora de `~/.claude/hadouken/`:** o plugin só grava dentro de `~/.claude/hadouken/`, ou da pasta indicada por `HADOUKEN_HOME` quando essa variável, usada pelos testes, está definida. A única exceção é `~/.claude/settings.json` (ou o arquivo indicado por `HADOUKEN_SETTINGS`, também só dos testes), que só muda quando o comando do instalador roda com `--aplicar`, ou com `--remover` para desfazer, e nesse caso só a chave `statusLine` muda. O caminho documentado para isso é `/claude-hadouken:instalar`, que o modelo não pode acionar e que pede confirmação explícita antes de gravar. Junto com o `settings.json`, na mesma pasta `~/.claude/`, o instalador cria um backup (`settings.json.bak-hadouken-<instante em ms>`, modo 0600; guarda os 5 mais recentes e apaga os seus mais antigos) e um temporário da troca atômica (`settings.json.hadouken-<hex>.tmp`, removido logo em seguida). Se `~/.claude/` não existir, ele a cria.

O plugin lê, sem gravar: os transcripts em `~/.claude/projects/` (ou `$CLAUDE_CONFIG_DIR/projects`), o JSON que o Claude Code entrega à statusline e o stdin dos hooks.

---

# Security policy (English)

## Supported versions

Only the latest version, the most recent published release, receives security fixes. Please update to it before reporting.

| Version | Supported |
|---|---|
| Latest release | yes |
| Any earlier version | no |

## Reporting a vulnerability

Use GitHub private vulnerability reporting: the **Security** tab of this repository → **Report a vulnerability**. Never report a vulnerability in a public issue, pull request or discussion.

It helps to include the plugin version, operating system, Node version, steps to reproduce and the impact. Use synthetic data only: do not attach real transcripts, personal paths, credentials or access tokens.

## Response target

We acknowledge every report within 7 days.

## Scope

The plugin code in this repository: `src/`, `hooks/`, `skills/`, `.claude-plugin/`, `bench/` and `.github/`. Claude Code, `gh`, Node.js and GitHub have their own channels and are out of scope.

The plugin's guarantee (spec, section 8.1): no data it reads ever becomes executed code, a shell command, an arbitrary API path, a terminal sequence or an instruction carrying the plugin's authority in Claude's context. This covers the files in `~/.claude/hadouken/`, transcripts, the status line JSON, hook stdin, GitHub responses and skill arguments.

Threat model summary:

- **S1, tampered data file** (`estado.json`, `alertas.json`, `config.json`, `historico.jsonl`, indexes) used to inject text into Claude's context through a hook. Injected text is built only from validated finite numbers and labels from fixed lists in the code. A file that fails its schema reads as "sem leitura" (no reading).
- **S2, malicious text** in transcripts, project names, model, effort, repos or GitHub fields shown by `/consumo`. A single sanitiser (`sanear`) strips control characters, ANSI/OSC sequences, `|`, backticks and line breaks, and caps the text at 64 characters. Effort is accepted only from a fixed list, and the report states that these fields are data, not instructions.
- **S3, terminal sequences** (ANSI/OSC, such as fake links or titles) reaching the status bar through `model.display_name` or another field. All external text goes through `sanear` before it is printed; the only ANSI sequences in the bar are the fixed colours in the code.
- **S4, shell injection through the arguments of `/claude-hadouken:consumo`.** The skill never forwards `$ARGUMENTS`: it runs one of two fixed commands, with or without `--json`, and the CLI ignores any other argument.
- **S5, malicious repo in `config.json`** (for example `../../user` or extra arguments). Only `owner/repo` matching `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, without `..`, is accepted. `gh` is called through `execFile`, never through a shell.
- **S6, tampered shim** in `~/.claude/hadouken/bin/` to run other code. The SessionStart hook rewrites the shims on every session from their expected content, and the shims read nothing from outside.
- **S7, installer triggered by another skill or by the model** without the user knowing. `/claude-hadouken:instalar` has `disable-model-invocation: true`, asks for explicit confirmation before writing and writes only the `statusLine` key, with a backup.
- **S8, supply chain.** Zero dependencies; CI with `permissions: contents: read`, actions pinned to commit SHAs and weekly Dependabot updates.
- **S9, huge or malformed file** meant to stall a hook or the bar. Reads have size limits (state files up to 1 MB; a transcript line above 5 MB is skipped), hooks have deadlines and always exit with code 0.

**Honest limit:** a malicious skill or program that already runs code as the same OS user can change any file of that user, including `settings.json` and the plugin itself. No plugin can prevent that. This plugin guarantees that it does not widen that power, and that it undoes tampering with its shims on every session.

## What the plugin never does

- **Network:** the plugin opens no connection of its own. Its only network access is read-only `gh api`: the command is always `gh api <endpoint>`, without `-f`, `-F`, `--input` or `--method`, so it is always a GET. It is run by the `/claude-hadouken:consumo` report, for the repos listed in `~/.claude/hadouken/config.json`. If no repo is configured there, it uses the repo of the `origin` remote of the current folder, read locally with `git remote get-url origin`, which does not touch the network. At most 3 repos per call, with a 15-minute cache.
- **Telemetry:** none. Nothing is sent to any service, including the plugin's author.
- **Tokens and credentials:** the plugin never reads, logs or stores an access token or credential. The GitHub login belongs to `gh`, and the process environment is passed to `gh` without the plugin examining variable values. The "tokens" in the report are usage counts read from transcripts. From transcripts, the index keeps only each file's relative path, session and request ids, numbers, dates, model, effort and the project name.
- **Writes outside `~/.claude/hadouken/`:** the plugin writes only inside `~/.claude/hadouken/`, or the folder named by `HADOUKEN_HOME` when that variable, used by the tests, is set. The single exception is `~/.claude/settings.json` (or the file named by `HADOUKEN_SETTINGS`, also for tests only), which changes only when the installer command runs with `--aplicar`, or with `--remover` to undo it, and then only the `statusLine` key changes. The documented path for this is `/claude-hadouken:instalar`, which the model cannot trigger and which asks for explicit confirmation before writing. Next to `settings.json`, in the same `~/.claude/` folder, the installer creates a backup (`settings.json.bak-hadouken-<time in ms>`, mode 0600; it keeps the 5 most recent and deletes its older ones) and a temporary file for the atomic swap (`settings.json.hadouken-<hex>.tmp`, removed right away). If `~/.claude/` does not exist, it creates it.

The plugin reads, without writing: the transcripts in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects`), the JSON Claude Code hands to the status line, and hook stdin.

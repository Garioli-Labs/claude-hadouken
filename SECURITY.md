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

- **S1, arquivo de dados adulterado** (`estado.json`, `alertas.json`, `projecao.json`, `config.json`, `historico.jsonl`, índices) para injetar texto no contexto do Claude pelos hooks. O texto injetado é montado só com números finitos validados e rótulos de listas fixas do código. Arquivo fora do schema vira "sem leitura". Desde a v0.2.0 (spec §12.7): o histórico de leituras do `estado.json` é validado ponto a ponto (no máximo 90 pontos, `at` entre 3 horas atrás e 5 minutos à frente, porcentagens de 0 a 100; o resto é descartado, e um histórico que não é lista vira lista vazia); a previsão só sai com pelo menos 3 pontos em 6 minutos, inclinação positiva e finita e instante antes do reset; o número de sessões ativas só conta ids válidos, nunca passa de 50 e só aparece como inteiro; a memória de projeção fica num arquivo só dela, o `projecao.json`, que guarda no máximo 256 sessões, só aceita ids válidos e faixas da lista fixa, é gravado de forma atômica e só quando muda, e nunca é criado vazio; conteúdo hostil nele (arquivo acima de 1 MB, chaves como `__proto__` ou `constructor`, tipos errados, faixa fora da lista, instante de reset que não é número finito entre 0 e 10¹¹ s, texto com instrução) faz o arquivo valer como vazio (o lado seguro: a faixa atual é anunciada de novo) até ser regravado limpo; e o aviso de projeção leva só números validados e texto fixo.
- **S2, texto malicioso** em transcripts, nomes de projeto, ids de sessão, modelo, effort, repos ou campos do GitHub mostrados no `/consumo`. Um saneamento único (`sanear`) remove caracteres de controle, sequências ANSI/OSC, `|`, crases e quebras de linha, e limita o texto a 64 caracteres. O effort só é aceito de uma lista fixa, e o relatório declara que esses campos são dado, não instrução. O nome curto do modelo (`Opus 5.5`, v0.2.0) só sai de um nome saneado que casa um padrão fixo, ancorado nas duas pontas; é só exibição e não muda somas, chaves nem o `--json`. A seção "Sessões abertas (última hora)" (v0.2.0) usa a mesma limpeza das outras tabelas, e o markdown revalida item a item a lista `sessoesAbertas` do JSON antes de mostrá-la.
- **S3, sequências de terminal** (ANSI/OSC, como links ou títulos falsos) chegando à barra por `model.display_name` ou outro campo. Todo texto externo passa por `sanear` antes de ser impresso; as únicas sequências ANSI da barra são as cores fixas do código. Os nomes externos perdem também os glifos que a barra desenha (`│`, `·`, `↻` e, desde a v0.2.0, `▰`, `▱`, `┃` e `→`), para nenhum nome forjar um separador, uma barrinha, a marca do ritmo ou uma previsão; o painel de limites do relatório só tem números validados e rótulos do código.
- **S4, injeção de shell pelos argumentos de `/claude-hadouken:consumo`.** A skill nunca repassa `$ARGUMENTS`: roda um de dois comandos fixos, com ou sem `--json`, e a CLI ignora qualquer outro argumento.
- **S5, repo malicioso em `config.json`** (por exemplo `../../user` ou argumentos extras). Só é aceito `dono/repo` que case `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, sem `..`. O `gh` é chamado por `execFile`, nunca por um shell.
- **S6, shim adulterado** em `~/.claude/hadouken/bin/` para executar outro código. O hook SessionStart reescreve os shims a cada sessão a partir do conteúdo esperado, e os shims não leem nada de fora.
- **S7, instalador acionado por outra skill ou pelo modelo** sem o usuário saber. `/claude-hadouken:instalar` tem `disable-model-invocation: true`, pede confirmação explícita antes de gravar e grava só a chave `statusLine`, com backup.
- **S8, cadeia de suprimentos.** Zero dependências; CI com `permissions: contents: read`, actions fixadas por SHA de commit e Dependabot semanal.
- **S9, arquivo gigante ou malformado** para travar um hook ou a barra. A leitura tem limites de tamanho (arquivos de estado até 1 MB; linha de transcript acima de 5 MB é ignorada), os hooks têm prazo e sempre terminam com código 0.
- **S26, o painel executa `claude`** (v0.3.0). Para ler o `/usage`, o painel roda `claude -p /usage` em modo enxuto, sem plugins, MCP, hooks nem persistência de sessão. O executável é procurado só em `~/.local/bin/` e nos diretórios do `PATH` (no Windows, só `claude.exe`, nunca `.cmd` ou `.bat`) e chamado por `execFile`, sem shell. Os argumentos são fixos, a saída tem teto de 64 KiB e o tempo, de 30 s. No prazo, o plugin mata a árvore inteira do processo (no Windows, `taskkill /t /f` do System32), e a leitura seguinte espera 15 min, como depois de qualquer falha (formato inesperado, erro). Da saída só saem números, por regex ancorada. Se o resultado indicar custo (`num_turns` ou `total_cost_usd` diferente de zero, ou ausente), a leitura para por 24 h. Com zero turnos e custo zero, uma resposta que não venha do comando `usage` é só "formato inesperado".
- **S27, o instalador executa o CLI do VS Code** (v0.3.0). O SessionStart dispara em segundo plano `code --install-extension <vsix> --force`, com o `code` achado no `PATH` e o caminho do `.vsix` validado pelo mesmo conjunto de caracteres do instalador da barra. No Windows passa por `cmd.exe /d /s /c`, com o `cmd.exe` do System32 por caminho absoluto e os dois caminhos entre aspas. O `.vsix` é montado pelo próprio plugin só com os arquivos de `vscode/`; os de versões anteriores são apagados depois de uma instalação boa. `HADOUKEN_SEM_PAINEL=1` desliga a instalação.
- **S28, `uso-oficial.json` adulterado** (v0.3.0). A leitura valida o schema (versão 1, porcentagens finitas de 0 a 100, instantes legíveis, só a chave `fable` em `modelos`). Fora disso, o arquivo vale como "sem leitura". O painel mostra só rótulos fixos e números.

**Regra de compatibilidade** (v0.2.0): dado novo vai sempre para um arquivo novo, nunca para uma chave nova num arquivo que uma versão anterior valida com formato estrito. A v0.1.0 trata um `alertas.json` com uma chave a mais como inválido e o regrava; com versões misturadas (uma sessão aberta antes da atualização segue com os hooks da versão anterior), as duas repetiriam avisos uma à outra. Por isso a memória de projeção mora no `projecao.json`, que a v0.1.0 não conhece, e o `alertas.json` mantém o formato exato da v0.1.0.

**Limite honesto:** uma skill ou um programa malicioso que já executa código como o mesmo usuário do sistema pode alterar qualquer arquivo desse usuário, inclusive o `settings.json` e o próprio plugin. Nenhum plugin impede isso. O que este plugin garante é não ampliar esse poder e desfazer, a cada sessão, adulterações dos seus shims.

## O que o plugin nunca faz

- **Rede:** o plugin não abre conexão própria. A única saída para a rede é `gh api` somente leitura: o comando é sempre `gh api <endpoint>`, sem `-f`, `-F`, `--input` nem `--method`, portanto sempre GET. Quem o chama é o relatório `/claude-hadouken:consumo`, para os repos listados em `~/.claude/hadouken/config.json`. Se nenhum repo estiver configurado ali, ele usa o repo do remoto `origin` da pasta atual, lido localmente com `git remote get-url origin`, que não acessa a rede. São no máximo 3 repos por chamada, com cache de 15 minutos. Desde a v0.3.0, o painel do VS Code roda `claude -p /usage` (S26): quem fala com a Anthropic é o próprio Claude Code, pelo comando oficial dele, com a sua sessão. O plugin não lê a credencial, não chama endpoint nenhum e não gasta tokens: o `/usage` é comando local, sem modelo.
- **Telemetria:** nenhuma. Nada é enviado a nenhum serviço, nem ao autor do plugin.
- **Tokens e credenciais:** o plugin não lê, não registra e não guarda token ou credencial de acesso. O login do GitHub pertence ao `gh`, e o ambiente do processo passa ao `gh` sem que o plugin examine os valores das variáveis. Os "tokens" do relatório são contagens de uso lidas dos transcripts. Dos transcripts, o índice guarda só o caminho relativo de cada arquivo, ids de sessão e de requisição, números, datas, modelo, effort e o nome do projeto.
- **Gravação fora de `~/.claude/hadouken/`:** o plugin só grava dentro de `~/.claude/hadouken/`, ou da pasta indicada por `HADOUKEN_HOME` quando essa variável está definida (veja "Variáveis de ambiente", abaixo). A única exceção é `~/.claude/settings.json` (ou o arquivo indicado por `HADOUKEN_SETTINGS`, quando definida), que só muda quando o comando do instalador roda com `--aplicar`, ou com `--remover` para desfazer, e nesse caso só a chave `statusLine` muda. O caminho documentado para isso é `/claude-hadouken:instalar`, que o modelo não pode acionar e que pede confirmação explícita antes de gravar. Junto com o `settings.json`, na mesma pasta `~/.claude/`, o instalador cria um backup (`settings.json.bak-hadouken-<instante em ms>`, modo 0600; guarda os 5 mais recentes e apaga os seus mais antigos) e um temporário da troca atômica (`settings.json.hadouken-<hex>.tmp`, removido logo em seguida). Se `~/.claude/` não existir, ele a cria. A outra exceção (v0.3.0) é a extensão do painel: o CLI do VS Code a instala na pasta de extensões dele (S27).

O plugin lê, sem gravar: os transcripts em `~/.claude/projects/` (ou `$CLAUDE_CONFIG_DIR/projects`), o JSON que o Claude Code entrega à statusline e o stdin dos hooks.

## Variáveis de ambiente

O ambiente da sessão do Claude Code é confiável. Quem o controla (o `env` do `settings.json` de um projeto, direnv, um devcontainer, o shell que abriu o Claude Code) já controla `PATH` e `NODE_OPTIONS`, e com eles qualquer programa que a sessão roda; isso fica fora do escopo. As variáveis abaixo valem sempre que estão definidas, não só nos testes do plugin, e de caminho só aceitam um caminho absoluto completo (no Windows, com letra de unidade ou UNC):

- `HADOUKEN_HOME`: a pasta de dados, no lugar de `~/.claude/hadouken/`; tudo o que o plugin grava, inclusive os shims em `bin/`, vai para ela. Definida com qualquer outro valor (relativo, vazio, só espaços; no Windows, também `\pasta` ou `C:pasta`), o plugin fica sem pasta de dados: a barra e os hooks não gravam nada, o `/claude-hadouken:consumo` só lê, o instalador recusa com o motivo `pasta-dados-invalida`, e a pasta padrão nunca é usada no lugar. Antes de gravar, o instalador mostra a pasta e de onde ela vem (`pastaDados` e `origemPastaDados`), e a skill `/claude-hadouken:instalar` avisa quando ela vem desta variável: a barra gravada no `settings.json` aponta para essa pasta em todo projeto. O mesmo vale para a recusa quando o `settings.json` é um link: a chave `manual` que ela oferece para colar à mão aponta para essa pasta.
- `HADOUKEN_SETTINGS`: o `settings.json` que o instalador edita, no lugar de `<CLAUDE_CONFIG_DIR>/settings.json` ou `~/.claude/settings.json`. Definida com qualquer outro valor, o instalador recusa com o motivo `hadouken-settings-invalido` e nunca cai no arquivo padrão.
- `HADOUKEN_TESTE_GH`: só o valor exato `ausente` tem efeito: o `/claude-hadouken:consumo` não chama o `gh`, e a seção do GitHub sai indisponível. Os testes do plugin a usam. Qualquer outro valor é ignorado, e nenhum valor dela vira programa: o `gh` é sempre o achado no `PATH`, por caminho absoluto.
- `HADOUKEN_SEM_PAINEL`: com o valor exato `1`, o SessionStart não instala nem atualiza a extensão do painel no VS Code (v0.3.0). Se a variável estiver no ambiente do próprio VS Code, a extensão já instalada também para de rodar o `/usage`. Para tirar o painel de vez: `code --uninstall-extension gariolilabs.claude-hadouken-painel` e recarregar a janela.

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

- **S1, tampered data file** (`estado.json`, `alertas.json`, `projecao.json`, `config.json`, `historico.jsonl`, indexes) used to inject text into Claude's context through a hook. Injected text is built only from validated finite numbers and labels from fixed lists in the code. A file that fails its schema reads as "sem leitura" (no reading). Since v0.2.0 (spec §12.7): the reading history in `estado.json` is validated point by point (at most 90 points, `at` between 3 hours ago and 5 minutes ahead, percentages from 0 to 100; the rest is dropped, and a history that is not a list becomes an empty list); the forecast only comes out with at least 3 points over 6 minutes, a positive finite slope and an instant before the reset; the active session count only counts valid ids, never goes above 50 and only shows as a whole number; the projection memory lives in a file of its own, `projecao.json`, which keeps at most 256 sessions, only accepts valid ids and bands from the fixed list, is written atomically and only when it changes, and is never created empty; hostile content in it (a file above 1 MB, keys such as `__proto__` or `constructor`, wrong types, a band outside the list, a reset instant that is not a finite number between 0 and 10¹¹ s, instruction text) makes the file count as empty (the safe side: the current band is announced again) until it is rewritten clean; and the projection notice carries only validated numbers and fixed text.
- **S2, malicious text** in transcripts, project names, session ids, model, effort, repos or GitHub fields shown by `/consumo`. A single sanitiser (`sanear`) strips control characters, ANSI/OSC sequences, `|`, backticks and line breaks, and caps the text at 64 characters. Effort is accepted only from a fixed list, and the report states that these fields are data, not instructions. The model's short name (`Opus 5.5`, v0.2.0) only comes from a sanitised name matching a fixed pattern anchored at both ends; it is display only and changes no sums, keys or `--json`. The "open sessions in the last hour" section (v0.2.0) uses the same cleaning as the other tables, and the markdown revalidates the JSON `sessoesAbertas` list item by item before showing it.
- **S3, terminal sequences** (ANSI/OSC, such as fake links or titles) reaching the status bar through `model.display_name` or another field. All external text goes through `sanear` before it is printed; the only ANSI sequences in the bar are the fixed colours in the code. External names also lose the glyphs the bar draws (`│`, `·`, `↻` and, since v0.2.0, `▰`, `▱`, `┃` and `→`), so no name can forge a separator, a bar, the pace mark or a forecast; the report's limits panel holds only validated numbers and labels from the code.
- **S4, shell injection through the arguments of `/claude-hadouken:consumo`.** The skill never forwards `$ARGUMENTS`: it runs one of two fixed commands, with or without `--json`, and the CLI ignores any other argument.
- **S5, malicious repo in `config.json`** (for example `../../user` or extra arguments). Only `owner/repo` matching `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, without `..`, is accepted. `gh` is called through `execFile`, never through a shell.
- **S6, tampered shim** in `~/.claude/hadouken/bin/` to run other code. The SessionStart hook rewrites the shims on every session from their expected content, and the shims read nothing from outside.
- **S7, installer triggered by another skill or by the model** without the user knowing. `/claude-hadouken:instalar` has `disable-model-invocation: true`, asks for explicit confirmation before writing and writes only the `statusLine` key, with a backup.
- **S8, supply chain.** Zero dependencies; CI with `permissions: contents: read`, actions pinned to commit SHAs and weekly Dependabot updates.
- **S9, huge or malformed file** meant to stall a hook or the bar. Reads have size limits (state files up to 1 MB; a transcript line above 5 MB is skipped), hooks have deadlines and always exit with code 0.
- **S26, the panel runs `claude`** (v0.3.0). To read `/usage`, the panel runs `claude -p /usage` in lean mode, without plugins, MCP, hooks or session persistence. The executable is looked up only in `~/.local/bin/` and the `PATH` directories (on Windows, only `claude.exe`, never `.cmd` or `.bat`) and called with `execFile`, without a shell. Arguments are fixed, output is capped at 64 KiB and time at 30 s. At the deadline the plugin kills the whole process tree (on Windows, `taskkill /t /f` from System32), and the next read waits 15 min, as after any failure (unexpected format, error). Only numbers leave the output, through anchored regexes. If the result shows a cost (`num_turns` or `total_cost_usd` other than zero, or missing), reading stops for 24 h. With zero turns and zero cost, a result that does not come from the `usage` command is only "unexpected format".
- **S27, the installer runs the VS Code CLI** (v0.3.0). SessionStart starts `code --install-extension <vsix> --force` in the background, with `code` found on `PATH` and the `.vsix` path checked against the same character set as the status bar installer. On Windows it goes through `cmd.exe /d /s /c`, with `cmd.exe` from System32 by absolute path and both paths quoted. The plugin builds the `.vsix` itself, only from the files in `vscode/`; those of earlier versions are deleted after a successful install. `HADOUKEN_SEM_PAINEL=1` turns installation off.
- **S28, tampered `uso-oficial.json`** (v0.3.0). Reading validates the schema (version 1, finite percentages from 0 to 100, readable instants, only the `fable` key in `modelos`). Anything else reads as "no reading". The panel shows only fixed labels and numbers.

**Compatibility rule** (v0.2.0): new data always goes into a new file, never into a new key of a file that an earlier version validates strictly. v0.1.0 treats an `alertas.json` with an extra key as invalid and rewrites it; with mixed versions (a session opened before the update keeps the previous version's hooks), the two would repeat notices to each other. That is why the projection memory lives in `projecao.json`, which v0.1.0 does not know, and `alertas.json` keeps the exact v0.1.0 format.

**Honest limit:** a malicious skill or program that already runs code as the same OS user can change any file of that user, including `settings.json` and the plugin itself. No plugin can prevent that. This plugin guarantees that it does not widen that power, and that it undoes tampering with its shims on every session.

## What the plugin never does

- **Network:** the plugin opens no connection of its own. Its only network access is read-only `gh api`: the command is always `gh api <endpoint>`, without `-f`, `-F`, `--input` or `--method`, so it is always a GET. It is run by the `/claude-hadouken:consumo` report, for the repos listed in `~/.claude/hadouken/config.json`. If no repo is configured there, it uses the repo of the `origin` remote of the current folder, read locally with `git remote get-url origin`, which does not touch the network. At most 3 repos per call, with a 15-minute cache. Since v0.3.0, the VS Code panel runs `claude -p /usage` (S26): Claude Code itself talks to Anthropic, through its own official command and your session. The plugin reads no credential, calls no endpoint and spends no tokens: `/usage` is a local command, with no model call.
- **Telemetry:** none. Nothing is sent to any service, including the plugin's author.
- **Tokens and credentials:** the plugin never reads, logs or stores an access token or credential. The GitHub login belongs to `gh`, and the process environment is passed to `gh` without the plugin examining variable values. The "tokens" in the report are usage counts read from transcripts. From transcripts, the index keeps only each file's relative path, session and request ids, numbers, dates, model, effort and the project name.
- **Writes outside `~/.claude/hadouken/`:** the plugin writes only inside `~/.claude/hadouken/`, or the folder named by `HADOUKEN_HOME` when that variable is set (see "Environment variables" below). The single exception is `~/.claude/settings.json` (or the file named by `HADOUKEN_SETTINGS`, when set), which changes only when the installer command runs with `--aplicar`, or with `--remover` to undo it, and then only the `statusLine` key changes. The documented path for this is `/claude-hadouken:instalar`, which the model cannot trigger and which asks for explicit confirmation before writing. Next to `settings.json`, in the same `~/.claude/` folder, the installer creates a backup (`settings.json.bak-hadouken-<time in ms>`, mode 0600; it keeps the 5 most recent and deletes its older ones) and a temporary file for the atomic swap (`settings.json.hadouken-<hex>.tmp`, removed right away). If `~/.claude/` does not exist, it creates it. The other exception (v0.3.0) is the panel extension, which the VS Code CLI installs into its own extensions folder (S27).

The plugin reads, without writing: the transcripts in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects`), the JSON Claude Code hands to the status line, and hook stdin.

## Environment variables

The Claude Code session environment is trusted. Whoever controls it (a project's `settings.json` `env`, direnv, a devcontainer, the shell that started Claude Code) already controls `PATH` and `NODE_OPTIONS`, and with them any program the session runs; that is out of scope. The variables below apply whenever they are set, not only in the plugin's tests, and as paths they accept only a complete absolute path (on Windows, with a drive letter or UNC):

- `HADOUKEN_HOME`: the data folder, instead of `~/.claude/hadouken/`; everything the plugin writes, the shims in `bin/` included, goes there. Set to any other value (relative, empty, blank; on Windows, also `\folder` or `C:folder`), it leaves the plugin without a data folder: the bar and the hooks write nothing, `/claude-hadouken:consumo` only reads, the installer refuses with reason `pasta-dados-invalida`, and the default folder is never used instead. Before writing, the installer shows the folder and where it came from (`pastaDados` and `origemPastaDados`), and the `/claude-hadouken:instalar` skill warns when it comes from this variable: the bar saved in `settings.json` points to that folder in every project. The same goes for the refusal when `settings.json` is a link: the `manual` key it offers to paste by hand points to that folder.
- `HADOUKEN_SETTINGS`: the `settings.json` the installer edits, instead of `<CLAUDE_CONFIG_DIR>/settings.json` or `~/.claude/settings.json`. Set to any other value, the installer refuses with reason `hadouken-settings-invalido` and never falls back to the default file.
- `HADOUKEN_TESTE_GH`: only the exact value `ausente` has an effect: `/claude-hadouken:consumo` does not call `gh`, and the GitHub section is reported as unavailable. The plugin's tests use it. Any other value is ignored, and no value of it ever becomes a program: `gh` is always the one found on `PATH`, by absolute path.
- `HADOUKEN_SEM_PAINEL`: with the exact value `1`, SessionStart neither installs nor updates the VS Code panel extension (v0.3.0). If the variable is in VS Code's own environment, an already installed extension also stops running `/usage`. To remove the panel for good: `code --uninstall-extension gariolilabs.claude-hadouken-painel` and reload the window.

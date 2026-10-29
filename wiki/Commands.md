# Commands

[Português](Comandos)

## Commands you type

All of them answer through a hook, before the model: they spend no tokens. The ones that change something accept only the typed command; Claude, a `claude -p` session or a scheduled task cannot use them.

| Command | What it does | Details |
|---|---|---|
| `/hadouken:consumo` | Usage report: 5-hour and 7-day limits with pace, tokens per project and per model·effort, cache and GitHub Actions. Claude also calls it when you ask. | [Usage report](Usage-report) |
| `/hadouken:liberar [Nh \| janela \| noite] [fable] [caro]` | Releases the guard for a while (`noite`: until 7 a.m.); `off` and `on` turn the guard off and back on. | [How to release](Usage-guard#how-to-release) |
| `/hadouken:limites [item value \| item padrao \| padrao]` | Shows and changes the limits of the guard, the status bar, the alerts, the protections and PC health. | [The /hadouken:limites command](Limits#the-hadoukenlimites-command) |
| `/hadouken:saude [leve \| normal]` | PC health and hadouken's own health: RAM, temperatures, battery, disk, hooks, repairs, compatibility, conflicts, data and savings; `leve` and `normal` turn light mode on (4 h) and off. | [PC health](PC-health#the-hadoukensaude-command) |
| `/hadouken:aprender [status \| ligar \| desligar \| desfazer \| aprovar \| recusar]` | Local learning. | [Learning](Learning#commands) |
| `/hadouken:instalar` | Adds the status bar to `settings.json`, showing the change and asking for confirmation. | [Home](Home-en#what-hadoukeninstalar-changes-and-how-to-undo-it) |

## In VS Code

| Command | What it does |
|---|---|
| `Claude Hadouken: abrir a janela` | Opens the [hadouken window](VS-Code-panel-and-window#the-hadouken-window), with every setting. Clicking the logo in the status bar does the same. |
| `Claude Hadouken: atualizar uso agora` | Reads `/usage` right away. Clicking the usage item does the same. |

## Agents Claude uses

hadouken ships ready-made agents, each with the cheapest model and effort that can do the job. The `roteamento` skill tells Claude which one to pick, and [routing](Usage-guard#model-and-effort-routing) checks the dispatch.

| Agent | Model · effort | For |
|---|---|---|
| `hadouken:busca` | Haiku · low | Finding files and symbols, reading and summarising excerpts; read-only. |
| `hadouken:mecanico` | Haiku · low | Mechanical edits with exact instructions. |
| `hadouken:pesquisa` | Sonnet · low | Checking docs, an API or a version on the web, with the source. |
| `hadouken:executor` | Sonnet · medium | Implementing a well-specified task, with tests. |
| `hadouken:revisor` | Opus · high | Reviewing a diff or plan; read-only. |
| `hadouken:revisor-critico` | Fable · xhigh | Security, authentication, money and decisions that are costly to undo. |

---

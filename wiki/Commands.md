# Commands

[Português](Comandos)

## Commands you type

All of them answer through a hook, before the model: they spend no tokens. The ones that change something accept only the typed command; Claude, a `claude -p` session or a scheduled task cannot use them.

| Command | What it does | Details |
|---|---|---|
| `/hadouken:consumo` | Usage report: 5-hour and 7-day limits with pace, tokens per project and per model·effort, cache and GitHub Actions. Claude also calls it when you ask. | [Usage report](Usage-report) |
| `/hadouken:liberar [Nh \| janela \| noite] [fable] [caro]` | Releases the guard for a while (`noite`: until 7 a.m.); `off` and `on` turn the guard off and back on. | [How to release](Usage-guard#how-to-release) |
| `/hadouken:limites [item value \| item padrao \| padrao]` | Shows and changes the limits of the guard, the status bar, the alerts, the protections and PC health. | [The /hadouken:limites command](Limits#the-hadoukenlimites-command) |
| `/hadouken:agentes [<agent> <model> [effort] \| <agent> off \| <agent> on \| <agent> padrao]` | With no argument, shows the effective palette: each agent with its default and what your config changed. `revisor opus high` changes model and effort, `auditor off` and `auditor on` turn it off and back on, `revisor padrao` goes back to the default. It writes only `agentes.<agent>` in `config.json`. | [Agents Claude uses](#agents-claude-uses) |
| `/hadouken:janela [seg-sex 9-21 \| seg,qua,sex 08:30-18:00 \| off]` | With no argument, shows the work window. With days and hours, saves the window; `off` removes it and the pace goes back to 168 hours. | [The work window](Usage-guard#the-work-window) |
| `/hadouken:saude [leve \| normal]` | PC health and hadouken's own health: RAM, temperatures, battery, disk, hooks, repairs, compatibility, conflicts, data and savings; `leve` and `normal` turn light mode on (4 h) and off. | [PC health](PC-health#the-hadoukensaude-command) |
| `/hadouken:aprender [status \| ligar \| desligar \| desfazer \| aprovar \| recusar]` | Local learning. | [Learning](Learning#commands) |
| `/hadouken:instalar` | Adds the status bar to `settings.json`, showing the change and asking for confirmation. | [Home](Home-en#what-hadoukeninstalar-changes-and-how-to-undo-it) |

## In VS Code

| Command | What it does |
|---|---|
| `Claude Hadouken: abrir a janela` | Opens the [hadouken window](VS-Code-panel-and-window#the-hadouken-window), with every setting. Clicking the logo in the status bar does the same. |
| `Claude Hadouken: atualizar uso agora` | Reads `/usage` right away. Clicking the usage item does the same. |

## Agents Claude uses

hadouken ships ten ready-made agents, each with the cheapest model and effort that can do the job. The `roteamento` skill tells Claude which one to pick, and [routing](Usage-guard#model-and-effort-routing) checks the dispatch. The model and effort in the table are the default from each agent's file; `/hadouken:agentes` changes them.

| Agent | Model · effort | For |
|---|---|---|
| `hadouken:busca` | Haiku · low | Finding files and symbols, reading and summarising excerpts; read-only. |
| `hadouken:varredor` | Haiku · medium | Sweeping the repository, inventories and a number from a primary source (read-only query, API); it does not edit. |
| `hadouken:pesquisa` | Sonnet · low | Checking docs, an API or a version on the web, with the source. |
| `hadouken:mecanico` | Haiku · low | Mechanical edits with exact instructions. |
| `hadouken:implementador-mecanico` | Sonnet · medium | A mechanical slice proved by a test, with no business or architecture decision. |
| `hadouken:implementador` | Sonnet · high | One slice with a closed spec and plan, test first. |
| `hadouken:revisor` | Sonnet · high | Reviewing a slice against the spec, the plan and the conventions; read-only, returns the defect with `arquivo:linha`. |
| `hadouken:auditor` | Fable · high | Adversarial audit against the live code; read-only. |
| `hadouken:e2e` | Sonnet · high | The e2e where the user sees it, and operation tasks; it only creates artifacts with the project's test prefix and deletes them at the end. |
| `hadouken:redator` | Sonnet · medium | Text for third parties, returned without publishing. |

### Changing the palette

The `agentes` key of `config.json` holds your choice, per agent (without the `hadouken:` prefix): `{"revisor": {"model": "opus", "effort": "high"}, "auditor": {"ativo": false}}`. Model: `haiku`, `sonnet`, `opus` or `fable`; effort: `low`, `medium`, `high`, `xhigh` or `max`; `ativo`: `true` or `false`. An unknown agent, a value outside the list or the wrong type: the field is ignored and the session start warns. Only you write it, through `/hadouken:agentes` or by hand.

- **Typed only.** `/hadouken:agentes` only counts when you type it in a normal session, never in a scheduled prompt: `CronCreate`, `ScheduleWakeup`, `RemoteTrigger` or an MCP scheduler with `hadouken:agentes` or `/agentes` as a word in the text is denied ([Usage guard](Usage-guard#the-work-window)). The bare word "agentes" is not watched.
- **Who wins.** An explicit parameter on the dispatch beats your config, and your config beats the agent's file. The config applies to `hadouken:<agent>` dispatches. A dispatch Claude launches without `model` or without `effort` gets the ones from the config; `fork` ignores both and gets nothing.
- **Going up is your decision.** What your config or `roteamento.subir` already approves passes [N1 and N2](Usage-guard#model-and-effort-routing): `agentes.busca.model = "opus"` and a `hadouken:busca` dispatch with `model: "opus"` pass; with `model: "fable"`, N1 denies. N1, N2 and A1 to A3 judge the dispatch as Claude wrote it, without what the palette injects.
- **Turned off.** With `ativo: false`, the dispatch is denied and the message names the substitute (`busca` → `varredor`, `varredor` → `busca`, `mecanico` → `implementador-mecanico`, `implementador-mecanico` → `implementador`, `implementador` → `implementador-mecanico`, `revisor` → `auditor`, `auditor` → `revisor`, `e2e` → `implementador`; `pesquisa` and `redator` have none: "do it directly"); if the substitute is also off, "do it directly". It holds even with an explicit `model` on the dispatch, and with the guard off.
- **When it applies.** The palette applies from the next dispatches; the text at session start reflects the config from when the session opened and only changes in the next one.
- **`executor` and `revisor-critico` left in 0.6.0.** A dispatch to them is denied with the substitute (`implementador` and `auditor`); this only reaches a session opened before the update, because after it the type is gone. See the [breaking changes](Home-en#breaking-changes-in-060).
- **A local agent with the same name.** An agent of yours with the same name in `~/.claude/agents` beats the plugin's on the short name (`revisor`); the palette applies to `hadouken:<name>`. Remove the local copies of the palette's names so you do not end up with two.
- **Another plugin on the dispatch.** Another plugin that also returns `updatedInput` on Agent has undocumented behaviour: the result between the two is not guaranteed.
- **Auto mode.** The palette changes the dispatch without approving it: hadouken never answers `allow`, and in auto mode Claude Code can deny the changed dispatch (the classifier reviewed what Claude wrote, not what the palette added). On Claude Code 2.1.322, a `deny` rule of yours for `Agent(...)` on a changed dispatch was enforced by the auto mode classifier; in default mode, by the rule itself (S31 in [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md)).

---

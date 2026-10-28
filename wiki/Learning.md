# Learning

[Português](Aprendizado)

## Local learning

On by default since v0.5.4: the installer turns it on unless you pass `--sem-aprender` or have turned it off before. Turn it off any time in the VS Code window (Learning tab) or with `/hadouken:aprender desligar`. When on, hadouken learns on this machine only, spending no tokens, from two sources: Claude Code's own OpenTelemetry, received by an official Collector (`otelcol-contrib`) that listens only on `127.0.0.1:47318`, and the data the hooks already save. With that it adjusts comfort settings by itself, within limits fixed in the code, and only ever **tightens** the guard by itself. Loosening the guard and switching models stay as suggestions you approve.

### Turning it on, in two steps

1. `/hadouken:aprender ligar` shows the plan and changes nothing: the Collector version, the GitHub download address, the maximum size, the folder (`~/.claude/hadouken/otel/`), the keys that go into the `env` of `settings.json`, and an 8-character code.
2. `/hadouken:aprender ligar <code>` does it: downloads the Collector once, checks the SHA-256 pinned in the code (on a mismatch the file is deleted and nothing changes), extracts it with the system `tar`, writes the configuration and only then adds the keys to the `env` of `settings.json`, with a backup. If `settings.json` changed between the two steps, the code does not match and nothing happens.

`ligar` refuses if `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` or `OTEL_LOG_RAW_API_BODIES` is on (in the `env` of `settings.json` or in the environment, with the name in any letter case, as Windows reads it), or if another OTLP endpoint is already configured. Telemetry starts with the next session. The command is a hook that runs before the model: it spends no tokens, and a `claude -p` or SDK session (a script) is refused; a scheduled task, a `/loop` or a routine carrying the command in its text is denied before it is created. If another session is in the middle of a `ligar`, a `desligar` or the learning step, the answer is that learning is busy, and `settings.json` does not change.

The extracted binary takes about 367 MiB of disk; the downloaded `.tar.gz` (about 100 MiB) is deleted after extraction. Measured on Windows, the Collector uses about 108 MiB of memory when idle and reached 131 MiB at its peak.

The Collector starts at the beginning of each session (no window, no waiting), does not start with less than 1.5 GiB of free memory, and stops at the end of the last open session.

### What it adjusts by itself

Only after 7 calendar days of data **and** 20 sessions, and at most one change per item every 24 h:

| Item | Limits | When it changes |
|---|---|---|
| Panel interval outside active hours | 30 to 120 s | During your active hours the panel reads every 30 s; outside them, every 60 and then 120 s. |
| Panel yellow band | 60 to 85% | From the lead time, in your history, between crossing the band and running out of the window. |
| Panel red band | 85 to 95% | Same. |
| Weight of the hourly pace in the forecast | 0 to 0.5 | Goes up 0.1 at a time when the hourly pace covers 80% of your active hours; goes back down 0.1 at a time to 0 when coverage drops. It applies to the notices Claude receives; the guard keeps the current pace. |
| Guard's Fable ceiling and 7-day ceiling | Down only, 5 points at a time, never below 70% | When the window ran out in 2 of the last 3 weeks. |

Learned bands only change the colour of the VS Code panel; the notices Claude receives keep the usual bands.

**Limit:** the bands learn from the short history in `estado.json`, which covers 3 h, and the learning step runs only at the start and the end of each session. In a session longer than 3 h, the oldest points leave the history before they are read, and the learned bands lean towards the end of those sessions.

### Suggestions, never applied by themselves

- **Loosen the guard**, after a learned tightening, at most up to the value in your `config.json`, when more than 30% was left over in 4 weeks in a row without the window running out.
- **Switch model or effort** for one origin (the main session or a subagent), when the other one cost at most half per request over the last 4 weeks, with errors at most 2 points worse and at least 20 requests on each side. The measure is indirect (cost and errors, not quality), and hadouken never makes the switch. In the measurement on Claude Code 2.1.287 (done with Haiku only), effort did not come in the telemetry; while it is missing, the comparison is between models only, with effort shown as `-`.

### Commands

| Command | What it does |
|---|---|
| `/hadouken:aprender` or `… status` | The state, the adjustments in force, the suggestions and the latest events. |
| `… ligar`, `… ligar <code>` | The preview and the run, above. |
| `… desligar`, `… desligar <code>` | Also in two steps: the preview shows the keys that leave the `env` and what will be deleted, with an 8-character code; with the code, it stops the Collector and removes from `env` only the keys with the value `ligar` wrote. If `settings.json` changed between the two steps, nothing happens. The data stays; `desligar dados` deletes the learned data (the binary stays), and `desligar tudo` also deletes the `otel/` folder, binary included, each with its own code (`desligar dados <code>`, `desligar tudo <code>`). |
| `… desfazer`, `… desfazer aN` | Reverts the last adjustment (or `aN`) and locks the item for 7 days. |
| `… aprovar sN`, `… recusar sN` | Applies or discards a suggestion; discarding locks the same suggestion for 7 days. |

At the start of a session, at most once a day and only when there is something new, a line like this shows up for you only, outside Claude's context (the plugin's messages are in Portuguese):

```
Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /hadouken:aprender status).
```

It also warns, once a day per kind, when the Collector does not start, does not stop or has not received telemetry yet.

### Learning privacy

- **First barrier, in the Collector:** deletes `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` and every `vcs.*` before writing; it only takes OTLP/HTTP on 127.0.0.1, with no gRPC, no extensions and no other exporter.
- **Second barrier, in the reader:** every record is rebuilt from scratch with only model, effort, origin, cost, tokens, duration and outcome; everything else, `session.id` included, is dropped.
- **Content, never:** prompts, tool details and API bodies stay off, and `ligar` refuses if any of them is on.
- **Retention:** the raw file rotates at 5 MB, keeping 3 old files and 30 days; the aggregates keep 26 weeks.
- **Nothing leaves the machine:** the only network access is the Collector download, once, through `ligar <code>`.

---

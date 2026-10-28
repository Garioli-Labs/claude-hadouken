# PC health (/hadouken:saude)

[Português](Saude-do-PC)

Since v0.5.5, hadouken keeps an eye on the PC's RAM, temperatures, battery and disk. When the PC is under pressure, it tells you and steers Claude toward lighter work. It also checks itself: whether its hooks got slow, whether one of its files got corrupted, whether the versions are compatible and whether another plugin clashes with it.

## What it does

- **Reads the PC in a separate process.** A collector runs detached, at low priority, at most once a minute, and writes `saude.json` in the data folder. The hooks only read that file; they never collect or wait. Several open sessions share the same collection.
- **Warns once per episode.** When a measure enters its band, three things appear: a short segment in the status bar (for example `PC: GPU 88°C`) while it lasts, a one-time notice to you and a context line to Claude. A new episode of the same measure starts only after 30 min below the band.
- **Steers Claude without blocking.** With high RAM, Claude gets a line like "tests with concurrency 1, no parallel subagents, no watch builds". Nothing is denied because of PC health.
- **Suggests what to close.** In the red RAM band, the notice and `/hadouken:saude` list up to 5 apps that use the most memory, with how much each one frees. The current session and the system are left out. **You are the one who closes them.**
- **Shows everything in one command,** `/hadouken:saude`, and in the "PC now" section of the [VS Code window](VS-Code-panel-and-window#pc-now).

## What it never does

- It never closes one of your apps. The only processes hadouken ends are **its own** processes that ran far past their own deadline, such as a hung collector or learner. It does so only after two checks, of the command line and of hadouken's own lock file, and records every one in an event. Turn this off with `saude.liberarProprios`.
- It never collects inside a hook, and never delays your prompt to measure the PC.
- It never puts an app name in Claude's context. Claude gets only numbers and labels from a fixed list; names are shown only to you, sanitised.
- It never disables another plugin. A conflict is only reported.

## Bands

All of them change in the window's Saúde tab or with [`/hadouken:limites`](Limits#the-hadoukenlimites-command).

| Measure | Default band | Item |
|---|---|---|
| RAM in use | warning from 85%; red (suggestions and light mode) from 93% | `saude.ram.amarelo`, `saude.ram.vermelho` |
| GPU temperature (NVIDIA) | from 85 °C | `saude.gpu.max` |
| CPU temperature | from 90 °C | `saude.cpu.max` |
| Battery off the charger | 15% or less | `saude.bateria.min` |
| Free disk (data folder and project) | under 5 GB | `saude.disco.minGB` |

### Not available on this PC

Not every PC provides every measure. Without `nvidia-smi`, the GPU has no reading. On Windows, the CPU temperature shows only when the system provides it without administrator rights, which is rare. On macOS, it does not show. A measure with no reading is shown as not available on this PC and never raises a warning.

## Light mode

When something is in alert, hadouken suggests light mode.

- `/hadouken:saude leve` turns it on for 4 h. `/hadouken:saude normal` turns it off earlier.
- While it is on, every session start and every prompt give Claude the light-work guidance: concurrency 1, one subagent at a time, the lowest effort that does the job, no Fable or Workflow unless explicitly asked, and Haiku or Sonnet for search.
- Light mode blocks nothing. The status bar shows `leve` while it lasts.
- In the VS Code window, the light-mode button does the same.

## The /hadouken:saude command

It answers from a hook, before the model, and spends no tokens. It only reads files, so it is fast.

| Command | What it does |
|---|---|
| `/hadouken:saude` | Shows the report. |
| `/hadouken:saude leve` | Turns light mode on for 4 h. |
| `/hadouken:saude normal` | Turns light mode off. |

The report has these sections:

1. **PC:** RAM, CPU, GPU, battery and disk, with the age of the reading.
2. **Suggestions:** the apps that free the most memory, and light mode.
3. **Hooks:** the p95 of each hadouken hook and of other plugins' hooks over the last 7 days, and the parts turned off by the time budget.
4. **Repairs:** the files put in quarantine.
5. **Versions and compatibility.**
6. **Conflicts** with other plugins.
7. **Data:** the size of each file in the data folder and the ceiling.
8. **Savings this week.**

## How hadouken looks after itself

### Hook time budget

The optional parts of each hook have a 40 ms budget (`saude.tetoHooks.ms`): learning, version check, panel, forecast, collector, routing optimizations and savings. A part that goes over budget in 3 of its last 10 runs is turned off for 24 h, with a one-time notice. The core parts never turn off: the guard's decisions and the status bar line.

### Self-repair

A corrupted state file goes to quarantine, named `<name>.corrompido-<date>`, at most 3 per file. The safe "missing file" default takes its place, and you get a one-time notice. A corrupted release never releases the guard. A corrupted `config.json` also goes to quarantine, and the configuration goes back to the defaults with an explicit notice, so you can recover the file if you want.

### Compatibility and conflicts

At session start, hadouken compares the Node, Claude Code and VS Code extension versions with the supported minimum (Node 20, Claude Code 2.1.251). Outside that, there is a one-time notice per combination saying what to do. Once a day, it looks for a `statusLine` that is not its own, plugins with permission hooks on the same points as the guard's, and other plugins' hooks with a high p95. Everything is only reported.

### Data cleanup

Inside the collector, never in a hook, hadouken keeps the data folder under a 50 MB total ceiling (`saude.limpeza.mb`). The history drops its oldest lines, large indexes are rebuilt and quarantined files go after 30 days. The learning `venv` is left out.

### Savings this week

At the first session start of the week, hadouken shows a line with what the guard and the routing did: dispatches asked about and denied, downgrades suggested and accepted, searches sent to a cheaper model. When there is a measured baseline on this machine, the line also carries an **estimate** of the tokens saved.

## Turning it off

- Everything: `/hadouken:limites saude.ligado desliga`.
- Each piece has its own switch: `saude.liberarProprios`, `saude.tetoHooks`, `saude.compat`, `saude.conflitos`, `saude.limpeza` and `saude.economia`.

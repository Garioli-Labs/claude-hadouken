# hadouken

[Português](Home)

A Claude Code plugin that shows real usage (5-hour session, week, Fable week, context and cache), tells Claude when it is time to shift gears, and holds back expensive dispatch when usage goes too far.

## Contents

- [Status bar](Status-bar)
- [VS Code panel and window](VS-Code-panel-and-window)
- [Warnings and alerts](Warnings-and-alerts)
- [Usage guard](Usage-guard), with the protections you turn on and off, and routing
- [The `/hadouken:consumo` report](Usage-report)
- [Learning](Learning)
- [Limits and configuration](Limits)
- [hadouken-kit](Kit-en) and [hadouken-rea](REA-en)
- [Commands](Commands)
- [Troubleshooting](Troubleshooting), including "I updated and the plugin disappeared"
- On this page: [Installation](#installation), [Roadmap](#roadmap), [Contributing](#contributing) and [License](#license)

## Why it exists

Claude Code shows your limits when you ask (`/usage`). The rest of the time you work blind: you find out the 5-hour window is gone when it is gone, and that the week ran out on Wednesday.

Two things are missing:

1. **A pace reference.** Is "58 % of the week used" a lot? It depends on how many hours of the week have passed. The plugin works out how much you *should* have used at a linear pace and compares.
2. **Claude knowing.** If Claude knows the 5-hour window is at 83 %, it stops launching parallel subagents. At 91 %, it wraps up the current task instead of starting another.

The guiding principle: **quality before savings**. Saving cuts volume, parallelism and re-reading; it never cuts tests, review, verification, or the model and effort used for implementation. When the week has slack, the slack goes to quality (extra review, higher effort on specs and audits), not to volume.

---

## In 30 seconds

The plugin does four things:

1. **A status bar**, always at the bottom of Claude Code. In one line, in numbers and little bars, it tells you this session's model and effort, how much of the context is in use and how much of what goes to the model comes from the cache.

   ![hadouken status bar: Opus 5.5·high; context at 37% and cache hit rate at 92%, each with its own bar, both green](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/barra-calma.svg)

2. **A VS Code status bar item** with the account limits: the 5-hour session, the week and the Fable week, with the numbers from the claude.ai Usage tab. Hover it to see when each window resets and the forecast, worded like claude.ai.

   ![hadouken item in the VS Code status bar, hovered: 5h 42% · sem 59% · Fable 71%. The tooltip shows, per window, the percentage, the reset and the forecast: 5-hour session at 42%, resets at 15:30 and, at this pace, runs out around 14:04; week for all models at 59%, does not run out before Monday's 22:00 reset; Fable week at 71%, runs out Monday morning. Then 2 active sessions, the age of the official reading (12 s) and the source: Claude Code status line and claude /usage, no tokens](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/painel.svg)

3. **Short notices for Claude.** When a window changes band (for example, the 5-hour one goes past 80 %), or when the current pace takes it to 100 % before the reset, Claude receives one line in its context and adjusts how it works.
4. **An on-demand report**, `/hadouken:consumo`: where the tokens went (by project, model, subagents and session, plus the weight of each session open in the last hour) and the GitHub Actions minutes.

> [!TIP]
> Every image and example in this README is the real output of the plugin's code, run on **synthetic data** (projects `meu-projeto` and `outro-projeto`, made-up sessions). The examples' clock is frozen on a **Saturday at 12:00**; the account's week started the previous Monday at 22:00. The images are rebuilt with `node docs/imagens/gerar.mjs`.

---

## Installation

### One command

In the terminal (outside Claude Code), on a new machine or to update:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

It checks Node (20+), git and Claude Code (2.1.251+); if any is missing, it lists them and asks once before installing (Node and git through winget or brew, Claude Code through the official installer). Then it installs `hadouken`, `hadouken-kit` and `hadouken-rea` (on at the first install if Node is 22.19+, 24.11+ or 26+; if you turn it off, running it again does not turn it back on), sets the bar, installs the VS Code item, turns on automatic updates and, if you accept, the extras (Python, `graphify` in its own venv at `~/.claude/hadouken/venv`, with Python 3.10+, the `yu-ux-web-expert` tools and `gh`). Local learning is on by default; to go without it, use `--sem-aprender` or turn it off later in the window, and if you already turned it off it stays off. At the end, a one-line summary per item; running it again updates and skips what is already right.

Options (in bash, `| bash -s -- <options>`; in PowerShell, `$env:HADOUKEN_INSTALAR = '<options>'` before `irm`):

| Option | Does |
|---|---|
| `--sim` | answers yes to the questions; does not replace another plugin's bar |
| `--substituir-barra` | replaces a `statusLine` that is not hadouken's (with a backup) |
| `--sem-extras` | skips the extras |
| `--sem-aprender` | does not turn on local learning (in PowerShell, also `-SemAprender`) |

The `--com-aprendizado` option from earlier versions is still accepted and changes nothing.

The VS Code item is not in the marketplace: the installer builds the package at `~/.claude/hadouken/painel/claude-hadouken-painel-<version>.vsix`. To install it on another PC without the one-line command, copy that file and run `code --install-extension <file>.vsix`.

The steps below are the manual path, with the same result.

### Requirements

- **Claude Code 2.1.251 or newer.** The guard needs it. On earlier versions, the model switch (P3) and the release through `/hadouken:liberar` do not exist, and the plugin does not work: no hook loads and, without the SessionStart registration, the status bar stays empty too. On 2.1.250, Claude Code rejects the model-switch events in `hooks.json` and registers none of the plugin's hooks. That leaves no guard, no session-start usage line, no notices, no P1 to P5 and no status bar. The minimum is 2.1.251; 2.1.250 failed, and 2.1.251 was not tested on its own.
- **Node.js 20 or newer**, on your `PATH`.
- **A Pro or Max plan** to see limits: Claude Code only hands the 5 h and 7-day limits to the status line on those accounts (or behind a gateway with a spend limit), and only after the session's first API response. Without that, the plugin works, but the limits have no reading in the panel, the notices and the report.
- Optional, for the panel: **VS Code**. The plugin finds `code` on `PATH` (on Windows, `code.cmd`) and, on a Mac, also inside `Visual Studio Code.app` in `/Applications` or `~/Applications`, without "Shell Command: Install 'code' command in PATH". For the Fable reading, the `claude` executable in `~/.local/bin` or on `PATH` (on Windows, `claude.exe`).
- Optional: [`gh`](https://cli.github.com/), logged in, for the GitHub section.
- Optional: `git`, to find the repo from `origin` when there is no `config.json`.

### Step by step

**1. Add the marketplace and install the plugin.** Inside Claude Code:

```text
/plugin marketplace add Garioli-Labs/claude-hadouken
/plugin install hadouken@claude-hadouken
```

`/plugin install` opens the panel with the plugin's details; choose **Install for you (user scope)** to have it in every project.

Prefer the terminal? The equivalent commands install without opening any session, and the plugin loads the next time you start Claude Code:

```bash
claude plugin marketplace add Garioli-Labs/claude-hadouken
claude plugin install hadouken@claude-hadouken
```

**2. Start a new session.**

> [!IMPORTANT]
> **Only sessions started after installation use the plugin.** Sessions that were already open, and the agents running in them, stay exactly as they were: no bar, no notices, nothing written.
>
> The plugin enforces this itself, not by luck: it only acts in sessions registered by its own session-start hook. If Claude Code loads the plugin's hooks in the middle of an old session, they stay silent; if that session runs the bar command, the bar comes out empty. Subagents follow their parent session: those launched in a new session use the plugin, those in an old session do not.

**3. In the new session, install the status bar:**

```text
/hadouken:instalar
```

The bar can only be set in your user `settings.json` (a plugin cannot do that on its own), which is why this command exists. It:

- shows the exact change and **asks for your confirmation** before writing;
- writes **only** the `statusLine` key, keeping the rest of the file intact;
- makes a **backup** first, next to the file: `settings.json.bak-hadouken-<time in ms>` (it keeps the 5 most recent);
- if you already have another bar, shows it and asks whether to replace it; the recommended answer is to keep it, and without an explicit "replace" nothing changes;
- refuses without touching anything if `settings.json` holds invalid JSON, is a link, is read-only, or has a number whose value would change on rewrite;
- honours `CLAUDE_CONFIG_DIR` when it is an absolute path;
- **cannot be triggered by Claude** on its own: only you can run it.

The bar appears on the next interface refresh. Two things to know before you confirm:

- With a `statusLine` configured, Claude Code stops showing most footer keyboard hints, such as `esc to interrupt` and `? for shortcuts`.
- Sessions opened before the plugin was installed start running the new command right away, but do not get the bar: in them it stays empty until the session is reopened. If you replaced an existing bar, those sessions have no bar until reopened.

**4. The VS Code panel installs itself.** With VS Code installed (the `code` command on `PATH`, or on a Mac the app in `/Applications`), the session start installs the panel extension in the background, without asking anything and without spending tokens. In a VS Code window that was already open, the item may only show up after you reload it (`Developer: Reload Window`). To skip the install, or to remove it, see [Install, turn off and remove](VS-Code-panel-and-window#install-turn-off-and-remove).

### What `/hadouken:instalar` changes, and how to undo it

| Question | Answer |
|---|---|
| Which file changes? | Your user `settings.json` (`~/.claude/settings.json`, or the one under `CLAUDE_CONFIG_DIR`). The exact path is shown before you confirm. |
| What changes in it? | Only the `statusLine` key, which now calls `node "<data folder>/bin/statusline.mjs"`. The rest of the file stays as it was. |
| What if I already have a bar? | It is shown, and the recommended answer is to keep it. Only "Substituir a barra atual" (replace the current bar) swaps it. |
| Is there a backup? | Yes, before writing: `settings.json.bak-hadouken-<time in ms>`, next to the file. The 5 most recent are kept. |
| How do I undo it? | `node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover`, in a terminal (or in Claude Code, prefixed with `!`). It removes only the hadouken bar, also with a backup; if the file's `statusLine` is someone else's, it touches nothing. |
| And to get back exactly the file I had? | Copy the `settings.json.bak-hadouken-*` backup back over `settings.json`. Changes made to the file after the backup are lost. |

### Updating

If you installed with the one command, automatic updates are on: Claude Code updates the hadouken marketplace and plugins after the first message of a session, and the new version applies in the next session (`DISABLE_AUTOUPDATER=1` turns it off). To update now, run the one command again, use **Update now** in the **Installed** tab of `/plugin`, or, in the terminal:

```bash
claude plugin marketplace update claude-hadouken
claude plugin update hadouken@claude-hadouken
```

**Installed before v0.5.2?** The plugin was renamed from `claude-hadouken` to `hadouken` (Claude Code reserves names that start with `claude-`). The marketplace moves your `enabledPlugins` entry to the new name, but the plugin has to be installed once under it: run the one command again or, in the terminal, `claude plugin install hadouken@claude-hadouken`. The commands become `/hadouken:liberar`, `/hadouken:aprender`, `/hadouken:consumo` and the rest.

The bar does not need to be reinstalled. The `statusLine` runs a stable script in the data folder (`bin/statusline.mjs`), and that script points to the plugin version loaded by the latest session start (opening, resuming, `/clear` and `/compact` all count as a start). The VS Code panel loads its logic the same way, through `bin/painel.mjs`. In v0.3.0 the bar loses the 5-hour and 7-day segments, the session-start line changes and the panel comes in. In practice:

- **Until some session starts on v0.3.0**, every session stays on the previous version, with 5 h and 7 d on the bar, and the panel is not installed.
- **Once a session starts on v0.3.0**, every session that already showed the bar, including the ones opened before the update, switches to the new, session-only bar on its next redraw. That session start also installs the VS Code panel in the background (see [Install, turn off and remove](VS-Code-panel-and-window#install-turn-off-and-remove)); a VS Code window that was already open may need a reload.
- **The hooks of a session that was already open** keep running the previous version's code until that session restarts. The notices before each prompt did not change in v0.3.0, so nothing changes in them. This comes from how Claude Code loads each session's hooks, not from the plugin, and may change between Claude Code versions.
- **A `/clear`, `/compact` or `/resume` in a session still running the previous version** points every session's bar back to it while it is still on disk: the previous look comes back, with 5 h and 7 d on the bar. Nothing breaks. If the previous version's folder is removed after that point, the bar is empty, with no error.
- **Only a session start on the new version** fixes it: opening a new session (or resuming one in a new Claude Code process), or a `/clear` or `/compact` in a session already on the new version. The new bar comes back on the next redraw.
- **A session that never loaded the plugin** still shows no bar and writes nothing, before and after the update.

**After updating, restart the sessions that were open** (close and reopen them). That way every session runs the new version, and none points the bar back to the previous one.

---

## Roadmap

The complete plugin has four subprojects, each with its own spec, plan and review:

| Subproject | What it does | Status |
|---|---|---|
| **A. Usage reader** | Status bar, VS Code panel, notices, guard and report. | **v0.5.1** (this one) |
| B. Router | Dynamic session launcher, fixed main agent, agents per model × effort, injected rules and a divergence check against the project's rules. | Planned |
| C. Planner | Session and week planning from the project plan and the measured cost per task. | Planned |
| D. GitHub guards | Guards for pushes and for CI on documentation-only changes, plus improvement suggestions. | Planned |

- **v0.2.0** = a prettier bar: percentages also as little squares (`▰▰▰▱▱▱▱▱`), the weekly pace mark on the 7-day bar, colours for ctx and cache, and an easier-to-read `/consumo` (panel with bars, share-of-total column, short names, decimal comma and thousands separator); and, for several sessions at once, the active session count on the bar, each window's run-out forecast (`→100% 13:10`), the projection notice to Claude and the "open sessions in the last hour" section in `/consumo`.
- **v0.3.0** = the VS Code panel: 5 h, week and Fable in a status bar item, with Fable read from the official `/usage` without spending tokens, the forecast worded like claude.ai, and a lean read that uses little RAM. The terminal bar keeps only the session (model·effort, ctx and cache), and the session-start line swaps the expected value and the mode for the week's forecast sentence.
- **v0.4.0** = the guard: instead of only notifying, hold back subagent dispatch, Fable use and the expensive dispatch when usage goes too far, with release only by the user (`/hadouken:liberar`), and protect the plugin's files and the settings fields that would turn the guard off. `/consumo` gains "Guarda (7 dias)" and "Custo dos hooks (7 dias)"; the notices gain the floor reading, the reset in minutes, the return time and the week's pace; the bar redraws every minute while the session is idle; and resuming an idle session shows the cache tokens to be rewritten. Plus optional local learning: hadouken learns from Claude Code's OpenTelemetry, on this machine only and with no tokens, adjusts comfort within fixed limits, only tightens the guard by itself, and leaves loosening and model switches as suggestions.
- **v0.5.0** = hadouken-kit and hadouken-rea, optional in the same marketplace: the kit installs and pins the workflow skills (superpowers, Matt Pocock, yu-ux-web-expert, graphify and others), tells Claude the moment for each one and warns when a dependency ships a new major version; the REA turns on the reverse engineering MCP server. Plus the minor fixes from the v0.4.0 review.
- **v0.5.1** (this one) = follows mattpocock-skills 1.3.1 (27 skills), makes the REA start under a junction or link and say so when Node is too old, and has the weekly check read the superpowers the official marketplace installs, without reopening issues or passing third-party text along.
- **v0.6.0** = notifications on [Pipa](https://github.com/LucasGarioli/pipa-vscode-remote) (priority), on WhatsApp or both, as the user chooses (pushes and finished tasks). It gets its own spec, with security as a precondition: the credential stays out of the repo, activation is per project, and messages carry the minimum, with no code, personal paths or secrets.
- **v1.0** = A + B + C + D.

---

## Contributing

Contributions are welcome. House rules:

- **Zero dependencies**, runtime and development. Only Node's standard library (20+), ES modules.
- **Tests:** `node --test`, at the repository root. Every change comes with a test; every security defence comes with a malicious-input test.
- **Benchmarks:** `node bench/rodar-todos.mjs` (report only; they never fail for being slow).
- **Synthetic fixtures only:** no real transcripts, personal paths, e-mails or real session ids.
- **Interface text in Brazilian Portuguese**; **commits in English**, prefixed by area (`core:`, `installer:`, `ci:`, `docs:`).
- **Missing data never becomes zero:** `—`, `indisponível: <reason>` or "no reading".
- **README images:** `node docs/imagens/gerar.mjs` rebuilds the images in `docs/imagens/` from the code's real output, on synthetic data. Run it again whenever the bar, the panel, the notices or the report change.
- Vulnerabilities: through [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md), never in a public issue.

## License

[MIT](https://github.com/Garioli-Labs/claude-hadouken/blob/main/LICENSE) © 2026 Lucas Garioli.

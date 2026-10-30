<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/logo-escuro.svg"><img src="assets/logo-claro.svg" alt="Hadouken" width="420"></picture></p>

<h1 align="center">Hadouken</h1>

<p align="center"><b>Claude Code at the right pace: your usage on screen, Claude aware of it, and no quota burned for nothing.</b></p>

<p align="center">
  <a href="https://github.com/Garioli-Labs/claude-hadouken/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/Garioli-Labs/claude-hadouken?label=version&color=e8590c"></a>
  <a href="https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/Garioli-Labs/claude-hadouken"></a>
  <br>
  <b>English</b> · <a href="README.md">Português</a>
</p>

> [!IMPORTANT]
> **After updating, close open sessions with `/exit` and come back with `claude -c`.** Since v0.5.7 Hadouken keeps the plugin, the VS Code extension and the shortcuts on the same version on any PC; `/hadouken:saude` shows anything out of step (the `Instal.` line).

## Features

| | |
|---|---|
| 📊 **Limits on screen** | 5-hour session, week and Fable week in a VS Code status bar item, with the animated logo, spending no tokens. |
| 🧠 **Context and cache** | How much context each session uses and how much came from cache, in the Claude Code status line. |
| 🛡️ **Usage guard** | Warns Claude when the pace will run out the window and holds expensive dispatches until you release them (`/hadouken:liberar`, including `noite`). |
| 🧭 **Routing** | Suggests model, effort and when to launch an agent, so Fable or high effort is not burned for nothing. |
| 📈 **Report** | `/hadouken:consumo`: tokens per project and per model·effort, account plan (Pro, Max 5x, Max 20x) and GitHub Actions minutes. |
| 🖥️ **PC health** | `/hadouken:saude`: RAM, temperatures, battery, disk, idle sessions, light mode and the install check. |
| ⚙️ **VS Code window** | Every setting one click away on the status bar: caps, bands, alerts, routing and protections. |
| 🧰 **Kit and REA** | `hadouken-kit`, the daily skills with a map of which to use; `hadouken-rea`, reverse engineering (off by default). |

## Install

In a terminal, outside Claude Code:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Requirements: **Node 20** or newer and **Claude Code 2.1.251** or newer, on Windows, Linux or macOS. The installer checks both and installs the plugin, the status line and the VS Code item. Details in the [wiki](https://github.com/Garioli-Labs/claude-hadouken/wiki/Home-en#one-command).

## Update

VS Code announces a new version with an **Update** button. Without VS Code, run the same install command.

## Documentation

[Status bar](https://github.com/Garioli-Labs/claude-hadouken/wiki/Status-bar) · [VS Code panel and window](https://github.com/Garioli-Labs/claude-hadouken/wiki/VS-Code-panel-and-window) · [Warnings and alerts](https://github.com/Garioli-Labs/claude-hadouken/wiki/Warnings-and-alerts) · [Usage guard](https://github.com/Garioli-Labs/claude-hadouken/wiki/Usage-guard) · [Limits](https://github.com/Garioli-Labs/claude-hadouken/wiki/Limits) · [Commands](https://github.com/Garioli-Labs/claude-hadouken/wiki/Commands) · [Usage report](https://github.com/Garioli-Labs/claude-hadouken/wiki/Usage-report) · [Learning](https://github.com/Garioli-Labs/claude-hadouken/wiki/Learning) · [PC health](https://github.com/Garioli-Labs/claude-hadouken/wiki/PC-health) · [Kit](https://github.com/Garioli-Labs/claude-hadouken/wiki/Kit-en) · [REA](https://github.com/Garioli-Labs/claude-hadouken/wiki/REA-en) · [Troubleshooting](https://github.com/Garioli-Labs/claude-hadouken/wiki/Troubleshooting) · [Releases](https://github.com/Garioli-Labs/claude-hadouken/releases) · [Security](SECURITY.md)

## License

[MIT](LICENSE) © 2026 Lucas Garioli.

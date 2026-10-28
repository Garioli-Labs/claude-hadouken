<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-escuro.svg">
    <img src="assets/logo-claro.svg" alt="hadouken" width="420">
  </picture>
</p>

# hadouken

**English** · [Português](README.md)

[![CI](https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml/badge.svg)](https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Garioli-Labs/claude-hadouken)](LICENSE)

> [!IMPORTANT]
> **Updated to v0.5.2 and the bar is gone, or you saw `claude-hadouken not found`?** The plugin was renamed from `claude-hadouken` to `hadouken`. In a terminal, run `claude plugin install hadouken@claude-hadouken` and open a new session, or run the install command below again.

**Your Claude Code usage on screen, with a pace reference, and Claude aware of it too.**

- your account limits (**5-hour session**, **week** and **Fable week**) in a VS Code status bar item, spending no tokens;
- each session's **context** and **cache** in the Claude Code status line;
- notices to Claude when the pace will run the window out, and a **guard** that holds expensive dispatches until you release it;
- a **VS Code window** with every setting: ceilings, bands, alerts, routing, learning and protections;
- the `/hadouken:consumo` report, with tokens per project, per model·effort and GitHub Actions;
- **PC health** (`/hadouken:saude`): RAM, temperatures, battery and disk, with a notice, a suggestion of what to close and a light mode that steers Claude toward lighter work.

## Install

In a terminal, outside Claude Code:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Requirements: **Node 20** or newer and **Claude Code 2.1.251** or newer. The installer checks both and installs the plugin, the status line and the VS Code item. Options and the manual step-by-step are in the [wiki](https://github.com/Garioli-Labs/claude-hadouken/wiki/Home-en#one-command).

## Update

When a new version comes out, VS Code tells you with an **Atualizar** (update) button. Without VS Code, run the same install command.

## Documentation

- [Status bar](https://github.com/Garioli-Labs/claude-hadouken/wiki/Status-bar) · [VS Code panel and window](https://github.com/Garioli-Labs/claude-hadouken/wiki/VS-Code-panel-and-window) · [Warnings and alerts](https://github.com/Garioli-Labs/claude-hadouken/wiki/Warnings-and-alerts)
- [Usage guard and routing](https://github.com/Garioli-Labs/claude-hadouken/wiki/Usage-guard) · [Limits and protections](https://github.com/Garioli-Labs/claude-hadouken/wiki/Limits) · [Commands](https://github.com/Garioli-Labs/claude-hadouken/wiki/Commands)
- [Usage report](https://github.com/Garioli-Labs/claude-hadouken/wiki/Usage-report) · [Learning](https://github.com/Garioli-Labs/claude-hadouken/wiki/Learning) · [PC health](https://github.com/Garioli-Labs/claude-hadouken/wiki/PC-health)
- [hadouken-kit](https://github.com/Garioli-Labs/claude-hadouken/wiki/Kit-en) · [REA](https://github.com/Garioli-Labs/claude-hadouken/wiki/REA-en) · [Troubleshooting](https://github.com/Garioli-Labs/claude-hadouken/wiki/Troubleshooting)
- [Releases](https://github.com/Garioli-Labs/claude-hadouken/releases) · [Security](SECURITY.md)

## License

[MIT](LICENSE) © 2026 Lucas Garioli.

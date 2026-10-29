# Limits (/hadouken:limites) and configuration

[Português](Limites)

## Configuration

Nothing is required. Without configuration, the plugin runs with the defaults below.

### GitHub repos: `config.json`

Create `~/.claude/hadouken/config.json`:

```json
{ "repos": ["your-org/your-app", "your-org/site"] }
```

- **Format:** each item is `owner/repo` (letters, digits and `-` in the owner; letters, digits, `.`, `_` and `-` in the repo; no `..`). Up to 20 items. Any item out of format, or an invalid file, makes the plugin ignore the whole file, say so in the report ("config.json ignored: the accepted format is … using the current repository's origin") and fall back to `origin`:

  ```text
  Aviso: config.json ignorado: o formato aceito é {"repos": ["dono/repo"]}, com até 20 repos; usando o origin do repositório atual.
  ```

- **Without `config.json`** (or without the `repos` key): the report uses the `origin` of the git repository in the current directory, if it is on github.com.
- **Per report run**, only the **first 3 distinct repos** are queried; the others show as "outside the per-run repo limit" (*fora do limite de repos por coleta*).
- **Per repo:** up to 2 pages of 100 runs within 30 days, a budget of 60 job queries per run (whatever is left is read on later runs, and the repo shows as a partial summary, *resumo parcial*), and a **10 s** deadline for the whole GitHub collection.
- **Cache:** completed runs never change, so they are kept; everything else is reused for 15 minutes.

### Environment variables

| Variable | Effect |
|---|---|
| `CLAUDE_CONFIG_DIR` | When it is an absolute path, the plugin reads transcripts from `<CLAUDE_CONFIG_DIR>/projects` and the installer edits `<CLAUDE_CONFIG_DIR>/settings.json`, as Claude Code does. |
| `HADOUKEN_HOME` | Changes the data folder (default `~/.claude/hadouken`). Only a complete absolute path counts (on Windows, with a drive letter or UNC). With any other value, the plugin has **no** data folder: it writes nothing, the installer refuses, and the default folder is never used instead. The VS Code panel only sees it if it is in VS Code's own environment. |
| `HADOUKEN_SETTINGS` | Changes the `settings.json` the installer edits. Same rule: complete absolute path only; any other value makes the installer refuse. |
| `HADOUKEN_SEM_PAINEL` | With the exact value `1`, the session start does not install or update the VS Code panel extension. For an already installed extension to stop reading `/usage`, the variable has to be in VS Code's own environment (see [Install, turn off and remove](VS-Code-panel-and-window#install-turn-off-and-remove)). |
| `NO_COLOR` | Set and non-empty, removes the bar's colours. |

The installer shows which data folder the bar will point to and where that choice came from; when it comes from `HADOUKEN_HOME`, it warns that this gets saved into `settings.json` and applies to every project.

## The /hadouken:limites command

The same as the VS Code window, from the terminal. Only you use it, by typing it; Claude does not call it, and a `claude -p` or SDK session is refused. Like `/hadouken:liberar`, it is a hook that answers before the model: it spends no tokens.

| Command | What it does |
|---|---|
| `/hadouken:limites` | Shows the table: each item, the value in force, the default and the accepted range. |
| `/hadouken:limites <item> <value>` | Saves a value. Out of range, nothing changes and the answer gives the range. |
| `/hadouken:limites <item> padrao` | Sets one item back to its default. |
| `/hadouken:limites padrao` | Sets every item in the table back to its default. |

The items are the ones in the table; on-off items take `liga` and `desliga` (for example `barra.ctx.amarelo 75` or `protecoes.hooks desliga`). If the configuration changed between reading and saving, nothing is saved and the answer asks you to try again. Everything lives in `~/.claude/hadouken/config.json`, with a backup.

## Account plan

Since v0.5.6, the health collector reads the account plan (Pro, Max 5x or Max 20x) once a day from Claude Code's `.claude.json`, only the `organizationRateLimitTier` field, and keeps just the label in `conta-plano.json`. The credentials file is never read. The plan shows in `/hadouken:consumo`, below the limits, in `/hadouken:saude` and in the VS Code window. With no plan identified, the line says "não identificado (os relatórios mostram só tokens)", that is, not identified, reports show tokens only. Reports stay in tokens: measurement showed the conversion to a percentage of the quota varies too much to be reliable.

## Protections

Since v0.5.4, the four blocks below can be turned off, in the Proteções tab of the window or with `/hadouken:limites protecoes.<item> desliga`. All of them start on. Turning one off asks for no confirmation, but the window shows what then applies, and the change can be undone.

| Item | On (default) | Off: the risk |
|---|---|---|
| `protecoes.sessaoFilha` | Stops Claude from opening another `claude` session (`claude -p`, `claude plugin install`) once the guard has fired. | Claude can get around the guard by opening a new session. |
| `protecoes.arquivos` | Stops Claude from editing the hadouken configuration and Claude Code's `settings.json` files. | Claude can loosen the guard or change your settings by itself. |
| `protecoes.hooks` | Holds, for the current session, changes to hooks, plugins and `disableAllHooks` made to the settings from outside (through the shell, for example); the next session reads the new file. | Such a change applies at once, including one that turns hadouken itself off. |
| `protecoes.agenda` | Denies a scheduled task, `/loop` or routine that asks for liberar or aprender. | A task running without you can ask for them (liberar still refuses anything that was not typed). |

No protection blocks a command just for mentioning the project folder: a command with the repository path (for example `node` or `grep` inside `claude-hadouken`) goes through, and so does a quoted absolute path with a `Claude …` folder in it (`"C:/Projetos DEV/Claude Hadouken/x"`), even outside the session's folder. Before v0.5.4, that was blocked by mistake.

## PC health

Since v0.5.5, the table also has the `saude.*` items: the RAM, GPU, CPU, battery and disk bands, and the on/off switch of each PC health piece. They are also in the window's Saúde tab. The defaults and what each one does are in [PC health](PC-health#bands).

---

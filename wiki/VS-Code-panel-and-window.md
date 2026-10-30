# VS Code panel and window

[Português](Painel-e-janela-do-VS-Code)

## The VS Code panel

The account limits (5-hour session, week and Fable) are the same in every session, so they show up **once**, in an item on the right of the VS Code status bar:

```text
5h 42% · sem 59% · Fable 71%
```

| Piece | What it means | On the claude.ai Usage tab |
|---|---|---|
| `5h 42%` | You have used **42 %** of the 5-hour session. | Current session |
| `sem 59%` | You have used **59 %** of the week (`sem` = *semana*), all models added up. | Current week (all models) |
| `Fable 71%` | You have used **71 %** of Fable's own weekly limit. | Current week (Fable) |

- **Percentages are rounded down.** A window with no reliable reading shows as `—` (for example, `Fable —` before the first official reading); with none at all, the item says `Hadouken: sem leitura` (no reading).
- **The colour follows the worst window:** no colour below 75 %, warning background (yellow) from 75 % to 89 % and error background (red) from 90 % on. These bands are the panel's own; the notices to Claude follow theirs (see [The notices Claude receives](Warnings-and-alerts#the-notices-claude-receives)).
- **The logo sits at the start of the item**, in the status bar's text colour, so it shows in light and dark themes. Since v0.5.8 it loops non-stop, like a gif, and holds on the first frame with "reduce motion" on, with the animation off in the window's Painel tab, or while VS Code is not focused.
- **Click** the item to open the hadouken window. To read usage right away, run the `Claude Hadouken: atualizar uso agora` (update usage now) command or use the window's button; before v0.5.3, the click read directly. A manual read still respects the lock between windows, the RAM pause and the cost block (see [No tokens, little RAM](#no-tokens-little-ram)).

![Six states of the panel item in the VS Code status bar: 5h 42% · sem 59% · Fable 71%, no colour; 5h 78% · sem 59% · Fable 71%, yellow background; 5h 42% · sem 59% · Fable 92%, red background; 5h 42% · sem 59% · Fable —, before the first official reading; Hadouken: sem leitura; and Hadouken: abra uma sessão do Claude Code, when no session has started with the plugin on this machine](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/painel-estados.svg)

The grey comment lines in the image are in Portuguese; in order they say: every window below 75 %, no colour; worst window from 75 % to 89 %, warning background; worst window at 90 % or more, error background; before the first official reading, Fable shows `—`; no valid reading; no Claude Code session has started with the plugin on this machine (the item then says "open a Claude Code session").

**Where each number comes from.**

- **5 hours and week:** the newer reading between the Claude Code status line (which the bar saves in `estado.json` on every refresh) and `/usage` (saved in `uso-oficial.json`). The reset time comes from the status line, which carries it exactly.
- **Fable:** only from `/usage`, because the status line has no per-model limit. Its reset time is taken from the `/usage` text (`resets Oct 5, 10pm`), read in local time.
- A reading more than 1 hour old, or whose reset has already passed, is not shown: the window turns into `—`.

### The tooltip

Hover the item to see the tooltip (the image in [In 30 seconds](Home-en#in-30-seconds) shows one). In order, it has:

| Line | What it says |
|---|---|
| **Sessão (5h):**, **Semana (todos os modelos):** and **Semana (Fable):** | The percentage, when the window resets (`reinicia 15:30` on the same day, `reinicia seg 22:00` on another) and the [forecast](#the-forecast). A window with no reading: `sem leitura`. |
| `Sessões ativas: 2` | How many plugin sessions are active right now (see [Projection and several sessions](Warnings-and-alerts#projection-and-several-sessions)). |
| `Leitura oficial: há 12 s` | The age of the latest `/usage` reading; before the first one, `Sem leitura oficial ainda` (no official reading yet). |
| reading status | Only when something stops the reading: `Leitura pausada: pouca RAM livre.` (paused: little free RAM), `Leitura bloqueada por 24 h: o /usage passou a ter custo.` (blocked for 24 h: `/usage` started to cost), `claude não encontrado em ~/.local/bin nem no PATH.` (claude not found), `Leitura desligada (HADOUKEN_SEM_PAINEL=1).` (reading turned off), `Última leitura passou de 30 s; a próxima em 15 min.` (last reading took over 30 s; next one in 15 min), `Última leitura passou do teto de saída; a próxima em 15 min.` (last reading went over the output cap; next one in 15 min) or `Última leitura falhou (motivo).` (last reading failed), with the reason from a fixed list (`formato`, `erro`, `sem-pasta`). |
| `Fonte: statusline do Claude Code e claude /usage, sem tokens.` | Always, at the end (source: the Claude Code status line and claude /usage, no tokens). |

The tooltip holds only fixed labels and numbers: no text read from a file goes into it.

### The forecast

The sentence is the same one claude.ai uses, built from the average pace of the whole window so far:

- pace = usage ÷ time elapsed in the window (5 hours or 7 days);
- runs out = now + (100 − usage) ÷ pace.

| Case | Sentence |
|---|---|
| runs out before the reset | `Nesse ritmo, esgota <when>, antes do reinício <reset>.` (at this pace, runs out <when>, before the <reset> reset) |
| runs out after the reset | `Nesse ritmo, não esgota antes do reinício <reset>.` (at this pace, does not run out before the reset) |
| usage at 100 % | `Limite atingido; reinicia <reset>.` (limit reached; resets <reset>) |
| less than 30 minutes elapsed, or zero usage | (no sentence) |

- **`<when>`** is `por volta das 14:04` (around 14:04) when it is less than 6 hours away. Further out, it is `hoje` (today), `amanhã` (tomorrow) or the weekday (up to 6 days), with the part of the day: `de madrugada` (0 to 5 h), `de manhã` (6 to 11 h), `à tarde` (12 to 17 h) or `à noite` (18 to 23 h). After 6 days, `em 05/10` (on 05/10, day/month).
- **`<reset>`** is `das 15:30` on the same day and `de 28/09 às 22:00` on another.

In the image, at 12:00, the 5-hour session is at 42 % and resets at 15:30. It started at 10:30, so 1.5 h have passed: the pace is 42 ÷ 1.5 = 28 % an hour. The remaining 58 % run out in 58 ÷ 28 = 2.07 h, around 14:04, before 15:30. Hence `Nesse ritmo, esgota por volta das 14:04, antes do reinício das 15:30.`

This sentence is not the projection in the notices to Claude. The projection uses the pace of the last minutes (see [Projection and several sessions](Warnings-and-alerts#projection-and-several-sessions)); the sentence, the average of the whole window, like claude.ai. The session-start line uses the weekly sentence.

### No tokens, little RAM

- **No tokens.** Fable comes from the official `claude -p /usage` command. `/usage` is a local Claude Code command: it does not call the model. Every read checks the result: `num_turns` 0, cost 0 and `local_command` equal to `usage`. If turns or cost ever come back other than 0, the panel takes it as the command having started to cost, stops reading for 24 h and says so in the tooltip; a zero-cost result that is not the `/usage` one counts as a format failure. Claude Code itself queries Anthropic, with your session; the plugin reads no credential and calls no endpoint.
- **Lean mode.** The read runs without plugins, MCP, hooks, Chrome or session history (`--no-session-persistence --strict-mcp-config --no-chrome --setting-sources "" --settings {"disableAllHooks":true}`), in an empty folder inside the data folder (`uso-cwd/`), so Claude Code indexes nothing. Measured on the author's Windows machine:

  | Mode | Time | Peak RAM | Processes |
  |---|---|---|---|
  | plain `claude -p /usage` | 15 s | 972 MB | 28 (MCP, hooks, plugins) |
  | lean, the panel's | 5 s | 270 MB | 2 to 4 |

- **Only when useful.** One read every 30 s, only while some Claude Code session was active in the last 5 minutes, and one at a time across all VS Code windows: a file lock (`uso-oficial.lock`) is only considered abandoned after 90 s, and a read less than 25 s old makes the next one unnecessary. After a read that ran past the deadline or the output cap, came in an unexpected format or failed, the next one waits 15 min; 5 h and the week keep coming from the status line meanwhile. On average about 45 MB, with 270 MB peaks for 5 s.
- **Memory pause.** With less than 1.5 GiB of free RAM, the read is skipped, even a manual one, and the tooltip says `Leitura pausada: pouca RAM livre.`
- **The rest is file reading.** Every 5 s the extension redraws the item by reading `estado.json` and `uso-oficial.json`. The window is a webview loaded only when you open it; no dependencies; the logic lives in the plugin (`src/uso/painel.js`), loaded through a stable script in the data folder (`bin/painel.mjs`).

### Install, turn off and remove

- **Automatic install.** When a session starts on a plugin version that is not yet installed in VS Code, the session start builds the extension (a `.vsix`, in `<data folder>/painel/`) and runs `code --install-extension <vsix> --force` in the background. It needs the `code` command on `PATH` (on Windows, `code.cmd`; on a Mac, the one in `Visual Studio Code.app` in `/Applications` or `~/Applications` also works). If the install fails, the next session start gives the reason in one line, with the fix. One attempt per hour, whether it works or not, and none of it goes into Claude's context.
- **Manual install:** `node "$HOME/.claude/hadouken/bin/cli.mjs" painel instalar`.
- **On another PC:** `/hadouken:saude` shows, on the `Painel` line, the path of the `.vsix` in the data folder. Copy the file and run `code --install-extension <that file>` on the other PC.
- When hadouken is updated, the item moves to the new version by itself, without reloading the window (since v0.5.7).
- If the item does not show up in a VS Code window that was already open, reload it (the `Developer: Reload Window` command). Until a Claude Code session has started with the plugin on this machine, the item says `Hadouken: abra uma sessão do Claude Code` (open a Claude Code session).
- **Remove (the way to turn it off now):** run `code --uninstall-extension gariolilabs.claude-hadouken-painel` and reload every open VS Code window (`Developer: Reload Window`): the item keeps running in them until the reload. Also set `HADOUKEN_SEM_PAINEL=1` in Claude Code's environment; without it, a session start installs the extension again, on the next plugin version.
- **`HADOUKEN_SEM_PAINEL=1`** makes the session start stop installing and updating the extension. For an already installed extension to stop reading `/usage`, the variable has to be in VS Code's own environment: set it as a user variable (on Windows) or in your shell profile, and quit and reopen VS Code completely. A variable set only in one terminal does not reach the extension.
- **`HADOUKEN_HOME`** follows the same rule: if you move the data folder, the extension only sees it with the variable in VS Code's environment.
- **The bar while the session is idle.** Since v0.4.0, the installer writes `refreshInterval: 60`: the bar redraws every minute even while the session is idle, and the reading's age stays right (a repeated reading with no new conversation does not count as new). Cost: one Node process per minute in each open terminal. Anyone who already had the v0.3.0 bar sees the `atualizar` (update) action, which only adds that key, with a backup. Measured in Claude Code: with the session idle, the bar ran every 60 s exactly.

## The hadouken window

Click the hadouken logo in the VS Code status bar, or run the command `Claude Hadouken: abrir a janela`, to open the settings window. Everything hadouken lets you change is there, with no file to edit (the window is in Portuguese):

| Tab | What it changes |
|---|---|
| Guarda | Turns the guard on and off, chooses between asking and blocking, and changes its ceilings (see [Usage guard](Usage-guard)). |
| Barra | The colour bands for context and cache in the status bar. |
| Alertas | How early the projection notices arrive. |
| Aprendizado | Turns [local learning](Learning) on and off. |
| Painel | The new-version notice and the logo animation. |
| Roteamento | The [model and effort routing](Usage-guard#model-and-effort-routing) rules. |
| Proteções | The four blocks you can turn off (see [Protections](Limits#protections)). |
| Saúde | The [PC health](PC-health#bands) bands and the on/off switch of each piece. |

- **Salvar** (save) is enabled only when there is a valid change; when disabled, it says why. A number out of range is flagged when you leave the field.
- **Desfazer** (undo): after saving, a bar offers undo for 15 seconds.
- **Loosening** the guard or turning a protection off shows, next to the field, what then applies.
- **Changed elsewhere:** if the configuration changed while the window was open (through `/hadouken:limites` or another window), the new values are loaded and your draft stays.
- **New version:** when a hadouken release comes out, VS Code tells you once, with an **Atualizar** button that opens a terminal with the update command. Turn it off in the Painel tab.
- **Motion:** the logo animates on opening; with "reduce motion" in the system, or with the animation off in the Painel tab, it stays still.

### PC now

Since v0.5.5, right below the Uso section, the window shows the [PC health](PC-health) in a section titled "PC agora":

- one bar per measure: RAM, GPU, CPU and disk, plus the battery when there is one. The urgency colours are the same as the usage bars, and the urgency is also written out. A measure with no reading says it is not available on this PC;
- the age of the reading, and a `LEVE` tag while light mode is on;
- in the red RAM band, a box listing the apps whose closing frees the most memory. You are the one who closes them;
- a button to turn light mode on for 4 h, or back off. It shows only when something is in alert or the mode is on;
- at the end, a one-line summary of hooks, repairs, compatibility and conflicts. The details are in `/hadouken:saude`.

In the VS Code status bar, the item gains a `PC: RAM 94%` or `PC: GPU 89°C` segment while that measure is in its band, and `leve` while light mode is on. The window only reads `saude.json`, so opening it never starts a collection.

---

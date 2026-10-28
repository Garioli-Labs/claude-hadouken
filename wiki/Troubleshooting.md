# Troubleshooting

[Português](Problemas-comuns)

## Where the data lives

In `~/.claude/hadouken/` (or in `HADOUKEN_HOME`), outside any repository:

| File | Purpose |
|---|---|
| `estado.json` | Latest limits reading, saved by the bar, the data of each active session and the short history of readings that feeds the notices' projection (up to 90 points, one every 2 minutes, 3 hours). |
| `uso-oficial.json` | The panel's latest `/usage` reading (5 h, week and Fable, with the reading time), its status and, if any, the 24 h cost block. |
| `uso-oficial.lock` | The panel's read lock: it exists only during a read, so two VS Code windows do not read at the same time. |
| `uso-cwd/` | Empty folder where the panel's `claude` read runs. |
| `painel/` | The built panel extension (`.vsix`), the record of the installed version (`instalado.json`) and of the last attempt (`tentativa.json`). |
| `alertas.json` | Last band announced per window, so no notice repeats. |
| `projecao.json` | Projection bands already announced in each session, so the projection notice does not repeat (up to 256 sessions). Created only when there is something to keep; content out of format becomes empty memory. |
| `historico.jsonl` | One line per finished session, with its last reading. |
| `config.json` | Optional: GitHub repos. You create and edit it. |
| `indice-transcripts.json` | Incremental index that speeds up the report. |
| `github-cache.json` | Actions runs that already completed. |
| `ativas/` | One file per session that loaded the plugin (the activation registry); files idle for more than 30 days are deleted automatically. |
| `bin/` | Stable scripts called by the bar, the commands and the VS Code panel (`painel.mjs`), rewritten on every new session. |
| `otel/` | Only with learning on: the Collector (`bin/`, with its hash in `bin/instalado.json`), the generated configuration (`config.yaml`), the filtered telemetry (`telemetria.jsonl`, rotated), the PID, the startup log, the startup lock (`subindo.lock`) and the record of what `ligar` put into `settings.json` (`ligado.json`). |
| `aprendizado.json`, `ajustes.json`, `sugestoes.json` | Only with learning on: the aggregates (26 weeks), the adjustments in force with a record of each one, and the suggestions. |
| `aprendizado-cursor.json`, `aprendizado-eventos.json`, `aprendizado.lock` | Only with learning on: how far the telemetry has been read, the latest events (port busy, low memory…) and the one-step-at-a-time lock. |
| `guarda.json` | The guard (v0.4.0): the tripped locks, each with its trigger and the window's reset. |
| `liberacao.json` | The active release, written only by the typed `/hadouken:liberar`. |
| `guarda-eventos.json` | The guard's 200 newest events (trips, denials, releases, config changes blocked, errors), with fixed labels and numbers only. Feeds "Guarda (7 dias)". |
| `despachos-fable.json` | The instants of the Fable dispatches in the last 24 h, for G7 (up to 200). |
| `limites-atingidos.json` | The last Fable limit reached and the last general one. |
| `modelos.json` | Each session's model (up to 50), for P2 and P3. |
| `guarda-sessoes/` | One empty mark per session running the guard hooks; without it, the bar says "sem guarda nesta sessão" (no guard in this session). |
| `config-base.json` | The config P5 photo: hashes of `disableAllHooks`, `enabledPlugins` and `hooks` per session and settings file, never the content. Up to 600 entries and 512 KiB. |
| `indice-hooks.json` | The hook cost index: only numbers and command hashes, up to 6 MiB. It can be deleted; the next `/consumo` rebuilds it. |

You can delete the folder at any time; it is recreated on the next session, without history.

---

## Privacy and security

**Summary:**

- **No telemetry.** Nothing is sent to any service, including the plugin's author. The plugin never calls the Claude API. Local learning, optional and off by default, receives Claude Code's OpenTelemetry only on 127.0.0.1 and keeps it, filtered, in the data folder.
- **Network: `gh api`, read-only, and Claude Code's `/usage`.** The report runs `gh api <endpoint>` (always a GET) for the configured repos or for `origin`. The VS Code panel runs the official `claude -p /usage` command: Claude Code itself queries Anthropic, with your session, without calling the model. The plugin opens no connection of its own. With learning on, the only exception is the one-time Collector download from GitHub, with its SHA-256 checked.
- **No tokens.** The plugin never reads, asks for or stores a token or credential. The GitHub login belongs to `gh`. The "tokens" in the report are usage counts.
- **Transcripts: numbers only.** From transcripts, the index keeps relative paths, session and request ids, numbers, dates, model, effort and the project name. No conversation content. The hook cost index (v0.4.0) keeps only numbers and each hook's command hash, never the text a hook from any plugin printed.
- **Where it writes:** only in the data folder. The exceptions are the `statusLine` key of your `settings.json`, through the installer, with confirmation and a backup, and the panel extension, which the VS Code CLI installs in its extensions folder (can be turned off with `HADOUKEN_SEM_PAINEL=1`). Learning's `ligar` and `desligar` change only the telemetry keys in the `env` of `settings.json`, with the same writer and the same backup.

**The guarantee:** nothing the plugin reads (state files, transcripts, the status line input, GitHub responses, command arguments) ever becomes executed code, a shell command, an arbitrary path, a terminal sequence or an instruction carrying the plugin's authority in Claude's context. Every threat in the model (S1 to S9: tampered file, malicious text, terminal sequences, argument injection, malicious repo, tampered script, installer triggered behind your back, supply chain, huge file; and, for the panel, S26 to S28: the panel runs `claude`, the installer runs the VS Code CLI, a tampered `uso-oficial.json`; and, from v0.4.0, S29 and S30: other plugins' text in the report, the bar's repeated reading; and, for learning, L1 to L8: forged OTLP, swapped binary, identity leak, exposed port, corrupted `settings.json`, deleted `ajustes.json`, the download and the Collector's processes) has a defence and a test with synthetic malicious input.

**The honest limit:** no plugin can stop code that **already runs as your OS user**. A malicious skill that got that far can change any of your files, including `settings.json` and the plugin itself. What `hadouken` guarantees is that it does not widen that power, and that it restores its own scripts on every new session.

The full threat model, the environment variables and how to report a vulnerability privately are in [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md) (bilingual). Do not open a public issue for vulnerabilities.

---

## Performance

No plugin failure or slowness may stall Claude. Targets are measured, not assumed, with the benchmarks in `bench/` (`node bench/rodar-todos.mjs`):

| Operation | Target | Measured |
|---|---|---|
| Status bar (whole process), Windows | p95 ≤ 250 ms | 170 ms |
| Status bar (whole process), Linux/macOS | p95 ≤ 150 ms | Linux 49 ms · macOS 48 ms |
| Hook before each prompt, Windows | p95 ≤ 250 ms | 188 ms |
| Hook before each prompt, Linux/macOS | p95 ≤ 150 ms | Linux 56 ms · macOS 50 ms |
| Session start hook, Windows | p95 ≤ 250 ms | 176 ms |
| Session start hook, Linux/macOS | p95 ≤ 150 ms | Linux 57 ms · macOS 51 ms |
| Session end hook, Windows | p95 ≤ 250 ms | 151 ms |
| Session end hook, Linux/macOS | p95 ≤ 150 ms | Linux 46 ms · macOS 44 ms |
| Guard before dispatching a subagent (P1), Windows | p95 ≤ 250 ms | 161 ms |
| Guard before switching models (P3), Windows | p95 ≤ 250 ms | 162 ms |
| Plugin file guard (P5), Windows | p95 ≤ 250 ms | 146 ms |
| `/hadouken:liberar`, Windows | p95 ≤ 250 ms | 171 ms |
| Guard hooks, Linux/macOS | p95 ≤ 150 ms | to be measured in CI |
| `/hadouken:consumo`, index already built | ≤ 2 s | Windows 548 ms · Linux 207 ms · macOS 169 ms |
| `/hadouken:consumo`, index from scratch | ≤ 15 s | Windows 2.60 s · Linux 834 ms · macOS 623 ms |

- p95 of the worst scenario in each row. Windows measured on 2026-10-01, on an Intel Core i7-7700HQ (8 logical cores, Node 24) with VS Code open and about 22% background CPU (numbers may run slightly high); Linux and macOS on GitHub Actions runners (`ubuntu-latest` and `macos-latest`, Node 24), the CI `bench` job.
- The bar and the hooks are measured over 100 runs, from process start to exit, with a worst-case disk: 1,000 registered sessions, the state at its 50-session cap and a full reading history (90 points); for the hooks, both notice memories are full as well (`alertas.json` and `projecao.json`, the latter with the projections of 256 sessions). The worst case is rebuilt before every round, so it holds for the whole measurement.
- The report is measured over 500 MB of synthetic transcripts (216 files), with the same full state, and one repo answered by the fake `gh`, with no network.
- In the guard hooks, the worst case's 7-day forecast trips the guard: P1 denies dispatching a Fable subagent, P3 denies switching to Fable, P5 denies a write in the data folder, and `/liberar 2h` saves the release and its two events. P1 and P3 start every round with no release and no `guarda.json` (the fixture does not leave the lock saved), so they measure the evaluation that saves the lock, not the one that only reads it.
- The Windows target is higher because Node's startup alone, with no script at all, already takes 76 ms (p50) and 86 ms (p95) on the same Windows machine. The bar runs in the background and never blocks typing.
- v0.2.0 costs a little more than v0.1.0 on registered-session paths: +5.0 to +6.8 ms at p50 for the bar and the prompt hook, in a paired A/B of 200 pairs with both versions in the same folder (`bench/ab-raizes.mjs`). That is the work for several sessions at once (history, forecast, active-session count and projection notice). On unregistered-session paths it is the same or up to 3 ms faster. The p95 values stay well within target.
- v0.4.0 against v0.3.0, in the same paired A/B: +25.2 ms for the bar and +18.2 ms for the prompt hook on a registered session (median of the paired differences); on unregistered sessions, +0.9 ms for the bar and +0.1 ms for the prompt, within noise. The cost comes from the guard (lock, release and events read on every dispatch and prompt) and from the floor reading in the notices.
- The session start and end hooks run once per session and have the same target as the bar and the prompt hook. On top of the target, each hook has a ceiling in `hooks.json`: 10 s for the prompt hook and the guard hooks (PreToolUse, `/liberar`, P3 and the config P5, on `ConfigChange`), and 5 s for the session start and end hooks and the two that only record (model switch done and limit reached).
- The table's numbers were measured on v0.4.0, with the guard on in the hooks. The Linux and macOS columns of the rows that already existed are still the v0.2.0 ones, measured on 2026-09-27, until the `bench` job runs v0.4.0.
- `/consumo` now also builds the hook cost index (`indice-hooks.json`), incremental like the transcript one. On real data, on a machine with about 48 thousand hook runs per week, `/consumo` with both indexes from scratch took 7.4 s on Windows, within the 15 s target; the table's 2.60 s comes from the synthetic transcripts.
- The VS Code panel is outside these targets: it runs outside Claude Code, and its install leaves the session start in the background, without the hook waiting. Its cost is the lean `/usage` read, measured separately: 5 s and a 270 MB peak per read, every 30 s and only with an active session (see [No tokens, little RAM](VS-Code-panel-and-window#no-tokens-little-ram)).

Why the report is fast the second time: the transcript index is incremental and only re-reads what changed; completed GitHub runs are cached.

---

## Known limitations

- **No thinking column.** The API bills thinking inside output tokens, but the field that separates it does not come in every response in Claude Code's transcripts: in a local sample it came in almost every main-session response but in only 13 % of subagent responses, and sometimes larger than the output itself. Counting its absence as zero would present a floor as if it were the total. It is left for a later version, under the same rule as cache created ("no breakdown", never inferred).
- **GitHub minutes are an estimate** at list price, not the billed amount. The billing API needs the `admin:org` scope and is out of scope for this version.
- **github.com only.** `origin` is only recognised in the forms `https://github.com/…`, `git@github.com:…` and `ssh://git@github.com/…`.
- **Folders with characters outside the installer's list.** The bar command carries the data folder's path, and that path goes through a shell (sh; on Windows, Git Bash or, without it, PowerShell). So that no shell reads a character differently, the installer only accepts in it the letters A to Z, the Latin letters U+00C0 to U+024F (such as é, ç, ñ, ğ and ß; except the multiplication and division signs), digits, space and `/ : . _ - ( ) + , @ ~`. With a home folder in another script (Cyrillic, CJK) or containing `'`, `&`, `$` or `%`, the installer refuses (`caminho-inseguro`), changes nothing and shows the key to add by hand:

  ```json
  "statusLine": { "type": "command", "command": "node \"<pasta de dados>/bin/statusline.mjs\"", "padding": 0, "refreshInterval": 60 }
  ```

  Replace `<pasta de dados>` (data folder) with the full path, using `/` slashes, and check that your shell reads that path inside double quotes without interpreting anything.
- **Windows and PowerShell.** The skills' commands are the same in sh, bash, zsh and PowerShell (all of them expand `$HOME`). `git` and `gh` are only used as an `.exe` found in an absolute `PATH` entry, never in the current folder; `.cmd` and `.bat` do not work.
- **Node without ICU.** On a Node built without ICU (`--with-intl=none`), the plugin keeps working with stricter text cleaning: names in non-Latin scripts (and emoji) are removed from the bar and escaped in the JSON output.
- **`HADOUKEN_HOME` and the skills.** The skills always call `node "$HOME/.claude/hadouken/bin/cli.mjs"`. With `HADOUKEN_HOME`, the command lives in `$HADOUKEN_HOME/bin/cli.mjs` and the skills cannot find it; run it directly, for example `node "$HADOUKEN_HOME/bin/cli.mjs" consumo`.
- **The bar does not adapt to the terminal width.** Claude Code hands the bar's output over a pipe without saying how wide the terminal is, so the bar cannot know what fits and cuts nothing. In v0.3.0 the line got short, 53 columns in the example (more with a long model name); in a terminal narrower than that, the end is hidden or wraps, depending on the terminal. The `▰`, `▱` and `│` glyphs take one column; terminals or fonts that draw ambiguous-width characters as two columns (common with CJK settings) make the line wider.
- **Sessions opened before installation are not among the active sessions.** They never go through the plugin's registration, so they are left out of the panel's `Sessões ativas` and of the number in the projection notice. Their usage is in the account's percentages, and so in the projection and the forecast, and the report's "open sessions in the last hour" section shows them, because it reads the transcripts.
- **The notices' projection is a straight line.** It projects the pace of the last minutes (20 on the 5-hour window, 3 hours on the 7-day one) as if it stayed the same: a pause or a burst changes the projection on the next reading. It needs at least 3 readings covering 6 minutes, so it does not come out right at the start of a window or with the bar idle. The panel's forecast uses a different calculation, the average pace of the whole window, and so reacts slowly to a burst.
- **One account at a time.** Readings are not separated per account: with two accounts under the same OS user, the panel, the notices and the report use the most recent reading from either, and the panel's `/usage` reads the account `claude` is logged into. The projection's history is a single one too; since the two accounts have different resets, switching between them restarts the history on every switch, and the projection disappears until it gathers points again.
- **Fable depends on the `/usage` text.** The panel reads the English lines of `/usage` (`Current session`, `Current week (all models)`, `Current week (Fable)`) with fixed rules. If a Claude Code version changes that text, Fable shows `—` or the tooltip shows `Última leitura falhou (formato).` (last reading failed: format); 5 h and the week keep coming from the status line.
- **The panel needs `code` and `claude`.** Without the `code` command on `PATH` (on a Mac, without the app in `/Applications` or `~/Applications`), the extension does not install itself, and the session start says so in one line. Without `claude` in `~/.local/bin` or on `PATH` (on Windows, only `claude.exe`, never `.cmd`), Fable has no reading and the tooltip says `claude não encontrado em ~/.local/bin nem no PATH.` (claude not found).
- **Worktrees** of the same project show up as separate projects (the project is the folder name).
- **The plugin does not switch model or effort.** The official documentation does not allow switching models mid-session from outside, and switching mid-session wastes the cache. The plugin measures and notifies; the decision is yours.

---

## Uninstalling

**1. Remove the bar before uninstalling the plugin.** In a terminal (or inside Claude Code, prefixed with `!`):

```bash
node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover
```

It removes **only** the hadouken bar, with a backup. If the file's `statusLine` is someone else's, it touches nothing. This command needs the plugin installed, which is why it comes first; `/hadouken:instalar` also reminds you of it when it finishes. If you added the bar by hand (the `caminho-inseguro` case), delete the `statusLine` key by hand.

**2. Remove the VS Code panel.** In a terminal:

```bash
code --uninstall-extension gariolilabs.claude-hadouken-painel
```

Then reload every open VS Code window (`Developer: Reload Window`): the item stays in them until the reload.

**3. Uninstall the plugin and, if you like, remove the marketplace:**

```text
/plugin uninstall hadouken@claude-hadouken
/plugin marketplace remove claude-hadouken
```

In a terminal: `claude plugin uninstall hadouken@claude-hadouken` and `claude plugin marketplace remove claude-hadouken`.

**4. Delete the data, if you like:**

```bash
rm -rf ~/.claude/hadouken
```

In PowerShell: `Remove-Item -Recurse -Force "$HOME\.claude\hadouken"`. The `settings.json.bak-hadouken-*` backups sit next to your `settings.json`; delete them too if you no longer need them.

Skipped step 1? Without the plugin, the bar is simply empty, with no error messages. Remove the `statusLine` key from `settings.json` by hand. Skipped step 2? Without the plugin, the VS Code item stays at `Hadouken: abra uma sessão do Claude Code` (open a Claude Code session) and reads nothing more; run the step 2 command whenever you like.

---

## FAQ

**I updated and the status bar vanished, or `claude-hadouken not found` showed up.**
In v0.5.2 the plugin changed its name, from `claude-hadouken` to `hadouken`, and has to be installed once under the new name. In the terminal, run `claude plugin install hadouken@claude-hadouken` and open a new session. Running the one-line install command again also fixes it (see [One command](Home-en#one-command)).

**hadouken blocks too many commands.**
First, update: before v0.5.4, any command that mentioned the folder of a project named `claude-something` (like `claude-hadouken`) together with `node`, `bash` or another launcher was taken for a child `claude` session and denied. If it still blocks, the block message says which protection acted; turn off just that one in the Proteções tab of the VS Code window or with `/hadouken:limites protecoes.<item> desliga` (see [Protections](Limits#protections), with the risk of each). For the usage guard, change the ceilings in the Guarda tab or release it for a while with `/hadouken:liberar`.

**What does "no reading" (*sem leitura*) mean?**
That the plugin has no trustworthy number right now and would rather say so than show a stale value as current. It happens when the last reading is more than 1 hour old, when the reset passed without a new reading, when the state file is out of format, or before the first API response. The bar receives the limits along with API responses, and the panel also reads `/usage` every 30 s while a session is active: just keep working, or click the panel item.

**Why does the panel show `Hadouken: sem leitura` all the time?**
Your account does not send limits to the status line (API key, or a plan without limits), and `/usage` does not bring the usage lines. Everything else (bar, token report) works normally, and the report says the limits are unavailable on this account (*Limites indisponíveis nesta conta*). If only Fable stays at `—`, the tooltip says why: there has been no official reading yet, `claude` was not found, or reading is paused or blocked.

**Where did the bar's 5h and 7d go?**
To the VS Code panel, since v0.3.0. They belong to the account, the same in every session, and the bar kept only what belongs to each session. See [The VS Code panel](VS-Code-panel-and-window#the-vs-code-panel).

**My open session does not show the bar. Is it broken?**
No, that is by design: only sessions started after installation use the plugin. In an old session, the bar command prints nothing and the hooks stay silent, so work already in progress does not change behaviour. Start a new session. (An empty bar is this; `—` in a segment is something else: the session belongs to the plugin, but that piece of data has not arrived yet.)

**Why can the numbers differ from `/usage` or from Anthropic's console?**

- **Limits:** the panel uses the newer reading between the status line and `/usage` (read every 30 s), rounded down, so it should match the claude.ai Usage tab, up to about 30 s behind. The notices and the report use the status line reading, the latest one that arrived (up to 1 hour old).
- **Tokens:** the report only sees Claude Code's transcripts **on this machine**. Usage on claude.ai, in the app, on another machine or straight through the API does not show up in the tables, but it counts toward the account's limits. Transcripts Claude Code itself has already deleted drop out of the count too.
- **Anthropic's console:** it shows the organisation's API key usage, which is something else: on Pro and Max plans, subscription usage does not go through it.
- **GitHub minutes:** a list-price estimate, not the billed amount.

**What data leaves my machine?**
None, except the `gh api` queries (always GET, read-only) the report makes to the configured repos, or to `origin`, using your `gh` login, and the usage query Claude Code itself makes when the panel runs `claude -p /usage`. No telemetry, no calls to the Claude API. Details in [Privacy and security](#privacy-and-security).

**How do I uninstall?**
In four steps: remove the bar (`node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover`), remove the panel (`code --uninstall-extension gariolilabs.claude-hadouken-painel`), uninstall the plugin (`/plugin uninstall hadouken@claude-hadouken`) and, if you like, delete `~/.claude/hadouken`. The full walkthrough is in [Uninstalling](#uninstalling).

**The report says "plugin files not found - open a new session".**
The plugin was updated and the old version left the disk. The next session repoints the scripts to the version in use.

**Does it work on Windows? And in VS Code's terminal?**
Yes. The bar is a command that Claude Code runs wherever it is open, including VS Code's integrated terminal. The panel is a VS Code extension; on Windows, it needs `code.cmd` on `PATH` to install itself and `claude.exe` to read Fable. CI runs the tests on Linux, Windows and macOS, with Node 20 and 24 (the kit robot, with 20, 22 and 24), and paths with spaces and accents are covered by tests.

**I have several sessions open in VS Code. Does the plugin take all of them into account?**
Yes, in two ways. The 5-hour, week and Fable percentages already belong to the whole account, adding up every session (in VS Code, another terminal or another machine), and the panel shows them once, with the forecast and the projection coming from them. The panel tooltip also shows how many plugin sessions are active right now (`Sessões ativas: 3`), and the projection notice takes that number to Claude, which can reduce parallelism. The plugin does not tell VS Code sessions apart from other terminals: it counts every Claude Code session on this machine that started after installation. See [Projection and several sessions](Warnings-and-alerts#projection-and-several-sessions).

**How much does it cost?**
The plugin is free and open source (MIT). It never calls the Claude API; its token cost is the short lines injected into the context: the session-start one and the notices, only when a band or mode changes or when the projection enters a band. The panel spends no tokens: `/usage` is a local command, and every read checks `num_turns` 0 and cost 0. The GitHub calls are API reads and do not spend Actions minutes.

---

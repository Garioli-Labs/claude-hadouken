# Usage guard

[Português](Guarda-de-consumo)

## The usage guard

Since v0.4.0, hadouken locks spending where it starts: at the subagent dispatch, at Fable use and at the expensive dispatch. The lock stays until **you** release it with `/hadouken:liberar`, or until the reset of the window that tripped it; since v0.5.4, while it is active, hadouken asks before denying what is your decision (see [Ask instead of block](#ask-instead-of-block-default-since-v054)). A release only counts when you type it in the conversation: a child `claude` session, a scheduled task, a `/loop` or a routine does not release. Claude does not release itself without forging hadouken's files or tampering with the plugin itself; the guard is a brake against carelessness, not a barrier against a model set on getting around it (see R1 in [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md)).

### What locks

| Trigger or protection | When | What it blocks |
|---|---|---|
| G1 | the 5h window projects 100% within 90 min, with the reset at least 15 min away | every subagent dispatch, the switch to Fable and, in a Fable session, the prompt |
| G2 | the week projects 100% within 24 h, with at least 2 h of readings | the same |
| G3 | the 5h window at 90% or more, with the reset at least 15 min away | the same |
| G4 | the week at 85% or more | the same |
| G5 | expensive dispatch: effort `max` on any model, or Fable at `xhigh` or `max` | that dispatch |
| G6 | the Fable limit was reached (Claude Code's limit notice, or the official Fable week reading at 100%, at most 15 min old) | Fable dispatch, the switch to Fable and the prompt in a Fable session |
| G7 | the fifth Fable dispatch in 5 h, or any Fable dispatch with the Fable week at 90% or more (official reading at most 15 min old) | the same |
| P4 | any active lock | opening a child `claude` session through Bash or PowerShell (directly or through `npx`, `node`, `bash`, `sh`, `cmd`, `pwsh`, `powershell` and, in PowerShell, `Start-Process`) |
| P5 | always, even with the guard off | editing hadouken's data folder (`~/.claude/hadouken`) with Write, Edit, MultiEdit or NotebookEdit |
| P5 (settings and plugin) | always, even with the guard off | editing with those tools the user's `settings.json` and `settings.local.json` (in `~/.claude` and in `CLAUDE_CONFIG_DIR`) and the plugin itself (its root and `claude-hadouken` under `plugins/`); in project settings, only an edit that changes the value of `disableAllHooks`, `enabledPlugins` or `hooks` (P5 applies it to the current file and compares) or that adds or removes one of those words or `claude-hadouken` and, in a file that already has one of them, a Write or the replacement of a short stretch (under 40 characters). Above 1 MiB, an edit that names `settings` or `hadouken` is denied without being read; one that names neither passes (SECURITY.md, R2). If the change is needed, you apply it by hand |
| P5 (config) | always, in a registered session, even with the guard off | a change to `disableAllHooks`, `enabledPlugins` or `hooks` in the user's `settings.json` or in the project's `.claude/settings.json` and `.claude/settings.local.json`, wherever it comes from (the regular P5 covers the edit tools first; Bash, PowerShell, you or another program land here). It is held only for the current session: the file on disk stays changed, and the next session reads it. Measured live only on the project settings; the user and local settings are covered by the code, with no live measurement |
| release | always, even with the guard off | a child `claude` session with `/hadouken:liberar` in its text; a scheduled task, a `/loop` or a routine (CronCreate, ScheduleWakeup, RemoteTrigger, and MCP schedulers with `cron`, `schedule`, `trigger` or `task` in the name) with `/hadouken:liberar` or, since local learning, `/hadouken:aprender` in its text |

The numbers can be tuned under the `guarda` key of `config.json` (the Fable 90% is `guarda.fable.tetoPct`). Loosening the configuration does not immediately lift a ceiling (G3, G4) that has already tripped; a projection lock (G1, G2) lifts on its own once the projection no longer holds (see below).

Since v0.5.4, a projection lock (G1, G2) lifts on its own when the projection no longer holds: with a fresh reading, no forecast of reaching 100%, or one beyond 1.5 times the horizon (135 min for G1, 36 h for G2). Before, a G2 tripped with the week at 37% stayed until the weekly reset. The ceilings (G3, G4) still last until the reset, because usage does not go down within the window. Each lift becomes a `projecao-solta` event.

When the official Fable reset cannot be read, a G7 lock has no set end: it stays until `/hadouken:liberar fable`.

**New hooks in project settings (v0.5.4).** When the edit only adds hooks (a new hook, a new event, or a wider matcher such as `compact` → `startup|resume|clear|compact`), without removing, disabling, narrowing or replacing any and without naming hadouken, P5 asks instead of denying: you check the diff and approve. The hook takes effect from the next session. With "Perguntar em vez de bloquear" (Ask instead of block) off, it denies as before.

**The config P5 (`ConfigChange` hook).** At the first start of each session, hadouken takes a photo of the three fields (`disableAllHooks`, `enabledPlugins` and `hooks`) of those three files: hashes only, in `config-base.json`. When Claude Code reports that one of them changed, the hook compares the file with its own session's photo and, if one of the three fields changed, holds the change for this session; other fields (`model`, `permissions` and the rest) pass. Claude receives:

```text
hadouken: bloqueado: uma mudança em disableAllHooks, enabledPlugins ou hooks nos settings não vale nesta sessão. Se foi o usuário, ela passa a valer na próxima sessão; o Claude não deve repetir a mudança.
```

(hadouken: blocked: a change to disableAllHooks, enabledPlugins or hooks in settings does not apply in this session. If it was the user, it takes effect in the next session; Claude must not repeat the change.)

- It is a hold for the session, not a protection of the file: nothing is undone on disk. Whoever changes those fields on purpose opens a new session. The guard is off from the next session on if the change turned hooks or the plugin off.
- A compact keeps the photo from the start, because it keeps the session id. Not measured: whether `/clear` and a `resume` in a new process keep the id. If `/clear` changes the id, a change held before it passes on the next write. A session opened after the change photographs the new file and accepts it.
- An unreadable settings file (invalid JSON, including comments or a trailing comma, over 1 MiB, or not a regular file) has every change held until the next session. Writing the file as plain JSON ends this.
- Not measured: whether Claude Code fires the same notice for its own writes. If it does, turning a plugin on or off with `/plugin`, editing a hook with `/hooks` or changing one of those fields with `/config` during the session is also held until the next session.
- Managed policy (`policy_settings`) and skill changes are left out. The limits are in R1 of [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md).
- Events go to `guarda-eventos.json`, with type `config-bloqueada` and the first field that changed (`disableAllHooks`, `enabledPlugins` or `hooks`), or `ilegivel` (unreadable), `sem-caminho` (project settings with no path) or `sem-sessao` (project settings with no valid session id). The hook's own failures go into the `erro` event, with `config-foto`, `P5:config` or `P5:config-sessao`.

**P5's double count on the user's settings.** Two rules of the `if` filter match the user's `settings.json`, so the hook runs twice on the same edit and records two `arquivo-negado` events. The deny is the same; only the count in "Guarda (7 dias)" doubles.

### Ask instead of block (default since v0.5.4)

With a G1 to G7 lock active, hadouken **asks** instead of stopping the turn, because spending more is your decision:

- Subagent dispatch from the main conversation (G1 to G4, G6, G7) and expensive dispatch (G5): Claude Code shows the approval prompt with the reason. Approved, that dispatch goes ahead; declined, the lock stays. The turn does not stop.
- Switching to Fable with `/model`: the picker asks for confirmation.
- Prompt in a Fable session: it passes, and Claude says in one line that `/model sonnet` costs less.
- Inside a subagent there is no one to ask: the new dispatch is still denied, without stopping the turn.
- In permission modes that approve on their own (for example `bypassPermissions`), Claude Code may accept the prompt without showing it. Not measured.

P4, P5 and the release rules do not change: they do not ask. Each question becomes a `perguntado` event (`P1:…`, `G5`, `P2:…`, `P3:…`). To go back to the old blocking, turn off **Perguntar em vez de bloquear** (Ask instead of block) in the window's Guarda tab, or run `/hadouken:limites guarda.perguntar desliga`.

### How to release

Approving a question lets only that request through. To lift the whole lock:

- `/hadouken:liberar`: releases for 2 h.
- `/hadouken:liberar 8h`: from 1 to 24 h.
- `/hadouken:liberar janela`: until the reset of the window that locked, at most 24 h.
- `/hadouken:liberar noite`: until the next 7 a.m., at least 15 min (since v0.5.6). Meant for leaving long work running overnight.
- Add `fable` to lift the Fable limit as well. After the limit, Fable may consume usage credits.
- Add `caro` to lift the expensive dispatch, for example before the final review of a block.

Every release ends early if the week rises 10 points. It applies to every session, because the limit belongs to the account. The bar shows "liberada até …" (released until …) while it holds, also next to a lock it does not cover.

### Loops and scheduled tasks with the guard locked

Since v0.5.6, when Claude schedules the next turn of a loop (`ScheduleWakeup`) or creates a scheduled task (`CronCreate`) while the guard is locked on the 5-hour or 7-day window, it gets a line with the reset time: waking up before that only spends quota. A `ScheduleWakeup` waits at most 1 h, so the guidance is to repeat the wait until the reset. For a fixed-interval task, the guidance is to switch to a `ScheduleWakeup` after the reset. Nothing is denied because of this; with an active release, the line does not show.

### What the bar says

- `guarda: 7d`: tripped, with the window or `Fable` (guard: 7d).
- `liberada até hoje 16:40`: an active release (released until today 16:40). With a lock it does not cover, both show: `guarda: Fable · liberada até hoje 16:40`.
- `liberação sem origem`: there is an active release with no record of who granted it, a sign of a hand-written file (see R1 in [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md)) (release with no origin).
- `guarda com erro`: the guard evaluation failed, or a guard hook recorded an error in the last 15 min. The call went through: the guard fails open, but visibly (guard with an error).
- `guarda desligada`: `"ligada": false` in `config.json` (guard off).
- `guarda sem leitura`: no limits reading; only G5, G6 and G7 apply (guard without a reading).
- `sem guarda nesta sessão`: the session was opened before the update (no guard in this session).
- `Fable 3/4 em 5h · semana Fable 57%`: in a Fable session, the dispatch count and the Fable week from the official reading (the same `/usage` as the VS Code panel), at most 15 min old (Fable 3/4 in 5h · Fable week 57%).
- `semana Fable ≥ 57% (leitura de 40 min)`: the official reading is older than 15 min; the number is a floor, and the guard does not use it (Fable week ≥ 57%, 40-minute-old reading).
- `sem leitura oficial`: there is no valid Fable reading (the panel has not read yet, paused on low RAM, or the file is out of schema), or it predates the Fable reset (no official reading).

**Open sessions only get the guard after `/reload-plugins` or a restart.**

### Protections you turn on and off

Besides the guard, hadouken has four fixed blocks: child `claude` session, hadouken files, hook changes, and liberar requested by a scheduled task. Since v0.5.4, each one can be turned off in the Proteções tab of the VS Code window or through `/hadouken:limites`. The table with the risk of each is in [Protections](Limits#protections).

## Model and effort routing

hadouken checks every agent Claude launches, and the main session, without calling any model:

- **Denies (N1):** a search agent (`Explore`, `hadouken:busca`) on Opus or Fable, or with effort `xhigh` or `max`.
- **Denies (N2):** `hadouken:busca` or `hadouken:mecanico` with the model switched to Opus or Fable at dispatch.
- **Warns (A1 to A3):** an agent on Fable or effort `max` when the agent file does not ask for it; an expensive agent with a search description; more than 5 short dispatches in 10 minutes.
- **Suggests for the session:** `/effort medium` or `/model sonnet` when nearly everything was simple work, `/effort high` when there are signs of difficulty; at most once every 30 minutes.
- **Optimizations:** a file read in full several times, a command with huge output, idle MCP servers, expensive fixed context, and suggesting `/compact` when context swells and the cache drops.

Each rule has its own on-off switch in the Roteamento tab of the window (`roteamento.negarN1`, `roteamento.negarN2`, `roteamento.avisos`, `roteamento.sugerirSessao` and `roteamento.otimizacoes.*` in `config.json`). A release through `/hadouken:liberar` also lifts N1 and N2 while it lasts.

---

# Warnings and alerts

[Português](Avisos-e-alertas)

## The notices Claude receives

The bar and the panel are for you. The notices are for Claude.

When a window changes band, the plugin puts **one short line in Claude's context**, before it reads your next prompt. The line does not show up as a chat message: you follow usage through the VS Code panel and `/hadouken:consumo`, and Claude takes the state into account (and may mention it). At the start of every session, it also receives the current usage in one line. And when, at the current pace, a window is going to hit 100 % before its reset, it gets a projection notice.

![Lines Claude receives: usage at session start (5h 42% resetting at 15:30, 7d 59% resetting Monday 28/09 at 22:00 and, at this pace, it does not run out before the reset) and one notice per band change: 5h at 74%, reset in 210 min: attention; 5h at 83%, reset in 210 min: serialise; 7d 78% against 65% expected: economy mode, with a pace of 1.5 points per hour, a sustainable pace of 0.4 points per hour and, at this pace, the end tomorrow at 02:40. Then, with 3 active sessions, the projection notice: 5h hits 100% at 12:50, before the 15:30 reset, with the sentence about asking the user before changing a plan they decided. Last, 5h at 91%: wrap up the current task, reset at 15:30 and, if the return is scheduled, set it for 15:32. A prompt in the same band produces no line.](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/avisos.svg)

The grey comment lines in the image are in Portuguese; in order they say: session start (SessionStart); prompt with 5h at 74%; next prompt, still at 76%: same band, nothing is injected; prompt with 5h at 83%; prompt with 7d at 78% (expected 65%), rising 1.5 points per hour; 3 active sessions, at the current pace 5h hits 100% at 12:50 (50 min from now); prompt with 5h at 91%.

### What changed in the notices in v0.4.0

The examples are from Saturday 26/09 at noon, with the 5-hour window resetting at 15:30 and the week on Monday 28/09 at 22:00.

- **A stale reading becomes a floor, and with no reading there are no stale numbers.** The status line reading counts as current for up to 1 hour. From 1 to 24 hours, with the reset still ahead, it becomes a floor, marked with its age: `5h em ≥ 83% (leitura de 3 h; reset em 210 min): serializar — sem Workflow nem subagentes em paralelo.` (5h at ≥ 83% (3 h old reading; reset in 210 min): serialise — no Workflow and no parallel subagents.) With neither a current reading nor a floor, Claude gets, once per session, how long there has been no reading and the last known mode, instead of stale numbers: `Consumo sem leitura nova desde qui 24/09 18:40; trate como o último modo conhecido (econômico).` (Usage has had no new reading since Thu 24/09 18:40; treat it as the last known mode (economy).) Before the first reading on this machine: `Consumo ainda sem leitura nesta máquina.` (Usage has no reading on this machine yet.)
- **Reset in minutes.** The attention and serialise lines say how long until the reset: `5h em 74% (reset em 210 min): atenção ao ritmo.` (5h at 74% (reset in 210 min): watch the pace.) With less than 15 minutes left, a change of pace does not pay off before the reset, and the line says so: `5h em 74% (reset em 10 min): sem mudança de ritmo.` (5h at 74% (reset in 10 min): no change of pace.)
- **Wrap up, with the return time.** The 90 % band gives the exact reset time and, for whoever schedules the return, the reset plus 2 minutes, so it lands in the new window: `5h em 91%: fechar a tarefa em curso e não abrir etapa nova; reset às 15:30 (o usuário vê as opções em /rate-limit-options). Se agendar a volta, marque 15:32.` (5h at 91%: wrap up the current task and open no new stage; reset at 15:30 (the user sees the options in /rate-limit-options). If you schedule the return, set it for 15:32.)
- **Unambiguous dates.** Outside the 5-hour window, times show as `hoje 15:30` (today), `amanhã 09:00` (tomorrow), `ontem 20:15` (yesterday) or, from two days on, with the day and date, `seg 28/09 22:00` (Mon 28/09). This also applies to the session-start line: `Consumo: 5h 42% (reset 15:30) · 7d 59% (reset seg 28/09 22:00); nesse ritmo, não esgota antes do reinício.`
- **Economy mode with the pace.** With at least 2 hours of readings, the economy mode line gives the week's current pace and the sustainable pace until the reset, in points per hour, and when the week runs out at that pace: `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação; ritmo 1,5 pt/h, sustentável 0,4 pt/h; nesse ritmo acaba amanhã 02:40.` (…; pace 1.5 pt/h, sustainable 0.4 pt/h; at this pace it runs out tomorrow 02:40.)
- **Resuming an idle session.** When you resume (`resume`) a session whose cache has probably expired, with 20 thousand context tokens or more, **you** (not Claude) see how many tokens Claude Code will write to the cache again: `hadouken: retomar reescreve ~35 k tokens de cache.` (hadouken: resuming rewrites ~35 k cache tokens.) The line goes as a message to the user, outside Claude's context, with no dollar value (the subscription does not charge per token). A `fork` does not show it.
- **Subagents stay quiet.** The session start inside a subagent produces no line, records nothing and does not change the parent session's recorded model.

The bands, modes and projection below drive the notices and the report's "Limites e ritmo" panel. The VS Code panel uses none of them: it shows the percentage, with its own colours, and the [forecast](VS-Code-panel-and-window#the-forecast) worded like claude.ai.

### 5-hour window: the bands

Anthropic limits Pro and Max accounts in 5-hour windows. Claude's behaviour changes by band:

| Usage | Band (as quoted) | What Claude starts doing | What you can do |
|---|---|---|---|
| below 70 % | normal | Nothing changes. | Nothing. |
| 70 % to 79 % | `atenção` (attention) | Watches the pace. | Avoid opening big new fronts. |
| 80 % to 89 % | `serializar` (serialise) | No Workflow and no parallel subagents. | One thing at a time. |
| 90 % or more | `fechar` (wrap up) | Wraps up the current task, opens no new stage and schedules the return for after the reset. | Leave the next stage for after the reset. |

### 7-day window: the expected pace and the modes

The account also has a weekly limit. For it, the plugin works out the **expected** value: how much you **would have used by now** if you spent the week evenly, hour by hour, until the reset. It is the yardstick for being ahead or behind, and it decides the mode.

#### The pace maths, with an example

The week has 168 hours. After *h* hours, the expected value is *h* ÷ 168 × 100 %.

In the example, the week resets Monday at 22:00, so it started **the previous Monday at 22:00**. It is now **Saturday, 12:00**.

1. Hours since the start: Monday 22:00 → Saturday 12:00 = **110 h**.
2. Expected: 110 ÷ 168 × 100 = 65.47 %, shown as **65 %** (rounded down).
3. Actual usage: **59 %**.
4. Distance: 59 − 65 = **−6 points**. That is within ±10, so the mode is **normal**.

The 10-point rule: the distance is usage minus expected, using whole numbers (rounded down). Only **going past** 10 points changes the mode. At the same time as the example:

| Usage | Distance | Mode |
|---|---|---|
| 76 % | +11 | economy |
| 75 % | +10 | normal |
| 59 % | −6 | normal |
| 55 % | −10 | normal |
| 54 % | −11 | slack |
| 91 % | (irrelevant) | read-only |

What each mode means:

| Mode | When | What Claude starts doing |
|---|---|---|
| normal | usage within 10 points of expected, up or down | Nothing changes. |
| economy (`econômico`) | usage more than 10 points **above** expected | Less volume and parallelism, without cutting tests, review or implementation effort. |
| slack (`folga`) | usage more than 10 points **below** expected | Invests the slack in quality (extra review, higher effort on specs and audits), not volume. |
| read-only (`só leitura`) | usage at 90 % or more **and** reset more than 24 h away | Read-only; recommends stopping. Overrides the other modes. |

Expected always stays between 0 % and 100 %, even if the machine's clock is ahead or behind. The maths is done in UTC; only the display uses the local time zone, so daylight saving time does not throw anything off. The expected value and the mode show up in the notices and in the report; the bar, the panel and the session-start line do not show them.

### Projection and several sessions

With several Claude Code sessions open at the same time (in VS Code or in any terminal), the same window is spent faster. Two of the plugin's counts deal with that: active sessions and the projection.

**What counts as an active session.** A registered session (one that started after the plugin was installed) that worked in the last 5 minutes: its bar refreshed and its transcript was written since the previous refresh. The bar also redraws while the terminal sits idle; without a transcript write that does not count, so an idle session drops out of the count within 5 minutes. A long command that writes nothing to the transcript for more than 5 minutes counts as idle until the next write. The count never goes above 50 (the session cap in `estado.json`) and is always a whole number. The plugin does not tell VS Code sessions apart from other terminals: it counts every Claude Code session on this machine that went through the registration. The number shows up in the panel tooltip (`Sessões ativas: 3`) and in the projection notice, when there are 2 or more.

**Sessions opened before installation are not counted.** They never go through the plugin's registration. Their usage is still inside the account's percentages, and so it is in the projection.

**How the projection is made.**

- On every refresh, the bar keeps the limits reading in a short history, in `estado.json`: at most one point every 2 minutes, up to 90 points (3 hours).
- The pace is the least-squares slope of the percentage against time: on the 5-hour window, over the points of the last 20 minutes; on the 7-day one, over those of the last 3 hours.
- The projection is now + (100 − current usage) ÷ pace. It needs at least 3 points covering 6 minutes or more with usage going up, and it only counts if it falls before the reset: if the reset comes first, there is nothing to warn about.
- The percentages belong to the whole account, so the pace already adds up every session, registered or not, on this machine or another.
- When the window changes (the reset time moved, or the percentage dropped more than 1 point), that window's history starts over: the projection never mixes two windows. Right after a change, or with the bar idle, the projection takes a few minutes to come back.
- A reading that carries one window but not the other also restarts the missing window's history. If Claude Code leaves `seven_day` out now and then, the 7-day projection keeps starting over and may never come out.

With the projection close, Claude gets the projection notice (see below), and the report shows how much each session weighed in the last hour (see [Open sessions in the last hour](Usage-report#open-sessions-in-the-last-hour)).

### When a notice is sent

- **Once per band change.** Entering `serializar` produces one line; later prompts in the same band produce nothing. The memory of what was already announced belongs to the account: a second session open in the same band does not get the same line again.
- **Starting in a calm band produces no notice.** The first reading of a window in `normal` stays silent.
- **Going down is announced too, once** (`5h voltou a 65%: faixa normal.`).
- **A new window lifts the restrictions.** If the previous window ended in a restrictive band, the new one starts with an explicit notice that the restrictions are lifted.
- **With no new reading, a single line per session:** `Consumo sem leitura nova desde qui 24/09 18:40; trate como o último modo conhecido (econômico).` That prompt gets no band line.
- **Projection, once per band, window and session.** With the 5-hour projection 60 minutes away or less (and before the reset), one line is sent; at 30 minutes or less, another. On the 7-day window, one line with the projection 24 hours away or less. Each band is sent once per window in each session: the projection leaving the band and coming back does not repeat the line, and a projection that is already in the 30-minute band when it first shows produces only that band's line. A new window starts without this memory. The line says how many sessions are active when there are 2 or more; with just one, it has no parenthesis. The band notices above do not change.

### Every line, as the code produces it

The numbers below are examples; the text is fixed.

| Situation | Line Claude receives | In English |
|---|---|---|
| Session start | `Consumo: 5h 42% (reset 15:30) · 7d 59% (reset seg 28/09 22:00); nesse ritmo, não esgota antes do reinício.` | Usage: 5h 42% (reset 15:30) · 7d 59% (reset Mon 28/09 22:00); at this pace, it does not run out before the reset. |
| Session start, with the 5 h read 3 hours ago | `Consumo: 5h ≥ 42% (leitura de 3 h; reset 15:30) · 7d 59% (reset seg 28/09 22:00); nesse ritmo, não esgota antes do reinício.` | Usage: 5h ≥ 42% (3 h old reading; reset 15:30) · 7d 59% (reset Mon 28/09 22:00); at this pace, it does not run out before the reset. |
| 5 h entered attention | `5h em 74% (reset em 210 min): atenção ao ritmo.` | 5h at 74% (reset in 210 min): watch the pace. |
| 5 h entered serialise | `5h em 83% (reset em 210 min): serializar — sem Workflow nem subagentes em paralelo.` | 5h at 83% (reset in 210 min): serialise — no Workflow and no parallel subagents. |
| 5 h entered serialise, with the reading from 3 hours ago | `5h em ≥ 83% (leitura de 3 h; reset em 210 min): serializar — sem Workflow nem subagentes em paralelo.` | 5h at ≥ 83% (3 h old reading; reset in 210 min): serialise — no Workflow and no parallel subagents. |
| 5 h entered attention or serialise less than 15 min before the reset | `5h em 74% (reset em 10 min): sem mudança de ritmo.` | 5h at 74% (reset in 10 min): no change of pace. |
| 5 h entered wrap up | `5h em 91%: fechar a tarefa em curso e não abrir etapa nova; reset às 15:30 (o usuário vê as opções em /rate-limit-options). Se agendar a volta, marque 15:32.` | 5h at 91%: wrap up the current task and open no new stage; reset at 15:30 (the user sees the options in /rate-limit-options). If you schedule the return, set it for 15:32. |
| 5 h went down to attention | `5h voltou a 75% (reset em 210 min): faixa atenção.` | 5h back to 75% (reset in 210 min): attention band. |
| 5 h went down to serialise | `5h voltou a 85% (reset em 210 min): ainda serializar — sem Workflow nem subagentes em paralelo.` | 5h back to 85% (reset in 210 min): still serialise — no Workflow and no parallel subagents. |
| 5 h went down to attention or serialise less than 15 min before the reset | `5h voltou a 75% (reset em 10 min): sem mudança de ritmo.` | 5h back to 75% (reset in 10 min): no change of pace. |
| 5 h went down to normal | `5h voltou a 65%: faixa normal.` | 5h back to 65%: normal band. |
| 5 h: new window after a restrictive band | `5h: janela nova em 3%, faixa normal — restrições anteriores suspensas.` | 5h: new window at 3%, normal band — previous restrictions lifted. |
| 7 d entered economy, with less than 2 h of readings | `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação.` | 7d 78% vs 65% expected → economy mode: less volume and parallelism, without cutting tests, review or implementation effort. |
| 7 d entered economy, with 2 h of readings or more | `7d 78% vs 65% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação; ritmo 1,5 pt/h, sustentável 0,4 pt/h; nesse ritmo acaba amanhã 02:40.` | 7d 78% vs 65% expected → economy mode: less volume and parallelism, without cutting tests, review or implementation effort; pace 1.5 pt/h, sustainable 0.4 pt/h; at this pace it runs out tomorrow 02:40. |
| 7 d entered slack | `7d 50% vs 65% esperado → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume.` | 7d 50% vs 65% expected → slack mode: invest in quality (extra review, higher effort on spec/audit), not volume. |
| 7 d back to normal | `7d 60% vs 65% esperado → modo normal.` | 7d 60% vs 65% expected → normal mode. |
| 7 d entered read-only | `7d em 91% com reset seg 28/09 22:00: só leitura; recomendar parar.` | 7d at 91% with reset Mon 28/09 22:00: read-only; recommend stopping. |
| 7 d: new window after a restrictive mode | `7d: janela nova, 1% vs 0% esperado → modo normal — restrições anteriores suspensas.` | 7d: new window, 1% vs 0% expected → normal mode — previous restrictions lifted. |
| 5 h: at the current pace, 100 % within 60 min, before the reset (and again within 30 min) | `hadouken: no ritmo atual (3 sessões ativas), 5h chega a 100% às 12:50, antes do reset das 15:30. Reduza o paralelismo ou serialize. Se isso conflitar com uma decisão explícita do usuário, pergunte antes de mudar o plano.` | hadouken: at the current pace (3 active sessions), 5h hits 100% at 12:50, before the 15:30 reset. Reduce parallelism or serialise. If this conflicts with an explicit decision by the user, ask before changing the plan. |
| 7 d: at the current pace, 100 % within 24 h, before the reset | `hadouken: no ritmo atual, 7d chega a 100% amanhã 09:00, antes do reset seg 28/09 22:00. Reduza o paralelismo ou serialize. Se isso conflitar com uma decisão explícita do usuário, pergunte antes de mudar o plano.` | hadouken: at the current pace, 7d hits 100% tomorrow 09:00, before the Mon 28/09 22:00 reset. Reduce parallelism or serialise. If this conflicts with an explicit decision by the user, ask before changing the plan. |
| No new reading (neither current nor floor) | `Consumo sem leitura nova desde qui 24/09 18:40; trate como o último modo conhecido (econômico).` | Usage has had no new reading since Thu 24/09 18:40; treat it as the last known mode (economy). |
| No reading at all on this machine | `Consumo ainda sem leitura nesta máquina.` | Usage has no reading on this machine yet. |
| Resuming an idle session with an expired cache (goes to the user, not Claude) | `hadouken: retomar reescreve ~35 k tokens de cache.` | hadouken: resuming rewrites ~35 k cache tokens. |

In the session-start line, the ending comes from the week's [forecast sentence](VS-Code-panel-and-window#the-forecast), shortened: `; nesse ritmo, esgota amanhã à noite` (at this pace, runs out tomorrow night), `; nesse ritmo, não esgota antes do reinício` (does not run out before the reset) or `; limite semanal atingido` (weekly limit reached). With no sentence (less than 30 minutes into the window, or zero usage), the line ends at the reset. A window with no reading shows as `5h sem leitura` or `7d sem leitura`, never as 0; with no reading in either, the session-start line is the no-new-reading one.

In the economy mode line, when the pace does not use up the week before the reset, the ending is `nesse ritmo não acaba antes do reset` (at this pace it does not run out before the reset). The pace does not show when the week is a floor.

At session start, if something goes wrong with the plugin itself, Claude gets one more fixed line, for example `hadouken: sessão não registrada (...); barra e alertas desligados nesta sessão.` (session not registered; bar and alerts off in this session) or `hadouken: barra indisponível (...)` (bar unavailable).

Every line is built only from validated numbers and fixed phrases in the code; no text read from a file goes into it. Notices never block the prompt: if anything fails in a hook, it exits silently (code 0) and Claude carries on normally. The guard is a separate thing: while it is tripped, it can block a typed prompt in a Fable session (see [The usage guard](Usage-guard#the-usage-guard)).

---

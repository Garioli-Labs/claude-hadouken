# Status bar

[Português](Barra-de-status)

## The status bar, segment by segment

The bar shows only what belongs to **this session**, in one line split into three pieces separated by `│`:

```text
Opus 5.5·high │ ctx ▰▰▰▱▱▱▱▱ 37% │ cache ▰▰▰▰▰▰▰▱ 92%
└─────┬─────┘   └──────┬───────┘   └───────┬────────┘
      1                2                   3
```

| # | Segment | What it means | Where the number comes from | Colour | What to do |
|---|---|---|---|---|---|
| 1 | `Opus 5.5·high` | Model and effort level of **this session**. | Claude Code sends it to the bar on every refresh. | No colour. | Check it before a big task: is this the model and effort you wanted? |
| 2 | `ctx ▰▰▰▱▱▱▱▱ 37%` | **37 %** of this session's context window is in use (3 of 8 squares). | Claude Code sends it to the bar. | Green below 70 %, yellow from 70 % to 84 %, red from 85 % on. | Yellow or red and about to change topic? A new session (or `/compact`) starts lighter. |
| 3 | `cache ▰▰▰▰▰▰▰▱ 92%` | **92 %** of what was sent to the model in this session came from the prompt cache. | Claude Code sends it to the bar. | Green from 80 % on, yellow from 50 % to 79 %, red below 50 %. | High is good: you reuse context instead of paying for it again. Low right at the start of a session is normal. |

The account limits (5 hours, week and Fable) are not on the bar: they are the same in every session and show up once, in the [VS Code panel](VS-Code-panel-and-window#the-vs-code-panel). On every refresh the bar still saves the 5-hour and 7-day reading that Claude Code sends along: the panel, the notices to Claude and the report all come from it.

### The little bars

Both percentages also come as a bar of 8 squares: `▰` is a full square, `▱` an empty one, and each square is worth 12.5 points.

- The maths rounds to the nearest square, with two guards: usage of 1 % or more never shows as empty (at least one square stays), and the bar is only completely full at 100 %.
- The bar is the same number in another shape: the percentage is still written next to it, and the colour comes from the number, never from the bar.
- An indicator with no reliable data shows `—`, with no bar.

### 1. Model·effort

- The name is what Claude Code shows for the model (up to 40 characters).
- The effort appears after the `·` only when it is one of the five known levels: `low`, `medium`, `high`, `xhigh` or `max`. With no recognised effort, the bar shows just the model name.
- Model, effort, context and cache always belong to **the session where the bar is shown**. Two open sessions can show different models.

### 2. Context (`ctx`)

The context window is how much conversation, files and tool results the model can take into account at once. `ctx 37%` means 37 % of it is in use in this session. The number comes from Claude Code itself. The fuller it is, the more every response carries; when you change topic, a new session is usually cheaper.

The colour warns when the context fills up (the ctx and cache bands are visual only: they send no notice to Claude):

| Usage | Colour |
|---|---|
| below 70 % | green |
| 70 % to 84 % | yellow |
| 85 % or more | red |

### 3. Cache (`cache`)

On every response, Claude Code sends the whole conversation to the model again. The **prompt cache** keeps the start of that conversation for a while, and later responses reuse it instead of processing everything again. Reading from the cache costs a fraction of the normal input price.

`cache 92%` is this session's cache hit rate, as Claude Code reports it: the higher, the more context was reused. In long sessions, 90 % or more is common. The number drops at the start of a session, after a pause longer than the cache lifetime, and after switching models (each model has its own cache). The report shows the same indicator per project, model and session; see [1 h and 5 min cache](Usage-report#1-h-and-5-min-cache-what-ttl-means).

The colour follows the hit rate:

| Cache hit rate | Colour |
|---|---|
| 80 % or more | green |
| 50 % to 79 % | yellow |
| below 50 % | red |

Red at the start of a session, or right after switching models, is normal: the cache is still being built.

### The bar in other situations

![Six states of the bar: ctx 76% in yellow; ctx 88% in red; cache 64% in yellow; cache 31% in red, with ctx 4%, at the start of a session; an unknown effort, with just the model name; and a session with no data yet, showing dashes and no bars](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/barra-estados.svg)

The grey comment lines in the image are in Portuguese; in order they say: ctx from 70 % to 84 %, context filling up (yellow); ctx at 85 % or more, context almost full (red); cache hit rate from 50 % to 79 % (yellow); cache hit rate below 50 %, start of a session or model switch (red); effort outside the five known levels, just the model name; new session before the first response (no data yet).

### When `—` shows up, and when the bar is empty

**`—` means "no reliable data right now", never zero.** On the bar it shows up in `ctx` or `cache` when:

- Claude Code has not sent the number yet, as in a new session before the first response;
- the value received is not in the expected shape (for example, a percentage outside 0 to 100).

**An empty bar is something else.** In a session opened **before** the plugin was installed, the bar command prints nothing, on purpose: the plugin only acts in sessions that started after it. Open a new session. See [Installation](Home-en#installation).

### Rules for the whole bar

- **Only the session.** Model, effort, context and cache belong to each session: two open sessions each show their own. What belongs to the account is in the [VS Code panel](VS-Code-panel-and-window#the-vs-code-panel).
- **Percentages are rounded down.** 89.6 % shows as `89%`, and the colour comes from that same whole number, so the number and the colour never disagree.
- **Colour only on `ctx` and `cache`**, and only these: green, yellow and red. The colour covers the whole segment, bar included; the model has no colour. The [`NO_COLOR`](https://no-color.org/) variable (set and non-empty) turns colours off; the bars stay.
- **Width.** The example line is 53 columns; a long model name (up to 40 characters) makes it wider. The bar does not cut itself to fit: see [Known limitations](Troubleshooting#known-limitations).

---

# hadouken-kit and hadouken-rea

[Português](Kit)

## hadouken-kit and hadouken-rea (optional)

The `claude-hadouken` marketplace carries two more plugins, separate from usage and the guard. **hadouken-kit** installs the daily skill set in one go: `hadouken`, `superpowers` (`claude-plugins-official`), `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` and `ui-ux-pro-max` (these four as entries in the `claude-hadouken` marketplace itself, with a pinned commit). It also brings the `hadouken-kit:fluxo` skill, which says which one to use at each step, and copies of `yu-ux-web-expert` and `graphify`. If you only want usage and the guard, install only `hadouken`.

In the terminal (outside a session, or with `!` inside one):

```bash
claude plugin marketplace add Garioli-Labs/claude-hadouken
claude plugin marketplace update claude-hadouken
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install hadouken-kit@claude-hadouken
```

- **Why the `marketplace add` lines first.** The first one registers the hadouken marketplace (if you already have v0.4.0 it says "already" and moves on; `update` brings the kit's entry). Claude Code only installs a dependency from a marketplace that is already registered. Without it, the kit installs with the warning `dependency "<name>" was not installed (no marketplace you have added lists it)` and does not load.
- **Outside a session.** Installing or enabling a plugin inside an open session is held by the guard's `ConfigChange` hook. Run the commands in the terminal and open a new session.
- **Skills at the right moment.** Each session, the kit puts a 5-line summary in context (about 400 tokens, no model call) with the moment of each skill: `superpowers` runs the process and the Matt Pocock skills come in at their moments (stress-testing a plan, prototype, spec, tickets, handoff, branch review, PR body, steps only you can do, module design, domain, research, triage, teaching). Claude fires on its own the ones the author lets the model invoke; the other 16 (`to-spec`, `to-tickets`, `handoff`, `triage`, `teach` and more) have `disable-model-invocation`, and at their moment Claude suggests you type the command (`/mattpocock-skills:handoff`, for example). The full table, with all 27 Matt skills (mattpocock-skills 1.3.1), is in `/hadouken-kit:fluxo`.
- **Already had `mattpocock-skills`?** The map follows 1.3.1 (27 skills). If you installed it before, you stay on the cached version until you update; in 1.2.0, `pr` and `wizard` do not exist and Claude cannot find them. Since v0.5.2, the kit brings the copy from the `claude-hadouken` marketplace; run the one command (which handles the duplicate with the old copy, `mattpocock-skills@mattpocock`; see [Dependencies and duplicate copies](#dependencies-and-duplicate-copies)) or, in the terminal, `claude plugin marketplace update claude-hadouken` and `claude plugin update mattpocock-skills@claude-hadouken`, then open a new session.
- **clean-architecture is out of the kit.** Since 2026-10-14 its `plugin.json` is a symbolic link. On Windows, git checks the link out as text and the install fails with `JSON parse error: Unexpected token '.'`; as a dependency, it would take the whole kit down. On Linux and macOS, install it separately: `claude plugin marketplace add nathankim0/clean-architecture-skills` and `claude plugin install clean-architecture@clean-architecture-skills`.
- **yu-ux-web-expert.** The first time, its `setup.sh` installs `axe-core` and `lighthouse` (from the kit's `package-lock.json`) in the plugin folder, `playwright` in the user's Python and Chromium in Playwright's cache; `axe-core` and `lighthouse` are installed again after each kit update, because the folder changes with the version. The kit's copy does not grant Bash, Write, Edit or WebFetch without asking (`allowed-tools: Read Grep Glob`): it reads third-party pages, and every command goes through your permission.
- **REA, off by default when installed by hand.** The one-command installer turns it on only on the first install, if Node fits; if you turn it off, it stays off. To turn it on by hand: `claude plugin install hadouken-rea@claude-hadouken` and `claude plugin enable hadouken-rea@claude-hadouken`. It opens `npx -y rea-agents@6.1.0 mcp` (exact version; on Windows through `cmd.exe /d /c`) with its working directory in the plugin folder, never the open project (a repository's `node_modules` or `.npmrc` does not come in); give the REA absolute paths. It needs Node 22.19+, 24.11+ or 26+, and **runs the programs it analyzes with your user's permissions**. The first time, `npx` downloads the package (about 20 to 30 s) and `/mcp` may report a timeout; once the package is cached, it connects in seconds (reconnect from `/mcp` or open a new session).
- **Versions and automatic updates.** The kit's third parties (`mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` and `ui-ux-pro-max`) are entries in the hadouken marketplace with a pinned commit (`sha`); `superpowers` stays in the official marketplace. The one-command installer turns on `autoUpdate` for the hadouken marketplace (in your `settings.json`, with a backup) and handles the duplicate copy of the third parties so skills do not show up twice (see [Dependencies and duplicate copies](#dependencies-and-duplicate-copies); nothing is uninstalled). Every Monday, a GitHub Actions robot checks the published versions: a new version of a third party or of `rea-agents` goes to a branch, the suite runs on Linux, Windows and macOS with Node 20, 22 and 24 and, all green, the robot publishes by itself (tag `kit-v<version>`); any red becomes an issue and nothing is published. A new `graphifyy` (pip) version only opens an issue. The kit only touches the network when yu-ux's `setup.sh` runs (npm, pip, Playwright) and the REA, when on, on the first `npx`.

## Dependencies and duplicate copies

Since v0.6.0 (kit 1.2.0), the `plugin.json` of `hadouken-kit` declares one dependency only: `hadouken` at version `>=0.6.0`. The five third parties (`superpowers`, `mattpocock-skills`, `poka-yoke`, `fullstack-dev-skills` and `ui-ux-pro-max`) left the manifest, because a disabled dependency takes the kit down; the one-command installer is what guarantees them. If you already have one of them from another marketplace, it does not become a duplicate copy.

- **Equivalent copy.** A plugin that is on in your user scope, from another marketplace, with the same name or the same origin (same repository and same subfolder). A copy that is off does not count.
- **The installer** (`curl … | bash`, `irm … | iex`), for each of the five:
  - there is an equivalent → it does not install;
  - the kit's copy and the equivalent are both on, the kit's came as a dependency of the kit itself, nothing else depends on it and the kit is 1.2.0 or newer → `claude plugin disable <plugin> --scope user`, checked against the list, with the notice "already installed via …; kit copy turned off";
  - both on, but you installed the kit's one → it does not turn it off: it says the two do the same thing and shows the command for you to run if you want;
  - another enabled plugin depends on the kit's copy → it does not turn it off, because `disable` would fail; the notice names who depends on it;
  - there is none and the third party is not installed → it installs it;
  - you turned it off → it does not turn it back on; it warns with `claude plugin enable <plugin>`;
  - kit below 1.2.0 → it warns and leaves things alone.

  It never uninstalls. If the equivalent copy's version differs from the one tested with the kit (`kit/testado.json`), the notice says both.
- **Every session**, `hadouken-kit` checks the same and shows one line per problem, with the command for the terminal (`no terminal: claude plugin …`): with the guard on, Claude does not run `claude` inside the session. If it cannot read the plugin registry, it stays silent, with no false notice. It does not write to `settings.json` and does not compare versions.
- **If a previous version turned the original copy off**, it stays as it is: v0.6.0 does not turn anything on or off because of that.

## Development ruler

At session start `hadouken-kit` injects the **ruler**: the list of work phases (idea, prototype, spec, audit, execution, test, review, mutation...) with the skill for each one. It only guides; you decide. `/hadouken-kit:regua` shows and changes it:

| Command | Does |
|---|---|
| `/hadouken-kit:regua` | Shows the active ruler and where it comes from (repo, global or default). |
| `/hadouken-kit:regua editar` | Claude builds the ruler with you, phase by phase, and saves a draft to `<OS temp>/hadouken/regua-rascunho.json`. Nothing takes effect until `aplicar`. |
| `/hadouken-kit:regua aplicar [--projeto]` | Validates the draft and saves it: without `--projeto`, to `~/.claude/hadouken/regua.json` (global); with `--projeto`, to the `regua` key of `<project root>/.claude/hadouken.json`. |
| `/hadouken-kit:regua padrao [--projeto]` | Removes the ruler of that level and falls back to the next one. |

**Precedence**: repo ruler, else the global one, else the default. The higher one replaces the other **entirely**, with no merging. When the repo ruler applies in place of yours, SessionStart shows a warning line. An unreadable or invalid file → warning and fall back to the next level.

**Project root**: `CLAUDE_PROJECT_DIR`; otherwise the nearest `.git`, walking up from the current directory; otherwise the current directory itself.

**Audit**: the "Auditoria da spec" and "Auditoria do diff" phases (agent `hadouken:auditor`) run when a mistake is expensive (production, money, authentication, real data, irreversible) or the change touches a public contract (API, schema, user config, hook, file format). Docs, renames and mechanical slices are out. A second round only counts if the spec changed materially.

**Mutation** (`hadouken-kit:mutacao`): at the end of the work, before the PR, run mutation testing only on the lines changed in the branch. Each survivor on a changed line is either killed with a test or justified in the PR; there is no fixed percentage score. Tool per stack: StrykerJS via `npx` (JS/TS, never a project dependency), mutmut (Python), Stryker.NET (.NET) and PIT (JVM); for anything else the skill says there is no known tool and asks you to choose.

---

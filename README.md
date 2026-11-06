# Fisi Dock

**A side panel for [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell): your session, ODD phases, RDD reviews, CI, agents, todo list and changes at a glance.**

Fisi Dock is a Pi package (an extension and a theme) that paints its own panel in Gentle Shell's fullscreen right rail, closes the prompt into a framed box and adds a compact strip and cards on narrow screens such as a phone over SSH. It never changes a Gentle Shell file, and `/fisi-dock off` gives Gentle Shell everything back.

> Fisi Dock is a community project. It is not an official Gentle Shell or Gentleman Programming project, and it is not endorsed by them.

```text
╭─ session ───────────────────────────────────╮
│ project  my-sample-app main ↑1              │
│ context                             6% used │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━┼━━━━━━━━━━┼━━━━━━ │
│ profile  claude                             │
│ cost     $0.012                             │
│ mcp      ● engram ● context7 ● github       │
╰─────────────────────────────────────────────╯
╭─ ODD ───────────────────────────────────────╮
│ ✓ exploring                            0:31 │
│ ✓ implementing                         1:12 │
│▎⡿ checking                             0:42 │
╰─────────────────────────────────────────────╯
╭─ agents ────────────────────────────────────╮
│ ✓ explore Map CI workflow                   │
│ ⠹ writer pin the Node version   opus · high │
╰─────────────────────────────────────────────╯
╭─ todo ──────────────────────────────── 3/7 ─╮
│ ✓ 3 done                            ▰▰▰▱▱▱▱ │
│▎⠹ Confirm CI is green                       │
│ ○ Commit workflow fix                       │
╰─────────────────────────────────────────────╯
```

(Sample data, from `node scripts/preview.ts 47`; in the terminal every section has its own color.)

## What you get

- **Side panel** in the fullscreen rail, one framed section each: `session` (project, branch, context meter, model profile, cost, MCP servers), `heads-up` (worktrees, unpushed commits, open plans), `ODD`, `RDD`, `CI` (GitHub Actions of the branch), `agents`, `todo` and `changes`. On short screens the least urgent sections step aside first.
- **Prompt box**: Gentle Shell's prompt framed, with the working label (`ODD exploring…`), the permission mode, the model and the effort on its top border.
- **Narrow screens and phones**: a one-line top row, a strip above the prompt, and compact agents and todo cards.
- **`/dock`**: the whole panel over the screen, scrollable with the arrows, the mouse wheel or a swipe.
- **`/fisi-dock on` | `off`**: switch it without uninstalling; the choice is remembered across restarts.
- **`Fisi-Dock` theme**: the panel's palette for the whole of Pi, optional.

Every section, row and data source is described in [docs/reference.md](docs/reference.md).

## Requirements

- **Gentle Shell** (the `gentle-pi` npm package). Fisi Dock is tested with **Gentle Shell 4.6.0**. It reads Gentle Shell's shared state by name and imports nothing from it, so on another version a part it no longer recognizes stops painting instead of breaking the session.
- **Node.js 22.19 or later** (the one Gentle Shell runs on).
- **Fullscreen mode** for the side panel, with a terminal at least 140 columns wide; narrower terminals get the strip, the cards and `/dock`.
- Optional: **`git`** for branch, changes and heads-up; **GitHub CLI (`gh`)**, signed in, for the `CI` section; **Gentle AI** for the `RDD` switch. A missing tool only leaves its section out.

Works on Windows, macOS and Linux.

## Install

Install it into Gentle Shell from GitHub, so it loads every time Gentle Shell starts:

```bash
gentle-shell install git:github.com/fisidj/fisi-dock
```

Pin a release with `@<tag>`, for example `git:github.com/fisidj/fisi-dock@v0.1.0`. If you run Gentle Shell with `--link` (Pi's own home instead of the launcher's isolated one), install it there instead: `gentle-shell --link install git:github.com/fisidj/fisi-dock`.

Try it for one session without installing:

```bash
gentle-shell -e git:github.com/fisidj/fisi-dock
```

Then start Gentle Shell as usual. Fisi Dock is on from the first session; the `Fisi-Dock` theme is optional. To get it while keeping a way back to your theme, run `/fisi-dock off` and then `/fisi-dock on`: on remembers your theme and off puts it back. Picking `Fisi-Dock` in `/settings` works too, but then off has no theme of yours to return to and sets Gentle Shell's `Gentleman-Cute`.

As with any Pi package, Fisi Dock runs code on your machine: review the source before installing it.

## Use

| Command | What it does |
|---|---|
| `/dock` | Shows the full panel over the whole screen. ↑/↓, Page Up/Page Down, the mouse wheel or a swipe scroll it; Esc closes it. |
| `/fisi-dock on` \| `off` | Turns Fisi Dock on or off without uninstalling it, remembered across restarts. On switches to the `Fisi-Dock` theme and remembers yours; off gives Gentle Shell its panel back and puts your theme back. `/fisi-dock` alone opens a picker. |

The choice is saved in `<Pi agent dir>/fisi-dock/state.json` (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`).

## Update and remove

```bash
gentle-shell update git:github.com/fisidj/fisi-dock
gentle-shell remove git:github.com/fisidj/fisi-dock
```

`gentle-shell config` turns installed packages on and off without removing them.

## How it works

Fisi Dock takes over Gentle Shell's rail parts and top row through Gentle Shell's shared sidebar state and paints its own, and reads the rest from Gentle Shell's events, its ODD phase and profile registries, Pi's session and read-only `git`, `gh` and `gentle-ai` calls. It writes only its own `state.json` and, when you run `/fisi-dock`, your Pi theme setting. When it unloads, or with `/fisi-dock off`, Gentle Shell gets every original part back. Details: [docs/reference.md](docs/reference.md).

## Develop

```bash
git clone https://github.com/fisidj/fisi-dock
cd fisi-dock
npm install
npm test
```

Tests run on Node 22.19 or later with native TypeScript; no build step. `tests/gentle-shell-keys.test.ts` also checks the installed Gentle Shell (`GENTLE_SHELL_DIR`, else `gentle-pi` in the global npm root) still defines every key Fisi Dock reads, and is skipped without it.

Preview the panel with sample data in a terminal (width defaults to 47, the rail's usable width), or write an HTML page for screenshots:

```bash
node scripts/preview.ts 47
node scripts/preview.ts --html tmp/panel-47.html
node scripts/preview.ts 64 --strip
node scripts/preview.ts --dock
node scripts/preview.ts 64 --header
node scripts/preview.ts 58 --rows 28
```

`--strip` prints the narrow-screen strip, `--dock` the `/dock` box, `--header` the narrow top row, and `--rows <n>` the panel as it fits a terminal `<n>` rows tall. `tmp/` is git-ignored.

## License

[MIT](LICENSE)

# Fisi Dock

**A side panel for [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell): your session, ODD phases, RDD reviews, CI, agents, todo list and changes at a glance.**

Fisi Dock is a Pi package (an extension and a theme) that paints its own panel in Gentle Shell's fullscreen right rail, closes the prompt into a framed box, puts a welcome card on the start screen and adds a compact strip and cards on narrow screens such as a phone over SSH. It never changes a Gentle Shell file, and `/fisi-dock off` gives Gentle Shell everything back.

> Fisi Dock is a community project. It is not an official Gentle Shell or Gentleman Programming project, and it is not endorsed by them.

```text
╭─ session ───────────────────────────────────╮
│ where ──                                    │
│ project  my-sample-app  main ↑1             │
│ usage ──                                    │
│ context  ━─────────┼────┼── 6% · 12.1k/200k │
│ profile  claude                      $0.012 │
│ connections ──                              │
│ memory   ● engram    connected · 3 saved    │
│ mcp      ● context7  connected              │
│          ● github    connected              │
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

- **Side panel** in the fullscreen rail, one framed section each: `session` in three groups (`where`: project and branch; `usage`: context meter, model profile and cost; `connections`: Engram memory and MCP servers), `heads-up` (worktrees, unpushed commits, open plans), `ODD`, `RDD`, `CI` (GitHub Actions of the branch), `agents`, `todo` and `changes`. On short screens the least urgent rows and sections step aside first.
- **Start screen**: a welcome card in place of Gentle Shell's rose banner (Gentle Shell's version, the project and branch, the commands to begin with), and Pi's list of loaded skills, prompts and extensions folded into one `loaded` box under it. Your expand key (`ctrl+o` by default) shows Pi's full listing; Pi's warnings always show.
- **Prompt box**: Gentle Shell's prompt framed, with the working label (`ODD exploring…`), the permission mode, the model and the effort on its top border.
- **Narrow screens and phones**: a one-line top row, a strip above the prompt, and compact agents and todo cards.
- **`/dock`**: the whole panel over the screen, scrollable with the arrows, the mouse wheel or a swipe.
- **`/fisi-dock on` | `off`**: switch it without uninstalling; the choice is remembered across restarts.
- **`Fisi-Dock` theme**: the panel's palette for the whole of Pi, optional.

Every section, row and data source is described in [docs/reference.md](docs/reference.md).

## Adapts to your setup

| Your setup | What Fisi Dock does |
|---|---|
| Narrow screen or phone | The strip, cards and top row stand in for the rail. On the prompt box the labels compact step by step instead of vanishing: tight separators, then no effort, then the mode alone (the model alone in normal mode). Idle, the label's words give way first so the labels stay. Under 34 columns the welcome card keeps only its title and ready lines. |
| Gentle Shell in another language | The idle prompt label is told by how Gentle Shell paints it, not by its words, so a translated or custom label behaves the same. |
| No Engram | The `memory` row says `not installed`. With Engram, a failed `mem_*` call shows `unreachable` until the next one succeeds. Fisi Dock starts no process and asks no server. |
| No MCP servers | The `mcp` row says `none configured`. |
| Many MCP servers | The rail shows at most 4 `mcp` rows: problems first, then `+N more` with a count per state. `/dock` lists every server. |
| Remapped expand key | The `loaded` box names your key, from Pi's editor or Pi's `keybindings.json`; a key bound to nothing drops the hint. |
| Vim mode on | Gentle Shell's `INSERT`/`NORMAL` hint stays on the prompt's top rule and the labels compact to make room for it. With no room for both, the hint wins while working and the labels win while idle. |
| Reduced motion | Gentle Shell's `potato` animation level, or `FISI_DOCK_ORBS=off`, stills the orb and spinners. |
| No Gentle Shell | Fisi Dock stays out of the way: no rail, strip, cards, prompt box or welcome card, and Pi keeps its own startup header and listing. `/dock` still opens the panel. |

## Requirements

- **Gentle Shell** (the `gentle-pi` npm package). Fisi Dock is tested with **Gentle Shell 4.6.0**. It reads Gentle Shell's shared state by name and imports nothing from it, so on another version a part it no longer recognizes stops painting instead of breaking the session.
- **Node.js 22.19 or later** (the one Gentle Shell runs on).
- **Fullscreen mode** for the side panel, with a terminal at least 140 columns wide; narrower terminals get the strip, the cards and `/dock`.
- Optional: **`git`** for branch, changes and heads-up; **GitHub CLI (`gh`)**, signed in, for the `CI` section; **Gentle AI** for the `RDD` switch; **gentle-engram** (Gentle Shell's Engram package) for a connected `memory` row; MCP servers in Pi's `mcp.json` for the `mcp` rows. A missing tool only leaves its section out or says so in its row.

Works on Windows, macOS and Linux.

## Install

Install it into Gentle Shell from GitHub, so it loads every time Gentle Shell starts:

```bash
gentle-shell install git:github.com/fisidj/fisi-dock
```

Without a tag you follow the `main` branch. Releases will be tagged `vX.Y.Z` and listed on the [Releases page](https://github.com/fisidj/fisi-dock/releases) once published; there is none yet. To pin one, add `@<tag>` to the source: `gentle-shell install git:github.com/fisidj/fisi-dock@<tag>`. Pi keeps a pinned tag: updates do not move it.

If you run Gentle Shell with `--link` (Pi's own home instead of the launcher's isolated one), install it there instead: `gentle-shell --link install git:github.com/fisidj/fisi-dock`.

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

`gentle-shell update <source>` runs Pi's update for that one package: without a tag it moves to the latest `main`; pinned to a tag it stays on that tag. To move to another release, run `gentle-shell install` again with the new tag; Pi replaces the entry. `gentle-shell update --extensions` updates every installed package at once (`gentle-shell update` alone updates Pi itself).

`gentle-shell config` turns installed packages on and off without removing them.

## How it works

Fisi Dock takes over, and paints its own:

- Gentle Shell's rail parts and top row, through Gentle Shell's shared sidebar state;
- Gentle Shell's prompt editor frame, by wrapping its editor factory;
- Pi's startup header (the welcome card, through `ctx.ui.setHeader`) and the render of Pi's loaded-resources listing (the `loaded` box), only while Gentle Shell's `gentle:banner` command exists.

It reads the rest from Gentle Shell's events, its ODD phase and profile registries, Pi's session and tool list, and read-only `git`, `gh` and `gentle-ai` calls. The files it reads:

| File | For |
|---|---|
| Pi's `mcp.json` (global and the project's `.pi/mcp.json`) | the `mcp` rows; only server names and their on/off switch |
| Pi's `keybindings.json` | the expand key on the `loaded` box |
| Gentle Shell's `config.json` beside its agent home (`~/.gentle-shell/config.json` by default) | the version on the welcome card |
| Gentle Shell's `animations.json` | the animation level |
| Gentle Shell's subagent presence file | subagents already running after a `/reload` |
| The project's `odd/tasks/*.md` | open ODD plans in `heads-up` |

It writes only its own `state.json` and, when you run `/fisi-dock`, your Pi theme setting. When it unloads, or with `/fisi-dock off`, Gentle Shell and Pi get every original part back. Details: [docs/reference.md](docs/reference.md).

## Develop

```bash
git clone https://github.com/fisidj/fisi-dock
cd fisi-dock
npm ci
npm test
```

Tests run on Node 22.19 or later with native TypeScript; no build step. They need the dev dependencies (Pi's real TUI classes and its source), so run `npm ci` first, as CI does. `tests/configs.test.ts` drives Fisi Dock through simulated user configurations (another language, no Engram, ten MCP servers, Vim, a 30-column screen, a remapped or unbound expand key, no Gentle Shell) and checks every surface at every width from 0 to 140, against a fresh temp folder, never your own configuration. `tests/gentle-shell-keys.test.ts` also checks the installed Gentle Shell (`GENTLE_SHELL_DIR`, else the `gentle-pi` package Gentle Shell itself runs, found from its session environment or its `gentle-shell` launcher on `PATH`, pnpm or npm, else `gentle-pi` in the global npm root; among several, the version provisioned in `~/.gentle-shell/config.json`) still defines every key Fisi Dock reads, and is skipped without it.

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

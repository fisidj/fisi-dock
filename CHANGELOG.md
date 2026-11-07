# Changelog

## Unreleased

- Session section, grouped (design session-section/02): `where ──`, `usage ──` and `connections ──` labels instead of a flat list, one key column. The context meter and its `5% · 53.5k/1M` readout share a row (the readout moves under the bar on a 34-column rail), the filled cells in the state color and the empty ones a thin faint `─`; the cost sits flush right on the `profile` row. New `memory` row for Engram (gentle-engram's `mem_*` tools, not MCP): `○ not installed`, `● connected · N saved` from this session's successful `mem_save` calls, or `✗ unreachable` after a failed `mem_*` call until the next one succeeds; nothing is spawned. MCP servers get one row each (`● connected`, `◌ connecting`, `✗ failed`), and no MCP config says `mcp none configured`. On short screens the three labels are the first rows to go.
- Start screen: Fisi Dock's welcome card replaces Gentle Shell's rose banner: `Gentle Shell <version>` with `with Fisi Dock`, `Ready in <project> on <branch>.`, the five commands to begin with and the alt+k tip. `/fisi-dock off` gives the header back.
- Start screen: under the welcome card, Pi's list of loaded skills, prompts and extensions is one `loaded` box in the card's frame: one row per kind with its count and as many names as fit, and `ctrl+o lists them` on the bottom rule (Pi's expand key shows its full listing). Pi's warnings (`[Skill warnings]`, `[Prompt conflicts]`, `[Extension issues]`, `[Theme conflicts]`) always print under it. `/fisi-dock off` and session shutdown give Pi's own listing back, and a Pi listing of a shape Fisi Dock does not recognize is left as it is.
- Fix: on a phone the prompt box keeps the permission mode, model and effort while idle: too tight for them beside `waiting for input`, the rule drops the label's words and keeps the petal (`╭─ ✿ ──── ● SUPER-YOLO  opus-5.5 · high ─╮`), as it already fit them beside the shorter `working…`.
- Fix: the prompt box tells Gentle Shell's idle label by how it is painted (whole, not the working scan, not `queued`, an ODD phase or the `↑ 3 more` scroll indicator), not by the words `waiting for input`, so a translated, custom or clipped idle label (`waiting for i…`) also gives way to the labels on a phone.
- Narrow screens: the prompt box's labels compact instead of vanishing: tight separators (`● SUPER-YOLO opus-5.5·high`), then no effort (`● SUPER-YOLO opus-5.5`), then the mode alone (the model alone in normal mode), each tried beside Gentle Shell's hint first; working at 40 columns reads `╭─ ✿ working… ─ ● SUPER-YOLO opus-5.5 ─╮`. The line under the prompt compacts the same way before it is cut.
- Fix: the loaded box's hint names your real expand key when Fisi Dock cannot read it from Pi's editor: the `app.tools.expand` (or legacy `expandTools`) binding in Pi's `keybindings.json`, else Pi's default `ctrl+o`, instead of always `ctrl+o`. A key unbound with `[]` drops the hint.
- Tests: the Gentle Shell key check finds the package Gentle Shell itself loads (the one its launcher injects, else the `gentle-shell` launcher's own on PATH, pnpm included) before the global npm root, preferring the version provisioned in `~/.gentle-shell/config.json`; it no longer skips on a pnpm install, and still skips with no Gentle Shell (CI).
- Many MCP servers: the rail shows at most 4 `mcp` rows. With 5 or more, 3 servers keep a row, failed first, then connecting, then connected (config order within each), and the fourth sums up the rest: `+7 more · 2 connecting · 5 connected`, the counts dropping from the right on a narrow rail. `/dock` still lists every server.
- Fix: on Gentle Shell builds that card rail parts (its `main` branch, transparent surface) the panel no longer loses its right border to a `…`.
- Wordmark: the rail logo reads GENTLESHELL, joined, GENTLE gray and SHELL in Gentle Shell's Gentleman-Sexy pink (#F43888). It is drawn in braille dots (gray fade, Sexy pink to its deep pink #BF0F50): the 55-column rail gets the wide 51-column mark, the official 47-column rail the 45-column compact one (the same G, N and L, a narrower E, T, S and H), centered with one blank column on each side. Narrower rails show it as one bold text row, letters spaced (`G E N T L E S H E L L`) down to 21 columns and joined below.

## 0.1.0

First release.

- Side panel in Gentle Shell's fullscreen rail: `session` (project, branch, context, model profile, cost, MCP servers), `heads-up`, `ODD`, `RDD`, `CI`, `agents`, `todo` and `changes`, with short-screen shapes.
- Prompt box with the working label, permission mode, model and effort on its border.
- Narrow screens: top row, strip, agents and todo cards; `/dock` for the whole panel.
- `/fisi-dock on` | `off`, remembered across restarts; off puts your previous theme back.
- `Fisi-Dock` theme.
- Tested with Gentle Shell 4.6.0.

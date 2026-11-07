# Changelog

## 0.3.0

### Vivid labels

- The labels take the vividness of the cover title `#F43888`, each on its own hue: HSL saturation 90% and lightness 59%, lighter in steps of 0.01 (at most 0.80) only where a hue would read under 4.5:1 on the `#161616` background. One helper, `vivid` in `lib/palette.ts`.
- Panel section titles (`session`, `heads-up`, `ODD`, `RDD`, `CI`, `agents`, `todo`, `changes`) and the counters on their top rule (`3/7`, `on`, the agents card's count) draw vivid on the rail, in `/dock` and on the narrow-screen todo and agents cards. Frames stay gray, rows keep their colors, and gray counters (`1 to commit`, the CI sha, `off`) stay muted.
- On the prompt box, the permission mode and its dot (vivid red), the effort (vivid blue) and the clock wave on the working label (`ODD checking…`, vivid pink and lilac) draw vivid; the model stays muted. The line under the prompt paints the same labels, and the petal Fisi Dock turns with the wave takes the vivid theme tones, like the one Gentle Shell paints from the theme. Gentle Shell's own label and hint keep its colors; words, compaction and layout are unchanged.
- The `Fisi-Dock` theme's accents `pink`, `deepPink`, `teal`, `coral`, `amber`, `lilac`, `green`, `blue` and `red` take their vivid values (amber `#e0af68` -> `#f5a838`, blue `#7b9cff` -> `#4c76f6`, and the rest); neutrals and backgrounds stay.

## 0.2.1

### Project

- Published on npm: `gentle-shell install npm:fisi-dock`.
- `docs/screenshot.png`, a cover with the GENTLESHELL wordmark, the name and the ODD, agents and todo sections, set as the package's `pi.image` preview for the Pi package gallery. It stays in the repository and out of the npm package.
- The security policy says fixes reach `main` and the latest release.

## 0.2.0

### Start screen

- A welcome card replaces Gentle Shell's rose banner: `Gentle Shell <version>` with `with Fisi Dock`, `Ready in <project> on <branch>.`, the five commands to begin with (`/resume`, `/new`, `/changelog`, `/hotkeys`, `/quit`) and the alt+k tip. It shows only when Gentle Shell's `gentle:banner` command exists; without Gentle Shell, Pi keeps its own startup header and listing.
- Under the card, Pi's list of loaded skills, prompts and extensions is one `loaded` box in the card's frame: one row per kind with its count and as many names as fit, and `<key> lists them` on the bottom rule. The key is your real expand key: the one Pi's editor holds, else the `app.tools.expand` (or legacy `expandTools`) binding in Pi's `keybindings.json`, else Pi's default `ctrl+o`; a key unbound with `[]` drops the hint. Pressing it shows Pi's full listing.
- Pi's warnings (`[Skill warnings]`, `[Prompt conflicts]`, `[Extension issues]`, `[Theme conflicts]`) always print under the box. A Pi listing of a shape Fisi Dock does not recognize is left as it is.
- `/fisi-dock off` and session shutdown give Pi's own header and listing back.

### Session section

- Grouped (design session-section/02): `where ──`, `usage ──` and `connections ──` labels instead of a flat list, with one key column. On short screens the three labels are the first rows to go.
- The context meter and its `5% · 53.5k/1M` readout share a row (the readout moves under the bar on a 34-column rail); filled cells in the state color, empty ones a thin faint `─`. The cost sits flush right on the `profile` row.
- New `memory` row for Engram (gentle-engram's `mem_*` tools, not MCP): `○ not installed`, `● connected · N saved` from this session's successful `mem_save` calls, or `✗ unreachable` after a failed `mem_*` call until the next one succeeds. Nothing is spawned.
- MCP servers get one row each (`● connected`, `◌ connecting`, `✗ failed`); no MCP config says `mcp none configured`.
- Many MCP servers: the rail shows at most 4 `mcp` rows. With 5 or more, 3 servers keep a row (failed first, then connecting, then connected, config order within each) and the fourth sums up the rest: `+7 more · 2 connecting · 5 connected`, the counts dropping from the right on a narrow rail. `/dock` still lists every server.

### Prompt box on narrow screens

- The labels compact instead of vanishing: tight separators (`● SUPER-YOLO opus-5.5·high`), then no effort (`● SUPER-YOLO opus-5.5`), then the mode alone (the model alone in normal mode), each tried beside Gentle Shell's hint first. Working at 40 columns reads `╭─ ✿ working… ─ ● SUPER-YOLO opus-5.5 ─╮`. The line under the prompt compacts the same way before it is cut.
- On a phone, idle, the mode, model and effort stay: too tight for them beside `waiting for input`, the rule drops the label's words and keeps the petal (`╭─ ✿ ──── ● SUPER-YOLO  opus-5.5 · high ─╮`).
- The idle label is told by how Gentle Shell paints it (whole; not the working scan, `queued`, an ODD phase or the `↑ 3 more` scroll indicator), not by the words `waiting for input`, so a translated, custom or clipped idle label (`waiting for i…`) gets the same rule.

### Wordmark

- The rail logo reads GENTLESHELL, joined, GENTLE gray and SHELL in Gentle Shell's Gentleman-Sexy pink (#F43888), drawn in braille dots (gray fade, Sexy pink to its deep pink #BF0F50). The 55-column rail gets the wide 51-column mark; the official 47-column rail gets the 45-column compact one (the same G, N and L, a narrower E, T, S and H), centered with one blank column on each side. Narrower rails show one bold text row, letters spaced (`G E N T L E S H E L L`) down to 21 columns and joined below.

### Fixes

- The first start applies the `Fisi-Dock` theme once and remembers yours first, so `/fisi-dock off` gives back exactly the theme you had instead of `Gentleman-Cute`: `Fisi Dock applied its theme · /fisi-dock off puts your theme dark back`. Installs from before get it once on their next start; later starts keep any theme picked in `/settings`. The state file records it as `"themeApplied": true`. Skipped while off, in delegated child sessions, when Pi lacks the theme or cannot set it (tried again next start), and when the state file cannot be written.
- On Gentle Shell builds that card rail parts (its `main` branch, transparent surface) the panel no longer loses its right border to a `…`.

### Tests and CI

- `tests/configs.test.ts`: simulated user configurations (another language, no Engram, ten MCP servers, Vim on, a 30-column screen, a remapped or unbound expand key, all at once, and no Gentle Shell) drive the extension end to end, and every surface is checked at every width from 0 to 140.
- The Gentle Shell key check finds the package Gentle Shell itself loads (the one its launcher injects, else the `gentle-shell` launcher's own on PATH, pnpm included) before the global npm root, preferring the version provisioned in `~/.gentle-shell/config.json`. It no longer skips on a pnpm install, and still skips with no Gentle Shell (CI).
- CI runs `npm ci` before the tests, so they get Pi's real TUI classes and source.

### Project

- Contributing guide, security policy, issue forms for bugs and ideas, and a pull request template.

## 0.1.0

First release.

- Side panel in Gentle Shell's fullscreen rail: `session` (project, branch, context, model profile, cost, MCP servers), `heads-up`, `ODD`, `RDD`, `CI`, `agents`, `todo` and `changes`, with short-screen shapes.
- Prompt box with the working label, permission mode, model and effort on its border.
- Narrow screens: top row, strip, agents and todo cards; `/dock` for the whole panel.
- `/fisi-dock on` | `off`, remembered across restarts; off puts your previous theme back.
- `Fisi-Dock` theme.
- Tested with Gentle Shell 4.6.0.

# Changelog

## Unreleased

- Fix: on Gentle Shell builds that card rail parts (its `main` branch, transparent surface) the panel no longer loses its right border to a `…`.
- Wordmark: the rail logo reads GENTLESHELL, joined, GENTLE gray and SHELL pink. The 55-column rail draws it in braille dots (gray fade, pink to deep pink); the official 47-column rail and narrower ones show it as one bold text row, which gives two rows back to the panel.

## 0.1.0

First release.

- Side panel in Gentle Shell's fullscreen rail: `session` (project, branch, context, model profile, cost, MCP servers), `heads-up`, `ODD`, `RDD`, `CI`, `agents`, `todo` and `changes`, with short-screen shapes.
- Prompt box with the working label, permission mode, model and effort on its border.
- Narrow screens: top row, strip, agents and todo cards; `/dock` for the whole panel.
- `/fisi-dock on` | `off`, remembered across restarts; off puts your previous theme back.
- `Fisi-Dock` theme.
- Tested with Gentle Shell 4.6.0.

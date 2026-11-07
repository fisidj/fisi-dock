# Changelog

## Unreleased

- Start screen: Fisi Dock's welcome card replaces Gentle Shell's rose banner: `Gentle Shell <version>` with `with Fisi Dock`, `Ready in <project> on <branch>.`, the five commands to begin with and the alt+k tip. `/fisi-dock off` gives the header back.
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

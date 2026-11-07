# Contributing to Fisi Dock

Bug reports, ideas and pull requests are welcome. Fisi Dock is an unofficial community project: it is not part of Gentle Shell or Gentleman Programming, and its owner reviews and merges every change.

## Quick path

1. Fork the repository and create a branch from `main`.
2. Install and test:

   ```bash
   npm ci
   npm test
   ```

3. Make one change, with its tests and docs.
4. Run `npm test` again; it must pass.
5. Open a pull request and fill in the template.

## Report a bug

Open an issue with the **Bug report** form. A report Fisi Dock can act on has:

| What | Why |
|---|---|
| Steps to reproduce, what happened and what you expected | Most layout bugs show at one width and one state only |
| Gentle Shell version (`gentle-shell --version`) and Fisi Dock version or commit | Fisi Dock reads Gentle Shell's shared state by name, so the version matters |
| OS, terminal, and terminal size in columns × rows (phone or desktop) | The rail, the strip and the prompt box change with the width |
| Fullscreen mode on or off | The side panel only shows in fullscreen mode |
| A screenshot | Shows what the words cannot |
| Theme, Vim mode, MCP servers in `mcp.json`, gentle-engram | Each one changes what the panel paints |

Leave out tokens, keys and private paths from screenshots and logs.

A bug in Gentle Shell itself, one that shows with `/fisi-dock off` too, belongs to [Gentle Shell's issues](https://github.com/Gentleman-Programming/gentle-shell/issues).

## Send a pull request

| Rule | Details |
|---|---|
| One change per PR | A fix, a feature or a docs pass, not several. Smaller PRs are reviewed sooner. |
| Tests | Behavior changes add or adjust tests in `tests/`. `npm test` must pass, and CI must be green on Ubuntu, Windows and macOS with Node 22 and 24. |
| Docs | When behavior or a command changes, update the [README](README.md), [docs/reference.md](docs/reference.md) and the `## Unreleased` section of the [CHANGELOG](CHANGELOG.md). |
| Commits | Conventional Commit style, as in the history: `feat(dock): …`, `fix(dock): …`, `test(dock): …`, `docs: …`, `ci: …`. |
| Review | The owner reviews and merges. |

### Setup

- **Node.js 22.19 or later.** Node runs the TypeScript sources directly: there is no build step.
- `npm ci` installs the dev dependencies the tests need (Pi's real TUI classes and its source). `tests/gentle-shell-keys.test.ts` also checks an installed Gentle Shell, and skips without one.
- `node scripts/preview.ts 47` previews the panel with sample data. See [Develop](README.md#develop) for every preview option.

### Try your checkout in Gentle Shell

```bash
gentle-shell -e ./fisi-dock
```

`-e` loads the folder for one session without installing it. If Fisi Dock is also installed, turn that copy off first with `gentle-shell config`, so only one loads.

## Design rules

Two rules every change keeps:

- **Read Gentle Shell by name, import nothing from it.** Fisi Dock reads Gentle Shell's shared state, events and registries by their names.
- **Never break the session.** When something Fisi Dock reads is missing or has another shape, it stops painting that part and gives the screen back to Gentle Shell's or Pi's own output.

[docs/reference.md](docs/reference.md) describes every section, data source and fallback.

## Security

Report vulnerabilities privately, not in an issue: see [SECURITY.md](SECURITY.md).

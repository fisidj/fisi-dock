# Security

## Report a vulnerability

Report it privately, not in a public issue:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and the Fisi Dock and Gentle Shell versions.

The owner answers there and agrees with you on a fix and a disclosure date.

A vulnerability in Gentle Shell itself goes to [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell).

## What Fisi Dock does on your machine

- It runs locally, inside Gentle Shell, with your user's permissions.
- It handles no secrets: no tokens, keys or credentials. From Pi's `mcp.json` it reads only server names and their on/off switch.
- It runs read-only `git`, `gh` and `gentle-ai` commands, and writes only its own `state.json` and your Pi theme setting.
- It opens no network connection of its own. `gh` reads your branch's CI checks from GitHub with your own sign-in.

Every file it reads is listed in [How it works](README.md#how-it-works).

## Supported versions

Fixes land on `main` and in the latest release.

import assert from "node:assert/strict";
import test from "node:test";
import { renderWelcomeCard, shellVersion, WELCOME_CARD_WIDTH } from "../lib/welcome-card.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("the welcome card names the shell, the project and branch, and the five commands, centered (S1)", () => {
	const lines = renderWelcomeCard({ version: "4.6.0", project: "my-app", branch: "main" }, 101).map(plain);
	const top = lines.findIndex((line) => line.includes("╭"));
	const indent = (101 - WELCOME_CARD_WIDTH) >> 1;
	assert.equal(lines[top], `${" ".repeat(indent)}╭${"─".repeat(WELCOME_CARD_WIDTH - 2)}╮`);
	const inner = lines.slice(top + 1, lines.findIndex((line) => line.includes("╰"))).map((line) => line.slice(indent + 3, indent + WELCOME_CARD_WIDTH - 3).trimEnd());
	assert.deepEqual(inner, [
		"",
		`Gentle Shell 4.6.0${" ".repeat(WELCOME_CARD_WIDTH - 6 - 18 - 14)}with Fisi Dock`,
		"",
		"Ready in my-app on main.",
		"",
		`Resume session${" ".repeat(WELCOME_CARD_WIDTH - 6 - 14 - 7)}/resume`,
		`New session${" ".repeat(WELCOME_CARD_WIDTH - 6 - 11 - 4)}/new`,
		`Changelog${" ".repeat(WELCOME_CARD_WIDTH - 6 - 9 - 10)}/changelog`,
		`Shortcuts${" ".repeat(WELCOME_CARD_WIDTH - 6 - 9 - 8)}/hotkeys`,
		`Quit${" ".repeat(WELCOME_CARD_WIDTH - 6 - 4 - 5)}/quit`,
		"",
	]);
	assert.equal(lines.at(-1), `${" ".repeat(indent + 1)}Tip: alt+k opens the command palette.`);
});

test("without a branch or a version the card still reads (S1)", () => {
	const lines = renderWelcomeCard({ project: "notes" }, 80).map(plain);
	assert.ok(lines.some((line) => /│ +Gentle Shell +with Fisi Dock +│/.test(line)));
	assert.ok(lines.some((line) => line.includes("Ready in notes.")));
});

test("every line fits its width; below the card's minimum only the title and ready lines show (S1)", () => {
	for (let width = 0; width <= 140; width++) {
		for (const line of renderWelcomeCard({ version: "4.6.0-main", project: "a-really-long-project-name-that-goes-on", branch: "feat/some-long-branch" }, width)) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${plain(line)}`);
		}
	}
	const narrow = renderWelcomeCard({ version: "4.6.0", project: "app", branch: "main" }, 30).map(plain);
	assert.ok(narrow.every((line) => !/[╭│╰]/.test(line)));
	assert.ok(narrow.some((line) => line.includes("Gentle Shell 4.6.0")));
	assert.ok(narrow.some((line) => line.includes("Ready in app on main.")));
	assert.deepEqual(renderWelcomeCard({ project: "app" }, 0), []);
});

test("the shell version comes from Gentle Shell's config for this agent home, build hash dropped (S1)", () => {
	const home = "C:\\Users\\me\\.gentle-shell\\agent";
	const config = (gentlePi: unknown) => JSON.stringify({ provisioned: { [home]: { gentleAi: "4.3.1", gentlePi } } });
	assert.equal(shellVersion(config("4.6.0-main.dd37ffe5573d"), home), "4.6.0-main");
	assert.equal(shellVersion(config("4.6.0"), home), "4.6.0");
	assert.equal(shellVersion(config(7), home), undefined);
	assert.equal(shellVersion(config("4.6.0"), "C:\\other"), undefined);
	assert.equal(shellVersion("not json", home), undefined);
	assert.equal(shellVersion(undefined, home), undefined);
});

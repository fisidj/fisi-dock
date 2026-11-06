import assert from "node:assert/strict";
import test from "node:test";
import { palette } from "../lib/palette.ts";

// S59: /dock wears the side panel's colors (the terminal background, the rail highlight), no black of its own.
test("/dock has no colors of its own", () => {
	assert.equal("dockBackground" in palette, false);
	assert.equal("dockHighlight" in palette, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { memoryCallEnd, memoryInfo, NO_MEMORY_CALLS } from "../lib/memory.ts";

// Engram reaches Pi as gentle-engram's mem_* tools, not as an MCP server (design session-section/02).
const tool = (name: string) => ({ name, description: "", parameters: {}, exposure: "direct", sourceInfo: {} });
const ENGRAM = [tool("read"), tool("mem_save"), tool("mem_search"), tool("mem_context")];
const end = (toolName: string, isError = false) => ({ toolName, toolCallId: "c", result: {}, isError });

test("no tool named mem_save: not installed, whatever the calls say", () => {
	assert.deepEqual(memoryInfo([tool("read"), tool("mem_search"), tool("mcp__engram__mem_save")], NO_MEMORY_CALLS), { state: "missing" });
	assert.deepEqual(memoryInfo([], { saved: 4, failed: true }), { state: "missing" });
});

test("an unreadable tool list: nothing known, no memory row", () => {
	assert.equal(memoryInfo(undefined, NO_MEMORY_CALLS), undefined);
	assert.equal(memoryInfo("nope", NO_MEMORY_CALLS), undefined);
});

test("mem_save loaded: connected with the saves that ended without error in this session", () => {
	assert.deepEqual(memoryInfo(ENGRAM, NO_MEMORY_CALLS), { state: "connected", saved: 0 });
	let calls = memoryCallEnd(NO_MEMORY_CALLS, end("mem_save"));
	calls = memoryCallEnd(calls, end("mem_save"));
	calls = memoryCallEnd(calls, end("mem_search"));
	assert.deepEqual(memoryInfo(ENGRAM, calls), { state: "connected", saved: 2 });
});

test("the last mem_* call failed: unreachable; a later successful mem_* call makes it connected again", () => {
	const failed = memoryCallEnd(memoryCallEnd(NO_MEMORY_CALLS, end("mem_save")), end("mem_search", true));
	assert.deepEqual(memoryInfo(ENGRAM, failed), { state: "unreachable" });
	assert.deepEqual(memoryInfo(ENGRAM, memoryCallEnd(failed, end("mem_save", true))), { state: "unreachable" }, "a failed save is not counted");
	assert.deepEqual(memoryInfo(ENGRAM, memoryCallEnd(failed, end("mem_context"))), { state: "connected", saved: 1 }, "recovered, the earlier save still counted");
	assert.deepEqual(memoryInfo(ENGRAM, memoryCallEnd(failed, end("mem_save"))), { state: "connected", saved: 2 });
});

test("other tools, malformed events and an error flag that is not true leave the calls as they are", () => {
	const calls = memoryCallEnd(NO_MEMORY_CALLS, end("mem_save"));
	for (const event of [end("bash", true), end("read"), end("mcp__engram__mem_save", true), undefined, {}, { toolName: 7, isError: true }]) {
		assert.equal(memoryCallEnd(calls, event as never), calls, JSON.stringify(event));
	}
	assert.deepEqual(memoryCallEnd(calls, { toolName: "mem_search", isError: "yes" } as never), { saved: 1, failed: false });
	assert.deepEqual(NO_MEMORY_CALLS, { saved: 0, failed: false }, "the start value is never changed");
});

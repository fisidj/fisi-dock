import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { MCP_GRACE_MS, mcpConfigPaths, mcpServerNames, mcpServerStates, readMcpServerNames } from "../lib/mcp.ts";

test("server names are the keys of mcpServers, in config order (S32)", () => {
	assert.deepEqual(mcpServerNames([{ mcpServers: { engram: { command: "engram" }, context7: { url: "https://x" }, rea: {} } }]), ["engram", "context7", "rea"]);
});

test("a `servers` object counts like mcpServers", () => {
	assert.deepEqual(mcpServerNames([{ servers: { docs: {}, "web-search": {} } }]), ["docs", "web-search"]);
});

test("disabled servers are skipped: `disabled: true` and Pi's `enabled: false`", () => {
	assert.deepEqual(mcpServerNames([{ mcpServers: { a: { disabled: true }, b: { enabled: false }, c: { enabled: true }, d: { disabled: false } } }]), ["c", "d"]);
});

test("the project config adds servers after the global ones and can switch a global one off or on", () => {
	const global = { mcpServers: { engram: {}, context7: {}, off: { enabled: false } } };
	const project = { mcpServers: { context7: { enabled: false }, local: {}, off: { enabled: true }, engram: {} } };
	assert.deepEqual(mcpServerNames([global, project]), ["engram", "off", "local"]);
});

test("missing, malformed and non-object configs give no names and never throw", () => {
	assert.deepEqual(mcpServerNames([]), []);
	assert.deepEqual(mcpServerNames([undefined, null, 3, "x", [], { mcpServers: [] }, { mcpServers: "no" }, { other: {} }]), []);
	assert.deepEqual(mcpServerNames([{ mcpServers: { ok: {}, bad: null, worse: 7 } }]), ["ok", "bad", "worse"], "an entry without settings is still configured");
});

test("config paths: Pi's agent dir (PI_CODING_AGENT_DIR, else ~/.pi/agent) then the project's .pi/mcp.json", () => {
	assert.deepEqual(mcpConfigPaths("/work/app", "/home/me", {}), [join("/home/me", ".pi", "agent", "mcp.json"), join("/work/app", ".pi", "mcp.json")]);
	assert.deepEqual(mcpConfigPaths("/work/app", "/home/me", { PI_CODING_AGENT_DIR: "/custom/agent" }), [join("/custom/agent", "mcp.json"), join("/work/app", ".pi", "mcp.json")]);
	assert.deepEqual(mcpConfigPaths("/work/app", "/home/me", { PI_CODING_AGENT_DIR: "~/agent" }), [join("/home/me", "agent", "mcp.json"), join("/work/app", ".pi", "mcp.json")]);
	assert.deepEqual(mcpConfigPaths("", "/home/me", {}), [join("/home/me", ".pi", "agent", "mcp.json")], "no cwd: global only");
});

test("reading: undefined when no config file exists, names from the files that do; bad JSON counts as no file", async () => {
	const files: Record<string, string> = {
		global: JSON.stringify({ mcpServers: { engram: { command: "engram", env: { TOKEN: "secret" } } } }),
		project: JSON.stringify({ mcpServers: { local: { url: "https://x", headers: { Authorization: "Bearer secret" } } } }),
		broken: "{ not json",
	};
	const read = async (path: string) => {
		if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		return files[path];
	};
	assert.equal(await readMcpServerNames(["none", "missing"], read), undefined);
	assert.equal(await readMcpServerNames(["broken"], read), undefined);
	assert.deepEqual(await readMcpServerNames(["global", "missing", "project"], read), ["engram", "local"]);
	assert.deepEqual(await readMcpServerNames(["global", "broken"], read), ["engram"]);
	const names = await readMcpServerNames(["global", "project"], read);
	assert.ok(!JSON.stringify(names).includes("secret"), "only server names leave the reader");
});

const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: "", parameters: {}, exposure: "deferred", sourceInfo: {}, ...extra });

test("connected: a visible tool named mcp__<server>__ or in the mcp__<server> namespace; `-` becomes `_` (S32)", () => {
	const tools = [
		tool("read", { exposure: "direct" }),
		tool("mcp__engram__mem_save"),
		tool("mcp__web_search__query"),
		tool("search", { namespace: { name: "mcp__docs" } }),
	];
	assert.deepEqual(mcpServerStates(["engram", "web-search", "docs"], tools, false), [
		{ name: "engram", state: "connected" },
		{ name: "web-search", state: "connected" },
		{ name: "docs", state: "connected" },
	]);
});

test("no tools: unknown while servers may still connect, failing after the grace period", () => {
	assert.deepEqual(mcpServerStates(["rea"], [tool("read")], false), [{ name: "rea", state: "unknown" }]);
	assert.deepEqual(mcpServerStates(["rea"], [tool("read")], true), [{ name: "rea", state: "failing" }]);
	assert.equal(MCP_GRACE_MS, 10_000);
});

test("only hidden tools (server dropped or switched off in /mcp): unknown, never connected", () => {
	assert.deepEqual(mcpServerStates(["rea"], [tool("mcp__rea__decompile", { exposure: "hidden" })], true), [{ name: "rea", state: "unknown" }]);
});

test("a tool list Pi could not give: every server unknown", () => {
	assert.deepEqual(mcpServerStates(["a", "b"], undefined, true), [{ name: "a", state: "unknown" }, { name: "b", state: "unknown" }]);
	assert.deepEqual(mcpServerStates(["a"], "nope", true), [{ name: "a", state: "unknown" }]);
});

test("a prefix of another server's name does not count: mcp__eng is not mcp__engram", () => {
	assert.deepEqual(mcpServerStates(["eng"], [tool("mcp__engram__mem_save")], true), [{ name: "eng", state: "failing" }]);
});

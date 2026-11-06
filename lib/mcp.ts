import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerInfo } from "./panel-model.ts";

// MCP servers for the session row (S32). Pi connects them (extensions/mcp);
// Fisi Dock only reads which ones are configured and whether their tools
// exist, and never handles `mcp_servers_change`, which would make it the
// connector (L60). Config files can hold secrets in env, headers and auth:
// only the server names and their on/off flag are read from them.

/** Servers connect in the background after session start; before this, no tools means "still connecting". */
export const MCP_GRACE_MS = 10_000;

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Pi's mcp.json files: the agent dir's (PI_CODING_AGENT_DIR, else ~/.pi/agent), then the project's .pi/mcp.json. */
export function mcpConfigPaths(cwd: string, home: string, env: Record<string, string | undefined>): string[] {
	const custom = env.PI_CODING_AGENT_DIR;
	const agentDir = custom ? (custom === "~" ? home : custom.startsWith("~/") ? join(home, custom.slice(2)) : custom) : join(home, ".pi", "agent");
	return [join(agentDir, "mcp.json"), ...(cwd ? [join(cwd, ".pi", "mcp.json")] : [])];
}

/**
 * Enabled server names across parsed configs, in config order. Keys of
 * `mcpServers` (or `servers`); a later file (the project) adds servers and can
 * switch an earlier one off or on, as Pi's project overrides do. Off means
 * Pi's `enabled: false` or `disabled: true`.
 */
export function mcpServerNames(configs: readonly unknown[]): string[] {
	const enabled = new Map<string, boolean>();
	for (const config of configs) {
		const servers = record(record(config)?.mcpServers) ?? record(record(config)?.servers);
		if (!servers) continue;
		for (const name of Object.keys(servers)) {
			const entry = record(servers[name]);
			const off = entry?.enabled === false || entry?.disabled === true;
			const on = entry?.enabled === true || entry?.disabled === false;
			enabled.set(name, off ? false : on ? true : (enabled.get(name) ?? true));
		}
	}
	return [...enabled].filter(([, on]) => on).map(([name]) => name);
}

/**
 * The enabled server names from the config files at `paths`; undefined when no
 * file exists or none parses (no MCP config: no mcp row). Only names leave here.
 */
export async function readMcpServerNames(paths: readonly string[], read: (path: string) => Promise<string> = (path) => readFile(path, "utf8")): Promise<string[] | undefined> {
	const configs: unknown[] = [];
	for (const path of paths) {
		try {
			configs.push(JSON.parse(await read(path)));
		} catch {
			// Missing or unreadable: this file adds nothing.
		}
	}
	return configs.length > 0 ? mcpServerNames(configs) : undefined;
}

/** Pi's mcpNamespace rule: `mcp__<server>` with `-` replaced by `_`, like the tool names. */
export function mcpNamespace(server: string): string {
	return `mcp__${server.replace(/-/g, "_")}`;
}

/**
 * Each server's state from Pi's tool list (pi.getAllTools()). Pi registers
 * every MCP tool as `mcp__<server>__<tool>` in the `mcp__<server>` namespace,
 * codemode-exposed ones included, and re-registers the tools of a server that
 * dropped or was switched off as hidden. So: a visible tool is connected; only
 * hidden tools or an unreadable list is unknown; no tool is unknown until
 * `settled` (the grace period passed), then failing.
 */
export function mcpServerStates(names: readonly string[], tools: unknown, settled: boolean): McpServerInfo[] {
	const list = Array.isArray(tools) ? tools.map(record).filter((tool) => tool !== undefined) : undefined;
	return names.map((name) => {
		if (!list) return { name, state: "unknown" };
		const namespace = mcpNamespace(name);
		const own = list.filter((tool) => (typeof tool.name === "string" && tool.name.startsWith(`${namespace}__`)) || record(tool.namespace)?.name === namespace);
		if (own.some((tool) => tool.exposure !== "hidden")) return { name, state: "connected" };
		return { name, state: own.length === 0 && settled ? "failing" : "unknown" };
	});
}

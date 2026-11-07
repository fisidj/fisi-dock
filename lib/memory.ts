import type { MemoryInfo } from "./panel-model.ts";

// Engram for the session's memory row (design session-section/02). Engram is
// not an MCP server: the Pi package gentle-engram registers tools named mem_*
// (mem_save, mem_search, mem_context, …), so lib/mcp.ts never sees it. Fisi
// Dock spawns nothing and asks no server: "connected" means the mem_* tools are
// loaded and the last mem_* call did not fail, from the tool_execution_end
// events Pi already sends.

/** The tool whose presence says gentle-engram is installed, and whose calls count as saved. */
export const MEMORY_SAVE_TOOL = "mem_save";
const MEMORY_TOOL = /^mem_/;

/** What this session's mem_* calls said so far. */
export interface MemoryCalls {
	/** mem_save calls that ended without error. */
	saved: number;
	/** The latest mem_* call ended with an error. */
	failed: boolean;
}

export const NO_MEMORY_CALLS: MemoryCalls = Object.freeze({ saved: 0, failed: false });

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/**
 * `calls` after one of Pi's tool_execution_end events: a mem_* call that
 * ended with an error marks the memory failed, any other ends it, and a
 * mem_save adds a save. Other tools and malformed events return `calls` itself.
 */
export function memoryCallEnd(calls: MemoryCalls, event: { toolName?: unknown; isError?: unknown } | undefined): MemoryCalls {
	const name = record(event)?.toolName;
	if (typeof name !== "string" || !MEMORY_TOOL.test(name)) return calls;
	if (event!.isError === true) return calls.failed ? calls : { ...calls, failed: true };
	if (name !== MEMORY_SAVE_TOOL && !calls.failed) return calls;
	return { saved: calls.saved + (name === MEMORY_SAVE_TOOL ? 1 : 0), failed: false };
}

/** The memory row for Pi's tool list (pi.getAllTools()) and this session's calls; undefined when the list cannot be read. */
export function memoryInfo(tools: unknown, calls: MemoryCalls): MemoryInfo | undefined {
	if (!Array.isArray(tools)) return undefined;
	if (!tools.some((tool) => record(tool)?.name === MEMORY_SAVE_TOOL)) return { state: "missing" };
	return calls.failed ? { state: "unreachable" } : { state: "connected", saved: calls.saved };
}

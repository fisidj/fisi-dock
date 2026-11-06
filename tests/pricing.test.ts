import assert from "node:assert/strict";
import test from "node:test";
import { estimateSessionCost, messageCost, registryPrices, type PriceLookup, type PriceRates } from "../lib/pricing.ts";

// Pi's anthropic catalog price for claude-opus-5-5 (dollars per million tokens).
const OPUS: PriceRates = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const ZERO: PriceRates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const MILLION = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };

const bridgeMessage = (model: string, usage: Record<string, unknown>) => ({
	type: "message",
	message: { role: "assistant", provider: "claude-bridge", model, usage: { totalTokens: 0, cost: { total: 0 }, ...usage } },
});

test("message cost prices each token kind per million, like Pi's calculateCost (S37)", () => {
	assert.equal(messageCost(MILLION, OPUS), 29.2);
	assert.equal(messageCost({ input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 }, OPUS), 2);
	assert.equal(messageCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, OPUS), 0);
});

test("message cost uses the highest tier the input passes and 1h cache writes at twice the input price (S37)", () => {
	const tiered: PriceRates = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5, tiers: [{ inputTokensAbove: 100_000, input: 3, output: 6, cacheRead: 0.3, cacheWrite: 4 }] };
	assert.equal(messageCost({ input: 50_000, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered), 0.05);
	assert.equal(messageCost({ input: 200_000, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered), 0.6);
	assert.equal(messageCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 }, OPUS), 8);
});

test("the session estimate prices every assistant message with the injected lookup (S37)", () => {
	const asked: string[] = [];
	const lookup: PriceLookup = (provider, model) => {
		asked.push(`${provider}/${model}`);
		return model === "claude-opus-5-5" ? OPUS : undefined;
	};
	const entries = [
		bridgeMessage("claude-opus-5-5", MILLION),
		{ type: "message", message: { role: "user", model: "claude-opus-5-5", usage: MILLION } },
		bridgeMessage("claude-opus-5-5", { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 }),
	];
	assert.equal(estimateSessionCost(entries, lookup), 31.2);
	assert.deepEqual(asked, ["claude-bridge/claude-opus-5-5"], "one lookup per model");
});

test("no estimate without a price for every message with tokens, or without tokens (S37)", () => {
	const lookup: PriceLookup = (_provider, model) => (model === "claude-opus-5-5" ? OPUS : undefined);
	assert.equal(estimateSessionCost([bridgeMessage("mystery-model", MILLION)], lookup), undefined);
	assert.equal(estimateSessionCost([bridgeMessage("claude-opus-5-5", MILLION), bridgeMessage("mystery-model", MILLION)], lookup), undefined, "never a partial sum");
	assert.equal(estimateSessionCost([bridgeMessage("claude-opus-5-5", MILLION)], () => ZERO), undefined, "a zero price is no price");
	assert.equal(estimateSessionCost([], lookup), undefined);
	assert.equal(estimateSessionCost(undefined as never, lookup), undefined);
	assert.equal(estimateSessionCost([bridgeMessage("claude-opus-5-5", MILLION)], () => {
		throw new Error("registry gone");
	}), undefined);
});

test("registry prices: the message's own provider when priced, else the same id under anthropic (S37)", () => {
	const models: Record<string, { cost: unknown }> = {
		"claude-bridge/claude-opus-5-5": { cost: ZERO },
		"anthropic/claude-opus-5-5": { cost: OPUS },
		"paid/own-model": { cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
		"anthropic/own-model": { cost: OPUS },
		"claude-bridge/broken": { cost: { input: "x" } },
	};
	const asked: string[] = [];
	const prices = registryPrices({
		find: (provider: string, id: string) => {
			asked.push(`${provider}/${id}`);
			return models[`${provider}/${id}`];
		},
	});
	assert.deepEqual(prices("claude-bridge", "claude-opus-5-5"), OPUS);
	assert.deepEqual(prices("paid", "own-model"), { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
	assert.equal(prices("claude-bridge", "unknown-model"), undefined);
	assert.equal(prices("claude-bridge", "broken"), undefined);
	assert.equal(prices(undefined, "unknown-model"), undefined);
	assert.ok(asked.includes("anthropic/claude-opus-5-5"));
	assert.equal(registryPrices(undefined)("claude-bridge", "claude-opus-5-5"), undefined);
	assert.equal(registryPrices({ find: () => { throw new Error("no"); } })("claude-bridge", "claude-opus-5-5"), undefined);
});

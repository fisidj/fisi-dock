// API-price estimate for sessions that record tokens but no cost (S37): a
// Claude subscription through pi-claude-bridge registers Anthropic's catalog
// with every price set to 0. Prices come from Pi's own model registry
// (ctx.modelRegistry.find -> Model.cost, dollars per million tokens), never
// from a table kept here.

export interface PriceRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Pi's ModelCostTier: other rates once a message's input passes `inputTokensAbove`. */
	tiers?: (Omit<PriceRates, "tiers"> & { inputTokensAbove: number })[];
}

/** The price of a message's model; undefined when none is known. */
export type PriceLookup = (provider: string | undefined, model: string) => PriceRates | undefined;

export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Subset of cacheWrite kept for 1h (Anthropic only). */
	cacheWrite1h?: number;
}

/** The registry Fisi Dock reads: Pi's ModelRegistry.find(provider, modelId). */
export interface ModelFinder {
	find(provider: string, modelId: string): { cost?: unknown } | undefined;
}

/** pi-claude-bridge serves Anthropic's catalog under the same model ids. */
const NATIVE_PROVIDER = "anthropic";

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const amount = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** Same math as Pi's calculateCost (pi-ai models.js): highest passed tier, 1h cache writes at twice the input rate. */
export function messageCost(usage: UsageLike, rates: PriceRates): number {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let tier: Omit<PriceRates, "tiers"> = rates;
	let threshold = -1;
	for (const next of rates.tiers ?? []) {
		if (inputTokens > next.inputTokensAbove && next.inputTokensAbove > threshold) {
			tier = next;
			threshold = next.inputTokensAbove;
		}
	}
	const longWrite = usage.cacheWrite1h ?? 0;
	const total = (tier.input * usage.input + tier.output * usage.output + tier.cacheRead * usage.cacheRead + tier.cacheWrite * (usage.cacheWrite - longWrite) + tier.input * 2 * longWrite) / 1_000_000;
	return Math.round(total * 1e9) / 1e9;
}

function rates(value: unknown): PriceRates | undefined {
	const cost = record(value);
	const [input, output, cacheRead, cacheWrite] = ["input", "output", "cacheRead", "cacheWrite"].map((key) => amount(cost?.[key]));
	if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) return undefined;
	const tiers = Array.isArray(cost?.tiers) ? cost.tiers.flatMap((tier) => {
		const base = rates(tier);
		const above = amount(record(tier)?.inputTokensAbove);
		return base && above !== undefined ? [{ input: base.input, output: base.output, cacheRead: base.cacheRead, cacheWrite: base.cacheWrite, inputTokensAbove: above }] : [];
	}) : [];
	return { input, output, cacheRead, cacheWrite, ...(tiers.length ? { tiers } : {}) };
}

const priced = (value: PriceRates | undefined) => value !== undefined && value.input + value.output + value.cacheRead + value.cacheWrite > 0;

/** Prices from Pi's registry: the message's own provider when priced, else the same id under anthropic. */
export function registryPrices(registry: ModelFinder | undefined): PriceLookup {
	const find = (provider: string, model: string) => {
		try {
			return rates(registry?.find(provider, model)?.cost);
		} catch {
			return undefined;
		}
	};
	return (provider, model) => {
		const own = provider ? find(provider, model) : undefined;
		if (priced(own)) return own;
		const native = provider === NATIVE_PROVIDER ? undefined : find(NATIVE_PROVIDER, model);
		return priced(native) ? native : undefined;
	};
}

/**
 * The session's assistant messages priced at their model's API rates, the
 * entries sessionCost walks. Undefined when there are no tokens or any
 * message with tokens has no price: a partial sum would look like the total.
 */
export function estimateSessionCost(entries: readonly unknown[], lookup: PriceLookup): number | undefined {
	const known = new Map<string, PriceRates | undefined>();
	let total = 0;
	let any = false;
	for (const entry of Array.isArray(entries) ? entries : []) {
		const message = record(record(entry)?.message);
		if (record(entry)?.type !== "message" || message?.role !== "assistant") continue;
		const usage = record(message.usage);
		const [input, output, cacheRead, cacheWrite] = ["input", "output", "cacheRead", "cacheWrite"].map((key) => amount(usage?.[key]) ?? 0);
		if (input + output + cacheRead + cacheWrite === 0) continue;
		const provider = typeof message.provider === "string" ? message.provider : undefined;
		const model = typeof message.model === "string" ? message.model : "";
		const key = `${provider ?? ""}\0${model}`;
		if (!known.has(key)) {
			let found: PriceRates | undefined;
			try {
				found = model ? lookup(provider, model) : undefined;
			} catch {
				found = undefined;
			}
			known.set(key, priced(found) ? found : undefined);
		}
		const price = known.get(key);
		if (!price) return undefined;
		total += messageCost({ input, output, cacheRead, cacheWrite, cacheWrite1h: amount(usage?.cacheWrite1h) }, price);
		any = true;
	}
	return any ? Math.round(total * 1e9) / 1e9 : undefined;
}

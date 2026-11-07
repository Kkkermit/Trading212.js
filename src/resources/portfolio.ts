import type { CallOptions } from "../http/transport";
import type { AccountSummary, Position } from "../types/api.generated";

import type { AccountResource } from "./account";
import type { PositionsResource } from "./positions";

export interface HoldingSnapshot {
	readonly ticker: string;
	readonly name: string | undefined;
	readonly quantity: number;
	/** Current value in the account's currency. */
	readonly value: number;
	/** What it cost, in the account's currency. */
	readonly cost: number;
	readonly profitLoss: number;
	/** Profit or loss as a fraction of cost: 0.1 is 10%. */
	readonly profitLossRatio: number | undefined;
	/** Share of the invested total: 0.25 is a quarter. */
	readonly weight: number;
}

export interface PortfolioSnapshot {
	readonly currency: string | undefined;
	readonly totalValue: number;
	readonly cash: number;
	readonly invested: number;
	readonly unrealisedProfitLoss: number;
	readonly realisedProfitLoss: number;
	/** Largest holding first. */
	readonly holdings: readonly HoldingSnapshot[];
	readonly takenAt: Date;
}

const amount = (value: number | null | undefined): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Combines an account summary and its positions into one tidy picture: totals, and each holding's value, profit and
 * share of the portfolio. Pure, so you can call it on data you already have.
 */
export function buildPortfolioSnapshot(
	summary: AccountSummary,
	positions: readonly Position[],
	takenAt = new Date(),
): PortfolioSnapshot {
	const holdings = positions.map((position) => {
		const value = amount(position.walletImpact?.currentValue);
		const cost = amount(position.walletImpact?.totalCost);
		const profitLoss = amount(position.walletImpact?.unrealizedProfitLoss);
		return {
			ticker: position.instrument?.ticker ?? "",
			name: position.instrument?.name ?? undefined,
			quantity: amount(position.quantity),
			value,
			cost,
			profitLoss,
			profitLossRatio: cost === 0 ? undefined : profitLoss / cost,
		};
	});
	const invested = holdings.reduce((total, holding) => total + holding.value, 0);
	return {
		currency: summary.currency ?? undefined,
		totalValue: amount(summary.totalValue),
		cash: amount(summary.cash?.availableToTrade),
		invested,
		unrealisedProfitLoss: amount(summary.investments?.unrealizedProfitLoss),
		realisedProfitLoss: amount(summary.investments?.realizedProfitLoss),
		holdings: holdings
			.map((holding) => ({ ...holding, weight: invested === 0 ? 0 : holding.value / invested }))
			.sort((a, b) => b.value - a.value),
		takenAt,
	};
}

export class PortfolioResource {
	readonly #account: AccountResource;
	readonly #positions: PositionsResource;

	constructor(account: AccountResource, positions: PositionsResource) {
		this.#account = account;
		this.#positions = positions;
	}

	/**
	 * The whole account at a glance, from two requests: totals, and every holding with its value, profit and weight.
	 *
	 * @example
	 * const { totalValue, holdings } = await t212.portfolio.snapshot();
	 */
	async snapshot(options: CallOptions = {}): Promise<PortfolioSnapshot> {
		const [summary, positions] = await Promise.all([this.#account.summary(options), this.#positions.list(options)]);
		return buildPortfolioSnapshot(summary, positions);
	}
}

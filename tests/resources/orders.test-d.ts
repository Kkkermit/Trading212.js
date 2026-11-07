// Compile-time checks of what the order methods return; `npm run typecheck` fails if any of them changes.
import type { Trading212 } from "../../src/client";
import type { DryRunResult, Order, PlaceOptions } from "../../src/index";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the standard exact-equality check needs them
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a type-only assertion
const expectType = <T extends true>(): T => true as T;

export async function orderResultTypes(client: Trading212, flag: boolean, options: PlaceOptions): Promise<unknown[]> {
	const plain = await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
	const preview = await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }, { dryRun: true });
	const either = await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }, { dryRun: flag });
	const withOtherOptions = await client.orders.sellAll("AAPL_US_EQ", { extendedHours: true });
	const noOptions = await client.orders.sellAll("AAPL_US_EQ");
	const withSignal = await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }, { signal: AbortSignal.timeout(1) });
	const explicitFalse = await client.orders.market({ ticker: "AAPL_US_EQ", quantity: 1 }, { dryRun: false });
	const loose = await client.orders.limit(
		{ ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 1, timeValidity: "DAY" },
		options,
	);
	expectType<Equal<typeof plain, Order>>();
	expectType<Equal<typeof preview, DryRunResult>>();
	expectType<Equal<typeof either, Order | DryRunResult>>();
	expectType<Equal<typeof withOtherOptions, Order>>();
	expectType<Equal<typeof noOptions, Order>>();
	expectType<Equal<typeof withSignal, Order>>();
	expectType<Equal<typeof explicitFalse, Order>>();
	expectType<Equal<typeof loose, Order | DryRunResult>>();
	return [plain, preview, either, withOtherOptions, noOptions, withSignal, explicitFalse, loose];
}

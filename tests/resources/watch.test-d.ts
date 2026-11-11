// Compile-time checks of what watcher listeners receive; `npm run typecheck` fails if any of them changes.
import type { Trading212 } from "../../src/client";
import type { CashEvent, Fill, Order, Position, SettledOrderEvent, WatchErrorEvent } from "../../src/index";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the standard exact-equality check needs them
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a type-only assertion
const expectType = <T extends true>(): T => true as T;

export function listenerTypes(client: Trading212): unknown[] {
	const seen: unknown[] = [];
	const orders = client.watch.orders();
	orders.on("filled", (event) => {
		seen.push(event);
		expectType<Equal<typeof event.type, "filled">>();
		expectType<Equal<typeof event.fill, Fill | undefined>>();
		expectType<Equal<typeof event, SettledOrderEvent & { readonly type: "filled" }>>();
	});
	orders.on("placed", (event) => {
		seen.push(event);
		expectType<Equal<typeof event.order, Order>>();
	});
	orders.on("error", (event) => {
		seen.push(event);
		expectType<Equal<typeof event, WatchErrorEvent & { readonly type: "error" }>>();
	});
	client.watch.positions().on("closed", (event) => {
		seen.push(event);
		expectType<Equal<typeof event.position, Position>>();
	});
	client.watch.cash().on("changed", (event) => {
		seen.push(event);
		expectType<Equal<typeof event, CashEvent & { readonly type: "changed" }>>();
	});
	// @ts-expect-error -- a position watcher has no "filled" event
	client.watch.positions().on("filled", () => undefined);
	return seen;
}

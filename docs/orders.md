# Orders

## Buying and selling

`buy()` and `sell()` take a **positive** quantity and set the direction themselves. The type defaults to `market`.

```ts
await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.5 });
await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.5, extendedHours: true });
await t212.orders.buy({ type: "limit", ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 180, timeValidity: "DAY" });
await t212.orders.sell({
	type: "stop",
	ticker: "AAPL_US_EQ",
	quantity: 1,
	stopPrice: 150,
	timeValidity: "GOOD_TILL_CANCEL",
});
await t212.orders.sell({
	type: "stopLimit",
	ticker: "AAPL_US_EQ",
	quantity: 1,
	stopPrice: 150,
	limitPrice: 148,
	timeValidity: "DAY",
});
```

The low-level `market()`, `limit()`, `stop()` and `stopLimit()` send exactly what you give them, with the API's
convention that **a negative quantity sells**.

| Type        | Fills                                                    | Needs                                     | Limit       |
| ----------- | -------------------------------------------------------- | ----------------------------------------- | ----------- |
| `market`    | now, at the next price                                   | nothing else                              | 50 / minute |
| `limit`     | at `limitPrice` or better                                | `limitPrice`, `timeValidity`              | 1 / 2 s     |
| `stop`      | as a market order once the price reaches `stopPrice`     | `stopPrice`, `timeValidity`               | 1 / 2 s     |
| `stopLimit` | as a limit order at `limitPrice` once `stopPrice` is hit | `stopPrice`, `limitPrice`, `timeValidity` | 1 / 2 s     |

`timeValidity` is `"DAY"` (expires at the end of the trading day) or `"GOOD_TILL_CANCEL"`. It is always required on
non-market orders, because the sources disagree on Trading 212's default. `extendedHours` is allowed on market orders
only.

## What is checked before sending

Before any request, the client checks the ticker has no spaces, the quantity is finite, non-zero and at most **4
decimal places**, prices are positive, `timeValidity` is one of the two values, and no field is given that the type
does not use. Every problem goes into one `ValidationError`, with `error.issues` listing them.

## Quantities

Positions can hold 8 decimal places, but orders take 4. `truncateQuantity()` cuts towards zero using the number's
exact digits, never floating-point maths, so it can never round up past what you own:

```ts
import { truncateQuantity, isValidQuantity } from "@kkermit/trading212.js";

truncateQuantity(12.09032128); // 12.0903
isValidQuantity(0.12345); // false
```

Placing orders by value (for example "£50 of Apple") is not supported by the API.

## Selling a whole position

```ts
await t212.orders.sellAll("AAPL_US_EQ");
```

It reads `quantityAvailableForTrading`, truncates it to 4 decimal places and sells that at market. Shares in pies or
reserved by pending orders are left alone. If nothing can be sold, the error says why.

## Previewing with `dryRun`

```ts
const preview = await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }, { dryRun: true });
// { dryRun: true, method: "POST", url, endpoint: "placeMarketOrder", body: { ticker, quantity }, wouldSend }
```

A dry run validates and builds the exact request, then returns it. It never sends anything, and works on a live
client with trading switched off; `wouldSend` says whether this client would send it for real.

## Waiting for a fill

```ts
const order = await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
const settled = await t212.orders.waitFor(order, { timeoutMs: 60_000 });
settled.status; // FILLED, CANCELLED, REJECTED or REPLACED
```

`waitFor` polls the pending order once a second (its rate limit). Once the order stops being pending, Trading 212
answers 404, so it looks the order up in the history instead. After `timeoutMs` it throws `TimeoutError`, and the
order may still fill.

## Pending orders and cancelling

```ts
const pending = await t212.orders.list();
const one = await t212.orders.get(pending[0].id!);
await t212.orders.cancel(one.id!);
```

A successful cancel means Trading 212 accepted the request; the order can still fill first. Cancelling an order that
has already gone throws `NotFoundError`.

## When an order fails

| Error                          | Means                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `ValidationError`              | Refused before sending; fix `error.issues`                                            |
| `OrderRejectedError`           | Refused by Trading 212; `error.reason` is the code, such as `SellingEquityNotOwned`   |
| `TradingDisabledError`         | Live client without `trading: "enabled"`; nothing sent                                |
| `OrderOutcomeUnknownError`     | May have executed. Check `orders.list()` and `history.orders.list()` before resending |
| `NetworkError` (`sent: false`) | Never left your machine; safe to try again                                            |
| `MissingScopeError`            | The key lacks `orders:execute`                                                        |

Known rejection reasons: `InsufficientFreeForStocksBuy`, `SellingEquityNotOwned`, `MarketClosed` and
`QuantityPrecisionMismatch`. Any other code Trading 212 sends is kept as-is in `reason`. At most 50 orders may be
pending per ticker.

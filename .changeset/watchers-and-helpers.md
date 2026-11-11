---
"@kkkermit/trading212.js": minor
---

Added watchers for orders, positions and cash (`t212.watch`), `orders.findAfterUnknown()` to look for an order whose outcome is unknown, `orders.cancelAll()`, `exchanges.isOpen()` and `exchanges.waitUntilOpen()`, `history.dividends.total()`, an `onError` hook, `logger: "debug"` and `T212_LOG`, a check against an instrument's `maxOpenQuantity` before sending, and read-only `summary`, `positions` and `orders` commands. The fake server now refuses orders above `maxOpenQuantity` or worth less than `minOrderValue`, as demo does, and `OrderOutcomeUnknownError` carries `sentAt`.

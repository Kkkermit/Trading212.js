# @kkkermit/trading212.js

## 0.2.0

### Minor Changes

- 983c139: Added watchers for orders, positions and cash (`t212.watch`), `orders.findAfterUnknown()` to look for an order whose outcome is unknown, `orders.cancelAll()`, `exchanges.isOpen()` and `exchanges.waitUntilOpen()`, `history.dividends.total()`, an `onError` hook, `logger: "debug"` and `T212_LOG`, a check of a buy against its instrument's `maxOpenQuantity` before sending, and read-only `summary`, `positions` and `orders` commands. The fake server now refuses orders above `maxOpenQuantity` or worth less than `minOrderValue`, with the error bodies demo sends for such refusals, and `OrderOutcomeUnknownError` carries `sentAt`.

## 0.1.3

### Patch Changes

- e1c9cee: Updated the API types to the latest Trading 212 spec.

## 0.1.2

### Patch Changes

- 5d8b00f: The npm page now links to the documentation site, and the README shows how often the package is downloaded.

## 0.1.1

### Patch Changes

- ee3d9f7: Published the library's code, which 0.1.0 was released without. Install 0.1.1 or later.

## 0.1.0

### Minor Changes

- dcfed11: First release: a typed client for every Trading 212 Public API endpoint, with a live-trading switch, safe errors with hints, rate limiting, pagination, a fake Trading 212 for tests and a `doctor` command.

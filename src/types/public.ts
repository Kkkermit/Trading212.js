import type {
	AccountBucketInstrumentsDetailedResponse,
	AccountBucketResultResponse,
	HistoryDividendItem,
	HistoryTransactionItem,
	PieRequest,
	ReportResponse,
} from "./api.generated";

export type * from "./api.generated";

/** A dividend payment, from `history.dividends`. */
export type Dividend = HistoryDividendItem;
/** A deposit, withdrawal, fee or interest payment, from `history.transactions`. */
export type Transaction = HistoryTransactionItem;
/** A requested CSV export and its status. */
export type Report = ReportResponse;
/** A pie as listed by `pies.list()`. */
export type Pie = AccountBucketResultResponse;
/** A pie with its instruments and settings, from `pies.get()`. */
export type PieDetails = AccountBucketInstrumentsDetailedResponse;
/** What `pies.create()` and `pies.update()` take. */
export type PieInput = PieRequest;

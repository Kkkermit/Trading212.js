import { NetworkError, TimeoutError, UnexpectedResponseError, ValidationError } from "../errors/errors";
import { ENDPOINTS } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import { sleep } from "../internal/sleep";
import { stripQuery } from "../logging/redact";
import type { EnqueuedReportResponse, ReportResponse } from "../types/api.generated";

import type { ResourceContext } from "./context";

export interface ReportRequest {
	/** Start of the period. */
	from: Date | string;
	/** End of the period. */
	to: Date | string;
	/** What to include. Everything, unless you say otherwise. */
	include?: {
		dividends?: boolean;
		interest?: boolean;
		orders?: boolean;
		transactions?: boolean;
	};
}

export interface ReportWaitOptions extends CallOptions {
	/** Give up after this long. Default 10 minutes. */
	timeoutMs?: number;
	/** Time between checks. Default 60 s, the endpoint's limit. */
	intervalMs?: number;
	/** Called each time the status is checked. */
	onStatus?: (report: ReportResponse) => void;
}

export interface ExportResult {
	readonly report: ReportResponse;
	readonly csv: string;
}

const FAILED = new Set(["Failed", "Canceled"]);

function isoDate(value: Date | string, field: string): string {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new ValidationError(`${field} is not a valid date.`, { issues: [{ field, message: "is not a valid date" }] });
	}
	return date.toISOString();
}

/** CSV exports of your history. Trading 212 offers them on live only. */
export class ReportsResource {
	readonly #context: ResourceContext;

	constructor(context: ResourceContext) {
		this.#context = context;
	}

	/**
	 * Every report you have asked for, with its status and, once finished, its download link.
	 *
	 * 1 request / minute.
	 */
	async list(options: CallOptions = {}): Promise<ReportResponse[]> {
		const { data } = await this.#context.transport.request<ReportResponse[] | undefined>(
			ENDPOINTS.listReports,
			options,
		);
		return Array.isArray(data) ? data : [];
	}

	/**
	 * Asks Trading 212 to build a CSV report, and returns its ID. Trading 212 may notify the account's app.
	 *
	 * 1 request / 30 s.
	 */
	async request(request: ReportRequest, options: CallOptions = {}): Promise<number> {
		const timeFrom = isoDate(request.from, "from");
		const timeTo = isoDate(request.to, "to");
		if (timeFrom >= timeTo) {
			throw new ValidationError("from must be before to.", {
				issues: [{ field: "from", message: "is not before to" }],
			});
		}
		const include = request.include ?? {};
		const body = {
			timeFrom,
			timeTo,
			dataIncluded: {
				includeDividends: include.dividends ?? true,
				includeInterest: include.interest ?? true,
				includeOrders: include.orders ?? true,
				includeTransactions: include.transactions ?? true,
			},
		};
		const { data } = await this.#context.transport.request<EnqueuedReportResponse | undefined>(
			ENDPOINTS.requestReport,
			{
				...options,
				body,
			},
		);
		if (typeof data?.reportId !== "number") {
			throw new UnexpectedResponseError("Trading 212 accepted the report request but returned no reportId.", {
				body: data,
			});
		}
		return data.reportId;
	}

	/** Checks a report until it is finished, and returns it. Throws if it failed or was cancelled. */
	async waitFor(reportId: number, options: ReportWaitOptions = {}): Promise<ReportResponse> {
		const { timeoutMs = 10 * 60_000, intervalMs = 60_000, onStatus, ...call } = options;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const report = (await this.list(call)).find((candidate) => candidate.reportId === reportId);
			if (report) {
				onStatus?.(report);
				if (report.status === "Finished" && report.downloadLink) return report;
				if (report.status && FAILED.has(report.status)) {
					throw new UnexpectedResponseError(
						`Report ${reportId} ${report.status === "Failed" ? "failed" : "was cancelled"}.`,
						{
							body: report,
							hint: "Request it again with reports.request().",
						},
					);
				}
			}
			if (Date.now() + intervalMs > deadline) {
				throw new TimeoutError(`Report ${reportId} was not ready after ${Math.round(timeoutMs / 1000)} s.`, {
					hint: "Large reports take a while. Call reports.waitFor() again later; the report keeps building.",
				});
			}
			await sleep(intervalMs, call.signal);
		}
	}

	/**
	 * Downloads a finished report's CSV. The link is signed, so your API credentials are never sent with it.
	 */
	async download(report: ReportResponse | string, options: CallOptions = {}): Promise<string> {
		const link = typeof report === "string" ? report : report.downloadLink;
		if (!link)
			throw new ValidationError("The report has no download link yet.", {
				issues: [{ field: "downloadLink", message: "is missing" }],
			});
		let url: URL;
		try {
			url = new URL(link);
		} catch {
			throw new ValidationError("The download link is not a valid URL.", {
				issues: [{ field: "downloadLink", message: "is invalid" }],
			});
		}
		if (url.protocol !== "https:") {
			throw new ValidationError("The download link is not https.", {
				issues: [{ field: "downloadLink", message: "must be https" }],
			});
		}
		const timeoutMs = options.timeoutMs ?? Math.max(this.#context.timeoutMs, 120_000);
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		const where = stripQuery(url.toString());
		// The cause is left off: some fetch implementations put the URL, signature and all, in their messages.
		const failed = (error: unknown): Error => {
			if (options.signal?.aborted) return options.signal.reason as Error;
			const name = error instanceof Error ? error.name : "Error";
			if (timeout.aborted)
				return new TimeoutError(`Downloading the report from ${where} took longer than ${timeoutMs} ms.`);
			return new NetworkError(`Could not download the report from ${where} (${name}).`, {
				sent: true,
				hint: "Try again: downloading does not change anything.",
			});
		};
		let response: Response;
		try {
			response = await this.#context.fetch(url.toString(), { method: "GET", signal });
		} catch (error) {
			throw failed(error);
		}
		if (!response.ok) {
			throw new UnexpectedResponseError(`Downloading the report from ${where} failed with ${response.status}.`, {
				status: response.status,
				hint: "Signed links expire. Fetch a fresh one with reports.list().",
			});
		}
		try {
			return await response.text();
		} catch (error) {
			throw failed(error);
		}
	}

	/**
	 * Requests a report, waits for it and downloads it, in one call. Waiting respects the one-request-a-minute limit,
	 * so expect at least a minute.
	 *
	 * @example
	 * const { csv } = await t212.reports.export({ from: "2026-01-01", to: "2026-06-30" });
	 */
	async export(request: ReportRequest, options: ReportWaitOptions = {}): Promise<ExportResult> {
		// timeoutMs here bounds the wait; the request and the download keep their own timeouts.
		const call = options.signal ? { signal: options.signal } : {};
		const reportId = await this.request(request, call);
		const report = await this.waitFor(reportId, options);
		return { report, csv: await this.download(report, call) };
	}
}

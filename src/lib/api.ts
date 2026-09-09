import type { BookingEnvelope } from "./bookingIntent";
import { bookingSubmitErrorMessage } from "./bookingLogic";
/**
 * api.ts — API client for the booking widget.
 * All calls go directly to the client's dashboard API routes.
 * Auth is via x-site-token header on every request.
 */

type RequestOptions = {
    siteToken: string;
    widgetApiUrl: string;
};

/**
 * Carries the HTTP status alongside the message. Callers that must tell one
 * refusal from another — card-on-file confirmation answers 200, 409, 403, 422,
 * 429 and more, and they mean very different things to a customer — cannot do
 * that from an Error message alone.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(message: string, status: number, code: string, readonly data: unknown = null, readonly retryAfter: string | null = null) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

export function customerApiMessage(status: number, code: string): string {
    return bookingSubmitErrorMessage(code, status);
}

async function readResponse(res: Response) {
    const data = await res.json().catch(() => null);
    const code = typeof data?.code === "string" ? data.code : typeof data?.error === "string" ? data.error : "";
    if (!res.ok || !data || typeof data !== "object") {
        throw new ApiError(customerApiMessage(res.status, code), res.status, code, data, res.headers?.get("Retry-After"));
    }
    return data;
}
async function request(url: string, init: RequestInit) {
    let res: Response;
    try { res = await fetch(url, init); }
    catch { throw new ApiError(customerApiMessage(0, ""), 0, ""); }
    return readResponse(res);
}
async function apiPost(path: string, body: Record<string, unknown>, opts: RequestOptions) {
    return request(`${opts.widgetApiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-site-token": opts.siteToken },
        body: JSON.stringify(body),
    });
}
async function apiGet(path: string, params: Record<string, string>, opts: RequestOptions) {
    const qs = new URLSearchParams(params).toString();
    return request(`${opts.widgetApiUrl}${path}${qs ? `?${qs}` : ""}`, { headers: { "x-site-token": opts.siteToken } });
}

export const widgetApi = {
    /** Booking-specific transport keeps 202/conflicts as data for durable reconciliation. */
    submitBookingResponse: async (payload: Record<string, unknown>, opts: RequestOptions): Promise<BookingEnvelope> => {
        try {
            const res = await fetch(`${opts.widgetApiUrl}/api/ingest/website`, {
                method: "POST", headers: { "Content-Type": "application/json", "x-site-token": opts.siteToken }, body: JSON.stringify(payload),
            });
            return { status: res.status, data: await res.json().catch(() => null), retryAfter: res.headers?.get("Retry-After") };
        } catch { return { status: 0, data: null }; }
    },
    /** Submit booking or lead data to dashboard CRM */
    submitBooking: (payload: Record<string, unknown>, opts: RequestOptions) =>
        apiPost("/api/ingest/website", payload, opts),

    /** Check dumpster container availability */
    checkAvailability: (
        params: { size: string; date?: string; days?: string },
        opts: RequestOptions,
    ) => {
        const qs: Record<string, string> = { size: params.size };
        if (params.date) qs.date = params.date;
        if (params.days) qs.days = params.days;
        return apiGet("/api/booking/container-availability", qs, opts);
    },

    /** Get dynamic time slots with capacity for a specific date */
    getAvailableSlots: (date: string, opts: RequestOptions) =>
        apiGet("/api/public/available-slots", { date }, opts),

    /** Create Stripe SetupIntent for card-on-file */
    createSetupIntent: (opts: RequestOptions) =>
        apiPost("/api/booking/setup-card", {}, opts),

    /** Validate a promo code */
    validatePromo: (code: string, opts: RequestOptions) =>
        apiGet("/api/promo/validate", { code }, opts),

    /** Confirm card-on-file after SetupIntent success */
    confirmCard: (
        customerId: string,
        paymentMethodId: string,
        opts: RequestOptions,
    ) => apiPost("/api/booking/confirm-card", { customerId, paymentMethodId }, opts),

    /** Submit signed waiver */
    submitWaiver: (
        data: { leadId: string; signature: string; customerName: string },
        opts: RequestOptions,
    ) => apiPost("/api/booking/waiver", {
        leadId: data.leadId,
        signature: data.signature,
        waiverType: "damage_waiver",
        customerName: data.customerName,
    }, opts),
};

/**
 * api.ts — API client for the booking widget.
 * All calls go directly to the client's dashboard API routes.
 * Auth is via x-site-token header on every request.
 */

type RequestOptions = {
    siteToken: string;
    widgetApiUrl: string;
};

async function apiPost(path: string, body: Record<string, unknown>, opts: RequestOptions) {
    const res = await fetch(`${opts.widgetApiUrl}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-site-token": opts.siteToken,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `API error: ${path}`);
    return data;
}

async function apiGet(path: string, params: Record<string, string>, opts: RequestOptions) {
    const qs = new URLSearchParams(params).toString();
    const url = qs ? `${opts.widgetApiUrl}${path}?${qs}` : `${opts.widgetApiUrl}${path}`;
    const res = await fetch(url, {
        headers: { "x-site-token": opts.siteToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `API error: ${path}`);
    return data;
}

/* ── Public API Methods ────────────────────────────────────────────── */

export const widgetApi = {
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

    /** Create Stripe SetupIntent for card-on-file */
    createSetupIntent: (customerId: string, opts: RequestOptions) =>
        apiPost("/api/booking/setup-card", { customerId }, opts),

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

import { readSavedOutcomes, type BookingOutcome, type ServiceLeg } from "./bookingIntent";
/**
 * bookingConfirmation.ts — handover of the confirmation payload from the
 * wizard to /booking-confirmed.
 *
 * It used to travel in the query string: `?name=…&address=…`. The site loads
 * Google Analytics with `gtag('config', …)`, whose page_view carries
 * `page_location` — the whole URL, query string included — so every customer
 * name and service address the wizard redirected with was written into the
 * operator's GA property. sessionStorage is per-tab, never leaves the browser,
 * and survives the reload the customer is most likely to perform.
 *
 * The widget uses tenant-scoped per-tab storage for the same recovery guarantee.
 */

/** Same shape as the widget's BookingCompleteData, minus its React plumbing. */
export type BookingConfirmation = {
    outcomes?: Partial<Record<ServiceLeg, BookingOutcome>>;
    name: string;
    date: string;
    time: string;
    price: string;
    serviceType: string;
    address?: string;
    dumpsterPrice?: string;
    debrisType?: string;
    rentalDuration?: string;
    autoBooked?: boolean;
    pricingUnconfirmed?: boolean;
    promoRequested?: string;
    dumpsterError?: string;
    /** A CardConfirmation other than "saved"; absent when the card saved. */
    cardIssue?: string;
};

/** Anything not a string is dropped rather than rendered as "[object Object]". */
function str(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/**
 * Pure half of the read, so the shape check is testable without a browser.
 *
 * Returns null for anything it cannot use. The page falls back to a generic
 * panel on null, so a half-written or hand-edited value degrades to "we can't
 * show this" rather than to a crash or a blank screen.
 */
export function parseBookingConfirmation(raw: string | null | undefined): BookingConfirmation | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    // A payload with no service type is not one this wizard wrote.
    if (!str(o.serviceType)) return null;
    return {
        name: str(o.name),
        date: str(o.date),
        time: str(o.time),
        price: str(o.price),
        serviceType: str(o.serviceType),
        address: str(o.address),
        dumpsterPrice: str(o.dumpsterPrice),
        debrisType: str(o.debrisType),
        rentalDuration: str(o.rentalDuration),
        autoBooked: o.autoBooked === true,
        pricingUnconfirmed: o.pricingUnconfirmed !== false,
        ...(o.outcomes ? { outcomes: readSavedOutcomes(o.outcomes) } : {}),
        promoRequested: str(o.promoRequested),
        dumpsterError: str(o.dumpsterError),
        cardIssue: str(o.cardIssue),
    };
}

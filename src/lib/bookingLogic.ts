/**
 * bookingLogic.ts — pure decisions the booking wizard and the confirmation
 * page share. No React, no fetch, no storage, so it is directly testable.
 *
 * Keep identical to website-template/lib/bookingLogic.ts.
 */

export type ServiceType = "junk" | "dumpster" | "both";

/* ── Promo applicability ──────────────────────────────────────────────
 * The dashboard scopes every promo code with `appliesTo` ("junk",
 * "dumpster" or "both") and re-checks it at booking time — a code scoped
 * to the other service resolves to no discount there. The wizard used to
 * ignore the field, so a junk-only code showed "20% off applied!" on a
 * dumpster booking and then discounted nothing. */

export type PromoService = "junk" | "dumpster";

export function promoAppliesToService(appliesTo: string | undefined | null, service: PromoService): boolean {
    // A dashboard that omits the field tells us nothing about scope. Assume it
    // applies: hiding a discount the dashboard will actually grant is the wider
    // failure, and it only ever surprises the customer downwards.
    if (!appliesTo) return true;
    return appliesTo === "both" || appliesTo === service;
}

/** Does the code discount any leg of this booking? Drives the promo banner. */
export function promoAppliesToBooking(appliesTo: string | undefined | null, serviceType: ServiceType | null): boolean {
    if (serviceType === "dumpster") return promoAppliesToService(appliesTo, "dumpster");
    if (serviceType === "both") {
        return promoAppliesToService(appliesTo, "junk") || promoAppliesToService(appliesTo, "dumpster");
    }
    // "junk", and the not-yet-chosen null case.
    return promoAppliesToService(appliesTo, "junk");
}

/* ── Promo arithmetic ─────────────────────────────────────────────────
 * The wizard discounted the displayed price itself and rounded the result
 * to the nearest $5, while the dashboard discounts the booking to the
 * cent. A $350 quote with a 15% code was shown as $300 and booked at
 * $297.50: the customer agreed to one number and was charged another.
 *
 * The dashboard's formula lives in two places that already agree with
 * each other — convert-lead-to-job.ts for a junk job, auto-approve-rental.ts
 * for a rental — and is reproduced below expression for expression.
 *
 * Only the display changes. The submitted payload still carries the list
 * price, because the dashboard re-resolves the code and applies it there;
 * sending a discounted figure would discount it twice. */

/**
 * The price after the promo, to the cent.
 *
 *   percentage   Math.round(price * (1 - value / 100) * 100) / 100
 *   flat         Math.max(0, Math.round((price - value) * 100) / 100)
 *
 * Written as the same expressions the dashboard evaluates so both sides
 * round the same way on the same floating-point intermediate. A discount
 * type we do not recognise leaves the price alone, as it does there.
 */
export function applyPromoDiscount(
    price: number,
    discountType: string | undefined | null,
    discountValue: number | undefined | null,
): number {
    if (!discountValue || discountValue <= 0) return price;
    if (discountType === "percentage") return Math.round(price * (1 - discountValue / 100) * 100) / 100;
    if (discountType === "flat") return Math.max(0, Math.round((price - discountValue) * 100) / 100);
    return price;
}

/**
 * A dollar amount for display, unsigned — every call site writes its own
 * "$". Cents appear only when the amount has them, so list prices (whole
 * dollars, always, once roundTo5 has run) read exactly as before and only
 * a discounted figure ever grows a ".50".
 */
export function formatPriceAmount(amount: number): string {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/* ── Container availability ───────────────────────────────────────────
 * The dashboard answers 200 + { available: boolean } or non-200 + { error }.
 * Collapsing those into one nullable object let an error body through as
 * `available: undefined`, which read as "not unavailable" to the Continue
 * gate and as "unavailable" to the banner — both at once. */

export type AvailabilityState = "idle" | "checking" | "available" | "unavailable" | "error";

export function classifyAvailabilityResponse(ok: boolean, body: unknown): AvailabilityState {
    if (!ok) return "error";
    const available = (body as { available?: unknown } | null | undefined)?.available;
    if (available === true) return "available";
    if (available === false) return "unavailable";
    // 200 with no verdict is not a refusal — treat it as a failed check.
    return "error";
}

/**
 * Only a real refusal blocks the booking. An errored check must not: the
 * dashboard distinguishes the two, so letting an error through can never
 * override a genuine "no", while blocking on error would stop every dumpster
 * booking on every site for as long as the dashboard is unwell.
 */
export function availabilityBlocksBooking(state: AvailabilityState): boolean {
    return state === "unavailable";
}

/* ── Card-on-file confirmation ────────────────────────────────────────
 * /api/booking/confirm-card answers 200, 409, 403, 422 (seven distinct
 * returns), 400, 401, 404, 429 or 500. Every one of them used to be treated
 * as success, so a card that never saved still reported one. */

export type CardConfirmation =
    | "saved"
    | "already_on_file"
    | "not_saved_actionable"
    | "not_saved_unactionable"
    /**
     * confirm-card was never called, because the response carried no
     * customerId to call it with. A dumpster rental the dashboard cannot
     * auto-approve creates no customer, so nothing is attached, nothing is
     * charged, and the wizard used to say nothing at all — after telling the
     * customer the base rate is taken the moment their booking is confirmed.
     */
    | "not_saved_pending_approval";

/** The one 422 the customer cannot do anything about — the business has no
 *  connected Stripe account yet. The dashboard returns it as prose. */
const BUSINESS_NOT_SET_UP = "This business isn't set up to take card payments yet.";

export function classifyCardConfirmation(ok: boolean, status: number, errorCode?: string | null): CardConfirmation {
    if (ok) return "saved";
    // 409 fires before anything is attached: the new card is discarded and the
    // card already on file stays the default.
    if (status === 409 || errorCode === "card_already_on_file") return "already_on_file";
    if (errorCode === BUSINESS_NOT_SET_UP) return "not_saved_unactionable";
    // Rate limiting (10/IP/hour) and the card-shaped 422s are worth naming:
    // calling in, or using a different card, resolves them.
    if (status === 429 || status === 422) return "not_saved_actionable";
    return "not_saved_unactionable";
}

/**
 * Combine the outcomes of a combined booking's two legs.
 *
 * Both legs confirm the same card against the same customer, so once the first
 * leg saves it the second is answered 409 "already on file". Reporting that
 * second answer would tell a customer whose card saved perfectly well that we
 * kept an older one. Best outcome wins: a saved card is saved, and a card
 * already on file still beats no card at all.
 */
export function mergeCardConfirmations(
    a: CardConfirmation | null,
    b: CardConfirmation | null,
): CardConfirmation | null {
    if (a === null) return b;
    if (b === null) return a;
    const rank: Record<CardConfirmation, number> = {
        saved: 0,
        already_on_file: 1,
        not_saved_actionable: 2,
        not_saved_unactionable: 3,
        // Last on purpose. It is the one outcome behind which no confirm-card
        // call stands, so any real answer from the dashboard — including a
        // card that saved on the other leg — describes the card better.
        not_saved_pending_approval: 4,
    };
    return rank[a] <= rank[b] ? a : b;
}

/**
 * What to tell the customer. Never alarming: in every branch the booking
 * itself succeeded, and a card that failed to save was never charged.
 */
export function cardConfirmationNotice(outcome: CardConfirmation): string | null {
    switch (outcome) {
        case "saved":
            return null;
        case "already_on_file":
            return "We already had a card on file for you, so we kept it and didn't add the new one. Give us a call if you'd like to change it.";
        case "not_saved_actionable":
            return "We couldn't save your card, so nothing has been charged. Your booking is confirmed — give us a call and we'll get payment set up.";
        case "not_saved_unactionable":
            return "We couldn't save your card, so nothing has been charged. Your booking is confirmed — we'll reach out to arrange payment.";
        // Deliberately says nothing about the booking: the page above this
        // line already calls a rental awaiting approval a request, not a
        // confirmed booking, and repeating it here would contradict that.
        case "not_saved_pending_approval":
            return "Nothing has been charged to your card yet. We'll confirm your rental and arrange payment with you before delivery.";
    }
}

/* ── Dumpster leg of a "both" booking ─────────────────────────────────
 * On a combined booking the junk leg can succeed while the dumpster leg
 * fails. The wizard records that as `dumpsterError`; without it the page
 * promised to "confirm dumpster availability", for a request nobody holds. */

export function deriveDumpsterNote(input: {
    serviceType: ServiceType | string | null;
    autoBooked: boolean;
    dumpsterError: string;
}): string | null {
    const { serviceType, autoBooked, dumpsterError } = input;
    const hasDumpster = serviceType === "dumpster" || serviceType === "both";
    const hasJunk = serviceType === "junk" || serviceType === "both";
    const dumpsterPending = hasDumpster && !autoBooked;
    // Only needed alongside a junk booking. On a dumpster-only request the
    // closing line already says a person will be in touch.
    if (!(dumpsterPending && hasJunk)) return null;
    return dumpsterError
        ? "We couldn't confirm your dumpster automatically. Our team will follow up about your rental shortly."
        : "We'll confirm dumpster availability and reach out shortly.";
}

/* ── More than one truck load (D24) ───────────────────────────────────
 * A customer who knows their load needs two trips is not a customer who
 * cannot describe it, but both end in an on-site estimate. Folding the new
 * checkbox into `isOnSiteEstimate` alone would have sent dispatch a
 * multi-truck job wearing the single tier the slider happened to be on —
 * "Sofa + Armchair", "1/4" — under a note saying the customer was unsure.
 * The crew would arrive sized for a quarter load. */

/** Edge-case id for the checkbox. Matches EDGE_CASES in wizardData.ts. */
export const MULTI_LOAD_EDGE_CASE_ID = "multi_load";

/** What dispatch sees instead of a single tier's title and fraction. */
export const MULTI_LOAD_TIER_LABEL = "More Than One Truck Load";
export const MULTI_LOAD_TRUCK_FRACTION = "1+";

/**
 * The load as dispatch should read it.
 *
 * The slider still records which single tier the customer picked — it drives
 * the surcharge lookups — but once they have said it takes more than one
 * truck, that tier is a floor, not the job.
 */
export function describeLoadSize(input: {
    multiTruckLoad: boolean;
    tierTitle: string;
    truckFraction: string;
}): { loadTier: string; truckLoad: string } {
    if (input.multiTruckLoad) {
        return { loadTier: MULTI_LOAD_TIER_LABEL, truckLoad: MULTI_LOAD_TRUCK_FRACTION };
    }
    return { loadTier: input.tierTitle, truckLoad: input.truckFraction };
}

/**
 * The one-line reason attached to the booking.
 *
 * Was a single string, "On-site estimate — customer unsure of load", used for
 * every on-site estimate. Both reasons can be true at once, and neither
 * implies the other, so each says itself.
 */
export function describeEdgeCaseNote(input: {
    multiTruckLoad: boolean;
    unsureOfLoad: boolean;
    flaggedIds: string[];
}): string {
    const reasons: string[] = [];
    if (input.multiTruckLoad) reasons.push("more than one truck load");
    if (input.unsureOfLoad) reasons.push("customer unsure of load");
    if (reasons.length > 0) return `On-site estimate — ${reasons.join("; ")}`;
    return input.flaggedIds.length > 0 ? `Flagged: ${input.flaggedIds.join(", ")}` : "";
}

/* ── Contact validation ───────────────────────────────────────────────
 * The email field runs four checks — shape, typo correction, TLD, throwaway
 * domains. The phone field ran none beyond "not empty", so a single digit
 * passed the Continue gate and reached dispatch as the number to call. */

/**
 * North American numbering plan, structurally.
 *
 * Deliberately not a lookup of assigned area codes: that list changes, and
 * rejecting a real customer is far worse than accepting an unreachable one.
 * These two rules hold for every NANP number ever issued — neither the area
 * code nor the exchange code may begin 0 or 1 — and they reject the field's
 * own "(555) 123-4567" placeholder, which customers do type back.
 */
export function validatePhone(value: string): { valid: boolean; error: string } {
    const digits = (value ?? "").replace(/\D/g, "");
    // An untouched field is invalid but says nothing; the Continue button
    // being grey is message enough until they have typed.
    if (digits.length === 0) return { valid: false, error: "" };
    if (digits.length < 10) return { valid: false, error: "Please enter a 10-digit phone number." };
    if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) {
        return { valid: false, error: "That phone number doesn't look right. Please double-check." };
    }
    return { valid: true, error: "" };
}

/* ── A stale lead id (D25) ────────────────────────────────────────────
 * Both surfaces keep the lead id the first step returned in localStorage
 * and send it back on the final submit, so a returning customer updates
 * their own lead instead of spawning a second one. The id outlives the
 * lead it names, though — deleted, merged, or belonging to a different
 * operator — and the dashboard then answers 404 "Lead not found". The
 * wizard rendered that verbatim, so a customer reached the last step of a
 * booking and was shown those three words, with the booking failed.
 *
 * This does NOT address the separate, ruled-open issue that a supplied
 * leadId is not identity-checked (D25, briefed to the dashboard). Nothing
 * here tries to make the id trustworthy, and the id is still sent.
 */

/**
 * 404 is the only status /api/ingest/website returns for a lead it cannot
 * find, and it returns it before the first write — so an attempt that ends
 * this way left no lead, job, customer or charge behind, and the same
 * payload posted again without the id creates exactly one booking.
 *
 * Requires that we actually sent an id: a 404 on a request that carried
 * none is a routing failure, and repeating it would just fail twice.
 */
export function isStaleLeadResponse(status: number, sentLeadId: boolean): boolean {
    return status === 404 && sentLeadId;
}

/**
 * Messages the dashboard writes for the customer rather than for a
 * developer, matched by prefix because the widget's ApiError carries the
 * message but not the response's `code`. Every same-day refusal starts
 * this way (validateSameDayWindow returns three of them) and every one is
 * actionable — flattening "Same-day booking cutoff has passed for today"
 * into "please try again" would have the customer retry until midnight.
 */
const CUSTOMER_READY_PREFIXES = ["Same-day booking"];

/**
 * What to show when the booking POST fails.
 *
 * Everything the endpoint can return that is not in the list above is
 * written for whoever reads the logs — "Lead not found", "Validation
 * failed", "Invalid requestedDate", "Internal server error", "CRM error" —
 * and none of it means anything to a customer holding a card.
 */
export function bookingSubmitErrorMessage(error: unknown): string {
    const raw = typeof error === "string" ? error.trim() : "";
    if (raw && CUSTOMER_READY_PREFIXES.some(prefix => raw.startsWith(prefix))) return raw;
    return "We couldn't complete your booking just now. Please try again, or give us a call and we'll take care of it.";
}

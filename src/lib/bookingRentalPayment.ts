/** Accepted rental authority and original-operation recovery. Secrets stay in memory. */
export type RentalCardGrant = { status: "available"; grant: string; expiresAt: string; rentalId: string }
    | { status: "unavailable"; nextAction: "authenticated_portal" };
export type RentalPaymentQuote = {
    rentalId: string; rentalNumber: number; address: string; subtotalCents: number; taxRate: number; taxCents: number;
    totalCents: number; paidCents: number; depositCents: number; amountCents: number; currency: "usd";
};
export type RentalPaymentResult = {
    receiptId?: string; quote?: RentalPaymentQuote; canContinue: boolean; requiresFreshReview: boolean;
    nextAction?: "authenticated_portal";
    card?: { status: "saved" | "not_submitted" | "unconfirmed" | "not_found"; message: string };
    payment: { status: string; operationId?: string; invoiceId?: string; amountCents?: number; collectedCents?: number; appliedCents?: number; message: string; paymentAccess?: "blocked" };
};
export type RentalPaymentRecovery = {
    version: 1; rentalId: string; grant: string;
    stage: "idle" | "review_pending" | "reviewed" | "setup_pending" | "ready" | "setup_confirm_pending" | "confirm_pending" | "continue_pending" | "action_pending" | "observing" | "observed";
    review?: { reviewToken: string; expiresAt: string; stripeAccountId: string; quote: RentalPaymentQuote };
    setup?: { setupIntentId: string; receiptId: string };
    result?: RentalPaymentResult;
};
export type RentalPaymentAction = "review" | "setup" | "confirm" | "status" | "reconcile" | "continue";
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 500;
const token = (v: unknown): v is string => typeof v === "string" && v.length >= 20 && v.length <= 16_000 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,240}$/.test(v);
const cents = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const setupId = (v: unknown): v is string => typeof v === "string" && /^seti_[A-Za-z0-9_]{1,240}$/.test(v);
const receiptId = (v: unknown): v is string => typeof v === "string" && /^pcs_[a-f0-9]{64}$/.test(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export const rentalMoney = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
export const RENTAL_RECOVERY_MESSAGE = "The original card or payment result is unconfirmed. Check this original request before starting another payment.";
export const RENTAL_STORAGE_MESSAGE = "This browser could not save rental payment recovery details. Keep this tab open and contact us before paying.";
export const RENTAL_PORTAL_MESSAGE = "Review the current rental amount in the authenticated customer portal before approving a payment. Contact us for secure portal access.";
export function readRentalCardGrant(value: unknown, rentalId: string | null): RentalCardGrant | undefined {
    const v = record(value);
    if (v.status === "unavailable" && v.nextAction === "authenticated_portal" && keys(v, ["status", "nextAction"])) return { status: "unavailable", nextAction: "authenticated_portal" };
    if (v.status !== "available" || !keys(v, ["status", "grant", "expiresAt", "rentalId"]) || !token(v.grant) || !iso(v.expiresAt) || !id(v.rentalId) || v.rentalId !== rentalId) return;
    return { status: "available", grant: v.grant, expiresAt: v.expiresAt, rentalId: v.rentalId };
}
function readQuote(value: unknown, rentalId: string): RentalPaymentQuote | undefined {
    const q = record(value);
    if (q.rentalId !== rentalId || !cents(q.rentalNumber) || !text(q.address) || q.currency !== "usd" ||
        ![q.subtotalCents, q.taxCents, q.totalCents, q.paidCents, q.depositCents, q.amountCents].every(cents) ||
        Number(q.subtotalCents) + Number(q.taxCents) !== q.totalCents || Number(q.totalCents) - Number(q.paidCents) - Number(q.depositCents) !== q.amountCents ||
        typeof q.taxRate !== "number" || !Number.isFinite(q.taxRate) || q.taxRate < 0 || q.taxRate > 100) return;
    return { rentalId, rentalNumber: q.rentalNumber as number, address: q.address as string, subtotalCents: q.subtotalCents as number, taxRate: q.taxRate,
        taxCents: q.taxCents as number, totalCents: q.totalCents as number, paidCents: q.paidCents as number, depositCents: q.depositCents as number, amountCents: q.amountCents as number, currency: "usd" };
}
const paymentStatuses = ["not_requested", "no_amount_due", "prepared", "submitted", "submitting", "reconciliation_required", "unknown", "unconfirmed", "needs_action", "declined", "collected", "applied", "pending", "processing"];
function readResult(value: unknown, rentalId: string): RentalPaymentResult | undefined {
    const v = record(value), card = record(v.card), p = record(v.payment), quote = v.quote === undefined ? undefined : readQuote(v.quote, rentalId);
    if ((v.rentalId !== undefined && v.rentalId !== rentalId) || (v.quote !== undefined && !quote) || (v.receiptId !== undefined && !receiptId(v.receiptId)) ||
        !paymentStatuses.includes(String(p.status)) || (p.operationId != null && !id(p.operationId)) || (p.invoiceId != null && !id(p.invoiceId)) ||
        ["amountCents", "collectedCents", "appliedCents"].some(k => p[k] != null && !cents(p[k])) ||
        (v.card !== undefined && !["saved", "not_submitted", "unconfirmed", "not_found"].includes(String(card.status)))) return;
    // Never trust arbitrary provider errors or persist provider secrets/messages.
    const cardStatus = card.status as NonNullable<RentalPaymentResult["card"]>["status"];
    const payment: RentalPaymentResult["payment"] = { status: String(p.status), message: p.status === "applied" ? "Payment recorded toward this rental's base invoice."
        : p.status === "no_amount_due" ? "No rental base amount is due. No payment was collected by this action."
        : p.status === "not_requested" ? "Payment was not requested." : p.status === "declined" ? "The original payment did not complete."
        : p.status === "needs_action" ? "The original payment requires verification." : RENTAL_RECOVERY_MESSAGE };
    if (id(p.operationId)) payment.operationId = p.operationId;
    if (id(p.invoiceId)) payment.invoiceId = p.invoiceId;
    for (const k of ["amountCents", "collectedCents", "appliedCents"] as const) if (cents(p[k])) payment[k] = p[k];
    if (p.paymentAccess === "blocked") payment.paymentAccess = "blocked";
    if (payment.status === "applied" && (!payment.operationId || !cents(payment.amountCents) || payment.appliedCents !== payment.amountCents)) return;
    return { ...(receiptId(v.receiptId) ? { receiptId: v.receiptId } : {}), ...(quote ? { quote } : {}),
        ...(v.card !== undefined ? { card: { status: cardStatus, message: cardStatus === "saved" ? "Card saved." : "The original card save is not confirmed." } } : {}),
        payment, canContinue: v.canContinue === true && cardStatus === "saved" && !payment.operationId && !v.requiresFreshReview && v.nextAction !== "authenticated_portal",
        requiresFreshReview: v.requiresFreshReview === true || v.nextAction === "authenticated_portal",
        ...(v.nextAction === "authenticated_portal" ? { nextAction: "authenticated_portal" as const } : {}) };
}
export function readRentalPaymentRecovery(value: unknown, rentalId?: string | null): RentalPaymentRecovery | undefined {
    const v = record(value), r = record(v.review), s = record(v.setup);
    if (!keys(v, ["version", "rentalId", "grant", "stage", "review", "setup", "result"]) || v.version !== 1 || !id(v.rentalId) || (rentalId !== undefined && v.rentalId !== rentalId) || !token(v.grant) ||
        !["idle", "review_pending", "reviewed", "setup_pending", "ready", "setup_confirm_pending", "confirm_pending", "continue_pending", "action_pending", "observing", "observed"].includes(String(v.stage))) return;
    const result: RentalPaymentRecovery = { version: 1, rentalId: v.rentalId, grant: v.grant, stage: v.stage as RentalPaymentRecovery["stage"] };
    if (v.review !== undefined) {
        const quote = readQuote(r.quote, v.rentalId);
        if (!keys(r, ["reviewToken", "expiresAt", "stripeAccountId", "quote"]) || !token(r.reviewToken) || !iso(r.expiresAt) || typeof r.stripeAccountId !== "string" || !/^acct_[A-Za-z0-9_]+$/.test(r.stripeAccountId) || !quote) return;
        result.review = { reviewToken: r.reviewToken, expiresAt: r.expiresAt, stripeAccountId: r.stripeAccountId, quote };
    }
    if (v.setup !== undefined) {
        if (!result.review || !keys(s, ["setupIntentId", "receiptId"]) || !setupId(s.setupIntentId) || !receiptId(s.receiptId)) return;
        result.setup = { setupIntentId: s.setupIntentId, receiptId: s.receiptId };
    }
    if (["ready", "setup_confirm_pending", "confirm_pending", "continue_pending", "action_pending"].includes(result.stage) && !result.setup) return;
    if (v.result !== undefined && !keys(record(v.result), ["receiptId", "quote", "card", "payment", "canContinue", "requiresFreshReview", "nextAction"])) return;
    if (v.result !== undefined) { result.result = readResult(v.result, v.rentalId); if (!result.result || result.setup && result.result.receiptId && result.result.receiptId !== result.setup.receiptId) return; }
    if (!["idle", "review_pending"].includes(result.stage) && !result.review) return;
    return result;
}
export function newRentalPaymentRecovery(grant: RentalCardGrant | undefined): RentalPaymentRecovery | undefined {
    return grant?.status === "available" ? { version: 1, rentalId: grant.rentalId, grant: grant.grant, stage: "idle" } : undefined;
}
export type RentalPaymentCommand = { action: RentalPaymentAction; grant: string; reviewToken?: string; setupIntentId?: string; receiptId?: string; consent?: true };
/** Shared strict proxy/client shape: no contact IDs, site token or caller URL authority. */
export function readRentalPaymentCommand(value: unknown): RentalPaymentCommand | undefined {
    const v = record(value);
    const allowed: Record<RentalPaymentAction, string[]> = { review: ["action", "grant"], setup: ["action", "grant", "reviewToken"],
        confirm: ["action", "grant", "reviewToken", "setupIntentId", "receiptId", "consent"], continue: ["action", "grant", "reviewToken", "receiptId", "consent"],
        status: ["action", "grant", "reviewToken", "setupIntentId", "receiptId"], reconcile: ["action", "grant", "reviewToken", "setupIntentId", "receiptId"] };
    const action = v.action as RentalPaymentAction;
    if (!Object.prototype.hasOwnProperty.call(allowed, action) || !keys(v, allowed[action]) || !token(v.grant) || (v.reviewToken !== undefined && !token(v.reviewToken)) ||
        (v.receiptId !== undefined && !receiptId(v.receiptId)) || (v.setupIntentId !== undefined && !setupId(v.setupIntentId)) ||
        (["setup", "confirm", "continue"].includes(action) && !token(v.reviewToken)) || (action === "confirm" && !setupId(v.setupIntentId)) ||
        (action === "continue" && !receiptId(v.receiptId)) || (["confirm", "continue"].includes(action) && v.consent !== true) ||
        (["status", "reconcile"].includes(action) && !v.receiptId && !v.reviewToken)) return;
    return { action, grant: v.grant, ...(v.reviewToken ? { reviewToken: v.reviewToken as string } : {}), ...(v.setupIntentId ? { setupIntentId: v.setupIntentId as string } : {}),
        ...(v.receiptId ? { receiptId: v.receiptId as string } : {}), ...(v.consent === true ? { consent: true as const } : {}) };
}
/** Persist before EVERY dispatch, including lost setup responses with no returned IDs.
 * Reload callers use status only; new work always needs an explicit user action. */
export async function runRentalPaymentCommand(state: RentalPaymentRecovery, action: RentalPaymentAction, persist: (next: RentalPaymentRecovery) => boolean,
    send: (command: RentalPaymentCommand) => Promise<unknown>, consent = false) {
    if ((action === "review" && (state.setup || state.stage === "setup_pending")) || (action === "setup" && state.stage !== "reviewed")) throw new Error(RENTAL_PORTAL_MESSAGE);
    if ((action === "confirm" && (!state.setup || state.result?.requiresFreshReview || state.result?.payment.operationId)) || (action === "continue" && (!state.result?.canContinue || state.result.requiresFreshReview || state.result.payment.operationId))) throw new Error(RENTAL_PORTAL_MESSAGE);
    if (["setup", "confirm", "continue"].includes(action) && (!state.review || Date.parse(state.review.expiresAt) <= Date.now())) throw new Error(RENTAL_PORTAL_MESSAGE);
    if (["confirm", "continue"].includes(action) && !consent) throw new Error("Review the exact amount and approve payment first.");
    const command = readRentalPaymentCommand({ action, grant: state.grant,
        ...(action !== "review" && state.review ? { reviewToken: state.review.reviewToken } : {}),
        ...(!["review", "setup", "continue"].includes(action) && state.setup ? state.setup : {}),
        ...(action === "continue" && state.setup ? { receiptId: state.setup.receiptId } : {}),
        ...(["confirm", "continue"].includes(action) && consent ? { consent: true } : {}) });
    if (!command) throw new Error(RENTAL_RECOVERY_MESSAGE);
    const stage: RentalPaymentRecovery["stage"] = action === "review" ? "review_pending" : action === "setup" ? "setup_pending" : action === "confirm" ? "confirm_pending" : action === "continue" ? "continue_pending" : "observing";
    if (!persist({ ...state, stage })) throw new Error(RENTAL_STORAGE_MESSAGE);
    const value = record(await send(command));
    if (value.mode !== "selected_rental") throw new Error(RENTAL_RECOVERY_MESSAGE);
    const next = { ...state, stage: "observed" as RentalPaymentRecovery["stage"] };
    if (action === "review") {
        const quote = readQuote(value.quote, state.rentalId);
        if (!quote || !token(value.reviewToken) || !iso(value.expiresAt) || typeof value.stripeAccountId !== "string" || !/^acct_[A-Za-z0-9_]+$/.test(value.stripeAccountId)) throw new Error(RENTAL_RECOVERY_MESSAGE);
        next.review = { quote, reviewToken: value.reviewToken, expiresAt: value.expiresAt, stripeAccountId: value.stripeAccountId }; next.stage = "reviewed";
    }
    if (value.setupIntentId !== undefined) {
        if (!setupId(value.setupIntentId) || !receiptId(value.receiptId) || !next.review || value.stripeAccountId !== next.review.stripeAccountId ||
            (state.setup && (value.setupIntentId !== state.setup.setupIntentId || value.receiptId !== state.setup.receiptId))) throw new Error(RENTAL_RECOVERY_MESSAGE);
        next.setup = { setupIntentId: value.setupIntentId, receiptId: value.receiptId }; next.stage = "ready";
    }
    next.result = readResult(value, state.rentalId);
    if (!next.result || state.setup && next.result.receiptId && state.setup.receiptId !== next.result.receiptId) throw new Error(RENTAL_RECOVERY_MESSAGE);
    const safe = readRentalPaymentRecovery(next, state.rentalId);
    if (!safe || !persist(safe)) throw new Error(RENTAL_STORAGE_MESSAGE);
    // Client/payment secrets are returned separately and are never serialized.
    const secret = typeof value.clientSecret === "string" ? value.clientSecret : undefined;
    const paymentSecret = typeof record(value.payment).clientSecret === "string" && next.result.payment.status === "needs_action" && next.result.payment.paymentAccess !== "blocked" ? record(value.payment).clientSecret as string : undefined;
    return { state: safe, secret, paymentSecret };
}

import { readRentalTerms, type RentalTerms } from "./rentalPricing";
/** Durable, per-service booking recovery. No contact data belongs in URLs or analytics. */
export type ServiceLeg = "junk" | "dumpster";
export type BookingEnvelope = { status: number; data: unknown; retryAfter?: string | null };
export type BookingOutcome = {
    contractVersion: number | null; service: ServiceLeg; outcome: "scheduled" | "request_saved" | "pending_approval" | "uncertain" | "rejected" | "closed";
    success: boolean; leadId: string | null; jobId: string | null; rentalId: string | null; customerId: string | null;
    code: string; httpStatus: number; retryAt: number | null;
    schedule: { timezone: string; calendarDate: string | null; date: string | null; start: string | null; windowStart: string | null; windowEnd: string | null; timeSlot: string | null; planStatus: string | null } | null;
    rental: ({ status: string | null; deliveryJobId: string | null; deliveryStatus: string | null; deliveryCompleted: boolean } & RentalTerms) | null;
    pricing: { status: "accepted" | "unknown"; subtotal: number | null; subtotalMax: number | null; base: number | null; discount: number | null; fees: { kind: string; amount: number }[]; promo: { status: string }; tax: null; total: null };
    payment: { status: "unknown" }; alternatives: { date: string; slot: string | null; start: string | null; end: string | null }[];
};
export type ServiceAttempt = { payload: Record<string, unknown>; acknowledgement?: BookingOutcome };
export type BookingIntent = {
    version: 1; bookingSessionId?: string; legacy: boolean; blocked?: boolean; leadId: string | null;
    attempts: Partial<Record<ServiceLeg, ServiceAttempt>>; capture?: Record<string, unknown>; captureAcknowledgement?: BookingOutcome;
    paymentMethodId?: string; cardResults?: Record<string, string>; cardIssue?: string;
    analyticsSent?: boolean;
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string | null => typeof v === "string" && v.length > 0 ? v : null;
const money = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const instant = (v: unknown): string | null => typeof v === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const legs: ServiceLeg[] = ["junk", "dumpster"];

export function readOutcome(envelope: BookingEnvelope, service: ServiceLeg): BookingOutcome {
    const d = obj(envelope.data), p = obj(d.pricing), s = obj(d.schedule), r = obj(d.rental);
    const version = d.contractVersion === 2 ? 2 : null;
    const leadId = str(d.leadId), jobId = str(d.jobId), rentalId = str(d.rentalId);
    const ok = envelope.status >= 200 && envelope.status < 300 && envelope.status !== 202 && d.success === true && !!leadId;
    let outcome: BookingOutcome["outcome"] = "uncertain";
    if (version && d.service === service) {
        if (ok && d.outcome === "scheduled" && jobId && (service === "junk" || rentalId)) outcome = "scheduled";
        else if (ok && (d.outcome === "request_saved" || d.outcome === "pending_approval")) outcome = d.outcome;
        else if (d.outcome === "closed" && jobId) outcome = "closed";
        else if (envelope.status >= 400 && envelope.status < 500 && envelope.status !== 429 && d.outcome === "rejected") outcome = "rejected";
    } else if (!d.contractVersion && ok && d.rejected !== true) outcome = "request_saved";
    if (envelope.status === 202 || envelope.status === 429 || envelope.status >= 500 || envelope.status === 0) outcome = "uncertain";
    else if (envelope.status >= 400 && envelope.status < 500 && outcome === "uncertain") outcome = "rejected";
    let timezone = str(s.timezone);
    try { if (timezone) new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { timezone = null; }
    const retry = envelope.retryAfter ?? d.retryAfter;
    const seconds = typeof retry === "number" || typeof retry === "string" && /^\d+$/.test(retry) ? Number(retry) : null;
    const retryAt = seconds != null && Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : typeof retry === "string" && Number.isFinite(Date.parse(retry)) ? Date.parse(retry) : null;
    const acceptedPrice = version === 2 && (outcome === "scheduled" || outcome === "closed" || outcome === "request_saved" && !!jobId && !!rentalId) && p.status === "accepted";
    const subtotal = acceptedPrice ? money(p.subtotal) : null;
    const max = acceptedPrice ? money(p.subtotalMax) : null;
    const rawPromo = str(obj(p.promo).status);
    const promo = acceptedPrice || rawPromo === "pending" || rawPromo === "not_requested" ? rawPromo : null;
    return {
        contractVersion: version, service, outcome, success: ok, leadId, jobId, rentalId, customerId: str(d.customerId),
        code: str(d.code) ?? "", httpStatus: envelope.status, retryAt,
        schedule: version && timezone ? { timezone, calendarDate: typeof s.calendarDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.calendarDate) ? s.calendarDate : null,
            date: instant(s.date), start: instant(s.start), windowStart: instant(s.windowStart), windowEnd: instant(s.windowEnd), timeSlot: str(s.timeSlot), planStatus: str(s.planStatus) } : null,
        rental: version && rentalId ? { ...readRentalTerms(r), status: str(r.status), deliveryJobId: str(r.deliveryJobId), deliveryStatus: str(r.deliveryStatus), deliveryCompleted: r.deliveryCompleted === true || r.deliveryStatus === "completed" } : null,
        pricing: { status: subtotal == null ? "unknown" : "accepted", subtotal, subtotalMax: subtotal != null && max != null && max >= subtotal ? max : null,
            base: acceptedPrice ? money(p.base) : null, discount: acceptedPrice ? money(p.discount) : null,
            fees: acceptedPrice && Array.isArray(p.fees) ? p.fees.flatMap(f => { const fee = obj(f); return str(fee.kind) && money(fee.amount) != null ? [{ kind: String(fee.kind), amount: Number(fee.amount) }] : []; }) : [],
            promo: { status: promo && ["applied", "unavailable", "not_requested", "pending", "operator_override"].includes(promo) ? promo : "unknown" }, tax: null, total: null },
        payment: { status: "unknown" },
        alternatives: Array.isArray(d.alternatives) ? d.alternatives.flatMap(a => { const v = obj(a); const date = str(v.date); return date ? [{ date, slot: str(v.slot), start: str(v.start), end: str(v.end) }] : []; }) : [],
    };
}

export function readSavedOutcomes(value: unknown): Partial<Record<ServiceLeg, BookingOutcome>> {
    const data = obj(value), result: Partial<Record<ServiceLeg, BookingOutcome>> = {};
    for (const service of legs) if (obj(data[service]).service === service) {
        const raw = obj(data[service]);
        result[service] = { ...readOutcome({ status: typeof raw.httpStatus === "number" ? raw.httpStatus : 0, data: raw }, service), retryAt: typeof raw.retryAt === "number" ? raw.retryAt : null };
    }
    return result;
}

/** Corrupt drafts require review instead of silently generating a replacement intent. */
export function readWizardDraft(raw: string | null) {
    if (!raw) return null;
    try {
        const draft = JSON.parse(raw);
        if (!draft || typeof draft !== "object" || Array.isArray(draft)) return { recoveryBlocked: true };
        for (const key of ["selectedTime", "selectedDate", "serviceType", "containerSize", "debrisType", "rentalDuration", "location", "leadId", "promoCode"]) {
            if (draft[key] != null && typeof draft[key] !== "string") return { recoveryBlocked: true };
        }
        if (draft.contact != null) {
            if (typeof draft.contact !== "object" || Array.isArray(draft.contact)) return { recoveryBlocked: true };
            for (const value of Object.values(draft.contact)) if (typeof value !== "string") return { recoveryBlocked: true };
        }
        for (const key of ["step", "tierIndex", "distanceSurcharge", "distanceMiles"]) if (draft[key] != null && (typeof draft[key] !== "number" || !Number.isFinite(draft[key]) || draft[key] < 0)) return { recoveryBlocked: true };
        return draft;
    } catch { return { recoveryBlocked: true }; }
}

export function restoreIntent(saved: unknown): BookingIntent {
    const draft = obj(saved), data = obj(draft.intent);
    const leadId = str(data.leadId) ?? str(draft.leadId);
    const blocked = draft.recoveryBlocked === true || (draft.intent != null && (data.version !== 1 || (!uuid(data.bookingSessionId) && data.legacy !== true)));
    const session = uuid(data.bookingSessionId) ? data.bookingSessionId : undefined;
    const intent: BookingIntent = { version: 1, bookingSessionId: session, leadId, legacy: !session && (data.legacy === true || !!leadId), blocked, attempts: {} };
    if (!session && !intent.legacy && !blocked) intent.bookingSessionId = crypto.randomUUID();
    if (data.version === 1) {
        for (const service of legs) {
            const a = obj(obj(data.attempts)[service]), payload = obj(a.payload);
            if (Object.keys(a).length && (!str(payload.name) || !str(payload.phone) || (session && payload.bookingSessionId !== session))) { intent.blocked = true; continue; }
            if (Object.keys(payload).length) intent.attempts[service] = { payload, acknowledgement: readSavedOutcomes({ [service]: a.acknowledgement })[service] };
        }
        if (Object.keys(obj(data.capture)).length) intent.capture = obj(data.capture);
        intent.captureAcknowledgement = readSavedOutcomes({ junk: data.captureAcknowledgement }).junk;
        intent.paymentMethodId = str(data.paymentMethodId) ?? undefined;
        intent.cardResults = Object.fromEntries(Object.entries(obj(data.cardResults)).filter(([,v]) => typeof v === "string")) as Record<string, string>;
        intent.cardIssue = str(data.cardIssue) ?? undefined;
        intent.analyticsSent = data.analyticsSent === true;
    }
    return intent;
}

export function saveIntent(key: string, intent: BookingIntent): boolean {
    try {
        let draft = {};
        try { draft = obj(JSON.parse(sessionStorage.getItem(key) || "{}")); } catch {}
        sessionStorage.setItem(key, JSON.stringify({ ...draft, leadId: intent.leadId, intent }));
        return true;
    } catch { return false; }
}
/** Validation refusals allow correcting contact fields without replacing the booking session.
 * An in-flight/unknown capture remains frozen, including after reload.
 */
export const canReviseCapture = (intent: BookingIntent) => !hasAttempts(intent)
    && intent.captureAcknowledgement?.outcome === "rejected"
    && [400, 422].includes(intent.captureAcknowledgement.httpStatus);
export const hasAttempts = (intent: BookingIntent) => legs.some(s => !!intent.attempts[s]);
export const resolvedOutcome = (a?: BookingOutcome) => !!a && ["scheduled", "request_saved", "pending_approval", "closed"].includes(a.outcome);
export const intentOutcomes = (intent: BookingIntent) => Object.fromEntries(legs.flatMap(s => intent.attempts[s]?.acknowledgement ? [[s, intent.attempts[s]!.acknowledgement!]] : [])) as Partial<Record<ServiceLeg, BookingOutcome>>;
export const canResume = (intent: BookingIntent) => !intent.blocked && legs.some(s => intent.attempts[s] && (!intent.attempts[s]!.acknowledgement || intent.attempts[s]!.acknowledgement!.outcome === "uncertain"));
export const STORAGE_MESSAGE = "This browser could not save your booking recovery details. Please enable tab storage or call us before submitting.";

/** Persist every leg before the first POST. Frozen requests survive changing previews and reloads. */
export function freezeAttempts(intent: BookingIntent, payloads: Partial<Record<ServiceLeg, Record<string, unknown>>>, persist: () => boolean) {
    if (intent.blocked) throw new Error("Your saved booking needs review. Please call us to check it before starting another booking.");
    if (hasAttempts(intent)) return;
    for (const service of legs) if (payloads[service]) intent.attempts[service] = { payload: JSON.parse(JSON.stringify({ ...payloads[service], intent: "submit", ...(intent.bookingSessionId ? { bookingSessionId: intent.bookingSessionId } : {}), ...(intent.leadId ? { leadId: intent.leadId } : {}) })) };
    if (!persist()) throw new Error(STORAGE_MESSAGE);
}

/** Only unresolved legs are sent. 202 receives bounded backoff; network loss waits for explicit resume. */
export async function resumeIntent(intent: BookingIntent, send: (payload: Record<string, unknown>) => Promise<BookingEnvelope>, persist: () => boolean, changed: () => void = () => {}, wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
    if (intent.blocked) throw new Error("Your saved booking needs review. Please call us before starting another booking.");
    if (!persist()) throw new Error(STORAGE_MESSAGE);
    for (const service of legs) {
        const attempt = intent.attempts[service];
        if (!attempt || resolvedOutcome(attempt.acknowledgement) || attempt.acknowledgement?.outcome === "rejected") continue;
        // A not-yet-sent legacy leg can use the freshly recovered lead ID.
        // Service terms stay frozen; an ambiguous request is never rewritten.
        if (intent.legacy && !attempt.acknowledgement && intent.leadId) {
            attempt.payload.leadId = intent.leadId;
            if (!persist()) throw new Error(STORAGE_MESSAGE);
        }
        if (attempt.acknowledgement?.retryAt && attempt.acknowledgement.retryAt > Date.now()) continue;
        for (let retry = 0; retry < 3; retry++) {
            let envelope: BookingEnvelope;
            try { envelope = await send(attempt.payload); } catch { envelope = { status: 0, data: null }; }
            // A missing legacy lead can reconcile by full identity; preserve the UUID when present.
            if (envelope.status === 404 && attempt.payload.leadId && retry === 0) {
                delete attempt.payload.leadId; intent.leadId = null;
                if (!persist()) throw new Error(STORAGE_MESSAGE);
                continue;
            }
            const ack = readOutcome(envelope, service);
            attempt.acknowledgement = ack;
            if (ack.leadId) intent.leadId = ack.leadId;
            const saved = persist(); changed();
            if (!saved) throw new Error("Your response is shown below, but this browser could not save it. Keep this tab open and call us before booking again.");
            if (envelope.status !== 202 || retry === 2) break;
            const delay = Math.max(500 * 2 ** retry, (ack.retryAt ?? Date.now()) - Date.now());
            if (delay > 5000) break;
            await wait(delay);
        }
    }
}

export function outcomeMessage(a: BookingOutcome): string {
    if (a.code === "same_day_unavailable") return "Same-day booking is no longer available. Please contact us to review another date.";
    if (a.code.startsWith("booking_")) return "This booking needs review. Contact us to change or check the original request.";
    if (a.httpStatus === 429) return "Please wait a few minutes before checking this request again.";
    if (a.outcome === "scheduled" && a.rental?.deliveryCompleted && ["picked_up", "pending_weight"].includes(a.rental.status || "")) return "Pickup completed. Rental closeout is pending.";
    if (a.outcome === "scheduled" && a.rental?.deliveryCompleted && a.rental.status === "pickup_scheduled") return "Delivery completed. Rental pickup is scheduled.";
    if (a.outcome !== "closed" && a.rental?.deliveryStatus === "cancelled") return "Your rental is saved, but its delivery was cancelled. Contact us to review it.";
    if (a.outcome === "scheduled") return a.rental?.deliveryCompleted ? "Delivery completed. Your rental is still active." : a.service === "dumpster" ? "Rental accepted. Delivery schedule saved." : "Junk removal schedule saved.";
    if (a.outcome === "closed") return "This booking is closed. Contact us about its history or start a separate booking.";
    if (a.outcome === "pending_approval") return "Rental request received. Approval and availability still need confirmation.";
    if (a.outcome === "request_saved") return "Request received. Scheduling still needs confirmation.";
    if (a.outcome === "rejected") return a.code === "capacity" ? "That time could not be accepted. Contact us to review the available alternatives." : "Check your contact details, address and selected date with us before booking again.";
    return "We couldn't confirm this request. Check its status below or call us before submitting again.";
}

export function savedScheduleLabel(a: BookingOutcome): string | null {
    const s = a.schedule;
    if (!s || a.rental?.deliveryCompleted || a.rental?.deliveryStatus === "cancelled" || !["scheduled", "closed"].includes(a.outcome)) return null;
    const date = s.windowStart || s.date || s.start;
    if (!date) return null;
    const day = new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(date));
    const time = (v: string) => new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(v));
    return `${day}${s.windowStart && s.windowEnd ? `, ${time(s.windowStart)} – ${time(s.windowEnd)} arrival window` : " — timing needs confirmation"} (${s.timezone})`;
}
export function acceptedPriceLabel(a: BookingOutcome): string | null {
    const p = a.pricing;
    if (p.subtotal == null || p.status !== "accepted") return null;
    const format = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    return p.subtotalMax != null && p.subtotalMax > p.subtotal ? `${format(p.subtotal)} – ${format(p.subtotalMax)}` : format(p.subtotal);
}

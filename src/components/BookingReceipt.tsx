import { acceptedPriceLabel, outcomeMessage, savedScheduleLabel, type BookingOutcome, type ServiceLeg } from "../lib/bookingIntent";
import { cardConfirmationNotice, type CardConfirmation } from "../lib/bookingLogic";

export default function BookingReceipt({ outcomes, services, requestedDate, requestedTime, phone, cardIssue }: {
    outcomes: Partial<Record<ServiceLeg, BookingOutcome>>; services: ServiceLeg[];
    requestedDate?: string; requestedTime?: string; phone?: string; cardIssue?: string;
}) {
    return <section aria-label="Booking status" aria-live="polite" style={{ display: "grid", gap: 16, textAlign: "left" }}>
        {services.map(service => {
            const ack = outcomes[service], price = ack ? acceptedPriceLabel(ack) : null, schedule = ack ? savedScheduleLabel(ack) : null;
            return <article key={service} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 20, background: "var(--card)" }}>
                <h2 style={{ fontSize: 20, marginBottom: 8 }}>{service === "junk" ? "Junk removal" : "Dumpster rental"}</h2>
                <p>{ack ? outcomeMessage(ack) : "This service has not received an acknowledgement yet."}</p>
                {schedule && <p style={{ marginTop: 12 }}>{schedule}</p>}
                {!schedule && !ack?.rental?.deliveryCompleted && ack?.outcome !== "closed" && requestedDate && <p style={{ marginTop: 12 }}>Requested timing: {requestedDate}{requestedTime ? `, ${requestedTime}` : ""}. Timing still needs confirmation.</p>}
                {price ? <p style={{ marginTop: 12 }}><strong>Accepted quote subtotal: {price}</strong></p> : <p style={{ marginTop: 12 }}>Accepted price has not been confirmed.</p>}
                {ack?.pricing.promo.status === "applied" && <p>Promo applied{ack.pricing.discount != null ? `: $${ack.pricing.discount.toFixed(2)} off the lower quote` : ""}.</p>}
                {ack?.pricing.promo.status === "unavailable" && <p>The promo was unavailable. The saved subtotal uses regular pricing.</p>}
                {ack?.pricing.promo.status === "pending" && <p>Promo eligibility is awaiting approval.</p>}
                {ack?.pricing.fees.map((fee, i) => <p key={i}>{fee.kind === "same_day" ? "Same-day fee included" : "Fee included"}: ${fee.amount.toFixed(2)}</p>)}
                {ack?.alternatives.length ? <div style={{ marginTop: 12 }}><p>Alternatives to review with us:</p><ul>{ack.alternatives.map((a, i) => <li key={i}>{a.date}{a.slot ? `, ${a.slot}` : ""}{a.start ? `, ${a.start}` : ""}{a.end ? ` – ${a.end}` : ""}</li>)}</ul></div> : null}
                {ack?.retryAt && ack.retryAt > Date.now() ? <p>Check again after {new Date(ack.retryAt).toLocaleTimeString()}.</p> : null}
                {ack?.leadId && <p style={{ marginTop: 12, fontSize: 12, overflowWrap: "anywhere" }}>Request reference: {ack.leadId}</p>}
            </article>;
        })}
        <p>Tax, final total and payment status have not been established here. A saved schedule does not confirm crew assignment or an exact arrival time.</p>
        {cardIssue && <p>{cardConfirmationNotice(cardIssue as CardConfirmation)}</p>}
        {phone && <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Call to review or change your request</a>}
    </section>;
}

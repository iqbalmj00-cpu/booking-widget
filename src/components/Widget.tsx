/**
 * Widget.tsx — Root widget component.
 * Wraps BookingWizard with ConfigProvider and handles confirmation UI.
 */
import { useState } from "react";
import { ConfigProvider, type WidgetConfig } from "../lib/config";
import BookingWizard, { type BookingCompleteData } from "./BookingWizard";
import { cardConfirmationNotice, deriveDumpsterNote } from "../lib/bookingLogic";
import { Check } from "lucide-react";

type WidgetProps = {
    config: WidgetConfig;
    initialPromo?: string;
    bookingSource?: string;
};

export default function Widget({ config, initialPromo, bookingSource }: WidgetProps) {
    const [completed, setCompleted] = useState<BookingCompleteData | null>(null);

    if (completed) {
        const st = completed.serviceType;
        const hasDumpster = st === "dumpster" || st === "both";
        const hasJunk = st === "junk" || st === "both";
        // `autoBooked` arrives as undefined rather than false (the wizard sends
        // `dumpsterAutoBooked || undefined`), so test it as falsy, not === false.
        const dumpsterConfirmed = hasDumpster && !!completed.autoBooked;
        // A dumpster request the dashboard couldn't auto-approve creates no
        // rental and sends the customer no message at all. Promising one here
        // was the bug: they'd wait for a confirmation that never arrives.
        const requestOnly = hasDumpster && !hasJunk && !completed.autoBooked;

        const when = `${completed.date}${completed.time ? ` during the ${completed.time} window` : ""}`;

        const heading = hasJunk || requestOnly ? "Request Received" : "Rental Confirmed";

        const message = hasJunk
            ? `Your junk removal request for ${when} was received. Scheduling still needs confirmation.${dumpsterConfirmed ? " Your dumpster is confirmed for delivery." : ""}`
            : dumpsterConfirmed
                ? `Your dumpster is confirmed for delivery on ${when}.`
                : `We've received your dumpster rental request for ${when}. Availability still needs confirmation.`;

        // Only needed alongside a junk booking. On a dumpster-only request the
        // closing line already says a person will be in touch, and saying it
        // twice reads as padding. Derivation shared with the website's
        // confirmation page — see lib/bookingLogic.ts.
        const dumpsterNote = deriveDumpsterNote({
            serviceType: st,
            autoBooked: !!completed.autoBooked,
            dumpsterError: completed.dumpsterError ?? "",
        });

        // Saving the card can fail after the booking itself succeeded. Every
        // outcome used to be reported as success; a card that did not save now
        // says so, without implying the booking is at risk — it is not.
        const cardNotice = completed.cardIssue ? cardConfirmationNotice(completed.cardIssue) : null;

        const closing = requestOnly
            ? "A member of our team will be in touch to confirm your rental."
            : "Please check with us if you need to confirm scheduling or payment status.";

        return (
            <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)", padding: "32px 20px" }}>
                <div style={{ textAlign: "center", maxWidth: 480 }}>
                    <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #059669, #10B981)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
                        <Check size={36} color="#fff" />
                    </div>
                    <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: "var(--foreground)" }}>
                        {heading}
                    </h2>
                    <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
                        Thank you, <strong>{completed.name}</strong>! {message}
                    </p>
                    {completed.price && (
                        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
                            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Junk removal estimate shown before submission</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)" }}>{completed.price}</div>
                        </div>
                    )}
                    {hasDumpster && (
                        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
                            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Dumpster rental — {completed.dumpsterError ? "receipt unverified" : dumpsterConfirmed ? "confirmed" : "requested"}</div>
                            {completed.dumpsterPrice && <p style={{ fontSize: 20, fontWeight: 700 }}>{completed.dumpsterPrice}</p>}
                            <p>{completed.debrisType}</p>
                            {completed.rentalDuration && <p>Duration: {completed.rentalDuration}</p>}
                        </div>
                    )}
                    <p style={{ fontSize: 14, marginBottom: 16 }}>Prices shown are the estimates displayed before submission. The accepted total and any charges have not been confirmed here.{completed.promoRequested ? " Promo eligibility can change; if the code was unavailable, regular pricing applies. Please contact us to confirm the accepted amount." : ""}</p>
                    {completed.dumpsterError && config.phoneNumber && <a href={`tel:${config.phoneNumber.replace(/[^+\d]/g, "")}`} style={{ display: "inline-block", minHeight: 44 }}>Call to check the rental request</a>}
                    {completed.address && (
                        <p style={{ fontSize: 13, color: "var(--muted)" }}>📍 {completed.address}</p>
                    )}
                    {dumpsterNote && (
                        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
                            {dumpsterNote}
                        </p>
                    )}
                    {cardNotice && (
                        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
                            {cardNotice}
                        </p>
                    )}
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 16 }}>
                        {closing}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <ConfigProvider config={config}>
            <BookingWizard onComplete={setCompleted} initialPromo={initialPromo} bookingSource={bookingSource} />
        </ConfigProvider>
    );
}

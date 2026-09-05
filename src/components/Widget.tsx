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

        const heading = requestOnly ? "Request Received!" : "Booking Confirmed!";

        const message = hasJunk && hasDumpster
            ? dumpsterConfirmed
                ? `Your junk removal is scheduled for ${when}, and your dumpster is confirmed for delivery.`
                : `Your junk removal is scheduled for ${when}.`
            : hasDumpster
                ? dumpsterConfirmed
                    ? `Your dumpster is confirmed for delivery on ${when}.`
                    : `We've received your dumpster rental request for ${when}.`
                : `Your junk removal is scheduled for ${when}.`;

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
            : "We'll send you a confirmation via text and email shortly.";

        return (
            <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)", padding: 40 }}>
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
                            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Estimated Price</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)" }}>{completed.price}</div>
                        </div>
                    )}
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

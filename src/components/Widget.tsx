/**
 * Widget.tsx — Root widget component.
 * Wraps BookingWizard with ConfigProvider and handles confirmation UI.
 */
import { useState } from "react";
import { ConfigProvider, type WidgetConfig } from "../lib/config";
import BookingWizard, { type BookingCompleteData } from "./BookingWizard";
import { Check } from "lucide-react";

export default function Widget({ config }: { config: WidgetConfig }) {
    const [completed, setCompleted] = useState<BookingCompleteData | null>(null);

    if (completed) {
        return (
            <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)", padding: 40 }}>
                <div style={{ textAlign: "center", maxWidth: 480 }}>
                    <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #059669, #10B981)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
                        <Check size={36} color="#fff" />
                    </div>
                    <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: "var(--foreground)" }}>
                        Booking Confirmed!
                    </h2>
                    <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
                        Thank you, <strong>{completed.name}</strong>! Your {completed.serviceType === "both" ? "junk removal and dumpster rental" : completed.serviceType === "dumpster" ? "dumpster rental" : "junk removal"} is scheduled
                        for <strong>{completed.date}</strong> during the <strong>{completed.time}</strong> window.
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
                    {completed.dumpsterError && (
                        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
                            Our team will follow up about your dumpster rental request shortly.
                        </p>
                    )}
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 16 }}>
                        We&apos;ll send you a confirmation via text and email shortly.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <ConfigProvider config={config}>
            <BookingWizard onComplete={setCompleted} />
        </ConfigProvider>
    );
}

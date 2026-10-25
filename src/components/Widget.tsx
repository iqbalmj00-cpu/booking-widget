/** Tenant-scoped receipt survives refresh; unresolved submissions remain in the wizard. */
import { useCallback, useEffect, useState } from "react";
import { ConfigProvider, type WidgetConfig } from "../lib/config";
import BookingWizard, { type BookingCompleteData } from "./BookingWizard";
import BookingReceipt from "./BookingReceipt";
import { parseBookingConfirmation, type BookingConfirmation } from "../lib/bookingConfirmation";
import { restoreIntent, saveIntent, refreshRentalApproval, type ServiceLeg } from "../lib/bookingIntent";
import { widgetApi } from "../lib/api";
import type { RentalPaymentCommand, RentalPaymentRecovery } from "../lib/bookingRentalPayment";
import RentalBasePaymentPanel from "./booking/RentalBasePaymentPanel";

type WidgetProps = { config: WidgetConfig; initialPromo?: string; bookingSource?: string };

export default function Widget({ config, initialPromo, bookingSource }: WidgetProps) {
    const storageKey = `syjBookingWizard:${config.siteToken}`;
    const [completed, setCompleted] = useState<BookingConfirmation | null>(null);
    const [storageError, setStorageError] = useState("");
    useEffect(() => {
        try { setCompleted(parseBookingConfirmation(sessionStorage.getItem(`${storageKey}:receipt`))); } catch { setCompleted(null); }
    }, [storageKey]);
    const finish = (data: BookingCompleteData) => setCompleted(data);
    const sendRentalPayment = useCallback((command: RentalPaymentCommand) => widgetApi.rentalPaymentCommand(command, config), [config]);
    const saveRentalPayment = (next: RentalPaymentRecovery) => {
        if (!completed) return false;
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (raw) {
                const intent = restoreIntent(JSON.parse(raw));
                if (intent.blocked || intent.attempts.dumpster?.acknowledgement?.rentalId !== next.rentalId) return false;
                intent.rentalPayment = next;
                if (!saveIntent(storageKey, intent)) return false;
            }
            const receipt = { ...completed, rentalPayment: next };
            sessionStorage.setItem(`${storageKey}:receipt`, JSON.stringify(receipt));
            setCompleted(receipt); return true;
        } catch { return false; }
    };
    const checkRentalApproval = async () => {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw || !completed) throw new Error("Use the authenticated customer portal to review this rental.");
        const intent = restoreIntent(JSON.parse(raw));
        const outcome = await refreshRentalApproval(intent, payload => widgetApi.submitBookingResponse(payload, config), () => saveIntent(storageKey, intent));
        const receipt = { ...completed, outcomes: { ...completed.outcomes, dumpster: outcome } };
        try { sessionStorage.setItem(`${storageKey}:receipt`, JSON.stringify(receipt)); }
        catch { throw new Error("Keep this tab open and contact us to check approval."); }
        setCompleted(receipt);
    };
    const freshBooking = () => {
        try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(`${storageKey}:receipt`); setCompleted(null); }
        catch { setStorageError("Your browser could not start a new booking. Please call us."); }
    };
    if (completed) {
        const services: ServiceLeg[] = completed.serviceType === "both" ? ["junk", "dumpster"] : completed.serviceType === "dumpster" ? ["dumpster"] : ["junk"];
        return <div style={{ maxWidth: 640, margin: "32px auto", padding: 20 }}>
            <h1 style={{ fontSize: 28, marginBottom: 16 }}>Your booking receipt</h1>
            <p style={{ marginBottom: 20 }}>Thank you{completed.name ? `, ${completed.name}` : ""}. These are the saved responses for each service.</p>
            <BookingReceipt outcomes={completed.outcomes || {}} services={services} requestedDate={completed.date} requestedTime={completed.time} phone={config.phoneNumber} cardIssue={completed.cardIssue} rentalPayment={completed.rentalPayment} />
            {services.includes("dumpster") && <RentalBasePaymentPanel key={`${completed.outcomes?.dumpster?.rentalId}:${completed.outcomes?.dumpster?.rentalCard?.status}`} outcome={completed.outcomes?.dumpster} recovery={completed.rentalPayment} publishableKey={config.stripePublishableKey} onChange={saveRentalPayment} onCheckApproval={checkRentalApproval} send={sendRentalPayment} />}
            {completed.address && <p>{completed.address}</p>}
            {completed.debrisType && <p>Debris: {completed.debrisType}</p>}
            {completed.rentalDuration && <p>Requested duration: {completed.rentalDuration}</p>}
            {storageError && <p role="alert">{storageError}</p>}
            <button type="button" onClick={() => setCompleted(null)} style={{ minHeight: 44, marginTop: 16 }}>Review saved booking</button>
            <details style={{ marginTop: 16 }}><summary>Start a separate booking</summary><p>This creates an additional booking. It does not change or cancel the saved request.</p><button type="button" onClick={freshBooking} style={{ minHeight: 44 }}>Start new booking</button></details>
        </div>;
    }
    return <ConfigProvider config={config}><BookingWizard key={storageKey} onComplete={finish} initialPromo={initialPromo} bookingSource={bookingSource} /></ConfigProvider>;
}

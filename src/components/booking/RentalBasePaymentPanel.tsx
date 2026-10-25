"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeCardElement } from "@stripe/stripe-js";
import type { BookingOutcome } from "../../lib/bookingIntent";
import { newRentalPaymentRecovery, readRentalPaymentRecovery, runRentalPaymentCommand, rentalMoney, RENTAL_PORTAL_MESSAGE,
    RENTAL_RECOVERY_MESSAGE, RENTAL_STORAGE_MESSAGE, type RentalPaymentAction, type RentalPaymentCommand, type RentalPaymentRecovery } from "../../lib/bookingRentalPayment";

/** Owns NEW Elements for the accepted customer-bound setup; never the quote's bare setup. */
function RentalCardEntry({ publishableKey, secret, account, amount, disabled, onPay }: {
    publishableKey: string; secret: string; account: string; amount: number; disabled: boolean;
    onPay: (stripe: Stripe, card: StripeCardElement) => Promise<void>;
}) {
    const target = useRef<HTMLDivElement>(null), stripeRef = useRef<Stripe | null>(null), cardRef = useRef<StripeCardElement | null>(null);
    const [complete, setComplete] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false; let card: StripeCardElement | undefined;
        const timeout = setTimeout(() => { if (!cancelled) setError("Secure card entry did not load. Recover the original request or contact us."); }, 15000);
        (async () => {
            try {
                const stripe = await loadStripe(publishableKey, { stripeAccount: account });
                if (cancelled || !stripe || !target.current) return;
                stripeRef.current = stripe;
                card = stripe.elements({ clientSecret: secret }).create("card"); cardRef.current = card;
                card.on("ready", () => { if (!cancelled) { clearTimeout(timeout); setReady(true); } });
                card.on("change", event => { if (!cancelled) { setComplete(event.complete); setError(event.error ? "Check your card details." : ""); } });
                card.mount(target.current);
            } catch { if (!cancelled) setError("Secure card entry could not load. Recover the original request or contact us."); }
        })();
        return () => { cancelled = true; clearTimeout(timeout); card?.destroy(); cardRef.current = null; stripeRef.current = null; };
    }, [publishableKey, secret, account]);
    return <div>
        <div ref={target} aria-label="Rental card details" style={{ minHeight: 44, margin: "16px 0" }} />
        {!ready && !error && <p>Loading secure card entry…</p>}
        {error && <p role="alert">{error}</p>}
        <button type="button" disabled={disabled || !ready || !complete} onClick={() => { if (stripeRef.current && cardRef.current) void onPay(stripeRef.current, cardRef.current); }} className="btn-primary" style={{ minHeight: 44 }}>Save card &amp; pay {rentalMoney(amount)}</button>
    </div>;
}

export default function RentalBasePaymentPanel({ outcome, recovery, publishableKey, onChange, onCheckApproval, send }: {
    outcome?: BookingOutcome; recovery?: RentalPaymentRecovery; publishableKey: string;
    send: (command: RentalPaymentCommand) => Promise<unknown>;
    onChange: (next: RentalPaymentRecovery) => boolean; onCheckApproval?: () => Promise<void>;
}) {
    const initial = readRentalPaymentRecovery(recovery, outcome?.rentalId ?? null) || newRentalPaymentRecovery(outcome?.rentalCard);
    const stateRef = useRef(initial), mounted = useRef(false), busyRef = useRef(false);
    const [state, setState] = useState(initial), [busy, setBusy] = useState(false), [consent, setConsent] = useState(false);
    const [error, setError] = useState(""), [portal, setPortal] = useState(false), [setupSecret, setSetupSecret] = useState<string>();
    const [paymentSecret, setPaymentSecret] = useState<string>();
    const persist = useCallback((next: RentalPaymentRecovery) => {
        if (!onChange(next)) return false;
        stateRef.current = next; setState(next); return true;
    }, [onChange]);
    const command = useCallback(async (action: RentalPaymentAction, approved = false) => {
        const original = stateRef.current;
        if (!original) throw new Error(RENTAL_PORTAL_MESSAGE);
        const result = await runRentalPaymentCommand(original, action, persist, send, approved);
        if (action === "setup" && !result.state.result?.requiresFreshReview) setSetupSecret(result.secret);
        setPaymentSecret(result.paymentSecret);
        if (result.state.result?.requiresFreshReview) { setPortal(true); setSetupSecret(undefined); }
        return result;
    }, [persist, send]);
    const act = async (fn: () => Promise<unknown>) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setError("");
        try { await fn(); } catch (e) {
            const message = e instanceof Error ? e.message : RENTAL_RECOVERY_MESSAGE;
            setError([RENTAL_STORAGE_MESSAGE, RENTAL_PORTAL_MESSAGE].includes(message) ? message : RENTAL_RECOVERY_MESSAGE);
            if (message === RENTAL_PORTAL_MESSAGE) setPortal(true);
        } finally { busyRef.current = false; setBusy(false); }
    };
    useEffect(() => {
        // No setup, confirmation, continuation or reconciliation on reload.
        if (mounted.current) return; mounted.current = true;
        if (stateRef.current?.review && !["reviewed", "review_pending"].includes(stateRef.current.stage)) void act(() => command("status"));
        // Recovery is for this mounted accepted rental only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const quote = state?.review?.quote, result = state?.result;
    const fresh = !!state?.review && Date.parse(state.review.expiresAt) > Date.now();
    const blocked = portal || result?.requiresFreshReview || result?.payment.status === "declined";
    const pay = async (stripe: Stripe, card: StripeCardElement) => act(async () => {
        const original = stateRef.current;
        if (!original?.setup || !setupSecret || !consent || !fresh || blocked) throw new Error(RENTAL_PORTAL_MESSAGE);
        if (!persist({ ...original, stage: "setup_confirm_pending" })) throw new Error(RENTAL_STORAGE_MESSAGE);
        const confirmed = await stripe.confirmCardSetup(setupSecret, { payment_method: { card } }).finally(() => setSetupSecret(undefined));
        if (confirmed.error || confirmed.setupIntent?.id !== original.setup.setupIntentId || confirmed.setupIntent.status !== "succeeded") throw new Error(RENTAL_RECOVERY_MESSAGE);
        // This command alone may save the default and collect the reviewed base.
        await command("confirm", true); setSetupSecret(undefined); setConsent(false);
    });
    if (!outcome || outcome.service !== "dumpster") return null;
    return <section aria-label="Rental base payment" style={{ marginTop: 20, padding: 20, border: "1px solid var(--border)", borderRadius: 12 }}>
        <h2 style={{ fontSize: 20 }}>Rental base payment</h2>
        {outcome.outcome === "pending_approval" ? <>
            <p>Approval is pending. No new card save or payment is requested here.</p>
            {onCheckApproval && <button type="button" disabled={busy} onClick={() => void act(onCheckApproval)} style={{ minHeight: 44 }}>Check rental approval</button>}
        </> : !state ? <>
            <p>Payment has not been requested by this page. Use the authenticated customer portal to review your rental payment and any saved-card result.</p>
            {outcome.outcome === "scheduled" && onCheckApproval && <button type="button" disabled={busy} onClick={() => void act(onCheckApproval)} style={{ minHeight: 44 }}>Check rental payment access</button>}
        </> : <>
            <p>Your rental booking is saved. Card saving and payment have separate results below. Junk removal and rental extras are billed separately.</p>
            {quote && <div aria-label="Exact rental amount">
                <p>Rental R-{String(quote.rentalNumber).padStart(3, "0")}: {quote.address}</p>
                <p>Base subtotal: {rentalMoney(quote.subtotalCents)}</p><p>Tax ({quote.taxRate}%): {rentalMoney(quote.taxCents)}</p>
                <p>Total: {rentalMoney(quote.totalCents)}</p><p>Payments credited: {rentalMoney(quote.paidCents)}</p><p>Deposit credit: {rentalMoney(quote.depositCents)}</p>
                <p><strong>Rental base amount due: {rentalMoney(quote.amountCents)}</strong></p>
            </div>}
            {result?.card && <p aria-label="Card save result">{result.card.message}</p>}
            {result && <p aria-label="Rental payment result">{result.payment.message}{result.payment.appliedCents !== undefined ? ` ${rentalMoney(result.payment.appliedCents)}` : ""}</p>}
            {result?.payment.collectedCents !== undefined && result.payment.collectedCents > 0 && result.payment.status !== "applied" && <p>{rentalMoney(result.payment.collectedCents)} received; recording the original payment needs reconciliation. Do not start another payment.</p>}
            {!state.review && !blocked && <button type="button" disabled={busy} onClick={() => void act(() => command("review"))} style={{ minHeight: 44 }}>Review rental payment</button>}
            {quote?.amountCents === 0 && <p>No card or payment is needed for this base balance.</p>}
            {!!quote?.amountCents && fresh && !blocked && !result?.payment.operationId && (state.stage === "reviewed" || !!setupSecret || result?.canContinue) && <>
                <label style={{ display: "flex", gap: 10, margin: "16px 0" }}><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />I authorize saving my card and paying {rentalMoney(quote.amountCents)} toward this rental&apos;s base invoice.</label>
                {state.stage === "reviewed" && !state.setup && <button type="button" disabled={busy || !consent || !publishableKey} onClick={() => void act(() => command("setup"))} style={{ minHeight: 44 }}>Continue to secure card entry</button>}
                {setupSecret && state.setup && <div aria-label={`Save card & pay ${rentalMoney(quote.amountCents)}`}>
                    <p>Save card &amp; pay {rentalMoney(quote.amountCents)}</p>
                    <RentalCardEntry key={state.setup.setupIntentId} publishableKey={publishableKey} amount={quote.amountCents} secret={setupSecret} account={state.review!.stripeAccountId} disabled={busy || !consent} onPay={pay} />
                </div>}
                {result?.canContinue && !setupSecret && <button type="button" disabled={busy || !consent} onClick={() => void act(async () => { await command("continue", true); setConsent(false); })} style={{ minHeight: 44 }}>Pay {rentalMoney(quote.amountCents)} for this rental</button>}
            </>}
            {state.review && !fresh && !result?.payment.operationId && <p>{RENTAL_PORTAL_MESSAGE}</p>}
            {state.review && <button type="button" disabled={busy} onClick={() => void act(() => command("reconcile"))} style={{ minHeight: 44 }}>Recover original card/payment result</button>}
            {paymentSecret && result?.payment.operationId && !blocked && <button type="button" disabled={busy} onClick={() => void act(async () => {
                const current = stateRef.current!;
                if (!persist({ ...current, stage: "action_pending" })) throw new Error(RENTAL_STORAGE_MESSAGE);
                const stripe = await loadStripe(publishableKey, { stripeAccount: current.review!.stripeAccountId });
                if (!stripe) throw new Error(RENTAL_RECOVERY_MESSAGE);
                await stripe.confirmCardPayment(paymentSecret); setPaymentSecret(undefined); await command("reconcile");
            })} style={{ minHeight: 44 }}>Verify original payment</button>}
        </>}
        {blocked && <p>{RENTAL_PORTAL_MESSAGE}</p>}
        {busy && <p aria-live="polite">Checking the original request…</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}

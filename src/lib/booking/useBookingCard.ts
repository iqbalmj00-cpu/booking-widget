"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeCardElement } from "@stripe/stripe-js";

/** The mount target owns the element. A new quote target always gets a new element. */
export function useBookingCard(key: string, active: boolean, createSetup: () => Promise<{ clientSecret?: string; connectedAccountId?: string }>) {
    const [target, setTarget] = useState<HTMLDivElement | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [stripeReady, setStripeReady] = useState(false);
    const [cardComplete, setCardComplete] = useState(false);
    const [cardError, setCardError] = useState("");
    const [setupError, setSetupError] = useState("");
    const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
    const stripeRef = useRef<Stripe | null>(null);
    const cardRef = useRef<StripeCardElement | null>(null);
    const setupRef = useRef<{ clientSecret: string; connectedAccountId?: string } | null>(null);
    const cardMountRef = useCallback((node: HTMLDivElement | null) => setTarget(node), []);
    const retryCard = useCallback(() => { setupRef.current = null; setAttempt(n => n + 1); }, []);

    useEffect(() => {
        setStripeReady(false);
        setCardComplete(false);
        setCardError("");
        setSetupError("");
        if (!active || !key || !target) return;
        let cancelled = false;
        let card: StripeCardElement | null = null;
        const destroyCard = () => { card?.destroy(); card = null; cardRef.current = null; };
        const timeout = setTimeout(() => {
            cancelled = true;
            destroyCard();
            setStripeReady(false);
            setCardComplete(false);
            setSetupError("Card entry took too long to load. Check your connection and retry.");
        }, 15000);
        (async () => {
            try {
                const setup = setupRef.current ?? await createSetup();
                if (cancelled) return;
                if (!setup.clientSecret) throw new Error("Missing setup secret");
                setupRef.current = { ...setup, clientSecret: setup.clientSecret };
                setSetupClientSecret(setup.clientSecret);
                const stripe = await loadStripe(key, setup.connectedAccountId ? { stripeAccount: setup.connectedAccountId } : undefined);
                if (cancelled) return;
                if (!stripe) throw new Error("Stripe did not load");
                stripeRef.current = stripe;
                card = stripe.elements({ clientSecret: setup.clientSecret }).create("card", {
                    style: { base: { fontSize: "16px", color: "#1E293B", "::placeholder": { color: "#94A3B8" } }, invalid: { color: "#DC2626" } },
                });
                cardRef.current = card;
                card.on("ready", () => { if (!cancelled) { clearTimeout(timeout); setStripeReady(true); } });
                card.on("change", e => { if (!cancelled) { setCardComplete(e.complete); setCardError(e.error?.message || ""); } });
                card.mount(target);
            } catch (error) {
                if (cancelled) return;
                clearTimeout(timeout);
                destroyCard();
                console.error("Card setup failed:", error);
                setSetupError("We couldn't load secure card entry. Check your connection and retry.");
            }
        })();
        return () => {
            cancelled = true;
            clearTimeout(timeout);
            destroyCard();
            stripeRef.current = null;
        };
    }, [active, key, target, attempt, createSetup]);
    return { cardMountRef, stripeRef, cardRef, setupClientSecret, stripeReady, cardComplete, cardError, setupError, retryCard };
}

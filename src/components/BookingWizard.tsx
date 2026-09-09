import { canReviseCapture, readWizardDraft, restoreIntent, saveIntent, hasAttempts, canResume, freezeAttempts, resumeIntent, intentOutcomes, resolvedOutcome, readOutcome, acceptedPriceLabel, STORAGE_MESSAGE, type ServiceLeg, type BookingEnvelope, type BookingOutcome } from "../lib/bookingIntent";
import BookingReceipt from "./BookingReceipt";
import { getContainerSizes, validContainerSelection } from "../lib/containerCatalog";
import { useState, useCallback, useMemo, useEffect, useRef, useId } from "react";
import { Check, ChevronLeft, ArrowRight, CreditCard, Lock, Truck, CalendarDays, AlertTriangle, LockKeyhole, Hand, Wrench, Box, FileText, Home, Building2 } from "lucide-react";
import ServiceIcon from "./ServiceIcon";
import AddressAutocomplete from "./AddressAutocomplete";
import { VolumeEstimator } from "./VolumeEstimator";
import { haversineDistance } from "../lib/haversine";
import { useConfig, formatDumpsterPrice, roundTo5 } from "../lib/config";
import { widgetApi, ApiError } from "../lib/api";
import {
    promoAppliesToService, promoAppliesToBooking,
    applyPromoDiscount, formatPriceAmount,
    classifyCardConfirmation, mergeCardConfirmations, type CardConfirmation,
    classifyAvailabilityResponse, availabilityBlocksBooking, type AvailabilityState,
    describeLoadSize, describeEdgeCaseNote, validatePhone, MULTI_LOAD_EDGE_CASE_ID,
    bookingSubmitErrorMessage,
} from "../lib/bookingLogic";
import {
    VOLUME_OPTIONS,
    LOCATION_OPTIONS, TIME_SLOTS,
    DEBRIS_TYPES, RENTAL_DURATIONS,
    LOAD_TIERS, EDGE_CASES,
    getPhases, getPhaseLabel, isDayClosed, getAvailableTimeSlots,
    formatSlotTime, composeAddress,
    type ServiceType, type WizardPhase, type DynamicSlot,
} from "../lib/wizardData";
import { useBookingCard } from "../lib/booking/useBookingCard";
import { calendarDate, restoreCalendarDate, companyMode, allowedService, reconcileStep, validSlotSelection, addSameDayFee } from "../lib/bookingFlow";

export type BookingCompleteData = {
    name: string; date: string; time: string; price: string;
    serviceType: string; address?: string; dumpsterPrice?: string;
    debrisType?: string; rentalDuration?: string; autoBooked?: boolean;
    dumpsterError?: string; cardIssue?: CardConfirmation;
    pricingUnconfirmed?: boolean; promoRequested?: string;
    outcomes?: Partial<Record<ServiceLeg, BookingOutcome>>;
};

/* ── Types ───────────────────────────────────────────────────────────────────── */
type ContactInfo = {
    name: string; phone: string; email: string;
    address: string;
    /** Apartment / suite / unit. Captured separately because Google's
     *  formattedAddress overwrites the typed value and never carries a unit. */
    addressUnit: string;
    notes: string; customerType: "residential" | "commercial";
};

/* ── Stripe (loaded lazily when configured) ── */
// hasStripe determined at runtime via config context (see component body)

/* ── V2: Animated Price Counter ──────────────────────────────────────── */
function AnimatedPrice({ value, fontSize = 28 }: { value: number; fontSize?: number }) {
    const [display, setDisplay] = useState(value);
    const rafRef = useRef<number | null>(null);
    const fromRef = useRef(value);
    useEffect(() => {
        if (fromRef.current === value) return;
        const from = fromRef.current;
        const to = value;
        const duration = 300;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(Math.round(from + (to - from) * eased));
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        fromRef.current = value;
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [value]);
    return (
        <span style={{
            fontFamily: "var(--heading-font)", fontSize, fontWeight: 800,
            color: "var(--foreground)", lineHeight: 1, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums",
        }}>
            ${display}
        </span>
    );
}


/* ── V2: Edge Case Toggle ────────────────────────────────────────────── */
function EdgeToggle({ item, checked, onChange }: { item: typeof EDGE_CASES[number]; checked: boolean; onChange: () => void }) {
    return (
        <label style={{ display:"flex", alignItems:"flex-start", gap:12, cursor:"pointer", padding:"12px 0", minHeight:44 }}>
            <input type="checkbox" checked={checked} onChange={onChange} style={{ width:20, height:20, flexShrink:0, accentColor:"var(--brand)" }} />
            <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:500, color:"var(--foreground)", lineHeight:1.35 }}>{item.label}</div>
                {item.detail&&<div style={{ fontSize:12, color:"var(--muted)", marginTop:1 }}>{item.detail}</div>}
            </div>
        </label>
    );
}

/* ── Calendar ──────────────────────────────────────────────────────────── */
function Calendar({ selected, onSelect, isDisabled }: { selected: Date | null; onSelect: (d: Date) => void; isDisabled?: (d: Date) => boolean }) {
    const today = new Date();
    const [viewMonth, setViewMonth] = useState(today.getMonth());
    const [viewYear, setViewYear] = useState(today.getFullYear());

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();

    const prevMonth = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
        else setViewMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
        else setViewMonth(m => m + 1);
    };

    const isSame = (d: Date | null, day: number) =>
        d && d.getDate() === day && d.getMonth() === viewMonth && d.getFullYear() === viewYear;
    const isPast = (day: number) => {
        const d = new Date(viewYear, viewMonth, day);
        return d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    };
    const isClosed = (day: number) => {
        if (!isDisabled) return false;
        return isDisabled(new Date(viewYear, viewMonth, day));
    };
    const isUnavailable = (day: number) => isPast(day) || isClosed(day);

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <button onClick={prevMonth} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "var(--foreground)" }}>←</button>
                <span style={{ fontWeight: 700, fontSize: 16, color: "var(--foreground)" }}>
                    {new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <button onClick={nextMonth} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "var(--foreground)" }}>→</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
                    <div key={d} style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", padding: "4px 0" }}>{d}</div>
                ))}
                {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                    <button key={day} onClick={() => !isUnavailable(day) && onSelect(new Date(viewYear, viewMonth, day))}
                        style={{
                            width: 38, height: 38, borderRadius: "50%", border: "none", fontSize: 14, fontWeight: 600, cursor: isUnavailable(day) ? "default" : "pointer",
                            background: isSame(selected, day) ? "var(--brand)" : isUnavailable(day) ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(203,213,225,0.3) 3px, rgba(203,213,225,0.3) 6px)" : "transparent",
                            color: isSame(selected, day) ? "#fff" : isUnavailable(day) ? "#CBD5E1" : "var(--foreground)",
                            transition: "all 0.15s", margin: "0 auto", fontFamily: "inherit",
                        }}>
                        {day}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── Session persistence helpers ────────────────────────────────────────── */
const WIZARD_STORAGE_KEY = "syjBookingWizard";

function loadSavedWizard(storageKey: string) {
    if (typeof window === "undefined") return null;
    try {
        const raw = sessionStorage.getItem(storageKey);
        return readWizardDraft(raw);
    } catch { return { recoveryBlocked: true }; }
}

/* ── Main Wizard ───────────────────────────────────────────────────────── */
export default function BookingWizard({
    onComplete,
    initialPromo,
    bookingSource = "WIDGET",
}: {
    onComplete?: (data: BookingCompleteData) => void;
    initialPromo?: string;
    bookingSource?: string;
}) {
    const config = useConfig();
    const hasStripe = !!config.stripePublishableKey;
    const apiOpts = useMemo(() => ({
        siteToken: config.siteToken,
        widgetApiUrl: config.widgetApiUrl,
    }), [config.siteToken, config.widgetApiUrl]);
    const storageKey = `${WIZARD_STORAGE_KEY}:${config.siteToken}`;
    const [saved] = useState(() => loadSavedWizard(storageKey));
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);
    const [intent] = useState(() => restoreIntent(saved));
    const [, refreshIntent] = useState(0);
    const changedIntent = () => refreshIntent(n => n + 1);
    const persistIntent = useCallback(() => saveIntent(storageKey, intent), [intent, storageKey]);
    const sendingRef = useRef(false);
    const freshBooking = () => {
        try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(`${storageKey}:receipt`); window.location.reload(); }
        catch { setError(STORAGE_MESSAGE); }
    };
    const fieldId = useId();
    const mode = config.offersDumpsterRental ? companyMode(config.companyMode, true) : "junk_removal";
    const leadIdRef = useRef<string | null>(typeof saved?.leadId === "string" ? saved.leadId : null);
    const initialTierIndex = Math.max(0, Math.min(4, saved?.tierIndex ?? 1));

    const [step, setStep] = useState(saved?.step ?? 0);
    const [tierIndex, setTierIndex] = useState<number>(initialTierIndex);
    const [edgeCases, setEdgeCases] = useState<Record<string, boolean>>(saved?.edgeCases ?? {});
    const [volume, setVolume] = useState<string | null>(LOAD_TIERS[initialTierIndex].volumeId);
    const [location, setLocation] = useState<string | null>(saved?.location ?? null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(restoreCalendarDate(saved?.selectedDate));
    const [selectedTime, setSelectedTime] = useState<string | null>(() => {
        const t = saved?.selectedTime ?? null;
        if (t && !t.includes("-")) return null;
        return t;
    });
    const [dynamicSlots, setDynamicSlots] = useState<DynamicSlot[] | null>(null);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [slotsDate, setSlotsDate] = useState<string | null>(null);
    const [slotsError, setSlotsError] = useState(false);
    const [slotSameDay, setSlotSameDay] = useState<{ isSameDay: boolean; surchargeType?: string; surchargeAmount?: number } | null>(null);
    // The spread order matters: a session saved before addressUnit existed has
    // no such key, and an undefined value would make the input uncontrolled.
    const [contact, setContact] = useState<ContactInfo>({
        name: "", phone: "", email: "", address: "", addressUnit: "", notes: "", customerType: "residential",
        ...(saved?.contact ?? {}),
    });
    const [addressInArea, setAddressInArea] = useState(true);
    const [addressConfirmed, setAddressConfirmed] = useState(saved?.addressConfirmed ?? false);
    /** True only when the address came from a Google suggestion. Manual entry
     *  (Places unavailable or unconfigured) yields no ZIP and no coordinates,
     *  so the service-area checks cannot run and the operator needs to know. */
    const [addressVerified, setAddressVerified] = useState<boolean>(saved?.addressVerified ?? true);
    const [outOfAreaMsg, setOutOfAreaMsg] = useState<string | null>(null);
    const [distanceSurcharge, setDistanceSurcharge] = useState(saved?.distanceSurcharge ?? 0);
    const [distanceMiles, setDistanceMiles] = useState<number | null>(saved?.distanceMiles ?? null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [leadCaptured, setLeadCaptured] = useState(!!leadIdRef.current && !!saved?.leadCaptured);
    const [storedCustomerId, setStoredCustomerId] = useState<string | null>(null);

    /* ── Terms state ── */
    const [termsAccepted, setTermsAccepted] = useState(saved?.termsAccepted ?? false);

    /* ── Dumpster rental state ── */
    const [serviceType, setServiceType] = useState<ServiceType | null>(allowedService(saved?.serviceType, mode));
    const containerSizes = useMemo(() => getContainerSizes(config.dumpsterPricing), [config.dumpsterPricing]);
    const [containerSize, setContainerSize] = useState<string | null>(() => validContainerSelection(saved?.containerSize, config.dumpsterPricing));
    const [debrisType, setDebrisType] = useState<string | null>(saved?.debrisType ?? null);
    const [rentalDuration, setRentalDuration] = useState<string | null>(saved?.rentalDuration ?? null);

    /* ── Container availability state ── */
    const [containerAvailability, setContainerAvailability] = useState<{
        available: boolean; baseRate?: number; includedDays?: number;
        extendedDailyRate?: number; weightAllowanceTons?: number;
        overageRatePerTon?: number; alternativeSizes?: number[];
        nextAvailableDate?: string;
    } | null>(null);
    // Explicit state, because "no verdict" is not "unavailable". apiGet throws
    // on any non-200 as well as on a network fault, so both used to collapse to
    // null and the panels drew nothing (or an empty box) with no explanation.
    const [availabilityState, setAvailabilityState] = useState<AvailabilityState>("idle");
    const availabilityKey = `${selectedDate ? calendarDate(selectedDate) : ""}|${containerSize}|${rentalDuration}`;
    const [checkedAvailabilityKey, setCheckedAvailabilityKey] = useState<string | null>(null);

    /* ── Promo code state ── */
    const [promoCode, setPromoCode] = useState<string | null>(initialPromo || saved?.promoCode || null);
    const [promoResult, setPromoResult] = useState<{
        valid: boolean; discountType?: string; discountValue?: number; label?: string; reason?: string;
        appliesTo?: string;
    } | null>(null);
    const [promoValidating, setPromoValidating] = useState(false);
    const [promoInputOpen, setPromoInputOpen] = useState(saved?.promoInputOpen ?? false);
    const [promoInputValue, setPromoInputValue] = useState(saved?.promoInputValue ?? "");

    /* ── Payment preference state ── */
    const [paymentPreference, setPaymentPreference] = useState<"card" | "on_site" | null>(saved?.paymentPreference ?? null);

    /* ── Phase system ── */
    const phases = useMemo(() => getPhases(serviceType, config.offersDumpsterRental).filter(phase => mode === "both" || phase !== "service_type"), [serviceType, config.offersDumpsterRental, mode]);
    const currentStep = reconcileStep(phases, step);
    const currentPhase = phases[currentStep];
    const phasesRef = useRef(phases);
    phasesRef.current = phases;

    const createCardSetup = useCallback(async () => {
        return widgetApi.createSetupIntent(apiOpts);
    }, [apiOpts]);
    const { stripeReady, cardComplete, cardError, setupError, retryCard, setupClientSecret, stripeRef, cardRef, cardMountRef } =
        useBookingCard(config.stripePublishableKey, currentPhase === "quote" && paymentPreference === "card" && !hasAttempts(intent), createCardSetup);

    const rememberLead = useCallback((id: string | null) => {
        leadIdRef.current = id;
        intent.leadId = id;
        try {
            const raw = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
            sessionStorage.setItem(storageKey, JSON.stringify({ ...raw, leadId: id, intent }));
        } catch {}
    }, [storageKey]);

    /* ── Save wizard state to sessionStorage on every change ── */
    useEffect(() => {
        const data = {
            step, tierIndex, edgeCases, volume, location,
            selectedDate: selectedDate ? calendarDate(selectedDate) : null,
            leadId: intent.leadId, intent,
            selectedTime, contact, distanceSurcharge, distanceMiles, leadCaptured,
            termsAccepted, serviceType, containerSize, debrisType,
            rentalDuration, promoCode, promoInputOpen, promoInputValue, paymentPreference,
            addressConfirmed, addressVerified,
        };
        try { sessionStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
    }, [step, tierIndex, edgeCases, volume, location,
        selectedDate, selectedTime, contact, distanceSurcharge, distanceMiles, leadCaptured,
        termsAccepted, serviceType, containerSize, debrisType,
        rentalDuration, promoCode, promoInputOpen, promoInputValue, paymentPreference,
        addressConfirmed, addressVerified, intent, storageKey]);

    // A booking switched to junk-only must not keep its dumpster answers: they
    // would otherwise ride along in the payload and the confirmation. Only
    // "junk" clears — leaving the choice unset is not the same as changing it,
    // and clearing there would wipe answers restored from sessionStorage.
    useEffect(() => {
        if (serviceType !== "junk") return;
        setContainerSize(null);
        setDebrisType(null);
        setRentalDuration(null);
        setPaymentPreference(null);
    }, [serviceType, config.offersDumpsterRental]);

    // Check container availability — only fires when date is selected for accurate date-aware check
    useEffect(() => {
        if (!containerSize || !validContainerSelection(containerSize, config.dumpsterPricing) || !selectedDate) { setContainerAvailability(null); setAvailabilityState("idle"); return; }
        let cancelled = false;
        setAvailabilityState("checking");
        setContainerAvailability(null);
        setCheckedAvailabilityKey(null);
        (async () => {
            try {
                const params: { size: string; date?: string; days?: string } = { size: String(parseInt(containerSize)) };
                if (selectedDate) params.date = calendarDate(selectedDate);
                if (rentalDuration) {
                    const daysMap: Record<string, string> = { "1_week": "7", "2_weeks": "14", "call_when_full": "14" };
                    params.days = daysMap[rentalDuration] || "14";
                }
                const data = await widgetApi.checkAvailability(params, apiOpts);
                if (cancelled) return;
                const state = classifyAvailabilityResponse(true, data);
                setAvailabilityState(state);
                setCheckedAvailabilityKey(availabilityKey);
                // Only a real verdict may drive the pricing and banner details.
                setContainerAvailability(state === "available" || state === "unavailable" ? data : null);
            } catch {
                // apiGet throws for a refusal and for a network fault alike, and
                // neither is the dashboard saying no.
                if (!cancelled) { setAvailabilityState("error"); setContainerAvailability(null); setCheckedAvailabilityKey(availabilityKey); }
            }
        })();
        return () => { cancelled = true; };
    }, [containerSize, selectedDate, rentalDuration, config.dumpsterPricing, availabilityKey, apiOpts]);

    // Results belong to a single date. An empty successful list is a refusal;
    // transport/shape failure uses the existing static fallback policy.
    useEffect(() => {
        setDynamicSlots(null);
        setSlotsDate(null);
        setSlotsError(false);
        setSlotSameDay(null);
        if (!selectedDate) { setLoadingSlots(false); return; }
        let cancelled = false;
        setLoadingSlots(true);
        const dateStr = calendarDate(selectedDate);
        (async () => {
            try {
                const data = await widgetApi.getAvailableSlots(dateStr, apiOpts);
                if (!Array.isArray(data.slots) || !data.slots.every((s: DynamicSlot) => typeof s?.start === "string" && typeof s?.end === "string" && typeof s?.available === "boolean")) throw new Error("Invalid slots response");
                if (!cancelled) {
                    setDynamicSlots(data.slots);
                    setSlotSameDay(typeof data.sameDay?.isSameDay === "boolean" ? data.sameDay : null);
                }
            } catch {
                if (!cancelled) { setDynamicSlots(null); setSlotsError(true); }
            } finally {
                if (!cancelled) { setSlotsDate(dateStr); setLoadingSlots(false); }
            }
        })();
        return () => { cancelled = true; };
    }, [selectedDate, apiOpts]);

    // Validate promo code when set (from URL or manual input)
    useEffect(() => {
        if (!promoCode) { setPromoResult(null); return; }
        let cancelled = false;
        setPromoValidating(true);
        widgetApi.validatePromo(promoCode, apiOpts)
            .then(data => { if (!cancelled) setPromoResult(data); })
            .catch(() => { if (!cancelled) setPromoResult({ valid: false, reason: "Validation failed" }); })
            .finally(() => { if (!cancelled) setPromoValidating(false); });
        return () => { cancelled = true; };
    }, [promoCode]);

    // The discounted price the dashboard will actually book, formatted for
    // display. Rounding to $5 here showed $300 on a $350 quote at 15% that the
    // dashboard books at $297.50 — see ../lib/bookingLogic.ts.
    const discountedPriceText = (price: number): string => {
        if (!promoResult?.valid) return formatPriceAmount(price);
        return formatPriceAmount(applyPromoDiscount(price, promoResult.discountType, promoResult.discountValue));
    };

    // Every promo is scoped to junk, dumpster or both. The dashboard re-checks
    // that scope when the booking lands and discounts nothing outside it, so a
    // code that does not cover a leg must not advertise a discount on it.
    const promoDiscountsJunk = !!promoResult?.valid && promoAppliesToService(promoResult.appliesTo, "junk");
    const promoDiscountsDumpster = !!promoResult?.valid && promoAppliesToService(promoResult.appliesTo, "dumpster");
    const promoApplies = !!promoResult?.valid && promoAppliesToBooking(promoResult.appliesTo, serviceType);

    // Card-on-file is required for dumpster rental requests, matching the hosted website wizard.
    useEffect(() => {
        if (hasStripe && (serviceType === "dumpster" || serviceType === "both") && paymentPreference !== "card") {
            setPaymentPreference("card");
        }
    }, [serviceType, hasStripe, paymentPreference]);

    /* ── Browser back-button integration ── */
    useEffect(() => {
        // Base the history on the step actually being shown — after a reload
        // that is the step restored from sessionStorage, not 0, and claiming 0
        // made the first Back jump to the start instead of one step back.
        // Merged into the existing state rather than replacing it: this entry is
        // the operator's page, and whatever their own site keeps here has to
        // survive the widget mounting on top of it.
        window.history.replaceState({ ...window.history.state, wizardStep: reconcileStep(phasesRef.current, saved?.step), wizardPhase: phasesRef.current[reconcileStep(phasesRef.current, saved?.step)], wizardFlow: phasesRef.current.join("|") }, "");

        const onPopState = (e: PopStateEvent) => {
            const prevStep = e.state?.wizardStep;
            if (typeof prevStep === "number" && prevStep >= 0) {
                const next = reconcileStep(phasesRef.current, prevStep, e.state?.wizardPhase, e.state?.wizardFlow);
                setStep(next);
                window.history.replaceState({ ...window.history.state, wizardStep: next, wizardPhase: phasesRef.current[next], wizardFlow: phasesRef.current.join("|") }, "");
            } else {
                // No wizard state = user is leaving the page, let it happen
            }
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [saved]);

    useEffect(() => { if (step !== currentStep) setStep(currentStep); }, [step, currentStep]);

    const goNext = useCallback(() => {
        const next = Math.min(currentStep + 1, phases.length - 1);
        setStep(next);
        window.history.pushState({ ...window.history.state, wizardStep: next, wizardPhase: phases[next], wizardFlow: phases.join("|") }, "");
    }, [currentStep, phases]);
    const goBack = () => {
        if (step > 0) window.history.back(); // triggers popstate → setStep
        // If step === 0, browser back navigates away from /book naturally
    };

    const toggleEdge = (id: string) =>
        setEdgeCases(prev => {
            const next = { ...prev, [id]: !prev[id] };
            // When "scattered everywhere / I have no idea" gets checked,
            // clear access — the dropdown disappears and the info is
            // irrelevant for an on-site estimate anyway.
            if (id === "unknown" && next.unknown) setLocation(null);
            return next;
        });

    // Both mean "more than one truck": the checkbox the customer ticks, and the
    // sixth LOAD_TIERS entry (unreachable today — the estimator stops at five).
    const multiTruckLoad = !!edgeCases[MULTI_LOAD_EDGE_CASE_ID] || volume === "multi";
    const isOnSiteEstimate = !!edgeCases["unknown"] || multiTruckLoad;

    /* ── Sync tierIndex → volume ── */
    useEffect(() => { setVolume(LOAD_TIERS[tierIndex].volumeId); }, [tierIndex]);

    /* ── Pricing from config ─────────────────────────────────────── */
    const pricing = config.pricing;
    const tierData = pricing.tiers.find(t => t.id === volume);
    const accessSurcharge = pricing.surcharges.find(s => s.id === "access");
    const heavySurcharge = pricing.surcharges.find(s => s.id === "heavy_material");
    const applianceSurcharge = pricing.surcharges.find(s => s.id === "appliance");
    // Access surcharge is keyed by location id via amountsByLocation map.
    const accessAmount = (location && accessSurcharge?.enabled)
        ? (accessSurcharge.amountsByLocation?.[location] ?? 0)
        : 0;
    // Heavy Material scales with load size: amountsByTier[tierIndex] when present, else flat amount.
    const heavyAmount = (edgeCases.heavy && heavySurcharge?.enabled)
        ? (heavySurcharge.amountsByTier?.[tierIndex] ?? heavySurcharge.amount)
        : 0;
    // Appliance is flat — never scales by tier.
    const applianceAmount = (edgeCases.specialty && applianceSurcharge?.enabled)
        ? applianceSurcharge.amount
        : 0;
    const totalAdj = accessAmount + distanceSurcharge + heavyAmount + applianceAmount;

    const offeredSlots: DynamicSlot[] = dynamicSlots ?? (selectedDate ? getAvailableTimeSlots(selectedDate, config.businessHours).map(s => ({
        start: String(s.startHour).padStart(2, "0") + ":00",
        end: String(s.startHour + 2).padStart(2, "0") + ":00",
        label: s.label, available: true, remainingCapacity: 99,
    })) : []);
    const scheduleIsValid = () => validSlotSelection({
        date: selectedDate ? calendarDate(selectedDate) : null,
        today: calendarDate(new Date()), time: selectedTime, loadedDate: slotsDate,
        loading: loadingSlots, closed: !!selectedDate && isDayClosed(selectedDate, config.businessHours),
        slots: offeredSlots.map(slot => ({ id: `${slot.start}-${slot.end}`, disabled: !slot.available })),
        rental: serviceType === "dumpster" || serviceType === "both",
        availability: availabilityState, availabilityCurrent: checkedAvailabilityKey === availabilityKey,
    });
    const displayJunkTotal = (base: number) => slotSameDay && selectedDate && slotsDate === calendarDate(selectedDate)
        ? (slotSameDay.isSameDay ? addSameDayFee(base, slotSameDay) : base)
        : base;

    const canProceed = (phase: WizardPhase = currentPhase) => {
        if ((serviceType === "dumpster" || serviceType === "both") && !config.offersDumpsterRental) return false;
        if (["dumpster_details", "schedule", "quote"].includes(phase) && (serviceType === "dumpster" || serviceType === "both") && !validContainerSelection(containerSize, config.dumpsterPricing)) return false;
        switch (phase) {
            case "contact": {
                const hasRequired = !!(contact.name && contact.email && contact.address);
                const areaOk = addressConfirmed && addressInArea && !outOfAreaMsg;
                const emailOk = emailValidation.valid;
                return hasRequired && areaOk && emailOk && phoneValidation.valid;
            }
            case "service_type": return serviceType !== null;
            case "load_estimate":
                // Volume always required. Access required UNLESS "scattered everywhere" is checked.
                return volume !== null && (!!edgeCases.unknown || location !== null);
            case "dumpster_size": return validContainerSelection(containerSize, config.dumpsterPricing) !== null;
            case "dumpster_details": return debrisType !== null && rentalDuration !== null;
            case "schedule": return scheduleIsValid();
            case "quote": return termsAccepted;
            default: return false;
        }
    };

    /* ── Service address ───────────────────────────────────────────────
     * Everything sent to the dashboard uses this, never `contact.address`
     * on its own — otherwise the apartment number the customer typed is
     * dropped and the crew turns up at the building with no unit. */
    const serviceAddress = composeAddress(contact.address, contact.addressUnit);

    /* ── SMS consent text (shown verbatim to the customer) ─────────── */
    const SMS_CONSENT_TEXT = "By proceeding to the next step you agree to marketing and booking related SMS and Email communications.";

    /* ── Capture lead on Step 0 completion ─────────────────────────── */
    const captureLead = useCallback(async () => {
        if (leadCaptured) { goNext(); return; }
        setSubmitting(true);
        setError("");
        try {
            if (intent.blocked) throw new Error("Your saved booking needs review. Please call us before booking again.");
            if (!intent.capture || canReviseCapture(intent)) intent.capture = {
                intent: "capture", ...(intent.bookingSessionId ? { bookingSessionId: intent.bookingSessionId } : {}),
                ...(intent.leadId ? { leadId: intent.leadId } : {}),
                name: contact.name,
                phone: contact.phone,
                email: contact.email,
                address: serviceAddress,
                description: contact.notes || "Widget booking started",
                source: bookingSource,
                smsOptIn: true,
                consentText: SMS_CONSENT_TEXT,
                metadata: {
                    customerType: contact.customerType,
                    ...(contact.addressUnit ? { addressUnit: contact.addressUnit } : {}),
                    ...(addressVerified ? {} : { addressVerified: false }),
                },

            };
            // Persist uncertainty before sending, so reload cannot reuse an old refusal to edit an in-flight request.
            intent.captureAcknowledgement = readOutcome({ status: 0, data: null }, "junk");
            if (!persistIntent()) throw new Error(STORAGE_MESSAGE);
            const envelope = await widgetApi.submitBookingResponse(intent.capture, apiOpts);
            const data = readOutcome(envelope, "junk");
            intent.captureAcknowledgement = data;
            if (!persistIntent()) throw new Error(STORAGE_MESSAGE);
            if (!resolvedOutcome(data)) throw new Error(bookingSubmitErrorMessage(data.code, envelope.status));
            if (data.leadId) rememberLead(data.leadId);
            if (data.customerId) setStoredCustomerId(data.customerId);
            setLeadCaptured(true);
            goNext();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }, [contact, serviceAddress, addressVerified, leadCaptured, SMS_CONSENT_TEXT, goNext, apiOpts, bookingSource, intent, persistIntent, rememberLead]);

    useEffect(() => {
        if (allowedService(serviceType, mode) !== serviceType) {
            setServiceType(allowedService(null, mode)); setContainerSize(null); setStep(0); return;
        }
        if ((serviceType === "dumpster" || serviceType === "both") && !validContainerSelection(containerSize, config.dumpsterPricing)) {
            const sizeStep = phases.indexOf("dumpster_size");
            if (containerSize !== null) setContainerSize(null);
            if (sizeStep >= 0 && step > sizeStep) setStep(sizeStep);
        }
    }, [containerSize, config.dumpsterPricing, config.offersDumpsterRental, serviceType, phases, step]);

    /* ── Final booking submit ─────────────────────────────────────── */
    const handleSubmit = async () => {
        if (sendingRef.current) return;
        if (!hasAttempts(intent)) {
            if (!serviceType || allowedService(serviceType, mode) !== serviceType) {
                setError("Choose an offered service before submitting.");
                setServiceType(allowedService(null, mode));
                setStep(Math.max(0, phases.indexOf("service_type")));
                return;
            }
            // Browser Forward can revisit quote after an earlier answer was cleared.
            // Recheck all required phases before any booking or card request.
            const incompletePhase = phases.find(phase => phase !== "quote" && !canProceed(phase));
            if (incompletePhase) {
                setError(incompletePhase === "schedule"
                    ? "Please review the date and choose a currently available time before submitting."
                    : "Please complete the required details before submitting.");
                setStep(phases.indexOf(incompletePhase));
                return;
            }
            if (!termsAccepted) return;
            if ((serviceType === "dumpster" || serviceType === "both") && !config.offersDumpsterRental) {
                setError("Dumpster rental is no longer offered. Please review your service selection.");
                setStep(0); return;
            }
            if ((serviceType === "dumpster" || serviceType === "both") && !validContainerSelection(containerSize, config.dumpsterPricing)) {
                setError("Choose a currently offered container size before booking.");
                setStep(phases.indexOf("dumpster_size"));
                return;
            }
        }
        sendingRef.current = true;
        setSubmitting(true);
        setError("");
        try {
            // Shared card confirmation (runs once, caches result)
            let confirmedPaymentMethodId: string | null = intent.paymentMethodId ?? null;
            // How saving the card actually went. Every status used to be read as
            // success, so a card that never saved still reported one — and on a
            // 409 the new card is discarded while the old one stays default.
            // The booking is never blocked on this; only what we claim changes.
            // Held on an object, not in a bare `let`: TypeScript narrows a local
            // assigned only from inside a closure back to its initializer.
            const card: { outcome: CardConfirmation | null } = { outcome: null };
            const recordCardConfirmation = async (customerId: string, paymentMethodId: string) => {
                try {
                    await widgetApi.confirmCard(customerId, paymentMethodId, apiOpts);
                    card.outcome = mergeCardConfirmations(card.outcome, "saved");
                } catch (err) {
                    const status = err instanceof ApiError ? err.status : 0;
                    const code = err instanceof ApiError ? err.code : "";
                    card.outcome = mergeCardConfirmations(card.outcome, classifyCardConfirmation(false, status, code));
                    console.warn("Card confirmation failed:", err);
                }
            };
            const confirmCard = async (): Promise<string | null> => {
                if (confirmedPaymentMethodId) return confirmedPaymentMethodId;
                if (!hasStripe || !stripeRef.current || !cardRef.current || !setupClientSecret) return null;
                const { setupIntent, error: stripeErr } = await stripeRef.current.confirmCardSetup(
                    setupClientSecret,
                    { payment_method: { card: cardRef.current, billing_details: { name: contact.name, phone: contact.phone, email: contact.email } } }
                );
                if (stripeErr) throw new Error(stripeErr.message || "Card save failed");
                confirmedPaymentMethodId = (setupIntent?.payment_method as string) || null;
                if (confirmedPaymentMethodId) intent.paymentMethodId = confirmedPaymentMethodId;
                if (!persistIntent()) throw new Error(STORAGE_MESSAGE);
                return confirmedPaymentMethodId;
            };

            const sendBooking = (payload: Record<string, unknown>): Promise<BookingEnvelope> => widgetApi.submitBookingResponse(payload, apiOpts);
            const buildJunkPayload = () => {
                const loadTier = LOAD_TIERS[tierIndex];
                const edgeCaseIds = Object.entries(edgeCases).filter(([, v]) => v).map(([k]) => k);
                const volumeOption = VOLUME_OPTIONS.find(v => v.id === volume);
                // The slider tier is a floor once the customer says it takes more
                // than one truck; sending it as the job would put the crew in one
                // truck sized for a quarter load. See ../lib/bookingLogic.ts.
                const loadSize = describeLoadSize({
                    multiTruckLoad,
                    tierTitle: loadTier.title,
                    truckFraction: volumeOption?.fraction || "",
                });
                const description = isOnSiteEstimate
                    ? `${loadSize.loadTier} — on-site estimate${edgeCaseIds.length ? ` (${edgeCaseIds.join(", ")})` : ""}`
                    : `${loadSize.loadTier} junk removal${edgeCaseIds.length ? ` (${edgeCaseIds.join(", ")})` : ""}`;
                const locationOption = LOCATION_OPTIONS.find(l => l.id === location);
                const minPrice = tierData ? roundTo5(tierData.min + totalAdj) : 0;
                const maxPrice = tierData ? roundTo5(tierData.max + totalAdj) : 0;
                // Matches what the website wizard sends when no price book exists.
                const quoteRangeStr = isOnSiteEstimate
                    ? "On-Site Estimate"
                    : (tierData ? `$${minPrice} – $${maxPrice}` : "Quote confirmed on site");
                const stairsAccessLabel = locationOption?.label || "Ground Floor";

                const payload: Record<string, unknown> = {
                    type: "booking", status: "booked", serviceType: "junk_removal",
                    name: contact.name, phone: contact.phone, email: contact.email, address: serviceAddress,
                    description, requestedDate: selectedDate ? calendarDate(selectedDate) : undefined,
                    value: isOnSiteEstimate ? undefined : (minPrice || undefined), notes: contact.notes || "",
                    smsOptIn: true,
                    consentText: SMS_CONSENT_TEXT,
                    metadata: {
                        serviceType: "junk_removal",
                        customerType: contact.customerType,
                        ...(contact.addressUnit ? { addressUnit: contact.addressUnit } : {}),
                        ...(addressVerified ? {} : { addressVerified: false }),
                        timeSlot: selectedTime || "",
                        truckLoad: loadSize.truckLoad, quoteRange: quoteRangeStr,
                        ...(!isOnSiteEstimate && tierData ? { quoteMin: minPrice, quoteMax: maxPrice } : {}),
                        loadTier: loadSize.loadTier,
                        junkLocation: locationOption?.label || "", stairsAccess: stairsAccessLabel,
                        specialConditions: edgeCaseIds,
                        isOnSiteEstimate,
                        edgeCaseNote: describeEdgeCaseNote({
                            multiTruckLoad,
                            unsureOfLoad: !!edgeCases["unknown"],
                            flaggedIds: edgeCaseIds,
                        }),
                        priceRange: isOnSiteEstimate ? null : (tierData ? [minPrice, maxPrice] : null),
                        surcharges: [
                            ...(accessAmount > 0 ? [{ id: "access", label: accessSurcharge?.label || "Access surcharge", amount: accessAmount, location: location || undefined }] : []),
                            ...(distanceSurcharge > 0 ? [{ id: "distance", label: "Distance surcharge", amount: distanceSurcharge }] : []),
                            ...(heavyAmount > 0 ? [{ id: "heavy_material", label: heavySurcharge?.label || "Heavy Material", amount: heavyAmount }] : []),
                            ...(applianceAmount > 0 ? [{ id: "appliance", label: applianceSurcharge?.label || "Appliance", amount: applianceAmount }] : []),
                        ],
                        termsAcceptedAt: new Date().toISOString(),
                        ...(paymentPreference ? { paymentPreference } : {}),
                    },
                    source: bookingSource,
                    ...(promoCode ? { promoCode } : {}),
                };
                return payload;
            };
            const buildDumpsterPayload = () => {
                const containerLabel = containerSizes.find(c => c.id === containerSize)?.label || containerSize || "";
                const debrisLabel = DEBRIS_TYPES.find(d => d.id === debrisType)?.label || debrisType || "";
                const durationLabel = RENTAL_DURATIONS.find(r => r.id === rentalDuration)?.label || rentalDuration || "";
                const description = `${containerLabel} dumpster, ${debrisLabel}, ${durationLabel}`;

                // Keep the exact configured tier amount. Intake gives the rental
                // tier precedence and applies any eligible promo itself.
                const dumpsterSizeNum = containerSize ? parseInt(containerSize) : 0;
                const dumpsterTier = config.dumpsterPricing?.tiers.find(t => t.sizeCuYd === dumpsterSizeNum);
                const containerValue = dumpsterTier
                    ? (dumpsterTier.baseRateMin ?? dumpsterTier.baseRate)
                    : 0;

                const payload: Record<string, unknown> = {
                    type: "rental_lead", status: "new",
                    serviceType: "dumpster_rental",
                    ...(containerValue > 0 ? { value: containerValue } : {}),
                    name: contact.name, phone: contact.phone, email: contact.email, address: serviceAddress,
                    description, requestedDate: selectedDate ? calendarDate(selectedDate) : undefined,
                    notes: contact.notes || "",
                    smsOptIn: true,
                    consentText: SMS_CONSENT_TEXT,
                    metadata: {
                        serviceType: "dumpster_rental",
                        customerType: contact.customerType,
                        ...(contact.addressUnit ? { addressUnit: contact.addressUnit } : {}),
                        ...(addressVerified ? {} : { addressVerified: false }),
                        containerSize: containerSize || "", debrisType: debrisType || "",
                        rentalDuration: rentalDuration || "",
                        timeSlot: selectedTime || "",
                        // The stock check failed, so this booking was allowed
                        // through without one. Flag it for the dashboard rather
                        // than refusing every rental whenever the check is down.
                        // metadata is free-form JSON — no dashboard change needed.
                        ...(availabilityState === "error" ? { availabilityCheckFailed: true } : {}),
                        termsAcceptedAt: new Date().toISOString(),
                        ...(paymentPreference ? { paymentPreference } : {}),
                    },
                    source: bookingSource,
                    ...(promoCode ? { promoCode } : {}),
                };
                return payload;
            };
            if (!hasAttempts(intent)) {
                const payloads: Partial<Record<ServiceLeg, Record<string, unknown>>> = {};
                if (serviceType === "junk" || serviceType === "both") payloads.junk = buildJunkPayload();
                if (serviceType === "dumpster" || serviceType === "both") payloads.dumpster = buildDumpsterPayload();
                const pmId = paymentPreference === "card" ? await confirmCard() : null;
                if (pmId) for (const payload of Object.values(payloads)) (payload.metadata as Record<string, unknown>).stripePaymentMethodId = pmId;
                freezeAttempts(intent, payloads, persistIntent);
                changedIntent();
            }
            await resumeIntent(intent, sendBooking, persistIntent, changedIntent);
            if (intent.leadId) rememberLead(intent.leadId);
            const outcomes = intentOutcomes(intent);
            // Card recovery uses the saved method and customer; no new SetupIntent on replay.
            if (intent.paymentMethodId) {
                intent.cardResults ||= {};
                for (const ack of Object.values(outcomes)) if (ack.customerId && resolvedOutcome(ack) && !intent.cardResults[ack.customerId]) {
                    await recordCardConfirmation(ack.customerId, intent.paymentMethodId);
                    intent.cardResults[ack.customerId] = card.outcome || "failed";
                }
                if (card.outcome && card.outcome !== "saved") intent.cardIssue = card.outcome;
                else if (!Object.values(outcomes).some(a => a.customerId)) intent.cardIssue = "not_saved_pending_approval";
            }
            const fullyResolved = Object.values(intent.attempts).every(a => resolvedOutcome(a.acknowledgement));
            if (!persistIntent()) throw new Error("Keep this tab open. Your response could not be saved; please call us before booking again.");
            changedIntent();
            if (!fullyResolved) return;
            const receipt = {
                name: contact.name, date: selectedDate ? calendarDate(selectedDate) : "", time: selectedTime || "",
                price: outcomes.junk ? acceptedPriceLabel(outcomes.junk) || "" : "",
                dumpsterPrice: outcomes.dumpster ? acceptedPriceLabel(outcomes.dumpster) || undefined : undefined,
                pricingUnconfirmed: !Object.values(outcomes).every(a => a.pricing.status === "accepted"),
                serviceType: Object.keys(intent.attempts).length === 2 ? "both" : Object.keys(intent.attempts)[0] || "junk", address: serviceAddress || undefined,
                outcomes, promoRequested: promoCode || undefined, cardIssue: intent.cardIssue as CardConfirmation | undefined,
                debrisType: debrisType ? DEBRIS_TYPES.find(d => d.id === debrisType)?.label || debrisType : undefined,
                rentalDuration: rentalDuration ? RENTAL_DURATIONS.find(r => r.id === rentalDuration)?.label || rentalDuration : undefined,
            };
            try { sessionStorage.setItem(`${storageKey}:receipt`, JSON.stringify(receipt)); } catch { throw new Error("Keep this tab open to retain your response. Please call us before booking again."); }
            onComplete?.(receipt);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        } finally {
            sendingRef.current = false;
            changedIntent();
            setSubmitting(false);
        }
    };

    const formatPhone = (val: string) => {
        const digits = val.replace(/\D/g, "").slice(0, 10);
        if (digits.length <= 3) return digits;
        if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    };

    const VALID_EMAIL_DOMAINS = [
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
        "icloud.com", "me.com", "mac.com", "live.com", "msn.com",
        "protonmail.com", "zoho.com", "yandex.com", "mail.com",
        "comcast.net", "att.net", "sbcglobal.net", "verizon.net",
        "cox.net", "charter.net", "earthlink.net",
    ];

    const TYPO_CORRECTIONS: Record<string, string> = {
        "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com",
        "gmil.com": "gmail.com", "gmail.co": "gmail.com", "gamil.com": "gmail.com",
        "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
        "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhaoo.com": "yahoo.com",
        "yahoo.co": "yahoo.com",
        "hotmal.com": "hotmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
        "hotmail.co": "hotmail.com",
        "outllok.com": "outlook.com", "outlok.com": "outlook.com", "outloo.com": "outlook.com",
        "outlook.co": "outlook.com",
        "iclould.com": "icloud.com", "icloud.co": "icloud.com",
    };

    const validateEmail = (email: string): { valid: boolean; error: string; suggestion?: string } => {
        if (!email) return { valid: false, error: "" };
        const trimmed = email.trim().toLowerCase();

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!emailRegex.test(trimmed)) return { valid: false, error: "Please enter a valid email address." };

        const domain = trimmed.split("@")[1];

        if (TYPO_CORRECTIONS[domain]) {
            return { valid: false, error: `Did you mean ${trimmed.split("@")[0]}@${TYPO_CORRECTIONS[domain]}?`, suggestion: `${trimmed.split("@")[0]}@${TYPO_CORRECTIONS[domain]}` };
        }

        const tldParts = domain.split(".");
        const tld = tldParts[tldParts.length - 1];
        if (tld.length < 2 || /^\d+$/.test(tld)) return { valid: false, error: "That email domain doesn't look right. Please double-check." };

        const fakeDomains = ["test.com", "fake.com", "asdf.com", "example.com", "none.com", "na.com", "noemail.com", "email.com"];
        if (fakeDomains.includes(domain)) return { valid: false, error: "Please enter your real email address." };

        return { valid: true, error: "" };
    };

    const emailValidation = validateEmail(contact.email);
    // Shared with the website wizard — see ../lib/bookingLogic.ts.
    const phoneValidation = validatePhone(contact.phone);

    /* ── Render ──────────────────────────────────────────────────────────── */
    if (!hydrated) return <div style={{ minHeight: "50vh" }} aria-label="Loading booking" />;
    if (hasAttempts(intent) || intent.blocked) return <div style={{ maxWidth: 640, margin: "32px auto", padding: 20 }}>
        <h1 style={{ fontSize: 28, marginBottom: 16 }}>Your booking status</h1>
        <p style={{ marginBottom: 16 }}>{intent.blocked ? "Your saved booking could not be read safely. Please call us to check it before starting another booking." : "Your original submission is saved. Contact us to change its details. Checking status uses the same request."}</p>
        <BookingReceipt outcomes={intentOutcomes(intent)} services={Object.keys(intent.attempts) as ServiceLeg[]} requestedDate={selectedDate ? calendarDate(selectedDate) : ""} requestedTime={selectedTime || ""} phone={config.phoneNumber} cardIssue={intent.cardIssue} />
        {error && <p role="alert" style={{ marginTop: 16 }}>{error}</p>}
        {canResume(intent) && <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary" style={{ minHeight: 44, marginTop: 16 }}>{submitting ? "Checking request…" : "Check saved booking status"}</button>}
        {!canResume(intent) && !intent.blocked && <button type="button" onClick={handleSubmit} disabled={submitting} style={{ minHeight: 44, marginTop: 16 }}>View saved receipt</button>}
        <details style={{ marginTop: 24 }}><summary>Start a separate booking</summary><p>This creates an additional booking. It does not change or cancel your saved request.</p><button type="button" onClick={freshBooking} disabled={submitting} style={{ minHeight: 44 }}>Start new booking</button></details>
    </div>;

    return (
        <div style={{ minHeight: "100vh", background: "var(--background)" }}>
            {/* Progress bar */}
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 0", display: "flex", gap: 6 }}>
                {phases.map((_p: WizardPhase, i: number) => (
                    <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? "var(--brand)" : "#E2E8F0", transition: "background 0.3s" }} />
                ))}
            </div>
            {/* Promo banner */}
            {promoApplies && (
                <div style={{ maxWidth: 720, margin: "8px auto 0", padding: "10px 20px", background: "linear-gradient(135deg, #059669, #10B981)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>🎉 {promoResult.discountValue}{promoResult.discountType === "percentage" ? "%" : "$"} off applied!</span>
                    <button onClick={() => { setPromoCode(null); setPromoResult(null); setPromoInputValue(""); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
                </div>
            )}
            {promoResult && promoCode && !promoApplies && (
                <div style={{ maxWidth: 720, margin: "8px auto 0", padding: "10px 20px", background: "#FEF2F2", borderRadius: 10, border: "1px solid #FECACA" }}>
                    <span style={{ color: "#991B1B", fontSize: 13, fontWeight: 600 }}>{promoResult.valid ? <>Code &ldquo;{promoCode}&rdquo; doesn&rsquo;t apply to this service.</> : <>Code &ldquo;{promoCode}&rdquo; is not valid{promoResult.reason === "expired" ? " (expired)" : promoResult.reason === "max_uses_reached" ? " (fully redeemed)" : ""}.</>}</span>
                </div>
            )}
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 20px 0", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Step {step + 1} of {phases.length}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {getPhaseLabel(currentPhase)}
                </span>
            </div>

            {/* Content */}
            <div key={step} className="fade-up" style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px 140px" }}>

                {/* ── CONTACT: Contact Info (Lead Capture) ────────────────────────── */}
                {currentPhase === "contact" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Hand size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Let&apos;s get started!</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Tell us a bit about yourself so we can prepare your custom quote.</p>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <div>
                                <label className="label" htmlFor={`${fieldId}-name`}>Full Name *</label>
                                <input className="input" placeholder="John Smith" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
                                <div>
                                    <label className="label" htmlFor={`${fieldId}-phone`}>Phone *</label>
                                    <input id={`${fieldId}-phone`} type="tel" required autoComplete="tel-national" aria-invalid={!!contact.phone && !phoneValidation.valid} aria-describedby={phoneValidation.error ? `${fieldId}-phone-error` : undefined} className="input" placeholder="(555) 123-4567" value={contact.phone}
                                        style={contact.phone && !phoneValidation.valid && phoneValidation.error ? { borderColor: "#DC2626" } : undefined}
                                        onChange={e => setContact(c => ({ ...c, phone: formatPhone(e.target.value) }))} />
                                    {contact.phone && !phoneValidation.valid && phoneValidation.error && (
                                        <p id={`${fieldId}-phone-error`} style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>{phoneValidation.error}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="label" htmlFor={`${fieldId}-email`}>Email *</label>
                                    <input id={`${fieldId}-email`} required autoComplete="email" aria-invalid={!!contact.email && !emailValidation.valid} aria-describedby={emailValidation.error ? `${fieldId}-email-error` : undefined} className="input" type="email" placeholder="john@gmail.com" value={contact.email}
                                        style={contact.email && !emailValidation.valid && emailValidation.error ? { borderColor: "#DC2626" } : undefined}
                                        onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
                                    {contact.email && !emailValidation.valid && emailValidation.error && (
                                        <p id={`${fieldId}-email-error`} style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>
                                            {emailValidation.suggestion ? (
                                                <>
                                                    {emailValidation.error.split(emailValidation.suggestion)[0]}
                                                    <button
                                                        onClick={() => setContact(c => ({ ...c, email: emailValidation.suggestion! }))}
                                                        style={{ background: "none", border: "none", color: "var(--brand)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 12, fontFamily: "inherit", textDecoration: "underline" }}
                                                    >
                                                        {emailValidation.suggestion}
                                                    </button>?
                                                </>
                                            ) : emailValidation.error}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="label" htmlFor={`${fieldId}-address`}>Service Address *</label>
                                <AddressAutocomplete
                                    id={`${fieldId}-address`}
                                    googleMapsKey={config.googleMapsKey}
                                    serviceAreaZips={config.serviceAreaZips}
                                    phoneNumber={config.phoneNumber}
                                    value={contact.address}
                                    onChange={(val) => {
                                        setContact(c => ({ ...c, address: val }));
                                        setAddressConfirmed(false);
                                        setAddressInArea(true);
                                        setOutOfAreaMsg(null);
                                    }}
                                    onPlaceSelect={(place) => {
                                        setContact(c => ({ ...c, address: place.address }));
                                        setAddressConfirmed(true);
                                        setAddressVerified(place.verified);
                                        // Typed manually — no ZIP and no coordinates, so neither
                                        // area check below can run. The booking is accepted and
                                        // metadata.addressVerified tells the operator to confirm
                                        // the address themselves. Stated explicitly rather than
                                        // letting both checks silently pass.
                                        if (!place.verified) {
                                            setDistanceMiles(null);
                                            setDistanceSurcharge(0);
                                            setAddressInArea(true);
                                            setOutOfAreaMsg(null);
                                            return;
                                        }
                                        // ZIP-based area check (existing)
                                        const zips = config.serviceAreaZips;
                                        let zipOk = true;
                                        if (zips.length > 0 && place.zip) {
                                            zipOk = zips.includes(place.zip);
                                        }
                                        // Distance-based area check + surcharge (new)
                                        let radiusOk = true;
                                        let newDistanceSurcharge = 0;
                                        if (config.serviceAreaCenter && place.lat && place.lng) {
                                            const dist = haversineDistance(place.lat, place.lng, config.serviceAreaCenter.lat, config.serviceAreaCenter.lng);
                                            setDistanceMiles(Math.round(dist * 10) / 10);
                                            if (config.serviceAreaRadiusMiles && dist > config.serviceAreaRadiusMiles) {
                                                radiusOk = false;
                                            } else {
                                                // Find matching distance tier
                                                const dTiers = pricing.distanceTiers || [];
                                                const sorted = [...dTiers].sort((a, b) => a.maxMiles - b.maxMiles);
                                                const matchedTier = sorted.find(t => dist <= t.maxMiles);
                                                newDistanceSurcharge = matchedTier ? matchedTier.additionalCost : (sorted.length > 0 ? sorted[sorted.length - 1].additionalCost : 0);
                                            }
                                        } else {
                                            setDistanceMiles(null);
                                        }
                                        setDistanceSurcharge(newDistanceSurcharge);
                                        if (!zipOk || !radiusOk) {
                                            setAddressInArea(false);
                                            setOutOfAreaMsg("We do not service your area. Sorry for the inconvenience.");
                                        } else {
                                            setAddressInArea(true);
                                            setOutOfAreaMsg(null);
                                        }
                                    }}
                                />
                                {outOfAreaMsg && (
                                    <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 13, color: "#DC2626", display: "flex", alignItems: "flex-start", gap: 8 }}>
                                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <span>{outOfAreaMsg}</span>
                                    </div>
                                )}
                                {!addressConfirmed && contact.address.length > 5 && !outOfAreaMsg && (
                                    <p style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                                        Please select an address from the dropdown.
                                    </p>
                                )}
                            </div>
                            {/* Unit is deliberately its own field and deliberately does NOT
                                touch addressConfirmed — Google's formattedAddress overwrites
                                the typed address and never carries a unit number, so an
                                apartment resident otherwise had to choose between confirming
                                their address and keeping their unit. */}
                            <div>
                                <label className="label" htmlFor="syj-address-unit">
                                    Apt / Suite / Unit (optional)
                                </label>
                                <input
                                    id="syj-address-unit"
                                    className="input"
                                    placeholder="e.g. Apt 4B"
                                    value={contact.addressUnit}
                                    onChange={(e) => setContact(c => ({ ...c, addressUnit: e.target.value }))}
                                    autoComplete="address-line2"
                                    maxLength={40}
                                />
                            </div>
                            <div>
                                <label className="label">Property Type</label>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                    {(["residential", "commercial"] as const).map(type => (
                                        <button key={type} onClick={() => setContact(c => ({ ...c, customerType: type }))}
                                            style={{
                                                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                                                padding: "14px 16px", borderRadius: 12, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
                                                border: `2px solid ${contact.customerType === type ? "var(--brand)" : "var(--border, #E2E8F0)"}`,
                                                background: contact.customerType === type ? "#FFF7ED" : "var(--card)",
                                                color: contact.customerType === type ? "var(--brand)" : "var(--foreground)",
                                                fontWeight: 600, fontSize: 14,
                                            }}>
                                            {type === "residential" ? <Home size={18} /> : <Building2 size={18} />}
                                            {type === "residential" ? "Residential" : "Commercial"}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="label" htmlFor={`${fieldId}-notes`}>Notes (optional)</label>
                                <textarea id={`${fieldId}-notes`} className="input" rows={3} placeholder="Gate code, special instructions, etc." value={contact.notes} onChange={e => setContact(c => ({ ...c, notes: e.target.value }))} style={{ resize: "vertical" }} />
                            </div>
                        </div>

                        {/* SMS + Email Disclosure */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 18px", borderRadius: 12, border: "1px solid var(--border, #E2E8F0)", background: "var(--card)", marginTop: 20 }}>
                            <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                                {SMS_CONSENT_TEXT}
                            </span>
                        </div>

                        {error && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 14, color: "#DC2626" }}>
                                {error}
                            </div>
                        )}

                        <button onClick={captureLead} disabled={!canProceed() || submitting}
                            style={{
                                width: "100%", marginTop: 24, padding: 18, borderRadius: "var(--btn-radius)", border: "none",
                                background: canProceed() && !submitting ? "linear-gradient(135deg, var(--brand), var(--brand-dark))" : "#E2E8F0",
                                color: canProceed() && !submitting ? "#fff" : "#94A3B8",
                                fontSize: 17, fontWeight: 700, cursor: canProceed() && !submitting ? "pointer" : "not-allowed",
                                fontFamily: "var(--heading-font)", boxShadow: canProceed() && !submitting ? "0 8px 24px rgba(249,115,22,0.3)" : "none",
                                transition: "all 0.2s",
                            }}>
                            {submitting ? "Saving..." : "Get My Free Quote →"}
                        </button>
                        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
                            No obligation — we&apos;ll prepare a custom quote based on your items.
                        </p>
                    </div>
                )}

                {/* ── SERVICE TYPE: Junk / Dumpster / Both ──────────────────── */}
                {currentPhase === "service_type" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Wrench size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>What services do you need?</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Select one or both options below.</p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 480, margin: "0 auto" }}>
                            {([{ id: "junk" as ServiceType, label: "Junk Removal", desc: "We send a crew to haul it all away", iconEl: <Truck size={36} color="var(--brand)" /> }, { id: "dumpster" as ServiceType, label: "Dumpster Rental", desc: "Container delivered to your location", iconEl: <Box size={36} color="var(--brand)" /> }]).map(opt => {
                                const sel = serviceType === opt.id || serviceType === "both";
                                return (
                                    <button type="button" aria-pressed={sel} className="booking-choice" key={opt.id} onClick={() => setServiceType(prev => {
                                        if (prev === "both" && opt.id === "junk") return "dumpster";
                                        if (prev === "both" && opt.id === "dumpster") return "junk";
                                        if (prev === opt.id) return null;
                                        if (prev && prev !== opt.id) return "both";
                                        return opt.id;
                                    })} style={{ background: sel ? "#FFF7ED" : "var(--card)", border: `2px solid ${sel ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 16, padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.2s", position: "relative" }}>
                                        {sel && <div style={{ position: "absolute", top: 12, right: 12, width: 24, height: 24, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={14} /></div>}
                                        <div style={{ marginBottom: 12 }}>{opt.iconEl}</div>
                                        <div style={{ fontWeight: 700, fontSize: 16, color: "var(--foreground)", marginBottom: 6 }}>{opt.label}</div>
                                        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{opt.desc}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {serviceType === "both" && (<div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#F0FDF4", border: "1px solid #BBF7D0", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#16A34A" }}><Check size={14} style={{ display: "inline", verticalAlign: "middle" }} /> Both services selected!</div>)}
                    </div>
                )}

                {/* ── LOAD ESTIMATE (V2) ─────────────────────────────────────── */}
                {currentPhase === "load_estimate" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 12 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(var(--brand-rgb, 249,115,22),0.1)", border: "1px solid rgba(var(--brand-rgb, 249,115,22),0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Truck size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontFamily: "var(--heading-font)", fontSize: 24, fontWeight: 700, color: "var(--foreground)", margin: "0 0 4px", letterSpacing: -0.3 }}>
                                How much junk are we hauling?
                            </h1>
                            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>Pick the closest real-world load size before we price the visit.</p>
                        </div>

                        <div style={{ margin: "0 12px" }}>
                            <VolumeEstimator
                                levels={LOAD_TIERS}
                                value={tierIndex}
                                onChange={setTierIndex}
                                brandColor={config.brandColor}
                            />
                        </div>

                        {/* Tier Title + Description (price moved to bottom of phase) */}
                        <div style={{ margin: "20px 12px 0", padding: "20px 24px", background: "var(--card, #fff)", borderRadius: "var(--card-radius, 16px)", border: "1px solid var(--border, #e2e8f0)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                                <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 10, background: "rgba(var(--brand-rgb, 249,115,22),0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Truck size={20} color="var(--brand)" />
                                </div>
                                <div style={{ fontFamily: "var(--heading-font)", fontSize: 22, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.2 }}>
                                    {LOAD_TIERS[tierIndex].title}
                                    {LOAD_TIERS[tierIndex].popular && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--brand)", background: "rgba(var(--brand-rgb, 249,115,22),0.06)", padding: "2px 8px", borderRadius: 999, marginLeft: 8, verticalAlign: "middle", letterSpacing: 0.3, textTransform: "uppercase" }}>
                                            Standard option
                                        </span>
                                    )}
                                </div>
                            </div>
                            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.55, paddingLeft: 52 }}>{LOAD_TIERS[tierIndex].desc}</p>
                        </div>

                        {/* Guarantee badge */}
                        <div style={{
                            margin: "12px 12px 0", padding: "12px 16px",
                            background: "#f0fdf4", borderRadius: 12, border: "1px solid #bbf7d0",
                            display: "flex", alignItems: "center", gap: 10,
                        }}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
                                <path d="M10 1L12.5 4L16.5 3.5L15.5 7.5L18.5 10L15.5 12.5L16.5 16.5L12.5 16L10 19L7.5 16L3.5 16.5L4.5 12.5L1.5 10L4.5 7.5L3.5 3.5L7.5 4L10 1Z"
                                    fill="#22c55e" opacity="0.15" stroke="#16a34a" strokeWidth="1.2" />
                                <path d="M7 10.5L9 12.5L13 8" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span style={{ fontSize: 12.5, color: "#15803d", lineHeight: 1.4 }}>
                                <strong>You only pay for what we haul!</strong> This is just an estimate we provide you and final price is finalized on-site.
                            </span>
                        </div>

                        {/* Access dropdown — hidden when "scattered everywhere" is checked */}
                        {!edgeCases.unknown && (
                            <div style={{ margin: "12px 12px 0", padding: "18px 20px", background: "var(--card, #fff)", borderRadius: "var(--card-radius, 16px)", border: "1px solid var(--border, #e2e8f0)", boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                                <label htmlFor="syj-access-select" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>
                                    Where is the junk located?
                                </label>
                                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                                    Helps us plan access and price it accurately.
                                </p>
                                <select
                                    id="syj-access-select"
                                    className="syj-input"
                                    value={location || ""}
                                    onChange={(e) => setLocation(e.target.value || null)}
                                    style={{ width: "100%", cursor: "pointer" }}
                                >
                                    <option value="">Select access location...</option>
                                    {LOCATION_OPTIONS.map(loc => {
                                        const surchargeForLoc = accessSurcharge?.enabled
                                            ? (accessSurcharge.amountsByLocation?.[loc.id] ?? 0)
                                            : 0;
                                        return (
                                            <option key={loc.id} value={loc.id}>
                                                {loc.label}{surchargeForLoc > 0 ? ` (+$${surchargeForLoc})` : ""}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        )}

                        {/* Edge Cases */}
                        <div style={{ margin: "12px 12px 0", padding: "18px 20px", background: "var(--card, #fff)", borderRadius: "var(--card-radius, 16px)", border: "1px solid var(--border, #e2e8f0)", boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Does your load include any of the following?</div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>These may require a custom quote.</div>
                            {EDGE_CASES.map((item, i) => (
                                <div key={item.id}>
                                    {i > 0 && <div style={{ height: 1, background: "var(--border, #f1f5f9)" }} />}
                                    <EdgeToggle item={item} checked={!!edgeCases[item.id]} onChange={() => toggleEdge(item.id)} />
                                </div>
                            ))}
                            {edgeCases.heavy && heavySurcharge?.enabled && (
                                <div style={{ marginTop: 12, padding: "12px 18px", borderRadius: 12, background: "#FFFBEB", border: "1px solid #FEF3C7", fontSize: 13, color: "#92400E", display: "flex", alignItems: "center", gap: 8 }}>
                                    <AlertTriangle size={16} style={{ display: "inline", verticalAlign: "middle", flexShrink: 0 }} /> Heavy or dense items add <strong style={{ margin: "0 2px" }}>${heavyAmount}</strong> to this estimate based on your selected load size.
                                </div>
                            )}
                            {edgeCases.specialty && applianceSurcharge?.enabled && (
                                <div style={{ marginTop: 12, padding: "12px 18px", borderRadius: 12, background: "#FFFBEB", border: "1px solid #FEF3C7", fontSize: 13, color: "#92400E", display: "flex", alignItems: "center", gap: 8 }}>
                                    <AlertTriangle size={16} style={{ display: "inline", verticalAlign: "middle", flexShrink: 0 }} /> Appliances and e-waste add <strong style={{ margin: "0 2px" }}>${applianceAmount}</strong> to this estimate due to special handling.
                                </div>
                            )}
                            {isOnSiteEstimate && (
                                <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFFBEB", borderRadius: 10, border: "1px solid #FDE68A", display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
                                    <span style={{ fontSize: 16, lineHeight: "20px", flexShrink: 0 }}>⚠️</span>
                                    <span><strong>No worries.</strong> We&apos;ll send a crew to give you a free, no-obligation estimate on-site before any work begins.</span>
                                </div>
                            )}
                        </div>

                        {/* Estimated Price — moved to the bottom so the customer fills in access + edge cases first */}
                        <div style={{ margin: "12px 12px 0", padding: "20px 24px", background: "var(--card, #fff)", borderRadius: "var(--card-radius, 16px)", border: "1px solid var(--border, #e2e8f0)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                            {!tierData && !isOnSiteEstimate ? <p>Quote confirmed on site. No online price is available for this load.</p> : isOnSiteEstimate ? (
                                <div style={{ padding: "14px 20px", background: "rgba(var(--foreground-rgb, 0,0,0),0.03)", borderRadius: 12, textAlign: "center" }}>
                                    <span style={{ fontFamily: "var(--heading-font)", fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>Free On-Site Estimate</span>
                                </div>
                            ) : (
                                <>
                                    <div style={{ padding: "14px 20px", background: "linear-gradient(135deg, rgba(var(--brand-rgb, 249,115,22),0.06) 0%, rgba(var(--brand-rgb, 249,115,22),0.02) 100%)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>Estimated Range</span>
                                        {tierData && (
                                            <span style={{ fontFamily: "var(--heading-font)", fontSize: 26, fontWeight: 800, color: "var(--foreground)", letterSpacing: -0.5 }}>
                                                ${displayJunkTotal(roundTo5(tierData.min + totalAdj))} – ${displayJunkTotal(roundTo5(tierData.max + totalAdj))}
                                            </span>
                                        )}
                                        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>Finalized on-site</span>
                                    </div>
                                    {totalAdj > 0 && (
                                        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>
                                            {[
                                                accessAmount > 0 && location ? `+$${accessAmount} ${LOCATION_OPTIONS.find(l => l.id === location)?.label.toLowerCase() || "access"}` : null,
                                                distanceSurcharge > 0 ? `+$${distanceSurcharge} distance` : null,
                                                heavyAmount > 0 ? `+$${heavyAmount} heavy material` : null,
                                                applianceAmount > 0 ? `+$${applianceAmount} appliance` : null,
                                            ].filter(Boolean).join(" · ")}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ── DUMPSTER SIZE ────────────────────────────────────────────── */}
                {currentPhase === "dumpster_size" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Box size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>What size container?</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Choose the dumpster size that best fits your project.</p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                            {containerSizes.length === 0 && <p role="status">Container sizes are being updated. Please contact us to arrange a rental.</p>}
                            {containerSizes.map(cs => {
                                const sizeNum = parseInt(cs.id);
                                const tier = config.dumpsterPricing?.tiers.find(t => t.sizeCuYd === sizeNum);
                                const hasPrice = tier && (tier.baseRate > 0 || (tier.baseRateMin != null && tier.baseRateMin > 0));
                                // Use live availability data if this is the selected size
                                const isSelected = containerSize === cs.id;
                                const liveAvail = isSelected ? containerAvailability : null;
                                const liveRate = liveAvail?.available && liveAvail.baseRate ? liveAvail.baseRate : null;
                                const liveDays = liveAvail?.available && liveAvail.includedDays ? liveAvail.includedDays : null;
                                return (
                                <button type="button" aria-pressed={isSelected} className="booking-choice" key={cs.id} onClick={() => setContainerSize(cs.id)} style={{ background: isSelected ? "#FFF7ED" : "var(--card)", border: `2px solid ${isSelected ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 16, padding: "20px 18px", cursor: "pointer", transition: "all 0.2s", position: "relative", display: "flex", flexDirection: "column" }}>
                                    {isSelected && <div style={{ position: "absolute", top: 10, right: 10, width: 22, height: 22, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={14} /></div>}
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <ServiceIcon name={cs.icon} size={24} color="var(--brand)" />
                                        <div style={{ fontWeight: 800, fontSize: 26, color: "var(--brand)" }}>{cs.yards}</div>
                                    </div>
                                    {/* Live price from availability API or static fallback */}
                                    {liveRate ? (
                                        <div style={{ fontWeight: 900, fontSize: 18, color: "var(--foreground)", marginBottom: 4 }}>From ${formatPriceAmount(liveRate)}</div>
                                    ) : hasPrice ? (
                                        <div style={{ fontWeight: 900, fontSize: 18, color: "var(--foreground)", marginBottom: 4 }}>{formatDumpsterPrice(tier)}</div>
                                    ) : null}
                                    {liveDays ? (
                                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{liveDays}-day rental included</div>
                                    ) : hasPrice ? (
                                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{tier.includedDays}-day rental · {tier.weightAllowanceTons}T included</div>
                                    ) : null}
                                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{cs.desc}</div>
                                    <div style={{ fontSize: 12, color: "var(--foreground)", background: "var(--background)", padding: "6px 10px", borderRadius: 8, lineHeight: 1.4, marginTop: "auto" }}><strong>Good for:</strong> {cs.goodFor}</div>
                                </button>
                                );
                            })}
                        </div>
                        {/* Availability indicator */}
                        {containerSize && availabilityState !== "idle" && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, textAlign: "center", fontSize: 14, fontWeight: 600, ...(availabilityState === "checking" ? { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" } : availabilityState === "available" ? { background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#16A34A" } : availabilityState === "unavailable" ? { background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" } : { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" }) }}>
                                {availabilityState === "checking" ? "Checking availability..." : availabilityState === "available" ? "✓ In stock" : availabilityState === "unavailable" && containerAvailability ? (<>{containerAvailability.nextAvailableDate ? `Next available: ${restoreCalendarDate(containerAvailability.nextAvailableDate)?.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : "Currently unavailable"}{containerAvailability.alternativeSizes && containerAvailability.alternativeSizes.length > 0 && (<span style={{ display: "block", fontSize: 12, fontWeight: 500, marginTop: 4 }}>Other sizes in stock: {containerAvailability.alternativeSizes.map(s => `${s}yd³`).join(", ")}</span>)}</>) : "Couldn\u2019t check stock just now \u2014 you can still continue."}
                            </div>
                        )}
                    </div>
                )}

                {/* ── DUMPSTER DETAILS ────────────────────────────────────────── */}
                {currentPhase === "dumpster_details" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><FileText size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Rental Details</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Tell us about your project so we can prepare.</p>
                        </div>
                        <div style={{ marginBottom: 28 }}>
                            <h3 style={{ fontFamily: "var(--heading-font)", fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.02em" }}>What type of debris?</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                                {DEBRIS_TYPES.map(dt => (
                                    <button type="button" aria-pressed={debrisType === dt.id} className="booking-choice" key={dt.id} onClick={() => setDebrisType(dt.id)} style={{ background: debrisType === dt.id ? "#FFF7ED" : "var(--card)", border: `2px solid ${debrisType === dt.id ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 10 }}>
                                        <ServiceIcon name={dt.icon} size={20} color="var(--brand)" />
                                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--foreground)" }}>{dt.label}</span>
                                        {debrisType === dt.id && <Check size={16} color="var(--brand)" style={{ marginLeft: "auto" }} />}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h3 style={{ fontFamily: "var(--heading-font)", fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.02em" }}>How long do you need it?</h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {RENTAL_DURATIONS.map(rd => (
                                    <button type="button" aria-pressed={rentalDuration === rd.id} className="booking-choice" key={rd.id} onClick={() => setRentalDuration(rd.id)} style={{ background: rentalDuration === rd.id ? "#FFF7ED" : "var(--card)", border: `2px solid ${rentalDuration === rd.id ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 12, padding: "16px 18px", cursor: "pointer", transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--foreground)", marginBottom: 2 }}>{rd.label}</div>
                                            <div style={{ fontSize: 12, color: "var(--muted)" }}>{rd.desc}</div>
                                        </div>
                                        {rentalDuration === rd.id && <Check size={18} color="var(--brand)" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── SCHEDULE ────────────────────────────────────────────────── */}
                {currentPhase === "schedule" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><CalendarDays size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Pick a date &amp; time</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>You can reschedule after booking if needed.</p>
                        </div>
                        <div style={{ background: "var(--card)", borderRadius: 16, padding: 24, border: "1px solid var(--border, #E2E8F0)", marginBottom: 24 }}>
                            {error && <p role="alert" style={{ marginBottom: 12 }}>{error}</p>}
                            {slotsError && <p role="status" style={{ marginBottom: 12 }}>Live times could not be checked. These are standard request windows; availability still needs confirmation.</p>}
                            <Calendar selected={selectedDate} onSelect={(d) => { setSelectedDate(d); setSelectedTime(null); }} isDisabled={(d) => isDayClosed(d, config.businessHours)} />
                        </div>
                        {selectedDate && (() => {
                            if (loadingSlots || slotsDate !== calendarDate(selectedDate)) return (
                                <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 14 }}>Checking available times...</div>
                            );
                            const renderSlots = offeredSlots;
                            if (renderSlots.length === 0) return (
                                <div style={{ textAlign: "center", padding: 24, background: "#FEF2F2", borderRadius: 12, border: "1px solid #FECACA" }}>
                                    <AlertTriangle size={20} color="#DC2626" style={{ marginBottom: 8 }} />
                                    <div style={{ fontSize: 14, color: "#DC2626", fontWeight: 600 }}>{dynamicSlots ? "No availability on this day" : "We\u0027re closed on this day"}</div>
                                    <div style={{ fontSize: 13, color: "#DC2626", marginTop: 4 }}>Please select a different date.</div>
                                </div>
                            );
                            const allFull = renderSlots.every(s => !s.available);
                            return (
                                <div>
                                    <div style={{ fontFamily: "var(--heading-font)", fontSize: 16, fontWeight: 700, color: "var(--foreground)", marginBottom: 12, textAlign: "center" }}>
                                        Available times for {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                                    </div>
                                    {allFull && (
                                        <div style={{ textAlign: "center", padding: 16, marginBottom: 12, background: "#FEF2F2", borderRadius: 12, border: "1px solid #FECACA" }}>
                                            <div style={{ fontSize: 14, color: "#DC2626", fontWeight: 600 }}>All time slots are fully booked</div>
                                            <div style={{ fontSize: 13, color: "#DC2626", marginTop: 4 }}>Please try a different date.</div>
                                        </div>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                                        {renderSlots.map(slot => {
                                            const slotKey = `${slot.start}-${slot.end}`;
                                            const isSelected = selectedTime === slotKey;
                                            const isFull = !slot.available;
                                            return (
                                                <button key={slotKey} onClick={() => !isFull && setSelectedTime(slotKey)}
                                                    disabled={isFull}
                                                    style={{
                                                        border: `2px solid ${isSelected ? "var(--brand)" : isFull ? "#E2E8F0" : "var(--border, #E2E8F0)"}`,
                                                        background: isSelected ? "#FFF7ED" : isFull ? "#F8FAFC" : "var(--card)",
                                                        borderRadius: 12, padding: 16, textAlign: "center",
                                                        cursor: isFull ? "not-allowed" : "pointer",
                                                        transition: "all 0.15s", fontFamily: "inherit",
                                                        opacity: isFull ? 0.5 : 1,
                                                    }}>
                                                    <div style={{ fontWeight: 600, fontSize: 14, color: isSelected ? "var(--brand)" : isFull ? "var(--muted)" : "var(--foreground)" }}>
                                                        {formatSlotTime(slot.start)} – {formatSlotTime(slot.end)}
                                                    </div>
                                                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                                                        {isFull ? "Fully booked" : slot.label}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                        {/* Date-specific availability indicator for dumpster rentals */}
                        {selectedDate && (serviceType === "dumpster" || serviceType === "both") && containerSize && availabilityState !== "idle" && (
                            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 12, textAlign: "center", fontSize: 14, fontWeight: 600, ...(availabilityState === "checking" ? { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" } : availabilityState === "available" ? { background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#16A34A" } : availabilityState === "unavailable" ? { background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" } : { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" }) }}>
                                {availabilityState === "checking" ? "Checking availability for your date..." : availabilityState === "available" ? `✓ ${containerSizes.find(c => c.id === containerSize)?.label || "Container"} available for ${selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : availabilityState === "unavailable" && containerAvailability ? (<><AlertTriangle size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />{containerAvailability.nextAvailableDate ? (<>No {containerSizes.find(c => c.id === containerSize)?.label || "containers"} available for this date.<span style={{ display: "block", fontSize: 13, fontWeight: 500, marginTop: 6 }}>Next available: <button onClick={() => { setSelectedDate(restoreCalendarDate(containerAvailability.nextAvailableDate!)); setSelectedTime(null); }} style={{ background: "none", border: "none", color: "var(--brand)", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: 13, padding: 0 }}>{restoreCalendarDate(containerAvailability.nextAvailableDate!)?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</button></span></>) : `No ${containerSizes.find(c => c.id === containerSize)?.label || "containers"} available for this date.`}{containerAvailability.alternativeSizes && containerAvailability.alternativeSizes.some(s => containerSizes.some(c => parseInt(c.id) === s)) && (<span style={{ display: "block", fontSize: 12, fontWeight: 500, marginTop: 4, color: "var(--muted)" }}>Or try a different size: {containerAvailability.alternativeSizes.filter(s => containerSizes.some(c => parseInt(c.id) === s)).map(s => <button key={s} onClick={() => { setContainerSize(`${s}yd`); setStep(phases.indexOf("dumpster_size")); }} style={{ background: "none", border: "none", color: "var(--brand)", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: 12, padding: 0 }}>{s}yd³</button>).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ", ", el], [])}</span>)}</>) : "We couldn\u2019t check availability for this date. You can still book \u2014 we\u2019ll confirm your container and follow up."}
                            </div>
                        )}
                    </div>
                )}

{/* ── QUOTE: Summary & Book ─────────────────────────────── */}
                {currentPhase === "quote" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, var(--brand), var(--brand-dark))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                                <Check size={24} color="#fff" />
                            </div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>
                                {serviceType === "dumpster" ? "Your Dumpster Rental Request" : serviceType === "both" ? "Your Service Summary" : "Your Junk Removal Estimate"}
                            </h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>
                                {serviceType === "dumpster" ? "We'll call to confirm availability." : "Review your details below. Final price confirmed on-site."}
                            </p>
                        </div>
                        <div style={{ background: "var(--card)", borderRadius: 20, border: "1px solid var(--border, #E2E8F0)", overflow: "hidden", marginBottom: 24, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                            {/* Price banner — only show for junk removal */}
                            {(serviceType === "junk" || serviceType === "both") && (
                                <div style={{ background: "var(--hero-bg)", padding: "32px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
                                    <div style={{ fontSize: 12, color: "var(--hero-muted, #94A3B8)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, position: "relative", zIndex: 1 }}>
                                        {serviceType === "both" ? "Junk Removal Estimate" : "Estimated Price Range"}
                                    </div>
                                    {isOnSiteEstimate ? (
                                        <div style={{ fontSize: 28, fontWeight: 800, color: "var(--hero-text)", position: "relative", zIndex: 1 }}>On-Site Estimate</div>
                                    ) : promoDiscountsJunk && tierData ? (
                                        <>
                                            <div style={{ fontSize: 18, color: "var(--hero-muted, #94A3B8)", textDecoration: "line-through", position: "relative", zIndex: 1 }}>
                                                ${displayJunkTotal(roundTo5(tierData.min + totalAdj))} – ${displayJunkTotal(roundTo5(tierData.max + totalAdj))}
                                            </div>
                                            <div style={{ fontFamily: "var(--heading-font)", fontSize: 44, fontWeight: 800, color: "#10B981", letterSpacing: "-0.03em", position: "relative", zIndex: 1 }}>
                                                ${discountedPriceText(displayJunkTotal(roundTo5(tierData.min + totalAdj)))} – ${discountedPriceText(displayJunkTotal(roundTo5(tierData.max + totalAdj)))}
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ fontFamily: "var(--heading-font)", fontSize: tierData ? 44 : 28, fontWeight: 800, color: "var(--hero-text)", letterSpacing: "-0.03em", position: "relative", zIndex: 1 }}>
                                            {tierData
                                                ? `$${displayJunkTotal(roundTo5(tierData.min + totalAdj))} – $${displayJunkTotal(roundTo5(tierData.max + totalAdj))}`
                                                : "Quote confirmed on site"}
                                        </div>
                                    )}
                                    {totalAdj > 0 && <div style={{ fontSize: 12, color: "#FBBF24", marginTop: 6, position: "relative", zIndex: 1 }}>
                                        {[
                                            accessAmount > 0 && location ? `+$${accessAmount} ${LOCATION_OPTIONS.find(l => l.id === location)?.label.toLowerCase() || "access"}` : null,
                                            distanceSurcharge > 0 ? `+$${distanceSurcharge} distance` : null,
                                            heavyAmount > 0 ? `+$${heavyAmount} heavy material` : null,
                                            applianceAmount > 0 ? `+$${applianceAmount} appliance` : null,
                                        ].filter(Boolean).join(" · ")}
                                    </div>}
                                </div>
                            )}
                            {(serviceType === "junk" || serviceType === "both") && tierData && !isOnSiteEstimate && displayJunkTotal(roundTo5(tierData.min + totalAdj)) > roundTo5(tierData.min + totalAdj) && <p style={{ padding: "12px 20px" }}>This estimate includes the same-day fee before any promo discount.</p>}
                            {(serviceType === "junk" || serviceType === "both") && !isOnSiteEstimate && !slotSameDay && (config.sameDay?.surchargeAmount ?? 0) > 0 && <p style={{ padding: "12px 20px" }}>A same-day fee may apply. We could not confirm same-day pricing; call us to confirm the total.</p>}
                                {promoCode && <p style={{ fontSize: 14, marginBottom: 16 }}>Promo eligibility is checked again when you submit. If the code is no longer available, the request continues at the regular price.</p>}
                            {/* Dumpster pending banner */}
                            {(serviceType === "dumpster" || serviceType === "both") && (() => {
                                const sizeNum = containerSize ? parseInt(containerSize) : 0;
                                const dTier = config.dumpsterPricing?.tiers.find(t => t.sizeCuYd === sizeNum);
                                const dHasPrice = dTier && (dTier.baseRate > 0 || (dTier.baseRateMin != null && dTier.baseRateMin > 0));
                                return (
                                    <div style={{ background: serviceType === "dumpster" ? "var(--hero-bg)" : "#FFFBEB", padding: serviceType === "dumpster" ? "32px 24px" : "16px 24px", textAlign: "center" }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E" }}>
                                            {serviceType === "both" ? "Dumpster Rental" : "Dumpster Rental"}
                                        </div>
                                        {dHasPrice ? (
                                            <>
                                                {promoDiscountsDumpster ? (
                                                    <>
                                                        <div style={{ fontSize: serviceType === "dumpster" ? 18 : 16, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E", textDecoration: "line-through" }}>
                                                            {containerSizes.find(c => c.id === containerSize)?.label || ""} — {formatDumpsterPrice(dTier)}
                                                        </div>
                                                        <div style={{ fontFamily: "var(--heading-font)", fontSize: serviceType === "dumpster" ? 44 : 28, fontWeight: 800, color: "#10B981" }}>
                                                            {containerSizes.find(c => c.id === containerSize)?.label || ""} — ${discountedPriceText((dTier.baseRateMin ?? dTier.baseRate))}{dTier.baseRateMax && dTier.baseRateMax > (dTier.baseRateMin ?? dTier.baseRate) ? ` – $${discountedPriceText(dTier.baseRateMax)}` : ""}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div style={{ fontFamily: "var(--heading-font)", fontSize: serviceType === "dumpster" ? 44 : 28, fontWeight: 800, color: serviceType === "dumpster" ? "var(--hero-text)" : "#92400E" }}>
                                                        {containerSizes.find(c => c.id === containerSize)?.label || ""} — {formatDumpsterPrice(dTier)}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: 12, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E", marginTop: 4 }}>
                                                    {dTier.includedDays}-day rental · {dTier.weightAllowanceTons} tons included · ${dTier.overageRatePerTon}/ton overage{dTier.extendedDailyRate ? ` · $${dTier.extendedDailyRate}/day extended` : ""}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ fontFamily: "var(--heading-font)", fontSize: serviceType === "dumpster" ? 28 : 20, fontWeight: 800, color: serviceType === "dumpster" ? "var(--hero-text)" : "#92400E" }}>
                                                    📋 Pending Confirmation
                                                </div>
                                                <div style={{ fontSize: 12, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E", marginTop: 4 }}>We&apos;ll call within 2 hours to confirm availability</div>
                                            </>
                                        )}
                                    </div>
                                );
                            })()}
                            {/* Have a promo code? */}
                            {!promoApplies && (
                                <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border, #E2E8F0)" }}>
                                    {!promoInputOpen ? (
                                        <button onClick={() => setPromoInputOpen(true)} style={{ background: "none", border: "none", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                                            🏷️ Have a promo code?
                                        </button>
                                    ) : (
                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                            <input
                                                type="text" placeholder="Enter code" value={promoInputValue}
                                                onChange={(e) => setPromoInputValue(e.target.value.toUpperCase())}
                                                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border, #E2E8F0)", fontSize: 14, fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.05em" }}
                                                onKeyDown={(e) => { if (e.key === "Enter" && promoInputValue.trim()) { setPromoCode(promoInputValue.trim()); } }}
                                            />
                                            <button
                                                onClick={() => { if (promoInputValue.trim()) setPromoCode(promoInputValue.trim()); }}
                                                disabled={!promoInputValue.trim() || promoValidating}
                                                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: promoInputValue.trim() ? "pointer" : "default", opacity: promoInputValue.trim() ? 1 : 0.5, fontFamily: "inherit" }}
                                            >
                                                {promoValidating ? "..." : "Apply"}
                                            </button>
                                            <button onClick={() => { setPromoInputOpen(false); setPromoInputValue(""); }} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: "0 4px" }}>×</button>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div style={{ padding: 24 }}>
                                {(() => {
                                    const rows: { label: string; value: string }[] = [
                                        { label: "Name", value: contact.name },
                                        { label: "Phone", value: contact.phone },
                                        { label: "Address", value: serviceAddress },
                                    ];
                                    if (serviceType === "junk" || serviceType === "both") {
                                        const edgeCaseIds = Object.entries(edgeCases).filter(([, v]) => v).map(([k]) => k);
                                        rows.push(
                                            { label: "Load Size", value: LOAD_TIERS[tierIndex].title },
                                            { label: "Truck Load", value: isOnSiteEstimate ? "Confirmed on site" : tierData ? `${LOAD_TIERS[tierIndex].label} ($${displayJunkTotal(roundTo5(tierData.min + totalAdj))} – $${displayJunkTotal(roundTo5(tierData.max + totalAdj))})` : "—" },
                                            { label: "Location", value: LOCATION_OPTIONS.find(l => l.id === location)?.label || "—" },
                                            ...(edgeCaseIds.length > 0 ? [{ label: "Special Conditions", value: edgeCaseIds.map(id => EDGE_CASES.find(e => e.id === id)?.label || id).join(", ") }] : []),
                                        );
                                    }
                                    if (serviceType === "dumpster" || serviceType === "both") {
                                        rows.push(
                                            { label: "Container", value: containerSizes.find(c => c.id === containerSize)?.label || "—" },
                                            { label: "Debris Type", value: DEBRIS_TYPES.find(d => d.id === debrisType)?.label || "—" },
                                            { label: "Duration", value: RENTAL_DURATIONS.find(r => r.id === rentalDuration)?.label || "—" },
                                        );
                                    }
                                    rows.push(
                                        { label: serviceType === "dumpster" ? "Delivery Date" : "Date", value: selectedDate?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) || "—" },
                                        { label: "Time", value: dynamicSlots?.find(s => `${s.start}-${s.end}` === selectedTime)?.label || formatSlotTime(selectedTime) || "—" },
                                    );
                                    return rows.map((row, i) => (
                                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--border, #F1F5F9)" : "none" }}>
                                            <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}>{row.label}</span>
                                            <span style={{ fontSize: 14, color: "var(--foreground)", fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{row.value}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>

                        {/* ── Payment Preference ── */}
                        {hasStripe && (
                            <div style={{ marginBottom: 24 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                                    <CreditCard size={20} style={{ color: "var(--brand)" }} />
                                    <span style={{ fontWeight: 700, fontSize: 15, color: "var(--foreground)" }}>How would you like to pay?</span>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12, marginBottom: 16 }}>
                                    {((serviceType === "dumpster" || serviceType === "both")
                                        ? [
                                            { id: "card" as const, icon: "💳", label: "Card on File", sub: "Required for dumpster rentals" },
                                        ]
                                        : [
                                            { id: "card" as const, icon: "💳", label: "Pay Online", sub: "Save card on file" },
                                            { id: "on_site" as const, icon: "💵", label: "Pay On-Site", sub: "Cash or check" },
                                        ]
                                    ).map((opt) => (
                                        <button key={opt.id} onClick={() => setPaymentPreference(opt.id)}
                                            style={{
                                                padding: "16px 14px", borderRadius: 14, cursor: "pointer", textAlign: "center", fontFamily: "inherit",
                                                border: paymentPreference === opt.id ? "2px solid var(--brand)" : "1.5px solid var(--border, #E2E8F0)",
                                                background: paymentPreference === opt.id ? "rgba(var(--brand-rgb, 249,115,22), 0.08)" : "var(--card)",
                                                transition: "all 0.2s",
                                            }}>
                                            <div style={{ fontSize: 28, marginBottom: 6 }}>{opt.icon}</div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--foreground)" }}>{opt.label}</div>
                                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{opt.sub}</div>
                                        </button>
                                    ))}
                                </div>

                                {/* ── Card on File (conditionally rendered — only in DOM when Pay Online selected) ── */}
                                {paymentPreference === "card" && (
                                    <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border, #E2E8F0)", padding: 24 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                                            <Lock size={14} style={{ color: "#16A34A" }} />
                                            <span style={{ fontSize: 13, color: "#16A34A", fontWeight: 600 }}>Secure & encrypted</span>
                                        </div>
                                        <div
                                            ref={cardMountRef}
                                            style={{
                                                padding: "14px 16px", borderRadius: 10, border: "1.5px solid var(--border, #E2E8F0)",
                                                background: "#FAFAFA", minHeight: 44, transition: "border-color 0.2s",
                                            }}
                                        />
                                        {cardError && (
                                            <p style={{ fontSize: 12, color: "#DC2626", marginTop: 8 }}>{cardError}</p>
                                        )}
                                    </div>
                                )}

                                {paymentPreference === "card" && (
                                    <div aria-live="polite" style={{ marginTop: 12 }}>
                                        {setupError ? <><p role="alert">{setupError}</p><button type="button" onClick={retryCard} style={{ minHeight: 44, padding: "10px 16px", marginTop: 8 }}>Retry card setup</button></> : !stripeReady ? <p>Loading secure card entry…</p> : null}
                                    </div>
                                )}

                                {/* ── "Not charged" warning banner ── */}
                                <div style={{
                                    marginTop: 16, padding: "16px 20px", borderRadius: 14,
                                    background: "linear-gradient(135deg, #F0FDF4, #DCFCE7)", border: "1px solid #BBF7D0",
                                    display: "flex", alignItems: "flex-start", gap: 12,
                                }}>
                                    <LockKeyhole size={22} style={{ color: "#16A34A", flexShrink: 0, marginTop: 2 }} />
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: "#166534", marginBottom: 4 }}>
                                            {paymentPreference !== "card"
                                                ? "No payment required now"
                                                : (serviceType === "dumpster" || serviceType === "both")
                                                    ? "Rental payment timing"
                                                    : "You will NOT be charged today"}
                                        </div>
                                        <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.5 }}>
                                            {paymentPreference === "card"
                                                ? ((serviceType === "dumpster" || serviceType === "both")
                                                    ? "Your rental base rate, plus applicable tax, may be charged when the rental is approved or your card is saved for an approved rental. Saving a card does not confirm a successful charge. Junk removal and extras such as additional days are billed separately."
                                                    : "Your card is saved securely and will only be charged after your job is complete. The final price will be confirmed by your crew on-site.")
                                                : "You\u2019ll pay your crew directly when the job is complete. Cash, check, or card accepted on-site."}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Terms acceptance (required to book) */}
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", borderRadius: 12, border: `2px solid ${termsAccepted ? "var(--brand)" : "var(--border, #E2E8F0)"}`, background: termsAccepted ? "#FFF7ED" : "var(--card)", cursor: "pointer", transition: "all 0.15s", marginTop: 24 }}>
                            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)}
                                style={{ width: 20, height: 20, accentColor: "var(--brand)", flexShrink: 0, marginTop: 1 }} />
                            <span style={{ fontSize: 14, color: "var(--foreground)", lineHeight: 1.5 }}>
                                I agree to the{config.termsUrl ? <> <a href={config.termsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 600 }}>Terms of Service</a></> : " Terms of Service"}{config.privacyUrl ? <> and <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 600 }}>Privacy Policy</a></> : " and Privacy Policy"}. I understand that pricing is finalized on-site, schedule changes should be requested as soon as possible, and hazardous materials cannot be hauled.
                            </span>
                        </label>

                        {error && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 14, color: "#DC2626" }}>
                                {error}
                            </div>
                        )}

                        <button onClick={handleSubmit} disabled={submitting || !termsAccepted || (hasStripe && (paymentPreference === null || (paymentPreference === "card" && !cardComplete)))}
                            style={{
                                width: "100%", marginTop: 24, padding: 18, borderRadius: "var(--btn-radius)", border: "none",
                                background: !submitting ? "linear-gradient(135deg, var(--brand), var(--brand-dark))" : "#E2E8F0",
                                color: !submitting ? "#fff" : "#94A3B8",
                                fontSize: 17, fontWeight: 700, cursor: !submitting ? "pointer" : "not-allowed",
                                fontFamily: "var(--heading-font)", boxShadow: !submitting ? "0 8px 24px rgba(249,115,22,0.3)" : "none",
                                transition: "all 0.2s",
                            }}>
                            {submitting ? "Submitting..." : serviceType === "dumpster" ? "Confirm Dumpster Rental →" : serviceType === "both" ? "Confirm & Book →" : "Confirm & Book My Pickup →"}
                        </button>
                        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
                            {serviceType === "dumpster" ? "The rental base rate may be charged on approval or when your card is saved for an approved rental." : serviceType === "both" ? "Each service request is confirmed separately. The rental base rate may be charged on approval." : "No payment today — final price confirmed when our crew arrives."}
                        </p>
                    </div>
                )}
            </div>

            {/* ── Footer Nav (all steps except contact and quote) ────────────── */}
            {currentPhase !== "contact" && currentPhase !== "quote" && (
                <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--card)", borderTop: "1px solid var(--border, #E2E8F0)", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 50 }}>
                    <button onClick={goBack} style={{ border: "none", background: "none", fontSize: 15, color: "var(--muted)", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
                        <ChevronLeft size={18} /> Back
                    </button>
                    <button onClick={goNext} disabled={!canProceed()}
                        style={{
                            padding: "14px 44px", borderRadius: "var(--btn-radius)", border: "none", fontSize: 15, fontWeight: 700, cursor: canProceed() ? "pointer" : "not-allowed",
                            fontFamily: "inherit", transition: "all 0.2s",
                            background: canProceed() ? "var(--brand)" : "#E2E8F0",
                            color: canProceed() ? "#fff" : "#94A3B8",
                            boxShadow: canProceed() ? "0 4px 16px rgba(249,115,22,0.3)" : "none",
                        }}>
                        Continue
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * config.ts — Runtime configuration for the booking widget.
 * Replaces siteConfig.ts env vars with values fetched from the dashboard
 * widget config endpoint at initialization.
 */
import { createContext, useContext, type ReactNode } from "react";

/* ── Pricing Types (match website-template/lib/siteConfig.ts) ──────── */

export type PricingTier = { id: string; label: string; fraction: string; min: number; max: number };
export type Surcharge = {
    id: string;
    label: string;
    amount: number;
    enabled: boolean;
    /** Density-scaled surcharges (Heavy Material) carry one amount per tier:
     *  [1/8, 1/4, 1/2, 3/4, Full, 1+]. If absent, use flat `amount`. */
    amountsByTier?: number[];
    /** Access surcharges carry one amount per LOCATION_OPTIONS id
     *  (curbside, garage, ground_floor, upstairs, basement, backyard). */
    amountsByLocation?: Record<string, number>;
};
export type DistanceTier = { id: string; maxMiles: number; additionalCost: number };
export type PricingConfig = { truckSize: string; fullLoadPrice?: number; tiers: PricingTier[]; distanceTiers?: DistanceTier[]; surcharges: Surcharge[] };
export type BusinessDayHours = {
    start: string;
    end: string;
    closed?: boolean;
    /** Legacy keys as the dashboard actually stores them. `normalizeBusinessHours`
     *  folds these into start/end at intake; they are declared here so the
     *  defensive reads in wizardData.ts don't need a cast. */
    open?: string;
    close?: string;
};
export type BusinessHoursConfig = Record<string, BusinessDayHours>;

export type DumpsterPriceTier = {
    sizeCuYd: number;
    baseRate: number;
    baseRateMin: number | null;
    baseRateMax: number | null;
    includedDays: number;
    weightAllowanceTons: number;
    overageRatePerTon: number;
    extendedDailyRate: number | null;
};
export type DumpsterSurcharge = { name: string; type: string; amount: number };
export type DumpsterPricingConfig = { tiers: DumpsterPriceTier[]; surcharges: DumpsterSurcharge[] };

/* ── Widget Config (fetched from dashboard at init) ────────────────── */

export type WidgetConfig = {
    // Identity
    companyName: string;
    phoneNumber: string;

    // Branding
    brandColor: string;

    // Features
    offersDumpsterRental: boolean;
    companyMode?: import("./bookingFlow").CompanyMode;
    sameDay?: import("./bookingFlow").SameDayPricing;

    // Pricing
    pricing: PricingConfig;
    dumpsterPricing: DumpsterPricingConfig | null;

    // Service area
    serviceAreaZips: string[];
    serviceAreaCenter: { lat: number; lng: number } | null;
    serviceAreaRadiusMiles: number;
    distanceSurchargePerMile: number;
    freeRadiusMiles: number;

    // Business hours
    businessHours: BusinessHoursConfig | null;

    // External services
    googleMapsKey: string;
    stripePublishableKey: string;

    // Legal URLs (from dashboard config or embed data-attributes)
    privacyUrl: string;
    termsUrl: string;

    // API (set by main.tsx, not from dashboard)
    widgetApiUrl: string;
    siteToken: string;
};

/* ── React Context ─────────────────────────────────────────────────── */

export const WidgetConfigContext = createContext<WidgetConfig | null>(null);

export function useConfig(): WidgetConfig {
    const ctx = useContext(WidgetConfigContext);
    if (!ctx) throw new Error("useConfig must be used within a <ConfigProvider>");
    return ctx;
}

export function ConfigProvider({ config, children }: { config: WidgetConfig; children: ReactNode }) {
    return (
        <WidgetConfigContext.Provider value={config}>
            {children}
        </WidgetConfigContext.Provider>
    );
}

/* ── Business hours normalisation ──────────────────────────────────── */

/**
 * Accept either business-hours shape and return the `{start,end}` one.
 *
 * The dashboard stores hours as `{open,close,closed}` — that is what onboarding
 * step 1 writes — but this widget's type has always said `{start,end}`, copied
 * from a stale comment in the dashboard's Prisma schema. Reading `.start` off
 * an `{open,close}` object yields `undefined`, and the slot code then called
 * `.split(":")` on it, which threw and unmounted the entire booking form.
 *
 * Normalising here, at the boundary where config enters the widget, means
 * nothing downstream has to know about the discrepancy.
 *
 * Mirrors `normalizeBusinessHours` in website-template/lib/siteConfig.ts.
 */
export function normalizeBusinessHours(raw: unknown): BusinessHoursConfig | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const result: BusinessHoursConfig = {};
    for (const [day, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const e = entry as Record<string, unknown>;
        result[day] = {
            start: typeof e.start === "string" ? e.start : typeof e.open === "string" ? e.open : "",
            end: typeof e.end === "string" ? e.end : typeof e.close === "string" ? e.close : "",
            ...(e.closed != null && { closed: Boolean(e.closed) }),
        };
    }
    return Object.keys(result).length > 0 ? result : null;
}

/* ── Helpers (match siteConfig.ts) ─────────────────────────────────── */

/** Round to nearest $5 */
export function roundTo5(n: number): number { return Math.round(n / 5) * 5; }

/** Match rental acceptance: baseRateMin ?? baseRate; baseRateMax is not charged. */
export function formatDumpsterPrice(tier: DumpsterPriceTier): string {
    const min = tier.baseRateMin ?? tier.baseRate;
    if (!Number.isFinite(min) || min <= 0) return "Rental price needs confirmation";
    return `$${min}`;
}

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
};
export type DistanceTier = { id: string; maxMiles: number; additionalCost: number };
export type PricingConfig = { truckSize: string; fullLoadPrice?: number; tiers: PricingTier[]; distanceTiers?: DistanceTier[]; surcharges: Surcharge[] };
export type BusinessDayHours = { start: string; end: string; closed?: boolean };
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

/* ── Helpers (match siteConfig.ts) ─────────────────────────────────── */

/** Round to nearest $5 */
export function roundTo5(n: number): number { return Math.round(n / 5) * 5; }

/** Format dumpster price as range or "Starting at", rounded to nearest $5 */
export function formatDumpsterPrice(tier: DumpsterPriceTier): string {
    const min = roundTo5(tier.baseRateMin ?? tier.baseRate);
    const max = tier.baseRateMax ? roundTo5(tier.baseRateMax) : null;
    if (max && max > min) return `$${min} – $${max}`;
    return `Starting at $${min}`;
}

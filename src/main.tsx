import { companyMode } from "./lib/bookingFlow";
/**
 * main.tsx — Widget entry point.
 * Reads configuration from the host page's data attributes,
 * fetches runtime config from the widget API, then mounts the widget.
 *
 * Usage on the host page:
 *   <div id="syj-booking-widget"
 *        data-site-token="..."
 *        data-api-url="https://app.scaleyourjunk.com">
 *   </div>
 *   <script src="https://app.scaleyourjunk.com/widget/embed.iife.js" defer></script>
 */
import { createRoot } from "react-dom/client";
import Widget from "./components/Widget";
import WidgetErrorBoundary from "./components/WidgetErrorBoundary";
import { normalizeBusinessHours, type WidgetConfig } from "./lib/config";
import "./styles/widget.css";

/** Build timestamp injected by vite.config.ts `define`. */
declare const __WIDGET_BUILD__: string;

function currentScriptOrigin(): string {
    const script = document.currentScript as HTMLScriptElement | null;
    if (!script?.src) return "";
    try {
        return new URL(script.src).origin;
    } catch {
        return "";
    }
}

function cleanOptional(value: string | null | undefined): string | undefined {
    const clean = value?.trim();
    return clean || undefined;
}

function resolveBookingSource(el: HTMLElement): string {
    const explicitSource = cleanOptional(el.dataset.bookingSource) || cleanOptional(el.dataset.source);
    if (explicitSource) return explicitSource;

    const params = new URLSearchParams(window.location.search);
    return params.get("utm_source") === "phone_agent" ? "phone_agent_sms" : "WIDGET";
}

function resolveInitialPromo(el: HTMLElement): string | undefined {
    const explicitPromo = cleanOptional(el.dataset.promo) || cleanOptional(el.dataset.promoCode);
    if (explicitPromo) return explicitPromo;

    const params = new URLSearchParams(window.location.search);
    return cleanOptional(params.get("promo"));
}

function hexToRgb(hex: string): string | null {
    const clean = hex.trim().replace(/^#/, "");
    const expanded = clean.length === 3
        ? clean.split("").map((char) => char + char).join("")
        : clean;
    if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
    const value = parseInt(expanded, 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

async function boot() {
    // Identify the running build. The deployed bundle is a copy held in the
    // ScaleYourJunk repo and has drifted from source before; without this there
    // is no way to tell which build an operator's site is actually serving.
    console.info(`[SYJ Widget] build ${typeof __WIDGET_BUILD__ === "string" ? __WIDGET_BUILD__ : "unknown"}`);

    // 1. Find the mount element
    const el = document.getElementById("syj-booking-widget");
    if (!el) {
        console.warn("[SYJ Widget] No element with id='syj-booking-widget' found.");
        return;
    }

    const siteToken = cleanOptional(el.dataset.siteToken) || cleanOptional(el.dataset.token);
    const apiUrl = cleanOptional(el.dataset.apiUrl) || currentScriptOrigin();
    const initialPromo = resolveInitialPromo(el);
    const bookingSource = resolveBookingSource(el);

    if (!siteToken || !apiUrl) {
        console.error("[SYJ Widget] Missing data-site-token or data-api-url attributes.");
        return;
    }

    // 2. Fetch runtime configuration from the widget API proxy
    try {
        const res = await fetch(`${apiUrl}/api/widget/config`, {
            headers: { "x-site-token": siteToken },
        });
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        const serverConfig = await res.json();

        // 3. Build the full WidgetConfig
        const config: WidgetConfig = {
            siteToken,
            widgetApiUrl: apiUrl,
            companyName: serverConfig.companyName || "Junk Removal",
            phoneNumber: serverConfig.phoneNumber || "",
            brandColor: serverConfig.brandColor || "#F97316",
            googleMapsKey: serverConfig.googleMapsKey || "",
            serviceAreaZips: serverConfig.serviceAreaZips || [],
            serviceAreaCenter: serverConfig.serviceAreaCenter || null,
            serviceAreaRadiusMiles: serverConfig.serviceAreaRadiusMiles || 0,
            distanceSurchargePerMile: serverConfig.distanceSurchargePerMile || 0,
            freeRadiusMiles: serverConfig.freeRadiusMiles || 0,
            stripePublishableKey: serverConfig.stripePublishableKey || "",
            companyMode: companyMode(serverConfig.companyMode, serverConfig.offersDumpsterRental ?? false),
            offersDumpsterRental: serverConfig.offersDumpsterRental ?? false,
            sameDay: serverConfig.sameDay,
            pricing: serverConfig.pricing || { tiers: [], surcharges: [] },
            dumpsterPricing: serverConfig.dumpsterPricing || null,
            // The dashboard serves `{open,close,closed}`; the wizard reads
            // `{start,end}`. Fold both into one shape here rather than letting
            // an undefined `.start` reach the slot code.
            businessHours: normalizeBusinessHours(serverConfig.businessHours),
            privacyUrl: serverConfig.privacyUrl || el.dataset.privacyUrl || "",
            termsUrl: serverConfig.termsUrl || el.dataset.termsUrl || "",
        };

        // 4. Apply brand color as CSS custom property
        if (config.brandColor) {
            el.style.setProperty("--brand", config.brandColor);
            el.style.setProperty("--brand-dark", serverConfig.brandDarkColor || config.brandColor);
            const brandRgb = hexToRgb(config.brandColor);
            if (brandRgb) el.style.setProperty("--brand-rgb", brandRgb);
        }

        // 5. Mount the React widget
        el.classList.add("syj-widget-root");
        const root = createRoot(el);
        root.render(
            <WidgetErrorBoundary phoneNumber={config.phoneNumber} companyName={config.companyName}>
                <Widget config={config} initialPromo={initialPromo} bookingSource={bookingSource} />
            </WidgetErrorBoundary>,
        );

    } catch (err) {
        console.error("[SYJ Widget] Failed to initialize:", err);
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#64748B;font-family:system-ui">
            <p>Unable to load booking widget. Please try again later.</p>
        </div>`;
    }
}

// Auto-boot when the script loads
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}

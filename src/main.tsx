/**
 * main.tsx — Widget entry point.
 * Reads configuration from the host page's data attributes,
 * fetches runtime config from the widget API, then mounts the widget.
 *
 * Usage on the host page:
 *   <div id="syj-booking-widget"
 *        data-site-token="..."
 *        data-api-url="https://widget-api.example.com">
 *   </div>
 *   <script src="https://cdn.example.com/embed.js"></script>
 */
import { createRoot } from "react-dom/client";
import Widget from "./components/Widget";
import type { WidgetConfig } from "./lib/config";
import "./styles/widget.css";

async function boot() {
    // 1. Find the mount element
    const el = document.getElementById("syj-booking-widget");
    if (!el) {
        console.warn("[SYJ Widget] No element with id='syj-booking-widget' found.");
        return;
    }

    const siteToken = el.dataset.siteToken;
    const apiUrl = el.dataset.apiUrl;

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
            offersDumpsterRental: serverConfig.offersDumpsterRental ?? false,
            pricing: serverConfig.pricing || { tiers: [], surcharges: [] },
            dumpsterPricing: serverConfig.dumpsterPricing || null,
            businessHours: serverConfig.businessHours || {},
        };

        // 4. Apply brand color as CSS custom property
        if (config.brandColor) {
            el.style.setProperty("--brand", config.brandColor);
        }

        // 5. Mount the React widget
        el.classList.add("syj-widget-root");
        const root = createRoot(el);
        root.render(<Widget config={config} />);

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

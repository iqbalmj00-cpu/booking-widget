/**
 * googleMapsLoader.ts — one Google Maps script per page, whoever asked for it.
 *
 * Ported from website-template/lib/googleMapsLoader.ts. The widget used to
 * inline its own loader in AddressAutocomplete.tsx, which checked only for
 * `window.google.maps` and never for a `<script>` already in flight. On an
 * operator's page that loads Maps itself — a store locator, an embedded map —
 * the widget appended a *second* Maps script before the first had finished,
 * and Google's API warns and misbehaves when included twice. It also cleared
 * its memoised promise on failure without removing the dead tag, so every
 * retry left another corpse in the head for the next attempt to find.
 *
 * The website's exported surface is `loadGoogleMapsScript` +
 * `loadGoogleMapsLibrary`; the widget only ever wants the places library, but
 * the split is kept so the two files stay readable against each other.
 *
 * Keep identical to website-template/lib/googleMapsLoader.ts.
 */

type GoogleMapsWindow = Window & {
    google?: {
        maps?: {
            importLibrary?: (name: string) => Promise<unknown>;
        };
    };
};

let scriptPromise: Promise<void> | null = null;

export function loadGoogleMapsScript(apiKey: string): Promise<void> {
    if (typeof window === "undefined") return Promise.reject(new Error("Google Maps is client-only"));

    const w = window as GoogleMapsWindow;
    if (w.google?.maps?.importLibrary) return Promise.resolve();
    if (scriptPromise) return scriptPromise;

    // The element this attempt is waiting on, so a failure can remove it.
    let attempted: HTMLScriptElement | null = null;

    const pending = new Promise<void>((resolve, reject) => {
        // A tag that already errored is dead: its load/error events have fired,
        // so listening to it again produces a promise that never settles. Only
        // reuse a tag still in flight.
        const existing = document.querySelector<HTMLScriptElement>(
            'script[src^="https://maps.googleapis.com/maps/api/js"]:not([data-load-failed])'
        );
        if (existing) {
            attempted = existing;
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps")), { once: true });
            return;
        }

        const script = document.createElement("script");
        script.id = "google-maps-js";
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google Maps"));
        attempted = script;
        document.head.appendChild(script);
    });

    // Never cache a failure. Memoising the rejected promise meant one transient
    // network error killed address autocomplete for the rest of the page's life,
    // with no way back short of a reload.
    //
    // Clearing the promise alone is not enough: the dead <script> stays in the
    // head, and the next call would find it, attach listeners to events that
    // already fired, and hang forever — worse than the failure it replaced. Mark
    // it and drop it so the retry injects a fresh tag.
    scriptPromise = pending.catch((err) => {
        scriptPromise = null;
        if (attempted) {
            attempted.setAttribute("data-load-failed", "true");
            attempted.remove();
        }
        throw err;
    });

    return scriptPromise;
}

export async function loadGoogleMapsLibrary<T = unknown>(apiKey: string, name: string): Promise<T> {
    await loadGoogleMapsScript(apiKey);
    const w = window as GoogleMapsWindow;
    if (!w.google?.maps?.importLibrary) {
        throw new Error("Google Maps importLibrary is unavailable");
    }
    return w.google.maps.importLibrary(name) as Promise<T>;
}

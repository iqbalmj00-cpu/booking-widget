/**
 * AddressAutocomplete.tsx — Google Places (New) address input for the widget.
 * Mirrors website-template/components/AddressAutocomplete.tsx with:
 *   - Props instead of siteConfig imports
 *   - syj-* CSS classes for host-page isolation
 *   - High dropdown z-index for host-page compatibility
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, AlertTriangle } from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────── */
export type PlaceResult = {
    address: string;
    zip: string;
    city: string;
    state: string;
    lat: number;
    lng: number;
};

type Props = {
    value: string;
    onChange: (value: string) => void;
    onPlaceSelect: (place: PlaceResult) => void;
    placeholder?: string;
    googleMapsKey: string;
    serviceAreaZips: string[];
    phoneNumber: string;
};

type Suggestion = {
    placePrediction: any;
    placeId: string;
    mainText: string;
    secondaryText: string;
};

/* ── Tunables ──────────────────────────────────────────────────────────── */
const DEBOUNCE_MS = 250;
const LOAD_TIMEOUT_MS = 5000;
const MAX_SUGGESTIONS = 5;
const MIN_INPUT_LENGTH = 3;

/* ── Google Maps Places library loader (Places API New) ────────────────── */
let placesLibPromise: Promise<any> | null = null;

function loadPlacesLibrary(apiKey: string): Promise<any> {
    if (placesLibPromise) return placesLibPromise;

    placesLibPromise = new Promise((resolve, reject) => {
        if (typeof window === "undefined") return reject(new Error("SSR"));

        const w = window as any;

        const importPlaces = async () => {
            try {
                const lib = await w.google.maps.importLibrary("places");
                resolve(lib);
            } catch (e) {
                reject(e);
            }
        };

        if (w.google?.maps?.importLibrary) {
            importPlaces();
            return;
        }

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
        script.async = true;
        script.defer = true;
        script.onload = importPlaces;
        script.onerror = () => reject(new Error("Failed to load Google Maps"));
        document.head.appendChild(script);
    });

    return placesLibPromise;
}

/* ── Component ─────────────────────────────────────────────────────────── */
export default function AddressAutocomplete({
    value, onChange, onPlaceSelect, placeholder,
    googleMapsKey, serviceAreaZips, phoneNumber,
}: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);
    const sessionTokenRef = useRef<any>(null);
    const placesLibRef = useRef<any>(null);

    const [ready, setReady] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [serviceAreaError, setServiceAreaError] = useState<string | null>(null);
    const hasApiKey = !!googleMapsKey;

    // Load the Places library (and start a session token on success).
    useEffect(() => {
        if (!hasApiKey) return;
        const timeoutId = setTimeout(() => setLoadFailed(true), LOAD_TIMEOUT_MS);
        loadPlacesLibrary(googleMapsKey)
            .then((lib) => {
                clearTimeout(timeoutId);
                placesLibRef.current = lib;
                sessionTokenRef.current = new lib.AutocompleteSessionToken();
                setReady(true);
            })
            .catch(() => {
                clearTimeout(timeoutId);
                setLoadFailed(true);
            });
        return () => clearTimeout(timeoutId);
    }, [hasApiKey, googleMapsKey]);

    // Close the dropdown when the user clicks outside.
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setSuggestions([]);
                setHighlightedIndex(-1);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Cleanup any pending debounce on unmount.
    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    const fetchSuggestions = useCallback(async (input: string) => {
        if (!ready || !placesLibRef.current) return;
        if (input.length < MIN_INPUT_LENGTH) {
            setSuggestions([]);
            return;
        }
        const myRequestId = ++requestIdRef.current;
        try {
            const response =
                await placesLibRef.current.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                    input,
                    sessionToken: sessionTokenRef.current,
                    includedRegionCodes: ["us"],
                });
            if (myRequestId !== requestIdRef.current) return;
            const raw = response?.suggestions || [];
            const mapped: Suggestion[] = raw
                .filter((s: any) => s.placePrediction)
                .slice(0, MAX_SUGGESTIONS)
                .map((s: any) => ({
                    placePrediction: s.placePrediction,
                    placeId: s.placePrediction.placeId,
                    mainText: s.placePrediction.mainText?.text || s.placePrediction.text?.text || "",
                    secondaryText: s.placePrediction.secondaryText?.text || "",
                }));
            setSuggestions(mapped);
            setHighlightedIndex(-1);
        } catch (err) {
            if (myRequestId !== requestIdRef.current) return;
            setSuggestions([]);
        }
    }, [ready]);

    const handleInputChange = (val: string) => {
        onChange(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchSuggestions(val), DEBOUNCE_MS);
    };

    const handleSuggestionClick = useCallback(async (suggestion: Suggestion) => {
        if (!placesLibRef.current) return;
        try {
            const place = suggestion.placePrediction.toPlace();
            await place.fetchFields({ fields: ["formattedAddress", "addressComponents", "location"] });

            const formatted = place.formattedAddress || "";
            const components = place.addressComponents || [];
            let zip = "";
            let city = "";
            let state = "";
            for (const c of components) {
                if (c.types.includes("postal_code")) zip = c.shortText || "";
                if (c.types.includes("locality")) city = c.longText || "";
                if (c.types.includes("administrative_area_level_1")) state = c.shortText || "";
            }

            const loc = place.location;
            const lat = typeof loc?.lat === "function" ? loc.lat() : (loc?.lat ?? 0);
            const lng = typeof loc?.lng === "function" ? loc.lng() : (loc?.lng ?? 0);

            if (serviceAreaZips.length > 0 && zip && !serviceAreaZips.includes(zip)) {
                setServiceAreaError(
                    `Sorry, we don't currently service this area. Please call us at ${phoneNumber} for assistance.`
                );
            } else {
                setServiceAreaError(null);
            }

            onChange(formatted);
            onPlaceSelect({ address: formatted, zip, city, state, lat, lng });

            // A session ends with a place details fetch — start a new one.
            sessionTokenRef.current = new placesLibRef.current.AutocompleteSessionToken();
            setSuggestions([]);
            setHighlightedIndex(-1);
        } catch (err) {
            console.error("Place details fetch failed:", err);
            setSuggestions([]);
        }
    }, [onChange, onPlaceSelect, serviceAreaZips, phoneNumber]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (suggestions.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIndex(i => (i + 1) % suggestions.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIndex(i => i <= 0 ? suggestions.length - 1 : i - 1);
        } else if (e.key === "Enter" && highlightedIndex >= 0) {
            e.preventDefault();
            handleSuggestionClick(suggestions[highlightedIndex]);
        } else if (e.key === "Escape") {
            setSuggestions([]);
            setHighlightedIndex(-1);
        }
    };

    // Graceful fallback when no API key is configured.
    if (!hasApiKey) {
        return (
            <div>
                <input
                    className="syj-input"
                    placeholder={placeholder || "1234 Main St, City, State"}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        onPlaceSelect({ address: e.target.value, zip: "", city: "", state: "", lat: 0, lng: 0 });
                    }}
                />
            </div>
        );
    }

    return (
        <div ref={containerRef} style={{ position: "relative" }}>
            <div style={{ position: "relative" }}>
                <MapPin size={16} style={{
                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                    color: serviceAreaError ? "#DC2626" : "var(--muted)", pointerEvents: "none",
                    zIndex: 1,
                }} />
                <input
                    ref={inputRef}
                    className="syj-input"
                    placeholder={placeholder || "Start typing your address..."}
                    value={value}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    style={{ paddingLeft: 38 }}
                    autoComplete="off"
                />
                {suggestions.length > 0 && (
                    <ul
                        className="syj-address-dropdown"
                        role="listbox"
                        style={{
                            position: "absolute", top: "100%", left: 0, right: 0,
                            marginTop: 4, padding: 0, listStyle: "none",
                            background: "var(--card, #fff)",
                            border: "1px solid var(--border, #E2E8F0)",
                            borderRadius: 10,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                            zIndex: 999999, maxHeight: 280, overflowY: "auto",
                        }}
                    >
                        {suggestions.map((s, i) => (
                            <li
                                key={s.placeId || i}
                                role="option"
                                aria-selected={i === highlightedIndex}
                                onMouseDown={(e) => { e.preventDefault(); handleSuggestionClick(s); }}
                                onMouseEnter={() => setHighlightedIndex(i)}
                                style={{
                                    padding: "10px 14px",
                                    cursor: "pointer",
                                    background: i === highlightedIndex
                                        ? "rgba(249, 115, 22, 0.08)"
                                        : "transparent",
                                    borderBottom: i < suggestions.length - 1
                                        ? "1px solid var(--border, #F1F5F9)"
                                        : "none",
                                }}
                            >
                                <div style={{ fontSize: 14, color: "var(--foreground)", fontWeight: 500 }}>
                                    {s.mainText}
                                </div>
                                {s.secondaryText && (
                                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                                        {s.secondaryText}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {loadFailed && (
                <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
                    Address suggestions unavailable. You can still type your address manually.
                </p>
            )}
            {serviceAreaError && (
                <div style={{
                    marginTop: 8, padding: "10px 14px", borderRadius: 10,
                    background: "#FEF2F2", border: "1px solid #FECACA",
                    fontSize: 13, color: "#DC2626", display: "flex", alignItems: "flex-start", gap: 8,
                }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{serviceAreaError}</span>
                </div>
            )}
        </div>
    );
}

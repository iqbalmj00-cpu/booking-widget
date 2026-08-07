/**
 * wizardData.ts — Static data for the booking wizard.
 * Copied from website-template/lib/wizardData.ts with one change:
 * BusinessHoursConfig imported from local config.ts instead of @/lib/siteConfig.
 */
import type { BusinessHoursConfig } from "./config";

export const STEPS = ["Your Info", "Junk Type", "Items", "Volume", "Location", "Schedule", "Quote & Book"];

export type JunkCategory = { id: string; label: string; icon: string; desc: string; inputType: "quantity" | "pile" };
export type JunkItem = { id: string; label: string; weight: "heavy" | "medium" | "light" };
export type PileSize = { id: string; label: string; desc: string; icon: string };
export type VolumeOption = { id: string; label: string; fraction: string; desc: string; truckFill: number; comparison: string };
export type LocationOption = { id: string; label: string; icon: string; desc: string };
export type TimeSlot = { id: string; label: string; period: string; startHour: number };

/** Slot shape returned by GET /api/public/available-slots */
export type DynamicSlot = {
    start: string;          // "08:00"
    end: string;            // "10:00"
    label: string;          // "Morning"
    available: boolean;
    remainingCapacity: number;
};

/** Format a 24h time string like "08:00" → "8:00 AM" */
export function formatSlotTime(time: string | null): string {
    if (!time) return "";
    // Handle range format "08:00-10:00"
    if (time.includes("-")) {
        const [start, end] = time.split("-");
        return `${formatSlotTime(start)} – ${formatSlotTime(end)}`;
    }
    const [h, m] = time.split(":").map(Number);
    if (isNaN(h)) return time;
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${hour12}:00 ${period}` : `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export const JUNK_CATEGORIES: JunkCategory[] = [
    { id: "furniture", label: "Furniture Removal", icon: "Armchair", desc: "Sofas, tables, chairs, dressers", inputType: "quantity" },
    { id: "appliances", label: "Appliance Disposal", icon: "Plug", desc: "Fridges, washers, dryers, ovens", inputType: "quantity" },
    { id: "yard", label: "Yard Waste", icon: "TreePine", desc: "Branches, soil, leaves, stumps", inputType: "pile" },
    { id: "construction", label: "Construction Debris", icon: "HardHat", desc: "Drywall, lumber, tile, concrete", inputType: "pile" },
    { id: "electronics", label: "E-Waste Recycling", icon: "Monitor", desc: "TVs, computers, printers, cables", inputType: "quantity" },
    { id: "household", label: "General Junk", icon: "Package", desc: "Boxes, bags, miscellaneous items", inputType: "pile" },
    { id: "mattress", label: "Mattresses", icon: "BedDouble", desc: "Mattresses, box springs, frames", inputType: "quantity" },
    { id: "garage", label: "Garage Cleanout", icon: "Warehouse", desc: "Tools, storage, equipment", inputType: "pile" },
];

export const PILE_SIZES: PileSize[] = [
    { id: "small", label: "Small Pile", desc: "A few bags or a wheelbarrow worth", icon: "Package" },
    { id: "medium", label: "Medium Pile", desc: "Dining table–sized area, fills a pickup bed", icon: "Truck" },
    { id: "large", label: "Large Pile", desc: "Waist-high pile, half a garage bay", icon: "Container" },
    { id: "xl", label: "XL Pile", desc: "Chest-high or larger, fills a full garage bay", icon: "Warehouse" },
];

export const CATEGORY_ITEMS: Record<string, JunkItem[]> = {
    furniture: [
        { id: "couch", label: "Couch / Sofa", weight: "heavy" },
        { id: "loveseat", label: "Loveseat", weight: "heavy" },
        { id: "recliner", label: "Recliner", weight: "heavy" },
        { id: "dining_table", label: "Dining Table", weight: "heavy" },
        { id: "chairs", label: "Chairs (set)", weight: "medium" },
        { id: "dresser", label: "Dresser", weight: "heavy" },
        { id: "desk", label: "Desk", weight: "medium" },
        { id: "bookshelf", label: "Bookshelf", weight: "medium" },
        { id: "entertainment_center", label: "Entertainment Center", weight: "heavy" },
        { id: "cabinet", label: "Cabinet", weight: "medium" },
        { id: "coffee_table", label: "Coffee Table", weight: "light" },
        { id: "end_table", label: "End Table", weight: "light" },
    ],
    appliances: [
        { id: "fridge", label: "Refrigerator", weight: "heavy" },
        { id: "washer", label: "Washing Machine", weight: "heavy" },
        { id: "dryer", label: "Dryer", weight: "heavy" },
        { id: "dishwasher", label: "Dishwasher", weight: "heavy" },
        { id: "oven", label: "Oven / Stove", weight: "heavy" },
        { id: "microwave", label: "Microwave", weight: "light" },
        { id: "water_heater", label: "Water Heater", weight: "heavy" },
        { id: "ac_unit", label: "A/C Unit", weight: "medium" },
    ],
    electronics: [
        { id: "tv", label: "TV / Monitor", weight: "medium" },
        { id: "computer", label: "Computer / Laptop", weight: "light" },
        { id: "printer", label: "Printer / Scanner", weight: "light" },
        { id: "stereo", label: "Stereo / Speakers", weight: "medium" },
        { id: "cables_misc", label: "Cables & Misc", weight: "light" },
        { id: "gaming", label: "Gaming Equipment", weight: "light" },
    ],
    mattress: [
        { id: "king_mattress", label: "King Mattress", weight: "heavy" },
        { id: "queen_mattress", label: "Queen Mattress", weight: "heavy" },
        { id: "full_mattress", label: "Full Mattress", weight: "medium" },
        { id: "twin_mattress", label: "Twin Mattress", weight: "medium" },
        { id: "box_spring", label: "Box Spring", weight: "medium" },
        { id: "bed_frame", label: "Bed Frame", weight: "medium" },
    ],
};

export const VOLUME_OPTIONS: VolumeOption[] = [
    { id: "few", label: "1/8 Load", fraction: "1/8", desc: "A washer, dryer, refrigerator, mattress set, or 6-8 large boxes", truckFill: 0.125, comparison: "About 50.6 cu ft" },
    { id: "quarter", label: "Quarter Load", fraction: "1/4", desc: "A sofa and armchair, or a small dining set with a few boxes", truckFill: 0.25, comparison: "About 101.3 cu ft" },
    { id: "half", label: "Half Load", fraction: "1/2", desc: "A bedroom set plus 10-15 boxes or bags", truckFill: 0.5, comparison: "About 202.5 cu ft" },
    { id: "three_quarter", label: "3/4 Load", fraction: "3/4", desc: "A bedroom set plus a living room group with boxes", truckFill: 0.75, comparison: "About 303.8 cu ft" },
    { id: "full", label: "Full Load", fraction: "1", desc: "A typical packed single-car garage cleanout", truckFill: 1.0, comparison: "About 405 cu ft" },
    { id: "multi", label: "Multiple Loads", fraction: "1+", desc: "More than one full 15-yard dump-bed truck load", truckFill: 1.25, comparison: "More than a packed garage bay" },
];

export const LOCATION_OPTIONS: LocationOption[] = [
    { id: "curbside", label: "Curbside / Driveway", icon: "Home", desc: "Already outside, easy access" },
    { id: "garage", label: "Garage", icon: "Warehouse", desc: "Inside the garage" },
    { id: "ground_floor", label: "Ground Floor", icon: "Building2", desc: "First floor, no stairs" },
    { id: "upstairs", label: "Upstairs", icon: "ArrowUp", desc: "Second floor or higher" },
    { id: "basement", label: "Basement", icon: "ArrowDown", desc: "Below ground level" },
    { id: "backyard", label: "Backyard", icon: "TreePine", desc: "Behind the house" },
];

/* ── Load Estimate V2 Data ─────────────────────────────────────────── */

export type LoadTier = {
    volumeId: string;
    label: string;
    title: string;
    desc: string;
    bags: string;
    cuYd: number;
    fill: number;
    vehicle: "pickup" | "boxtruck" | "dumpbed";
    popular?: boolean;
};

export const LOAD_TIERS: LoadTier[] = [
    { volumeId: "few",           label: "1/8 Load",  title: "Single Large Appliance",       desc: "A washer, dryer, refrigerator, mattress set, or 6-8 large boxes.",                 bags: "~10 bags",  cuYd: 1.875, fill: 0.125, vehicle: "dumpbed" },
    { volumeId: "quarter",       label: "1/4 Load",  title: "Sofa + Armchair",              desc: "A sofa and armchair, or a small dining set with a few boxes.",                     bags: "~25 bags",  cuYd: 3.75,  fill: 0.25,  vehicle: "dumpbed", popular: true },
    { volumeId: "half",          label: "1/2 Load",  title: "Bedroom Set + Boxes",          desc: "A bedroom set plus 10-15 boxes or bags.",                                         bags: "~50 bags",  cuYd: 7.5,   fill: 0.50,  vehicle: "dumpbed" },
    { volumeId: "three_quarter", label: "3/4 Load",  title: "Bedroom + Living Room",        desc: "A bedroom set plus a living room group with boxes.",                              bags: "~75 bags",  cuYd: 11.25, fill: 0.75,  vehicle: "dumpbed" },
    { volumeId: "full",          label: "Full Load", title: "Garage Cleanout",              desc: "A typical packed single-car garage cleanout.",                                    bags: "~100 bags", cuYd: 15,    fill: 1.0,   vehicle: "dumpbed" },
    { volumeId: "multi",         label: "1+ Loads",  title: "More Than One Truck",           desc: "More than one full dump-bed truck. This should be confirmed on-site.",             bags: "100+ bags", cuYd: 15,    fill: 1.0,   vehicle: "dumpbed" },
];

export type EdgeCase = { id: string; label: string; detail: string };

export const EDGE_CASES: EdgeCase[] = [
    { id: "heavy",     label: "Extremely heavy or dense items",                  detail: "Concrete, dirt, mattress, hot tub" },
    { id: "specialty", label: "Appliances or E-waste",                           detail: "Refrigerators, freezer, T.V" },
    { id: "unknown",   label: "Junk is scattered everywhere / I have no idea",   detail: "" },
];

export const TIME_SLOTS: TimeSlot[] = [
    { id: "morning", label: "8:00 – 11:00 AM", period: "Morning", startHour: 8 },
    { id: "midday", label: "11:00 AM – 1:00 PM", period: "Midday", startHour: 11 },
    { id: "afternoon", label: "1:00 – 4:00 PM", period: "Afternoon", startHour: 13 },
];

/* ── Dumpster Rental Data ──────────────────────────────────────────────── */

export type ServiceType = "junk" | "dumpster" | "both";

export type ContainerSize = { id: string; label: string; yards: string; desc: string; goodFor: string; icon: string };
export type DebrisType = { id: string; label: string; icon: string };
export type RentalDuration = { id: string; label: string; desc: string };

export const CONTAINER_SIZES: ContainerSize[] = [
    { id: "10yd", label: "10 Yard", yards: "10 yd³", desc: "About 3 pickup truck loads", goodFor: "Bathroom remodel, small cleanout, garage declutter", icon: "Container" },
    { id: "20yd", label: "20 Yard", yards: "20 yd³", desc: "About 6 pickup truck loads", goodFor: "Single-room renovation, medium cleanout, roofing (up to 1,500 sq ft)", icon: "Container" },
    { id: "30yd", label: "30 Yard", yards: "30 yd³", desc: "About 9 pickup truck loads", goodFor: "Multi-room renovation, large estate cleanout, new construction debris", icon: "Container" },
    { id: "40yd", label: "40 Yard", yards: "40 yd³", desc: "About 12 pickup truck loads", goodFor: "Full house cleanout, major construction, commercial demolition", icon: "Warehouse" },
];

export const DEBRIS_TYPES: DebrisType[] = [
    { id: "construction", label: "Construction / Demolition", icon: "HardHat" },
    { id: "household", label: "Household Junk", icon: "Home" },
    { id: "yard_waste", label: "Yard Waste", icon: "TreePine" },
    { id: "roofing", label: "Roofing Materials", icon: "Building" },
    { id: "mixed", label: "Mixed / Not Sure", icon: "Package" },
];

export const RENTAL_DURATIONS: RentalDuration[] = [
    { id: "1_week", label: "About a week", desc: "3–7 day rental" },
    { id: "2_weeks", label: "About 2 weeks", desc: "8–14 day rental" },
    { id: "call_when_full", label: "Not sure — I'll call when it's full", desc: "Flexible timeline" },
];

/* ── Phase System ──────────────────────────────────────────────────────── */

export type WizardPhase =
    | "contact"
    | "service_type"
    | "load_estimate"
    | "dumpster_size"
    | "dumpster_details"
    | "schedule"
    | "quote";

const JUNK_PHASES: WizardPhase[] = ["load_estimate"];
const DUMPSTER_PHASES: WizardPhase[] = ["dumpster_size", "dumpster_details"];
const CLOSING_PHASES: WizardPhase[] = ["schedule", "quote"];

export function getPhases(serviceType: ServiceType | null, offersDumpster: boolean): WizardPhase[] {
    const base: WizardPhase[] = ["contact"];
    if (offersDumpster) base.push("service_type");
    if (!serviceType || serviceType === "junk") {
        return [...base, ...JUNK_PHASES, ...CLOSING_PHASES];
    }
    if (serviceType === "dumpster") {
        return [...base, ...DUMPSTER_PHASES, ...CLOSING_PHASES];
    }
    return [...base, ...JUNK_PHASES, ...DUMPSTER_PHASES, ...CLOSING_PHASES];
}

const PHASE_LABELS: Record<WizardPhase, string> = {
    contact: "Your Info",
    service_type: "Service Type",
    load_estimate: "Load & Access",
    dumpster_size: "Container Size",
    dumpster_details: "Rental Details",
    schedule: "Schedule",
    quote: "Quote & Book",
};

export function getPhaseLabel(phase: WizardPhase): string {
    return PHASE_LABELS[phase] || phase;
}

/* ── Business Hours Helpers ───────────────────────────────────────────── */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Parse the hour out of an "HH:MM" string.
 *
 * Total by construction: returns null for a missing field, a non-string, or an
 * unparseable value, so a caller can fail open to the full slot list instead of
 * throwing. The previous version called `.split(":")` unconditionally, which
 * threw on the `undefined` produced by the dashboard's `{open,close}` shape and
 * unmounted the booking form.
 */
function parseHour24(time: unknown): number | null {
    if (typeof time !== "string") return null;
    const h = Number.parseInt(time.split(":")[0], 10);
    return Number.isFinite(h) && h >= 0 && h <= 24 ? h : null;
}

export function isDayClosed(
    date: Date,
    businessHours: BusinessHoursConfig | null,
): boolean {
    if (!businessHours || Object.keys(businessHours).length === 0) return false;
    const dayKey = DAY_KEYS[date.getDay()];
    const dayHours = businessHours[dayKey];
    if (!dayHours) return false;
    return !!dayHours.closed;
}

export function getAvailableTimeSlots(
    date: Date,
    businessHours: BusinessHoursConfig | null,
): TimeSlot[] {
    if (!businessHours || Object.keys(businessHours).length === 0) return TIME_SLOTS;
    const dayKey = DAY_KEYS[date.getDay()];
    const dayHours = businessHours[dayKey];
    if (!dayHours) return TIME_SLOTS;
    if (dayHours.closed) return [];

    // `?? .open` / `?? .close` are a second line of defence: config normally
    // arrives already normalised from main.tsx, but these functions are exported
    // and could be handed a raw dashboard object.
    const openHour = parseHour24(dayHours.start ?? dayHours.open);
    const closeHour = parseHour24(dayHours.end ?? dayHours.close);

    // Unusable hours fail open to the default slots rather than showing the
    // customer an empty day. See the trade-off note in the remediation plan:
    // ingest performs no server-side hours validation, so an out-of-hours
    // booking is accepted — which still beats a form that renders nothing.
    if (openHour === null || closeHour === null) return TIME_SLOTS;

    return TIME_SLOTS.filter(
        (slot) => slot.startHour >= openHour && slot.startHour < closeHour,
    );
}

/* ── Service address composition ───────────────────────────────────────── */

/** Prefixes a customer might already have typed, so "Apt 4B" doesn't become "Unit Apt 4B". */
// Keep in step with website-template/lib/wizardData.ts and _UNIT_PREFIXES in
// phone-agent/agent/handlers.py. "building" was missing here, so a customer who
// typed "Building C" got "Unit Building C" on the web and plain "Building C" by
// phone — the same convention recorded two different ways.
const UNIT_PREFIXES = ["apt", "apartment", "unit", "ste", "suite", "#", "fl", "floor", "rm", "room", "bldg", "building", "lot", "trlr"];

/**
 * Fold an apartment/suite/unit value into a street address.
 *
 * Google's `formattedAddress` never carries a unit number, and selecting an
 * autocomplete suggestion overwrites whatever the customer typed — so before
 * this existed, someone in apartment 4B could not have both a *confirmed*
 * address and their unit number. The unit is captured in its own field (which
 * deliberately never touches `addressConfirmed`) and folded in here.
 *
 * The unit goes before the first comma, which is where a US address expects it:
 *   "1234 Main St, Springfield, IL 62704"
 *   → "1234 Main St Unit 4B, Springfield, IL 62704"
 *
 * Keep this identical in website-template/lib/wizardData.ts and
 * booking-widget/src/lib/wizardData.ts.
 */
export function composeAddress(address: string | null | undefined, unit?: string | null): string {
    const street = (address ?? "").trim();
    const clean = (unit ?? "").trim();
    if (!clean) return street;

    const hasPrefix = UNIT_PREFIXES.some((p) => clean.toLowerCase().startsWith(p));
    const suffix = hasPrefix ? clean : `Unit ${clean}`;

    // Customer typed the unit into the address box as well — don't repeat it.
    if (street.toLowerCase().includes(suffix.toLowerCase())) return street;

    const comma = street.indexOf(",");
    if (comma === -1) return `${street} ${suffix}`.trim();
    return `${street.slice(0, comma)} ${suffix}${street.slice(comma)}`;
}

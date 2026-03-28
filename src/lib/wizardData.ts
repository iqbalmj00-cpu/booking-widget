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
    { id: "few", label: "A Few Items", fraction: "1/8", desc: "A few small items — fits in a pickup bed", truckFill: 0.125, comparison: "About half a pickup truck bed" },
    { id: "quarter", label: "Quarter Load", fraction: "1/4", desc: "Small pile — a corner of the truck", truckFill: 0.25, comparison: "About 1 pickup truck bed" },
    { id: "half", label: "Half Load", fraction: "1/2", desc: "Medium pile — half the truck bed", truckFill: 0.5, comparison: "About 2 pickup truck beds" },
    { id: "three_quarter", label: "3/4 Load", fraction: "3/4", desc: "Large pile — most of the truck", truckFill: 0.75, comparison: "About 3 pickup truck beds" },
    { id: "full", label: "Full Load", fraction: "1", desc: "Filling the entire truck", truckFill: 1.0, comparison: "About 4 pickup truck beds" },
    { id: "multi", label: "Multiple Loads", fraction: "1+", desc: "More than one full truck load", truckFill: 1.25, comparison: "More than 4 pickup truck beds" },
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
    vehicle: "pickup" | "boxtruck";
    popular?: boolean;
};

export const LOAD_TIERS: LoadTier[] = [
    { volumeId: "few",           label: "⅛ Load",    title: "1–2 Large Items",          desc: "A fridge and a couch, or about 10 trash bags",                                bags: "~10 bags",  cuYd: 2,  fill: 0.125, vehicle: "pickup" },
    { volumeId: "quarter",       label: "¼ Load",    title: "Pickup Truck Load",        desc: "Level with the bed of a standard F-150, or about 25–30 trash bags",              bags: "~30 bags",  cuYd: 5,  fill: 0.25, vehicle: "pickup", popular: true },
    { volumeId: "half",          label: "½ Load",    title: "Small 1-Car Garage",        desc: "Roughly 1 parking space worth of junk, or about 40–50 trash bags",                bags: "~50 bags",  cuYd: 8,  fill: 0.50, vehicle: "boxtruck" },
    { volumeId: "three_quarter", label: "¾ Load",    title: "Large 1-Car Garage",        desc: "A 1-car garage filled waist-high, or about 60–75 trash bags",                     bags: "~75 bags",  cuYd: 12, fill: 0.75, vehicle: "boxtruck" },
    { volumeId: "full",          label: "Full Load", title: "Full Truck Load",           desc: "A 2-car garage filled waist-high, or about 80–100 trash bags",                    bags: "~100 bags", cuYd: 16, fill: 1.0, vehicle: "boxtruck" },
    { volumeId: "multi",         label: "1+ Loads",  title: "Multi-Load / Full House",   desc: "Estate cleanout, hoarder job — may require multiple trips. 100+ trash bags.",     bags: "100+ bags", cuYd: 20, fill: 1.0, vehicle: "boxtruck" },
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
    | "junk_location"
    | "dumpster_size"
    | "dumpster_details"
    | "schedule"
    | "terms"
    | "quote";

const JUNK_PHASES: WizardPhase[] = ["load_estimate", "junk_location"];
const DUMPSTER_PHASES: WizardPhase[] = ["dumpster_size", "dumpster_details"];
const CLOSING_PHASES: WizardPhase[] = ["schedule", "terms", "quote"];

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
    load_estimate: "Load Estimate",
    junk_location: "Location",
    dumpster_size: "Container Size",
    dumpster_details: "Rental Details",
    schedule: "Schedule",
    terms: "Terms & Sign",
    quote: "Quote & Book",
};

export function getPhaseLabel(phase: WizardPhase): string {
    return PHASE_LABELS[phase] || phase;
}

/* ── Business Hours Helpers ───────────────────────────────────────────── */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseHour24(time: string): number {
    const [h] = time.split(":").map(Number);
    return h;
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

    const openHour = parseHour24(dayHours.start);
    const closeHour = parseHour24(dayHours.end);

    return TIME_SLOTS.filter(
        (slot) => slot.startHour >= openHour && slot.startHour < closeHour,
    );
}

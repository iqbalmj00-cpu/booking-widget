/** Pure client rules. Response fields below are limited to the current intake contract. */
export type CompanyMode = "junk_removal" | "dumpster_rental" | "both";
export type BookingService = "junk" | "dumpster" | "both";
export function companyMode(value: unknown, offersDumpsterRental: boolean): CompanyMode {
    return value === "junk_removal" || value === "dumpster_rental" || value === "both"
        ? value : offersDumpsterRental ? "both" : "junk_removal";
}
export function allowedService(service: unknown, mode: CompanyMode): BookingService | null {
    if (mode === "junk_removal") return "junk";
    if (mode === "dumpster_rental") return "dumpster";
    return service === "junk" || service === "dumpster" || service === "both" ? service : null;
}
export function calendarDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function restoreCalendarDate(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    // Accept old ISO sessions once, then persist as a calendar date.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
export function reconcileStep(phases: readonly string[], index: unknown, phase?: unknown, oldFlow?: unknown): number {
    if (typeof phase === "string" && phases.includes(phase)) return phases.indexOf(phase);
    if (oldFlow && oldFlow !== phases.join("|")) return Math.max(0, phases.indexOf("service_type"));
    return typeof index === "number" && Number.isInteger(index) ? Math.max(0, Math.min(phases.length - 1, index)) : 0;
}
export function validSlotSelection(input: {
    date: string | null; today: string; time: string | null; loadedDate: string | null;
    loading: boolean; closed: boolean; slots: readonly { id: string; disabled?: boolean }[];
    rental: boolean; availability: string; availabilityCurrent: boolean;
}): boolean {
    return !!input.date && input.date >= input.today && !input.closed && !input.loading
        && input.loadedDate === input.date && input.slots.some(slot => slot.id === input.time && !slot.disabled)
        && (!input.rental || (input.availabilityCurrent && ["available", "error"].includes(input.availability)));
}
export type SameDayPricing = { surchargeType?: string; surchargeAmount?: number | null };
/** Display only: submit the original base so intake applies the fee exactly once. */
export function sameDayTotal(base: number, date: string | null, timezone: string, settings?: SameDayPricing | null, now = new Date()): number {
    if (!date || !settings?.surchargeAmount || settings.surchargeAmount <= 0) return base;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    if (date !== today) return base;
    return addSameDayFee(base, settings);
}
export function addSameDayFee(base: number, settings: SameDayPricing): number {
    const amount = settings.surchargeAmount ?? 0;
    if (!Number.isFinite(amount) || amount <= 0) return base;
    const fee = settings.surchargeType === "percentage" ? Math.round(base * (amount / 100) * 100) / 100 : amount;
    return Math.round((base + fee) * 100) / 100;
}
export type IntakeAcknowledgement = { success?: boolean; rejected?: boolean; leadId?: string; autoBooked?: boolean; error?: string; message?: string };
export function acknowledgedRequest(data: IntakeAcknowledgement | null | undefined): boolean {
    return !!data && data.success === true && data.rejected !== true && typeof data.leadId === "string" && data.leadId.length > 0;
}

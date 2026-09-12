/** Configured quote terms and saved receipt terms share formatting, never defaults. */
export type RentalTerms = {
    sizeCuYd: number | null;
    rentalDays: number | null;
    includedDays: number | null;
    weightAllowanceTons: number | null;
    overageRatePerTon: number | null;
    extendedDailyRate: number | null;
};

const amount = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const days = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;

export function readRentalTerms(value: unknown): RentalTerms {
    const v = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
        sizeCuYd: days(v.sizeCuYd), rentalDays: days(v.rentalDays), includedDays: days(v.includedDays),
        weightAllowanceTons: amount(v.weightAllowanceTons), overageRatePerTon: amount(v.overageRatePerTon),
        extendedDailyRate: amount(v.extendedDailyRate),
    };
}

/** These IDs already resolve to exactly 7/14 days at intake. Flexible stays have no fixed length. */
export function rentalDaysForSelection(value: string | null): number | null {
    return value === "1_week" ? 7 : value === "2_weeks" ? 14 : null;
}

export function rentalMoney(value: number): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** Extensions are billed later from actual time retained; they do not change the upfront base. */
export function rentalExtensionEstimate(terms: RentalTerms): { extraDays: number; amount: number } | null {
    if (terms.rentalDays == null || terms.includedDays == null || terms.extendedDailyRate == null) return null;
    const extraDays = Math.max(0, terms.rentalDays - terms.includedDays);
    const cost = extraDays * terms.extendedDailyRate;
    if (!Number.isFinite(cost)) return null;
    return { extraDays, amount: Math.round((cost + Number.EPSILON) * 100) / 100 };
}

export function rentalInclusionLines(terms: RentalTerms): string[] {
    return [
        terms.includedDays != null ? `${terms.includedDays} days included in the base rental` : "Included rental period needs confirmation",
        terms.weightAllowanceTons != null ? `${terms.weightAllowanceTons} ${terms.weightAllowanceTons === 1 ? "ton" : "tons"} included` : "Included weight needs confirmation",
        terms.overageRatePerTon != null
        ? `${rentalMoney(terms.overageRatePerTon)}/ton for weight above the included allowance`
        : "Weight overage rate needs confirmation",
    ];
}

export function rentalTermsLines(terms: RentalTerms): string[] {
    const lines: string[] = [];
    if (terms.sizeCuYd != null) lines.push(`${terms.sizeCuYd}-yard container`);
    if (terms.rentalDays != null) lines.push(`Rental period: ${terms.rentalDays} days`);
    lines.push(...rentalInclusionLines(terms));
    lines.push(terms.extendedDailyRate != null
        ? `${rentalMoney(terms.extendedDailyRate)}/day beyond the included rental period`
        : "Extra-day rate needs confirmation");
    const extension = rentalExtensionEstimate(terms);
    if (extension && extension.extraDays > 0) {
        lines.push(`Estimated later extra-day charge for ${terms.rentalDays} days: ${rentalMoney(extension.amount)} (${extension.extraDays} extra days). Not included in the base rental price.`);
        lines.push("Final extra-day charges depend on how long you keep the container after delivery.");
    } else if (terms.rentalDays != null && terms.includedDays != null && terms.rentalDays > terms.includedDays) {
        lines.push("The selected rental period exceeds the included days. Its extra-day charge needs confirmation.");
    }
    return lines;
}

/** A current availability response carries the same resolved tier base as rental acceptance. */
export function rentalQuoteBase(tier: { baseRate: number; baseRateMin?: number | null } | undefined,
    availability: { baseRate?: number | null } | null): number | null {
    const value = availability && Object.prototype.hasOwnProperty.call(availability, "baseRate")
        ? availability.baseRate : tier?.baseRateMin ?? tier?.baseRate;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Acceptance rounds the discount first, caps it, then subtracts it from base + fee. */
export function rentalQuoteSubtotal(before: number, promo?: { discountType?: string; discountValue?: number } | null): number {
    const raw = promo?.discountType === "percentage" ? before * (promo.discountValue ?? 0) / 100
        : promo?.discountType === "flat" ? promo.discountValue ?? 0 : 0;
    const discount = Number.isFinite(raw) ? Math.min(before, Math.max(0, Math.round(raw * 100) / 100)) : 0;
    return Math.round((before - discount) * 100) / 100;
}

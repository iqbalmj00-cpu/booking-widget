/**
 * Phase 5 (P5.2 / P5.3 / P5.4 / P5.5): the pure decisions behind promo
 * display, container availability, card-on-file confirmation and the
 * dumpster note on a combined booking, plus Phase 6's multi-truckload
 * reporting (D24) and phone validation.
 *
 * Run with: npm test
 *
 * Keep identical to website-template/lib/__tests__/bookingLogic.test.ts.
 */

import assert from "assert";
import {
    promoAppliesToService,
    promoAppliesToBooking,
    applyPromoDiscount,
    formatPriceAmount,
    classifyAvailabilityResponse,
    availabilityBlocksBooking,
    classifyCardConfirmation,
    mergeCardConfirmations,
    cardConfirmationNotice,
    deriveDumpsterNote,
    describeLoadSize,
    describeEdgeCaseNote,
    validatePhone,
    MULTI_LOAD_TIER_LABEL,
    MULTI_LOAD_TRUCK_FRACTION,
    isStaleLeadResponse,
    bookingSubmitErrorMessage,
} from "../bookingLogic";

/* ── P5.4 promo applicability ─────────────────────────────────────── */

assert.strictEqual(promoAppliesToService("both", "junk"), true);
assert.strictEqual(promoAppliesToService("both", "dumpster"), true);
assert.strictEqual(promoAppliesToService("junk", "junk"), true);
assert.strictEqual(promoAppliesToService("dumpster", "dumpster"), true);

// The bug this closes: a junk-only code claimed a discount on a dumpster
// booking, where the dashboard grants none.
assert.strictEqual(promoAppliesToService("junk", "dumpster"), false);
assert.strictEqual(promoAppliesToService("dumpster", "junk"), false);

// An unknown scope is not a scope we recognise — do not claim it applies.
assert.strictEqual(promoAppliesToService("commercial_only", "junk"), false);

// A dashboard that omits appliesTo tells us nothing; assume the discount is
// real rather than hiding one the dashboard will actually grant.
assert.strictEqual(promoAppliesToService(undefined, "junk"), true);
assert.strictEqual(promoAppliesToService(null, "dumpster"), true);
assert.strictEqual(promoAppliesToService("", "dumpster"), true);

// Booking-level banner: a code discounting either leg of a "both" booking
// still earns the badge, and gating happens per price line.
assert.strictEqual(promoAppliesToBooking("junk", "both"), true);
assert.strictEqual(promoAppliesToBooking("dumpster", "both"), true);
assert.strictEqual(promoAppliesToBooking("both", "both"), true);
assert.strictEqual(promoAppliesToBooking("junk", "dumpster"), false);
assert.strictEqual(promoAppliesToBooking("dumpster", "junk"), false);
assert.strictEqual(promoAppliesToBooking("junk", null), true, "no service chosen yet defaults to the junk flow");

/* ── The price shown is the price billed ──────────────────────────── */

// The dashboard's arithmetic, transcribed from convert-lead-to-job.ts (junk)
// and auto-approve-rental.ts (rentals), which already agree with each other.
// Comparing against these catches the wizard drifting away from it again.
const dashboardPercent = (value: number, discount: number) =>
    Math.round(value * (1 - discount / 100) * 100) / 100;
const dashboardFlat = (value: number, discount: number) =>
    Math.max(0, Math.round((value - discount) * 100) / 100);

for (const price of [0, 75, 149, 275, 350, 467.5, 550, 1234.56]) {
    for (const discount of [1, 5, 10, 12.5, 15, 20, 33, 50, 100]) {
        assert.strictEqual(
            applyPromoDiscount(price, "percentage", discount),
            dashboardPercent(price, discount),
            `${discount}% off $${price}`,
        );
        assert.strictEqual(
            applyPromoDiscount(price, "flat", discount),
            dashboardFlat(price, discount),
            `$${discount} off $${price}`,
        );
    }
}

// Pinned, so the same wrong formula copied into both places is still caught.
// The reported case first: roundTo5 displayed $300 on the $350 quote the
// dashboard books at $297.50.
assert.strictEqual(applyPromoDiscount(350, "percentage", 15), 297.5);
assert.strictEqual(applyPromoDiscount(550, "percentage", 15), 467.5);
assert.strictEqual(applyPromoDiscount(275, "percentage", 10), 247.5);
assert.strictEqual(applyPromoDiscount(149, "percentage", 20), 119.2);
assert.strictEqual(applyPromoDiscount(350, "flat", 50), 300);
assert.strictEqual(applyPromoDiscount(40, "flat", 50), 0, "a flat code worth more than the job floors at $0");

// Nothing to apply, or a type neither side recognises: the price is untouched.
assert.strictEqual(applyPromoDiscount(350, "percentage", 0), 350);
assert.strictEqual(applyPromoDiscount(350, "percentage", undefined), 350);
assert.strictEqual(applyPromoDiscount(350, "flat", null), 350);
assert.strictEqual(applyPromoDiscount(350, "buy_one_get_one", 15), 350);
assert.strictEqual(applyPromoDiscount(350, undefined, 15), 350);

// Cents only when there are cents, so an undiscounted price reads as it always
// has and only the discounted figure grows a ".50".
assert.strictEqual(formatPriceAmount(300), "300");
assert.strictEqual(formatPriceAmount(0), "0");
assert.strictEqual(formatPriceAmount(297.5), "297.50");
assert.strictEqual(formatPriceAmount(119.2), "119.20");

// One booking, one price. The quote step and the confirmation page start from
// the same pre-discount endpoints and pass them through this pair, so the pair
// is the only thing between them. A $350 – $550 quote at 15% used to read
// "$300 – $470" on both while the dashboard booked $297.50 – $467.50.
const shown = (price: number) => `$${formatPriceAmount(applyPromoDiscount(price, "percentage", 15))}`;
assert.strictEqual(`${shown(350)} – ${shown(550)}`, "$297.50 – $467.50");

/* ── P5.3 availability states ─────────────────────────────────────── */

assert.strictEqual(classifyAvailabilityResponse(true, { available: true }), "available");
assert.strictEqual(classifyAvailabilityResponse(true, { available: false }), "unavailable");

// The regression: a non-200 error body used to land as `available: undefined`,
// which the Continue gate read as "not unavailable" and the banner read as
// "unavailable" — the customer saw a red banner above an enabled button.
assert.strictEqual(classifyAvailabilityResponse(false, { error: "Too many requests. Try again later." }), "error");
assert.strictEqual(classifyAvailabilityResponse(false, { error: "size parameter is required" }), "error");
assert.strictEqual(classifyAvailabilityResponse(true, {}), "error", "200 with no verdict is a failed check, not a refusal");
assert.strictEqual(classifyAvailabilityResponse(true, null), "error");
assert.strictEqual(classifyAvailabilityResponse(true, { available: "yes" }), "error", "only a real boolean is a verdict");

// Only a genuine refusal blocks. Allowing on error can never override a real
// "no", because the dashboard reports the two differently.
assert.strictEqual(availabilityBlocksBooking("unavailable"), true);
assert.strictEqual(availabilityBlocksBooking("error"), false);
assert.strictEqual(availabilityBlocksBooking("available"), false);
assert.strictEqual(availabilityBlocksBooking("checking"), false);
assert.strictEqual(availabilityBlocksBooking("idle"), false);

/* ── P5.2 card confirmation outcomes ──────────────────────────────── */

assert.strictEqual(classifyCardConfirmation(true, 200), "saved");

// 409 lands before Stripe is touched: the new card is dropped and the card
// already on file stays the default. Saying "saved" there was a lie.
assert.strictEqual(classifyCardConfirmation(false, 409, "card_already_on_file"), "already_on_file");
assert.strictEqual(classifyCardConfirmation(false, 409), "already_on_file");

// The business has no connected Stripe account — nothing the customer can do.
assert.strictEqual(
    classifyCardConfirmation(false, 422, "This business isn't set up to take card payments yet."),
    "not_saved_unactionable",
);

// The remaining 422s are card problems, and 429 is the 10/IP/hour limit.
assert.strictEqual(classifyCardConfirmation(false, 422, "Failed to save card. Please try again."), "not_saved_actionable");
assert.strictEqual(classifyCardConfirmation(false, 422, "Only cards can be saved as card on file"), "not_saved_actionable");
assert.strictEqual(classifyCardConfirmation(false, 429, "Too many requests. Try again later."), "not_saved_actionable");

// Nothing the customer can act on.
assert.strictEqual(classifyCardConfirmation(false, 403, "payment_method_not_recognized"), "not_saved_unactionable");
assert.strictEqual(classifyCardConfirmation(false, 401, "Invalid site token"), "not_saved_unactionable");
assert.strictEqual(classifyCardConfirmation(false, 404, "Customer not found"), "not_saved_unactionable");
assert.strictEqual(classifyCardConfirmation(false, 400, "customerId and paymentMethodId are required"), "not_saved_unactionable");
assert.strictEqual(classifyCardConfirmation(false, 500, "Internal server error"), "not_saved_unactionable");
assert.strictEqual(classifyCardConfirmation(false, 0, null), "not_saved_unactionable", "a network throw has no status");

// A combined booking confirms the same card twice; the second call is answered
// 409. The customer must still be told their card saved.
assert.strictEqual(mergeCardConfirmations("saved", "already_on_file"), "saved");
assert.strictEqual(mergeCardConfirmations("already_on_file", "saved"), "saved");
assert.strictEqual(mergeCardConfirmations("saved", "not_saved_unactionable"), "saved");
assert.strictEqual(mergeCardConfirmations("already_on_file", "not_saved_actionable"), "already_on_file",
    "a card already on file still beats no card at all");
assert.strictEqual(mergeCardConfirmations("not_saved_unactionable", "not_saved_actionable"), "not_saved_actionable");
assert.strictEqual(mergeCardConfirmations("already_on_file", "already_on_file"), "already_on_file");
// A leg that never ran contributes nothing.
assert.strictEqual(mergeCardConfirmations(null, "saved"), "saved");
assert.strictEqual(mergeCardConfirmations("not_saved_actionable", null), "not_saved_actionable");
assert.strictEqual(mergeCardConfirmations(null, null), null);

// Only success is silent, and every other branch says the booking still stands.
assert.strictEqual(cardConfirmationNotice("saved"), null);
for (const outcome of ["already_on_file", "not_saved_actionable", "not_saved_unactionable", "not_saved_pending_approval"] as const) {
    const notice = cardConfirmationNotice(outcome) ?? "";
    assert.ok(notice.length > 0, `${outcome} must say something`);
    assert.ok(!/fail|error|problem/i.test(notice), `${outcome} must not read as an alarm: ${notice}`);
}
assert.ok(
    cardConfirmationNotice("not_saved_actionable")!.includes("nothing has been charged"),
    "a card that did not save was never charged — say so",
);
assert.ok(
    cardConfirmationNotice("already_on_file")!.includes("kept it"),
    "the customer needs to know which card survived",
);

/* ── P5.5 dumpster note on a combined booking ─────────────────────── */

assert.strictEqual(
    deriveDumpsterNote({ serviceType: "both", autoBooked: false, dumpsterError: "" }),
    "We'll confirm dumpster availability and reach out shortly.",
);

// The regression: the dumpster leg failed, so no request exists to confirm.
assert.strictEqual(
    deriveDumpsterNote({ serviceType: "both", autoBooked: false, dumpsterError: "Network request failed" }),
    "We couldn't confirm your dumpster automatically. Our team will follow up about your rental shortly.",
);
assert.strictEqual(
    deriveDumpsterNote({ serviceType: "both", autoBooked: false, dumpsterError: "Rental request failed" }),
    "We couldn't confirm your dumpster automatically. Our team will follow up about your rental shortly.",
);

// Nothing to add once the dumpster is actually booked.
assert.strictEqual(deriveDumpsterNote({ serviceType: "both", autoBooked: true, dumpsterError: "" }), null);
// Dumpster-only: the closing line already promises a callback.
assert.strictEqual(deriveDumpsterNote({ serviceType: "dumpster", autoBooked: false, dumpsterError: "" }), null);
assert.strictEqual(deriveDumpsterNote({ serviceType: "dumpster", autoBooked: true, dumpsterError: "" }), null);
// Junk-only never has a dumpster leg.
assert.strictEqual(deriveDumpsterNote({ serviceType: "junk", autoBooked: false, dumpsterError: "" }), null);

/* ── P6 more than one truck load (D24) ────────────────────────────── */

// Ordinary load: whatever the slider says goes through untouched.
assert.deepStrictEqual(
    describeLoadSize({ multiTruckLoad: false, tierTitle: "Sofa + Armchair", truckFraction: "1/4" }),
    { loadTier: "Sofa + Armchair", truckLoad: "1/4" },
);

// The bug this closes: OR-ing the checkbox into isOnSiteEstimate alone left
// dispatch reading "Sofa + Armchair" / "1/4" for a job needing two trips.
assert.deepStrictEqual(
    describeLoadSize({ multiTruckLoad: true, tierTitle: "Sofa + Armchair", truckFraction: "1/4" }),
    { loadTier: MULTI_LOAD_TIER_LABEL, truckLoad: MULTI_LOAD_TRUCK_FRACTION },
);
// True from the top tier too — "Garage Cleanout" is still one truck.
assert.deepStrictEqual(
    describeLoadSize({ multiTruckLoad: true, tierTitle: "Garage Cleanout", truckFraction: "1" }),
    { loadTier: MULTI_LOAD_TIER_LABEL, truckLoad: MULTI_LOAD_TRUCK_FRACTION },
);
assert.ok(!/1\/4|Sofa/.test(MULTI_LOAD_TIER_LABEL + MULTI_LOAD_TRUCK_FRACTION));

// Nothing flagged at all: no note.
assert.strictEqual(
    describeEdgeCaseNote({ multiTruckLoad: false, unsureOfLoad: false, flaggedIds: [] }),
    "",
);
// Flagged but priceable — the old "Flagged: …" line, unchanged.
assert.strictEqual(
    describeEdgeCaseNote({ multiTruckLoad: false, unsureOfLoad: false, flaggedIds: ["heavy", "specialty"] }),
    "Flagged: heavy, specialty",
);
// The existing checkbox keeps its exact wording.
assert.strictEqual(
    describeEdgeCaseNote({ multiTruckLoad: false, unsureOfLoad: true, flaggedIds: ["unknown"] }),
    "On-site estimate — customer unsure of load",
);
// The regression: a customer who knows the answer must not be reported unsure.
assert.strictEqual(
    describeEdgeCaseNote({ multiTruckLoad: true, unsureOfLoad: false, flaggedIds: ["multi_load"] }),
    "On-site estimate — more than one truck load",
);
// Both can be true, and neither implies the other.
assert.strictEqual(
    describeEdgeCaseNote({ multiTruckLoad: true, unsureOfLoad: true, flaggedIds: ["unknown", "multi_load"] }),
    "On-site estimate — more than one truck load; customer unsure of load",
);
// A multi-truckload note never claims the customer was unsure.
assert.ok(
    !describeEdgeCaseNote({ multiTruckLoad: true, unsureOfLoad: false, flaggedIds: ["multi_load"] })
        .includes("unsure"),
);

/* ── P6 phone validation ──────────────────────────────────────────── */

// The bug this closes: any non-empty value passed the Continue gate.
assert.strictEqual(validatePhone("5").valid, false);
assert.strictEqual(validatePhone("555").valid, false);
assert.strictEqual(validatePhone("(415) 555-123").valid, false);
// An untouched field is invalid but silent.
assert.deepStrictEqual(validatePhone(""), { valid: false, error: "" });
assert.ok(validatePhone("415555").error.length > 0, "a half-typed number says why");

// Structural NANP rules — neither the area code nor the exchange may start 0/1.
assert.strictEqual(validatePhone("(015) 234-5678").valid, false);
assert.strictEqual(validatePhone("(115) 234-5678").valid, false);
assert.strictEqual(validatePhone("(415) 015-5678").valid, false);
assert.strictEqual(validatePhone("(415) 123-5678").valid, false);
// The field's own placeholder is not a phone number.
assert.strictEqual(validatePhone("(555) 123-4567").valid, false);

// Real numbers pass, however they are punctuated.
assert.deepStrictEqual(validatePhone("(415) 234-5678"), { valid: true, error: "" });
assert.strictEqual(validatePhone("4152345678").valid, true);
assert.strictEqual(validatePhone("415.234.5678").valid, true);
assert.strictEqual(validatePhone("  (415) 234-5678  ").valid, true);
// Same shape as validateEmail's result, so the input can render it the same way.
assert.strictEqual(validatePhone("(415) 234-5678").error, "");

/* ── D25 stale lead id ────────────────────────────────────────────── */

// 404 is the only status the booking endpoint uses for a lead it cannot
// find, and it answers it before writing anything — so this one is safe to
// post again without the id.
assert.strictEqual(isStaleLeadResponse(404, true), true);

// A 404 on a request that carried no id is a routing failure. Reposting the
// identical body would fail identically.
assert.strictEqual(isStaleLeadResponse(404, false), false);

// Nothing else is ever repeated: a capacity refusal, a validation refusal, a
// rate limit and a server fault all stand as answers, and 0 is a network
// throw with no status at all.
assert.strictEqual(isStaleLeadResponse(409, true), false);
assert.strictEqual(isStaleLeadResponse(400, true), false);
assert.strictEqual(isStaleLeadResponse(429, true), false);
assert.strictEqual(isStaleLeadResponse(500, true), false);
assert.strictEqual(isStaleLeadResponse(0, true), false);
assert.strictEqual(isStaleLeadResponse(200, true), false);

/* ── D25 what a failed submit says ────────────────────────────────── */

const GENERIC = bookingSubmitErrorMessage("Lead not found");

// The bug this closes: a customer at the last step of a booking was shown
// the words "Lead not found".
assert.ok(!GENERIC.includes("Lead not found"), `raw server text reached the customer: ${GENERIC}`);
assert.ok(GENERIC.length > 0);
assert.ok(!/\b(error|failed|invalid|null|undefined|500|404)\b/i.test(GENERIC), `reads like a log line: ${GENERIC}`);

// Every other string this endpoint and its proxy can return is written for
// whoever reads the logs.
for (const raw of [
    "Validation failed",
    "Invalid requestedDate",
    "Internal server error",
    "Server misconfiguration",
    "CRM error",
    "Bad request",
    "Invalid site token",
]) {
    assert.strictEqual(bookingSubmitErrorMessage(raw), GENERIC, `${raw} must not reach the customer`);
}

// A body with no usable error — a 409 capacity refusal carries none, and an
// unparseable body leaves an empty object behind.
assert.strictEqual(bookingSubmitErrorMessage(undefined), GENERIC);
assert.strictEqual(bookingSubmitErrorMessage(null), GENERIC);
assert.strictEqual(bookingSubmitErrorMessage(""), GENERIC);
assert.strictEqual(bookingSubmitErrorMessage("   "), GENERIC);
assert.strictEqual(bookingSubmitErrorMessage({ message: "nope" }), GENERIC, "only a string can be a message");

// The exception: same-day refusals are written for the customer and are
// actionable. Flattening them would have the customer retry until midnight.
for (const raw of [
    "Same-day bookings are not available for this business",
    "Same-day booking cutoff has passed for today",
    "Same-day bookings require at least 120 minutes of notice",
]) {
    assert.strictEqual(bookingSubmitErrorMessage(raw), raw, `${raw} is worth keeping`);
}

/* ── D26 a card taken but never confirmed ─────────────────────────── */

// A dumpster rental the dashboard cannot auto-approve returns no customerId,
// so confirm-card is never called and nothing is attached or charged.
const pending = cardConfirmationNotice("not_saved_pending_approval")!;
assert.ok(pending.includes("charged"), "the customer was promised a charge on confirmation — answer it");
assert.ok(!/\bsaved\b/i.test(pending), `must not claim a card was saved: ${pending}`);
assert.ok(!/\b(confirmed|booked)\b/i.test(pending), `the page above already names the booking: ${pending}`);

// It stands alone, and loses to every outcome an actual confirm-card call
// produced — including a card that saved on the junk leg of a "both"
// booking, where the card really is on file and really will be charged.
assert.strictEqual(mergeCardConfirmations(null, "not_saved_pending_approval"), "not_saved_pending_approval");
assert.strictEqual(mergeCardConfirmations("saved", "not_saved_pending_approval"), "saved");
assert.strictEqual(mergeCardConfirmations("not_saved_pending_approval", "saved"), "saved");
assert.strictEqual(mergeCardConfirmations("already_on_file", "not_saved_pending_approval"), "already_on_file");
assert.strictEqual(mergeCardConfirmations("not_saved_actionable", "not_saved_pending_approval"), "not_saved_actionable");
assert.strictEqual(mergeCardConfirmations("not_saved_unactionable", "not_saved_pending_approval"), "not_saved_unactionable");
assert.strictEqual(
    mergeCardConfirmations("not_saved_pending_approval", "not_saved_pending_approval"),
    "not_saved_pending_approval",
);

console.log("bookingLogic: all assertions passed");

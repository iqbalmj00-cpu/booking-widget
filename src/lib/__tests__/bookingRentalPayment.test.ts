import assert from "assert";
const equal = assert.strictEqual, deepEqual = assert.deepStrictEqual, notEqual = assert.notStrictEqual;
async function rejects(promise: Promise<unknown>) { let rejected = false; try { await promise; } catch { rejected = true; } assert.ok(rejected, "Expected refusal"); }
import { readOutcome, readSavedOutcomes, restoreIntent, saveIntent } from "../bookingIntent";
import { parseBookingConfirmation } from "../bookingConfirmation";
import { readRentalCardGrant, newRentalPaymentRecovery, readRentalPaymentRecovery, readRentalPaymentCommand, runRentalPaymentCommand,
    type RentalPaymentRecovery, type RentalPaymentCommand } from "../bookingRentalPayment";
const grant = { status: "available" as const, rentalId: "r1", expiresAt: "2035-01-01T00:00:00.000Z", grant: "eyJhbGciOiJIUzI1NiJ9.eyJmaXh0dXJlIjp0cnVlfQ.signature" };
const quote = { rentalId: "r1", rentalNumber: 1, address: "10 Fixture Street", subtotalCents: 10000, taxRate: 10, taxCents: 1000, totalCents: 11000, paidCents: 1000, depositCents: 500, amountCents: 9500, currency: "usd" };
const review = { mode: "selected_rental", quote, reviewToken: grant.grant, expiresAt: grant.expiresAt, stripeAccountId: "acct_fixture", payment: { status: "not_requested", amountCents: 9500 } };
const setup = { mode: "selected_rental", setupIntentId: "seti_fixture", receiptId: `pcs_${"a".repeat(64)}`, stripeAccountId: "acct_fixture", clientSecret: "seti_fixture_secret_never_store", payment: { status: "not_requested" } };
const outcome = { contractVersion: 2, service: "dumpster", outcome: "scheduled", success: true, leadId: "lead1", jobId: "job1", rentalId: "r1", customerId: "customer1", rentalCard: grant };
async function main() {
    deepEqual(readRentalCardGrant(grant, "r1"), grant);
    for (const malformed of [{ ...grant, rentalId: "other" }, { ...grant, expiresAt: "tomorrow" }, { ...grant, grant: "bad" }, { ...grant, clientSecret: "secret" }]) equal(readRentalCardGrant(malformed, "r1"), undefined);
    const ack = readOutcome({ status: 200, data: outcome }, "dumpster");
    deepEqual(ack.rentalCard, grant);
    deepEqual(readSavedOutcomes({ dumpster: ack }).dumpster?.rentalCard, grant);
    equal(readOutcome({ status: 200, data: { ...outcome, outcome: "pending_approval" } }, "dumpster").rentalCard, undefined);
    equal(readOutcome({ status: 200, data: outcome }, "junk").rentalCard, undefined);
    let state = newRentalPaymentRecovery(grant)!;
    let dispatches = 0;
    const persist = (s: RentalPaymentRecovery) => { state = JSON.parse(JSON.stringify(s)); return true; };
    const calls: RentalPaymentCommand[] = [];
    const send = async (c: RentalPaymentCommand) => { dispatches++; calls.push(c); notEqual(state.stage, "idle"); return c.action === "review" ? review : c.action === "setup" ? setup : { mode: "selected_rental", rentalId: "r1", quote, receiptId: setup.receiptId, card: { status: "saved" }, payment: { status: "applied", operationId: "col_original", amountCents: 9500, collectedCents: 9500, appliedCents: 9500 } }; };
    await rejects(runRentalPaymentCommand(state, "review", () => false, send)); equal(dispatches, 0);
    await runRentalPaymentCommand(state, "review", persist, send);
    equal(state.stage, "reviewed"); equal(state.review?.quote.amountCents, 9500);
    await rejects(runRentalPaymentCommand(state, "confirm", persist, send)); equal(dispatches, 1);
    await runRentalPaymentCommand(state, "setup", persist, send);
    equal(state.setup?.receiptId, setup.receiptId); assert.ok(!JSON.stringify(state).includes("secret"));
    await runRentalPaymentCommand(state, "confirm", persist, send, true);
    equal(state.result?.card?.status, "saved"); equal(state.result?.payment.appliedCents, 9500);
    const original = JSON.stringify(state); await runRentalPaymentCommand(state, "status", persist, send);
    equal(calls[calls.length - 1]?.action, "status"); equal(calls[calls.length - 1]?.receiptId, setup.receiptId); equal(calls[calls.length - 1]?.consent, undefined);
    const confirmation = parseBookingConfirmation(JSON.stringify({ serviceType: "dumpster", outcomes: { dumpster: ack }, rentalPayment: state }));
    deepEqual(confirmation?.rentalPayment, state); deepEqual(confirmation?.outcomes?.dumpster?.rentalCard, grant);
    const session = "11000000-0000-4000-8000-000000000001";
    const restored = restoreIntent({ intent: { version: 1, bookingSessionId: session, attempts: { dumpster: { payload: { name: "Fixture", phone: "3125550101", bookingSessionId: session }, acknowledgement: ack } }, rentalPayment: state } });
    deepEqual(restored.rentalPayment, state);
    const values = new Map<string, string>(); Object.assign(globalThis, { sessionStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) } });
    equal(saveIntent("fixture", restored), true); assert.ok(!values.get("fixture")?.includes("secret"));
    for (const malformed of [{ ...state, clientSecret: "secret" }, { ...state, rentalId: "sibling" }, { ...state, review: { ...state.review, expiresAt: 12 } }, { ...state, setup: { ...state.setup, receiptId: "not-original" } }]) {
        equal(readRentalPaymentRecovery(malformed, "r1"), undefined);
        equal(parseBookingConfirmation(JSON.stringify({ serviceType: "dumpster", outcomes: { dumpster: ack }, rentalPayment: malformed })), null);
    }
    const retained: RentalPaymentRecovery = { ...state, stage: "reviewed", setup: undefined, result: undefined };
    await rejects(runRentalPaymentCommand(retained, "setup", persist, async () => { equal(state.stage, "setup_pending"); assert.ok(state.review?.reviewToken); throw Error("lost setup response"); }));
    equal(state.setup, undefined); equal(state.stage, "setup_pending");
    await runRentalPaymentCommand(state, "status", persist, async c => { equal(c.action, "status"); equal(c.reviewToken, review.reviewToken); equal(c.receiptId, undefined); return { ...setup, requiresFreshReview: true, nextAction: "authenticated_portal", canContinue: false }; });
    equal(state.result?.requiresFreshReview, true); equal(state.result?.canContinue, false);
    for (const action of ["review", "setup", "confirm", "status", "reconcile", "continue"] as const) {
        const c = { action, grant: grant.grant, ...(action !== "review" ? { reviewToken: grant.grant } : {}), ...(["confirm", "status", "reconcile"].includes(action) ? { setupIntentId: setup.setupIntentId, receiptId: setup.receiptId } : {}), ...(action === "continue" ? { receiptId: setup.receiptId } : {}), ...(["confirm", "continue"].includes(action) ? { consent: true } : {}) };
        assert.ok(readRentalPaymentCommand(c)); equal(readRentalPaymentCommand({ ...c, customerId: "raw-id" }), undefined); equal(readRentalPaymentCommand({ ...c, url: "https://other.invalid" }), undefined);
    }
    equal(readRentalPaymentCommand({ action: "status", grant: grant.grant }), undefined);
    assert.ok(original.includes("col_original"));
    console.log("PASS typed grant/quote/receipt/operation recovery; pre-dispatch storage refusal, lost setup proof, strict command shapes and original-only status");
}
void main().catch(e => { throw e; });

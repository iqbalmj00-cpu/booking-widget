/**
 * SMS consent is opt-in: the booking form reports it only when the visitor ticked
 * the checkbox, with the exact label they saw. A payload saved by a form that
 * predates the checkbox must not be replayed as consent.
 *
 * Run with: npm test
 */

import assert from "assert";
import { restoreIntent, setSmsConsent, smsConsentText } from "../bookingIntent";

/* ── The label carries every disclosure and no marketing consent ──── */

const label = smsConsentText("Acme Hauling");
for (const part of ["Acme Hauling", "Message frequency varies.", "Message and data rates may apply.", "Reply STOP to opt out or HELP for help.", "Consent is not required to get a quote or book."]) {
    assert.ok(label.includes(part), `label is missing: ${part}`);
}
assert.ok(!/marketing|promotion/i.test(label), "label must not ask for marketing consent");

/* ── Unticked sends no consent; ticked sends the exact label ──────── */

assert.deepStrictEqual(setSmsConsent({ name: "Dana", smsOptIn: true, consentText: "stale" }, null), { name: "Dana", smsOptIn: false });
assert.deepStrictEqual(setSmsConsent({ name: "Dana" }, label), { name: "Dana", smsOptIn: true, consentText: label });

/* ── Saved payloads ───────────────────────────────────────────────── */

const session = "11111111-1111-4111-8111-111111111111";
const legacyText = "By proceeding to the next step you agree to marketing and booking related SMS and Email communications.";
const saved = (consent: Record<string, unknown>) => ({
    intent: {
        version: 1, bookingSessionId: session, leadId: null, legacy: false,
        attempts: { junk: { payload: { name: "Dana", phone: "5551234567", bookingSessionId: session, ...consent } } },
        capture: { name: "Dana", phone: "5551234567", ...consent },
    },
});

for (const consent of [{ smsOptIn: true, consentText: legacyText }, { smsOptIn: true }]) {
    const intent = restoreIntent(saved(consent));
    for (const payload of [intent.capture!, intent.attempts.junk!.payload]) {
        assert.strictEqual(payload.smsOptIn, false, "a pre-checkbox payload must not replay consent");
        assert.ok(!("consentText" in payload));
    }
    assert.ok(!intent.blocked);
}

const current = restoreIntent(saved({ smsOptIn: true, consentText: label }));
assert.strictEqual(current.capture!.consentText, label);
assert.strictEqual(current.attempts.junk!.payload.smsOptIn, true);

const declined = restoreIntent(saved({ smsOptIn: false }));
assert.deepStrictEqual(declined.capture, { name: "Dana", phone: "5551234567", smsOptIn: false });

console.log("smsConsent: all assertions passed");

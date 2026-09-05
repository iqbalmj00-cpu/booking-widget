/**
 * Minimal ambient types for node:assert, for the test harness only.
 *
 * The widget builds for the browser and has no @types/node, and the harness
 * deliberately installs nothing. This declares just the members the tests use.
 * The website-template copy of these tests runs against real @types/node, so
 * mistyped expectations are still caught over there.
 */
declare module "assert" {
    interface NodeAssert {
        ok(value: unknown, message?: string): void;
        strictEqual(actual: unknown, expected: unknown, message?: string): void;
        notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    }
    const assert: NodeAssert;
    export default assert;
}

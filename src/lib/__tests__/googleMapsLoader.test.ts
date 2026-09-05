/**
 * Phase 6 (item 3): a page must never end up with two Google Maps scripts.
 *
 * Both repos ship this loader, and the widget's case is the sharp one — it
 * embeds into an operator's own site, which may load Maps itself for a store
 * locator or an embedded map. The loader the widget used to inline checked only
 * for `window.google.maps`, never for a `<script>` still in flight, so between
 * the operator's tag being appended and it finishing, the widget appended its
 * own. Google's API warns and misbehaves when included twice.
 *
 * Run with: npm test
 *
 * Keep identical to website-template/lib/__tests__/googleMapsLoader.test.ts.
 *
 * The DOM here is a stub: the widget builds for the browser and the harness
 * installs nothing, so there is no jsdom. It implements exactly the four things
 * the loader touches — createElement, head.appendChild, querySelector with the
 * loader's own selector, and load/error dispatch — and nothing else. Behaviour
 * beyond those (real CSS selector parsing, script execution) is out of scope
 * here and is only exercised in a browser.
 */

import assert from "assert";
import { loadGoogleMapsScript } from "../googleMapsLoader";

const MAPS_PREFIX = "https://maps.googleapis.com/maps/api/js";

type Listener = { type: string; fn: () => void; once: boolean };

type StubScript = {
    id: string;
    src: string;
    async: boolean;
    defer: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    attributes: Record<string, string>;
    listeners: Listener[];
    setAttribute(name: string, value: string): void;
    remove(): void;
    addEventListener(type: string, fn: () => void, opts?: { once?: boolean }): void;
};

/** Everything currently in the page's head, in insertion order. */
let page: StubScript[] = [];

function makeScript(): StubScript {
    const el: StubScript = {
        id: "", src: "", async: false, defer: false,
        onload: null, onerror: null,
        attributes: {},
        listeners: [],
        setAttribute(name, value) { el.attributes[name] = value; },
        remove() { page = page.filter(s => s !== el); },
        addEventListener(type, fn, opts) { el.listeners.push({ type, fn, once: !!opts?.once }); },
    };
    return el;
}

/** The one selector the loader uses, read literally. */
function querySelector(selector: string): StubScript | null {
    assert.strictEqual(
        selector,
        `script[src^="${MAPS_PREFIX}"]:not([data-load-failed])`,
        "the stub only implements the loader's own selector",
    );
    return page.find(s => s.src.startsWith(MAPS_PREFIX) && s.attributes["data-load-failed"] === undefined) ?? null;
}

function dispatch(el: StubScript, type: "load" | "error"): void {
    if (type === "load") el.onload?.();
    else el.onerror?.();
    for (const l of el.listeners.filter(l => l.type === type)) l.fn();
    el.listeners = el.listeners.filter(l => !(l.type === type && l.once));
}

/** Maps scripts on the page — the number this whole file exists to pin at 1. */
function mapsScripts(): StubScript[] {
    return page.filter(s => s.src.startsWith(MAPS_PREFIX));
}

const g = globalThis as unknown as { window: unknown; document: unknown };
g.window = {};
g.document = {
    head: { appendChild(el: StubScript) { page.push(el); return el; } },
    createElement(_tag: string) { return makeScript(); },
    querySelector,
};

/** Settle without ever leaving a rejection unhandled. */
function settled(p: Promise<void>): Promise<"resolved" | "rejected"> {
    return p.then(() => "resolved" as const, () => "rejected" as const);
}

async function main(): Promise<void> {
    /* ── Maps is already initialised: nothing to load, nothing to append ── */
    (g.window as Record<string, unknown>).google = { maps: { importLibrary: () => Promise.resolve({}) } };
    assert.strictEqual(await settled(loadGoogleMapsScript("k")), "resolved");
    assert.strictEqual(page.length, 0, "an initialised API needs no script tag");
    delete (g.window as Record<string, unknown>).google;

    /* ── First load: exactly one tag, however many callers ask ── */
    const first = settled(loadGoogleMapsScript("secret key&callback=hack"));
    const second = settled(loadGoogleMapsScript("secret key&callback=hack"));
    assert.strictEqual(mapsScripts().length, 1, "two mounts must not mean two scripts");

    const injected = mapsScripts()[0];
    // The key is interpolated into a URL, so it is encoded — an unescaped `&`
    // would let a key value append parameters of its own.
    assert.ok(injected.src.includes("key=secret%20key%26callback%3Dhack"), injected.src);
    assert.ok(!injected.src.includes("&callback=hack"), "the key must not open a second parameter");
    assert.strictEqual(injected.async, true);
    assert.strictEqual(injected.defer, true);

    /* ── A failure must not be cached, and must not leave a corpse ── */
    dispatch(injected, "error");
    assert.strictEqual(await first, "rejected");
    assert.strictEqual(await second, "rejected", "both callers hear about it");
    assert.strictEqual(injected.attributes["data-load-failed"], "true");
    assert.strictEqual(mapsScripts().length, 0, "the dead tag is removed, not left to be found");

    /* ── The retry gets a fresh tag, and still only one ── */
    const third = settled(loadGoogleMapsScript("k2"));
    assert.strictEqual(mapsScripts().length, 1, "retrying appends one tag, not a second corpse");
    const retried = mapsScripts()[0];
    assert.notStrictEqual(retried, injected, "listening to a tag whose error already fired would hang forever");
    dispatch(retried, "error");
    assert.strictEqual(await third, "rejected");
    assert.strictEqual(mapsScripts().length, 0);

    /* ── The operator's own Maps script is already on their page ── */
    // This is the regression. The old loader saw no `window.google.maps` yet —
    // the operator's tag was still downloading — and appended its own.
    const operatorTag = makeScript();
    operatorTag.src = `${MAPS_PREFIX}?key=OPERATORKEY&libraries=marker`;
    page.push(operatorTag);

    const fourth = settled(loadGoogleMapsScript("widget-key"));
    assert.strictEqual(mapsScripts().length, 1, "the widget must not add a second Maps script");
    assert.strictEqual(mapsScripts()[0], operatorTag, "and the survivor is the operator's, untouched");
    assert.strictEqual(operatorTag.attributes["data-load-failed"], undefined);

    // The widget waits on the operator's load rather than racing it.
    dispatch(operatorTag, "load");
    assert.strictEqual(await fourth, "resolved");

    /* ── Later callers reuse the settled promise ── */
    assert.strictEqual(await settled(loadGoogleMapsScript("widget-key")), "resolved");
    assert.strictEqual(mapsScripts().length, 1, "still one Maps script on the page");
}

main().then(() => console.log("googleMapsLoader: all assertions passed"));

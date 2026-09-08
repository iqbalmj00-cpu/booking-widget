import assert from "assert";
import { getContainerSizes, validContainerSelection } from "../containerCatalog";
const pricing = { tiers: [40, 15, 10, 30, 20, 15].map(sizeCuYd => ({ sizeCuYd, baseRate: 350 })) };
assert.deepStrictEqual(getContainerSizes(pricing).map(c => c.id), ["10yd", "15yd", "20yd", "30yd", "40yd"]);
const fifteen = getContainerSizes(pricing)[1];
assert.strictEqual(fifteen.label, "15 Yard");
assert.strictEqual(fifteen.yards, "15 yd³");
assert.strictEqual(fifteen.desc, "15 cubic yards of container capacity");
assert.strictEqual(validContainerSelection("15yd", pricing), "15yd");
assert.strictEqual(validContainerSelection("15yd", { tiers: [{ sizeCuYd: 20 }] }), null);
assert.strictEqual(validContainerSelection("15ydjunk", pricing), null);
for (const bad of [null, undefined, {}, { tiers: null }, { tiers: [{ sizeCuYd: 0 }, { sizeCuYd: -1 }, { sizeCuYd: NaN }, { sizeCuYd: Infinity }, { sizeCuYd: "15" }, null] }]) {
    assert.deepStrictEqual(getContainerSizes(bad), []);
    assert.strictEqual(validContainerSelection("20yd", bad), null);
}
assert.deepStrictEqual(getContainerSizes({ tiers: [{ sizeCuYd: 25 }] }).map(c => c.id), ["25yd"]);

export type ContainerSize = { id: string; label: string; yards: string; desc: string; goodFor: string; icon: string };

const CONTAINER_METADATA: ContainerSize[] = [
    { id: "10yd", label: "10 Yard", yards: "10 yd³", desc: "About 3 pickup truck loads", goodFor: "Bathroom remodel, small cleanout, garage declutter", icon: "Container" },
    { id: "20yd", label: "20 Yard", yards: "20 yd³", desc: "About 6 pickup truck loads", goodFor: "Single-room renovation, medium cleanout, roofing (up to 1,500 sq ft)", icon: "Container" },
    { id: "30yd", label: "30 Yard", yards: "30 yd³", desc: "About 9 pickup truck loads", goodFor: "Multi-room renovation, large estate cleanout, new construction debris", icon: "Container" },
    { id: "40yd", label: "40 Yard", yards: "40 yd³", desc: "About 12 pickup truck loads", goodFor: "Full house cleanout, major construction, commercial demolition", icon: "Warehouse" },
];

/** Offered sizes come only from the operator catalog; metadata never implies stock or price. */
export function getContainerSizes(pricing: unknown): ContainerSize[] {
    const tiers = pricing && typeof pricing === "object" && "tiers" in pricing ? pricing.tiers : null;
    if (!Array.isArray(tiers)) return [];
    const sizes = new Set<number>();
    for (const tier of tiers) {
        const size = tier && typeof tier === "object" ? tier.sizeCuYd : null;
        if (typeof size === "number" && Number.isSafeInteger(size) && size > 0) sizes.add(size);
    }
    return [...sizes].sort((a, b) => a - b).map(size => {
        const id = `${size}yd`;
        return CONTAINER_METADATA.find(container => container.id === id) || {
            id, label: `${size} Yard`, yards: `${size} yd³`, icon: "Container",
            desc: `${size} cubic yards of container capacity`,
            goodFor: "Confirm accepted materials and project fit with the rental team",
        };
    });
}

export function validContainerSelection(selection: unknown, pricing: unknown): string | null {
    return typeof selection === "string" && getContainerSizes(pricing).some(size => size.id === selection) ? selection : null;
}

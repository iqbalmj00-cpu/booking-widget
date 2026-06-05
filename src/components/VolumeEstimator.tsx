import { useCallback, useMemo, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./VolumeEstimator.module.css";
import { DIMENSION_GUIDE_DATA_URL, REFERENCE_ASSET_DATA_URLS, TRUCK_ASSET_DATA_URLS, type VolumeAssetKey } from "./volumeEstimatorAssets";

type VolumeEstimatorLevel = {
    volumeId: string;
    label: string;
    title: string;
    desc: string;
    cuYd: number;
    fill: number;
};

type VolumeEstimatorProps = {
    levels: VolumeEstimatorLevel[];
    value: number;
    onChange: (index: number) => void;
    brandColor: string;
    className?: string;
};

const DEFAULT_ORANGE = "#f97316";
const VOLUME_ASSET_KEYS: VolumeAssetKey[] = ["few", "quarter", "half", "three_quarter", "full"];

const REFERENCE_COPY: Record<string, { title: string; detail: string }> = {
    few: {
        title: "Single large appliance",
        detail: "A washer, dryer, refrigerator, mattress set, or 6-8 large boxes.",
    },
    quarter: {
        title: "Sofa and armchair",
        detail: "A sofa and armchair, or a small dining set with a few boxes.",
    },
    half: {
        title: "Bedroom set plus boxes",
        detail: "A bedroom set plus 10-15 boxes or bags.",
    },
    three_quarter: {
        title: "Bedroom plus living room",
        detail: "A bedroom set plus a living room group with boxes.",
    },
    full: {
        title: "Garage cleanout",
        detail: "A typical packed single-car garage cleanout.",
    },
};

function clampIndex(index: number, max: number) {
    return Math.max(0, Math.min(max, index));
}

function normalizeHex(value: string, fallback = DEFAULT_ORANGE) {
    return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function hexToRgbTriplet(hex: string) {
    const normalized = normalizeHex(hex);
    return `${parseInt(normalized.slice(1, 3), 16)}, ${parseInt(normalized.slice(3, 5), 16)}, ${parseInt(normalized.slice(5, 7), 16)}`;
}

function assetKeyFor(volumeId: string): VolumeAssetKey {
    return VOLUME_ASSET_KEYS.includes(volumeId as VolumeAssetKey) ? volumeId as VolumeAssetKey : "quarter";
}

function joinClasses(...classes: Array<string | undefined | false>) {
    return classes.filter(Boolean).join(" ");
}

export function VolumeEstimator({ levels, value, onChange, brandColor, className }: VolumeEstimatorProps) {
    const estimatorLevels = useMemo(() => levels.slice(0, 5), [levels]);
    const maxIndex = estimatorLevels.length - 1;
    const selectedIndex = clampIndex(value, maxIndex);
    const selectedLevel = estimatorLevels[selectedIndex] ?? estimatorLevels[1];
    const assetKey = assetKeyFor(selectedLevel.volumeId);
    const safeBrandColor = normalizeHex(brandColor);
    const reference = REFERENCE_COPY[selectedLevel.volumeId] ?? {
        title: selectedLevel.title,
        detail: selectedLevel.desc,
    };
    const cssVars = {
        "--ve-brand": safeBrandColor,
        "--ve-brand-rgb": hexToRgbTriplet(safeBrandColor),
    } as CSSProperties;

    const selectIndex = useCallback((index: number) => {
        onChange(clampIndex(index, maxIndex));
    }, [maxIndex, onChange]);

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            selectIndex(selectedIndex + 1);
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            selectIndex(selectedIndex - 1);
        }
        if (event.key === "Home") {
            event.preventDefault();
            selectIndex(0);
        }
        if (event.key === "End") {
            event.preventDefault();
            selectIndex(maxIndex);
        }
    }, [maxIndex, selectIndex, selectedIndex]);

    return (
        <section className={joinClasses("syj-volume-estimator", styles.root, className)} style={cssVars}>
            <div className={joinClasses("syj-volume-estimator__panels", styles.panels)}>
                <article className={joinClasses("syj-volume-estimator__panel", styles.panel)}>
                    <div className={joinClasses("syj-volume-estimator__panel-head", styles.panelHead)}>
                        <div>
                            <p className={joinClasses("syj-volume-estimator__eyebrow", styles.eyebrow)}>Dump-bed fill</p>
                            <h2 className={joinClasses("syj-volume-estimator__title", styles.title)}>{selectedLevel.label} of a 15 cu yd truck</h2>
                        </div>
                    </div>
                    <div className={joinClasses("syj-volume-estimator__visual", "syj-volume-estimator__visual--truck", styles.visual, styles.visualLarge, styles.truckVisual)}>
                        <div className={joinClasses("syj-volume-estimator__truck-stage", styles.truckStage)}>
                            <img
                                className={joinClasses("syj-volume-estimator__image", "syj-volume-estimator__image--truck", styles.image, styles.truckImage)}
                                src={TRUCK_ASSET_DATA_URLS[assetKey]}
                                alt={`${selectedLevel.label} shown inside a dump-bed truck with a transparent near wall`}
                            />
                            <img
                                className={joinClasses("syj-volume-estimator__dimension-overlay", styles.dimensionOverlay)}
                                src={DIMENSION_GUIDE_DATA_URL}
                                alt=""
                                aria-hidden="true"
                            />
                        </div>
                    </div>
                </article>

                <article className={joinClasses("syj-volume-estimator__panel", styles.panel)}>
                    <div className={joinClasses("syj-volume-estimator__panel-head", styles.panelHead)}>
                        <div>
                            <p className={joinClasses("syj-volume-estimator__eyebrow", styles.eyebrow)}>Looks like</p>
                            <h2 className={joinClasses("syj-volume-estimator__title", styles.title)}>{reference.title}</h2>
                        </div>
                    </div>
                    <div className={joinClasses("syj-volume-estimator__visual", "syj-volume-estimator__visual--reference", styles.visual, styles.visualLarge)}>
                        <img
                            className={joinClasses("syj-volume-estimator__image", "syj-volume-estimator__image--reference", styles.image, styles.imageLarge)}
                            src={REFERENCE_ASSET_DATA_URLS[assetKey]}
                            alt={reference.title}
                        />
                    </div>
                    <p className={joinClasses("syj-volume-estimator__copy", styles.copy)}>{reference.detail}</p>
                </article>
            </div>

            <div className={joinClasses("syj-volume-estimator__controls", styles.controls)}>
                <div className={joinClasses("syj-volume-estimator__control-head", styles.controlHead)}>
                    <strong>{selectedLevel.title}</strong>
                    <span>{Math.round(selectedLevel.fill * 100)}% full</span>
                </div>
                <div
                    className={joinClasses("syj-volume-estimator__radio-row", styles.radioRow)}
                    role="radiogroup"
                    aria-label="Truck load size"
                    onKeyDown={onKeyDown}
                >
                    {estimatorLevels.map((level, index) => {
                        const active = selectedIndex === index;
                        return (
                            <button
                                key={level.volumeId}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                tabIndex={active ? 0 : -1}
                                className={joinClasses("syj-volume-estimator__radio", styles.radio)}
                                onClick={() => selectIndex(index)}
                            >
                                <strong>{level.label}</strong>
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
